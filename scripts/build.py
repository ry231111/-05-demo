"""Build the organization view using declarative rules and verified quotations."""

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone

sys.dont_write_bytecode = True

from _common import (ROOT, compact, load_tables, md, months_before, normalize_city,
                     parse_date, print_utf8, read_json, unknown_categories,
                     write_json, write_text)


class BuildLog:
    def __init__(self):
        self.entries = defaultdict(list)

    def add(self, category, message):
        self.entries[category].append(message)

    def render(self, meta):
        lines = ["# 建置紀錄", "", f"資料源：{meta['source']}；參考日：{meta['ref_date']}",
                 f"原始筆數（去重前）：{json.dumps(meta['counts'], ensure_ascii=False)}", "",
                 "counts.contacts / notes 為讀入的非空資料列數；組織統計與規則排除重複及無對應組織的紀錄。",
                 "月份以參考日減日曆月計算，月底不足日取月底；近期區間包含起訖日。",
                 "重複比較只去空白，不去標點；沒有有效日期時不自動合併。", "",
                 "## AI 標籤", "", f"驗證通過 {meta['signals']['ai_valid']} 筆；"
                 f"丟棄 {meta['signals']['ai_dropped']} 筆；keyword {meta['signals']['keyword']} 組（組織＋標籤）。", ""]
        categories = ["正規化修正", "無法解析的日期", "重複紀錄", "停用規則", "丟掉的 AI 標籤",
                      "未知類別值", "缺欄位", "資料問題", "AI 來源"]
        for category in categories:
            entries = self.entries[category]
            lines += [f"## {category}（{len(entries)}）", ""]
            lines += ["- " + md(item) for item in entries] or ["無。"]
            lines.append("")
        return "\n".join(lines)


def normalized_date(value, config, log, label):
    parsed = parse_date(value, config["date_formats"])
    result = parsed.isoformat() if parsed else None
    if value and result is None:
        log.add("無法解析的日期", f"{label}：{value!r} → null")
    elif value and value != result:
        log.add("正規化修正", f"{label}：{value!r} → {result}")
    return result


