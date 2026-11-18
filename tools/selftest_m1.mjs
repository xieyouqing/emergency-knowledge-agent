/**
 * M1 自测：把 docs/08-M1-范围与延后项.md §1 的判据跑成真断言
 *
 * 用法: node tools/selftest_m1.mjs
 * 前置: python tools/build_knowledge_js.py 已跑过（app/knowledge.js 是最新的）
 *
 * 设计原则：每条断言都必须能失败。写不出「什么情况算不过」的，不写进来。
 * 不做「全绿就算通过」的自我安慰——本脚本末尾会故意投毒一次，确认断言真的会红。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'app');

/* ---------- 最小 DOM stub：够跑 app.js 的取值与渲染字符串 ---------- */
const store = new Map();
function makeEl(id) {
  const e = {
    id,
    innerHTML: '',
    hidden: false,
    value: '',
    textContent: '',
    handlers: {},
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    scrollIntoView() {},
    getAttribute() { return null; },
    setAttribute() {},
    closest() { return null; }
  };
  return e;
}
const document = {
  getElementById(id) {
    if (!store.has(id)) store.set(id, makeEl(id));
    return store.get(id);
  },
  querySelectorAll() { return []; },
  addEventListener() {}
};
const window = { document, scrollTo() {} };
/* ---------- speechSynthesis stub：让 voice.js 能跑，且能断言「说了什么」 ---------- */
const spoken = [];
function SpeechSynthesisUtteranceStub(text) { this.text = text; this.lang = ''; this.rate = 1; }
const speechSynthesisStub = {
  getVoices() {
    return [
      { name: 'Microsoft Huihui', lang: 'zh-CN' },
      { name: 'Google 普通话', lang: 'zh-CN' },
      { name: 'Alex', lang: 'en-US' }
    ];
  },
  speak(u) { spoken.push({ text: u.text, lang: u.lang, rate: u.rate }); if (u.onend) u.onend(); },
  cancel() {},
  addEventListener() {}
};

const sandbox = {
  window, document, console, Math, String, Number, Object, Array, JSON,
  speechSynthesis: speechSynthesisStub,
  SpeechSynthesisUtterance: SpeechSynthesisUtteranceStub,
  localStorage: null
};
// voice.js 用 `typeof window !== 'undefined' ? window : globalThis` 取全局，
// 所以 stub 的 window 上必须也有这两个 API，否则它会走到「不支持」分支。
window.speechSynthesis = speechSynthesisStub;
window.SpeechSynthesisUtterance = SpeechSynthesisUtteranceStub;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(APP, 'knowledge.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'retrieval.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'llm.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'voice.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sandbox);

const M = sandbox.window.__M1__;
if (!M) {
  console.error('FAIL: app.js 未导出 __M1__，自测无法进行');
  process.exit(1);
}

/* ---------- 断言框架 ---------- */
let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; failures.push(msg); }
}

/* ---------- 1. 构建产物只含 published 条目 ----------
   2026-11-18 起新增 6 条，total 9（drowning 因 §3.8 禁令不写，槽位仍为 slot） */
const meta = M.kbMeta;
const allowed = [
  'airway_obstruction', 'co_poisoning', 'earthquake', 'electric_shock',
  'elevator_trapped', 'fall_elderly', 'fire_home', 'gas_leak', 'scald_burn'
];
ok(meta.slots === 9, `图标槽位应为 9 个（实际 ${meta.slots}）`);
ok(meta.entries === 9, `条目应为 9 条（实际 ${meta.entries}）`);
ok(
  Object.keys(M.entries).sort().join(',') === allowed.join(','),
  `条目集合应为 ${allowed.join(',')}，实际 ${Object.keys(M.entries).sort().join(',')}`
);
// drowning 必须缺席：源未验证，禁止入库（docs/06 §3.8）
ok(!M.entries.drowning, 'drowning 不得出现在产物中（源未通过验证）');
for (const id of Object.keys(M.entries)) {
  const e = M.entries[id];
  // 防御：产物里混入结构不全的条目时，报明确失败而不是让脚本崩掉。
  // 崩溃会掩盖真正的失败原因，等于断言失效（v0.9 加固）。
  if (!e || !e.review || !e.review.checklist || !e.review.agent_check) {
    ok(false, `${id} 缺 review/checklist/agent_check，产物结构不完整`);
    continue;
  }
  ok(e.status === 'published', `${id} 的 status 应为 published`);
  ok(e.review.checklist.source_quote_verbatim === true, `${id} 的 source_quote_verbatim 应为 true`);
  ok(e.review.agent_check.source_quote === 'pass', `${id} 的 agent_check 应为 pass`);
}

