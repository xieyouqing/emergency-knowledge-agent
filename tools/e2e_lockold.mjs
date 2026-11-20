#!/usr/bin/env node
/**
 * D-11 = A（2026-11-20）产品路径验证：进入紧急后，旧助手消息保留但置灰、不可交互；
 * 新产生的紧急消息不受影响。
 *
 * 判据：
 *   ① 旧助手消息的 DOM 仍在（保留可回看）
 *   ② 旧消息有 is-old-locked + aria-disabled=true
 *   ③ 新紧急消息没有 is-old-locked
 *
 * 前置: 无（不联网；/act 用桩）
 * 用法: node tools/e2e_lockold.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'app');

const store = new Map();
function makeEl(id) {
  const cls = new Set();
  return {
    id,
    innerHTML: '',
    hidden: false,
    value: '',
    textContent: '',
    className: '',
    _attrs: {},
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
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    scrollIntoView() {},
    getAttribute(k) {
      return this._attrs[k] === undefined ? null : this._attrs[k];
    },
    setAttribute(k, v) {
      this._attrs[k] = String(v);
      if (k === 'id') {
        store.set(String(v), this);
        this.id = String(v);
      }
    },
    removeAttribute(k) {
      delete this._attrs[k];
      if (k === 'id') this.id = '';
    },
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
    return makeEl('#' + tag);
  },
  body: makeEl('body'),
  querySelectorAll() {
    return [];
  },
  addEventListener() {},
};
const window = { document, scrollTo() {}, addEventListener() {}, removeEventListener() {} };
window.ACT_SEED = true;

const calls = [];
function stubFetch(url, opts) {
  const u = String(url);
  if (u.endsWith('/act')) {
    calls.push(JSON.parse((opts && opts.body) || '{}'));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          act: 'get_steps',
          args: { scene: 'gas_leak' },
          reason: 'stub',
          note: '',
          latency_ms: 1,
          cached: false,
        }),
      text: () => Promise.resolve(''),
    });
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ok: true }),
    text: () => Promise.resolve(''),
  });
}

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
  fetch: stubFetch,
  AbortController,
  setTimeout,
  clearTimeout,
  Promise,
  Error,
  Date,
  RegExp,
};
sandbox.globalThis = sandbox;
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
const CHAT = sandbox.window.CHAT;
if (!M || !CHAT) {
  console.error('FAIL: app.js/chat.js 未导出');
  process.exit(1);
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

console.log('=== D-11=A：旧消息保留但不可交互 ===\n');

/* 先造一条日常旧消息（模拟老人之前看过的一张卡） */
const oldHost = CHAT.answerHost('daily', 'daily');
oldHost.innerHTML = '<article class="explain">旧的日常解释卡</article>';

await M.handleQuery('煤气漏了');

const assistants = CHAT.messages.filter((x) => x.role === 'assistant');
const oldMsg = assistants[0];
const newMsg = assistants[assistants.length - 1];

console.log(`助手消息 ${assistants.length} 条；旧=${oldMsg && oldMsg.kind}；新=${newMsg && newMsg.kind}`);
ok(assistants.length >= 2, `应至少有旧 + 新两条助手消息，实际 ${assistants.length}`);

if (oldMsg) {
  ok(!!oldMsg.el, '旧消息 DOM 必须保留（可回看）');
  ok(oldMsg.el.classList.contains('is-old-locked'), '旧消息应带 is-old-locked');
  ok(oldMsg.el.getAttribute('aria-disabled') === 'true', '旧消息应 aria-disabled=true');
  ok(oldMsg.el.hidden !== true, '旧消息不得被 hidden（保留可回看）');
}
if (newMsg && newMsg !== oldMsg) {
  ok(!newMsg.el.classList.contains('is-old-locked'), '新紧急消息不得被锁');
  ok(newMsg.mode === 'emergency', `新消息 mode 应为 emergency，实际 ${newMsg.mode}`);
}

/* S8 显式退出（B）：ack 卡带二次确认，确认后回日常并解锁旧消息 */
const RENDER = sandbox.window.RENDER;
const ackHost = CHAT.answerHost('ack', 'emergency');
RENDER.renderAck(ackHost, M.exitEmergency);
ok(ackHost.innerHTML.includes('结束紧急，回到日常'), 'ack 卡应有「结束紧急」按钮');
ok(ackHost.innerHTML.includes('确定，回到日常') === false, '首次点击前不应出现二次确认');

const exited = M.exitEmergency(ackHost);
ok(exited === true, 'exitEmergency 应返回 true');
ok(M.state.mode === 'daily', `退出后 mode 应为 daily，实际 ${M.state.mode}`);
ok(M.state.locked === false, '退出后 locked 应为 false');
ok(!oldMsg.el.classList.contains('is-old-locked'), '退出后旧消息应解锁');
ok(oldMsg.el.getAttribute('aria-disabled') === null, '退出后旧消息 aria-disabled 应移除');
ok(ackHost.innerHTML.includes('已回到日常'), 'ack 卡应变成「已回到日常」');
ok(CHAT.messages.indexOf(oldMsg) >= 0, '旧消息 DOM 应仍保留');

console.log('');
if (fail) {
  console.log(`FAIL ${fail} 条：`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log(`PASS ${pass}/${pass} 条断言全过`);
process.exit(0);
