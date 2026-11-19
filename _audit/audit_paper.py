# -*- coding: utf-8 -*-
import openpyxl, re, collections, json

wb = openpyxl.load_workbook("应急论文库.xlsx", read_only=True, data_only=True)
print("== 应急论文库 sheets:", wb.sheetnames)

def dump(name, maxrow=100, width=38):
    ws = wb[name]
    rs = list(ws.iter_rows(values_only=True))
    print("\n===== %s rows=%d" % (name, len(rs)))
    for i, r in enumerate(rs[:maxrow]):
        vals = ["" if c is None else re.sub(r"\s+", " ", str(c))[:width] for c in r]
        while vals and vals[-1] == "":
            vals.pop()
        print(f"{i+1:>3}| " + " | ".join(vals))

for n in ["0-说明", "1-论文主表", "3-场景对照", "5-待决事项"]:
    dump(n)

# 4-待下载清单 只统计
ws = wb["4-待下载清单"]
rs = list(ws.iter_rows(values_only=True))
print("\n===== 4-待下载清单 rows=%d" % len(rs))
hdr = [str(h).strip() if h else "" for h in rs[0]]
print("hdr:", hdr)
for i, r in enumerate(rs[1:], start=2):
    vals = ["" if c is None else re.sub(r"\s+", " ", str(c))[:26] for c in r]
    while vals and vals[-1] == "":
        vals.pop()
    print(f"{i:>3}| " + " | ".join(vals))
