#!/usr/bin/env node
/**
 * 同一场景追问去重（2026-11-21）：
 *   第一次 fire_home → get_daily：出完整日常卡（可扩写）；
 *   第二次仍 fire_home 但问题不同：不再贴整卡，出「还是这个条目」通知。
 *
 * 判据：
 *   ① 第一张卡仍有 class="explain"（完整日常卡）
 *   ② 第二张卡是 followup 通知，含「还是「家庭火灾」这个条目」「库内没有更具体」
 *   ③ /expand 只调用 1 次（第二次去重，不再扩写）
 *
 * 前置: 无（fetch 桩）
 * 用法: node tools/e2e_followup_dedupe.mjs
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

const calls = [];
function stubFetch(url, opts) {
  const u = String(url);
  if (u.endsWith('/act')) {
    const body = JSON.parse((opts && opts.body) || '{}');
    calls.push({ kind: 'act', body });
    const hist = Array.isArray(body.history) ? body.history.length : 0;
    const act = hist === 0 ? 'lookup_scene' : 'get_daily';
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          act,
          args: { scene: 'fire_home' },
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
          text: '火灾里最致命的是浓烟；贴近地面能少吸一些。',
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

console.log('=== 同一场景追问去重（fetch 桩）===\n');

await M.handleQuery('如果发生火灾怎么办');
await new Promise((r) => setTimeout(r, 20));
const assistants1 = CHAT.messages.filter((m) => m.role === 'assistant');
const first = assistants1[0];
const firstHtml = first ? first.host.innerHTML : '';

await M.handleQuery('没有湿毛巾怎么办');
await new Promise((r) => setTimeout(r, 20));
const assistants = CHAT.messages.filter((m) => m.role === 'assistant');
const second = assistants[assistants.length - 1];
const secondHtml = second ? second.host.innerHTML : '';

console.log(`助手消息 ${assistants.length} 条；/expand ${calls.filter((c) => c.kind === 'expand').length} 次`);

ok(firstHtml.includes('class="explain"'), '第一张应是完整日常卡');
ok(firstHtml.includes('这段解释由模型按条目整理'), '第一张应已扩写');
ok(secondHtml.includes('还是「家庭火灾」这个条目'), '第二张应是「还是这个条目」通知');
ok(secondHtml.includes('库内没有更具体'), '第二张应明确说库内没有更具体答案');
ok(secondHtml.includes('回到上一条'), '通知应有回到上一条按钮');
ok(!secondHtml.includes('class="explain"'), '第二张不得重复完整日常卡');
ok(calls.filter((c) => c.kind === 'expand').length === 1, '去重后不应再次调用 /expand');

console.log('');
if (fail) {
  console.log(`FAIL ${fail} 条：`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log(`PASS ${pass}/${pass} 条断言全过`);
process.exit(0);
