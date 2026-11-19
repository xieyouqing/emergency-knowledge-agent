#!/usr/bin/env node
/**
 * 端到端链路验证：输入 → LLM 判定 → 路由 → 渲染
 *
 * 与 selftest_m1.mjs 的分工：
 *   selftest_m1.mjs  离线断言，不联网。保证路由映射不出错。
 *   e2e_llm.mjs      联网跑真实主路径 handleQuery()，保证「这条链真的通」。
 *
 * 为什么两者都要：离线断言全绿，可能只是我把桩写对了；
 * 必须真跑一次主路径，才知道 LLM → 路由 → 渲染 之间没断。
 *
 * 前置: node tools/llm_proxy.mjs 已启动
 * 用法: node tools/e2e_llm.mjs
 *
 * 退出码 0 = 全部符合预期；1 = 有不符合项
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'app');
const PROXY = 'http://127.0.0.1:8787';

/* ---------- 前置：代理必须在 ---------- */
try {
  const h = await fetch(`${PROXY}/health`, { signal: AbortSignal.timeout(3000) });
  if (!h.ok) throw new Error('health 非 200');
} catch (e) {
  console.error(`FAIL: 连不上 LLM 代理 ${PROXY}`);
  console.error('  先跑: node tools/llm_proxy.mjs');
  console.error('  不跑真链路就不算验证过。');
  process.exit(1);
}

