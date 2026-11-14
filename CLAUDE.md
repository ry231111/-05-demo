# CLAUDE.md — 好事大平台組 Prototype（AI Impact Day 黑客松）

> **這份檔案是唯一的計畫來源。** 使用者只會修改這份 CLAUDE.md；進度表 `docs/進度表.md` 是它的子表，由 Claude 維護（規則見第 11 節「進度表同步規則」），若要修改CLAUDE.md需要得到使用者的明確同意。

> **使用繁體中文跟使用者溝通。**

---

## 1. 專案目的與取捨

為「好事在數聚村莊｜數位快閃 Digital Impact Sprint（AI Impact Day）」**分場 A · 好事大平台**（資料流程 × AI 自動化）產出可展示、可操作的 prototype。
目標不是完整系統，評判準確度也不是評分標準（因為只有假資料），目標是做出**組織用得上**、能在 7 分鐘內 demo 清楚的 MVP。

- **看起來好用最重要**：評審看的是「解決誰的痛點、在什麼時刻」，成功標準是同仁覺得「明天就想用」。
- **不要在準確度上花時間**：不調規則、不調權重、不去對齊假資料情境；結果「看起來合理、有依據」就夠。
- **不會接入AI API也不會做後端資料庫**
- 活動首頁：https://beta.datadot.life/aiimpactday/index.html ／ 參賽者手冊：https://beta.datadot.life/aiimpactday/handbook.html
- 主辦：數聚村莊 Connect the Dots
- 訪談整理：`docs/訪談對照.md`（訪談 → 痛點 → 設計的對照，簡報可直接用）

## 2. 題目與任務

**背景**：好事大平台串聯公益組織、推動 NPO 自律與資訊透明。要從實際工作流程找出「資料蒐集 → 整理 → 使用」之間的卡點，用資料、AI 與自動化讓日常工作更有效率。核心概念：**以「組織」為中心，把散落在各系統的接觸紀錄串起來**。

**任務（選擇任務一，任務二不用管）**
1. **為一個計畫找對的組織**：企業想用專業陪跑 10 家組織，PM 要把需求轉成篩選條件，產出**候選名單＋推薦理由**。
2. ~~讓散落的資料變成好用的入口（組織速覽）~~：不做。候選名單點進去的組織詳情頁屬於任務一的流程。

## 3. 兩天的目標

| 日期 | 目標 |
|---|---|
| **11/14（六）比賽前一天** | 用自造假資料（`data/mock/`）把整條流程做通，並把「導入官方資料」變成照表操作的步驟。**目標：11/15 拿到官方假資料後，1 小時內導入完成。** |
| **11/15（日）比賽當天** | 前 1 小時導入官方資料（`data/official/`）；**剩下的時間都用在修 UI**，並根據當天對好事大平台工作人員的訪談，**視需要新增使用模組**。 |

11/15 時程：12:00–12:30 報到 → 12:30–12:45 開場、NGO 說需求、發資料 QR code → **12:45–16:45 實作** → **16:15 前開始做簡報** → **16:45 繳交（之後不能改）** → 16:50–17:25 分場分享，每組 7 分鐘（含 demo）。每組 2 顆「無敵星星」＝ 2 次向 NGO 諮詢的機會，問題要先想好。

## 4. 使用情境（demo 故事）

**PM 接到企業一句話需求的那一刻打開它**：輸入需求 → 系統轉成條件 → 給出候選名單，每家附「為什麼推薦／要注意什麼／電訪先關心什麼」，每條理由都能點回原始紀錄 → PM 勾「符合／不符合＋一句話」→ 名單重排，回饋寫回組織檔 → 一鍵產生給 Claude 的提示詞，請它寫理由，貼回後自動檢查引用。

| Demo 必答 | 我們的答案 |
|---|---|
| 誰、什麼時候打開？ | PM 接到企業陪跑或課程需求、要開始找組織時 |
| 用之前 vs 用之後 | 之前：翻 Ragic、SharePoint、LINE，再問資深顧問，好幾天；之後：幾分鐘拿到附依據的第一波名單，顧問只要勾選加一句話 |
| 缺什麼資料？誰補？怎麼持續？ | 畫面列出「因缺欄位而停用的規則」；PM 回饋寫回組織檔（資料跟著組織走，不跟著 PM 走） |

## 5. 系統架構

```
① 原始資料：3 張表（data/mock/ 或 data/official/）
   ↓ scripts/build.py（依 config/columns.json 對應欄位）
② 每家組織一份：output/orgs/{組織編號}.md（給人和 Claude 看）
                  output/orgs.json、output/bundle.js（給網頁用，內容相同）
   ↑ AI 標籤：scripts/extract/ 讓 Codex 讀自由文字 → output/signals.json（附原文，build 會檢查原文是否存在）
   ↓
③ 網頁 web/：engine.js 依 rules/rules.json 算分排序 → 候選名單、組織詳情
   ↓ PM 回饋（匯出 JSON → data/feedback/ → 下次 build 寫回 ②）
```

