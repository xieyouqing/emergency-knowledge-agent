#!/usr/bin/env node
/**
 * S8 退出（2026-11-21 用户裁决）：
 *   用户口头明确说“没事了/已经安全/脱困了” → ack 后自动退出，不用点；
 *   “应该没事了吧 / 好像安全了” 是猜测 → 不退出；
 *   不明确时 ack 卡只留一个按钮（单次点击兜底，不再二次确认）。
 *
 * 前置: 无（fetch 桩）
 * 用法: node tools/e2e_resolved_exit.mjs
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
window.ACT_SEED = false;

function stubFetch(url, opts) {
  const u = String(url);
  if (u.endsWith('/act')) {
    const body = JSON.parse((opts && opts.body) || '{}');
    const text = String(body.text || '');
    const hist = Array.isArray(body.history) ? body.history.length : 0;
    const resolved = /没事|安全|脱困|门开了|火灭了|缓过来/.test(text);
    const act = resolved ? 'ack' : hist === 0 ? 'lookup_scene' : 'get_steps';
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          act,
          turn: resolved ? 'ongoing' : 'ongoing',
          evidence: text,
          args: resolved ? {} : { scene: 'earthquake' },
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
  navigator: { onLine: true },
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
const R = sandbox.window.RETRIEVAL;
if (!M || !CHAT || !R) {
  console.error('FAIL: app/chat/retrieval 未导出');
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

console.log('=== S8 口头确认退出（fetch 桩）===\n');

ok(R.isResolved('没事了') === true, '「没事了」应判为已解除');
ok(R.isResolved('应该没事了吧') === false, '「应该没事了吧」是猜测，不得判解除');

/* 第一轮：进入紧急 */
await M.handleQuery('地震了');
ok(M.state.mode === 'emergency', `第一轮后应进入紧急，实际 ${M.state.mode}`);
ok(M.state.locked === true, '第一轮后应锁定');

/* 第二轮：明确说没事了 → 自动退出 */
await M.handleQuery('没事了');
await new Promise((r) => setTimeout(r, 20));
ok(M.state.mode === 'daily', `「没事了」后应自动回日常，实际 ${M.state.mode}`);
ok(M.state.locked === false, '「没事了」后应解锁');
const last = CHAT.messages.filter((m) => m.role === 'assistant').slice(-1)[0];
ok(last && last.host.innerHTML.includes('已回到日常'), 'ack 卡应显示已回到日常');

/* 再进紧急，测模糊话不退出 */
await M.handleQuery('地震了');
await M.handleQuery('应该没事了吧');
await new Promise((r) => setTimeout(r, 20));
ok(M.state.mode === 'emergency', `「应该没事了吧」不得退出，实际 ${M.state.mode}`);
ok(M.state.locked === true, '模糊话后应保持锁定');
const ackHost = CHAT.messages.filter((m) => m.role === 'assistant').slice(-1)[0].host;
ok(ackHost.innerHTML.includes('结束紧急，回到日常'), '不明确时 ack 卡应保留单按钮兜底');
ok(!ackHost.innerHTML.includes('确定，回到日常'), '不得再出现二次确认');

console.log('');
if (fail) {
  console.log(`FAIL ${fail} 条：`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log(`PASS ${pass}/${pass} 条断言全过`);
process.exit(0);
