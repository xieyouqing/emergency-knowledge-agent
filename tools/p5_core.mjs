/**
 * P5 日常扩写的唯一判据（2026-11-20 用户裁决 A）。
 *
 * 为什么不直接用 S7 四码：
 *   S7 的 B/C 是为「带 actions 的模型输出」设计的。纯解释文本里
 *   “热烟往上跑”“通过”这类普通动词会被 B 当成动作；实测 11/11 全 B。
 *   P5 的解释不是动作清单，B/C 套上去是系统性误杀。
 *
 * P5 判据（只管三件事）：
 *   ① 动作只能来自 daily.prevention[i]，且 say 必须逐字一致；
 *   ② 正文里不得出现未被声明的指令/具体动作（子句级 + 短语级）；
 *   ③ 正文非空、≤160 字（代理侧还会再限制）。
 *
 * 明确不判：事实正确性（不编数字/药名）——机器判不了，靠 prompt 约束 + 人工抽检。
 */

const ACTION_SRC_RE = /^daily\.prevention\[(\d+)\]$/;

const IMPERATIVE_STARTS = [
  '打开', '关闭', '关掉', '关上', '开灯', '开窗', '按门铃', '按开关', '打电话', '拨打',
  '冲洗', '包扎', '送医', '检查', '更换', '安装', '使用', '通风', '撤离', '离开',
  '跑到', '蹲下', '趴下', '搬动', '切断', '按压', '拍打',
  '拿', '放', '盖', '躲', '扶', '喝', '吃', '嚼',
];
/* 解释性上下文：出现这些词，说明在讲“为什么会这样 / 这种情况会怎样”，
   不是在指挥用户做事。例：「开灯产生的电火花可能引爆」允许；
   「打开阀门」没有解释标记，拒绝。 */
const EXPLAIN_RE = /产生|冒出|引发|导致|引起|会|可能|容易|因为|由于|所以|因此|如果|当|时|以后|之后|的/;
const MODAL_RE = /(^|[，,。；;])\s*(先|马上|立刻|赶紧|别|不要|记得|注意|建议|请)/;

export function clauses(text) {
  return String(text || '')
    .split(/[。；！？!?]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function hasUncoveredInstruction(clause, actions) {
  let s = String(clause || '').trim();
  if (!s) return null;
  for (const a of actions) s = s.split(a.say).join('');
  s = s.trim();
  if (!s) return null;
  if (MODAL_RE.test(s)) return 'modal';
  for (const w of IMPERATIVE_STARTS) {
    if (s.startsWith(w) && !EXPLAIN_RE.test(s)) return w;
  }
  return null;
}

/**
 * @returns {{ok:boolean, actions:{say:string,src:string}[], needAction:boolean, findings:string[]}}
 */
export function validateP5(entry, text, actions) {
  const findings = [];
  const prevention = Array.isArray(entry?.daily?.prevention) ? entry.daily.prevention : [];
  const t = String(text || '').trim();
  if (!t) findings.push('empty-text');
  if (t.length > 160) findings.push('too-long');

  const out = [];
  const seen = new Set();
  const raw = Array.isArray(actions) ? actions : [];
  for (const a of raw) {
    const say = String((a && a.say) || '').trim();
    const src = String((a && a.src) || '').trim();
    const m = ACTION_SRC_RE.exec(src);
    if (!m || !say) {
      findings.push('bad-action-structure');
      continue;
    }
    const idx = Number(m[1]);
    if (!Number.isInteger(idx) || idx < 0 || idx >= prevention.length) {
      findings.push(`action-src-out-of-range:${idx}`);
      continue;
    }
    if (say !== String(prevention[idx] || '').trim()) {
      findings.push(`say-not-verbatim:${idx}`);
      continue;
    }
    const key = `${idx}|${say}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ say, src });
  }

  for (const clause of clauses(t)) {
    const hit = hasUncoveredInstruction(clause, out);
    if (hit) findings.push(`uncovered-instruction:${hit}`);
  }

  return {
    ok: findings.length === 0,
    actions: out,
    needAction: out.length > 0,
    findings,
  };
}
