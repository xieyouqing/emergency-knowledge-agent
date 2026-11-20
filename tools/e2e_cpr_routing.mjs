#!/usr/bin/env node
/**
 * V4 路由验收（docs/14 §4.2 C1–C12）：在线 + 断网两路。
 *
 * 为什么不是单测 planRule：
 *   条目发布后真正会出问题的是**产品路径**——seedDecision 预置、/act 模型决策、
 *   agent 范围闸三者任一没接上，单测全绿也可能给用户成人 CPR 或错误步骤。
 *   所以这里跑真实 handleQuery()，两条路各跑一遍。
 *
 * 前置（在线路）: node tools/llm_proxy.mjs 已启动
 * 用法: node tools/e2e_cpr_routing.mjs
 * 退出码 0 = 12 条 × 2 路全过
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'app');
const PROXY = 'http://127.0.0.1:8787';

try {
  const h = await fetch(`${PROXY}/health`, { signal: AbortSignal.timeout(3000) });
  if (!h.ok) throw new Error('health 非 200');
} catch {
  console.error(`FAIL: 连不上 LLM 代理 ${PROXY}（在线路需要真模型）`);
  process.exit(1);
}

/* ---------- DOM stub（与 e2e_llm 同构） ---------- */
const store = new Map();
function makeEl(id) {
  const cls = new Set();
  return {
    id,
    innerHTML: '',
    hidden: false,
    value: '',
    textContent: '',
    handlers: {},
    className: '',
    _classes: cls,
    classList: {
      add(c) {
        cls.add(c);
      },
      remove(c) {
        cls.delete(c);
      },
      contains(c) {
        return cls.has(c);
      },
      toggle(c, on) {
        if (on === undefined) {
          cls.has(c) ? cls.delete(c) : cls.add(c);
        } else if (on) cls.add(c);
        else cls.delete(c);
      },
    },
    addEventListener(type, fn) {
      (this.handlers[type] ||= []).push(fn);
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    scrollIntoView() {},
    getAttribute() {
      return null;
    },
    setAttribute() {},
    closest() {
      return null;
    },
    children: [],
    appendChild(c) {
      this.children = this.children || [];
      this.children.push(c);
      c.parentNode = this;
      return c;
    },
    removeChild(c) {
      this.children = (this.children || []).filter((x) => x !== c);
      return c;
    },
    insertBefore(c) {
      this.children = this.children || [];
      this.children.unshift(c);
      c.parentNode = this;
      return c;
    },
    parentNode: null,
  };
}
const document = {
  getElementById(id) {
    if (!store.has(id)) store.set(id, makeEl(id));
    return store.get(id);
  },
  createElement(tag) {
    const n = makeEl('#' + tag);
    n.setAttribute = function (k, v) {
      this._attrs = this._attrs || {};
      this._attrs[k] = v;
      if (k === 'id') {
        store.set(String(v), this);
        this.id = String(v);
      }
    };
    n.removeAttribute = function (k) {
      if (k === 'id') {
        for (const [key, val] of store.entries()) if (val === this) store.delete(key);
        this.id = '';
      }
    };
    n.tagName = String(tag).toUpperCase();
    return n;
  },
  body: makeEl('body'),
  querySelectorAll() {
    return [];
  },
  addEventListener() {},
};
const window = { document, scrollTo() {}, addEventListener() {}, removeEventListener() {} };
const sandbox = {
  window,
  document,
  console,
  Math,
  String,
  Number,
  Object,
  Array,
  JSON,
  fetch,
  AbortController,
  setTimeout,
  clearTimeout,
  Promise,
  Error,
  Date,
  RegExp,
};
sandbox.globalThis = sandbox;
window.ACT_SEED = true; // 与产品默认一致；范围/步骤问题必须在 seed 打开时也成立
vm.createContext(sandbox);

for (const f of [
  'log.js',
  'knowledge.js',
  'retrieval.js',
  'llm.js',
  'state.js',
  'chat.js',
  'tools.js',
  'render.js',
  'speak.js',
  'talk.js',
  'agent.js',
  'app.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox);
}
const M = sandbox.window.__M1__;
const LLM = sandbox.window.LLM;
if (!M || !LLM) {
  console.error('FAIL: app.js 未导出 __M1__ 或 LLM 未加载');
  process.exit(1);
}
LLM.configure({ timeout: 8000 });

/* ---------- 12 条：expected 用「用户最终看到什么」描述 ---------- */
const CASES = [
  { id: 'C1', text: '没有呼吸了', expect: 'steps', must: '心肺复苏' },
  { id: 'C2', text: '我妈摔倒了没有呼吸', expect: 'steps', must: '心肺复苏' },
  { id: 'C3', text: '心跳停了', expect: 'steps', must: '心肺复苏' },
  { id: 'C4', text: '没有脉搏了', expect: 'steps', must: '心肺复苏' },
  { id: 'C5', text: '叫不醒，还有呼吸', expect: 'dial' },
  { id: 'C6', text: '还有呼吸但没反应', expect: 'dial' },
  { id: 'C7', text: '摔倒了但能说话', expect: 'triage', must: '老人跌倒' },
  { id: 'C8', text: '怎么预防心梗', expect: 'safe_nocpr' },
  { id: 'C9', text: '大出血止不住', expect: 'entry', must: '大出血' },
  { id: 'C10', text: '划破了但没出多少血', expect: 'safe_nosevere' },
  { id: 'C11', text: '婴儿没呼吸', expect: 'dial' },
  { id: 'C12', text: '溺水没呼吸', expect: 'entry', must: '溺水' },
];

function classify(html) {
  if (!html) return 'empty';
  if (html.includes('class="dialonly"')) return 'dial';
  if (html.includes('class="refuse"')) return 'refuse';
  if (html.includes('triage-btn')) return 'triage';
  if (html.includes('seg-immediate')) return 'steps';
  if (html.includes('查看操作步骤')) return 'daily';
  return 'unknown';
}

let pass = 0;
let fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    fails.push(msg);
  }
}

