/* =========================================================
   留出集评测（held-out）：估计泛化能力，**只跑一次**
   用例：tools/eval/cases_heldout.json（42 条，与 cases.json 零重复）

   ★ 为什么要这个脚本（docs/08 P17）：
     现有 100 条同时是开发集与测试集 —— 本轮为修 E006/O005 改过两次 prompt、
     各跑一次全量。所以 98% 是「在本集上不掉」，不是泛化能力。
     本脚本的目的是拿一个**没被调参污染**的数字。

   ★ 纪律（写进代码，不只是文档）：
     跑出的数字不论好坏，都不许据此改 prompt。
     要改就必须在本脚本输出里留痕「该集已污染」，并另造新集。
     所以本脚本**不做任何参数化** —— 没有 --threshold、没有 --prompt 之类
     可以现场调的旋钮。有旋钮就会有人拧。

   ★ 两个数字必须同时报：
     全部 42 条 / 剔除 debatable 后。只报一个会掩盖标注分歧 ——
     标不准的题被算进准确率，等于用我的判断冒充产品能力。

   用法:
     node tools/probe_heldout.mjs
     node tools/probe_heldout.mjs --verbose
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const ENDPOINT = 'http://127.0.0.1:8787/act';

const argv = process.argv.slice(2);
const fileArg = argv.find((a) => a.startsWith('--file='));
/* 默认用 v2。v1 因 2026-11-19 修 P18 改过 prompt 而**已污染**，
   它的历史结果保留在 probe_heldout_result.json 里作为「改前基线」引用，
   但不许再用来报泛化能力（见 cases_heldout_v2.json 的 meta.contamination_note）。 */
const CASES_FILE = fileArg ? fileArg.split('=')[1] : 'cases_heldout_v2.json';
const VERBOSE = argv.includes('--verbose');

/* ---------- 加载产品代码（与 probe_loop / probe_multi_turn 同口径） ---------- */
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
for (const f of ['retrieval.js', 'tools.js', 'agent.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox);
}
const AGENT = sandbox.AGENT;
if (!AGENT) {
  console.error('FAIL: agent.js 未导出 AGENT');
  process.exit(1);
}

/* ---------- 知识库 ---------- */
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'index.json'), 'utf8'));
const SCENE_IDS = index.slots.map((s) => s.id);
const ENTRIES = {};
for (const id of index.slots.filter((s) => s.state === 'ready').map((s) => s.id)) {
  const p = path.join(ROOT, 'knowledge', id + '.json');
  if (!fs.existsSync(p)) continue;
  const e = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (e.status === 'published' || e.status === undefined) ENTRIES[id] = e;
}

const file = path.join(ROOT, 'tools', 'eval', CASES_FILE);
if (!fs.existsSync(file)) {
  console.error(`FAIL: 找不到用例文件 ${CASES_FILE}`);
  process.exit(1);
}
const cases = JSON.parse(fs.readFileSync(file, 'utf8')).cases;
/* 污染标记：文件名含 _v2 之外的旧集一律提示，防止误用已污染集报数。 */
const CONTAMINATED = /^cases_heldout\.json$/.test(CASES_FILE);
if (CONTAMINATED) {
  console.warn('');
  console.warn(`⚠️  ${CASES_FILE} 已于 2026-11-19 被污染（跑完后按结果改过 ACT_PROMPT）。`);
  console.warn('    本结果只能当「改前基线」，不许对外报泛化能力。新集见 cases_heldout_v2.json。');
  console.warn('');
}

/* ---------- 调 /act ---------- */
async function callAct(text, history) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, history: (history || []).slice(-6) }),
  }).then((x) => x.json());
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