def normalize(tables, config, rules, log):
    maps = config["value_maps"]
    orgs, records = {}, []
    for table_name, table in tables.items():
        for field in table["missing"]:
            marker = "（assumed）" if field in table["spec"].get("assumed", []) else ""
            log.add("缺欄位", f"{table_name}.{field}{marker}："
                    + ("找不到欄名" if table["mapping"][field] is None else "整欄全空"))
        if not table["path"].exists():
            log.add("資料問題", f"{table_name} 檔案不存在：{table['path']}")
    for number, row in tables["orgs"]["rows"]:
        org_id = row["id"]
        if not org_id:
            log.add("資料問題", f"orgs 資料列 {number} 缺組織編號，無法建立組織")
            continue
        if org_id in orgs:
            raise ValueError(f"重複組織編號：{org_id}")
        if any(char in org_id for char in '/\\<>:"|?*') or org_id in (".", "..") or org_id.endswith((".", " ")):
            raise ValueError(f"組織編號無法用作 Windows 檔名：{org_id!r}")
        fields = {k: v or None for k, v in row.items() if k not in ("id", "name")}
        for key in ("會籍", "財報類型", "陪跑分級", "議題", "區域"):
            raw = fields.get(key)
            value = maps.get(key, {}).get(raw, raw) if raw else raw
            if raw and value != raw:
                fields[key] = value
                log.add("正規化修正", f"{org_id} {key}：{raw!r} → {value!r}")
        raw = row.get("桑基圖上架", "")
        mapped = maps.get("桑基圖上架", {}).get(raw)
        fields["桑基圖上架"] = mapped if isinstance(mapped, bool) else None
        if raw and fields["桑基圖上架"] is None:
            log.add("未知類別值", f"{org_id} 桑基圖上架：{raw!r} → null")
        elif raw:
            log.add("正規化修正", f"{org_id} 桑基圖上架：{raw!r} → {str(mapped).lower()}")
        city = normalize_city(row.get("縣市", ""), maps)
        fields["縣市"] = city or None
        if city != row.get("縣市", ""):
            log.add("正規化修正", f"{org_id} 縣市：{row['縣市']} → {city}")
        if not fields.get("區域") and city:
            region = next((r for r, cities in maps.get("縣市→區域", {}).items() if city in cities), None)
            fields["區域"] = region
            if region:
                log.add("正規化修正", f"{org_id} 區域：依 {city} 推導為 {region}")
        raw = row.get("全職人數", "")
        match = re.search(r"\d+", raw)
        fields["全職人數"] = int(match.group()) if match else None
        if raw and str(fields["全職人數"]) != raw:
            log.add("正規化修正", f"{org_id} 全職人數：{raw!r} → {fields['全職人數']}")
        orgs[org_id] = {"id": org_id, "name": row["name"] or org_id, "fields": fields,  # 官方資料沒有名稱欄時用編號顯示
                        "missing": (["name"] if not row["name"] else [])
                        + [k for k, v in fields.items() if v is None]}
    seen_ids = set()
    for name, id_field, kind in (("contacts", "record_id", "contact"), ("notes", "note_id", "note")):
        for number, row in tables[name]["rows"]:
            record_id = row[id_field] or f"{tables[name]['spec']['id_prefix']}{number:04d}"
            if not row[id_field]:
                log.add("正規化修正", f"{name} 資料列 {number} 缺 {id_field} → {record_id}")
            if record_id in seen_ids:
                raise ValueError(f"紀錄編號重複，無法可靠引用：{record_id}")
            seen_ids.add(record_id)
            guessed = None
            if not row["org_id"] and row.get("org_name"):
                guessed = guess_org(row["org_name"], orgs)
                if guessed:
                    row["org_id"] = guessed
                    log.add("正規化修正", f"{record_id} 沒填組織編號，依自填名稱「{row['org_name']}」推定為 "
                            f"{guessed}（{orgs[guessed]['name']}），請人工確認")
            if row["org_id"] not in orgs:
                log.add("資料問題", f"{record_id} 組織編號 {row['org_id']!r} 不存在於 orgs；不併入組織")
            record = {"id": record_id, "org_id": row["org_id"],
                      "date": normalized_date(row["date"], config, log, record_id),
                      "kind": kind, "type": row.get("type") if kind == "contact" else "顧問筆記",
                      "activity": row.get("activity", row.get("occasion")) or None,
                      "title": row.get("title") or None, "author": row.get("author") or None,
                      "source": row.get("source") if kind == "contact" else "顧問筆記",
                      "text": row["text"] or None, "duplicate_of": None}
            if guessed:
                record["org_guess"] = f"報名表沒填組織編號，系統依自填名稱「{row['org_name']}」推定歸戶，請確認"
            for field, category in (("type", "接觸類型"), ("source", "資料來源")):
                raw = record[field]
                value = maps.get(category, {}).get(raw, raw) or None
                record[field] = value
                if raw and raw != value:
                    log.add("正規化修正", f"{record_id} {category}：{raw} → {value}")
            records.append(record)
    for table, number, category, value in unknown_categories(tables, config, rules):
        log.add("未知類別值", f"{table} 資料列 {number}／{category}：{value!r}；保留原值，請補 mapping")
    mark_duplicates(records, log)
    return orgs, records


def guess_org(name, orgs):
    """報名表只填組織名稱時，用字元二元組重疊比對組織名稱；有明顯最佳者才回傳。"""
    def grams(s):
        s = re.sub(r"（[^）]*）|\([^)]*\)|[\s\W_]+", "", s.replace("臺", "台"))
        return {s[i:i + 2] for i in range(len(s) - 1)}
    target = grams(name)
    if not target:
        return None
    scored = sorted(((len(target & grams(o["name"])) / len(target), oid) for oid, o in orgs.items()), reverse=True)
    best = scored[0]
    second = scored[1][0] if len(scored) > 1 else 0
    return best[1] if best[0] >= 0.3 and best[0] > second else None


