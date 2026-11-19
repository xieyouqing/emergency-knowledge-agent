# -*- coding: utf-8 -*-
"""清洗离线库 SQLite：与 JSON 同步拆分「煤气」关键词，并复检 source_audit。"""
import sqlite3, shutil, os, json, collections

os.makedirs("19日18.40-清洗版", exist_ok=True)
OUT = os.path.join("19日18.40-清洗版", "应灾知识-离线应答库.db")
shutil.copy("应灾知识-离线应答库.db", OUT)

NEW = {
    "gas_leak": ["煤气泄漏", "燃气泄漏", "漏气", "煤气味", "燃气味", "漏煤气", "燃气"],
    "co_poisoning": ["一氧化碳", "CO", "煤气中毒", "烧炭", "炭火", "取暖", "炉子",
                     "煤炉", "煤烟", "头晕恶心", "中毒"],
}
c = sqlite3.connect(OUT)
for sid, kws in NEW.items():
    c.execute("update scenes set keywords=? where id=?", (json.dumps(kws, ensure_ascii=False), sid))
c.commit()

print("== 复检 db")
rows = list(c.execute("select id,keywords from scenes"))
print("场景数:", len(rows))
print("仍含裸词「煤气」的场景:", [i for i, k in rows if '"煤气"' in (k or "")] or "无")
kw = collections.defaultdict(set)
for i, k in rows:
    for x in json.loads(k or "[]"):
        kw[x].add(i)
print("关键词冲突:", {k: v for k, v in kw.items() if len(v) > 1} or "无")

sa = list(c.execute("select scene_id,source_id,cred,source_name,quote,url from source_audit"))
print("source_audit 行数:", len(sa))
print("cred 分布:", dict(collections.Counter(r[2] for r in sa)))
print("空 quote:", [r[:2] for r in sa if not (r[4] or "").strip()])
print("quote<10字:", [(r[0], r[1], r[4]) for r in sa if len((r[4] or "").strip()) < 10])
print("空 url:", [(r[0], r[1]) for r in sa if not (r[5] or "").strip().startswith("http")])
sid_set = {r[0] for r in rows}
print("source_audit 中场景不在 scenes:", sorted({r[0] for r in sa} - sid_set) or "无")

j = json.load(open("19日18.40-清洗版/应灾知识-离线应答库.json", encoding="utf-8"))
jmap = {s["id"]: s for s in j["scenes"]}
mismatch = [i for i, k in rows if json.loads(k or "[]") != jmap[i]["keywords"]]
print("db 与 json 关键词仍不一致:", mismatch or "无")
c.close()
print("\n已写出:", OUT)
