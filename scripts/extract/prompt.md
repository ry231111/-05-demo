你在這個專案的根目錄工作。任務：從組織的自由文字紀錄中抽取「訊號標籤」，寫成 output/signals.json。

## 輸入
- output/texts_for_ai.json：每家組織的接觸紀錄與顧問筆記（每筆有 id、date、kind、type、activity、text）
- rules/rules.json 的 `ai_tags`：每個標籤的 definition（判斷依據）。keywords 只是參考，**不要只靠關鍵字**，換句話說、語意相同的也要算。

## 禁止
- 不要讀 data/mock/情境對照.md、data/demands/、output/orgs.json（避免看到答案）
- 不要修改 output/signals.json 以外的任何檔案

## 判斷原則
- 保守：要有文字明確支持才標；只是「有可能」不要標。
- 每個標籤都要附上依據的紀錄 id（可以多筆），以及一段 **逐字複製** 的原文 quote（從該筆 text 原封不動複製一段連續文字，10–60 字，不可改字、不可加標點、不可合併兩筆）。程式會檢查 quote 是不是原文的子字串，對不上就會被丟掉。
- 同一家同一個標籤只輸出一筆（record_ids 可以列多筆，quote 取最有代表性的那一筆）。
- 「孤軍奮鬥」和「組織整體進步」是相反情境，同一家通常只會有一個；如果真的兩者都有（例如前期孤單、後期改善），兩個都標，交給規則用時間判斷。

## 輸出格式（output/signals.json，UTF-8）
```json
{
  "generated_by": "codex",
  "covered_orgs": ["ORG001", "..."],
  "signals": [
    { "org_id": "ORG017", "tag": "組織整體進步", "record_ids": ["C0123"], "quote": "原文逐字片段", "reason": "一句話說明為什麼" }
  ]
}
```
- covered_orgs 列出所有你看過的組織（就算沒有任何標籤也要列）。
- tag 只能用 rules.json ai_tags 裡的名稱。

## 完成前自我檢查
用 python 讀 output/signals.json 和 output/texts_for_ai.json，確認：JSON 合法；每筆 quote 去掉空白後是對應 record 文字（去掉空白後）的子字串；record_ids 都屬於該 org。不符合的修正或刪除。最後回覆每個標籤各標了幾家。
