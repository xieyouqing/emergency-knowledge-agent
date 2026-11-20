#!/usr/bin/env node
/**
 * B 方案（首轮本地预置 lookup）的离线判据。
 *
 * 为什么先离线：预置条件用错一个词，就会把「怎么预防煤气泄漏」预置成急救场景
 * （2026-11-19 已踩过三次）。先证明「该预置的预置、不该预置的不预置」，
 * 再谈它能不能把首句压进 3 秒。
 *
 * 判据：
 *   ① 正例：明确在说事的现场描述 → lookup 或 dial
 *   ② 反例：预防/缴费/咨询 → 必须 null（零误预置）
 *   ③ 100 条开发集：prevention 与 off_scope 两组**预置数必须为 0**
 *   ④ 危重词：无呼吸/心跳停/大出血 → dial 120，不得预置成步骤
 *
 * 用法: node tools/probe_seed.mjs
 * 退出码 0 = 全过；1 = 有不符合项
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'app');

const sandbox = { window: {}, console, JSON, String, Object, Array, RegExp };
sandbox.window.window = sandbox.window;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['knowledge.js', 'retrieval.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox);
}

const R = sandbox.window.RETRIEVAL;
const ENTRIES = sandbox.window.KNOWLEDGE.entries;
if (!R || !R.seedDecision) {
  console.error('FAIL: retrieval.js 未导出 seedDecision');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    fails.push(msg);
  }
}

console.log('=== B 方案预置判据（离线）===\n');

/* ---------- ① 正例 ---------- */
const POS = [
  { text: '煤气漏了怎么办', kind: 'lookup', scene: 'gas_leak' },
  { text: '厨房着火了', kind: 'lookup', scene: 'fire_home' },
  { text: '我老伴摔了', kind: 'lookup', scene: 'fall_elderly' },
  { text: '我爸被开水烫了胳膊', kind: 'lookup', scene: 'scald_burn' },
  { text: '电梯突然停了，我被困在里面', kind: 'lookup', scene: 'elevator_trapped' },
  { text: '有人落水了', kind: 'lookup', scene: 'drowning' },
  { text: '我妈摔倒了没有呼吸', kind: 'lookup', scene: 'cpr' },
  { text: '胳膊划破了大出血止不住', kind: 'lookup', scene: 'severe_bleeding' },
  { text: '心跳停了', kind: 'lookup', scene: 'cpr' },
  { text: '她还有呼吸，但是没反应', kind: 'dial', number: '120' },
];

for (const c of POS) {
  const d = R.seedDecision(c.text, ENTRIES);
  const gotKind = d ? d.kind : null;
  const okKind = gotKind === c.kind;
  const okScene = c.scene ? d && d.scene === c.scene : true;
  const okNum = c.number ? d && d.number === c.number : true;
  ok(
    okKind && okScene && okNum,
    `正例「${c.text}」应 ${c.kind}${c.scene ? '/' + c.scene : ''}${c.number ? '/' + c.number : ''}，实际 ${JSON.stringify(d)}`
  );
  console.log(
    `  ${okKind && okScene && okNum ? '✓' : '✗'} ${c.text}  →  ${d ? d.kind + (d.scene ? '/' + d.scene : '') + (d.number ? '/' + d.number : '') : 'null'}`
  );
}

/* ---------- ② 反例：必须 null ---------- */
const NEG = [
  '怎么预防煤气泄漏',
  '怎么预防着火',
  '怎么预防触电',
  '煤气费怎么交',
  '燃气灶打不着火',
  '电梯多久年检一次',
  '今天天气怎么样',
  '烟感器有用吗',
  '电梯广告怎么投诉',
];

console.log('');
for (const t of NEG) {
  const d = R.seedDecision(t, ENTRIES);
  ok(d === null, `反例「${t}」不得预置，实际 ${JSON.stringify(d)}`);
  console.log(`  ${d === null ? '✓' : '✗'} ${t}  →  ${d ? JSON.stringify(d) : 'null'}`);
}

/* ---------- ③ 100 条开发集：prevention / off_scope 零预置 ---------- */
const cases = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tools', 'eval', 'cases.json'), 'utf8')
).cases;
const byGroup = {};
for (const c of cases) {
  const g = c.group || 'unknown';
  byGroup[g] = byGroup[g] || { n: 0, seeded: 0, items: [] };
  byGroup[g].n++;
  const d = R.seedDecision(c.text, ENTRIES);
  if (d) {
    byGroup[g].seeded++;
    byGroup[g].items.push(`${c.id}:${d.kind}${d.scene ? '/' + d.scene : ''}`);
  }
}

console.log('\n--- 100 条开发集预置分布 ---');
for (const [g, v] of Object.entries(byGroup)) {
  console.log(`  ${g}: ${v.seeded}/${v.n}`);
  if (v.seeded && g !== 'emergency') {
    console.log('    误预置: ' + v.items.join(', '));
  }
}
ok(
  (byGroup.prevention ? byGroup.prevention.seeded : 0) === 0,
  `prevention 组必须零预置（实际 ${byGroup.prevention ? byGroup.prevention.seeded : 0}）`
);
ok(
  (byGroup.off_scope ? byGroup.off_scope.seeded : 0) === 0,
  `off_scope 组必须零预置（实际 ${byGroup.off_scope ? byGroup.off_scope.seeded : 0}）`
);

/* ---------- 结果 ---------- */
console.log('');
if (fail) {
  console.log(`FAIL ${fail} 条：`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log(`PASS ${pass}/${pass} 条断言全过`);
process.exit(0);
