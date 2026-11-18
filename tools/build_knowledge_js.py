"""
知识库预编译：knowledge/*.json -> app/knowledge.js

用法: python tools/build_knowledge_js.py

为什么预编译成 JS 而不是运行时 fetch：
  1. file:// 下 fetch 会被 CORS 拦死，双击打不开，演示要多一步起服务；
  2. 让「只加载 published」变成构建期强制——非 published 条目根本不会进入产物，
     前端不可能误加载（契约 §7.3）；
  3. M3 的 Tauri 打包复用同一份产物（frontendDist 即 app/）。

判据（每条都能失败）:
  1. 产物只含 status == published 的条目 —— 多一条即 FAIL
  2. 产物中条目的 id 必须同时存在于 index.json 的 slots —— 幽灵场景即 FAIL
  3. slots 只输出 state == ready 且有条目的槽位 —— 多一个即 FAIL
  4. 输出文件可被 Node/浏览器解析（写入后自检首尾）
退出码 0 = 成功；1 = 失败
"""
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KNOWLEDGE = ROOT / "knowledge"
OUT = ROOT / "app" / "knowledge.js"

RESERVED = {"index.json", "manifest.json"}


def main():
    index_path = KNOWLEDGE / "index.json"
    if not index_path.exists():
        print("FAIL: knowledge/index.json 不存在")
        return 1

    idx = json.loads(index_path.read_text(encoding="utf-8"))
    slots = idx.get("slots") or []
    slot_ids = {s["id"] for s in slots}

    entries = {}
    skipped = []
    for f in sorted(KNOWLEDGE.glob("*.json")):
        if f.name in RESERVED or f.name.startswith(("_", ".")):
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        eid = d.get("id")
        if eid not in slot_ids:
            print(f"FAIL: {f.name} 的 id={eid!r} 不在 index.json slots 内（幽灵场景）")
            return 1
        if d.get("status") != "published":
            skipped.append((eid, d.get("status")))
            continue
        entries[eid] = d

    # 只输出 ready 且有条目的槽位
    out_slots = []
    for s in sorted(slots, key=lambda x: x.get("order", 0)):
        if s.get("state") == "ready" and s["id"] in entries:
            out_slots.append({
                "id": s["id"],
                "name": s["name"],
                "icon": s.get("icon"),
                "order": s.get("order"),
            })

    payload = {
        "generated_at": date.today().isoformat(),
        "data_date": idx.get("updated_at") or date.today().isoformat(),
        "slot_count": len(out_slots),
        "entry_count": len(entries),
        "slots": out_slots,
        "entries": entries,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    OUT.write_text(
        "/* 自动生成，请勿手改。源：knowledge/*.json 中 status=published 的条目。"
        "重新生成：python tools/build_knowledge_js.py */\n"
        "window.KNOWLEDGE = " + body + ";\n",
        encoding="utf-8",
    )

    # 自检：产物必须是「注释 + window.KNOWLEDGE = {...};」结构
    text = OUT.read_text(encoding="utf-8")
    if "window.KNOWLEDGE = {" not in text or not text.rstrip().endswith("};"):
        print("FAIL: 产物结构异常（缺 window.KNOWLEDGE 或结尾不完整）")
        return 1

    print(f"生成 {OUT.relative_to(ROOT)}")
    print(f"  槽位 {len(out_slots)} 个（state=ready 且有条目）")
    for s in out_slots:
        print(f"    [{s['order']:>3}] {s['id']:<18} {s['name']}")
    print(f"  条目 {len(entries)} 条（status=published）")
    if skipped:
        print(f"  跳过 {len(skipped)} 条（未发布，不进入产物）:")
        for eid, st in skipped:
            print(f"    - {eid} ({st})")
    hidden = [s["id"] for s in slots if s["id"] not in entries]
    if hidden:
        print(f"  隐藏 {len(hidden)} 个空槽位: {', '.join(hidden)}")

    if len(entries) == 0:
        print("WARN: 产物中 0 条已发布条目，页面将只显示拒答与拨号卡")
    return 0


if __name__ == "__main__":
    sys.exit(main())