async function runCase(c, tag) {
  M.state.mode = 'daily';
  M.state.locked = false;
  M.state.utterances.length = 0;
  M.state.choice = null;
  document.getElementById('dailyAnswer').innerHTML = '';
  document.getElementById('emgAnswer').innerHTML = '';

  await M.handleQuery(c.text);
  const html =
    document.getElementById('emgAnswer').innerHTML ||
    document.getElementById('dailyAnswer').innerHTML;
  const got = classify(html);

  if (c.expect === 'steps') {
    ok(got === 'steps', `${tag} ${c.id}「${c.text}」应为 steps，实际 ${got}`);
    ok(html.includes(c.must), `${tag} ${c.id}「${c.text}」应含「${c.must}」`);
    ok(!html.includes('老人跌倒'), `${tag} ${c.id}「${c.text}」不得走 fall_elderly 分诊`);
  } else if (c.expect === 'triage') {
    ok(got === 'triage', `${tag} ${c.id}「${c.text}」应为 triage，实际 ${got}`);
    ok(html.includes(c.must), `${tag} ${c.id}「${c.text}」应含「${c.must}」`);
  } else if (c.expect === 'entry') {
    /* 条目首屏可能是分诊卡（如大出血先问「压得住吗」），
       这里断言「进了正确条目且没有跑到别处」，不硬套 triage/steps。 */
    ok(got === 'triage' || got === 'steps', `${tag} ${c.id}「${c.text}」应进入条目卡，实际 ${got}`);
    ok(html.includes(c.must), `${tag} ${c.id}「${c.text}」应含「${c.must}」`);
  } else if (c.expect === 'dial') {
    ok(got === 'dial', `${tag} ${c.id}「${c.text}」应为 dial 120，实际 ${got}`);
    ok(html.includes('120'), `${tag} ${c.id}「${c.text}」拨号卡应含 120`);
  } else if (c.expect === 'safe_nocpr') {
    /* docs/14 C8 只要求「不得给 CPR 步骤」，refuse 或 daily 都允许（记录实际落点）。
       模型可能给 cpr 的日常解释卡；那是 daily，不是急救步骤，不能判失败。 */
    ok(got === 'refuse' || got === 'daily', `${tag} ${c.id}「${c.text}」应为 refuse/daily，实际 ${got}`);
    ok(got !== 'steps', `${tag} ${c.id}「${c.text}」不得给 CPR 步骤卡`);
  } else if (c.expect === 'safe_nosevere') {
    ok(!html.includes('大出血'), `${tag} ${c.id}「${c.text}」不得触发大出血条目`);
  }
}

console.log('=== V4 CPR/大出血路由：12 条 × 在线/断网 ===\n');
for (const mode of ['online', 'offline']) {
  LLM.configure({ enabled: mode === 'online' });
  for (const c of CASES) await runCase(c, mode === 'online' ? '在线' : '断网');
  console.log(`${mode === 'online' ? '在线' : '断网'}：${pass + fail} 条断言累计`);
}
LLM.configure({ enabled: true });

console.log('\n' + '='.repeat(60));
if (fail) {
  console.log(`断言 ${pass + fail} 条：通过 ${pass}，失败 ${fail}`);
  for (const f of fails) console.log('  ✗ ' + f);
  console.log('\nFAIL: V4 路由未全过');
  process.exit(1);
}
console.log(`断言 ${pass + fail} 条：全部通过`);
console.log('PASS: V4 12 条 × 在线/断网全过');
