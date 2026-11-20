/* =========================================================
   多轮交互探针：量化「加记忆到底有没有用」
   依据 docs/03 §2.6 会话记忆判据 M1，用例见 tools/eval/cases_multi_turn.json

   ★ 为什么必须有这个脚本（先回答「有没有覆盖」）：
     现有两个用例集**全是单轮** ——
       cases.json（100 条）：字段 id/text/group/expect_* ，没有 history/turns/context
       cases_multi_turn.json（本文件配套）：新造，此前不存在
     现有测试脚本也全是单轮调用：grep 'handleQuery(' 只有单次调用，
     从来没有「连问两句」的用例。所以**跨轮对话此前零覆盖**。

   ★ 本脚本回答的问题不是「多步工具有没有跑」，而是：
       **用户分两句说，产品能不能接上？**
     这两件事容易混：
       单轮内多步 = 一轮里 lookup → get_steps（probe_loop 已测，71/100 是 2 步）
       跨轮对话   = 用户说两句，第二轮依赖第一轮（本脚本测，此前零覆盖）

   两种模式对比（这是本脚本的核心）：
     A 无记忆（== 现状产品行为）：只把 turns[last] 发出去
     B 拼接上文（朴素记忆）：把 turns.join('。') 发出去
   两者差多少，就是「记忆」这件事的可测量收益。

   用法:
     node tools/probe_multi_turn.mjs              # 两种模式都跑
     node tools/probe_multi_turn.mjs --mode=none  # 只跑无记忆
     node tools/probe_multi_turn.mjs --verbose
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const ENDPOINT = 'http://127.0.0.1:8787/act';

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const NOCACHE = argv.includes('--nocache');
const modeArg = argv.find((a) => a.startsWith('--mode='));
const MODE = modeArg ? modeArg.split("=")[1] : "both";

/* ---------- 加载产品代码 ---------- */
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
const TOOLS = sandbox.TOOLS;
const AGENT = sandbox.AGENT;
if (!TOOLS) {
  console.error('FAIL: tools.js 未导出 TOOLS');
  process.exit(1);
}
if (!AGENT) {
  /* 必须打产品代码，不许本脚本自己写一套循环。
     ⚠️ 2026-11-19 修正：第一版自己写了 for 循环（照抄 probe_loop 的结构），
     于是 agent.js 里新增的「防绕圈」对它**不生效** —— 探针测的不是产品路径。
     这正是 probe_loop.mjs 注释里已经警告过的坑（「测的」与「用的」分叉），
     我在新文件里又犯了一次。 */
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

const multi = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tools', 'eval', 'cases_multi_turn.json'), 'utf8')
).cases;

/* ---------- 调 /act ---------- */
async function callAct(text, history, context) {
  const body = { text, history: (history || []).slice(-6) };
  /* context 只在 C 模式带。A/B 不带 —— 它们必须与历史基线逐字一致，
     否则今天这次跑出来的 A/B 数字和 2026-11-19 那批就没法对照了。 */
  if (context && context.utterances && context.utterances.length) body.context = context;
  /* --nocache：多轮重复跑时**必须**加，否则第二轮起全部命中代理的 actCache，
     三遍跑出三份完全相同的数字，看起来「很稳」，实际一次都没重新问过模型。
     本项目已经踩过同类的坑（probe_stability 的摇摆只在未命中时出现）。 */
  if (NOCACHE) body.nocache = true;
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((x) => x.json());
}

function kindToAction(kind) {
  if (kind === 'steps') return 'steps';
  if (kind === 'daily') return 'daily';
  if (kind === 'dial') return 'dialonly';
  if (kind === 'refuse') return 'refuse';
  if (kind === 'triage') return 'steps';
  if (kind === 'ask') return 'ask';
  if (kind === 'ack') return 'ack';
  return 'unknown';
}

/* ---------- 跑一条完整循环（走产品 AGENT.run，不自己写循环） ----------
   ★ 走产品路径的理由：只有这样才能测到 agent.js 里的
     前置条件门、防绕圈、步数上限、安全出口收敛 —— 本脚本一旦自己写 for 循环，
     那些逻辑全部绕过，测出来的数字与线上行为无关。 */