/* ---------- DOM stub：要能取到 innerHTML，也要支持事件绑定 ---------- */
const store = new Map();
function makeEl(id) {
  return {
    id, innerHTML: '', hidden: false, value: '', textContent: '',
    handlers: {},
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    scrollIntoView() {},
    getAttribute() { return null; },
    setAttribute() {},
    closest() { return null; }
  };
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
const sandbox = {
  window, document, console, Math, String, Number, Object, Array, JSON,
  fetch, AbortController, setTimeout, clearTimeout, Promise, Error, Date, RegExp
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['log.js', 'knowledge.js', 'retrieval.js', 'llm.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox);
}
const M = sandbox.window.__M1__;
if (!M) { console.error('FAIL: app.js 未导出 __M1__'); process.exit(1); }
if (!M.LLMAvailable) { console.error('FAIL: app.js 未加载到 LLM（llm.js 未生效）'); process.exit(1); }

/* ---------- 用例：每条给出「输入 / 期望落点 / 期望内容特征」 ----------
   注意：含 triage 的场景（gas_leak / earthquake / fall_elderly）首渲染是**分诊卡**，
   不是完整步骤列表。所以内容特征按分诊卡来断言，不硬套步骤文字。 */
const CASES = [
  { text: '煤气漏了',            expect: 'steps',    must: ['燃气泄漏', 'triage'] },
  { text: '着火了',              expect: 'steps',    must: ['家庭火灾', '贴近地面'] },
  { text: '孩子被热水烫起泡了',  expect: 'steps',    must: ['烧烫伤', '冷水'] },
  { text: '地震了',              expect: 'steps',    must: ['地震', 'triage'] },
  { text: '老人噎住了',          expect: 'steps',    must: ['气道梗阻', '拍'] },
  { text: '怎么预防煤气泄漏',    expect: 'daily',    must: ['查看操作步骤'] },
  /* 这条用例**不能断言固定落点**，原因是实测出来的（2026-11-19）：

     同一句话、同一时刻、temperature=0，连测 8 次：
       0.55 / 0.72 / 0.55 / 0.55 / 0.55 / 0.55 / 0.72 / 0.72
     而 MIN_CONFIDENCE = 0.60 正好落在 0.55 与 0.72 之间 →
       conf=0.55 → 降级为拒答（refuse）
       conf=0.72 → 给日常卡（daily）

     所以「落点是 refuse 还是 daily」在**单次调用层面就是随机的**，不是模型版本漂移。
     （`09` §2.10 曾记录「连调 5 次零抖动」，那是错的，已修正。）

     那这条用例还测什么？测**安全判据**——无论走哪条路，都不能给出错误的急救步骤：
       - refuse：拒答话术 + 拨号按钮，零步骤
       - daily：日常解释卡，不含「立刻做/绝对不要做」段
     这两个都是安全落点；**不安全的落点是 steps（给了电梯困人的急救步骤）**。
     场景判断本身是稳的（8/8 都是 elevator_trapped + prevention），所以这条能稳定断言。 */
  { text: '电梯多久年检一次',    expect: 'refuse|daily', must: [] },
  { text: '煤气费怎么交',        expect: 'refuse',   must: ['答不了'] },
  { text: '电梯广告怎么投诉',    expect: 'refuse',   must: ['答不了'] },   // 曾经误给电梯困人步骤卡
  { text: '有人落水了',          expect: 'dialonly', must: ['没有可靠的操作步骤', '120'] },
  { text: '今天天气怎么样',      expect: 'refuse',   must: ['答不了'] }
];

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

console.log('=== 端到端链路（真实调用 LLM 代理 + 真实主路径 handleQuery）===\n');
console.log(pad('输入', 24) + pad('期望', 11) + pad('实际', 20) + '耗时');
console.log('-'.repeat(72));

function pad(s, n) {
  let w = 0;
  for (const ch of String(s)) w += /[\u4e00-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(0, n - w));
}

/* 按真实 HTML 结构的 class 判落点 —— 不用模糊正则。
   上一版用 /tel:\d{3}/ 判 dialonly，结果把带拨号按钮的拒答卡也判成了 dialonly。 */
function classify(html) {
  if (!html) return 'empty';
  if (html.includes('class="dialonly"')) return 'dialonly';
  if (html.includes('class="refuse"')) return 'refuse';
  if (html.includes('triage-btn')) return 'steps';     // 分诊卡 = 步骤路径的第一步
  if (html.includes('seg-immediate')) return 'steps';
  if (html.includes('查看操作步骤')) return 'daily';
  return 'unknown';
}

for (const c of CASES) {
  // 每条用例前重置状态，避免上一条的 emergency 锁影响本条
  M.state.mode = 'daily';
  M.state.locked = false;
  M.state.choice = null;
  store.get('dailyAnswer').innerHTML = '';
  store.get('emgAnswer').innerHTML = '';

  const t0 = Date.now();
  await M.handleQuery(c.text);
  const ms = Date.now() - t0;

  const dailyHtml = store.get('dailyAnswer').innerHTML;
  const emgHtml = store.get('emgAnswer').innerHTML;
  const html = emgHtml || dailyHtml;
  const got = classify(html);

  console.log(pad(c.text, 24) + pad(c.expect, 11) + pad(got, 20) + (ms + 'ms'));

  /* expect 支持 "refuse|daily" 多选：有些样本的落点本身不稳定（见上方长注释），
     这时断言的是「落在允许集合内」，而不是某一个确定值。 */
  const allowed = String(c.expect).split('|');
  ok(allowed.includes(got), `「${c.text}」落点应为 ${c.expect}，实际 ${got}`);
  /* 安全底色：无论落在哪个允许落点，都绝不能是 steps（那就是给了错误的急救步骤）。
     这条对「不稳定落点」的样本尤其重要——两个允许落点是安全的，steps 不是。 */
  if (allowed.length > 1) {
    ok(got !== 'steps', `「${c.text}」落点不稳定时可以 refuse 或 daily，但绝不能给急救步骤卡（实际 ${got}）`);
  }
  ok(html.length > 0, `「${c.text}」渲染结果为空（白屏）`);
  for (const kw of c.must) {
    ok(html.includes(kw), `「${c.text}」渲染结果缺少「${kw}」`);
  }
  // 安全项：拒答/拨号卡绝不能带出步骤段（S1）
  if (c.expect === 'refuse' || c.expect === 'dialonly') {
    ok(!html.includes('seg-immediate') && !html.includes('triage-btn'),
      `「${c.text}」给的是 ${c.expect} 卡，但渲染里出现了步骤/分诊段（违反 S1）`);
  }
}

/* ---------- 降级链路：代理不可用时必须回落 l3，不白屏 ---------- */
console.log('\n=== 降级链路：把 LLM 指向不存在的端口 ===');
{
  const L = sandbox.window.LLM;
  const savedEp = L.config.endpoint;
  L.configure({ endpoint: 'http://127.0.0.1:59999/judge', timeout: 800 });

  M.state.mode = 'daily';
  M.state.locked = false;
  store.get('dailyAnswer').innerHTML = '';
  store.get('emgAnswer').innerHTML = '';

  await M.handleQuery('煤气漏了');
  const html = store.get('emgAnswer').innerHTML || store.get('dailyAnswer').innerHTML;
  const cls = classify(html);
  console.log('  代理不可用时「煤气漏了」渲染:', cls, '长度', html.length);
  ok(html.length > 0, '代理不可用时不得白屏');
  ok(cls === 'steps', `代理不可用时应回落 l3 并仍能给出步骤路径（实际 ${cls}）`);
  ok(L.stats.fallbacks > 0, 'stats.fallbacks 应记录到回落次数');
  console.log('  LLM stats:', JSON.stringify(L.stats));

  L.configure({ endpoint: savedEp });
}

/* ---------- 结果 ---------- */
console.log('\n' + '='.repeat(78));
if (fail) {
  console.log(`断言 ${pass + fail} 条：通过 ${pass}，失败 ${fail}`);
  console.log('\n失败明细:');
  for (const f of fails) console.log('  ✗ ' + f);
  console.log('\nFAIL: 端到端链路未跑通');
  process.exit(1);
} else {
  console.log(`断言 ${pass} 条：全部通过`);
  console.log('PASS: 端到端链路跑通（输入 → LLM 判定 → 路由 → 渲染，含降级）');
}
