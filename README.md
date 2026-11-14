# 好事媒合助手（好事大平台組 · AI Impact Day）

PM 接到企業一句話需求時打開：輸入需求 → 轉成條件 → 候選名單（每家附推薦理由、要注意什麼、電訪先問什麼，每條都能點回原始紀錄）→ 勾「符合／不符合」重排 → 產生給 Claude 的提示詞，貼回後自動檢查引用。

> 資料全為虛構。計畫與範圍以 `CLAUDE.md` 為準，進度看 `docs/進度表.md`。

---

## 怎麼打開

- **線上版**：GitHub Pages 網址（部署後補上），開 `/web/`。
- **本機**：在專案根目錄跑下面這行，再開 http://localhost:8765/web/

```bash
python -m http.server 8765
```

也可以試試直接雙擊 `web/index.html`（設計上支援 file://，但還沒在一般 Chrome 實測過；有些內嵌瀏覽器的 file:// 不會跑 JS，就改用上面的指令）。

不需要後端、帳號或 API key。篩選、算分、重排都在瀏覽器裡算。

---

## 資料怎麼流

```
① 原始資料 3 張表（data/mock/、data/drill/ 或 data/official/）
   ↓ scripts/build.py（依 config/columns.json 對應欄位）
② output/orgs.json、output/bundle.js（網頁讀這個）、output/orgs/{編號}.md
   ↑ AI 標籤：scripts/extract/run.sh 讓 Codex 讀自由文字 → output/signals.json（附原文，build 會檢查）
   ↓
③ web/engine.js 依 rules/rules.json 算分 → web/app.js 畫畫面
   ↓ PM 回饋：網頁下載 JSON → 放 data/feedback/ → 重新 build 寫回組織檔
```

| 檔案 | 用途 | 誰改 |
|---|---|---|
| `config/columns.json` | 資料源切換、欄名候選、值對應 | 換資料時改這裡 |
| `rules/rules.json` | 18 條判斷規則（訊號 → 解讀 → 行動 → 出處） | 不調 |
| `rules/conditions.json` | 需求條件、軟條件、一句話需求關鍵字範本 | 不調 |
| `data/demands/sample_demands.json` | 01 頁的示範需求按鈕 | 可加任務卡的需求 |
| `web/engine.js` | 篩選引擎（不碰 DOM） | **UI 改版不要動** |
| `web/index.html`、`app.js`、`style.css` | 畫面 | **UI 隊友改這三個** |

---

## 給 UI 隊友：畫面 ↔ 資料

網頁啟動時 `window.APP_DATA = {orgs, rules, conditions, demands, feedback}`，再 `Engine.init(APP_DATA)`。

### 五個畫面（建議 Figma Frame 同名）

| Frame | 用到的資料 |
|---|---|
| 01 需求輸入 | `APP_DATA.demands[].title/sentence`；`Engine.parseSentence(句子)` → 條件，其中 `_matched` 是「系統讀到了什麼」 |
| 02 候選名單 | `Engine.rank(條件, 回饋)` → `candidates[]`、`relaxed[]`（已放寬）、`excluded[]`（已排除）、`disabled_rules[]`（因缺欄位停用） |
| 03 組織詳情 | `APP_DATA.orgs.orgs[]`：`summary_30s`、`fields`、`missing`、`stats`、`hits[]`、`timeline[]` |
| 04 第二輪回饋 | `Engine.feedbackItem(...)`、`Engine.exportFeedback(list)` |
| 05 提示詞與驗證 | `Engine.buildPrompt(條件, 候選)`、`Engine.verifyReply(貼回的文字, 候選)` |

### 候選卡片的欄位（`candidates[]` 每一筆）

```jsonc
{
  "org_id": "ORG018", "name": "朔芽方格兒少實驗協會", "rank": 1, "score": 8.2,
  "fields": { "議題", "區域", "全職人數", "會籍", … },
  "hard_status": "match | relaxed | missing",   // relaxed＝放寬後納入；missing＝欄位缺值
  "missing_fields": ["陪跑分級"],
  "reasons":  [{ "rule": "R05", "label": "學到的有帶回組織", "text": "…", "contrib": 2,
                 "evidence": [{ "record_id": "C0094", "date", "type", "source", "quote": "原文" }] }],
  "warnings": [ 同 reasons ],                  // 要注意什麼
  "call_questions": [{ "rule", "text" }],      // 電訪先關心什麼
  "soft_matched": [{ "name": "有動機", "explain", "delta" }],
  "feedback": null, "demoted": false           // demoted＝PM 標了不符合，排在最後
}
```

