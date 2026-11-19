# -*- coding: utf-8 -*-
"""清洗后终检：逐条跑验收断言，任意一条为否则非零退出。"""
import openpyxl, json, re, collections, sys, sqlite3, hashlib

FAIL = []
def chk(name, cond, actual):
    print(("  PASS  " if cond else "  FAIL  ") + name + "  →  " + str(actual))
    if not cond:
        FAIL.append(name)

X = "19日18.40-清洗版/应灾知识-数据表.xlsx"
J = "19日18.40-清洗版/应灾知识-离线应答库.json"
DB = "19日18.40-清洗版/应灾知识-离线应答库.db"

wb = openpyxl.load_workbook(X, read_only=True, data_only=True)
ws = wb["1-官方文件"]
rs = list(ws.iter_rows(values_only=True))
hdr = [str(h).strip() if h else "" for h in rs[0]]
rows = [dict(zip(hdr, r)) for r in rs[1:] if any(c is not None and str(c).strip() for c in r)]
print("== 应灾知识-数据表.xlsx（%d 行数据）" % len(rows))

chk("数据行 = 280", len(rows) == 280, len(rows))
ids = collections.Counter(str(r["编号"]).strip() for r in rows)
chk("编号唯一无重复", all(v == 1 for v in ids.values()), len(ids))
c = collections.Counter(str(r["可信程度"]).strip() for r in rows)
chk("可信程度 187/88/3/2 不变",
    (c["官方原文"], c["只有一家"], c["两家一致"], c["自己判断"]) == (187, 88, 3, 2), dict(c))
c2 = collections.Counter(str(r["正文是否已收录"]).strip() for r in rows)
chk("正文收录 是53/否227 不变", (c2["是"], c2["否"]) == (53, 227), dict(c2))
chks = set(str(r["所属章节"]).strip() for r in rows)
chk("章节唯一值 ≤30", len(chks) <= 30, len(chks))
chkl = set(str(r["层级"]).strip() for r in rows)
chk("层级唯一值 ≤16", len(chkl) <= 16, len(chkl))
ORDER = ["全部受众", "普通社会公众", "基层应急人员", "学校与教育系统", "专业队伍",
         "企业单位", "特殊群体", "有儿童的家庭", "仅医务人员/信息员",
         "患者家属与照护者", "技术开发人员", "不适用"]
tokens = set()
for r in rows:
    for p in str(r["适用受众"]).split("、"):
        tokens.add(p.strip())
chk("受众原子值全部在 12 词表内", tokens <= set(ORDER), sorted(tokens - set(ORDER)) or "0 越界")
bad = [(str(r["编号"]), str(r["链接"])) for r in rows if not str(r["链接"] or "").startswith("http")]
chk("非URL链接仅限空壳行（≤2 且均含「不适用」）",
    len(bad) <= 2 and all("不适用" in u for _, u in bad), bad)
badq = [(str(r["编号"]), str(r["原文摘抄"])) for r in rows
        if str(r["原文摘抄"] or "").strip() in ("", "无", "None")]
chk("空/占位摘抄 = 0", len(badq) == 0, badq or 0)
badd = [(str(r["编号"]), str(r["获取日期"])) for r in rows
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(r["获取日期"] or "").strip())]
chk("获取日期格式全合法", len(badd) == 0, badd or 0)

ws4 = wb["4-链接实测结果"]
r4 = [r for r in ws4.iter_rows(min_row=2, values_only=True) if r and r[0] is not None]
noise = [r[0] for r in r4 if not str(r[0]).strip().isdigit()]
chk("4-链接实测无汇总行残留", len(noise) == 0, noise or 0)
print("      4-链接实测数据行:", len(r4))

ws0 = wb["0-填写说明"]
txt = " ".join(str(c) for c in [x for row in ws0.iter_rows(values_only=True) for x in row] if c)
chk("说明页含清洗记录", "【清洗记录（2026-11-19 18:40）】" in txt, "有" if "清洗记录" in txt else "无")

print("\n== 离线应答库")
d = json.load(open(J, encoding="utf-8"))
chk("场景数 24 且与 meta 一致", len(d["scenes"]) == 24 == d["meta"]["total_scenes"], len(d["scenes"]))
src = set(ids)
refs = set()
for sc in d["scenes"]:
    refs.update(sc.get("source_ids") or [])
    for k in ("steps", "never_do"):
        for it in sc.get(k) or []:
            if it.get("source_id"):
                refs.add(it["source_id"])
    for br in sc.get("branches") or []:
        if br.get("source_id"):
            refs.add(br["source_id"])
        for k in ("steps", "never_do"):
            for it in br.get(k) or []:
                if it.get("source_id"):
                    refs.add(it["source_id"])
chk("source_id 悬空 = 0", not (refs - src), sorted(refs - src) or 0)
chk("引用唯一数 = 181", len(refs) == 181, len(refs))
chk("meta.source_md5 已移除", "source_md5" not in d["meta"], "source_md5" in d["meta"])
chk("meta.source_rows = 280", d["meta"].get("source_rows") == 280, d["meta"].get("source_rows"))
chk("meta.source_ids_sha1 与源表一致",
    d["meta"].get("source_ids_sha1") == hashlib.sha1("\n".join(sorted(src)).encode()).hexdigest(),
    d["meta"].get("source_ids_sha1"))
chk("每场景 steps 均 3 条（≤3 原则）",
    all(len(sc.get("steps") or []) == 3 for sc in d["scenes"]),
    sorted({len(sc.get("steps") or []) for sc in d["scenes"]}))

db = sqlite3.connect(DB)
print("\n== 离线应答库.db")
chk("db 场景数 24", db.execute("select count(*) from scenes").fetchone()[0] == 24, 24)
jm = {s["id"]: s["keywords"] for s in d["scenes"]}
mism = [i for i, k in db.execute("select id,keywords from scenes") if json.loads(k or "[]") != jm[i]]
chk("db 与 json 关键词 diff = 0", not mism, mism or 0)
chk("db source_audit 190 行", db.execute("select count(*) from source_audit").fetchone()[0] == 190, 190)
db.close()

print("\n" + ("全部通过" if not FAIL else "失败项: " + str(FAIL)))
sys.exit(1 if FAIL else 0)
