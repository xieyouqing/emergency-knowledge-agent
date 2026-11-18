/**
 * 评测 runner：在固定 100 条对照组上跑指定引擎，输出混淆矩阵与指标
 *
 * 用法:
 *   node tools/eval/run_eval.mjs                  # 默认 l3（= M1 字符检索，三层兜底最底层）
 *   node tools/eval/run_eval.mjs --engine=l3      # 同上（m1 为兼容别名）
 *   node tools/eval/run_eval.mjs --engine=bm25    # 纯 BM25（中文 bigram）
 *   node tools/eval/run_eval.mjs --engine=hybrid  # RRF 融合 l3 + bm25
 *   node tools/eval/run_eval.mjs --verbose        # 附带逐条明细
 *
 * 引擎语义（重要，别误读）:
 *   只有「场景检索」这一层换引擎；意图判定（DANGER_RULES）三层相同。
 *   所以 --engine=bm25 不等于「整条链路换成 BM25」，而是
 *   「危险信号判定不变，无危险信号时的场景检索改用 BM25」。
 *
 * 未实现的引擎:
 *   l1 / l2（embedding + 精排）需要模型与 API key，尚未接入。
 *   传这两个名字会明确报错退出，不返回假数据。
 *
 * 为什么要有这个脚本:
 *   换 RAG 前后必须用同一份对照组，否则无法证明「更灵活」不是「更爱编」。
 *   指标定义见 docs/03-技术方案.md §6。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'app');
const CASES = path.join(ROOT, 'tools', 'eval', 'cases.json');

const argv = process.argv.slice(2);
let engineName = (argv.find(a => a.startsWith('--engine=')) || '--engine=l3').split('=')[1];
if (engineName === 'm1') engineName = 'l3';   // 兼容旧写法
const verbose = argv.includes('--verbose');

/* ============ 1. 加载评测集并校验 ============ */
const data = JSON.parse(fs.readFileSync(CASES, 'utf8'));
const cases = data.cases || [];

let cfgErr = 0;
function cfgFail(msg) { cfgErr++; console.error('  ✗ ' + msg); }

// id 唯一
const ids = new Set();
for (const c of cases) {
  if (ids.has(c.id)) cfgFail(`id 重复: ${c.id}`);
  ids.add(c.id);
  for (const k of ['id', 'text', 'group', 'expect_intent', 'expect_action']) {
    if (c[k] === undefined || c[k] === '') cfgFail(`${c.id} 缺字段 ${k}`);
  }
  if (!['ongoing', 'prevention', 'off_scope'].includes(c.expect_intent)) {
    cfgFail(`${c.id} expect_intent 非法: ${c.expect_intent}`);
  }
  if (!['steps', 'dialonly', 'daily', 'refuse'].includes(c.expect_action)) {
    cfgFail(`${c.id} expect_action 非法: ${c.expect_action}`);
  }
}

// 分布
const byGroup = {};
for (const c of cases) byGroup[c.group] = (byGroup[c.group] || 0) + 1;
for (const [g, n] of Object.entries(data.distribution || {})) {
  if (g === 'total') continue;
  if (byGroup[g] !== n) cfgFail(`分组 ${g} 实际 ${byGroup[g] || 0} 条，声明 ${n} 条`);
}
if (cases.length !== (data.distribution?.total || 100)) {
  cfgFail(`总数 ${cases.length}，声明 ${data.distribution?.total}`);
}

// 四类 action 都有样本
const byAction = {};
for (const c of cases) byAction[c.expect_action] = (byAction[c.expect_action] || 0) + 1;
for (const a of ['steps', 'dialonly', 'daily', 'refuse']) {
  if (!byAction[a]) cfgFail(`expect_action=${a} 无样本，指标会失真`);
}

console.log('=== 评测集校验 ===');
if (cfgErr) {
  console.log(`  FAIL: ${cfgErr} 个配置问题，先修 cases.json`);
  process.exit(1);
}
console.log(`  ${cases.length} 条 | id 唯一 ✓ | 分布 ${Object.entries(byGroup).map(([g, n]) => `${g}:${n}`).join(' ')}`);
console.log(`  action 分布 ${Object.entries(byAction).map(([a, n]) => `${a}:${n}`).join(' ')}`);