/* ---------- 2. 库内检索命中率（20 条，目标 ≥ 17） ---------- */
const IN_CASES = [
  ['煤气漏了', 'gas_leak'],
  ['闻到煤气味', 'gas_leak'],
  ['天然气泄漏', 'gas_leak'],
  ['燃气漏气', 'gas_leak'],
  ['液化气泄漏', 'gas_leak'],
  ['家里有股怪味', 'gas_leak'],
  ['煤气味很重', 'gas_leak'],
  ['好像漏气了', 'gas_leak'],
  ['老人摔倒了', 'fall_elderly'],
  ['我妈跌倒了起不来', 'fall_elderly'],
  ['摔了一跤', 'fall_elderly'],
  ['老人摔倒怎么办', 'fall_elderly'],
  ['爬不起来', 'fall_elderly'],
  ['摔伤了', 'fall_elderly'],
  ['被困电梯', 'elevator_trapped'],
  ['电梯困住人了', 'elevator_trapped'],
  ['电梯不动了', 'elevator_trapped'],
  ['关在电梯里面', 'elevator_trapped'],
  ['电梯停了', 'elevator_trapped'],
  ['被困在电梯里了', 'elevator_trapped']
];
let hit = 0;
for (const [text, expect] of IN_CASES) {
  const r = M.routeOf(text);
  if (r.entryId === expect) hit++;
  else failures.push(`命中失败: 「${text}」期望 ${expect}，实际 ${r.entryId || 'null'}（danger=${r.dangerId}）`);
}
ok(hit >= 17, `库内命中率 ${hit}/20，应 ≥ 17`);
console.log(`  库内命中: ${hit}/${IN_CASES.length}`);

/* ---------- 3. 库外拒答（20 条，必须 20/20） ---------- */
const OUT_CASES = [
  '今天天气怎么样', '帮我写个请假条', '红烧肉怎么做', '股票会涨吗',
  '我睡眠不好怎么办', '怎么减肥', '电脑开不了机', '帮我订机票',
  '你叫什么名字', '明天要下雨吗', '推荐一部电影', '怎么学英语',
  '手机没电了', '我想聊天', '讲个笑话', '汽车打不着火',
  '水管冻裂了', '门锁坏了打不开', '邻居太吵怎么办', '怎么办理身份证'
];
let refused = 0;
for (const text of OUT_CASES) {
  const r = M.routeOf(text);
  // 库外 = 没有条目 且 没命中危险信号 → 必须走拒答
  if (!r.entryId && !r.dangerId) refused++;
  else failures.push(`库外未拒答: 「${text}」entry=${r.entryId} danger=${r.dangerId}`);
}
ok(refused === 20, `库外拒答 ${refused}/20，应 20/20`);
console.log(`  库外拒答: ${refused}/${OUT_CASES.length}`);

/* ---------- 4. 危险信号检出（V7 的漏判样例） ---------- */
const DANGER_CASES = [
  ['着火了', 'fire_home'],
  ['家里冒烟了', 'fire_home'],
  ['一氧化碳中毒', 'co_poisoning'],
  ['烧炭取暖头晕', 'co_poisoning'],
  ['孩子触电了', 'electric_shock'],
  ['老人噎住了', 'airway_obstruction'],
  ['有人落水了', 'drowning'],
  ['地震了', 'earthquake'],
  ['烫伤了怎么办', 'scald_burn']
];
for (const [text, expect] of DANGER_CASES) {
  const r = M.routeOf(text);
  ok(r.dangerId === expect, `危险信号: 「${text}」期望 ${expect}，实际 ${r.dangerId}`);
}

