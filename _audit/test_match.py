# -*- coding: utf-8 -*-
"""回归：按 README 的最长匹配算法，测三种关键词方案下的场景命中。"""
import json

def match(text, kb):
    best, best_len = None, 0
    for s in kb["scenes"]:
        for kw in s["keywords"] + s.get("question_variants", []):
            if kw in text and len(kw) > best_len:
                best, best_len = s, len(kw)
    return (best["id"] if best else "FALLBACK"), best_len

CASES = [
    "煤气泄漏怎么办", "闻到煤气味", "家里有煤气", "有煤气怎么办", "煤气",
    "煤气中毒了", "烧炭头晕", "煤炉取暖头晕恶心", "一氧化碳中毒",
    "燃气漏了", "漏煤气了",
]

def load(p):
    return json.load(open(p, encoding="utf-8"))

old = load("应灾知识-离线应答库.json")

# 方案A：gas_leak 保留裸词「煤气」，co_poisoning 去掉（4字词永远优先）
a = json.loads(json.dumps(old))
for sc in a["scenes"]:
    if sc["id"] == "gas_leak":
        sc["keywords"] = ["煤气泄漏", "燃气泄漏", "漏气", "煤气味", "燃气味", "煤气", "燃气"]
    if sc["id"] == "co_poisoning":
        sc["keywords"] = ["一氧化碳", "CO", "煤气中毒", "烧炭", "炭火", "取暖", "炉子",
                          "煤炉", "煤烟", "头晕恶心", "中毒"]

# 方案B：两侧都不含裸词（原已实现的方案）
b = load("19日18.40-清洗版/应灾知识-离线应答库.json")

print("%-16s %-14s %-14s %-14s" % ("输入", "原版", "方案A", "方案B"))
print("-" * 62)
for t in CASES:
    print("%-16s %-14s %-14s %-14s" % (t, match(t, old)[0], match(t, a)[0], match(t, b)[0]))
