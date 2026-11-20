#!/usr/bin/env python3
"""
新采集数据可用性探针（2026-11-20）

用途：核实 `_audit/19日18.40-清洗版/` 这批新采集数据，能否直接补 `docs/12` 的来源缺口。
判据复用 `tools/check_source_quote.py` 的 fetch()/normalize()，不另写第二套抓取与比对逻辑。

用法:
    python tools/probe_newdata_source.py

退出码:
    0 = 全部判据通过
    1 = 有判据失败

判据（每条都能失败）:
    D1 源表四要素齐备  1-官方文件 280 行中，同时具备 http 链接 与 >=10 字摘抄 的行数 >= 270
    D2 溯源自洽        离线应答库引用的 source_id 去重后，100% 命中源表编号（零悬空）
    D3 直接可用组      7 条「公众可执行」行，check_source_quote 全部判 pass
    D4 摘抄跨段组      4 条正文可抓，且摘抄的最长连续命中 >= 10 字（内容真实，摘抄需收缩）
    D5 WAF 组          10 条预期非 pass；只记录不判失败，若转为 pass 则提示可升级

不在本脚本判据内（如实标注，不作通过）:
    - 分层码 A/D1 的正确性。实测 `可用性分层.csv` 是把「层级」一对一映射到分层码，
      `部门规范性文件` 22 条全部 D1。其中卒中识别四条（中风120/BEFAST/卒中不等/卒中转运）
      内容是公众识别与处置须知，标 D1「非现场操作」属误标，会低估可用性。
    - 摘抄是否「连续」。D4 只证明内容真实存在，不证明摘抄可直接搬进 source.quote。
"""
import importlib.util
import json
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "_audit" / "19日18.40-清洗版"
XLSX = DATA / "应灾知识-数据表.xlsx"
OFFLINE = DATA / "应灾知识-离线应答库.json"
LAYER_CSV = ROOT / "_audit" / "可用性分层.csv"

SHEET = "1-官方文件"
COL_ID, COL_LINK, COL_QUOTE = 0, 5, 7
MIN_QUOTE = 10
D1_MIN = 270

# 缺口相关行（Excel 行号，含表头）。分组依据见 docs/12 §6.5
GROUP_DIRECT = [183, 129, 131, 133, 94, 236, 177]   # 直接可用（通行 + 公众可执行）
GROUP_NEGATIVE = [184]                              # 反面留档：内容在，但不得作动作来源
GROUP_SPLICE = [108, 99, 101, 166]                  # 摘抄跨段拼接，收缩后可过
GROUP_WAF = [206, 207, 209, 210, 171, 169, 114, 115, 116, 117]  # 站点 WAF 拦截

NAMES = {
    183: "溺水禁按压", 129: "体表压迫", 131: "临时止血带", 133: "止血科普",
    94: "油火禁水", 236: "燃气关阀不炸", 177: "触电挑开电线",
    184: "溺水不用15比1", 108: "溺水通气", 99: "触电断电", 101: "高压十米",
    166: "CO移离", 206: "CPR按压参数", 207: "CPR黄金4分钟", 209: "溺水先通气",
    210: "溺水禁控水", 171: "跌倒无呼吸", 169: "跌倒骨折",
    114: "中风120", 115: "BEFAST", 116: "卒中不等", 117: "卒中转运",
}


