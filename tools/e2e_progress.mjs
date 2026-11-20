#!/usr/bin/env node
/**
 * M2.5「每步可见进展」的产品路径验证。
 *
 * 判据（01 §4.25 第 2 条 + §8 红线 1）：
 *   ① 循环一开始就有可见反馈（不是无反馈等待）
 *   ② 每执行完一步，文案随动作更新（lookup → 正在查资料）
 *   ③ 终态卡出现后进度立即隐藏，不残留在输入区
 *
 * 做法：fetch 桩固定返回 lookup_scene → get_steps，在每次 /act 请求
 * 到达时读取进度元素。这样测的是 app.js 的实际接线，不是另写一套模拟。
 *
 * 前置: 无（不联网）
 * 用法: node tools/e2e_progress.mjs
 * 退出码 0 = 全过；1 = 有不符项
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'app');

/* ---------- DOM stub（与 e2e_multiturn_ctx 同一套） ---------- */
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
/* 本测试要覆盖完整的 lookup → get_steps 两步，关掉首轮预置（否则会被 seed 压成一步） */
window.ACT_SEED = false;

/* ---------- fetch 桩：记录每次 /act 到达时的进度状态 ---------- */
const calls = [];
function stubFetch(url, opts) {
  const u = String(url);
  if (u.endsWith('/act')) {
    let body = {};
    try {
      body = JSON.parse((opts && opts.body) || '{}');
    } catch {
      body = {};
    }
    const p = document.getElementById('progress');
    calls.push({
      text: body.text,
      historyLen: Array.isArray(body.history) ? body.history.length : 0,
      progressVisible: !!p && !p.hidden,
      progressText: p ? p.textContent : null,
    });
    const first = calls.length === 1;
    const act = first ? 'lookup_scene' : 'get_steps';
    const args = first ? { scene: 'gas_leak' } : { scene: 'gas_leak' };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ act, args, reason: 'stub', note: '', latency_ms: 1, cached: false }),
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

console.log('=== 每步可见进展（产品路径，fetch 桩）===\n');

/* 纯文案映射先测：每条都能失败 */
ok(M.progressTextFor('lookup_scene') === '正在查资料…', 'lookup_scene 的进度文案');
ok(M.progressTextFor('get_steps') === '正在准备回答…', 'get_steps 的进度文案');
ok(M.progressTextFor('dial') === '正在准备拨号…', 'dial 的进度文案');
ok(M.progressTextFor('ack') === '正在确认…', 'ack 的进度文案');
ok(M.progressTextFor('unknown') === '正在处理…', '未知动作的兜底文案');

await M.handleQuery('煤气漏了怎么办');

console.log(`捕获 /act 请求 ${calls.length} 次`);
calls.forEach((c, i) => {
  console.log(
    `  #${i + 1} history=${c.historyLen} progress=${c.progressVisible ? c.progressText : '隐藏'}`
  );
});

ok(calls.length === 2, `应发生 2 次 /act（lookup + get_steps），实际 ${calls.length}`);
if (calls[0]) {
  ok(calls[0].progressVisible === true, '第一次 /act 到达时进度必须可见（不许无反馈等待）');
  ok(calls[0].progressText === '正在处理…', `第一次进度文案应为「正在处理…」，实际「${calls[0].progressText}」`);
}
if (calls[1]) {
  ok(calls[1].progressVisible === true, '第二次 /act 到达时进度必须仍然可见');
  ok(
    calls[1].progressText === '正在查资料…',
    `lookup 完成后进度应更新为「正在查资料…」，实际「${calls[1].progressText}」`
  );
}

const p = document.getElementById('progress');
ok(p.hidden === true, '终态卡出现后进度必须隐藏，不得残留');
ok(M.progress.visible() === false, 'M.progress.visible() 应为 false');

console.log('');
if (fail) {
  console.log(`FAIL ${fail} 条：`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log(`PASS ${pass}/${pass} 条断言全过`);
process.exit(0);
