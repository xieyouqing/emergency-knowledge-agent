/* =========================================================
   完整循环探针：/act → checkGate → execute → 再 /act … 直到终态
   依据 docs/03 §2.5.11 的 A6 判据：
     **循环的最终结局不得劣于单次判定（现 96/100）**

   为什么必须跑完整循环，而不是只看首个动作：
     首个动作对 ≠ 结局对。例如先 lookup 对了，但查到 published=false 之后
     又直接 get_steps（越过门），结局就是错的。
     只有跑到终态才能与 cases.json 的 expect_action 对账。

   为什么复用 app/tools.js 而不是重写一遍判据：
     门只能有一处实现。探针若自己写一套 checkGate，测的就不是产品实际用的那条路径
     —— 这正是 2026-11-18 评测脚本踩过的坑（「测的」与「用的」分叉）。

   用法:
     node tools/probe_loop.mjs                 # 全量 100 条
     node tools/probe_loop.mjs --limit=20
     node tools/probe_loop.mjs --verbose
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const ENDPOINT = 'http://127.0.0.1:8787/act';

const argv = process.argv.slice(2);
const limitArg = argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : 0;
/* D-13 = A：--ask=correct 时把「合法的追问」算对。
   默认关闭（B 口径），因为口径切换必须显式，不许默认就按有利口径算。 */
const askArg = argv.find((a) => a.startsWith('--ask='));
const ASK_OK = !!askArg && askArg.split('=')[1] === 'correct';
const VERBOSE = argv.includes('--verbose');

/* ---------- 加载产品代码（只需要 tools.js 与 retrieval.js） ---------- */
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
const RET = sandbox.RETRIEVAL;
if (!TOOLS) {
  console.error('FAIL: tools.js 未导出 TOOLS');
  process.exit(1);
}

/* ---------- 知识库（只取已发布条目，与前端产物一致） ---------- */
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'index.json'), 'utf8'));
const SCENE_IDS = index.slots.map((s) => s.id);
const ENTRIES = {};
for (const id of index.slots.filter((s) => s.state === 'ready').map((s) => s.id)) {
  const p = path.join(ROOT, 'knowledge', id + '.json');
  if (!fs.existsSync(p)) continue;
  const e = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (e.status === 'published' || e.status === undefined) ENTRIES[id] = e;
}

const cases = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tools', 'eval', 'cases.json'), 'utf8')
).cases;
const list = LIMIT ? cases.slice(0, LIMIT) : cases;

/* ---------- 调 /act ---------- */
async function callAct(text, history) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, history: history.slice(-6) }),
  }).then((x) => x.json());
  return r;
}

/* ---------- 把终态映射成 cases.json 的 action 口径 ---------- */
function kindToAction(kind) {
  if (kind === 'steps') return 'steps';
  if (kind === 'daily') return 'daily';
  if (kind === 'dial') return 'dialonly';
  if (kind === 'refuse') return 'refuse';
  if (kind === 'triage') return 'steps'; // 分诊是步骤卡的前置形态，口径同类
  /* ask 单独一档，不折算成 steps 也不算 unknown：
     它是「追问」，在设计上合法（仅当 scene 已定、intent 未定时可用），
     但旧评测集（cases.json）没有这一列 —— 口径分歧必须暴露出来，
     不许悄悄折算成 steps 让数字变好看。 */
  if (kind === 'ask') return 'ask';
  return 'unknown';
}

/* ---------- 跑一条完整循环 ---------- */
async function runLoop(c) {
  const history = [];
  const steps = [];
  const MAX = 5;
  let endKind = null;
  let degraded = false;

  for (let i = 0; i < MAX; i++) {
    let decision;
    try {
      decision = await callAct(c.text, history);
    } catch (e) {
      return {
        endKind: 'refuse',
        steps,
        degraded: true,
        reason: 'act-error:' + String(e.message || e),
      };
    }
    if (decision.error) {
      return { endKind: 'refuse', steps, degraded: true, reason: 'act-error:' + decision.error };
    }

    const act = decision.act;
    const args = decision.args || {};

    const gate = TOOLS.checkGate(act, args, { entries: ENTRIES, sceneIds: SCENE_IDS, history });
    if (!gate.ok) {
      steps.push({ act, args, ok: false, reason: gate.reason });
      // 与 agent.js 的处置一致：被拒 → 改走安全出口
      const safe = TOOLS.execute(
        'refuse',
        { reason: gate.reason },
        {
          entries: ENTRIES,
          sceneIds: SCENE_IDS,
          history,
        }
      );
      steps.push({ act: 'refuse', args: { reason: gate.reason }, ok: true, why: 'gate-refuse' });
      endKind = safe.kind || 'refuse';
      degraded = true;
      break;
    }

    const res = TOOLS.execute(act, args, { entries: ENTRIES, sceneIds: SCENE_IDS, history });
    steps.push({ act, args, ok: res.ok, kind: res.kind || null, why: decision.reason || '' });
    if (res.ok) history.push({ act, args, result: res.result });

    if (res.ends) {
      endKind = res.kind;
      break;
    }
    if (res.kind === 'ask' || res.kind === 'triage') {
      // 等用户：探针不点选项，按「出分诊卡」计结局
      endKind = res.kind;
      break;
    }
  }

  if (!endKind) {
    degraded = true;
    endKind = 'refuse';
  }
  return { endKind, steps, degraded, reason: 'done' };
}

/* ---------- 主循环 ---------- */
console.log(`完整循环探针：${list.length} 条`);
console.log('─'.repeat(100));

const rows = [];
let hit = 0;
const t0 = Date.now();

