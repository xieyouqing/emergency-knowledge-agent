# -*- coding: utf-8 -*-
"""离线应答库清洗：不改关键词（回归测试证明原版已正确），只换无法对账的 md5 校验字段。"""
import json, os, hashlib, collections, openpyxl

SRC = "应灾知识-离线应答库.json"
OUT = os.path.join("19日18.40-清洗版", SRC)

d = json.load(open(SRC, encoding="utf-8"))

# 1) 关键词：撤回改动。回归测试（test_match.py）证明最长匹配已正确路由，无需拆分。
#    仅把两侧的关键词恢复为原值（若此前被改过）。
ORIG = {
    "gas_leak": ["煤气泄漏", "燃气泄漏", "漏气", "煤气味", "燃气味", "煤气", "燃气"],
    "co_poisoning": ["一氧化碳", "CO", "煤气中毒", "烧炭", "炭火", "取暖", "炉子",
                     "煤炉", "煤气", "头晕恶心", "中毒"],
}
for sc in d["scenes"]:
    if sc["id"] in ORIG:
        sc["keywords"] = ORIG[sc["id"]]

# 2) 校验字段：md5 换成内容级校验
wb = openpyxl.load_workbook("19日18.40-清洗版/应灾知识-数据表.xlsx",
                            read_only=True, data_only=True)
ws = wb["1-官方文件"]
ids = [str(r[0]).strip() for r in ws.iter_rows(min_row=2, values_only=True)
       if r and r[0] not in (None, "")]
uniq = sorted(set(ids))
d["meta"].pop("source_md5", None)
d["meta"]["source_rows"] = len(ids)
d["meta"]["source_id_count"] = len(uniq)
d["meta"]["source_ids_sha1"] = hashlib.sha1("\n".join(uniq).encode("utf-8")).hexdigest()
d["meta"]["source_checksum_note"] = (
    "原 meta.source_md5 已移除。实测两版源表 md5（14:10 版 98564d76…、17.00 版 14fde534…）"
    "均不等于原声明值 5082000c…，该字段无法用于对账（Office 重存/网盘导出都会改变字节）。"
    "改记数据行数 + 编号集合 sha1，二者不随文件重存变化。")
d["meta"]["version"] = "1.5.2"
d["meta"]["generated_at"] = "2026-11-19T18:40:00+08:00"
d["meta"].setdefault("changelog", []).append(
    "2026-11-19 v1.5.2：数据清洗版。①关键词「煤气」原判为跨场景冲突，经最长匹配回归"
    "（test_match.py，11 条口语）证伪——「煤气中毒」4 字恒优先于「煤气」2 字，原版路由正确，"
    "撤回拆分建议，关键词零改动；②meta.source_md5 换成 source_rows + source_ids_sha1；"
    "③源表已完成章节/受众/层级归一（134→29 / 34→12 原子值 / 17→15），本库字段未受影响。")

with open(OUT, "w", encoding="utf-8", newline="\r\n") as f:
    json.dump(d, f, ensure_ascii=False, indent=1)
print("已写出:", OUT)

# 复检
d2 = json.load(open(OUT, encoding="utf-8"))
kw = collections.defaultdict(set)
for sc in d2["scenes"]:
    for k in sc["keywords"]:
        kw[k.strip()].add(sc["id"])
print("冲突关键词:", {k: v for k, v in kw.items() if len(v) > 1} or "无")
refs = set()
for sc in d2["scenes"]:
    refs.update(sc.get("source_ids") or [])
    for key in ("steps", "never_do"):
        for it in sc.get(key) or []:
            if it.get("source_id"):
                refs.add(it["source_id"])
    for br in sc.get("branches") or []:
        if br.get("source_id"):
            refs.add(br["source_id"])
        for key in ("steps", "never_do"):
            for it in br.get(key) or []:
                if it.get("source_id"):
                    refs.add(it["source_id"])
print("引用唯一数:", len(refs), "悬空:", sorted(refs - set(uniq)) or "无")
print("场景数:", len(d2["scenes"]), "total_scenes:", d2["meta"]["total_scenes"])
print("source_rows:", d2["meta"]["source_rows"], "sha1:", d2["meta"]["source_ids_sha1"])
