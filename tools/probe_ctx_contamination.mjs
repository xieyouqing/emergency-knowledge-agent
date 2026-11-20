/* =========================================================
   上文污染探针：测「以这句为准」这条裁决指令是保护还是有害
   2026-11-20 新增，依据 docs/03 §2.6.9 消融实验的遗留问题

   ★ 为什么不能用 100 条单轮直接测：
     单轮用例不带 context，代理那条注入分支**整段不执行**，
     所以拿 100 条裸跑，加不加这句指令结果完全一样 —— 测了个空。
     要测副作用，必须造出「上文与当前句冲突」的条件。

   ★ 本探针怎么做：
     给 100 条**每一条**都塞一句「别的场景」的现场描述当上文
     （例如问「电梯停电安全吗」，上文塞「煤气漏了」），
     然后看当前句还能不能压过上文。
     判据不是「有没有被污染」——被污染是必然的，
     而是**加了裁决指令（full）比不加（raw）少掉多少**。

   两种 arm：
     ① baseline    无上文           —— 该条原本的水平
     ② contaminated 上文=他场景威胁  —— 污染后的水平

   三种样式由**代理侧环境变量**决定，本脚本不传：
     ACT_CTX_STYLE=full（默认，含「以这句为准」）/ raw（纯上文无标签）
     用法：先在代理侧定好 style，再跑本脚本，输出会打印当前 style 仅作标注。

   用法:
     node tools/probe_ctx_contamination.mjs
     node tools/probe_ctx_contamination.mjs --limit=20
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
/* ⚠️ 样式必须由 argv 显式给，**不能用 process.env.ACT_CTX_STYLE**。
   2026-11-20 踩过：那个环境变量只设在代理进程里，探针进程读不到，
   于是两次跑都写了同一个 `_full.json`，raw 的结果把 full 的覆盖了。
   这类「产物互相覆盖」比结果错更难发现——文件还在，内容已经不是那一次的了。 */
