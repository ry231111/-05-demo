"""Inspect source CSVs before building: python scripts/profile.py [--source official]."""

import argparse
import sys
from collections import Counter

sys.dont_write_bytecode = True

from _common import (ROOT, load_tables, md, parse_date, print_utf8, read_json,
                     unknown_categories, write_text)


def profile(config, source, rules):
    tables = load_tables(config, source)
    lines = ["# 資料健檢", "", f"資料源：{source}", ""]
    suggestions = []
    for name, table in tables.items():
        assumed = table["spec"].get("assumed", [])
        lines += [f"## {name}", "", f"檔案：{table['path'].relative_to(ROOT).as_posix()}",
                  f"資料列數：{len(table['raw'])}", "",
                  "實際欄名：" + "、".join(table["headers"]), "",
                  "| 標準欄位 | 實際欄位 | 狀態 |", "|---|---|---|"]
        if not table["path"].exists():
            suggestions.append(f"確認 sources.{source}.files.{name}：檔案不存在。")
        for field, column in table["mapping"].items():
            marker = "（assumed：假設欄位）" if field in assumed else ""
            status = ("缺：未找到欄名" if column is None else "缺：整欄空白") if field in table["missing"] else "可用"
            lines.append(f"| {field}{marker} | {md(column)} | {status} |")
            if field in table["missing"]:
                suggestions.append(f"tables.{name}.columns.{field}{marker}：{status}；"
                                   "確認候選欄名或補資料，無資料時保留缺值。")
        lines += ["", "缺少標準欄位：" + ("、".join(
            f + ("（assumed）" if f in assumed else "") for f in table["missing"]) or "無"), "",
            "| 實際欄位 | 非空比例 | 不同非空值數 | 最常見 5 個非空值（次數） |",
            "|---|---:|---:|---|"]
        for column in table["headers"]:
            values = [row[column] for _, row in table["raw"] if row[column]]
            counts = Counter(values)
            ratio = len(values) / len(table["raw"]) if table["raw"] else 0
            top = "；".join(f"{md(v)}（{n}）" for v, n in counts.most_common(5)) or "—"
            lines.append(f"| {md(column)} | {len(values)}/{len(table['raw'])}（{ratio:.1%}） | {len(counts)} | {top} |")
        for field in table["mapping"]:
            if field != "date" and "日期" not in field:
                continue
            values = [row[field] for _, row in table["rows"] if row[field]]
            parsed = [parse_date(v, config["date_formats"]) for v in values]
            dates = [d for d in parsed if d is not None]
            invalid = list(dict.fromkeys(v for v, d in zip(values, parsed) if d is None))
            ratio = len(dates) / len(values) if values else 0
            lines += ["", f"日期欄 {field}：可解析 {len(dates)}/{len(values)}（{ratio:.1%}，分母為非空值）；"
                      + (f"範圍 {min(dates)} ～ {max(dates)}。" if dates else "無可解析日期。"),
                      "無法解析樣本：" + ("、".join(md(v) for v in invalid[:5]) or "無")]
            if invalid:
                suggestions.append(f"date_formats：補上 {name}.{field} 的格式（樣本：{'、'.join(invalid[:5])}）。")
        lines.append("")
    lines += ["## 未知類別值", ""]
    unknown = unknown_categories(tables, config, rules)
    grouped = {}
    for table, number, category, value in unknown:
        grouped.setdefault((table, category, value), []).append(str(number))
    for (table, category, value), numbers in grouped.items():
        shown = "、".join(numbers[:5]) + ("…" if len(numbers) > 5 else "")
        lines.append(f"- {table}／{category}：{md(value)}（{len(numbers)} 列，例如資料列 {shown}）"
                     f" → 在 columns.json 的 value_maps.{category} 加 \"{value}\": \"標準值\"")
    if not unknown:
        lines.append("無。已套用 value_maps，並比對規則中的接觸類型、既知資料來源與縣市清單。")
    for category, value in sorted({(c, v) for _, _, c, v in unknown}):
        suggestions.append(f"value_maps：確認 {category}「{value}」的對應值或新增已知類別。")
    lines += ["", "## 不存在於 orgs 的組織編號", ""]
    org_ids = {r["id"] for _, r in tables["orgs"]["rows"] if r["id"]}
    for name in ("contacts", "notes"):
        orphans = Counter(row["org_id"] or "（空白）" for _, row in tables[name]["rows"]
                          if row["org_id"] not in org_ids)
        lines.append(f"- {name}：" + ("；".join(f"{md(k)}（{v} 筆）" for k, v in orphans.items()) or "無"))
    lines += ["", "## 建議要改 columns.json 的地方", ""]
    lines += ["- " + s for s in suggestions] or ["目前無須調整欄位或值對應。"]
    if "區域" in tables["orgs"]["missing"]:
        lines += ["", "區域原始欄位缺少，但 build 可依「縣市→區域」推導；不必為此更動原始 CSV。"]
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description="資料健檢")
    parser.add_argument("--source", choices=("mock", "drill", "official"))
    args = parser.parse_args()
    config = read_json(ROOT / "config/columns.json")
    report = profile(config, args.source or config["source"], read_json(ROOT / "rules/rules.json"))
    write_text(ROOT / "output/profile.md", report)
    print_utf8(report)


if __name__ == "__main__":
    main()