def load_checker():
    spec = importlib.util.spec_from_file_location(
        "check_source_quote", ROOT / "tools" / "check_source_quote.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def read_sheet():
    import openpyxl

    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    rows = list(wb[SHEET].iter_rows(min_row=2, values_only=True))
    wb.close()
    return rows


def longest_block(quote_norm, text_norm):
    """摘抄在正文中的最长连续命中字数。用于区分「抄错」与「跨段拼接」。"""
    sm = SequenceMatcher(None, quote_norm, text_norm, autojunk=False)
    blocks = sm.get_matching_blocks()
    return max((b.size for b in blocks), default=0)


def collect_source_ids(obj, out):
    if isinstance(obj, dict):
        v = obj.get("source_id")
        if isinstance(v, str):
            out.add(v)
        for x in obj.values():
            collect_source_ids(x, out)
    elif isinstance(obj, list):
        for x in obj:
            collect_source_ids(x, out)


def main():
    ck = load_checker()
    rows = read_sheet()
    print(f"[数据] {SHEET} {len(rows)} 行 ｜ {OFFLINE.name} "
          f"{json.loads(OFFLINE.read_text(encoding='utf-8'))['meta']['total_scenes']} 场景")
    print("=" * 74)

    fails = []

    # ---- D1 四要素齐备 ----
    ok = 0
    for r in rows:
        link = str(r[COL_LINK] or "").strip()
        quote = str(r[COL_QUOTE] or "").strip()
        if link.startswith("http") and len(quote) >= MIN_QUOTE:
            ok += 1
    d1 = ok >= D1_MIN
    print(f"D1 四要素齐备      {ok}/{len(rows)}  阈值>={D1_MIN}   "
          f"{'PASS' if d1 else 'FAIL'}")
    if not d1:
        fails.append(f"D1 齐备行数 {ok} < {D1_MIN}")

    # ---- D2 溯源自洽 ----
    kb = json.loads(OFFLINE.read_text(encoding="utf-8"))
    ids = set()
    collect_source_ids(kb, ids)
    known = {str(r[COL_ID]).strip() for r in rows if r[COL_ID]}
    dangling = sorted(i for i in ids if i not in known)
    d2 = not dangling
    print(f"D2 source_id 落表  {len(ids) - len(dangling)}/{len(ids)}  阈值=100%   "
          f"{'PASS' if d2 else 'FAIL'}")
    if not d2:
        fails.append(f"D2 悬空 source_id {len(dangling)} 个: {dangling[:5]}")

    # ---- 逐行判定（一次性抓取，D3/D4/D5 共用） ----
    cache = {}

    def judge(n):
        if n in cache:
            return cache[n]
        r = rows[n - 2]
        link = str(r[COL_LINK] or "").strip()
        quote = str(r[COL_QUOTE] or "").strip()
        res = ck.check_entry({"id": n, "source": {"url": link, "quote": quote}})
        block = -1
        if res["result"] == "fail":
            text, _ = ck.fetch(link)
            if text is not None:
                block = longest_block(ck.normalize(quote), ck.normalize(text))
        cache[n] = (res, len(quote), block)
        return cache[n]

    print("-" * 74)

    # ---- D3 直接可用组 ----
    print("D3 直接可用组（须全部 pass）")
    bad = []
    for n in GROUP_DIRECT:
        res, qlen, _ = judge(n)
        mark = "PASS" if res["result"] == "pass" else "FAIL"
        print(f"   行{n:<4} {NAMES[n]:<12} {mark}  {res['reason'][:34]}")
        if res["result"] != "pass":
            bad.append(n)
    d3 = not bad
    print(f"   -> {len(GROUP_DIRECT) - len(bad)}/{len(GROUP_DIRECT)}  "
          f"{'PASS' if d3 else 'FAIL'}")
    if not d3:
        fails.append(f"D3 未通过行: {bad}")

    # ---- D3b 反面留档 ----
    for n in GROUP_NEGATIVE:
        res, _, _ = judge(n)
        print(f"   行{n:<4} {NAMES[n]:<12} {'内容存在' if res['result'] == 'pass' else '抓不到'}"
              f"  注：D3「已废弃说法」，只能进 never_do，不得作动作来源")

    print("-" * 74)

    # ---- D4 摘抄跨段组 ----
    print(f"D4 摘抄跨段组（正文可抓 且 最长连续 >= {MIN_QUOTE} 字）")
    bad = []
    for n in GROUP_SPLICE:
        res, qlen, block = judge(n)
        good = block >= MIN_QUOTE
        tag = f"最长连续 {block} 字" if block >= 0 else f"正文抓不到: {res['reason'][:20]}"
        print(f"   行{n:<4} {NAMES[n]:<12} 摘抄{qlen:>3}字  {tag:<24} "
              f"{'PASS' if good else 'FAIL'}")
        if not good:
            bad.append(n)
    d4 = not bad
    print(f"   -> {len(GROUP_SPLICE) - len(bad)}/{len(GROUP_SPLICE)}  "
          f"{'PASS' if d4 else 'FAIL'}")
    if not d4:
        fails.append(f"D4 内容存疑行: {bad}")

    print("-" * 74)

    # ---- D5 WAF 组（只记录） ----
    print("D5 WAF 组（预期非 pass，只记录）")
    upgraded = []
    for n in GROUP_WAF:
        res, _, _ = judge(n)
        if res["result"] == "pass":
            upgraded.append(n)
        print(f"   行{n:<4} {NAMES[n]:<12} {res['result']:<11} {res['reason'][:30]}")
    if upgraded:
        print(f"   注：{upgraded} 本次转为 pass（站点防护可能已放开），可升级为直接可用")
    print("   -> 非判据项，不计入退出码")

    print("=" * 74)
    if fails:
        print(f"FAIL: {len(fails)} 项判据未过")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("PASS: 4 项判据全部通过（D5 为观察项）")
    print("提醒: 本结论是本次抓取时点的快照。同一条 URL 不同时点可能返回不同状态码，")
    print("      见 docs/08 P31「机器判据的时效性」。发表前须重跑本脚本。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
