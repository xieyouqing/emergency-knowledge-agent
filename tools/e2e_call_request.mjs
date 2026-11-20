#!/usr/bin/env node
/**
 * 显式拨号请求（requested）验收。
 *
 * 背景：用户说「帮我拨打120」时，模型已经会调 dial，但旧行为把它当现场急救出口，
 * 直接进紧急模式并锁定旧消息。本脚本验证：
 *   · 明确要求拨 120/119 → 只出「现在拨打 N」，mode 仍 daily、不锁；
 *   · 同一句里有现场危险 → 仍按紧急处理；
 *   · 110/114 等非白名单 → refuse，不改写成 120。
 *
 * 前置: node tools/llm_proxy.mjs
 * 用法: node tools/e2e_call_request.mjs
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
  console.error(`FAIL: 连不上代理 ${PROXY}`);
  process.exit(1);
}

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
        if (on === undefined) cls.has(c) ? cls.delete(c) : cls.add(c);
        else if (on) cls.add(c);
        else cls.delete(c);
      },
    },
    addEventListener(t, fn) {
      (this.handlers[t] ||= []).push(fn);
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
window.ACT_SEED = true;
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
  console.error('FAIL: app 未加载');
  process.exit(1);
}
LLM.configure({ timeout: 8000 });

const CASES = [
  { text: '帮我拨打120', expect: 'call', number: '120' },
  { text: '帮我打119', expect: 'call', number: '119' },
  { text: '叫救护车', expect: 'call', number: '120' },
  { text: '煤气漏了，帮我打120', expect: 'emergency' },
  { text: '帮我打110', expect: 'refuse' },
];

let pass = 0;
let fail = 0;
const fails = [];
function ok(c, m) {
  if (c) pass++;
  else {
    fail++;
    fails.push(m);
  }
}

console.log('=== 显式拨号请求 ===\n');
for (const c of CASES) {
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
  const tag = `「${c.text}」`;

  if (c.expect === 'call') {
    ok(html.includes('call-request'), `${tag} 应为 call-request 卡，实际 ${html.slice(0, 80)}`);
    ok(html.includes('拨打 ' + c.number), `${tag} 应显示拨打 ${c.number}`);
    ok(M.state.mode === 'daily', `${tag} 不得进入紧急模式，实际 ${M.state.mode}`);
    ok(M.state.locked === false, `${tag} 不得锁定，实际 locked=${M.state.locked}`);
  } else if (c.expect === 'emergency') {
    ok(M.state.mode === 'emergency', `${tag} 有现场危险，应进紧急，实际 ${M.state.mode}`);
    ok(!html.includes('call-request'), `${tag} 不应只给 call-request 卡`);
  } else if (c.expect === 'refuse') {
    ok(html.includes('class="refuse"'), `${tag} 应 refuse，实际 ${html.slice(0, 80)}`);
    ok(!html.includes('tel:110'), `${tag} 不得渲染 110 拨号按钮`);
  }
  console.log(`  ${fails.length ? '·' : '✓'} ${c.text}`);
}

console.log('\n' + '='.repeat(50));
if (fail) {
  console.log(`断言 ${pass + fail} 条：通过 ${pass}，失败 ${fail}`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`断言 ${pass + fail} 条：全部通过`);
console.log('PASS: 显式拨号请求');
