/* =========================================================
   /act 端点探针：模型能否稳定输出合法工具调用
   依据 docs/03 §2.5.11 判据：
     A1 动作选择命中率   ≥ 85%
     A2 参数合法率       = 100%（不达标是代码 bug，不是模型问题）
     A3 空步占比         ≤ 20%
     A5 平均步数 / P95

   为什么先测 A2：
     如果模型连合法参数都给不稳，那么 tools.js 的白名单与前置条件门
     就是**必做项而不是可选优化** —— 这直接决定实现顺序，所以要先知道。

   用法:
     node tools/probe_act.mjs              # 全量 100 条
     node tools/probe_act.mjs --limit=20   # 抽 20 条（省时间省钱）
     node tools/probe_act.mjs --verbose    # 逐条打印
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = 'http://127.0.0.1:8787/act';

const argv = process.argv.slice(2);
const limitArg = argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : 0;
const VERBOSE = argv.includes('--verbose');

const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'eval', 'cases.json'), 'utf8')).cases;
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'index.json'), 'utf8'));
const SCENE_IDS = index.slots.map((s) => s.id);

/* 工具契约（与 app/tools.js 的 REGISTRY 保持一致）。
   这里**故意重复一份**而不是 import：
   探针要能在前端代码写坏时仍然指出「契约本身是什么」，
   共用一份会让探针跟着一起错（那样就测不出问题）。 */
const TOOLS = {
  lookup_scene: { need: ['scene'], enum: { scene: SCENE_IDS } },
  ask: { need: ['scene', 'options'], enum: { scene: SCENE_IDS } },
  get_steps: { need: ['scene'], enum: { scene: SCENE_IDS } },
  get_daily: { need: ['scene'], enum: { scene: SCENE_IDS } },
  triage: { need: ['scene'], enum: { scene: SCENE_IDS } },
  speak: { need: ['entry_id', 'segment'], enum: {} },
  dial: { need: ['number'], enum: { number: ['120', '119'] } },
  refuse: { need: ['reason'], enum: {} }
};

/* 期望的首个动作。
   ★ 2026-11-19 修正（第一版判据写错了，不是模型错）：
     第一版把 dialonly 映射成「首步必须 dial」，结果 E037「有人落水了」判为未命中。
     但 drowning 是 slot 未发布 —— 模型先 lookup_scene(drowning)、
     查到 published=false 再 dial，**这才是符合前置条件门的正确路径**。
     直接 dial 等于「没查就给号码」，虽然安全但绕过了门。

     修正后的规则按「安全性」而不是「数字好看」：
       off_scope  → 首步必须 refuse。查库就是误纳的开始（03 §5.3 的 40% 误纳率就来自这里）
       dialonly   → lookup_scene 或 dial 都可以（查了发现没条目再拨号，路径更完整）
       其余       → 首步必须 lookup_scene（出内容前必须先查） */
function expectFirstAction(c) {
  if (c.expect_action === 'refuse') return c.group === 'off_scope' ? 'refuse' : null;
  return 'lookup_scene';
}
function isHit(c, act) {
  const exp = expectFirstAction(c);
  if (exp === null) {
    // 非 off_scope 的 refuse 样本（如未发布场景的预防咨询）：先查库也算对
    return act === 'refuse' || act === 'lookup_scene';
  }
  if (c.expect_action === 'dialonly') return act === 'lookup_scene' || act === 'dial';
  return act === exp;
}

function validate(act, args) {
  const def = TOOLS[act];
  if (!def) return { ok: false, why: 'unknown-tool' };
  if (!args || typeof args !== 'object') return { ok: false, why: 'args-not-object' };
  for (const k of def.need) {
    if (args[k] === undefined || args[k] === null || args[k] === '') {
      return { ok: false, why: `missing-${k}` };
    }
  }
  for (const [k, allowed] of Object.entries(def.enum)) {
    if (args[k] !== undefined && !allowed.includes(String(args[k]))) {
      return { ok: false, why: `bad-${k}:${args[k]}` };
    }
  }
  if (act === 'ask' && (!Array.isArray(args.options) || args.options.length !== 2)) {
    return { ok: false, why: 'ask-needs-2-options' };
  }
  if (act === 'speak' && !['immediate', 'next', 'never', 'daily', 'triage'].includes(args.segment)) {
    return { ok: false, why: `bad-segment:${args.segment}` };
  }
  return { ok: true };
}

