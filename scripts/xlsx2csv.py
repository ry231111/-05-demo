"""把 Google Sheet 下載的 .xlsx 每個分頁轉成 CSV（只用標準函式庫）。

用法：python scripts/xlsx2csv.py 好事_官方假資料.xlsx data/official
輸出：data/official/{分頁名稱}.csv（UTF-8 with BOM，Excel 打開不會亂碼）
"""
import csv, re, sys, zipfile, datetime
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def date_style_ids(z):
    """回傳屬於日期格式的 cell style 索引集合。"""
    try:
        root = ET.fromstring(z.read("xl/styles.xml"))
    except KeyError:
        return set()
    custom = {}
    for nf in root.findall("m:numFmts/m:numFmt", NS):
        custom[int(nf.get("numFmtId"))] = nf.get("formatCode", "")
    builtin_dates = set(range(14, 23)) | {45, 46, 47}
    ids = set()
    for i, xf in enumerate(root.findall("m:cellXfs/m:xf", NS)):
        fid = int(xf.get("numFmtId", 0))
        code = custom.get(fid, "")
        if fid in builtin_dates or (code and re.search(r"[yd]", re.sub(r'"[^"]*"|\[[^\]]*\]', "", code), re.I)):
            ids.add(i)
    return ids


def main(xlsx, outdir):
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    z = zipfile.ZipFile(xlsx)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    dates = date_style_ids(z)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    for sh in wb.findall("m:sheets/m:sheet", NS):
        name = sh.get("name")
        target = rels[sh.get(REL)].lstrip("/")
        path = target if target.startswith("xl/") else "xl/" + target
        root = ET.fromstring(z.read(path))
        rows = []
        for row in root.findall("m:sheetData/m:row", NS):
            r = int(row.get("r")) - 1
            while len(rows) < r:
                rows.append([])
            vals = []
            for c in row.findall("m:c", NS):
                i = col_index(c.get("r"))
                t = c.get("t")
                v = c.find("m:v", NS)
                if t == "s":
                    val = shared[int(v.text)] if v is not None else ""
                elif t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
                elif t == "b":
                    val = "TRUE" if v is not None and v.text == "1" else "FALSE"
                else:
                    val = v.text if v is not None else ""
                    if val and c.get("s") and int(c.get("s")) in dates:
                        try:
                            d = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=float(val))
                            val = d.strftime("%Y-%m-%d") if d.time() == datetime.time() else d.strftime("%Y-%m-%d %H:%M:%S")
                        except ValueError:
                            pass
                    elif re.fullmatch(r"-?\d+\.0", val or ""):
                        val = val[:-2]
                while len(vals) < i:
                    vals.append("")
                vals.append(val)
            rows.append(vals)
        while rows and not any(x.strip() for x in rows[-1]):
            rows.pop()
        safe = re.sub(r'[\\/:*?"<>|]', "_", name)
        with open(out / f"{safe}.csv", "w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f).writerows(rows)
        print(f"{safe}.csv  {len(rows)} 列")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1], sys.argv[2])
