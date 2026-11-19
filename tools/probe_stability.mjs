/* =========================================================
   自主循环的稳定性探针
   回答一个问题：**同一句话反复问，结论是否一致？**

   ★ 为什么必须单独测（而不是看准确率）：
     准确率 97% 可能是「稳定的对 97 条 + 稳定的错 3 条」，
     也可能是「每条都在对错之间随机」——两者的准确率一样，但产品表现完全不同。
     后者意味着老人同一句话问两次会得到两个答案，且他不知道为什么。

   ★ 为什么必须 nocache：
     /act 有缓存（键 = text + history 动作摘要）。命中缓存当然 100% 一致，
     但那测的是缓存，不是模型。所以每次请求都带 nocache:true。

   ★ temperature=0 不等于确定性：
     DeepSeek 的 temperature=0 只是「倾向最高概率词」，不保证逐位一致
     （浮点累加顺序、batch 组包、MoE 路由都会引入差异）。
     这一点必须用数据说，不能靠文档承诺。

   用法:
     node tools/probe_stability.mjs                # 默认 12 条 × 5 次
     node tools/probe_stability.mjs --runs=10      # 每条跑 10 次
     node tools/probe_stability.mjs --full         # 全部 100 条 × 3 次
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const ENDPOINT = 'http://127.0.0.1:8787/act';

const argv = process.argv.slice(2);
const runsArg = argv.find((a) => a.startsWith('--runs='));
const RUNS = runsArg ? Number(runsArg.split('=')[1]) : 5;
const FULL = argv.includes('--full');
const VERBOSE = argv.includes('--verbose') || FULL;

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
const AGENT = sandbox.AGENT;

const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'index.json'), 'utf8'));
const SCENE_IDS = index.slots.map((s) => s.id);
const ENTRIES = {};
for (const id of index.slots.filter((s) => s.state === 'ready').map((s) => s.id)) {
  const p = path.join(ROOT, 'knowledge', id + '.json');
  if (!fs.existsSync(p)) continue;
  const e = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (e.status === 'published' || e.status === undefined) ENTRIES[id] = e;
}

/* ---------- 样本选择 ----------
   ★ 不能只挑「明显的」。稳定性的风险全在边界上，所以刻意分层：
     A 极明显（对照组，理应 100% 稳定）
     B 边界（判定在阈值/语义边缘）
     C 已知摇摆过（O005 实测在 ask/refuse 之间变过）
     D 依赖「不许 ask」新规则（上一轮刚改，需确认改后稳定）
     E 库外（该 refuse，但含场景词）                                              */
const PICKS = [
  { id: 'E001', kind: 'A 极明显', text: '煤气漏了' },
  { id: 'E020', kind: 'A 极明显', text: '着火了' },
  { id: 'E008', kind: 'A 极明显', text: '我爸摔倒了' },
  { id: 'P001', kind: 'B 边界', text: '怎么预防煤气泄漏' },
  { id: 'P014', kind: 'B 边界', text: '灭火器怎么选' },
  { id: 'P020', kind: 'B 边界', text: '热水器温度设多少合适' },
  { id: 'E006', kind: 'B 边界', text: '屋里一股怪味不知道是不是漏气' },
  { id: 'O005', kind: 'C 已知摇摆', text: '燃气灶打不着火' },
  { id: 'O008', kind: 'C 已知摇摆', text: '电梯维修电话多少' },
  { id: 'H18', kind: 'D 新规则', text: '倒了倒了，我老伴倒了' },
  { id: 'H2-15', kind: 'D 新规则', text: '老伴倒地上没气了怎么办' },
  { id: 'O001', kind: 'E 库外', text: '煤气费怎么交' },
];

let picks = PICKS;
if (FULL) {
  const cases = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tools', 'eval', 'cases.json'), 'utf8')
  ).cases;
  picks = cases.map((c) => ({ id: c.id, kind: c.group, text: c.text }));
}

/* ---------- 调一次 /act（强制 nocache） ---------- */
async function callAct(text, history) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, history: history || [], nocache: true }),
  }).then((r) => r.json());
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

/* ---------- 跑完整循环一次（与产品同路径） ---------- */
async function runLoopOnce(text) {
  const out = await AGENT.run(
    text,
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
    action: kindToAction(out.endKind),
    acts: out.steps.map((s) => s.act),
    scene: (out.steps.find((s) => s.args && s.args.scene) || {}).args?.scene || null,
    reason: out.reason,
  };
}

