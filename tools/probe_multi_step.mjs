#!/usr/bin/env node
/**
 * P9 验收：20 条多步样本的平均步数与 P95 步数。
 *
 * 与 probe_loop 的分工：
 *   probe_loop    100 条开发集，测最终结局准确率（多数是 1–2 步）。
 *   probe_multi_step 只挑「必须查库再出内容」的 20 条，专门测步数分布。
 *
 * 口径：
 *   - 走真实 /act 循环（模型选工具，前置门校验），不注 seed；
 *   - nocache=1，避免缓存把步数抹平；
 *   - 步数 = 模型实际执行过的工具调用数（含 lookup / triage / get_steps）。
 *
 * 用法: node tools/probe_multi_step.mjs
 * 退出码 0 = 20 条动作正确且 P95 ≤ 5
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'app');
const ENDPOINT = 'http://127.0.0.1:8787/act';

const sandbox = {
  window: {},
  console,
  Math,
  String,
  Number,
  Object,
  Array,
  JSON,
  Promise,
  Error,
  Date,
  RegExp,
  Set,
  Map,
  navigator: { onLine: true },
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['retrieval.js', 'tools.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox);
}
const TOOLS = sandbox.TOOLS;
if (!TOOLS) {
  console.error('FAIL: tools.js 未导出 TOOLS');
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'index.json'), 'utf8'));
const SCENE_IDS = index.slots.map((s) => s.id);
const ENTRIES = {};
for (const id of index.slots.filter((s) => s.state === 'ready').map((s) => s.id)) {
  const p = path.join(ROOT, 'knowledge', id + '.json');
  if (!fs.existsSync(p)) continue;
  const e = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (e.status === 'published' || e.status === undefined) ENTRIES[id] = e;
}

const data = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tools', 'eval', 'cases_multi_step.json'), 'utf8')
);
const cases = data.cases;

async function callAct(text, history) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, history: history.slice(-6), nocache: true }),
  }).then((x) => x.json());
  return r;
}

function kindToAction(kind) {
  if (kind === 'steps') return 'steps';
  if (kind === 'daily') return 'daily';
  if (kind === 'dial') return 'dialonly';
  if (kind === 'refuse') return 'refuse';
  if (kind === 'triage') return 'steps';
  if (kind === 'ask') return 'ask';
  return 'unknown';
}

async function runLoop(c) {
  const history = [];
  const steps = [];
  const scenes = [];
  const MAX = 5;
  let endKind = null;

  for (let i = 0; i < MAX; i++) {
    let d;
    try {
      d = await callAct(c.text, history);
    } catch (e) {
      return { endKind: 'refuse', steps, scenes, err: String(e.message || e) };
    }
    if (d.error) return { endKind: 'refuse', steps, scenes, err: d.error };

    const act = d.act;
    const args = d.args || {};

    /* 与 agent.js 同口径的上文证据闸（P33）：无上文时证据必须落在当前句。 */
    if (d.evidence) {
      const evN = String(d.evidence).replace(/\s+/g, '');
      const curN = String(c.text).replace(/\s+/g, '');
      const grounded = !!evN && (curN.indexOf(evN) !== -1 || evN.indexOf(curN) !== -1);
      const pureFollowup =
        /^(怎么办|然后呢|现在呢|那呢|怎么弄|要紧吗|严重吗|接下来呢|还怎么办)[？?。！!]*$/.test(curN);
      if (!grounded && !pureFollowup) {
        steps.push({ act, args, ok: false, reason: 'context-not-grounded' });
        endKind = 'refuse';
        break;
      }
    }

    let gate = TOOLS.checkGate(act, args, { entries: ENTRIES, sceneIds: SCENE_IDS, history });
    if (!gate.ok && gate.reason === 'no-lookup' && args.scene && ENTRIES[args.scene]) {
      const lr = TOOLS.execute(
        'lookup_scene',
        { scene: args.scene },
        { entries: ENTRIES, sceneIds: SCENE_IDS, history }
      );
      if (lr.ok) {
        history.push({ act: 'lookup_scene', args: { scene: args.scene }, result: lr.result });
        steps.push({ act: 'lookup_scene', args: { scene: args.scene }, ok: true, why: 'auto-lookup' });
        scenes.push(args.scene);
        gate = TOOLS.checkGate(act, args, { entries: ENTRIES, sceneIds: SCENE_IDS, history });
      }
    }
    if (!gate.ok) {
      steps.push({ act, args, ok: false, reason: gate.reason });
      endKind = 'refuse';
      break;
    }

    const res = TOOLS.execute(act, args, { entries: ENTRIES, sceneIds: SCENE_IDS, history });
    steps.push({ act, args, ok: res.ok, kind: res.kind || null });
    if (args.scene && !scenes.includes(args.scene)) scenes.push(args.scene);
    if (res.ok) history.push({ act, args, result: res.result });
    if (res.ends) {
      endKind = res.kind;
      break;
    }
    if (res.kind === 'ask' || res.kind === 'triage') {
      endKind = res.kind;
      break;
    }
  }
  if (!endKind) endKind = 'refuse';
  return { endKind, steps, scenes };
}