def dedupe_text(value):
    # 比對重複時忽略空白與標點（同一則紀錄被不同系統各記一次，常只差在句尾標點）
    return re.sub(r"[\s\W_]+", "", value or "")


def mark_duplicates(records, log):
    groups = defaultdict(list)
    for record in records:
        if not record["date"] or not record["org_id"]:
            continue
        key = (record["org_id"], record["date"], record["kind"], record["type"])
        text = dedupe_text(record["text"])
        for earlier in groups[key]:
            previous = dedupe_text(earlier["text"])
            if text == previous or (text and previous and (text in previous or previous in text)):
                record["duplicate_of"] = earlier["duplicate_of"] or earlier["id"]
                log.add("重複紀錄", f"{record['id']} → duplicate_of={record['duplicate_of']}；"
                        f"{record['org_id']}／{record['date']}／{record['type']}")
                break
        groups[key].append(record)


def record_evidence(record, quote=None):
    return {"record_id": record["id"], "date": record["date"], "kind": record["kind"],
            "type": record["type"], "source": record["source"],
            "quote": quote if quote is not None else (record["text"] or "")[:40]}


def unique_evidence(evidence):
    return list({json.dumps(e, sort_keys=True, ensure_ascii=False): e for e in evidence}.values())


def load_signals(path, no_ai, orgs, records, tags, log, source=None):
    index = {r["id"]: r for r in records}
    signals = defaultdict(list)
    counts = {"ai_valid": 0, "ai_dropped": 0, "keyword": 0}
    covered = set()
    # signals.json 是哪個資料來源跑出來的（run.sh 抽取成功後寫入）；換資料後舊標籤不採用，改用 keyword 備案
    marker = path.with_name("signals_source.txt")
    signal_source = marker.read_text(encoding="utf-8").strip() if marker.exists() else None
    if not no_ai and path.exists() and source and signal_source != source:
        log.add("AI 來源", f"signals.json 來自資料源「{signal_source or '未知'}」，不是本次的「{source}」；"
                f"先用 keyword 備案，跑 bash scripts/extract/run.sh --source {source} 後就會改用 AI 標籤")
        no_ai = True
    if not no_ai and path.exists():
        try:
            payload = read_json(path)
            if (not isinstance(payload, dict) or not isinstance(payload.get("covered_orgs"), list)
                    or not all(isinstance(v, str) for v in payload["covered_orgs"])
                    or not isinstance(payload.get("signals"), list)):
                raise ValueError("須有 covered_orgs 字串陣列及 signals 陣列")
        except (ValueError, UnicodeError) as exc:
            log.add("AI 來源", f"signals.json 無法讀取：{exc}；全體改用 keyword")
        else:
            covered = set(payload["covered_orgs"]) & orgs.keys()
            for number, signal in enumerate(payload["signals"], 1):
                reason = None
                if not isinstance(signal, dict):
                    reason = "標籤不是物件"
                elif not isinstance(signal.get("org_id"), str) or signal["org_id"] not in orgs:
                    reason = "組織不存在"
                elif not isinstance(signal.get("tag"), str) or signal["tag"] not in tags:
                    reason = "未知標籤"
                elif (not isinstance(signal.get("record_ids"), list) or not signal["record_ids"]
                      or not all(isinstance(v, str) for v in signal["record_ids"])):
                    reason = "record_ids 須為非空的字串陣列"
                elif any(rid not in index for rid in signal["record_ids"]):
                    reason = "引用紀錄不存在"
                elif any(index[rid]["org_id"] != signal["org_id"] for rid in signal["record_ids"]):
                    reason = "引用紀錄不屬於該組織"
                elif any(index[rid]["duplicate_of"] for rid in signal["record_ids"]):
                    reason = "引用重複紀錄（不計入規則）"
                elif not isinstance(signal.get("quote"), str) or not compact(signal["quote"]):
                    reason = "quote 為空或不是字串"
                elif not any(compact(signal["quote"]) in compact(index[rid]["text"])
                             for rid in signal["record_ids"]):
                    reason = "quote 不是引用紀錄原文的子字串"
                if reason:
                    counts["ai_dropped"] += 1
                    log.add("丟掉的 AI 標籤", f"第 {number} 筆 {signal!r}；原因：{reason}")
                    continue
                evidence = [record_evidence(index[rid], signal["quote"]
                            if compact(signal["quote"]) in compact(index[rid]["text"])
                            else None) for rid in dict.fromkeys(signal["record_ids"])]
                signals[signal["org_id"]].append({"tag": signal["tag"], "evidence": evidence,
                    "quote_ids": {rid for rid in signal["record_ids"]
                                  if compact(signal["quote"]) in compact(index[rid]["text"])}, "method": "ai"})
                counts["ai_valid"] += 1
            log.add("AI 來源", f"covered_orgs 有 {len(covered)} 家現存組織；"
                    "覆蓋內無通過標籤時不自行補 keyword。")
    else:
        log.add("AI 來源", "--no-ai：全體使用 keyword" if no_ai else "沒有 signals.json：全體使用 keyword")
    grouped = defaultdict(list)
    for record in records:
        if record["org_id"] in orgs and record["text"] and not record["duplicate_of"]:
            grouped[record["org_id"]].append(record)
    for org_id in orgs.keys() - covered:
        for tag, spec in tags.items():
            evidence = []
            for record in grouped[org_id]:
                sentences = re.findall(r"[^。！？\n]+[。！？]?", record["text"])
                quote = next((s.strip() for s in sentences
                              if any(k in s for k in spec["keywords"])), None)
                if quote:
                    evidence.append(record_evidence(record, quote))
            if evidence:
                signals[org_id].append({"tag": tag, "evidence": evidence, "method": "keyword",
                                       "quote_ids": {e["record_id"] for e in evidence}})
                counts["keyword"] += 1
    return signals, counts


