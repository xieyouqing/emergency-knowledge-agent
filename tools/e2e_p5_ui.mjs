#!/usr/bin/env node
/**
 * P5 前端接线验证：日常卡先出静态内容，/expand 成功后只替换解释段。
 *
 * 判据：
 *   ① /act 走 lookup → get_daily
 *   ② /expand 被调用一次
 *   ③ 最终卡里有扩写文本、静态「平时怎么做」列表、「查看操作步骤」
 *   ④ 扩写失败时保持静态卡（本脚本用桩固定成功；失败路径由 /expand 契约保证）
 *
 * 前置: 无（fetch 桩）
 * 用法: node tools/e2e_p5_ui.mjs
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
window.ACT_SEED = false; // 走完整 lookup → get_daily，顺便验证两步

const calls = [];
function stubFetch(url, opts) {
  const u = String(url);
  if (u.endsWith('/act')) {
    const body = JSON.parse((opts && opts.body) || '{}');
    calls.push({ kind: 'act', body });
    const first = calls.filter((c) => c.kind === 'act').length === 1;
    const act = first ? 'lookup_scene' : 'get_daily';
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          act,
          args: { scene: 'gas_leak' },
          reason: 'stub',
          note: '',
          latency_ms: 1,
          cached: false,
        }),
      text: () => Promise.resolve(''),
    });
  }
  if (u.endsWith('/expand')) {
    calls.push({ kind: 'expand', body: JSON.parse((opts && opts.body) || '{}') });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          ok: true,
          text: '模型扩写解释：燃气本身没味道，臭味是特意加的，浓度高了遇火花就危险。',
          actions: [],
          needAction: false,
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
if (!M) {
  console.error('FAIL: app.js 未导出 __M1__');
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

console.log('=== P5 前端接线（fetch 桩）===\n');
await M.handleQuery('怎么预防燃气泄漏');

/* 扩写是在静态卡渲染后异步替换；等一轮微任务/定时器 */
await new Promise((r) => setTimeout(r, 20));

const html = document.getElementById('dailyAnswer').innerHTML;
const actCalls = calls.filter((c) => c.kind === 'act').length;
const expandCalls = calls.filter((c) => c.kind === 'expand').length;
console.log(`/act ${actCalls} 次；/expand ${expandCalls} 次；卡片长度 ${html.length}`);

ok(actCalls === 2, `/act 应 2 次（lookup + get_daily），实际 ${actCalls}`);
ok(expandCalls === 1, `/expand 应 1 次，实际 ${expandCalls}`);
ok(html.includes('模型扩写解释'), '最终卡应包含扩写文本');
ok(html.includes('平时怎么做'), '静态 prevention 列表必须保留');
ok(html.includes('查看操作步骤'), '「查看操作步骤」按钮必须保留');
ok(html.includes('这段解释由模型按条目整理'), '应标明解释来源');
ok(html.includes('每年检查一次燃气软管'), '静态 prevention 条目必须可追溯');

console.log('');
if (fail) {
  console.log(`FAIL ${fail} 条：`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log(`PASS ${pass}/${pass} 条断言全过`);
process.exit(0);
