# -*- coding: utf-8 -*-
import openpyxl, re, collections

wb = openpyxl.load_workbook("应灾知识-数据表.xlsx", read_only=True, data_only=True)

def rows_of(name):
    ws = wb[name]
    rs = list(ws.iter_rows(values_only=True))
    hdr = [str(h).strip() if h else "" for h in rs[0]]
    out = []
    for i, r in enumerate(rs[1:], start=2):
        if not any(c is not None and str(c).strip() for c in r):
            continue
        out.append((i, dict(zip(hdr, r))))
    return hdr, out

# A. 待验证清单一致性
h, tv = rows_of("3-待验证清单")
print("== 3-待验证清单 交叉核查 (n=%d)" % len(tv))
bad = []
for ln, d in tv:
    st = str(d.get("目前状态") or "")
    solved = str(d.get("是否已解决") or "").strip()
    has_ok = "✅" in st
    has_warn = "⚠️" in st or "◐" in st
    if has_ok and not has_warn and solved != "是":
        bad.append((ln, d.get("序号"), "状态含✅但已解决=" + solved, st[:40]))
    if (has_warn) and solved == "是":
        bad.append((ln, d.get("序号"), "状态含⚠️/◐但已解决=是", st[:40]))
    if solved not in ("是", "否"):
        bad.append((ln, d.get("序号"), "已解决取值异常=" + repr(solved), st[:30]))
for b in bad:
    print("   ", b)

print("-- 责任人列非空数:", sum(1 for _, d in tv if str(d.get("责任人") or "").strip()))
print("-- 优先级分布:", dict(collections.Counter(str(d.get("优先级")) for _, d in tv)))
print("-- 已解决分布:", dict(collections.Counter(str(d.get("是否已解决")) for _, d in tv)))
print("-- 所属表分布:", dict(collections.Counter(str(d.get("所属表")) for _, d in tv)))

# B. 链接实测
h4, lk = rows_of("4-链接实测结果")
print("\n== 4-链接实测结果 (n=%d)" % len(lk))
print("-- 判定分布:", dict(collections.Counter(str(d.get("判定")) for _, d in lk)))
print("-- 命中取值分布:", dict(collections.Counter(str(d.get("正文关键内容是否命中")) for _, d in lk)))
bad4 = [(ln, d.get("序号"), d.get("判定")) for ln, d in lk if str(d.get("判定")) != "可用"]
print("-- 非可用条目:", bad4)
badv = [(ln, d.get("序号"), d.get("判定")) for ln, d in lk if str(d.get("判定")) == "可用" and "是" not in str(d.get("正文关键内容是否命中"))]
print("-- 判可用但未命中:", badv)

# C. 链接对齐
h1, kb = rows_of("1-官方文件")
kb_links = collections.Counter(str(d.get("链接")).strip() for _, d in kb if str(d.get("链接") or "").strip() not in ("", "—"))
lk_links = set(str(d.get("链接")).strip() for _, d in lk if str(d.get("链接") or "").strip())
print("\n== 链接对齐")
print("-- 表1 唯一链接数:", len(kb_links), " 表4 唯一链接数:", len(lk_links))
not_tested = [u for u in kb_links if u not in lk_links]
print("-- 表1 引用但表4 未实测的链接数:", len(not_tested))
for u in not_tested[:12]:
    print("    ", u[:95])
dead = {str(d.get("链接")).strip(): str(d.get("判定")) for _, d in lk if str(d.get("判定")) != "可用"}
hit_dead = [(u, dead[u], kb_links[u]) for u in dead if u in kb_links]
print("-- 表4 判非可用但表1 仍在引用的:", hit_dead)