async function runLoop(text, context) {
  const out = await AGENT.run(
    text,
    { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
    {
      decide(t, ctx2) {
        return callAct(t, ctx2.history, context).then((r) => {
          if (!r || !r.act) throw new Error((r && r.error) || 'no-act');
          return { act: r.act, args: r.args, why: r.reason };
        });
      },
      exec() {},
    }
  );
  return {
    endKind: out.endKind || (out.reason === 'decide-error' ? 'error' : 'unknown'),
    acts: out.steps.map((s) => s.act),
    reason: out.reason,
    error: out.reason === 'decide-error' ? 'decide-error' : null,
  };
}

/* ---------- 两种模式的输入构造 ----------
   A 无记忆：只发最后一轮 —— 这就是**现状产品**的行为。
     证据：app.js 的 runActLoop 每次都 `var history = []`，
     而 history 装的是工具轨迹不是对话历史；跨轮之间没有任何字段传递。
     LLM.act(text, history) 的 history 也只在单轮内累积。
   B 拼接上文：把前面几轮用句号连起来。这是最朴素的记忆方案，
     §2.6 已裁决**不做前端拼接**（会污染时态/否定），所以 B 只作对照基线，
     不是推荐实现。 */
function buildInput(c, mode) {
  if (mode === 'none') return { text: c.turns[c.turns.length - 1], ctx: null };
  if (mode === 'concat') return { text: c.turns.join('。'), ctx: null };
  /* C 分区注入（2026-11-20 新增）：当前句原样发，前面几轮放 context.utterances，
     由代理在 prompt 里**分区呈现**，而不是拼成一个字符串。
     ⚠️ 与 B 的唯一差别就是「分区 vs 拼接」这一件事 —— 输入内容完全相同（同样的原话），
     所以两者差值能且只能归因于分区本身。这是本模式存在的理由。 */
  const cur = c.turns[c.turns.length - 1];
  const prev = c.turns.slice(0, -1);
  return { text: cur, ctx: prev.length ? { utterances: prev } : null };
}

/* ---------- 跑一种模式 ---------- */
async function runMode(mode) {
  const rows = [];
  for (const c of multi) {
    const { text, ctx } = buildInput(c, mode);
    const t0 = Date.now();
    const out = await runLoop(text, ctx);
    const got = kindToAction(out.endKind);
    const actionOk = got === c.expect.final_action;
    rows.push({
      id: c.id,
      group: c.group,
      turns: c.turns,
      input: text,
      ctx: ctx ? ctx.utterances : null,
      expect: c.expect.final_action,
      expectScene: c.expect.final_scene,
      got,
      acts: out.acts,
      needsContext: c.expect.needs_context,
      ok: actionOk,
      ms: Date.now() - t0,
      error: out.error || null,
    });
    if (VERBOSE) {
      console.log(
        `  ${actionOk ? '✓' : '✗'} ${c.id} 期望=${String(c.expect.final_action).padEnd(9)} 实得=${String(got).padEnd(9)} ${out.acts.join('→')}  「${text}」`
      );
    }
  }
  return rows;
}

/* ---------- 主流程 ---------- */
const LABEL = {
  none: 'A 无记忆（现状产品行为）',
  concat: 'B 拼接上文（朴素记忆）',
  partition: 'C 分区注入（context）',
};
const modes = MODE === 'both' ? ['none', 'concat', 'partition'] : [MODE];
const results = {};

for (const m of modes) {
  if (VERBOSE) console.log(`\n=== 模式 ${LABEL[m] || m} ===`);
  results[m] = await runMode(m);
}

console.log('\n★ 评测路径: /act 自主循环（模型选工具，完整循环）');
console.log('⚠️ 与 run_eval --engine=llm（/judge 单次判定）不是同一条路，数字不能互换。');
console.log('\n=== 结果 ===');

const n = multi.length;
for (const m of modes) {
  const rows = results[m];
  const ok = rows.filter((r) => r.ok).length;
  const errs = rows.filter((r) => r.error).length;
  console.log(
    `  ${(LABEL[m] || m).padEnd(26)} 结局正确 ${ok}/${n} (${((ok / n) * 100).toFixed(0)}%)  模型失效 ${errs}`
  );
}

/* 关键分组：needs_context 的样本才是记忆的目标人群 */
for (const m of modes) {
  const rows = results[m].filter((r) => r.needsContext);
  const ok = rows.filter((r) => r.ok).length;
  console.log(
    `  ${((LABEL[m] || m) + ' · needs_ctx').padEnd(30)} ${ok}/${rows.length} (${((ok / rows.length) * 100).toFixed(0)}%)`
  );
}

/* 对照组：不需要上文的样本，加记忆后**不该变差** */
const ctl = multi.filter((c) => !c.expect.needs_context).map((c) => c.id);
if (ctl.length) {
  console.log('');
  console.log('=== 对照组（自足句，不该被记忆伤害）===');
  for (const m of modes) {
    const r = results[m].find((x) => x.id === ctl[0]);
    console.log(
      `  ${(LABEL[m] || m).padEnd(26)} ${r.id} 期望=${r.expect} 实得=${r.got}  ${r.ok ? '✓' : '✗'}`
    );
  }
}

console.log('');
console.log('=== 明细 ===');
for (const m of modes) {
  console.log(`\n[${LABEL[m] || m}]`);
  for (const r of results[m]) {
    const mark = r.ok ? '✓' : '✗';
    console.log(
      `  ${mark} ${r.id} [${r.group}] 期望=${String(r.expect).padEnd(9)} 实得=${String(r.got).padEnd(9)} ${r.acts.join('→')}`
    );
  }
}

const outPath = path.join(ROOT, 'tools', 'eval', 'probe_multi_turn_result.json');
fs.writeFileSync(
  outPath,
  JSON.stringify({ generated: new Date().toISOString(), endpoint: ENDPOINT, results }, null, 1)
);
console.log(`\n明细已存 tools/eval/probe_multi_turn_result.json`);