/* ---------- 跑一条：走产品 AGENT.run，不自己写循环 ---------- */
async function runOne(c) {
  const t0 = Date.now();
  const out = await AGENT.run(
    c.text,
    { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
    {
      decide(t, ctx) {
        return callAct(t, ctx.history).then((r) => {
          if (!r || !r.act) throw new Error((r && r.error) || 'no-act');
          return { act: r.act, args: r.args, why: r.reason };
        });
      },
      exec() {},
    }
  );
  return {
    got: kindToAction(out.endKind),
    acts: out.steps.map((s) => s.act),
    reason: out.reason,
    ms: Date.now() - t0,
  };
}

/* ---------- 主流程 ---------- */
console.log(`=== 留出集评测（${cases.length} 条）===`);
console.log('★ 只跑一次。跑出的数字不许用来调 prompt —— 调了就不是留出集了。\n');

const rows = [];
for (const c of cases) {
  const out = await runOne(c);
  const ok = out.got === c.expect_action;
  rows.push({
    id: c.id,
    group: c.group,
    text: c.text,
    phenomenon: c.phenomenon,
    expect: c.expect_action,
    expectScene: c.expect_scene,
    got: out.got,
    acts: out.acts,
    ok,
    debatable: !!c.debatable,
    debatableReason: c.debatable_reason || null,
    ms: out.ms,
  });
  if (VERBOSE) {
    console.log(
      `  ${ok ? '✓' : '✗'} ${c.id} [${c.group.padEnd(10)}] 期望=${String(c.expect_action).padEnd(9)} 实得=${String(out.got).padEnd(9)} ${out.acts.join('→')}  「${c.text}」`
    );
  }
}

/* ---------- 统计 ---------- */
const n = rows.length;
const hit = rows.filter((r) => r.ok).length;
const solid = rows.filter((r) => !r.debatable);
const solidHit = solid.filter((r) => r.ok).length;

console.log('');
console.log('★ 评测路径: /act 自主循环（模型选工具，完整循环）');
console.log('⚠️ 与 run_eval --engine=llm（/judge 单次判定）不是同一条路，数字不能互换。');
console.log('=== 结果 ===');
console.log(`  全部 ${n} 条            ${hit}/${n}  (${((hit / n) * 100).toFixed(1)}%)`);
console.log(
  `  剔除 debatable（${solid.length} 条）  ${solidHit}/${solid.length}  (${((solidHit / solid.length) * 100).toFixed(1)}%)   ← 这个数更能代表真实能力`
);
console.log(
  `  其中 debatable ${n - solid.length} 条  ${rows.filter((r) => r.debatable && r.ok).length}/${n - solid.length}`
);

console.log('');
console.log('=== 分组 ===');
const groups = ['emergency', 'prevention', 'off_scope'];
for (const g of groups) {
  const rs = rows.filter((r) => r.group === g);
  const ok = rs.filter((r) => r.ok).length;
  /* 安全项单独看：紧急组漏给（该 steps/dialonly 却 refuse）是最贵的一类错 */
  const missSteps =
    g === 'emergency' ? rs.filter((r) => r.expect !== 'refuse' && r.got === 'refuse').length : null;
  const falseAccept =
    g === 'off_scope' ? rs.filter((r) => r.got === 'steps' || r.got === 'daily').length : null;
  let extra = '';
  if (missSteps !== null) extra = `  ③紧急漏给=${missSteps}`;
  if (falseAccept !== null) extra = `  ④库外误纳=${falseAccept}`;
  console.log(
    `  ${g.padEnd(11)} ${ok}/${rs.length}  (${((ok / rs.length) * 100).toFixed(0)}%)${extra}`
  );
}

/* ---------- 失败明细：按语言现象归并，便于定位原因 ---------- */
const misses = rows.filter((r) => !r.ok);
if (misses.length) {
  console.log('');
  console.log('=== 未命中明细 ===');
  for (const r of misses) {
    console.log(`  ✗ ${r.id} [${r.group}] 期望=${r.expect} 实得=${r.got}  ${r.acts.join('→')}`);
    console.log(`      「${r.text}」`);
    console.log(`      现象: ${r.phenomenon}`);
    if (r.debatable) console.log(`      ⚠ debatable: ${r.debatableReason}`);
  }
}

/* ---------- 落盘 ---------- */
/* 结果按用例文件分开存：v1 的结果是「改前基线」，不许被 v2 覆盖。
   v1 保持原名 probe_heldout_result.json（历史文件，兼容既有引用）；
   v2 及之后的版本在名字里带上集号。 */
const outName = CONTAMINATED
  ? 'probe_heldout_result.json'
  : 'probe_heldout_' +
    CASES_FILE.replace(/^cases_heldout_?/, '').replace(/\.json$/, '') +
    '_result.json';
const outPath = path.join(ROOT, 'tools', 'eval', outName);
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      endpoint: ENDPOINT,
      note: '本结果集只跑一次。若据本结果改过 prompt，必须在 docs/08 P17 标注「已污染」。',
      summary: {
        total: n,
        hit,
        acc: +((hit / n) * 100).toFixed(1),
        solidTotal: solid.length,
        solidHit,
        solidAcc: +((solidHit / solid.length) * 100).toFixed(1),
      },
      rows,
    },
    null,
    1
  )
);
console.log(`\n明细已存 tools/eval/${outName}`);