class Detector:
    """One rule evaluation; detect returns (hit, evidence), methods tracks provenance."""

    def __init__(self, fields, records, signals, ref_date):
        self.fields = fields
        self.records = [r for r in records if not r["duplicate_of"]]
        self.contacts = [r for r in self.records if r["kind"] == "contact"]
        self.signals = signals
        self.ref_date = ref_date
        self.methods = set()

    def within(self, value, months):
        return bool(value and months_before(self.ref_date, months).isoformat()
                    <= value <= self.ref_date.isoformat())

    def detect(self, node):
        before = self.methods.copy()
        hit, evidence = self._detect(node)
        if not hit:
            self.methods = before
        return hit, unique_evidence(evidence) if hit else []

    def _detect(self, node):
        kind = node["type"]
        if kind in ("all", "any"):
            results = [self.detect(child) for child in node["of"]]
            hit = (all if kind == "all" else any)(result[0] for result in results)
            return hit, [e for matched, evidence in results if matched for e in evidence]
        if kind == "field_is":
            value = self.fields.get(node["field"])
            candidates = node["in"] if "in" in node else [node["equals"]]
            # 0 不等於 false；缺值不能被當成否或非會員。
            hit = value is not None and any(type(value) is type(v) and value == v for v in candidates)
            return hit, [{"field": node["field"], "value": value}]
        if kind == "contact_count":
            matched = [r for r in self.contacts if r["type"] in node["contact_types"]
                       and (not node.get("activity_keywords") or any(
                           k in (r["activity"] or "") for k in node["activity_keywords"]))
                       and ("within_months" not in node or self.within(r["date"], node["within_months"]))]
            return len(matched) >= node["min"], [record_evidence(r, r["activity"] or (r["text"] or "")[:40])
                                               for r in matched]
        if kind == "absent_recent_years":
            first = self.ref_date.year - node["years"] + 1
            typed = [r for r in self.contacts if r["type"] in node["contact_types"]]
            if any(not r["date"] for r in typed):
                return False, []  # 日期未知，不能斷言這幾年沒有出席。
            matched = [r for r in typed if first <= int(r["date"][:4]) <= self.ref_date.year]
            return not matched, [{"field": "／".join(node["contact_types"]) + f"（{first}–{self.ref_date.year} 年）筆數",
                                  "value": len(matched)}]
        if kind == "spread":
            dated = [r for r in self.contacts if r["date"]]
            hit = (len({r["date"][:4] for r in dated}) >= node["min_distinct_years"]
                   and len(dated) >= node["min_contacts"])
            return hit, [record_evidence(r) for r in dated]
        if kind == "no_contact_months":
            if not self.records:
                return True, [{"field": "接觸與筆記筆數", "value": 0}]
            if any(not r["date"] for r in self.records):
                return False, []  # 不能將日期未知解讀成很久沒聯絡。
            latest = max(self.records, key=lambda r: r["date"])
            return latest["date"] < months_before(self.ref_date, node["months"]).isoformat(), [record_evidence(latest)]
        if kind == "ai_tag":
            evidence = []
            for signal in self.signals:
                if signal["tag"] != node["tag"]:
                    continue
                selected = [e for e in signal["evidence"] if "within_months" not in node
                            or self.within(e["date"], node["within_months"])]
                # 不讓一筆近期的輔助紀錄替舊引文延長有效期。
                if not any(e["record_id"] in signal["quote_ids"] for e in selected):
                    continue
                evidence.extend(selected)
                self.methods.add(signal["method"])
            return bool(evidence), evidence
        raise ValueError(f"未知 detect.type：{kind}")