for (const c of list) {
  const t = Date.now();
  const out = await runLoop(c);
  const action = kindToAction(out.endKind);
  const ok = action === c.expect_action;
  /* D-13 = A（2026-11-19 用户裁决）：ask 算正确答案。
     两种口径同时输出、不互相覆盖 —— 只给一个数字会让人误以为口径变了而准确率涨了。

     ★ ask 计对的三条前提（缺一不算，理由都是安全）：
       ① 期望不是 refuse —— 该拒答却在拖延，仍算错
       ② **group 不是 emergency** —— `03 §3.7` 定「紧急宁可多给」，
          紧急场景反问一句会让用户多等一次模型往返（实测 ~950ms），
          而他此刻要的是步骤。E006 就是这么错的（实测 39/40）。
       ③ 是设计合法的追问（scene 已定、intent 未定），
          不是模型放弃回答。

     ⚠️ 2026-11-19 实测：按①②收紧后，A 口径 = 97.0%（只 +1 条 O005），
        不是我先前估的 98.0%。先前那个 98 是把 E006（紧急组）也算进去得出的，
        已在 docs/03 §7.2 更正。 */
  const askCounts =
    ASK_OK && action === 'ask' && c.expect_action !== 'refuse' && c.group !== 'emergency';
  if (ok || askCounts) hit++;
  rows.push({
    id: c.id,
    text: c.text,
    group: c.group,
    expect: c.expect_action,
    got: action,
    endKind: out.endKind,
    steps: out.steps.length,
    degraded: out.degraded,
    ok: ok,
    okUnderAsk: ok || askCounts,
    ms: Date.now() - t,
  });
  if (VERBOSE) {
    console.log(
      `${ok ? '✓' : '✗'} ${c.id} 期望=${String(c.expect_action).padEnd(9)} 实得=${String(action).padEnd(9)} 步数=${out.steps.length} ${Date.now() - t}ms  「${c.text}」`
    );
  }
}

const n = rows.length;
const acc = (hit / n) * 100;
/* 两种口径的对照数字，永远一起打印。
   只打印一个会让人误以为「准确率涨了」，其实是口径变了。 */
const hitAsk = rows.filter((r) => r.okUnderAsk).length;
const askOnly = rows.filter((r) => !r.ok && r.okUnderAsk).length;
const accAsk = (hitAsk / n) * 100;
const avgSteps = rows.reduce((s, r) => s + r.steps, 0) / n;
const stepSorted = rows.map((r) => r.steps).sort((a, b) => a - b);
const p95Steps = stepSorted[Math.min(n - 1, Math.floor(n * 0.95))];
const degradedCount = rows.filter((r) => r.degraded).length;
const totalSec = ((Date.now() - t0) / 1000).toFixed(0);

console.log('');
console.log('=== 结果 ===');
console.log(
  `  A6 最终结局准确率   ${acc.toFixed(1)}%  (${hit}/${n})   ← B 口径（ask 算错）   对照单次判定 96.0%  ${acc >= 96 ? '✓ 不劣' : '✗ 变差'}`
);
console.log(
  `  A6 同上、A 口径     ${accAsk.toFixed(1)}%  (${hitAsk}/${n})   ← D-13=A（合法 ask 算对，+${askOnly} 条）`
);
console.log(
  `     当前按 ${ASK_OK ? 'A' : 'B'} 口径判定门禁：${(ASK_OK ? accAsk : acc) >= 96 ? '✓ 不劣于 96/100' : '✗ 低于 96/100'}`
);
console.log(`  A5 平均步数 ${avgSteps.toFixed(2)}  P95 ${p95Steps} 步（上限 5）`);
console.log(
  `  A7 降级率           ${((degradedCount / n) * 100).toFixed(1)}%  (${degradedCount}/${n})   门槛 ≤ 10%  ${degradedCount / n <= 0.1 ? '✓' : '✗'}`
);
console.log(`  总耗时 ${totalSec}s`);

const byGroup = {};
for (const r of rows) {
  byGroup[r.group] = byGroup[r.group] || { n: 0, ok: 0 };
  byGroup[r.group].n++;
  if (r.ok) byGroup[r.group].ok++;
}
console.log('');
console.log('=== 分组 ===');
for (const [g, v] of Object.entries(byGroup)) {
  console.log(`  ${g.padEnd(12)} ${v.ok}/${v.n}  ${((v.ok / v.n) * 100).toFixed(0)}%`);
}

const asks = rows.filter((r) => r.got === 'ask');
const misses = rows.filter((r) => !r.ok && r.got !== 'ask');
if (asks.length) {
  console.log('');
  console.log(`=== 追问分支 ${asks.length} 条（设计上合法，但旧评测集无此口径）===`);
  asks.forEach((r) =>
    console.log(`  ? ${r.id} 期望=${r.expect} 实得=ask 步数=${r.steps} 「${r.text}」`)
  );
}

if (misses.length) {
  console.log('');
  console.log(`=== 未命中 ${misses.length} 条 ===`);
  misses.forEach((r) => {
    console.log(
      `  ✗ ${r.id} 期望=${r.expect} 实得=${r.got}(${r.endKind}) 步数=${r.steps} 「${r.text}」`
    );
  });
}

fs.writeFileSync(
  path.join(ROOT, 'tools', 'eval', 'probe_loop_result.json'),
  JSON.stringify(
    { at: new Date().toISOString(), n, acc, avgSteps, p95Steps, degradedCount, rows },
    null,
    1
  ),
  'utf8'
);
console.log('');
console.log('明细已存 tools/eval/probe_loop_result.json');
process.exitCode = acc >= 96 ? 0 : 1;
