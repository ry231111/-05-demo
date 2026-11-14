"""Shared CSV/configuration helpers; Python 3.12 standard library only."""

import calendar
import csv
import json
import re
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Windows 終端機預設不是 UTF-8，錯誤訊息會變亂碼；統一改成 UTF-8
import sys as _sys
for _stream in (_sys.stdout, _sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def write_json(path, value):
    write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def compact(value):
    return re.sub(r"\s+", "", value or "")


def md(value):
    if value is None or value == "":
        return "—（缺）"
    if isinstance(value, bool):
        return "是" if value else "否"
    return (str(value).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace("|", "&#124;")
            .replace("\n", "<br>").replace("\r", ""))


def load_tables(config, source):
    source_config = config["sources"][source]
    tables = {}
    for name, spec in config["tables"].items():
        path = ROOT / source_config["dir"] / source_config["files"][name]
        rows, headers = [], []
        if path.exists():
            with path.open(encoding="utf-8-sig", newline="") as stream:
                reader = csv.reader(stream, skipinitialspace=True)
                # 跳過 Sheet 上方的標題列／說明列：至少兩格有字才當欄名列
                for header in reader:
                    if sum(1 for cell in header if cell.strip()) >= 2:
                        headers = [cell.strip() for cell in header]
                        break
                if len(headers) != len(set(headers)):
                    raise ValueError(f"{path.name} 有重複欄名，請先確認欄位對應")
                for row_number, cells in enumerate(reader, 1):
                    cells = [cell.strip() for cell in cells]
                    if not any(cells):
                        continue
                    if len(cells) > len(headers):
                        raise ValueError(f"{path.name} 資料列 {row_number} 欄數超過標頭")
                    row = dict(zip(headers, cells + [""] * (len(headers) - len(cells))))
                    rows.append((row_number, row))
        mapping = {field: next((c for c in candidates if c in headers), None)
                   for field, candidates in spec["columns"].items()}
        missing = [field for field, column in mapping.items()
                   if column is None or not any(row[column] for _, row in rows)]
        tables[name] = {"path": path, "headers": headers, "mapping": mapping,
                        "missing": missing, "raw": rows, "spec": spec,
                        "rows": [(number, {f: row.get(c, "") for f, c in mapping.items()})
                                 for number, row in rows]}
    return tables


def parse_date(value, formats):
    if not value:
        return None
    for fmt in formats:
        try:
            if fmt == "ROC":
                match = re.fullmatch(r"(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})", value)
                if not match:
                    continue
                year, month, day = map(int, match.groups())
                return date(year + 1911 if year < 200 else year, month, day)
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def months_before(day, months):
    year, month = divmod(day.year * 12 + day.month - 1 - months, 12)
    month += 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def normalize_city(value, maps):
    value = value.replace("臺", "台")
    return maps.get("縣市別名", {}).get(value, value)


def known_categories(config, rules):
    maps = config["value_maps"]
    types = set(rules["source_weight"]["by_contact_type"])

    def collect(node):
        types.update(node.get("contact_types", []))
        for child in node.get("of", []):
            collect(child)

    for rule in rules["rules"]:
        collect(rule["detect"])
    return {
        "接觸類型": types | set(maps.get("接觸類型", {}).values()),
        # 紙本為專案資料契約中的既知管道，無須另造 mapping。
        "資料來源": {"Ragic", "SharePoint", "Google表單", "LINE", "Email", "紙本"}
                      | set(maps.get("資料來源", {}).values()),
        "縣市": {city for cities in maps.get("縣市→區域", {}).values() for city in cities},
        "會籍": {"會員", "準會員", "非會員"} | set(maps.get("會籍", {}).values()),
        "財報類型": {"自行編製", "會計師簽證", "未提供"} | set(maps.get("財報類型", {}).values()),
        "區域": set(maps.get("縣市→區域", {})) | set(maps.get("區域", {}).values()),
    }


def unknown_categories(tables, config, rules):
    known = known_categories(config, rules)
    result = []
    for table, field, category in (("orgs", "縣市", "縣市"), ("orgs", "會籍", "會籍"),
                                   ("orgs", "財報類型", "財報類型"), ("orgs", "區域", "區域"),
                                   ("contacts", "type", "接觸類型"),
                                   ("contacts", "source", "資料來源")):
        for number, row in tables[table]["rows"]:
            value = row.get(field, "")
            normalized = (normalize_city(value, config["value_maps"]) if category == "縣市"
                          else config["value_maps"].get(category, {}).get(value, value))
            if value and normalized not in known[category]:
                result.append((table, number, category, value))
    return result


def print_utf8(text):
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(text)