/* ============ 2. 加载引擎 ============ */
const IMPLEMENTED = ['l3', 'bm25', 'hybrid'];
if (!IMPLEMENTED.includes(engineName)) {
  console.error(`\nFAIL: 引擎 ${engineName} 未实现。`);
  console.error(`  已实现: ${IMPLEMENTED.join(' / ')}（见 app/retrieval.js）`);
  console.error('  l1/l2 需要 embedding + 精排，等模型接入后再实现。');
  console.error('  不返回假数据：未实现就是未实现，宁可报错。');
  process.exit(1);
}

const store = new Map();
const mk = id => ({
  id, innerHTML: '', hidden: false, value: '', textContent: '',
  addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
  scrollIntoView() {}, getAttribute: () => null, setAttribute() {}, closest: () => null
});
const document = {
  getElementById: id => (store.has(id) || store.set(id, mk(id)), store.get(id)),
  querySelectorAll: () => [], addEventListener() {}
};
const window = { document, scrollTo() {} };
const sandbox = { window, document, console, Math, String, Number, Object, Array, JSON };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'knowledge.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'retrieval.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sandbox);
const M = sandbox.window.__M1__;
if (!M) {
  console.error('FAIL: app.js 未导出 __M1__');
  process.exit(1);
}
const RET = sandbox.window.RETRIEVAL;
if (!RET) {
  console.error('FAIL: retrieval.js 未导出 RETRIEVAL');
  process.exit(1);
}
const ENTRIES = M.entries;

/** 把路由结果映射成 action —— 必须与 app.js 的 routeOf/handleQuery 分支一致
 *
 *  语义关键点：危险信号命中时，场景**以 danger.id 为准**，不用检索结果。
 *  原因：app.js 里是 `entry = targetId ? ENTRIES[targetId] : bestMatch(text)`。
 *  若 danger 命中的场景尚未发布（如 fire_home），必须走 dialonly，
 *  不能被检索结果「顶」成别的已发布场景（那会给出错误方向的步骤）。
 */
function actualOf(text) {
  const danger = RET.detectDanger(text);
  const dangerId = danger ? danger.id : null;

  // 检索层结果：危险信号命中时检索层不参与，置 null
  let retId = null;
  let hit3 = null;
  if (!dangerId) {
    const ret = RET.retrieve(ENTRIES, text, { engine: engineName });
    retId = ret.entryId;
    // Hit@3：期望场景是否落在检索候选前三（仅对走了检索层的样本有意义）
    hit3 = ret.candidates.slice(0, 3).map(c => c.id);
  }

  /* 两个口径必须分开，否则指标会自相矛盾：
     - sceneMetric：场景**判对没判对**。与条目是否已发布无关，
                    danger 命中就用 danger.id（它确实判出了这个场景）。
     - sceneAction：能不能**给出这个场景的内容**。没发布就没有 entry，
                    必须走 dialonly，不能被检索结果顶成别的已发布场景
                    （那会给出错误方向的步骤，比不答更危险）。 */
  const sceneMetric = dangerId || retId;
  const sceneAction = dangerId ? (ENTRIES[dangerId] ? dangerId : null) : retId;

  let action;
  if (dangerId && sceneAction) action = 'steps';
  else if (dangerId && !sceneAction) action = 'dialonly';
  else if (!dangerId && sceneAction) action = 'daily';
  else action = 'refuse';

  // 反推 intent：只有「场景检索」换了引擎，意图判定三层相同
  const intent = (action === 'steps' || action === 'dialonly') ? 'ongoing'
    : action === 'daily' ? 'prevention'
      : 'off_scope';

  return { action, intent, scene: sceneMetric, sceneAction, hit3 };
}

console.log(`\n=== 引擎: ${engineName} ===`);
console.log('  只换场景检索；意图判定（DANGER_RULES）三层相同。');

/* ============ 3. 跑评测 ============ */
const rows = cases.map(c => {
  const a = actualOf(c.text);
  const hit3ok = (a.hit3 && c.expect_scene) ? a.hit3.includes(c.expect_scene) : null;
  return {
    ...c,
    actual_action: a.action,
    actual_intent: a.intent,
    actual_scene: a.scene,
    hit3: a.hit3,
    hit3_ok: hit3ok,
    action_ok: a.action === c.expect_action,
    intent_ok: a.intent === c.expect_intent,
    scene_ok: (a.scene || null) === (c.expect_scene || null)
  };
});

/* ============ 4. 混淆矩阵 ============ */
const ACTIONS = ['steps', 'dialonly', 'daily', 'refuse'];
const matrix = {};
for (const e of ACTIONS) {
  matrix[e] = {};
  for (const a of ACTIONS) matrix[e][a] = 0;
}
for (const r of rows) matrix[r.expect_action][r.actual_action]++;

