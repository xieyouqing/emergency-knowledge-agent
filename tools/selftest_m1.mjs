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
const sandbox = { window, document, console, Math, String, Number, Object, Array, JSON };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(APP, 'knowledge.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'retrieval.js'), 'utf8'), sandbox);
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

/* ---------- 1. 构建产物只含 published 条目 ---------- */
const meta = M.kbMeta;
ok(meta.slots === 3, `图标槽位应为 3 个（实际 ${meta.slots}）`);
ok(meta.entries === 3, `条目应为 3 条（实际 ${meta.entries}）`);
const allowed = ['elevator_trapped', 'fall_elderly', 'gas_leak'];
ok(
  Object.keys(M.entries).sort().join(',') === allowed.join(','),
  `条目集合应为 ${allowed.join(',')}，实际 ${Object.keys(M.entries).sort().join(',')}`
);
for (const id of Object.keys(M.entries)) {
  ok(M.entries[id].status === 'published', `${id} 的 status 应为 published`);
  ok(M.entries[id].review.checklist.source_quote_verbatim === true, `${id} 的 source_quote_verbatim 应为 true`);
  ok(M.entries[id].review.agent_check.source_quote === 'pass', `${id} 的 agent_check 应为 pass`);
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

/* ---------- 5. 未发布场景 → 拨号卡，不给步骤（决定4） ---------- */
for (const [text, num] of [['着火了', '119'], ['有人落水了', '120'], ['孩子触电了', '120']]) {
  const r = M.routeOf(text);
  ok(r.entryId === null, `「${text}」不应命中任何已发布条目`);
  ok(r.dialOnly === true, `「${text}」应走拨号卡`);
  ok(r.dangerNumber === num, `「${text}」拨号码应为 ${num}，实际 ${r.dangerNumber}`);
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

  // 索引规模断言：3 条条目下 df=1 占比 100%（这是 §6.6 结论的数据基础，变了要重新审视）
  const idx = R._internals.buildIndex(Object.values(ENT));
  const dfVals = Object.values(idx.df);
  const allOne = dfVals.every(d => d === 1);
  ok(allOne, `N=3 时所有词项 df 应为 1（IDF 失效，见 docs/03 §6.6）。若此断言失败说明条目数已变，须重跑引擎对照`);
}

/* ---------- 12. 投毒自检：故意改坏输入，确认断言会红 ---------- */
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