- **判斷標準只有一份：`rules/rules.json`**（18 條規則，每條是「訊號 → 解讀 → 行動 → 出處」，出處引用訪談）。
- 結構化欄位的訊號由程式直接算；只藏在自由文字裡的訊號（孤軍奮鬥、整體進步、主管換人…）由 AI 先讀一次轉成標籤。
- 網頁沒有後端、不即時呼叫 AI；AI 抽取在 build 時做一次存檔，網頁上的排序、重排都是即時計算。
- 資料層與資料來源解耦：**換資料只改 `config/columns.json`**（欄名候選、值對應、日期格式），不改 UI。規則缺欄位會自動停用並顯示。
- Python 只用標準函式庫；網頁用原生 HTML/CSS/JS，`file://` 直接開也能跑，可放 GitHub Pages。

### 目錄
```
config/columns.json        資料源切換＋欄位/值對應（換資料只改這裡）
data/mock/                 自造假資料（48 家、243 筆接觸、14 家顧問筆記）＋情境對照.md
data/official/             11/15 官方資料匯出 CSV 放這裡（不要硬編碼進程式）
data/demands/              4 個示範需求
data/feedback/             網頁匯出的 PM 回饋
rules/rules.json           判斷標準（唯一一份）
rules/conditions.json      需求條件、軟條件＝規則組合、一句話需求關鍵字範本
scripts/profile.py         資料健檢（拿到新資料第一個跑）
scripts/build.py           ① → ②
scripts/extract/           AI 標籤抽取（prompt.md、run.sh）
output/                    build 產物
web/                       engine.js＋網頁
docs/                      進度表、訪談對照、demo 腳本、簡報大綱
```

## 6. 官方資料 Schema（所有表以「組織編號」串接；說明會也提到「統編」，對照表兩個都認）

1. **組織主檔**：48 家，一家一列：組織編號、議題、服務對象、區域、會籍、全職人數、財報類型、桑基圖上架、陪跑分級
2. **接觸紀錄**：約 200 筆，一次接觸一列：組織編號、日期、接觸類型（培力課程、課後追蹤、陪跑、走訪、會員大會、危機諮詢、獎補助入選…）、活動名稱、參與者職稱、留下的話（自由文字）、資料來源
3. **顧問筆記**：只有 14 家有，資深顧問／PM 對組織的主觀體感（自由文字）
4. Sheet 內另有「讀我＋任務卡」「資料欄位說明」分頁

官方資料全為虛構，可以上傳給 AI 工具處理。

## 7. 範圍：做什麼、不做什麼

| 做（簡單版就好） | 不做 / 砍掉 |
|---|---|
| 篩選引擎：硬條件篩選、規則加總算分、理由與警訊、名單不夠時自動放寬並顯示 | 依回饋原因自動調權重 |
| 第二輪：勾「不符合」就移到名單最後，原因寫回組織檔 | 規則與權重的微調、對齊假資料情境 |
| AI 標籤抽取跑一次，結果直接用 | 為了命中率反覆調 prompt 或關鍵字 |
| 一句話需求 → 關鍵字範本預填表單，PM 再調整 | 完整的自動化測試 |
| 產生 Claude 提示詞＋貼回後檢查紀錄編號是否存在、是否屬於該組織 | 後端、帳號、API key、即時 AI 呼叫 |
| **UI（最優先）**：照 Figma 做，好看、好懂、好操作 | 串接 Ragic 等真實系統；任務二 |

## 8. 資料契約（UI 和 Figma 對照用）

`output/orgs.json`（網頁讀 `output/bundle.js`，`window.APP_DATA = {orgs, rules, conditions, demands, feedback}`）：
```jsonc
{ "meta": { "source", "ref_date", "missing_fields": [], "disabled_rules": [{ "id", "reason" }] },
  "orgs": [{
    "id": "ORG017", "name": "…",
    "fields": { "議題", "服務對象", "區域", "縣市", "會籍", "全職人數", "財報類型", "桑基圖上架", "陪跑分級", "年度收入區間" },
    "missing": [],                         // 這家缺值的欄位
    "stats": { "contacts", "notes", "last_contact", "by_type": {} },
    "hits": [{ "rule": "R05", "label": "學到的有帶回組織", "kind": "tag | warning",
               "evidence": [{ "record_id": "C0123", "date", "type", "source", "quote": "原文" }],
               "method": "ai | keyword | structured" }],
    "summary_30s": ["…"],                  // 組織詳情頁最上方的摘要
    "timeline": [{ "id", "date", "kind": "contact | note", "type", "activity", "text" }]
  }] }
```
需求條件 `conditions`：`{ scenario: 實驗課|例行課|企業陪跑|年度走訪, need_n, multiplier, hard: {議題[], 區域[], 全職人數{min,max}, …}, soft: [軟條件名稱], exclude_recent_partner }`
PM 回饋 `feedback`：`{ org_id, verdict: 符合|不符合, reason_code, note, by, date }`