const pad = (s, n) => {
  let w = 0;
  for (const ch of String(s)) w += /[\u4e00-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(0, n - w));
};

console.log('\n=== 混淆矩阵（行=期望，列=实际）===');
console.log(pad('', 12) + ACTIONS.map(a => pad(a, 11)).join(''));
for (const e of ACTIONS) {
  const nums = ACTIONS.map(a => {
    const n = matrix[e][a];
    return pad(e === a ? `[${n}]` : String(n), 11);
  }).join('');
  console.log(pad(e, 12) + nums);
}
console.log('（[] 为对角线 = 正确）');

/* ============ 5. 分组准确率 ============ */
console.log('\n=== 分组准确率（按 action）===');
const groupStats = {};
for (const r of rows) {
  (groupStats[r.group] ||= { total: 0, ok: 0 }).total++;
  if (r.action_ok) groupStats[r.group].ok++;
}
for (const g of ['emergency', 'prevention', 'off_scope']) {
  const s = groupStats[g] || { total: 0, ok: 0 };
  const pct = s.total ? (s.ok / s.total * 100).toFixed(1) : '0.0';
  console.log(`  ${pad(g, 12)} ${String(s.ok).padStart(3)}/${String(s.total).padEnd(3)} ${pct.padStart(5)}%`);
}

/* ============ 6. 03 §6 五项指标 ============ */
const total = rows.length;
const nActionOk = rows.filter(r => r.action_ok).length;
const nIntentOk = rows.filter(r => r.intent_ok).length;
const nSceneOk = rows.filter(r => r.scene_ok).length;

// ③ 紧急漏给步骤率：期望给步骤/拨号，实际既没步骤也没拨号
const emergencyCases = rows.filter(r => r.expect_action === 'steps' || r.expect_action === 'dialonly');
const missedSteps = emergencyCases.filter(r => r.actual_action === 'refuse' || r.actual_action === 'daily');
const rateMissed = emergencyCases.length ? missedSteps.length / emergencyCases.length : 0;

// ④ 库外误纳率（严格）：期望拒答，实际给了任何内容
const oGroup = rows.filter(r => r.group === 'off_scope');
const oContaminated = oGroup.filter(r => r.actual_action !== 'refuse');

// ④' 未收录场景被误判（次级，后果较轻：给了拨号卡而非编造内容）
const pRefuse = rows.filter(r => r.group === 'prevention' && r.expect_action === 'refuse');
const pContaminated = pRefuse.filter(r => r.actual_action !== 'refuse');

console.log('\n=== 03 §6 指标（对照组固定，跨引擎可比）===');
console.log(`  ① 意图准确率      ${(nIntentOk / total * 100).toFixed(1)}%  (${nIntentOk}/${total})   门槛 ≥ 90%   ${nIntentOk / total >= 0.9 ? '✓' : '✗'}`);
console.log(`  ② 场景准确率      ${(nSceneOk / total * 100).toFixed(1)}%  (${nSceneOk}/${total})   门槛 ≥ 90%   ${nSceneOk / total >= 0.9 ? '✓' : '✗'}`);
console.log(`  ③ 紧急漏给步骤率   ${(rateMissed * 100).toFixed(1)}%  (${missedSteps.length}/${emergencyCases.length})   门槛 = 0     ${missedSteps.length === 0 ? '✓' : '✗'}  ← 安全项`);
console.log(`  ④ 库外误纳率      ${(oContaminated.length / oGroup.length * 100).toFixed(1)}%  (${oContaminated.length}/${oGroup.length})   门槛 = 0     ${oContaminated.length === 0 ? '✓' : '✗'}  ← 安全项`);
console.log(`  ④' 未收录误响      ${(pContaminated.length / pRefuse.length * 100).toFixed(1)}%  (${pContaminated.length}/${pRefuse.length})   参考项（给了拨号卡，未编造内容）`);