const styleArg = argv.find((a) => a.startsWith('--style='));
const STYLE = styleArg ? styleArg.split('=')[1] : 'unlabeled';

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
for (const f of ['retrieval.js', 'tools.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox);
}
const TOOLS = sandbox.TOOLS;
if (!TOOLS) {
  console.error('FAIL: tools.js 未导出 TOOLS');
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

/* ---------- 污染源：每个场景一句典型现场描述 ----------
   选它作污染源的理由：都是「紧急 + 明确场景词」的强锚点。
   弱锚点（如「有点不舒服」）污染不了，测不出上限。 */
const ANCHORS = [
  ['gas_leak', '家里闻到很浓的煤气味，煤气漏了'],
  ['fire_home', '厨房着火了，火很大'],
  ['co_poisoning', '用炭火取暖，现在头晕恶心'],
  ['fall_elderly', '老人摔倒了，站不起来'],
  ['scald_burn', '手被开水烫了，起了大水泡'],
  ['electric_shock', '有人触电了，倒在地上'],
  ['airway_obstruction', '吃饭噎住了，说不出话'],
  ['earthquake', '地震了，房子在晃'],
  ['elevator_trapped', '电梯停了，我被困在里面'],
];

/* 为一条用例挑污染源：跳过与本条期望场景相同的那条（那不是污染，是同一件事） */
function pickAnchor(c, idx) {
  const pool = ANCHORS.filter((a) => a[0] !== c.expect_scene);
  return pool[idx % pool.length];
}

const cases = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tools', 'eval', 'cases.json'), 'utf8')
).cases;
const list = LIMIT ? cases.slice(0, LIMIT) : cases;

async function callAct(text, history, context) {
  const body = { text, history: (history || []).slice(-6), nocache: true };
  if (context) body.context = context;
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
  return 'unknown';
}

/* 与 probe_loop 同一套循环结构（复用的是同一条产品路径） */
async function runLoop(c, context) {
  const history = [];
  const steps = [];
  const MAX = 5;
  let endKind = null;

  for (let i = 0; i < MAX; i++) {
    let d;
    try {
      d = await callAct(c.text, history, context);
    } catch (e) {
      return { endKind: 'refuse', steps, err: String(e.message || e) };
    }
    if (d.error) return { endKind: 'refuse', steps, err: d.error };

    /* 与 agent.js 的上文证据闸一致：证据没落在当前句，且当前句不是纯追问
       → 模型拿上文当现场，拒答（P33 / O030）。 */
    if (d.evidence) {
      const evN = String(d.evidence).replace(/\s+/g, '');
      const curN = String(c.text).replace(/\s+/g, '');
      const grounded = !!evN && (curN.indexOf(evN) !== -1 || evN.indexOf(curN) !== -1);
      const pureFollowup =
        /^(怎么办|然后呢|现在呢|那呢|怎么弄|要紧吗|严重吗|接下来呢|还怎么办)[？?。！!]*$/.test(curN);
      if (!grounded && !pureFollowup) {
        steps.push({ act: d.act, args: d.args || {}, ok: false, reason: 'context-not-grounded' });
        return { endKind: 'refuse', steps };
      }
    }

    const act = d.act;
    const args = d.args || {};
    const gate = TOOLS.checkGate(act, args, { entries: ENTRIES, sceneIds: SCENE_IDS, history });
    if (!gate.ok) {
      steps.push({ act, args, ok: false, reason: gate.reason });
      const safe = TOOLS.execute(
        'refuse',
        { reason: gate.reason },
        { entries: ENTRIES, sceneIds: SCENE_IDS, history }
      );
      steps.push({ act: 'refuse', args: { reason: gate.reason }, ok: true });
      endKind = safe.kind || 'refuse';
      break;
    }
    const res = TOOLS.execute(act, args, {
      entries: ENTRIES,
      sceneIds: SCENE_IDS,
      history,
    });
    steps.push({ act, args, ok: res.ok, kind: res.kind || null });
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
  return { endKind, steps };
}

console.log(`上文污染探针：${list.length} 条 × 2 arm ｜ 代理样式 ACT_CTX_STYLE=${STYLE}`);
console.log(
  '  说明：样式由代理侧环境变量决定，本脚本只标注。两次跑须在代理上分别设 full / raw。'
);
console.log('─'.repeat(96));

const rows = [];
for (let i = 0; i < list.length; i++) {
  const c = list[i];
  const [aScene, aText] = pickAnchor(c, i);

  const base = await runLoop(c, null);
  const baseAct = kindToAction(base.endKind);
  const baseOk = baseAct === c.expect_action;

  const cont = await runLoop(c, { utterances: [aText] });
  const contAct = kindToAction(cont.endKind);
  const contOk = contAct === c.expect_action;

  rows.push({
    id: c.id,
    group: c.group,
    text: c.text,
    anchorScene: aScene,
    anchor: aText,
    expect: c.expect_action,
    baseAct,
    baseOk,
    contAct,
    contOk,
    dropped: baseOk && !contOk,
    rescued: !baseOk && contOk,
  });
}

const n = rows.length;
const baseHit = rows.filter((r) => r.baseOk).length;
const contHit = rows.filter((r) => r.contOk).length;
const dropped = rows.filter((r) => r.dropped);
const rescued = rows.filter((r) => r.rescued);

console.log('');
console.log('=== 结果 ===');
console.log(
  `  baseline   无上文          ${baseHit}/${n} (${((baseHit / n) * 100).toFixed(0)}%)`
);
console.log(
  `  contaminated 上文=他场景   ${contHit}/${n} (${((contHit / n) * 100).toFixed(0)}%)`
);
console.log(
  `  净变化 ${contHit - baseHit >= 0 ? '+' : ''}${contHit - baseHit} 条 ｜ 掉 ${dropped.length} 条 ｜ 反救回 ${rescued.length} 条`
);

if (dropped.length) {
  console.log('');
  console.log('=== 被上文带偏的条目（baseline 对 → 污染后错）===');
  for (const r of dropped) {
    console.log(
      `  ✗ ${r.id} [${r.group}] 期望=${r.expect} 污染后=${r.contAct}  上文=「${r.anchor}」 本句=「${r.text}」`
    );
  }
}
if (rescued.length) {
  console.log('');
  console.log('=== 反被上文救回的条目（baseline 错 → 污染后对）===');
  for (const r of rescued) {
    console.log(`  + ${r.id} 期望=${r.expect} baseline=${r.baseAct} 污染后=${r.contAct}`);
  }
}

/* 关键：按组看。emergency 组混错场景是安全事故，off_scope 组混错只是答非所问。 */
console.log('');
console.log('=== 分组 ===');
for (const g of ['emergency', 'prevention', 'off_scope']) {
  const sub = rows.filter((r) => r.group === g);
  if (!sub.length) continue;
  const b = sub.filter((r) => r.baseOk).length;
  const c2 = sub.filter((r) => r.contOk).length;
  console.log(
    `  ${g.padEnd(11)} baseline ${b}/${sub.length}  污染后 ${c2}/${sub.length}  净 ${c2 - b >= 0 ? '+' : ''}${c2 - b}`
  );
}

const out = path.join(ROOT, 'tools', 'eval', `probe_ctx_contamination_${STYLE}.json`);
fs.writeFileSync(
  out,
  JSON.stringify({ generated: new Date().toISOString(), style: STYLE, endpoint: ENDPOINT, rows }, null, 1)
);
console.log('');
console.log(`明细已存 tools/eval/probe_ctx_contamination_${STYLE}.json`);