def weights(evidence, ref_date, rules):
    dated = [date.fromisoformat(e["date"]) for e in evidence if e.get("date")]
    decay = rules["time_decay"]
    if dated:
        latest = max(dated)
        time_weight = next(entry["w"] for entry in decay if entry["max_months"] is None
                           or latest >= months_before(ref_date, entry["max_months"]))
    else:
        time_weight = decay[-1]["w"] if any("record_id" in e for e in evidence) else 1.0
    source_spec = rules["source_weight"]
    source_weight = max((source_spec["consultant_note"] if e.get("kind") == "note"
                         else source_spec["by_contact_type"].get(e.get("type"), source_spec["default"])
                         for e in evidence), default=source_spec["default"])
    return float(time_weight), float(source_weight)


def available_fields(tables, orgs):
    available = {field for name in ("orgs", "contacts") for field in tables[name]["mapping"]
                 if field not in tables[name]["missing"]}
    if "text" not in tables["notes"]["missing"]:
        available.add("text")
    if any(org["fields"].get("區域") for org in orgs.values()):
        available.add("區域")
    # 筆記專用欄位也使用標準名，但 date/type 等接觸規則不以筆記替代。
    available.update(f for f in tables["notes"]["mapping"] if f not in tables["notes"]["missing"]
                     and f not in tables["contacts"]["mapping"])
    return available


def load_feedback(directory, org_ids, config, log):
    feedback = []
    for path in sorted(directory.glob("*.json")):
        try:
            payload = read_json(path)
        except (ValueError, UnicodeError) as exc:
            log.add("資料問題", f"PM 回饋 {path.name} 無法讀取：{exc}")
            continue
        for item in payload if isinstance(payload, list) else [payload]:
            if not isinstance(item, dict) or item.get("org_id") not in org_ids:
                log.add("資料問題", f"PM 回饋 {path.name} 無有效的 org_id：{item!r}")
                continue
            item = dict(item)
            item["date"] = normalized_date(str(item.get("date") or "").strip(), config, log, f"PM 回饋 {path.name}")
            feedback.append(item)
    return sorted(feedback, key=lambda item: item["date"] or "", reverse=True)