/* ---------- 5. 未发布场景 → 拨号卡，不给步骤（决定4） ----------
   2026-11-18：fire_home / electric_shock / earthquake 已发布，走 steps。
   现在只剩 drowning 未发布（源未验证），它是决定4 的唯一生产用例。 */
{
  const r = M.routeOf('有人落水了');
  ok(r.entryId === null, '「有人落水了」不应命中任何已发布条目（drowning 未发布）');
  ok(r.dialOnly === true, '「有人落水了」应走拨号卡');
  ok(r.dangerNumber === '120', `「有人落水了」拨号码应为 120，实际 ${r.dangerNumber}`);
}

/* ---------- 5b. 新发布的场景必须给出步骤卡，不能退化成拨号卡 ---------- */
for (const [text, expect] of [
  ['着火了', 'fire_home'],
  ['家里冒烟了', 'fire_home'],
  ['孩子触电了', 'electric_shock'],
  ['地震了', 'earthquake'],
  ['老人噎住了', 'airway_obstruction'],
  ['烫伤了怎么办', 'scald_burn'],
  ['一氧化碳中毒', 'co_poisoning']
]) {
  const r = M.routeOf(text);
  ok(r.entryId === expect, `「${text}」应给出 ${expect} 的步骤卡（实际 entryId=${r.entryId}, dialOnly=${r.dialOnly}）`);
  ok(r.dialOnly === false, `「${text}」已发布场景不应走拨号卡`);
}

/* ---------- 6. 三段式渲染完整性（遍历全部已发布条目） ---------- */
for (const id of Object.keys(M.entries)) {
  const e = M.entries[id];
  const box = makeEl('t');
  M.renderSteps(e, null, box);
  const html = box.innerHTML;

  ok(html.includes('立刻做'), `${id} 渲染缺「立刻做」段`);
  ok(html.includes('接着做'), `${id} 渲染缺「接着做」段`);
  ok(html.includes('绝对不要做'), `${id} 渲染缺「绝对不要做」段`);
  ok(html.includes(`tel:${e.emergency_number}`), `${id} 渲染缺拨号入口 tel:${e.emergency_number}`);

  // 每一条 never 都必须真实出现在输出里（S3：禁忌段不得为空）
  for (const s of e.steps.never) {
    ok(html.includes(s.text), `${id} 的 never「${s.text}」未渲染出来`);
  }
  // 每一条 immediate 同样要在
  for (const s of e.steps.immediate) {
    ok(html.includes(s.text), `${id} 的 immediate「${s.text}」未渲染出来`);
  }
  ok(e.steps.never.length >= 1, `${id} 的 never 段为空（违反 S3）`);
}

/* ---------- 7. 拒答卡：零步骤 + 有拨号（S1/S4） ---------- */
{
  const box = makeEl('r');
  M.renderRefuse(box);
  const html = box.innerHTML;
  ok(html.includes('tel:120'), '拒答卡缺拨号按钮');
  ok(!html.includes('立刻做'), '拒答卡不应出现步骤段落');
  ok(!html.includes('绝对不要做'), '拒答卡不应出现禁忌段落');
  // S4：话术里不得出现动词开头的指令句
  ok(!/马上|立即|赶紧|快.{0,2}去/.test(html), '拒答话术疑似含指令句');
}

/* ---------- 8. 拨号专用卡：只有号码，没有步骤（决定4 的 S1 边界） ---------- */
{
  const box = makeEl('d');
  M.renderDialOnly('119', box);
  const html = box.innerHTML;
  ok(html.includes('tel:119'), '拨号卡缺 tel:119');
  ok(!html.includes('立刻做'), '拨号卡不得出现步骤段落');
  ok(html.includes('我不编步骤'), '拨号卡应明说不编步骤');
}