/* ---------- 统计工具 ---------- */
function tally(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/* ---------- 主流程 ---------- */
console.log(`=== 自主循环稳定性（${picks.length} 条 × ${RUNS} 次，全部 nocache）===`);
console.log('★ temperature=0 不保证确定性，所以必须实测。\n');

const rows = [];
for (const p of picks) {
  const results = [];
  for (let i = 0; i < RUNS; i++) {
    try {
      results.push(await runLoopOnce(p.text));
    } catch (e) {
      results.push({ action: 'error:' + String(e && e.message), acts: [], scene: null });
    }
  }

  const actions = results.map((r) => r.action);
  const seqs = results.map((r) => r.acts.join('→'));
  const scenes = results.map((r) => r.scene || 'null');

  const actTally = tally(actions);
  const seqTally = tally(seqs);
  const sceneTally = tally(scenes);

  const actStable = actTally.length === 1;
  const seqStable = seqTally.length === 1;
  const sceneStable = sceneTally.length === 1;

  rows.push({
    id: p.id,
    kind: p.kind,
    text: p.text,
    runs: RUNS,
    actTally,
    seqTally,
    sceneTally,
    actStable,
    seqStable,
    sceneStable,
    dominant: actTally[0],
  });

  const mark = actStable && seqStable ? '✓' : '✗';
  console.log(`${mark} ${p.id.padEnd(7)} [${p.kind.padEnd(8)}] 「${p.text}」`);
  if (!actStable) {
    console.log(`     action 不一致: ${actTally.map(([v, n]) => `${v}×${n}`).join(' | ')}`);
  }
  if (!seqStable) {
    console.log(`     动作序列不一致: ${seqTally.map(([v, n]) => `[${v}]×${n}`).join(' | ')}`);
  }
  if (!sceneStable) {
    console.log(`     场景不一致: ${sceneTally.map(([v, n]) => `${v}×${n}`).join(' | ')}`);
  }
  if (actStable && seqStable && VERBOSE) {
    console.log(`     ${actions[0]}  ${seqs[0]}`);
  }
}

/* ---------- 汇总 ----------
   ★★★ 必须区分两种「不稳定」，否则会把轻微问题算成严重问题：

     ① **结局不稳定**（action 变了）= 用户可见。同一句话问两次得到
        不同的卡（步骤卡 vs 拒答卡），而且他不知道为什么。**这是真问题。**

     ② **序列不稳定**（结局相同，但多查一步 / 少查一步）= 用户不可见。
        最坏表现是多等一次往返（实测 ≈950ms）。**这是轻微的，只影响时延。**

     初版把两者混成一个「不稳定」数字，导致 H2-15（5 次结局全是 dialonly，
     只是有 1 次没先 lookup）被算成和 O008（真变了答案）同等级 —— 那不公平，
     也会让后续优化方向错（去优化一个用户根本看不到的东西）。 */
const n = rows.length;
const actStableN = rows.filter((r) => r.actStable).length;
const seqStableN = rows.filter((r) => r.seqStable).length;

/* 逐次一致率：把每条样本的「最常见答案」计为基准，算所有次数的命中比 */
let totalRuns = 0;
let agreeRuns = 0;
for (const r of rows) {
  totalRuns += r.runs;
  agreeRuns += r.dominant[1];
}

console.log('');
console.log('=== 汇总 ===');
console.log(
  `  ① 结局稳定（用户可见）          ${actStableN}/${n}  (${((actStableN / n) * 100).toFixed(0)}%)   ← 这个数是关键`
);
console.log(
  `  ② 动作序列稳定（含时延抖动）     ${seqStableN}/${n}  (${((seqStableN / n) * 100).toFixed(0)}%)   ← 轻微的`
);
console.log(
  `  逐次一致率（多数答案占比）        ${agreeRuns}/${totalRuns}  (${((agreeRuns / totalRuns) * 100).toFixed(1)}%)`
);

/* 只有结局不稳才列进「真问题」 */
const realUnstable = rows.filter((r) => !r.actStable);
const minorUnstable = rows.filter((r) => r.actStable && !r.seqStable);

/* 按层看：边界层是否明显更差 —— 这是「稳定性能不能靠扩大样本解决」的判据 */
console.log('');
console.log('=== 按样本类型 ===');
const kinds = [...new Set(rows.map((r) => r.kind))].sort();
for (const k of kinds) {
  const rs = rows.filter((r) => r.kind === k);
  const st = rs.filter((r) => r.actStable && r.seqStable).length;
  console.log(`  ${k.padEnd(10)} ${st}/${rs.length} 稳定`);
}

const unstable = realUnstable;
console.log('');
if (realUnstable.length) {
  console.log('=== ① 结局不稳定（用户可见，真问题）===');
  for (const r of realUnstable) {
    console.log(`  ✗ ${r.id} 「${r.text}」`);
    console.log(`     action: ${r.actTally.map(([v, c]) => `${v}×${c}`).join(' | ')}`);
  }
} else {
  console.log('=== ① 结局不稳定：0 条（在本次样本与次数下）===');
}

if (minorUnstable.length) {
  console.log('');
  console.log('=== ② 仅序列不稳定（结局相同，只多/少一次往返）===');
  for (const r of minorUnstable) {
    console.log(`  ~ ${r.id} 「${r.text}」结局恒为 ${r.dominant[0]}`);
    console.log(`     序列: ${r.seqTally.map(([v, c]) => `[${v}]×${c}`).join(' | ')}`);
  }
}

const outPath = path.join(ROOT, 'tools', 'eval', 'probe_stability_result.json');
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      endpoint: ENDPOINT,
      runs: RUNS,
      nocache: true,
      note: 'temperature=0 不保证确定性，本结果全部 nocache 实测。样本数少（12 条）时只能看趋势，不能当总体比例。',
      summary: {
        samples: n,
        actStable: actStableN,
        seqStable: seqStableN,
        realUnstable: realUnstable.map((r) => r.id),
        minorUnstable: minorUnstable.map((r) => r.id),
        totalRuns,
        agreeRuns,
        agreeRate: +((agreeRuns / totalRuns) * 100).toFixed(1),
      },
      rows,
    },
    null,
    1
  )
);
console.log(`\n明细已存 tools/eval/probe_stability_result.json`);
