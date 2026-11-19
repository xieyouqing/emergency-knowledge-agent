# -*- coding: utf-8 -*-
import openpyxl, csv, collections

X = "19日18.40-清洗版/应灾知识-数据表.xlsx"
wb = openpyxl.load_workbook(X, read_only=True, data_only=True)
ws = wb["1-官方文件"]
rs = list(ws.iter_rows(values_only=True))
hdr = [str(h) for h in rs[0]]
rows = [dict(zip(hdr, r)) for r in rs[1:] if any(c is not None and str(c).strip() for c in r)]
layer = {r["编号"]: r for r in csv.DictReader(open("可用性分层.csv", encoding="utf-8-sig"))}
A = [r for r in rows if layer.get(str(r["编号"]).strip(), {}).get("分层码") == "A"]

LEVEL = {
    3: ("需要设备/器械，普通家庭通常没有", ["AED", "除颤", "氧气", "静脉", "输液"]),
    2: ("需要技巧或他人配合，普通人易做错", ["人工呼吸", "口对口", "腹部冲击", "海姆立克",
                                            "心肺复苏", "胸外按压", "止血带", "夹板", "担架", "血压计"]),
    1: ("简单动作或常见物品即可", ["绷带", "冰袋", "冲洗", "浸泡", "体温计"]),
}

print("A 层（公众可用）共 %d 条\n" % len(A))
for lv in (3, 2, 1):
    desc, words = LEVEL[lv]
    bucket = collections.defaultdict(list)
    for r in A:
        txt = str(r["内容"]) + "｜" + str(r["原文摘抄"])
        for w in words:
            if w in txt:
                bucket[w].append((str(r["编号"]), str(r["名称"])[:34]))
    hit = {x[0] for v in bucket.values() for x in v}
    print("【难度 %d】%s —— 涉及 %d 条" % (lv, desc, len(hit)))
    for w in sorted(bucket, key=lambda k: -len(bucket[k])):
        print("    %-6s %d 条：%s" % (w, len(bucket[w]), "、".join(x[1] for x in bucket[w][:5])))
    print()

hi = collections.defaultdict(list)
for r in A:
    txt = str(r["内容"]) + "｜" + str(r["原文摘抄"])
    if any(w in txt for w in LEVEL[3][1]):
        hi[str(r["编号"])] = [str(r["名称"])[:34], str(r["层级"]), str(r["可信程度"])]
print("== 需高门槛设备的 A 层条目（建议降级或标注）")
for k, v in hi.items():
    print("   ", k, "|", v[1], "|", v[0])
print("   小计:", len(hi))
