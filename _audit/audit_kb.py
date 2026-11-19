# -*- coding: utf-8 -*-
import openpyxl, re, collections, json, sys

F = "应灾知识-数据表.xlsx"
wb = openpyxl.load_workbook(F, read_only=True, data_only=True)

print("== sheets:", wb.sheetnames)

ws = wb["1-官方文件"]
rows = list(ws.iter_rows(values_only=True))
hdr = [str(h).strip() if h is not None else "" for h in rows[0]]
data = [r for r in rows[1:] if any(c is not None and str(c).strip() != "" for c in r)]
print("hdr:", hdr)
print("data rows:", len(data))

def cell(r, name):
    i = hdr.index(name)
    v = r[i] if i < len(r) else None
    return "" if v is None else str(v).strip()

# 1. 空值
print("\n-- 空值统计（按列）")
for h in hdr:
    n = sum(1 for r in data if cell(r, h) == "")
    if n:
        print(f"  {h}: 空 {n} 行")

# 2. 取值分布
print("\n-- 可信程度分布")
c = collections.Counter(cell(r, "可信程度") for r in data)
for k, v in c.most_common():
    print(f"  [{k}] {v}")

print("\n-- 正文是否已收录")
for k, v in collections.Counter(cell(r, "正文是否已收录") for r in data).most_common():
    print(f"  [{k}] {v}")

print("\n-- 层级分布")
for k, v in collections.Counter(cell(r, "层级") for r in data).most_common():
    print(f"  [{k}] {v}")

print("\n-- 适用受众分布")
for k, v in collections.Counter(cell(r, "适用受众") for r in data).most_common():
    print(f"  [{k}] {v}")

print("\n-- 所属章节分布")
for k, v in collections.Counter(cell(r, "所属章节") for r in data).most_common():
    print(f"  [{k}] {v}")

# 3. 编号重复
ids = collections.Counter(cell(r, "编号") for r in data)
dup = {k: v for k, v in ids.items() if v > 1}
print("\n-- 编号重复:", dup if dup else "无")

# 4. 名称+来源重复
key = collections.Counter((cell(r, "名称"), cell(r, "来源名称")) for r in data)
dup2 = {k: v for k, v in key.items() if v > 1}
print("-- 名称+来源重复:", len(dup2))
for k, v in list(dup2.items())[:10]:
    print("   ", v, k[0][:40], "|", k[1][:30])

# 5. 摘抄重复（前30字）
key3 = collections.defaultdict(list)
for i, r in enumerate(data):
    s = re.sub(r"\s+", "", cell(r, "原文摘抄"))
    if len(s) >= 20:
        key3[s[:30]].append((i + 2, cell(r, "编号")))
dup3 = {k: v for k, v in key3.items() if len(v) > 1}
print("-- 摘抄前30字重复组数:", len(dup3))
for k, v in list(dup3.items())[:8]:
    print("   ", k[:30], "->", v[:6])

# 6. 链接
bad, domains = [], collections.Counter()
for r in data:
    u = cell(r, "链接")
    if u == "":
        continue
    if not re.match(r"^https?://", u):
        bad.append((cell(r, "编号"), u[:60]))
    else:
        d = re.sub(r"^https?://", "", u).split("/")[0]
        domains[d] += 1
print("\n-- 链接非法格式:", len(bad))
for x in bad[:10]:
    print("   ", x)
print("-- 域名 TOP10")
for k, v in domains.most_common(10):
    print(f"   {k}: {v}")
# 同域名但路径不同的重复链接
linkc = collections.Counter(cell(r, "链接") for r in data if cell(r, "链接"))
print("-- 完全相同链接重复:", [(k[:50], v) for k, v in linkc.items() if v > 1][:10])

# 7. 获取日期格式
dc = collections.Counter(cell(r, "获取日期") for r in data)
print("\n-- 获取日期取值:", dict(dc))
badd = [cell(r, "获取日期") for r in data if not re.match(r"^\d{4}-\d{2}-\d{2}$", cell(r, "获取日期"))]
print("   非法格式:", badd[:10])

# 8. 摘抄长度异常
short = [(i + 2, cell(r, "编号"), len(re.sub(r"\s+", "", cell(r, "原文摘抄")))) for i, r in enumerate(data) if len(re.sub(r"\s+", "", cell(r, "原文摘抄"))) < 15]
print("\n-- 摘抄少于15字:", short[:15], "共", len(short))