/* ---------- 9. 日常模式只用 daily 字段（决定5） ---------- */
for (const id of Object.keys(M.entries)) {
  const e = M.entries[id];
  const box = makeEl('y');
  M.renderDaily(e, box);
  const html = box.innerHTML;
  ok(html.includes(e.daily.summary), `${id} 日常回答缺 summary`);
  ok(html.includes('查看操作步骤'), `${id} 日常回答缺「查看操作步骤」按钮`);
  ok(!html.includes(e.steps.immediate[0].text), `${id} 日常回答不应直接列出紧急步骤`);
}

/* ---------- 10. 打勾区尺寸与最小字号（读 CSS 实际声明） ---------- */
{
  const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
  const tap = css.match(/\.step\{[^}]*min-height:\s*(\d+)px/s);
  ok(!!tap && Number(tap[1]) >= 48, `打勾点击区 min-height 应 ≥ 48px，实际 ${tap ? tap[1] + 'px' : '未找到'}`);
  const fsMin = css.match(/--fs-min:\s*(\d+)px/);
  ok(!!fsMin && Number(fsMin[1]) >= 32, `最小字号应 ≥ 32px（=24pt），实际 ${fsMin ? fsMin[1] + 'px' : '未找到'}`);
  const box = css.match(/\.step \.box\{[^}]*width:\s*(\d+)px/s);
  ok(!!box && Number(box[1]) >= 48, `复选框尺寸应 ≥ 48px，实际 ${box ? box[1] + 'px' : '未找到'}`);
}

/* ---------- 11. S9 已删除：页脚常驻拨号行不得存在（v0.6） ---------- */
{
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
  ok(!html.includes('hotline'), 'index.html 不应再有页脚常驻拨号行（S9 已于 v0.6 删除）');
  ok(!css.includes('.hotline'), 'style.css 不应再有 .hotline 样式');
  // 但场景卡内的拨号按钮必须还在（依据 S5，不是 S9）
  const gas = M.entries.gas_leak;
  const box = makeEl('s5');
  M.renderSteps(gas, null, box);
  ok(box.innerHTML.includes('tel:119'), '场景卡内拨号按钮必须保留（S5 要求）');
}