def summary(org, rule_index):
    fields = org["fields"]
    size = fields.get("全職人數")
    lines = [f"{org['name'] or org['id']}：{fields.get('議題') or '議題待補'}，"
             f"{fields.get('區域') or '區域待補'}，全職{str(size) + ' 人' if size is not None else '人數待補'}，"
             f"{fields.get('會籍') or '會籍待補'}。"]
    active = [r for r in org["timeline"] if not r["duplicate_of"]]
    if active:
        latest = active[0]
        lines.append(f"最近接觸／筆記：{latest['date'] or '日期待補'}，{latest['type'] or '類型待補'}，"
                     f"{latest['activity'] or '活動未填'}；"
                     + (f"「{(latest['text'] or '').replace(chr(10), ' ')[:30]}」。" if latest["text"] else "未留文字。"))
    else:
        lines.append("尚無接觸或顧問筆記，現況待確認。")
    # 未選情境前，以各情境最大絕對權重排序，同分優先呈現警訊。
    ranked = sorted(org["hits"], key=lambda hit: (
        max(abs(w) for w in rule_index[hit["rule"]]["weights"].values())
        * hit["weight_time"] * hit["weight_source"], hit["kind"] == "warning"), reverse=True)
    lines.append("；".join(f"{hit['label']}：{rule_index[hit['rule']]['action']}" for hit in ranked[:2]) + "。"
                 if ranked else "目前未命中規則訊號，仍需依原始紀錄確認需求。")
    if org["missing"]:
        lines.append("資料缺：" + "、".join(org["missing"]) + "。")
    return lines


def organization_md(org, rule_index, feedback):
    lines = [f"# {md(org['name'] or org['id'])}（{md(org['id'])}）", "", "## 30 秒速覽", ""]
    lines += ["- " + md(s) for s in org["summary_30s"]]
    lines += ["", "## 基本資料", "", "| 欄位 | 值 |", "|---|---|",
              f"| id | {md(org['id'])} |", f"| name | {md(org['name'])} |"]
    lines += [f"| {md(k)} | {md(v)} |" for k, v in org["fields"].items()]
    lines += ["", "## 標籤與警訊", ""]
    for hit in org["hits"]:
        rule = rule_index[hit["rule"]]
        lines += [f"### {hit['rule']} {md(hit['label'])}", "",
                  f"- 類別：{hit['kind']}；行動：{md(rule['action'])}；method：{hit['method']}",
                  f"- 時間權重：{hit['weight_time']}；來源可信度：{hit['weight_source']}"]
        for evidence in hit["evidence"]:
            if "record_id" in evidence:
                lines.append(f"- 證據 [{md(evidence['record_id'])}] {evidence['date'] or '日期未填'} "
                             f"{md(evidence['quote'])}")
            else:
                lines.append(f"- 欄位證據：{md(evidence['field'])}＝{md(evidence['value'])}")
        lines.append("")
    if not org["hits"]:
        lines += ["（尚無）", ""]
    lines += ["## 接觸時間軸", ""]
    contacts = [r for r in org["timeline"] if r["kind"] == "contact"]
    for r in contacts:
        duplicate = f"【重複：{r['duplicate_of']}】" if r["duplicate_of"] else ""
        lines.append(f"- [{md(r['id'])}] {r['date'] or '日期未填'}｜{md(r['type'])}｜"
                     f"{md(r['activity'])}｜{md(r['title'])}｜{md(r['source'])}：{md(r['text'])}{duplicate}")
    if not contacts:
        lines.append("（尚無）")
    lines += ["", "## 顧問筆記", ""]
    notes = [r for r in org["timeline"] if r["kind"] == "note"]
    for r in notes:
        duplicate = f"【重複：{r['duplicate_of']}】" if r["duplicate_of"] else ""
        lines.append(f"- [{md(r['id'])}] {r['date'] or '日期未填'}｜{md(r['author'])}｜"
                     f"{md(r['activity'])}：{md(r['text'])}{duplicate}")
    if not notes:
        lines.append("（尚無）")
    lines += ["", "## PM 回饋", ""]
    for item in feedback:
        lines.append(f"- {item.get('date') or '日期未填'}｜{md(item.get('by'))}｜{md(item.get('verdict'))}｜"
                     f"{md(item.get('reason_code'))}：{md(item.get('note'))}")
    if not feedback:
        lines.append("（尚無）")
    return "\n".join(lines) + "\n"