// ⑤ Hit@3：只在「走了检索层」的样本上算（危险信号命中时场景由 danger.id 定，不经检索）
const hitScope = rows.filter(r => r.hit3_ok !== null);
const hitOk = hitScope.filter(r => r.hit3_ok);
if (hitScope.length) {
  const pct = hitOk.length / hitScope.length * 100;
  console.log(`  ⑤ Hit@3           ${pct.toFixed(1)}%  (${hitOk.length}/${hitScope.length})   门槛 ≥ 90%   ${pct >= 90 ? '✓' : '✗'}`);
  console.log(`     样本范围：${hitScope.length} 条（已排除 ${rows.length - hitScope.length} 条危险信号命中样本，其场景不经检索）`);
} else {
  console.log(`  ⑤ Hit@3           N/A  无有效样本`);
}
console.log(`  综合 action 准确率  ${(nActionOk / total * 100).toFixed(1)}%  (${nActionOk}/${total})`);

/* ============ 7. 失败明细（按错误类型分组，便于定位） */
const fails = rows.filter(r => !r.action_ok);
console.log(`\n=== 失败明细（${fails.length} 条）===`);

const errKinds = {
  '误切紧急（预防被当作出事）': r => r.expect_action === 'daily' && r.actual_action === 'steps',
  '未收录场景被误响': r => r.expect_action === 'refuse' && r.group === 'prevention' && r.actual_action === 'dialonly',
  '库外被误纳为紧急': r => r.group === 'off_scope' && r.actual_action === 'steps',
  '库外被误纳为拨号': r => r.group === 'off_scope' && r.actual_action === 'dialonly',
  '该出步骤却没出': r => r.expect_action === 'steps' && r.actual_action !== 'steps',
  '该拨号却没拨': r => r.expect_action === 'dialonly' && r.actual_action !== 'dialonly',
  '其他': () => true
};

const bucketed = {};
for (const kind of Object.keys(errKinds)) bucketed[kind] = [];
for (const r of fails) {
  const kind = Object.keys(errKinds).find(k => errKinds[k](r));
  bucketed[kind].push(r);
}

for (const [kind, list] of Object.entries(bucketed)) {
  if (!list.length) continue;
  console.log(`\n  ▸ ${kind}（${list.length} 条）`);
  for (const r of list) {
    const flag = r.note ? `  [${r.note}]` : '';
    console.log(`    ${pad(r.id, 6)}「${pad(r.text, 26)}」期望 ${pad(r.expect_action, 9)} 实际 ${r.actual_action}${flag}`);
  }
}

/* ============ 8. 场景识别质量（与 action 解耦，单独看） */
const sceneWrong = rows.filter(r => !r.scene_ok);
if (sceneWrong.length) {
  console.log(`\n=== 场景识别错误（${sceneWrong.length} 条，与 action 对错独立）===`);
  for (const r of sceneWrong) {
    console.log(`    ${pad(r.id, 6)}「${r.text}」期望 ${r.expect_scene || 'null'} 实际 ${r.actual_scene || 'null'}`);
  }
  console.log('  注：场景对但 action 错 = 意图层缺失；场景错 = 检索/规则层问题。两者要分开修。');
}

/* ============ 9. 逐条明细（可选） */
if (verbose) {
  console.log('\n=== 逐条明细 ===');
  console.log(pad('id', 6) + pad('text', 30) + pad('组', 12) + pad('期望', 10) + pad('实际', 10) + '场景');
  for (const r of rows) {
    console.log(
      pad(r.id, 6) + pad(r.text, 30) + pad(r.group, 12) +
      pad(r.expect_action, 10) + pad(r.actual_action, 10) + (r.actual_scene || '-')
    );
  }
}

/* ============ 10. 结论 ============ */
console.log('\n=== 结论 ===');
const lines = [];
if (missedSteps.length > 0) lines.push(`✗ 安全项失败：${missedSteps.length} 条紧急场景没拿到步骤或拨号卡`);
if (oContaminated.length > 0) lines.push(`✗ 安全项失败：${oContaminated.length} 条库外问题被当作场景回应`);
const preventWrong = bucketed['误切紧急（预防被当作出事）'].length;
if (preventWrong > 0) lines.push(`✗ 意图缺失：${preventWrong}/${groupStats.prevention.total} 条预防咨询被强制切紧急`);
if (!lines.length) lines.push('全部判据通过');
lines.forEach(l => console.log('  ' + l));

console.log(`\n  引擎 ${engineName}。危险信号判定三层相同，只有无危险信号时的场景检索换了实现。`);
console.log('  说明：以上不是 L1（RAG + 精排）的成绩。');
console.log('  接好 embedding 与精排后必须用同一份 cases.json 重跑，差值才是方案收益。');

process.exitCode = (missedSteps.length || oContaminated.length) ? 1 : 0;
