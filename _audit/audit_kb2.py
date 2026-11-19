# -*- coding: utf-8 -*-
import openpyxl, re, collections

F = "应灾知识-数据表.xlsx"
wb = openpyxl.load_workbook(F, read_only=True, data_only=True)

def dump(name, maxrow=None, width=40):
    ws = wb[name]
    rows = list(ws.iter_rows(values_only=True))
    print("\n===== ", name, " rows=", len(rows))
    for i, r in enumerate(rows):
        if maxrow and i > maxrow:
            break
        vals = ["" if c is None else re.sub(r"\s+", " ", str(c))[:width] for c in r]
        while vals and vals[-1] == "":
            vals.pop()
        print(f"{i+1:>3}| " + " | ".join(vals))

# 1-官方文件 空值行
ws = wb["1-官方文件"]
rows = list(ws.iter_rows(values_only=True))
hdr = [str(h).strip() if h else "" for h in rows[0]]
print("-- 备注为空的行")
for i, r in enumerate(rows[1:], start=2):
    d = dict(zip(hdr, r))
    if not d.get("备注"):
        print(f"   行{i}: {d.get('编号')} | 名称={str(d.get('名称'))[:30]}")
print("-- 借鉴点为空的行")
for i, r in enumerate(rows[1:], start=2):
    d = dict(zip(hdr, r))
    if not d.get("借鉴点"):
        print(f"   行{i}: {d.get('编号')} | {str(d.get('名称'))[:30]}")

print("\n-- 摘抄过短的行详情")
for i, r in enumerate(rows[1:], start=2):
    d = dict(zip(hdr, r))
    s = re.sub(r"\s+", "", str(d.get("原文摘抄") or ""))
    if len(s) < 15:
        print(f"   行{i} {d.get('编号')} 摘抄={s!r} 层级={d.get('层级')} 可信={d.get('可信程度')} 链接={str(d.get('链接'))[:45]}")
        print(f"        内容={str(d.get('内容'))[:60]}  备注={str(d.get('备注'))[:60]}")

dump("2-受众画像", width=45)
dump("3-待验证清单", width=45)
dump("4-链接实测结果", maxrow=20, width=40)