def rules_md(rules):
    lines = ["# 判斷標準", "", "> 由 build.py 自動產生，請改 rules.json。", "", "## 通用原則", ""]
    lines += ["- " + p for p in rules["principles"]]
    lines += ["- 硬條件用於需求篩選；缺值應標註並依 conditions.json 處理。軟訊號提供加減分依據。",
              "- 本建置保留全部有效組織，不因負面訊號剔除；後續名單由需求與篩選引擎決定。",
              "- requires 使用標準欄位名；text 可來自接觸或筆記。缺欄位停用規則，個別缺值不視為否。",
              "- 近期區間：參考日減日曆月份（月底取該月末日），起訖日均含；缺日期不算近期。",
              "- 缺席按參考日所在年度往前計算；無接觸與缺席不等於已證實停止運作。",
              "- 無日期紀錄不自動判重；如有相關未定日期紀錄，不判定長期未接觸或連年缺席。",
              "- 30 秒速覽依各情境最大絕對權重乘時間與來源權重選 1–2 條，同分優先顯示警訊。", "",
              "### 時間加權", "", "依證據最新日期決定；只有欄位證據為 1.0，紀錄證據全部缺日期採最低一級。", ""]
    previous = 0
    for entry in rules["time_decay"]:
        limit = entry["max_months"]
        label = f"{previous} 個月以上" if limit is None else f"{previous}–{limit} 個月（含上界）"
        lines.append(f"- {label}：{entry['w']}")
        previous = limit
    lines += ["", "### 來源可信度", "", "同一命中取證據中最高值；儲存管道（例如 LINE）不代替接觸類型。", "",
              f"- 顧問筆記：{rules['source_weight']['consultant_note']}"]
    lines += [f"- {k}：{v}" for k, v in rules["source_weight"]["by_contact_type"].items()]
    lines += [f"- 其他／欄位證據：{rules['source_weight']['default']}", ""]
    for rule in rules["rules"]:
        lines += [f"## {rule['id']} {rule['label']}", "",
                  f"- 訊號：{rule['signal']}", f"- 解讀：{rule['meaning']}",
                  f"- 行動：{rule['action']}", f"- 出處：{rule['origin']}",
                  "- 需要欄位：" + "、".join(rule["requires"]),
                  "- 各情境權重：" + "；".join(f"{k} {v:+g}" for k, v in rule["weights"].items()),
                  "- 偵測：`" + json.dumps(rule["detect"], ensure_ascii=False) + "`", ""]
    return "\n".join(lines)