/* ---------- 11.5 检索层：三引擎契约与行为一致性（v0.8 新增） ----------
   目的：retrieval.js 抽出后，保证①默认引擎没被偷偷换掉
        ②三个引擎返回结构同形（否则评测脚本会静默错位）
        ③BM25 排序方向正确（分数高的排前面） */
{
  const R = sandbox.window.RETRIEVAL;
  ok(!!R, 'retrieval.js 应导出 window.RETRIEVAL');
  ok(R.defaultEngine() === 'l3',
    `生产默认引擎必须仍是 l3（实际 ${R.defaultEngine()}）。改成别的须先提案（D-3）`);
  ok(R.engines().join(',') === 'l3,bm25,hybrid', `引擎清单应为 l3,bm25,hybrid（实际 ${R.engines().join(',')}）`);

  const ENT = M.entries;
  const probe = '被困电梯和摔倒';
  for (const eng of R.engines()) {
    const r = R.retrieve(ENT, probe, { engine: eng });
    ok(r && typeof r === 'object', `${eng} 应返回对象`);
    ok('entryId' in r && 'score' in r && 'layer' in r && 'matchedBy' in r && Array.isArray(r.candidates),
      `${eng} 返回结构须含 entryId/score/layer/matchedBy/candidates（五个字段缺一不可，评测脚本依赖同形）`);
    ok(r.layer === eng, `${eng} 返回的 layer 应等于请求的引擎名（实际 ${r.layer}）`);
  }

  // 排序方向：候选分数必须单调不增
  for (const eng of R.engines()) {
    const c = R.retrieve(ENT, probe, { engine: eng }).candidates;
    let mono = true;
    for (let i = 1; i < c.length; i++) if (c[i].score > c[i - 1].score + 1e-9) mono = false;
    ok(mono, `${eng} 候选须按分数降序排列（高→低）`);
  }

  // 空输入不得返回候选（防止空字符串匹配到一切）
  for (const eng of R.engines()) {
    const r = R.retrieve(ENT, '   ', { engine: eng });
    ok(r.entryId === null && r.candidates.length === 0, `${eng} 空白输入应返回零候选`);
  }

  // BM25 分词：中文 bigram + ASCII 整段
  const tk = R._internals.tokenize('煤气泄漏 120');
  ok(tk.includes('煤气') && tk.includes('气泄') && tk.includes('泄漏'), `BM25 应对中文做 bigram（实际 ${tk.join('/')}）`);
  ok(tk.includes('120'), `BM25 应把连续 ASCII 当整词（实际 ${tk.join('/')}）`);

  // 索引规模断言：只在 N=3 时成立（df 全为 1 → IDF 失效，见 docs/03 §6.6）
  // 条目数变化后本断言自动变为「记录新规模」，不再断言具体值——
  // 硬编码 N 会让每次加条目都误报，那不是判据，是噪音。
  const idx = R._internals.buildIndex(Object.values(ENT));
  const dfVals = Object.values(idx.df);
  const ratio = dfVals.filter(d => d === 1).length / dfVals.length;
  ok(idx.N === Object.keys(ENT).length, `BM25 索引文档数应等于条目数（${idx.N} vs ${Object.keys(ENT).length}）`);
  ok(dfVals.length > 0, 'BM25 索引不应为空');
  console.log(`  BM25 索引: N=${idx.N}, 词项=${dfVals.length}, df=1 占比=${(ratio * 100).toFixed(1)}%`
    + (ratio >= 1 ? ' ← 仍为 100%，IDF 依然失效，引擎对照仍无区分度' : ' ← IDF 已部分恢复区分度'));
}

