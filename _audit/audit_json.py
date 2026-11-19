# -*- coding: utf-8 -*-
import json, openpyxl, collections, re

d = json.load(open("应灾知识-离线应答库.json", encoding="utf-8"))
wb = openpyxl.load_workbook("应灾知识-数据表.xlsx", read_only=True, data_only=True)
ws = wb["1-官方文件"]
rs = list(ws.iter_rows(values_only=True))
hdr = [str(h).strip() if h else "" for h in rs[0]]
rows = [dict(zip(hdr, r)) for r in rs[1:] if any(c is not None for c in r)]
ids = set(str(r.get("编号") or "").strip() for r in rows)
id2line = {}
for i, r in enumerate(rows, start=2):
    id2line[str(r.get("编号") or "").strip()] = i

print("源表编号数:", len(ids), "数据行:", len(rows))

def walk_steps(node, acc):
    for k in ("steps", "never_do"):
        for it in node.get(k, []) or []:
            if isinstance(it, dict) and it.get("source_id"):
                acc.append(it["source_id"])

all_ref = []
for sc in d["scenes"]:
    acc = []
    walk_steps(sc, acc)
    for br in sc.get("branches", []) or []:
        walk_steps(br, acc)
        # branch 级 source_id
        if br.get("source_id"):
            acc.append(br["source_id"])
    for s in sc.get("source_ids", []) or []:
        acc.append(s)
    all_ref.extend([(sc["id"], x) for x in acc])

print("\n== source_id 引用总数:", len(all_ref), " 唯一:", len(set(x[1] for x in all_ref)))
missing = sorted(set(x[1] for x in all_ref if x[1] not in ids))
print("-- 在源表编号中找不到的 source_id:", len(missing))
for m in missing:
    owners = sorted(set(a for a, b in all_ref if b == m))
    print("    ", repr(m), "->", owners)

unused = sorted(ids - set(x[1] for x in all_ref))
print("-- 源表有但库中未引用的编号:", len(unused))
print("    前30:", unused[:30])

print("\n== 每场景 steps 数分布（设计原则：3 步以内）")
for sc in d["scenes"]:
    n = len(sc.get("steps") or [])
    nb = len(sc.get("branches") or [])
    nn = len(sc.get("never_do") or [])
    flag = " <<< 超过3步" if n > 3 else ""
    print(f"  {sc['id']:<18} steps={n} never_do={nn} branches={nb} severity={sc.get('severity')} conf={sc.get('confidence')}{flag}")

print("\n== 字段取值")
print("severity:", dict(collections.Counter(sc.get("severity") for sc in d["scenes"])))
print("confidence:", dict(collections.Counter(sc.get("confidence") for sc in d["scenes"])))
print("category:", dict(collections.Counter(sc.get("category") for sc in d["scenes"])))
print("无 notes:", [sc["id"] for sc in d["scenes"] if not sc.get("notes")])

print("\n== 空字段检查")
for sc in d["scenes"]:
    for i, st in enumerate(sc.get("steps") or []):
        if not str(st.get("action") or "").strip():
            print("  steps 空 action:", sc["id"], i)
    for i, nv in enumerate(sc.get("never_do") or []):
        if not str(nv.get("action") or "").strip():
            print("  never_do 空 action:", sc["id"], i)
    if not sc.get("source_ids"):
        print("  source_ids 空:", sc["id"])
    if not sc.get("keywords"):
        print("  keywords 空:", sc["id"])

print("\n== 关键词冲突（同一词命中多场景）")
kw = collections.defaultdict(set)
for sc in d["scenes"]:
    for k in sc.get("keywords") or []:
        kw[k.strip()].add(sc["id"])
conf = {k: v for k, v in kw.items() if len(v) > 1}
print("  冲突关键词数:", len(conf))
for k, v in list(conf.items())[:20]:
    print(f"    {k!r} -> {sorted(v)}")

qdup = collections.Counter()
for sc in d["scenes"]:
    for q in sc.get("question_variants") or []:
        qdup[q.strip()] += 1
print("  问句重复（跨场景完全同句）:", [(k, v) for k, v in qdup.items() if v > 1][:10])

print("\n== meta 一致性")
print("  total_scenes:", d["meta"].get("total_scenes"), " 实际:", len(d["scenes"]))
print("  generated_at:", d["meta"].get("generated_at"), " status:", d["meta"].get("status"), " version:", d["meta"].get("version"))