## 9. Figma 怎麼接

- **請 UI 隊友**：每個畫面一個 Frame（`01 需求輸入`、`02 候選名單`、`03 組織詳情`、`04 第二輪回饋`、`05 Claude 提示詞與驗證`）；會被資料替換的文字圖層用欄位路徑命名（如 `{org.name}`、`{evidence.quote}`）；空名單、條件已放寬、規則停用、引用驗證失敗等狀態也要畫；建議每個 AI 標籤旁有「認同／不認同」按鈕（對應訪談 Q8）。
- **Claude 收到 Figma 後**：用 Figma MCP 逐 Frame 讀 → 列「Figma 元件 ↔ 資料契約欄位」對照表給隊友確認 → 照設計刻 `web/`，engine 不動。
- Figma 還沒來之前先用陽春版 UI；**11/15 11:00 前 Figma 沒好就用陽春版 demo**。

## 10. 11/15 導入官方資料步驟（目標 1 小時）

1. 掃 QR code，Google Sheet 各分頁匯出 CSV → 放 `data/official/`
2. `python scripts/profile.py --source official` → 看缺哪些欄、哪些值沒對應到
3. 改 `config/columns.json`：`source` 改 `official`、檔名、欄名候選、值對應
4. `python scripts/build.py` → 看 `output/build_log.md`、停用了哪些規則
5. `bash scripts/extract/run.sh` → AI 標籤（跑一次就好）
6. 打開網頁，用任務卡上的需求跑一次名單，確認畫面正常

## 11. 評分、交付與開發原則

- **評分**：組織能不能用 40%、問題有沒有抓對 30%、方法有沒有巧思 30%（含「**如何確認 AI 結果是對的**」）。評分者：NGO 夥伴 40%、Mentor 40%、小組互評 20%。功能不用多，「組織用不用得上」比功能數量重要。
- **交付**：簡報 ≤ 3 頁（問題／方法／成果怎麼用）、可操作的 prototype、所有連結（Sheet、簡報、prototype）設為「知道連結的人可以檢視」。
- **開發原則**：
  - 速度優先、可 demo 優先：最少依賴、最快跑起來、能給出可分享連結；不要後端或帳號設定。
  - AI 產出一律附依據（紀錄編號＋原文），這是「如何確認 AI 結果是對的」的直接答案。
  - 推薦邏輯可解釋：條件 → 分數 → 理由，PM 看得懂。
  - 介面用繁體中文，使用者是 NGO PM，不是工程師。
  - 資料一律虛構，不放真實個資。

## 12. 工作方式

### Token 管理：重活交給 Codex（sol6.1 模型）
本機有 Codex CLI（以 ChatGPT 帳號登入）。**需要大量 token 的工作交給 Codex sol6.1 模型；Claude 負責規劃、拆任務、審查、小修改**，避免把 Claude 的額度用完。
- 適合交給 Codex：大量產生資料或文字、整頁初版程式、讀大量資料彙整、批次修改。
- **一律指定模型**：`codex exec -m gpt-6.1-sol -c model_reasoning_effort="medium" -s workspace-write --skip-git-repo-check -C . -`（從 stdin 讀任務）。只有語意判讀類（如 AI 標籤抽取）才用 `high`。**不要用設定檔預設的 gpt-6-astra xhigh**，額度會很快用完。
- 一次給一個範圍清楚的任務，寫明目標檔案、格式、完成條件；Codex 和 Claude 不同時改同一個檔案。Codex 完成後由 Claude 檢查結果、跑起來確認，再回報。

### 進度表同步規則
- **使用者只修改 CLAUDE.md。** 每次對話開始，或發現 CLAUDE.md 有變動時，Claude 要同步更新 `docs/進度表.md`：新增、刪除或調整任務，讓進度表跟這份計畫一致。
- **Claude 依照最新的進度表工作**，每開始或完成一項就立刻更新該項的狀態與備註，不要等到最後才補。
- 進度表狀態符號：✅ 完成、🔄 進行中、⬜ 未開始、⏸ 暫停、✂️ 已砍掉。