/* ---------- 11.7 LLM 路由映射（v1.0 新增，全部离线可测） ----------
   routeByVerdict 是纯函数，不碰网络，所以能在这里穷举断言。
   真实的模型调用由 tools/eval/run_eval.mjs --engine=llm 覆盖。 */
{
  const L = sandbox.window.LLM;
  ok(!!L, 'llm.js 应导出 window.LLM');
  ok(typeof L.routeByVerdict === 'function', 'routeByVerdict 必须是函数');
  ok(!('apiKey' in L) && !('key' in L), 'llm.js 不得持有任何密钥字段');

  const E = M.entries;
  const noDanger = () => null;

  // ① 失败/空判定 → 返回 null（交回 l3），不是「拒答」
  for (const bad of [null, {}, { ok: false }, undefined]) {
    ok(L.routeByVerdict(bad, E, noDanger, '任意') === null,
      `判定为 ${JSON.stringify(bad)} 时应返回 null 让调用方回落 l3，而不是直接拒答`);
  }

  // ② ongoing + 已发布场景 → steps
  ok(L.routeByVerdict({ ok: true, intent: 'ongoing', scene: 'gas_leak' }, E, noDanger, 'x').action === 'steps',
    'ongoing + 已发布场景 应给 steps');

  // ③ ongoing + 未发布场景 → dialonly（S1：不给步骤）
  {
    const r = L.routeByVerdict({ ok: true, intent: 'ongoing', scene: 'drowning' }, E, noDanger, 'x');
    ok(r.action === 'dialonly', 'ongoing + 未发布场景 应给 dialonly，不得给步骤（S1）');
  }

  // ④ ongoing 但无场景 → refuse
  ok(L.routeByVerdict({ ok: true, intent: 'ongoing', scene: null }, E, noDanger, 'x').action === 'refuse',
    'ongoing 但判不出场景 应 refuse');

  // ⑤ prevention + 已发布 → daily
  ok(L.routeByVerdict({ ok: true, intent: 'prevention', scene: 'fire_home' }, E, noDanger, 'x').action === 'daily',
    'prevention + 已发布场景 应给日常解释');

  // ⑥ off_scope → refuse，即使模型误带了场景
  {
    const r = L.routeByVerdict({ ok: true, intent: 'off_scope', scene: 'gas_leak' }, E, noDanger, 'x');
    ok(r.action === 'refuse', 'off_scope 必须 refuse，模型误带场景也不得给内容');
  }

  /* ⑦ 关键词兜底：只在「LLM 认为是紧急、但归不出场景」时启用
     （2026-11-18 修 bug 后收紧；off_scope 时不得兜底，见下面 ⑩） */
  {
    const dangerFn = () => ({ id: 'gas_leak', number: '119' });
    const r = L.routeByVerdict({ ok: true, intent: 'ongoing', scene: null, confidence: 0.9 }, E, dangerFn, '有股怪味');
    ok(r.action === 'steps' && r.entryId === 'gas_leak',
      'ongoing 但归不出场景时，应由关键词兜底给出步骤',
    );
    ok(r.reason === 'danger-override', `该分支 reason 应为 danger-override，实际 ${r.reason}`);
  }

  // ⑧ 未知 intent 一律 refuse（不猜）
  ok(L.routeByVerdict({ ok: true, intent: 'whatever', scene: 'gas_leak' }, E, noDanger, 'x').action === 'refuse',
    '未知 intent 必须 refuse');

  /* ⑨ 置信度门槛（docs/03 §2.2「低于阈值不猜」）
     这是让 ④ 库外误纳率归零的机制，掉了就说明安全项会破。 */
  {
    const dangerFn = () => ({ id: 'gas_leak', number: '119' });
    const low = L.routeByVerdict(
      { ok: true, intent: 'ongoing', scene: 'gas_leak', confidence: 0.55 }, E, dangerFn, '燃气灶打不着火');
    ok(low.action === 'refuse', `置信度 0.55 < 0.60 时必须 refuse，实际 ${low.action}`);
    ok(low.reason === 'low-confidence', `低置信度分支 reason 应为 low-confidence，实际 ${low.reason}`);
    ok(low.entryId === null, '低置信度不得给出任何条目');

    // 边界：恰好 0.60 应当放行（用 < 比较，不是 <=）
    const edge = L.routeByVerdict(
      { ok: true, intent: 'ongoing', scene: 'gas_leak', confidence: 0.60 }, E, noDanger, '煤气漏了');
    ok(edge.action === 'steps', `置信度恰好 0.60 应放行，实际 ${edge.action}`);

    // 高置信度正常走
    const high = L.routeByVerdict(
      { ok: true, intent: 'ongoing', scene: 'gas_leak', confidence: 0.95 }, E, noDanger, '煤气漏了');
    ok(high.action === 'steps', '高置信度应正常给步骤');

    // confidence 缺失时不得误伤（不能把 undefined 当 0）
    const noConf = L.routeByVerdict(
      { ok: true, intent: 'ongoing', scene: 'gas_leak' }, E, noDanger, '煤气漏了');
    ok(noConf.action === 'steps', 'confidence 缺失时不应触发降级（undefined 不等于 0）');
  }

  /* ⑩ 回归：这条曾经把「电梯广告怎么投诉」渲染成电梯困人步骤卡 */
  {
    const dangerFn = () => ({ id: 'elevator_trapped', number: '119' });
    // LLM 正确判 off_scope，但关键词命中「电梯」——不得因此给步骤
    const r = L.routeByVerdict(
      { ok: true, intent: 'off_scope', scene: null, confidence: 0.95 }, E, dangerFn, '电梯广告怎么投诉');
    ok(r.action === 'refuse', `off_scope 时即使关键词命中危险信号也必须 refuse，实际 ${r.action}`);
    ok(r.entryId === null, 'off_scope 不得给出条目');
  }
}