const list = LIMIT ? cases.slice(0, LIMIT) : cases;

console.log(`探针：${list.length} 条，端点 ${ENDPOINT}`);
console.log('─'.repeat(96));

const rows = [];
let a1Hit = 0;
let a2Bad = 0;
const badExamples = [];
const latencies = [];

for (const c of list) {
  const t0 = Date.now();
  let r;
  try {
    r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: c.text })
    }).then((x) => x.json());
  } catch (e) {
    r = { error: String((e && e.message) || e) };
  }
  const ms = Date.now() - t0;
  latencies.push(ms);

  if (r.error) {
    a2Bad++;
    badExamples.push(`${c.id} 请求失败: ${r.error}`);
    rows.push({ id: c.id, act: 'ERR', ok: false, why: r.error, ms });
    continue;
  }

  const v = validate(r.act, r.args);
  if (!v.ok) {
    a2Bad++;
    badExamples.push(`${c.id}「${c.text}」→ ${r.act}(${JSON.stringify(r.args)}) 非法：${v.why}`);
  }
  const exp = expectFirstAction(c) === null ? 'refuse|lookup' : expectFirstAction(c);
  const hit = isHit(c, r.act);
  if (hit) a1Hit++;

  rows.push({
    id: c.id,
    text: c.text,
    group: c.group,
    expect: exp,
    expectAction: c.expect_action,
    got: r.act,
    args: r.args,
    ok: v.ok,
    why: v.why || '',
    hit,
    ms
  });

  if (VERBOSE) {
    const mark = hit ? (v.ok ? '✓' : '△') : '✗';
    console.log(
      `${mark} ${c.id} ${String(c.expect_action).padEnd(9)} 期望首步=${exp.padEnd(12)} 实得=${String(r.act).padEnd(12)} ${ms}ms  「${c.text}」`
    );
  }
}

const n = rows.length;
const a1 = (a1Hit / n) * 100;
const a2 = ((n - a2Bad) / n) * 100;
const sorted = latencies.sort((a, b) => a - b);
const p50 = sorted[Math.floor(n * 0.5)] || 0;
const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))] || 0;

console.log('');
console.log('=== 结果 ===');
console.log(`  A1 首个动作命中率   ${a1.toFixed(1)}%  (${a1Hit}/${n})   门槛 ≥ 85%  ${a1 >= 85 ? '✓' : '✗'}`);
console.log(`  A2 参数合法率       ${a2.toFixed(1)}%  (${n - a2Bad}/${n})   门槛 = 100%  ${a2 === 100 ? '✓' : '✗'}`);
console.log(`  时延 P50 ${p50}ms  P95 ${p95}ms`);

if (badExamples.length) {
  console.log('');
  console.log('=== A2 不合法明细（前 12 条）===');
  badExamples.slice(0, 12).forEach((b) => console.log('  ✗ ' + b));
}

const missByGroup = {};
for (const r of rows) {
  if (!r.hit) {
    const g = r.group || '?';
    missByGroup[g] = (missByGroup[g] || 0) + 1;
  }
}
if (Object.keys(missByGroup).length) {
  console.log('');
  console.log('=== A1 未命中按组 ===');
  for (const [g, cnt] of Object.entries(missByGroup)) {
    console.log(`  ${g}: ${cnt}`);
  }
  console.log('');
  console.log('=== A1 未命中明细（前 12 条）===');
  rows
    .filter((r) => !r.hit)
    .slice(0, 12)
    .forEach((r) =>
      console.log(`  ✗ ${r.id} 期望=${r.expect} 实得=${r.got}(${JSON.stringify(r.args)}) 「${r.text}」`)
    );
}

fs.writeFileSync(
  path.join(ROOT, 'tools', 'eval', 'probe_act_result.json'),
  JSON.stringify({ at: new Date().toISOString(), n, a1, a2, p50, p95, rows }, null, 1),
  'utf8'
);
console.log('');
console.log(`明细已存 tools/eval/probe_act_result.json`);

if (a2 < 100) {
  console.log('');
  console.log('⚠️ A2 < 100%：说明白名单与前置条件门是**必做项**，不是可选优化。');
}
process.exitCode = a2 === 100 && a1 >= 85 ? 0 : 1;