def build(config, source, rules, conditions, no_ai=False):
    log = BuildLog()
    tables = load_tables(config, source)
    orgs, records = normalize(tables, config, rules, log)
    if not orgs:
        raise ValueError("沒有可建立的組織，請先跑 profile.py 確認檔案和組織編號欄位")
    dates = [date.fromisoformat(r["date"]) for r in records if r["date"]]
    if config["ref_date"] == "auto":
        if not dates:
            raise ValueError("沒有可解析的接觸或筆記日期；請在 columns.json 設定固定 ref_date")
        ref_date = max(dates)
    else:
        ref_date = parse_date(config["ref_date"], config["date_formats"])
        if ref_date is None:
            raise ValueError("columns.json 的 ref_date 無法解析")
    available = available_fields(tables, orgs)
    missing = sorted({field for table in tables.values() for field in table["missing"]} - available)
    disabled = [{"id": rule["id"], "reason": "缺欄位：" + "、".join(
        f for f in rule["requires"] if f not in available)} for rule in rules["rules"]
        if any(f not in available for f in rule["requires"])]
    for item in disabled:
        log.add("停用規則", f"{item['id']}：{item['reason']}")
    disabled_ids = {item["id"] for item in disabled}
    tags = {k: v for k, v in rules["ai_tags"].items() if not k.startswith("_")}
    signals, signal_counts = load_signals(ROOT / "output/signals.json", no_ai, orgs, records, tags, log, source)
    feedback = load_feedback(ROOT / "data/feedback", orgs.keys(), config, log)
    grouped, grouped_feedback = defaultdict(list), defaultdict(list)
    for record in records:
        grouped[record["org_id"]].append(record)
    for item in feedback:
        grouped_feedback[item["org_id"]].append(item)
    rule_index = {r["id"]: r for r in rules["rules"]}
    texts = []
    for org_id, org in orgs.items():
        timeline = sorted(grouped[org_id], key=lambda r: r["date"] or "", reverse=True)
        active = [r for r in timeline if not r["duplicate_of"]]
        contacts = [r for r in active if r["kind"] == "contact"]
        org["timeline"] = [{k: v for k, v in r.items() if k != "org_id"} for r in timeline]
        org["stats"] = {"contacts": len(contacts), "notes": sum(r["kind"] == "note" for r in active),
                        "last_contact": max((r["date"] for r in active if r["date"]), default=None),
                        "by_type": dict(sorted(Counter(r["type"] or "（未填）" for r in contacts).items())),
                        "sources": sorted({r["source"] for r in active if r["source"]})}
        org["hits"] = []
        for rule in rules["rules"]:
            if rule["id"] in disabled_ids:
                continue
            detector = Detector({"id": org_id, "name": org["name"], **org["fields"]},
                                active, signals[org_id], ref_date)
            hit, evidence = detector.detect(rule["detect"])
            if hit:
                wt, ws = weights(evidence, ref_date, rules)
                org["hits"].append({"rule": rule["id"], "label": rule["label"], "kind": rule["kind"],
                                    "evidence": evidence, "weight_time": wt, "weight_source": ws,
                                    "method": "ai" if "ai" in detector.methods else
                                    "keyword" if "keyword" in detector.methods else "structured"})
        org["summary_30s"] = summary(org, rule_index)
        org["md_path"] = f"orgs/{org_id}.md"
        texts.append({"org_id": org_id, "name": org["name"], "records": [
            {k: r[k] for k in ("id", "date", "kind", "type", "activity", "text")}
            for r in active if r["text"]]})
    meta = {"source": source, "ref_date": ref_date.isoformat(),
            "built_at": datetime.now(timezone.utc).isoformat(),
            "counts": {"orgs": len(orgs), "contacts": len(tables["contacts"]["rows"]),
                       "notes": len(tables["notes"]["rows"]),
                       "duplicates": sum(bool(r["duplicate_of"]) for r in records)},
            "missing_fields": missing, "disabled_rules": disabled, "signals": signal_counts}
    result = {"meta": meta, "orgs": list(orgs.values())}
    demands_path = ROOT / "data/demands/sample_demands.json"
    bundle = {"orgs": result, "rules": rules, "conditions": conditions,
              "demands": read_json(demands_path) if demands_path.exists() else [], "feedback": feedback}
    write_json(ROOT / "output/orgs.json", result)
    write_json(ROOT / "output/texts_for_ai.json", texts)
    write_text(ROOT / "output/bundle.js", "window.APP_DATA = " + json.dumps(bundle, ensure_ascii=False) + ";\n")
    for org in orgs.values():
        write_text(ROOT / "output" / org["md_path"], organization_md(org, rule_index, grouped_feedback[org["id"]]))
    write_text(ROOT / "output/build_log.md", log.render(meta))
    print_utf8(f"完成：{source}／參考日 {ref_date}；{len(orgs)} 份組織 MD；"
               f"接觸 {meta['counts']['contacts']}、筆記 {meta['counts']['notes']}、重複 {meta['counts']['duplicates']}。\n"
               f"停用規則 {len(disabled)}；AI 通過 {signal_counts['ai_valid']}、丟棄 {signal_counts['ai_dropped']}；"
               f"keyword {signal_counts['keyword']} 組。詳見 output/build_log.md。")
    return result


def main():
    parser = argparse.ArgumentParser(description="建立組織速覽與規則證據")
    parser.add_argument("--source", choices=("mock", "drill", "official"))
    parser.add_argument("--no-ai", action="store_true")
    args = parser.parse_args()
    config = read_json(ROOT / "config/columns.json")
    build(config, args.source or config["source"], read_json(ROOT / "rules/rules.json"),
          read_json(ROOT / "rules/conditions.json"), args.no_ai)


if __name__ == "__main__":
    main()