### 一定要畫的狀態

空名單、條件已放寬（`relaxed`）、規則停用（`disabled_rules`）、欄位缺值（`missing_fields`）、引用驗證失敗（`verifyReply` 的 `not_found`／`wrong_org`）、組織沒有名稱（官方資料可能沒有名稱欄，會顯示編號）。

---

## 11/15 導入官方資料（演練過，約 30–40 分鐘）

1. **匯出**：Google Sheet 每個資料分頁「檔案 → 下載 → CSV」，放到 `data/official/`。「讀我」「欄位說明」分頁不用匯出。
2. **健檢**：看 `output/profile.md`，重點是三段：「標準欄位 ↔ 實際欄位」表格、「未知類別值」、「建議要改 columns.json 的地方」。

   ```bash
   python scripts/profile.py --source official
   ```

3. **改 `config/columns.json`**：
   - `sources.official.files`：改成實際檔名（Sheet 匯出的檔名通常像「檔名 - 分頁名.csv」）。
   - `tables.*.columns`：把實際欄名加進對應欄位的候選清單。
   - `value_maps`：健檢「未知類別值」每一行都會告訴你要加哪一行，例如 `"正式會員": "會員"`。
   - `source`：改成 `"official"`。
   - 改完重跑第 2 步，直到「未知類別值」是「無」，表格裡只剩官方資料本來就沒有的欄位。
4. **build**：跑下面這行，再看 `output/build_log.md` 的「停用規則」「資料問題」。

   ```bash
   python scripts/build.py
   ```

5. **AI 標籤**：跑下面這行（約 6 分鐘，可以放背景，一邊做別的事）。還沒跑完或失敗也沒關係，網頁會自動改用關鍵字判斷。

   ```bash
   bash scripts/extract/run.sh
   ```

6. **檢查**：跑下面的冒煙測試，再打開網頁用任務卡上的需求跑一次名單。

   ```bash
   node scripts/check.js
   ```

### 常見狀況

| 看到什麼 | 原因 | 怎麼處理 |
|---|---|---|
| 健檢表格某欄寫「缺：未找到欄名」 | 官方欄名不在候選清單裡 | 把實際欄名加進 `columns.json` 該欄位的候選清單 |
| 「未知類別值」有東西 | 值的寫法不同（例如「正式會員」） | 照那一行的提示加進 `value_maps` |
| 「無法解析樣本」有日期 | 日期格式沒支援 | 把格式加進 `date_formats`（民國年已支援） |
| build_log「停用規則」 | 官方資料真的沒有那個欄位 | 不用處理，網頁會顯示「因缺欄位停用」 |
| build_log「AI 來源」寫「來自資料源 mock」 | 還沒對官方資料跑 AI 抽取 | 跑第 5 步；沒跑之前用關鍵字備案 |
| 名單上組織名稱變成編號 | 官方資料沒有名稱欄 | 正常，不用處理 |
| 組織主檔第一列是標題 | Sheet 上方有標題列 | 程式會自動跳過（至少兩格有字的列才當欄名） |

要先演練的話，`data/drill/` 是仿官方格式的資料，用 `--source drill` 就能跑。演練完記得把 `output/signals.json` 換回來，或對原本的資料源重跑 AI 抽取。

---

## 指令速查

| 要做什麼 | 指令 |
|---|---|
| 資料健檢 | `python scripts/profile.py [--source mock\|drill\|official]` |
| 建置 | `python scripts/build.py [--source …] [--no-ai]` |
| AI 標籤抽取 | `bash scripts/extract/run.sh [--source …]` |
| 冒煙測試 | `node scripts/check.js` |

Python 只用標準函式庫，Node 只用來跑 `check.js`。
