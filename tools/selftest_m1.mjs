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
  // classList/parentNode/appendChild 是真实 DOM 必有的，stub 补齐它们
  // 比在业务代码里到处 if (x && x.classList) 更接近真实环境。
  const cls = new Set();
  const e = {
    id,
    innerHTML: '',
    hidden: false,
    disabled: false,
    value: '',
    textContent: '',
    className: '',
    handlers: {},
    classList: {
      add(c) { cls.add(c); },
      remove(c) { cls.delete(c); },
      contains(c) { return cls.has(c); },
      toggle(c, on) { if (on === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); } else if (on) cls.add(c); else cls.delete(c); }
    },
    _classes: cls,
    children: [],
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    scrollIntoView() {},
    getAttribute() { return null; },
    setAttribute() {},
    closest() { return null; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    insertBefore(c) { this.children.unshift(c); c.parentNode = this; return c; },
    parentNode: null
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
const window = { document, scrollTo() {}, addEventListener() {}, removeEventListener() {} };
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

vm.runInContext(fs.readFileSync(path.join(APP, 'log.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'knowledge.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'retrieval.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'llm.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'voice.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'asr.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sandbox);

/* 离线自测不该写盘：关掉远端，只验内存缓冲与格式。
   落盘验证在 e2e_voice.mjs 里做（那里真有代理）。 */
if (sandbox.window.LOG) sandbox.window.LOG.config.remote = false;

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
    /* 反向：稿子里不许出现条目字段以外的「操作句」。
       判据是「稿子长度 ≈ 各字段长度之和 + 段落标题」，超出部分只能是标题与标点。

       ⚠️ 2026-11-19 K1 修复后，S5 的固定安全句「同时拨打 N」是**唯一允许的例外**：
          它是「怎么说」不是「说什么」，不新增任何操作指导。所以这里要先把它剔除，
          否则 S1 的反向断言会因为合规的安全句而误报。
          与此同时 S5 的正向断言在下一段（③-b）单独检查它必须存在。 */
    const titles = ['立刻做。', '接着做。', '绝对不要做。'];
    let stripped = script.replace(e.name + '。', '');
    for (const t of titles) stripped = stripped.split(t).join('');
    for (const seg of ['immediate', 'next', 'never']) {
      for (const s of e.steps[seg]) stripped = stripped.split(s.text + '。').join('');
    }
    const callSentence = T.composeEmergencyCallSentence(e);
    if (callSentence) stripped = stripped.split(callSentence).join('');
    ok(stripped.replace(/[。，！？：；\s]/g, '') === '',
      `${id} 朗读稿含条目之外的内容：「${stripped.slice(0, 40)}」（违反 S1）`);
  }

  /* ②-b S5：生命危险场景的播报必须含「同时拨打 N」，缺一即失败。

     `01` §8 S5 判据原文：「命中 life_threatening: true 的条目，播报文本须含该句，缺一即失败」。
     2026-11-19 修复前实测 **0/6** 满足 —— 朗读稿只拼条目字段，而知识库没有任何一条写了「拨打」。
     后果：只听不看的老人，播报里不知道要同时打电话。

     号码必须是**条目自己的 emergency_number**，不是硬写的 120：
       燃气/火灾/地震是 119，中毒/触电/气道梗阻是 120。统一念 120 会让消防场景拨错号。
     所以这条断言不能用 includes('同时拨打120')，必须逐条比对号码。 */
  {
    const withCall = [];
    for (const id of Object.keys(M.entries)) {
      const e = M.entries[id];
      const stepScript = T.composeStepsScript(e, null);
      const call = T.composeEmergencyCallSentence(e);

      if (e.life_threatening) {
        ok(call.length > 0, `${id} 是生命危险条目，必须生成安全句（S5）`);
        ok(call.includes(String(e.emergency_number)),
          `${id} 安全句应含本条号码 ${e.emergency_number}，实际「${call}」`);
        ok(stepScript.includes(call), `${id} 步骤朗读稿必须含安全句（S5：播报须含该句）`);

        // 分诊卡是这类场景的首屏，同样要有
        if (e.triage) {
          const triScript = T.composeTriageScript(e);
          ok(triScript.includes(call), `${id} 分诊朗读稿必须含安全句（分诊是首屏）`);
          // 位置：必须在选项之后，否则老人会以为不用回答分诊问题
          const optIdx = triScript.lastIndexOf('第');
          ok(triScript.indexOf(call) > optIdx, `${id} 安全句应在分诊选项之后，不能在之前`);
        }
        withCall.push(id + ':' + e.emergency_number);
      } else {
        // 反向：非生命危险条目不得出现安全句（否则等于谎报危险）
        ok(call === '', `${id} 不是生命危险条目，不应生成安全句（实际「${call}」）`);
        ok(!stepScript.includes('同时拨打'), `${id} 非生命危险条目不应念「同时拨打」`);
      }
    }
    ok(withCall.length === 6, `应有 6 条生命危险条目带安全句，实际 ${withCall.length}（${withCall.join(',')}）`);
    // 号码必须真实区分：不能全是同一个号（那就是硬写 120 的症状）
    const nums = new Set(withCall.map((x) => x.split(':')[1]));
    ok(nums.size >= 2, `生命危险条目的号码应至少有两种（119/120），实际 ${[...nums].join('/')}`);
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

  /* ---------- 自动朗读（M2，用户裁决 B）----------
     判据全部是「说了 / 没说」，靠 stub 的 spoken 数组直接验。 */
  {
    const M2 = M;
    ok(!!M2.autoReadState, 'app.js 应导出 autoReadState 供断言');
    ok(M2.autoReadState.muted === false, '初始不应静默');

    function resetCards() {
      M2.state.mode = 'daily';
      M2.state.locked = false;
      store.get('dailyAnswer').innerHTML = '';
      store.get('emgAnswer').innerHTML = '';
      M2.autoReadState.muted = false;
    }

    // ① 紧急模式下渲染步骤卡 → 自动发声
    resetCards();
    M2.state.mode = 'emergency';
    M2.state.locked = true;
    {
      const before = spoken.length;
      const box = makeEl('auto1');
      M2.renderStepsCard(M2.entries.fire_home, box);
      ok(spoken.length === before + 1, '紧急模式下出步骤卡应自动朗读一次');
      ok(spoken[spoken.length - 1].text.includes(M2.entries.fire_home.steps.immediate[0].text),
        '自动朗读内容应包含第一条步骤');
    }

    // ② 日常模式下**步骤卡**不自动读（老人可能只是想看看，不要求听）
    //    注意与 ②-b 的区别：日常解释卡要自动读一句摘要，步骤卡不读。
    resetCards();
    {
      const before = spoken.length;
      const box = makeEl('auto2');
      M2.renderStepsCard(M2.entries.fire_home, box);
      ok(spoken.length === before, '日常模式下渲染步骤卡不应自动朗读');
    }

    /* ②-b 日常解释卡（打字提问出的那张）：自动读「名称+摘要」一句，
       不读原因与「平时怎么做」清单。（2026-11-18 用户裁决：只读名称+摘要）

       这条断言存在的理由：上一版只有步骤卡接语音，导致「点图标会读、
       打字不读」——而打字才是真实用法，点图标只是演示路径。 */
    resetCards();
    {
      const e = M2.entries.gas_leak;
      const before = spoken.length;
      const box = makeEl('autoDaily');
      M2.renderDaily(e, box);
      ok(spoken.length === before + 1, '日常解释卡应自动朗读一次');
      const said = spoken[spoken.length - 1].text;
      ok(said.includes(e.name), '日常卡自动朗读应包含场景名');
      ok(said.includes(e.daily.summary), '日常卡自动朗读应包含摘要');
      if (e.daily.why) ok(!said.includes(e.daily.why), '日常卡自动朗读不应念「原因」全文（念长了会被按停止）');
      const p0 = (e.daily.prevention || [])[0];
      if (p0) ok(!said.includes(p0), '日常卡自动朗读不应念「平时怎么做」清单');
      ok(box.innerHTML.includes('data-act="read"'), '日常卡应有朗读按钮');
      ok(box.innerHTML.includes('data-act="stop"'), '日常卡应有停止按钮');
      ok(box.innerHTML.includes('查看操作步骤'), '日常卡仍应有查看步骤入口');
    }

    // ③ 分诊卡阶段读「问题 + 选项」，不是读步骤
    resetCards();
    M2.state.mode = 'emergency';
    M2.state.locked = true;
    {
      const e = M2.entries.gas_leak;
      const before = spoken.length;
      const box = makeEl('auto3');
      // stub 的 querySelectorAll 返回 []，所以不会绑定 triage 点击；只验渲染时的自动读
      M2.renderStepsCard(e, box);
      ok(spoken.length === before + 1, '分诊卡应自动朗读一次');
      const said = spoken[spoken.length - 1].text;
      ok(said.includes(e.triage.question), '自动朗读应包含分诊问题');
      e.triage.options.forEach(function (o) {
        ok(said.includes(o.label), `自动朗读应包含分诊选项「${o.label}」`);
      });
      ok(!said.includes(e.steps.immediate[0].text),
        '分诊阶段不应读出步骤（用户还没选，读默认步骤会误导）');
      // S5：分诊是这三条场景的首屏，必须听到「同时拨打 N」
      ok(said.includes('同时拨打' + e.emergency_number),
        `分诊朗读应含 S5 安全句（同时拨打${e.emergency_number}），实际「${said.slice(-30)}」`);

      /* K2：分诊卡必须有「再听一遍 / 停止」两个按钮。
         分诊卡是 gas_leak / earthquake / fall_elderly 的首屏，没有按钮就
         不能重播、不能按停 —— M2 必做项 2 在这三条场景上不成立。
         判据用「渲染出来的 HTML 里有没有 data-act」，不用模糊文案匹配。 */
      ok(box.innerHTML.includes('data-act="read"'), '分诊卡应有重播按钮（K2）');
      ok(box.innerHTML.includes('data-act="stop"'), '分诊卡应有停止按钮（K2）');
      ok(box.innerHTML.includes('再听一遍'), '分诊卡重播按钮文案应明确');

      // 三条走分诊的条目都要有（不能只给一条）
      ['gas_leak', 'earthquake', 'fall_elderly'].forEach(function (id) {
        const en = M2.entries[id];
        if (!en || !en.triage) return;
        const b2 = makeEl('triage-' + id);
        M2.renderStepsCard(en, b2);
        ok(b2.innerHTML.includes('data-act="read"') && b2.innerHTML.includes('data-act="stop"'),
          `${id} 的分诊卡应同时有重播与停止按钮`);
      });
    }

    // ④ 按停止后本会话不再自动读
    resetCards();
    M2.state.mode = 'emergency';
    M2.state.locked = true;
    {
      // 模拟「按了停止」：直接置位（按钮绑定的就是 muteAutoRead）
      M2.autoReadState.muted = true;
      const before = spoken.length;
      const box = makeEl('auto4');
      M2.renderStepsCard(M2.entries.fire_home, box);
      ok(spoken.length === before, '按过停止后不应再自动朗读');
    }

    // ⑤ 手动点「朗读一遍」不受静默限制（用户可以单独要求读一次）
    {
      const before = spoken.length;
      const box = makeEl('auto5');
      M2.renderStepsCard(M2.entries.fire_home, box);
      ok(spoken.length === before, '（前置）静默期间仍不自动读');
      // 手动路径走 speakSteps(auto 未设)，直接调一次验证
      M2.speakSteps(M2.entries.fire_home, null);
      ok(spoken.length === before + 1, '静默期间手动朗读仍应发声');
    }

    // ⑥ 新一次提问解除静默
    resetCards();
    M2.state.mode = 'emergency';
    M2.state.locked = true;
    M2.autoReadState.muted = true;
    {
      // handleQuery 会 unmute；这里用同步路径避免联网
      M2.handleQuerySync('怎么预防煤气泄漏');
      ok(M2.autoReadState.muted === false, '新一次提问应解除静默（否则老人永远听不到声音且不知原因）');
    }

    // ⑦ 组合朗读稿同样受 S1 约束：分诊稿剥掉字段后只剩标点
    {
      const e = M2.entries.earthquake;
      const script = sandbox.window.TTS.composeTriageScript(e);
      let stripped = script.replace(e.name + '。', '').replace(e.triage.question, '');
      e.triage.options.forEach(function (o, i) {
        stripped = stripped.split('第' + (i + 1) + '个，' + o.label + '。').join('');
      });
      // S5 安全句是唯一允许的例外（同 ② 的理由），先剔除
      const call7 = sandbox.window.TTS.composeEmergencyCallSentence(e);
      if (call7) stripped = stripped.split(call7).join('');
      ok(stripped.replace(/[。，！？：；\s]/g, '') === '',
        `分诊朗读稿含条目之外的内容：「${stripped.slice(0, 40)}」（违反 S1）`);
    }

    // ⑦-b 日常摘要稿同样受 S1 约束：剥掉名称与摘要后只剩标点
    {
      const e = M2.entries.co_poisoning;
      const script = sandbox.window.TTS.composeDailyBriefScript(e);
      let stripped = script.replace(e.name + '。', '').replace(e.daily.summary, '');
      ok(stripped.replace(/[。，、！？：；\s]/g, '') === '',
        `日常摘要稿含条目之外的内容：「${stripped.slice(0, 40)}」（违反 S1）`);
    }

    // ⑦-c 按停止后日常卡也不自动读（静默是全局的，不是只管紧急卡）
    resetCards();
    M2.autoReadState.muted = true;
    {
      const before = spoken.length;
      M2.renderDaily(M2.entries.fire_home, makeEl('autoDaily2'));
      ok(spoken.length === before, '按过停止后日常卡不应再自动朗读');
    }

    // ⑦-d 静默期间手动点「朗读一遍」仍要发声（否则用户「说别念了」后想再听就没路）
    {
      const before = spoken.length;
      M2.speakDaily(M2.entries.gas_leak);
      ok(spoken.length === before + 1, '静默期间手动朗读日常卡仍应发声');
      const said = spoken[spoken.length - 1].text;
      ok(said.includes(M2.entries.gas_leak.daily.why || M2.entries.gas_leak.daily.summary),
        '手动「朗读一遍」应读全文（含原因），不是只读摘要');
    }

    resetCards();
  }
}

/* ---------- 12-b. 运行日志（M0 = app/log.js）----------
   判据全部是「有没有这条记录 / 内容对不对」。日志不做视觉断言（看不了）。 */
{
  const L = sandbox.window.LOG;
  ok(!!L, 'log.js 应已加载并导出 window.LOG');
  ok(typeof L.always === 'function', 'LOG.always 应存在（每模块一条摘要靠它绕过级别筛选）');
  ok(typeof L.newTrace === 'function', 'LOG.newTrace 应存在（traceId 串联全链路）');

  // ① 默认级别下 info 被过滤、always 仍写入 —— 这是「各模块都有日志」的前提
  {
    const saved = L.config.level;
    L.config.level = 'warn';
    L.reset();
    L.emit('info', 'selftest', '这条应被过滤');
    ok(L.buffer.length === 0, '默认 warn 级别下 info 不应入缓冲');
    L.always('selftest', '这条应强制写入');
    ok(L.buffer.length === 1, 'always 应绕过级别筛选写入');
    L.config.level = saved;
    L.reset();
  }

  // ② 密钥脱敏（前端侧）。这是硬约束：key 不许进日志
  {
    const s1 = L.scrubString('key 是 sk-abcdefgh12345678 结尾');
    ok(!/sk-abcdefgh/.test(s1), `日志脱敏失效，sk- 前缀仍可见：「${s1}」`);
    ok(s1.includes('***'), '脱敏后应保留 *** 标记（否则看不出被处理过）');
    const s2 = L.scrubString('{"api_key":"deepseek-raw-value"}');
    ok(!/deepseek-raw-value/.test(s2), 'api_key 字段的值必须脱敏');
    ok(L.scrubString('煤气漏了') === '煤气漏了', '普通文本不应被改写');
    // 回归：无捕获组的正则会让 replace 回调收到偏移量数字，
    // 上一版这里输出过 "92***"（把偏移量拼进了日志）
    ok(!/\d+\*\*\*/.test(s1), `脱敏结果里不应出现「数字+***」（实测踩过）：「${s1}」`);
  }

  // ③ 对象字段里的密钥也要脱，包括藏在字段名里的
  {
    const r = L.scrub({ api_key: 'abcdef123456', nested: { token: 'xyz987654' }, text: 'sk-zzzzzzzz9999' });
    ok(r.api_key === '***', '字段名是 api_key 时应整条替换');
    ok(r.nested.token === '***', '嵌套对象里的 token 也应替换');
    ok(!/zzzzzzzz/.test(String(r.text)), '字符串里的 sk- 也应脱敏');
  }

  // ④ 一次提问 = 一条 trace，且各模块日志都带上它
  //    ⚠️ 选输入很关键（实测踩过两次）：
  //       ① 命中 DANGER_RULES 的句子走 routeOf 的 danger 分支，**不经过场景检索**；
  //       ② 9 条条目发布后，库内提问几乎全被危险信号接走，检索层只剩
  //          「不带危险词的问法」这类输入（如「家里老人腿脚不好」）。
  //       所以断言里必须区分这两种路径，否则测的是不存在的路径。
  {
    L.reset();
    L.config.level = 'debug';   // 打开全量，才能看到各模块 debug 明细
    M.state.mode = 'daily';
    M.state.locked = false;
    M.autoReadState.muted = false;
    store.get('dailyAnswer').innerHTML = '';
    store.get('emgAnswer').innerHTML = '';
    const before = spoken.length;
    M.handleQuerySync('家里老人腿脚不好');   // 无危险词、靠检索层命中 fall_elderly

    const t = L.getTrace();
    ok(!!t, '一次提问后应有 traceId');
    ok(/^q-/.test(t), `提问的 trace 应以 q- 开头，实际 ${t}`);

    const mods = {};
    for (const rec of L.buffer) {
      if (rec.trace === t) mods[rec.module] = (mods[rec.module] || 0) + 1;
    }
    ok(!!mods.retrieval, '检索模块应留下该 trace 的日志');
    ok(!!mods.app, '主流程模块应留下该 trace 的日志');
    ok(!!mods.voice, '语音模块应留下该 trace 的日志（日常卡会自动读）');
    ok(spoken.length === before + 1, '（前置）该次提问应发声一次');

    // 摘要行必须落到 buffer 里且带结果字段
    const summary = L.buffer.find(r => r.module === 'app' && r.msg === '路由决策' && r.trace === t);
    ok(!!summary, '缺少「路由决策」摘要行');
    if (summary) {
      ok(summary.kind === 'steps' || summary.kind === 'dialonly' || summary.kind === 'daily' || summary.kind === 'refuse',
        `路由摘要的 kind 应是四种落点之一，实际 ${summary.kind}`);
      ok(summary.path === 'l3', `同步路径应标 path=l3，实际 ${summary.path}`);
      ok(summary.kind === 'daily', `「家里老人腿脚不好」应落 daily，实际 ${summary.kind}`);
      ok(summary.entryId === 'fall_elderly', `应落 fall_elderly，实际 ${summary.entryId}`);
    }
    const rs = L.buffer.find(r => r.module === 'retrieval' && r.msg === '检索完成' && r.trace === t);
    ok(!!rs, '缺少「检索完成」摘要行');
    if (rs) {
      ok(typeof rs.entryId === 'string', '检索摘要应带 entryId');
      ok(typeof rs.candidateCount === 'number', '检索摘要应带候选数');
      ok(typeof rs.score === 'number' && rs.score > 0, '检索摘要应带分数');
      ok(typeof rs.why === 'string' && rs.why.length > 0, '检索摘要应带命中依据（why），否则无法解释为何命中');
    }

    // 危险信号命中时走 danger 分支，不经过检索层 —— 日志要能看出区别
    L.reset();
    M.handleQuerySync('煤气漏了');
    const t2 = L.getTrace();
    ok(t2 !== t, '第二次提问应换新 trace（否则多条提问混在一根线上）');
    const rs2 = L.buffer.find(r => r.module === 'retrieval' && r.msg === '检索完成');
    ok(!rs2, '命中危险信号的句子不经过场景检索，不应有「检索完成」日志');
    const dg = L.buffer.find(r => r.module === 'retrieval' && String(r.msg).indexOf('危险信号命中') === 0);
    ok(!!dg, '危险信号命中应留 debug 日志（含命中词）');
    if (dg) ok(typeof dg.word === 'string', '危险信号日志应带命中词（否定前缀误判只能靠它定位）');

    L.config.level = 'warn';
    L.reset();
  }

  // ⑤ 输入截断：老人原话不许全文堆积
  {
    const long = '煤气漏了'.repeat(20); // 80 字
    const clipped = L.clipText(long);
    ok(clipped.length <= L.config.textMax + 12, `截断后长度应接近 ${L.config.textMax}，实际 ${clipped.length}`);
    ok(clipped.includes('…'), '截断后应有省略标记');
    ok(clipped.includes('字)'), '截断后应带原始字数（便于判断是不是长输入）');
    ok(L.clipText('短句') === '短句', '短文本不应被截断');
  }

  // ⑥ 「不读的原因」必须能被记出来（2026-11-18 那个 bug 的形状）
  {
    L.reset();
    L.config.level = 'info';
    M.state.mode = 'daily';
    M.state.locked = false;
    M.autoReadState.muted = false;
    const box = makeEl('whyread');
    const before = spoken.length;
    M.renderStepsCard(M.entries.fire_home, box); // 日常模式出步骤卡 → 按设计不读
    ok(spoken.length === before, '（前置）日常模式步骤卡不应发声');
    const rec = L.buffer.find(r => r.msg && r.msg.indexOf('自动朗读跳过') === 0);
    ok(!!rec, '「没读」必须留下日志（否则无法区分没触发与被浏览器拦截）');
    if (rec) ok(rec.reason === 'daily-mode-steps-card', `跳过原因应写明，实际 ${rec.reason}`);
    L.config.level = 'warn';
    L.reset();
  }

  // ⑦ 日志内部出错不能影响产品（约束 B）
  {
    const savedConsole = L.config.console;
    L.config.console = true;
    // 用一个会抛的 console 打一次，确认不抛到调用方
    const badConsole = { log() { throw new Error('console 坏了'); }, info() { throw new Error('x'); }, warn() { throw new Error('x'); }, error() { throw new Error('x'); } };
    const realConsole = sandbox.console;
    sandbox.console = badConsole;
    let threw = false;
    try { L.emit('warn', 'selftest', 'console 抛错时不应冒泡'); } catch (e) { threw = true; }
    sandbox.console = realConsole;
    L.config.console = savedConsole;
    ok(!threw, '日志内部异常不得抛给调用方（日志挂了不能白屏）');
    L.reset();
  }
}

/* ---------- 12-c. 语音输入（ASR，M2）----------
   不开真麦克风：验的是「编码对不对、错误分不分类、状态有没有复位」。
   真实链路（音频→文本）在 tools/e2e_asr.mjs 里跑。 */
{
  const A = sandbox.window.ASR;
  ok(!!A, 'asr.js 应已加载并导出 window.ASR');
  ok(!!A._internals, 'ASR 应暴露 _internals 供离线断言');

  // ① 采样率常量与端点：16k 是实测可用的目标率，改了要重测识别质量
  {
    ok(A.config.TARGET_RATE === 16000, `目标采样率应为 16000（实测可用），实际 ${A.config.TARGET_RATE}`);
    ok(/\/asr$/.test(A.config.ENDPOINT), `ASR 端点应指向代理 /asr，实际 ${A.config.ENDPOINT}`);
    ok(A.config.MIN_MS >= 300, '应有最短录音阈值（防误触）');
    ok(A.config.MAX_MS <= 20000, '应有最长录音上限（防按住不放）');
  }

  // ② 重采样：比例必须正确，否则 ASR 收到的音频时长会错
  {
    const { resampleTo16k } = A._internals;
    const src48 = new Float32Array(48000);
    for (let i = 0; i < src48.length; i++) src48[i] = Math.sin(i / 10);
    const out = resampleTo16k(src48, 48000);
    ok(out.length === 16000, `48k 1 秒应重采样为 16000 点，实际 ${out.length}`);
    // 非整数倍：44.1k → 16k
    const src441 = new Float32Array(44100);
    const out2 = resampleTo16k(src441, 44100);
    ok(Math.abs(out2.length - 16000) <= 1, `44.1k 1 秒应约 16000 点，实际 ${out2.length}`);
    // 源已是 16k 时不应改动
    const same = resampleTo16k(src48.subarray(0, 16000), 16000);
    ok(same.length === 16000, '源已是 16k 时应原样返回');
    // 长度守恒：重采样不应凭空变长（变长说明比例算反了）
    ok(out.length < src48.length, '降采样后点数必须减少（比例反了就会变多）');
  }

  // ③ WAV 头必须合法：ASR 端点按头解析，头错就返回空文本
  {
    const { encodeWav } = A._internals;
    const samples = new Float32Array(1600);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 8) * 0.5;
    const buf = encodeWav(samples, 16000);
    const dv = new DataView(buf);
    const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    ok(tag(0) === 'RIFF', `WAV 头应为 RIFF，实际 ${tag(0)}`);
    ok(tag(8) === 'WAVE', `格式应为 WAVE，实际 ${tag(8)}`);
    ok(tag(12) === 'fmt ', `应有 fmt 块，实际 ${tag(12)}`);
    ok(dv.getUint16(20, true) === 1, '编码格式应为 PCM(1)');
    ok(dv.getUint16(22, true) === 1, '应为单声道');
    ok(dv.getUint32(24, true) === 16000, '采样率字段应为 16000');
    ok(dv.getUint16(34, true) === 16, '位深应为 16');
    ok(dv.getUint32(4, true) === buf.byteLength - 8, 'RIFF 长度字段应等于文件长度-8');
    ok(dv.getUint32(40, true) === samples.length * 2, 'data 块长度应等于样本数×2');
    ok(buf.byteLength === 44 + samples.length * 2, '总长度应为 44 字节头 + 数据');
    // 满幅信号不能溢出（>1 会被 clamp，但不能解成负值）
    const loud = encodeWav(new Float32Array([1, -1, 2, -2]), 16000);
    const lv = new DataView(loud);
    ok(lv.getInt16(44, true) > 0, '正满幅应编码为正数');
    ok(lv.getInt16(46, true) < 0, '负满幅应编码为负数');
    ok(lv.getInt16(48, true) === 32767, `超过 1.0 应钳到 32767，实际 ${lv.getInt16(48, true)}`);
    ok(lv.getInt16(50, true) === -32768, `低于 -1.0 应钳到 -32768，实际 ${lv.getInt16(50, true)}`);
  }

  // ④ 安全上下文判定：file:// 必须判为不安全（否则老人双击打开就「按钮没反应」）
  {
    const { isLocalHost } = A._internals;
    ok(isLocalHost('127.0.0.1', 'http:') === true, '127.0.0.1 + http 应判为安全');
    ok(isLocalHost('localhost', 'http:') === true, 'localhost + http 应判为安全');
    ok(isLocalHost('example.com', 'https:') === true, 'https 任意域名应判为安全');
    ok(isLocalHost('', 'file:') === false, 'file:// 必须判为不安全（拿不到麦克风）');
    ok(isLocalHost('192.168.1.5', 'http:') === false, '局域网 IP + http 不是安全上下文');
  }

  // ⑤ 能力探测在沙箱里应给出明确原因，而不是 supported=true 假装可用
  {
    const st = A.detect();
    ok(st.supported === false, '沙箱无 navigator.mediaDevices，应判为不支持');
    ok(typeof st.reason === 'string' && st.reason.length > 0, '不支持时必须给出用户能看懂的原因');
    ok(/localhost|https|服务/.test(st.reason), `原因应说明安全上下文要求，实际「${st.reason}」`);
  }

  // ⑥ 未开始录音时 stop 不应崩，也不应发请求
  {
    const r = await A.stop();
    ok(r.ok === false && r.reason === 'not-recording', '未录音时 stop 应返回 not-recording');
  }

  // ⑦ app.js 必须把 ASR 状态导出，且按钮存在性可断言
  {
    ok(M.asrAvailable === true, 'app.js 应加载到 asr.js');
    ok(!!M.asrState, 'app.js 应导出 asrState');
    ok(M.asrState.recording === false, '初始不应处于录音态');
  }

  // ⑧ 两个模式都要有语音入口（只做一个等于另一半用户没法用）
  {
    const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
    ok(html.includes('id="dailyTalk"'), '日常模式应有语音输入按钮');
    ok(html.includes('id="emgTalk"'), '紧急模式应有语音输入按钮');
    ok(html.indexOf('asr.js') > -1, 'index.html 应引入 asr.js');
    ok(html.indexOf('asr.js') < html.indexOf('app.js'), 'asr.js 必须在 app.js 之前加载');
  }

  /* ⑨-b K3：语速必须可调，且真的改变 state.rate。
     M2 必做项 2 要求「语速可调慢」。修复前只有 TTS.setRate() 函数、
     界面上没有任何控件 —— 只满足「默认偏慢」，不满足「可调」。 */
  {
    const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
    ok(html.includes('id="rateRow"'), '应有语速控件容器（K3）');
    ok(html.includes('data-rate="0.75"'), '应有「慢一点」档（0.75）');
    ok(html.includes('data-rate="1"') || html.includes('data-rate="1.0"'), '应有「正常」档（1.0）');
    ok(html.indexOf('rateRow') < html.indexOf('app.js'), '语速控件须在 app.js 之前存在（启动时初始化）');

    // 行为：setRate 真的改 state.rate，且越界值被拒
    const T2 = sandbox.window.TTS;
    const saved = T2.state.rate;
    T2.setRate(0.75);
    ok(T2.state.rate === 0.75, `setRate(0.75) 后 rate 应为 0.75，实际 ${T2.state.rate}`);
    T2.setRate(1);
    ok(T2.state.rate === 1, `setRate(1) 后 rate 应为 1，实际 ${T2.state.rate}`);
    T2.setRate(0.1);
    ok(T2.state.rate === 1, `setRate(0.1) 应被拒（范围 0.5-2），实际 ${T2.state.rate}`);
    T2.setRate(9);
    ok(T2.state.rate === 1, `setRate(9) 应被拒，实际 ${T2.state.rate}`);

    // 默认仍须偏慢（老人友好），不能因为加了控件就把默认改成 1.0
    ok(saved <= 0.9, `默认语速应偏慢（≤0.9），实际 ${saved}`);

    // 改档后发声要真的用新速率（不是只改 state）
    T2.setRate(0.75);
    const before = spoken.length;
    await T2.speak('语速测试', { force: true });
    ok(spoken.length === before + 1, '应触发发声');
    ok(spoken[spoken.length - 1].rate === 0.75,
      `发声应使用新语速 0.75，实际 ${spoken[spoken.length - 1].rate}`);
    T2.setRate(saved);

    // CSS：按钮高度与字号达标
    const css2 = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
    const m2 = css2.match(/\.rate-btn\{[^}]*min-height:\s*(\d+)px/s);
    ok(!!m2 && Number(m2[1]) >= 48, `.rate-btn 高度应 >=48px，实际 ${m2 ? m2[1] + 'px' : '未找到'}`);
    const m3 = css2.match(/\.rate-btn\{[^}]*font-size:\s*var\(--fs-min\)/s);
    ok(!!m3, '语速按钮字号须走 var(--fs-min)');
  }

  // ⑨ 语音按钮尺寸达标（与朗读按钮同口径，老人手指粗）
  {
    const css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
    const m = css.match(/\.talk-btn\{[^}]*min-height:\s*(\d+)px/s);
    ok(!!m && Number(m[1]) >= 76, `.talk-btn 高度应 ≥76px，实际 ${m ? m[1] + 'px' : '未找到'}`);
    const fsMin = css.match(/\.talk-btn\{[^}]*font-size:\s*var\(--fs-min\)/s);
    ok(!!fsMin, '语音输入按钮字号须走 var(--fs-min)，不得小于 24pt');
    const touch = css.match(/\.talk-btn\{[^}]*touch-action:\s*none/s);
    ok(!!touch, '按住说话必须设 touch-action:none，否则按下时页面会滚动');
  }

  /* ⑩ 识别结果必须「填进输入框 + 立即出答案」（用户两次实测的合并结论）。
     第一次：「你是不是没有连接文本框？问了也没用」→ 识别文本必须可见。
     第二次：「做成输入后直接出答案，不需要再确认」→ 不要多一步点击。
     所以两条同时断言：input.value 有值 **且** 答案区已出卡。

     ⚠️ 这条断言踩过坑：初版只 grep 源码里有没有 `fillInput(input, r.text)`，
        投毒改成 `if (false && fillInput(...))` 后**仍然全绿**——字符串还在。
        文本匹配不是行为断言。现在真驱动流程。 */
  {
    const T = M._talk;
    ok(!!T && typeof T.fill === 'function', 'app.js 应导出 _talk.fill 供行为断言');

    // ① fillInput 真的写值
    if (T) {
      const fakeInput = makeEl('fakeInput');
      const wrote = T.fill(fakeInput, '煤气漏了怎么办');
      ok(wrote === true, 'fillInput 应返回 true');
      ok(fakeInput.value === '煤气漏了怎么办', `fillInput 应写入 input.value，实际「${fakeInput.value}」`);
      ok(T.fill(null, 'x') === false, '没有输入框时 fillInput 应返回 false（由调用方降级）');
      ok(T.fill(fakeInput, '') === false, '空文本不应写入');
    }

    // ② 端到端：模拟「松手 → 识别成功」，看是否既填框又立即出答案
    if (T) {
      // 把 ASR.stop 换成返回固定文本，模拟识别成功
      const A2 = sandbox.window.ASR;
      const savedStop = A2.stop;
      A2.stop = () => Promise.resolve({ ok: true, text: '煤气漏了怎么办', duration_ms: 1600, latency_ms: 900 });

      /* 关掉 LLM：本断言只关心「文本去哪了 / 有没有出卡」，不该依赖网络。
         若不关，会走到 fetch → 沙箱无网络 → 抛错崩溃，
         崩溃会掩盖真正的失败原因（此项纪律见本文开头「设计原则」）。 */
      const L2 = sandbox.window.LLM;
      const savedEnabled = L2 ? L2.config.enabled : null;
      if (L2) L2.configure({ enabled: false });

      M.state.mode = 'daily';
      M.state.locked = false;
      store.get('dailyAnswer').innerHTML = '';
      store.get('emgAnswer').innerHTML = '';
      store.get('dailyInput').value = '';
      store.get('emgInput').value = '';

      // 伪造「正在录音」状态后再松手
      T.ctl.active = true;
      T.ctl.listening = true;
      T.ctl.btn = makeEl('talkBtn');
      T.ctl.hint = makeEl('talkHint');
      T.ctl.input = store.get('dailyInput');
      // up() 返回 Promise，直接 await 到「整条链走完」
      await T.up();

      ok(store.get('dailyInput').value === '煤气漏了怎么办',
        `识别结果应写进日常输入框（老人要看得见自己说了什么），实际「${store.get('dailyInput').value}」`);
      /* 两个答案区都要查：「煤气漏了怎么办」含危险词，会切紧急模式并渲染到
         emgAnswer —— 只查 dailyAnswer 会漏过。 */
      const dAns = store.get('dailyAnswer').innerHTML;
      const eAns = store.get('emgAnswer').innerHTML;
      ok(dAns.length > 0 || eAns.length > 0,
        `识别后应立即出答案（用户裁决不需要再点确认），实际两区都为空`);
      ok(M.state.locked === true && M.state.mode === 'emergency',
        '「煤气漏了怎么办」含危险信号，出答案时应已切紧急模式并锁定');

      A2.stop = savedStop;
      if (L2) L2.configure({ enabled: savedEnabled });
    }
  }

  /* ⑬ ASR provider 选择器：默认不许变、配错不许静默回落。

     为什么这两条必须锁住：
       2026-11-19 把 ASR 抽成 provider 时，最大的风险不是「讯飞不能用」，
       而是「抽取悄悄改了默认」——那样 04 里所有基于 DeepSeek 的结论都要重跑，
       而且没人会记得为什么。所以「不配 = deepseek」要当契约断言。

       第二条同理：配错名字（xunfei 拼错）若静默回落到 deepseek，
       你会以为测了讯飞，实际测的是 DeepSeek —— 结论对不上且查不出来。
       这是最坏的一类错误，必须让它报错。
  */
  {
    /* 选择器是 ESM 模块，selftest 是 vm 沙箱跑 CJS 风格代码，
       所以这里用动态 import 单独加载，不影响沙箱里的 app 代码。 */
    /* Windows 路径不能直接给 import()（ERR_UNSUPPORTED_ESM_URL_SCHEME），
       必须转成 file:// URL。这是 ESM 在 Windows 上的固定坑。 */
    const { pathToFileURL } = await import('node:url');
    const sel = await import(pathToFileURL(path.join(APP, '..', 'tools', 'asr', 'index.mjs')).href);
    ok(typeof sel.pickProvider === 'function', 'tools/asr/index.mjs 应导出 pickProvider');
    ok(sel.DEFAULT_PROVIDER === 'deepseek',
      `默认 provider 必须是 deepseek（改它等于改产品行为），实际 ${sel.DEFAULT_PROVIDER}`);

    const envFull = {
      API_KEY: 'sk-test-not-real', BASE_URL: 'https://api.deepseek.com',
      XFYUN_APPID: 'a', XFYUN_APIKEY: 'b', XFYUN_APISECRET: 'c'
    };

    // ① 不配 ASR_PROVIDER → 必须选 deepseek
    const p1 = sel.pickProvider({ ...envFull });
    ok(p1.ok === true, `不配 ASR_PROVIDER 时应可用，实际 ${p1.reason || ''}`);
    ok(p1.id === 'deepseek', `不配 ASR_PROVIDER 时应选 deepseek，实际 ${p1.id}`);

    // ② 配 xfyun → 必须选讯飞
    const p2 = sel.pickProvider({ ...envFull, ASR_PROVIDER: 'xfyun' });
    ok(p2.ok === true, `配 xfyun 时应可用，实际 ${p2.reason || ''}`);
    ok(p2.id === 'xfyun', `配 xfyun 时应选 xfyun，实际 ${p2.id}`);

    // ③ 大小写与空格容错（人写 .env 时经常随手写）
    const p3 = sel.pickProvider({ ...envFull, ASR_PROVIDER: '  XFYUN  ' });
    ok(p3.ok === true && p3.id === 'xfyun', `应容忍大小写与空格，实际 ${p3.ok ? p3.id : p3.reason}`);

    // ④ 配错名字 → 必须报错，不许静默回落
    const p4 = sel.pickProvider({ ...envFull, ASR_PROVIDER: 'xunfei' });
    ok(p4.ok === false, '拼错 provider 名字时必须报错，不能静默回落（否则会误以为测了另一家）');
    ok(typeof p4.reason === 'string' && p4.reason.includes('xunfei'),
      `错误信息应回显写错的名称，实际「${p4.reason}」`);
    ok(typeof p4.reason === 'string' && p4.reason.includes('deepseek'),
      '错误信息应列出可选 provider');

    // ⑤ 缺凭证时明确说缺什么
    const p5 = sel.pickProvider({ ASR_PROVIDER: 'xfyun' });
    ok(p5.ok === false, '缺讯飞凭证时应不可用');
    ok(String(p5.reason).includes('XFYUN_APPID'), `应指出缺哪个键，实际「${p5.reason}」`);
    const p6 = sel.pickProvider({});
    ok(p6.ok === false, '全空 env 时 deepseek 也应不可用（缺 key）');

    // ⑥ listProviders 要给前端/health 用的完整信息
    const list = sel.listProviders({ ...envFull });
    ok(Array.isArray(list) && list.length === 2, `应列出 2 个 provider，实际 ${list.length}`);
    const ds = list.find((x) => x.id === 'deepseek');
    const xf = list.find((x) => x.id === 'xfyun');
    ok(ds && ds.isDefault === true, 'deepseek 应标记为默认');
    ok(xf && xf.isDefault === false, 'xfyun 不应标记为默认');
    ok(ds && xf && typeof ds.label === 'string' && typeof xf.label === 'string', '两个 provider 都应有 label');

    // ⑦ 接口约定：provider 暴露 id / label / available / transcribe
    for (const name of ['deepseek', 'xfyun']) {
      const m = sel.getProvider(name);
      ok(!!m, `getProvider('${name}') 应返回模块`);
      ok(m && m.id === name, `${name}.id 应等于 '${name}'`);
      ok(m && typeof m.transcribe === 'function', `${name}.transcribe 必须是函数`);
      ok(m && typeof m.available === 'function', `${name}.available 必须是函数`);
    }

    // ⑧ 讯飞 provider 对非 16k 音频必须拒绝，而不是静默转换
    //    （重采样是前端 asr.js 的职责；两处各转一次会让排查极难）
    const xfMod = sel.getProvider('xfyun');
    const badWav = Buffer.alloc(100);
    badWav.write('RIFF', 0); badWav.write('WAVE', 8);
    const dvw = new DataView(badWav.buffer, badWav.byteOffset, badWav.byteLength);
    dvw.setUint32(24, 24000, true);   // 24k
    dvw.setUint16(22, 1, true);       // 单声道
    dvw.setUint16(34, 16, true);      // 16bit
    const badRes = await xfMod.transcribe(badWav, {}, { XFYUN_APPID: 'a', XFYUN_APIKEY: 'b', XFYUN_APISECRET: 'c' });
    ok(badRes.ok === false, '讯飞 provider 收到 24k 音频应返回失败');
    ok(/16k/.test(String(badRes.error)), `错误信息应说明要求 16k，实际「${badRes.error}」`);
  }


  /* ⑫ onTalkUp 必须返回 Promise，否则测试只能等固定毫秒数。

     实测踩过：e2e_asr 原来写 `setTimeout(r, 120)`。LLM 缓存命中时判定只要 3ms，
     120ms 够用、测试全绿；一旦清缓存，判定要 800–1800ms，测试立刻变成假失败
     ——而产品是好的，红的是测试。这类「测试依赖时序」的脆弱点必须锁住。

     判据：onTalkUp 被调用后returns 一个 thenable，且 await 它之后答案区已出内容。 */
  {
    const T = M._talk;
    ok(!!T && typeof T.up === 'function', 'app.js 应导出 _talk.up');

    // 未在录音状态时也应返回 Promise（不能返回 undefined，否则 await 无意义）
    const idleRet = T.up();
    ok(idleRet && typeof idleRet.then === 'function', '未录音时 onTalkUp 也应返回 Promise');

    // 真实驱动一次：await 之后必须已经出卡（不靠 sleep）
    const A3 = sandbox.window.ASR;
    const savedStop = A3.stop;
    A3.stop = () => Promise.resolve({ ok: true, text: '着火了', duration_ms: 1500, latency_ms: 800 });

    const L3 = sandbox.window.LLM;
    const savedEnabled3 = L3 ? L3.config.enabled : null;
    if (L3) L3.configure({ enabled: false });   // 离线断言，不依赖网络

    M.state.mode = 'daily';
    M.state.locked = false;
    M.autoReadState.muted = false;
    store.get('dailyAnswer').innerHTML = '';
    store.get('emgAnswer').innerHTML = '';
    store.get('emgInput').value = '';

    T.ctl.active = true;
    T.ctl.listening = true;
    T.ctl.btn = makeEl('talkBtn12');
    T.ctl.hint = makeEl('talkHint12');
    T.ctl.input = store.get('emgInput');

    const ret = T.up();
    ok(ret && typeof ret.then === 'function', 'onTalkUp 必须返回 Promise（测试才能 await 到出卡）');
    const result = await ret;
    ok(result === 'done', `完成时应 resolve('done')，实际 ${result}`);
    // await 结束后答案区必须已经有内容 —— 这才叫「等到了完成信号」
    const html = store.get('dailyAnswer').innerHTML || store.get('emgAnswer').innerHTML;
    ok(html.length > 0, 'await onTalkUp() 之后答案区应已出卡（若为空说明 Promise 提前 resolve）');

    A3.stop = savedStop;
    if (L3) L3.configure({ enabled: savedEnabled3 });
    M.state.mode = 'daily';
    M.state.locked = false;
  }


  /* ⑪ 松手监听只能挂一次：两个按钮各挂一次 → 一次松手触发两次 stop
     （实测后果：第二次拿到 not-recording 被当成失败提示）。 */
  {
    const src = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
    const ups = (src.match(/window\.addEventListener\('pointerup'/g) || []).length;
    ok(ups === 1, `window 的 pointerup 监听应只挂 1 次，实际 ${ups} 次`);
    const downs = (src.match(/window\.addEventListener\('pointerdown'/g) || []).length;
    ok(downs === 0, 'window 上不应挂 pointerdown（会与按钮上的重复触发）');
    ok(/downAt/.test(src), '应有 downAt 去重，防 pointerdown 与 keydown 同时触发');
    ok(/onAutoStop/.test(src), '录音到上限时必须有界面接管（否则识别结果无人接收）');
  }
}

/* ---------- 12-d. TTS 引擎注册表与宿主注入（docs/11 选项 A，2026-11-19） ----------

   为什么这节必须存在：
     修复前 `detect()` 判 tauri 可用性读的是 `global.__TTsProbe`，
     而唯一的注入入口 `setTauriAdapter()` 只写 `__TTsSpeak` / `__TTsStop`。
     全仓 grep：`__TTsProbe` **有 1 处读、0 处写**。

     后果链条（M3 打包后才暴露，所以 M2 一切正常）：
       宿主注入实现 → detect() 探针拿不到 → engine 停在 'web'
       → speakTauri 永不调用 → Android 浏览器无 speechSynthesis
       → 最终 engine='none'，老人没有语音。

     这类 bug 的特征是「注入成功但静默不用」，界面完全看不出来。
     所以断言必须验「注入之后引擎真的变了」，不能只验「注入了」。 */

{
  const T = sandbox.window.TTS;
  /* ⚠️ 必须是 sandbox.window，不是 sandbox：
     voice.js 的 IIFE 参数是 `typeof window !== 'undefined' ? window : globalThis`，
     在本沙箱里拿到的是 window 对象。写到 sandbox 顶层，voice.js 读不到。 */
  const W = sandbox.window;

  // ① 注册表存在且顺序正确（01 §2.1：原生优先）
  ok(typeof T.engines === 'function', 'TTS 应导出 engines()：引擎清单可查，不必读源码');
  if (typeof T.engines === 'function') {
    const list = T.engines();
    ok(Array.isArray(list) && list.length >= 2,
      `引擎清单应至少含 tauri 与 web，实际 ${JSON.stringify(list)}`);
    ok(list[0] === 'tauri', `顺序必须是 tauri 优先（01 §2.1），实际第一位 ${list[0]}`);
    ok(list.indexOf('web') > 0, 'web 应排在 tauri 之后');
  }

  // ② 当前引擎在非 Tauri 环境应为 web
  ok(T.activeEngine() === 'web',
    `普通浏览器环境当前引擎应为 web，实际 ${T.activeEngine()}`);

  // ③ 核心：注入适配器后，探针必须被写上，且引擎切到 tauri
  {
    const savedEngine = T.state.engine;
    const savedSpeak = W.__TTsSpeak;
    const savedStop = W.__TTsStop;
    const savedProbe = W.__TTsProbe;

    // 模拟宿主：注入真实实现
    W.__TAURI_INTERNALS__ = {};          // 让 isTauri() 为真
    let spoke = 0;
    T.setTauriAdapter(
      function () { spoke++; return Promise.resolve(); },
      function () { /* stop */ }
    );

    ok(typeof W.__TTsProbe === 'function',
      'setTauriAdapter 必须写 __TTsProbe —— 否则 detect() 判不出 tauri（本次修的 bug）');
    if (typeof W.__TTsProbe === 'function') {
      ok(W.__TTsProbe() === true, '__TTsProbe() 应返回 true（表示引擎可用）');
    }

    // detect() 是异步的；setTauriAdapter 内部会重探
    await new Promise((r) => setTimeout(r, 30));

    ok(T.state.engine === 'tauri',
      `注入适配器后引擎应切到 tauri，实际 ${T.state.engine}（若为 web 说明注入被静默忽略）`);
    ok(T.state.supported === true, '注入后 supported 应为 true');

    // ④ 切到 tauri 后，speak 必须走宿主注入的实现（不是走浏览器层）
    if (T.state.engine === 'tauri') {
      const before = spoke;
      const r = await T.speak('测试注入', { force: true });
      ok(spoke === before + 1, 'engine=tauri 时 speak 必须调用宿主注入的实现');
      ok(r && r.ok === true, `注入实现成功时应返回 ok:true，实际 ${JSON.stringify(r)}`);
      ok(r && r.engine === 'tauri', `返回值应标 engine=tauri，实际 ${r && r.engine}`);
    }

    // ⑤ 宿主自带探针时不许被覆盖（更精细的探测结果要尊重）
    {
      const savedProbe2 = W.__TTsProbe;
      let customCalled = 0;
      W.__TTsProbe = function () { customCalled++; return true; };
      T.setTauriAdapter(function () { return Promise.resolve(); }, function () {});
      ok(typeof W.__TTsProbe === 'function' && W.__TTsProbe() === true,
        '宿主自带的 __TTsProbe 不应被 setTauriAdapter 覆盖');
      ok(customCalled >= 1, '宿主自带探针应仍被调用（未被替换成空壳）');
      void savedProbe2;
    }

    // 复原沙箱，避免影响后续断言
    delete W.__TAURI_INTERNALS__;
    if (savedSpeak === undefined) delete W.__TTsSpeak; else W.__TTsSpeak = savedSpeak;
    if (savedStop === undefined) delete W.__TTsStop; else W.__TTsStop = savedStop;
    if (savedProbe === undefined) delete W.__TTsProbe; else W.__TTsProbe = savedProbe;
    T.state.engine = savedEngine;
    T.state.supported = true;
  }

  // ⑥ stop() 也要查表分发：engine=tauri 时调宿主 stop，不调浏览器 cancel
  {
    const savedEngine = T.state.engine;
    let hostStop = 0;
    let webCancel = 0;
    const ss = sandbox.speechSynthesis;
    const savedCancel = ss && ss.cancel;

    W.__TTsStop = function () { hostStop++; };
    W.__TTsProbe = function () { return true; };
    W.__TAURI_INTERNALS__ = {};
    if (ss) ss.cancel = function () { webCancel++; };

    T.state.engine = 'tauri';
    T.stop();
    ok(hostStop === 1, `engine=tauri 时 stop 应调宿主实现 1 次，实际 ${hostStop}`);
    ok(webCancel === 0, `engine=tauri 时 stop 不应调浏览器 cancel，实际 ${webCancel} 次`);

    T.state.engine = 'web';
    T.stop();
    ok(webCancel === 1, `engine=web 时 stop 应调浏览器 cancel 1 次，实际 ${webCancel}`);

    if (ss && savedCancel) ss.cancel = savedCancel;
    delete W.__TTsProbe;
    delete W.__TTsStop;
    delete W.__TAURI_INTERNALS__;
    T.state.engine = savedEngine;
  }

  // ⑦ 没有引擎时 speak 要给结构化失败，不能抛
  {
    const savedEngine = T.state.engine;
    T.state.engine = 'none';
    let threw = false;
    let r = null;
    try {
      r = await T.speak('没有引擎', { force: true });
    } catch (e) { threw = true; }
    ok(!threw, '没有引擎时 speak 不许抛异常（上层要结构化错误）');
    ok(r && r.ok === false && r.reason === 'no-engine',
      `没有引擎时应返回 reason=no-engine，实际 ${JSON.stringify(r)}`);
    T.state.engine = savedEngine;
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