function p95(values) {
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.ceil(0.95 * s.length) - 1];
}

console.log(`=== P9 多步样本：${cases.length} 条（真实 /act，nocache） ===\n`);
console.log('ID    动作      步数  场景');
console.log('-'.repeat(48));

const rows = [];
for (const c of cases) {
  const out = await runLoop(c);
  const action = kindToAction(out.endKind);
  const okAction = action === c.expect_action;
  const okScene = !c.expect_scene || out.scenes.includes(c.expect_scene);
  const row = {
    id: c.id,
    text: c.text,
    expect: c.expect_action,
    expect_scene: c.expect_scene || null,
    got: action,
    scenes: out.scenes,
    steps: out.steps.length,
    okAction,
    okScene,
    err: out.err || null,
  };
  rows.push(row);
  console.log(
    `${row.id}    ${row.got.padEnd(8)}  ${String(row.steps).padStart(2)}    ${row.scenes.join(',') || '-'}` +
      (!okAction ? '  ✗动作' : '') +
      (!okScene ? '  ✗场景' : '')
  );
}

const stepCounts = rows.map((r) => r.steps);
const avg = stepCounts.reduce((a, b) => a + b, 0) / stepCounts.length;
const p = p95(stepCounts);
const max = Math.max(...stepCounts);
const bad = rows.filter((r) => !r.okAction || !r.okScene);

console.log('\n=== 步数 ===');
console.log(`  平均 ${avg.toFixed(2)} 步 ｜ P50 ${stepCounts.slice().sort((a, b) => a - b)[Math.floor(stepCounts.length / 2)]} ｜ P95 ${p} 步 ｜ 最大 ${max} 步 ｜ 上限 5`);
console.log(`  多步（≥2）占比 ${rows.filter((r) => r.steps >= 2).length}/${rows.length}`);

const result = {
  at: new Date().toISOString(),
  n: rows.length,
  avg: Number(avg.toFixed(2)),
  p95: p,
  max,
  multiStep: rows.filter((r) => r.steps >= 2).length,
  rows,
};
fs.writeFileSync(
  path.join(ROOT, 'tools', 'eval', 'probe_multi_step_result.json'),
  JSON.stringify(result, null, 2)
);
console.log('明细已存 tools/eval/probe_multi_step_result.json');

if (bad.length || p > 5) {
  console.log('\n失败明细:');
  for (const r of bad) {
    console.log(`  ✗ ${r.id}「${r.text}」期望 ${r.expect}${r.expect_scene ? '/' + r.expect_scene : ''}，实际 ${r.got}/${r.scenes.join(',') || '-'}`);
  }
  if (p > 5) console.log(`  ✗ P95 ${p} 步超过上限 5`);
  console.log('\nFAIL: 多步样本未全过');
  process.exit(1);
}
console.log('\nPASS: 20 条动作/场景正确，P95 ≤ 5');
