"""
数据契约校验脚本（v0.2：category 改为 index.json 注册表驱动）
用法: python tools/validate_knowledge.py
判据（每条都能失败）:
  1. index.json 可解析；slots 的 id / icon / order 无重复 —— 重复即 FAIL
  2. 每个条目 json 可被 json.load 解析 —— 失败即 FAIL
  3. 必填字段齐全 —— 缺一即 FAIL
  4. 条目的 category 必须在 index.json 的 slots 内 —— 越界即 FAIL（禁止幽灵场景）
  5. emergency_number / status 在枚举内 —— 越界即 FAIL
  6. steps 每段条数、每条字数达标 —— 越界即 FAIL
  7. never 非空（S3）—— 为空即 FAIL
  8. published 条目必须有 >=1 位审核人，且 checklist 全 true —— 违反即 FAIL（v0.3：单人验证，允许自审自过）
  9. 有 slot 无 entry / entry 未 published —— 不算错，打印提示
退出码 0 = 全部通过；1 = 有失败项
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KNOWLEDGE = ROOT / "knowledge"
INDEX = KNOWLEDGE / "index.json"

NUMBERS = {"119", "120", "110"}
STATUSES = {"draft", "pending_review", "approved", "published", "rejected", "archived"}
SLOT_STATES = {"slot", "ready"}

REQUIRED = [
    "schema_version", "id", "name", "aliases", "category", "keywords",
    "life_threatening", "triage", "steps", "emergency_number", "source",
    "daily", "offline", "version", "status", "review", "created_at", "updated_at",
]
REQUIRED_SOURCE = ["name", "url", "date", "quote"]
REQUIRED_DAILY = ["summary", "why", "prevention", "misconception"]
REQUIRED_REVIEW = ["author", "approved_by", "approved_at", "checklist", "reject_reason"]
REQUIRED_SLOT = ["id", "name", "icon", "order", "state", "show_when_empty"]
CHECKLIST_KEYS = ["step_order_ok", "never_non_empty", "source_quote_verbatim"]

MAX_STEP_CHARS = 20
IMMEDIATE_RANGE = (3, 7)
NEXT_RANGE = (1, 7)


def load_index(errors):
    """读注册表，返回 (allowed_categories, slots_by_id)；失败返回 (None, None)"""
    if not INDEX.exists():
        errors.append("[index.json] 文件不存在，场景注册表缺失")
        return None, None
    try:
        with INDEX.open("r", encoding="utf-8") as f:
            idx = json.load(f)
    except Exception as e:
        errors.append(f"[index.json] JSON 解析失败: {e}")
        return None, None

    slots = idx.get("slots")
    if not isinstance(slots, list) or not slots:
        errors.append("[index.json] slots 缺失或为空")
        return None, None

    slots_by_id = {}
    seen_icon, seen_order = {}, {}
    for i, s in enumerate(slots):
        tag = f"[index.json slots[{i}]]"
        for k in REQUIRED_SLOT:
            if k not in s:
                errors.append(f"{tag} 缺字段: {k}")
        sid = s.get("id")
        if not sid:
            errors.append(f"{tag} id 为空")
            continue
        if sid in slots_by_id:
            errors.append(f"{tag} id 重复: {sid}")
        slots_by_id[sid] = s

        if s.get("state") not in SLOT_STATES:
            errors.append(f"{tag} state 非法: {s.get('state')}（只能 slot / ready）")

        icon = s.get("icon")
        if icon:
            if icon in seen_icon:
                errors.append(f"{tag} icon 重复: {icon}（与 {seen_icon[icon]} 撞车）")
            seen_icon[icon] = sid

        order = s.get("order")
        if isinstance(order, int) and not isinstance(order, bool):
            if order in seen_order:
                errors.append(f"{tag} order 重复: {order}（与 {seen_order[order]} 撞车）")
            seen_order[order] = sid
        else:
            errors.append(f"{tag} order 必须是整数，实际: {order!r}")

        if not isinstance(s.get("show_when_empty"), bool):
            errors.append(f"{tag} show_when_empty 必须是布尔值")

    return set(slots_by_id.keys()), slots_by_id


def check_file(path, errors, allowed):
    rel = path.name
    try:
        with path.open("r", encoding="utf-8") as f:
            d = json.load(f)
    except Exception as e:
        errors.append(f"[{rel}] JSON 解析失败: {e}")
        return None

    missing = [k for k in REQUIRED if k not in d]
    for k in missing:
        errors.append(f"[{rel}] 缺必填字段: {k}")
    if missing:
        return d

    if d["id"] + ".json" != rel:
        errors.append(f"[{rel}] id={d['id']} 与文件名不一致")
    if allowed is not None and d["category"] not in allowed:
        errors.append(
            f"[{rel}] category={d['category']!r} 不在 index.json slots 内"
            f"（先在注册表加 slot，再写条目）"
        )
    elif d["category"] != d["id"]:
        errors.append(f"[{rel}] category 与 id 不一致: {d['category']} != {d['id']}")
    if d["emergency_number"] not in NUMBERS:
        errors.append(f"[{rel}] emergency_number 非法: {d['emergency_number']}")
    if d["status"] not in STATUSES:
        errors.append(f"[{rel}] status 非法: {d['status']}")
    if not isinstance(d["life_threatening"], bool):
        errors.append(f"[{rel}] life_threatening 必须是布尔值")
    if not isinstance(d["offline"], bool):
        errors.append(f"[{rel}] offline 必须是布尔值")
    if not d["aliases"]:
        errors.append(f"[{rel}] aliases 不能为空")
    if len(d["keywords"]) < 3:
        errors.append(f"[{rel}] keywords 少于 3 条")

    steps = d["steps"]
    for seg in ("immediate", "next", "never"):
        if seg not in steps:
            errors.append(f"[{rel}] 缺 steps.{seg}")
    for seg in ("immediate", "next", "never"):
        if seg not in steps:
            continue
        arr = steps.get(seg) or []
        if not isinstance(arr, list) or not arr:
            errors.append(f"[{rel}] steps.{seg} 为空（S3 要求 never 非空）")
            continue
        if seg != "never":
            lo, hi = (IMMEDIATE_RANGE if seg == "immediate" else NEXT_RANGE)
            if not (lo <= len(arr) <= hi):
                errors.append(f"[{rel}] steps.{seg} 条数 {len(arr)} 不在 {lo}-{hi}")
        for i, s in enumerate(arr):
            if len(s) > MAX_STEP_CHARS:
                errors.append(f"[{rel}] steps.{seg}[{i}] {len(s)} 字超过 {MAX_STEP_CHARS}: {s}")

    src = d["source"]
    for k in REQUIRED_SOURCE:
        if k not in src or not str(src[k]).strip():
            errors.append(f"[{rel}] source.{k} 为空")
    if len(str(src.get("quote", ""))) < 10:
        errors.append(f"[{rel}] source.quote 少于 10 字，视为概括而非原文")

    daily = d["daily"]
    for k in REQUIRED_DAILY:
        if k not in daily:
            errors.append(f"[{rel}] daily.{k} 缺失")
    if len(daily.get("summary", "")) > 60:
        errors.append(f"[{rel}] daily.summary 超过 60 字")
    if len(daily.get("why", "")) > 150:
        errors.append(f"[{rel}] daily.why 超过 150 字")
    prev = daily.get("prevention") or []
    if not (1 <= len(prev) <= 5):
        errors.append(f"[{rel}] daily.prevention 条数不在 1-5")

    tr = d["triage"]
    if tr is not None and len(tr.get("options", [])) > 3:
        errors.append(f"[{rel}] triage.options 超过 3 个")

    rv = d["review"]
    for k in REQUIRED_REVIEW:
        if k not in rv:
            errors.append(f"[{rel}] review.{k} 缺失")
    for k in CHECKLIST_KEYS:
        if k not in rv.get("checklist", {}):
            errors.append(f"[{rel}] review.checklist.{k} 缺失")
    if d["status"] == "published":
        approved = rv.get("approved_by") or []
        if len(approved) < 1:
            errors.append(f"[{rel}] published 但审核人 0 位（需 >=1）")
        cl = rv.get("checklist", {})
        if not all(cl.get(k) is True for k in CHECKLIST_KEYS):
            errors.append(f"[{rel}] published 但 checklist 未全部为 true")

    return d


def main():
    errors = []
    allowed, slots_by_id = load_index(errors)

    files = sorted(
        f for f in KNOWLEDGE.glob("*.json")
        if f.name not in ("manifest.json", "index.json")
        and not f.name.startswith(("_", "."))   # 跳过备份/临时文件，如 _ent_bak.json
    )
    skipped = [
        f.name for f in KNOWLEDGE.glob("*.json")
        if f.name.startswith(("_", "."))
    ]
    if skipped:
        print(f"跳过临时/备份文件 {len(skipped)} 个: {', '.join(skipped)}")
    if not files:
        print("提示: knowledge/ 下暂无条目文件（槽位已预留，内容待填写）")

    seen = {}
    by_id_status = {}
    for f in files:
        d = check_file(f, errors, allowed)
        if d:
            cid = d.get("id")
            if cid in seen:
                errors.append(f"id 重复: {cid} ({seen[cid]} 与 {f.name})")
            seen[cid] = f.name
            by_id_status[cid] = d.get("status")

    print(f"注册表槽位: {len(slots_by_id or {})} 个")
    for s in sorted((slots_by_id or {}).values(), key=lambda x: x.get("order", 0)):
        sid = s["id"]
        st = by_id_status.get(sid)
        if st == "published":
            mark = "已发布"
        elif st:
            mark = f"有条目未发布({st})"
        else:
            mark = "待填写"
        print(f"  [{s.get('order'):>3}] {sid:<18} {str(s.get('name', '')):<10} {mark}")

    print("-" * 56)
    print(f"条目文件: {len(files)} 个")
    for f in files:
        print(f"  - {f.name}")

    if errors:
        print("-" * 56)
        print(f"FAIL: {len(errors)} 个问题")
        for e in errors:
            print("  " + e)
        return 1

    print("-" * 56)
    print("PASS: 注册表与条目均通过契约校验")
    return 0


if __name__ == "__main__":
    sys.exit(main())