/* ---------- 12. 语音输出（M2，全部离线可测） ----------
   核心判据只有一条最重要：**朗读稿里的每个字都必须来自条目字段**（S1）。
   所以断言方式不是「听起来对」，而是「逐条步骤的 text 都出现在稿子里，且稿子里
   没有条目之外的句子」。 */
{
  const T = sandbox.window.TTS;
  ok(!!T, 'voice.js 应导出 window.TTS');
  ok(typeof T.composeStepsScript === 'function', 'composeStepsScript 必须是函数');

  // ① 探测：web 引擎可用（stub 提供了 speechSynthesis + 中文音色）
  await T.detect();
  ok(T.state.engine === 'web', `有 speechSynthesis 时应选 web 引擎（实际 ${T.state.engine}）`);
  ok(T.state.supported === true, '有中文音色时 supported 应为 true');
  ok(T.state.voiceName && /Huihui|普通话/.test(T.state.voiceName),
    `应优先选中文音色（实际 ${T.state.voiceName}）`);

  // ② 朗读稿 = 条目字段的拼接，一个字都不许改（S1）
  for (const id of Object.keys(M.entries)) {
    const e = M.entries[id];
    const script = T.composeStepsScript(e, null);
    ok(script.length > 0, `${id} 朗读稿不应为空`);
    ok(script.includes(e.name), `${id} 朗读稿应包含场景名`);
    for (const seg of ['immediate', 'next', 'never']) {
      for (const s of e.steps[seg]) {
        ok(script.includes(s.text), `${id} 朗读稿缺 ${seg} 的「${s.text}」（S1：不许漏也不许改）`);
      }
    }
    // 反向：稿子里不许出现条目字段以外的「操作句」。
    // 判据是「稿子长度 ≈ 各字段长度之和 + 段落标题」，超出部分只能是标题与标点。
    const titles = ['立刻做。', '接着做。', '绝对不要做。'];
    let stripped = script.replace(e.name + '。', '');
    for (const t of titles) stripped = stripped.split(t).join('');
    for (const seg of ['immediate', 'next', 'never']) {
      for (const s of e.steps[seg]) stripped = stripped.split(s.text + '。').join('');
    }
    ok(stripped.replace(/[。，、！？：；\s]/g, '') === '',
      `${id} 朗读稿含条目之外的内容：「${stripped.slice(0, 40)}」（违反 S1）`);
  }

  // ③ 分诊覆盖：选了「还有很浓的味」应读 override 的步骤，不是默认步骤
  {
    const e = M.entries.gas_leak;
    const opt = e.triage.options.find(o => o.override && o.override.immediate);
    ok(!!opt, 'gas_leak 应有带 override 的分诊选项');
    const script = T.composeStepsScript(e, opt.override.immediate);
    for (const s of opt.override.immediate) {
      ok(script.includes(s.text), `分诊后朗读稿应包含 override 步骤「${s.text}」`);
    }
    ok(!script.includes(e.steps.immediate[0].text),
      '分诊后朗读稿不应再包含默认 immediate 步骤（否则会读错指导）');
  }

  // ④ 不可用时必须给明确原因，且 speak 返回 reason 而不是假装成功
  {
    const savedReason = T.state.unavailableReason;
    T.state.supported = false;
    T.state.unavailableReason = '测试用不可用原因';
    const r = await T.speak('测试');
    ok(r.ok === false && r.reason === 'unsupported', '不支持时 speak 应返回 unsupported');
    ok(r.message === '测试用不可用原因', '不支持时必须带回用户能看懂的原因（不许静默失败）');
    T.state.supported = true;
    T.state.unavailableReason = savedReason;
  }

  // ⑤ 空文本不发声
  {
    const before = spoken.length;
    const r = await T.speak('   ');
    ok(r.ok === false && r.reason === 'empty', '空文本应返回 empty');
    ok(spoken.length === before, '空文本不应触发实际发声');
  }

  // ⑥ 关闭开关后不发声（除非 force）
  {
    T.setEnabled(false);
    const before = spoken.length;
    const r1 = await T.speak('煤气泄漏了');
    ok(r1.reason === 'disabled', '关闭后应返回 disabled');
    ok(spoken.length === before, '关闭后不应发声');
    const r2 = await T.speak('煤气泄漏了', { force: true });
    ok(r2.ok === true, 'force 时应无视开关发声');
    T.setEnabled(true);
  }

  // ⑦ 实际发声内容与朗读稿一致（不是只调用不传文本）
  {
    const e = M.entries.fire_home;
    const before = spoken.length;
    await T.speak(T.composeStepsScript(e, null), { force: true });
    ok(spoken.length === before + 1, '应触发一次发声');
    const last = spoken[spoken.length - 1];
    ok(last.text.includes(e.steps.immediate[0].text), '实际发声内容应包含第一条步骤');
    ok(last.lang === 'zh-CN', `发声语言应为 zh-CN（实际 ${last.lang}）`);
    ok(last.rate <= 1.0, `默认语速应偏慢（≤1.0，老人友好），实际 ${last.rate}`);
  }

  // ⑧ 卡片必须渲染朗读与停止两个按钮，且停止按钮不是小字链接
  {
    const e = M.entries.gas_leak;
    const box = makeEl('voice');
    M.renderSteps(e, null, box);
    ok(box.innerHTML.includes('data-act="read"'), '步骤卡应有朗读按钮');
    ok(box.innerHTML.includes('data-act="stop"'), '步骤卡应有停止按钮');
    ok(box.innerHTML.includes('朗读一遍'), '朗读按钮文案应明确');
    ok(box.innerHTML.includes('停止'), '停止按钮文案应明确');
  }

  // ⑨ 语音按钮的尺寸与字号必须达标（读 CSS 声明，与判据 4/10 同一口径）
  {
    const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
    const btn = css.match(/\.voice-btn\{[^}]*min-height:\s*(\d+)px/s);
    ok(!!btn && Number(btn[1]) >= 48, `语音按钮 min-height 应 ≥ 48px，实际 ${btn ? btn[1] + 'px' : '未找到'}`);
    const fsMin = css.match(/\.voice-btn\{[^}]*font-size:\s*var\(--fs-min\)/s);
    ok(!!fsMin, '语音按钮字号须用 var(--fs-min)，不得小于 24pt');
    const stopFlex = css.match(/\.voice-btn\.is-stop\{[^}]*flex:\s*0 0 (\d+)%/s);
    ok(!!stopFlex && Number(stopFlex[1]) >= 30,
      `停止按钮宽度应 ≥30%（老人要能一把按到），实际 ${stopFlex ? stopFlex[1] + '%' : '未找到'}`);
  }
}

/* ---------- 13. 投毒自检：故意改坏输入，确认断言会红 ---------- */
{
  const before = fail;
  // 用一条明显库外的句子当库内期望，应当失败
  ok(M.routeOf('今天天气怎么样').entryId === 'gas_leak', '【投毒】这条断言本应失败，若通过说明断言框架失灵');
  const poisoned = fail > before;
  if (poisoned) {
    // 撤销这次故意失败，不计入总分
    fail = before;
    failures.pop();
    console.log('  投毒自检: 断言确实会红（框架有效）');
  } else {
    console.error('  !! 投毒自检未触发，断言框架可能失效');
    process.exitCode = 1;
  }
}

/* ---------- 汇总 ---------- */
console.log('');
if (failures.length) {
  console.log('──────── 失败明细 ────────');
  failures.forEach(f => console.log('  ✗ ' + f));
}
console.log(`断言 ${pass + fail} 条：通过 ${pass}，失败 ${fail}`);
if (fail === 0) {
  console.log('PASS: M1 自测全部通过');
} else {
  console.log('FAIL: 存在未通过项');
  process.exitCode = 1;
}
