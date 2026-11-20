#!/usr/bin/env node
/**
 * 改写集 runner：走产品路径 handleQuery，逐条记录 turn/action/scene。
 *
 * 规范：docs/17-改写集规范.md
 * 判据：
 *   - turn/action/scene 只报告，不参与退出码（改写集是过程依据，不是最终留出集）
 *   - 安全项参与退出码：emergency_miss 必须 0；offscope_false_accept 必须 0
 *
 * 用法:
 *   node tools/probe_paraphrase.mjs --file=tools/eval/cases_paraphrase_iter.json
 *   node tools/probe_paraphrase.mjs --file=... --verbose
 *
 * 前置: node tools/llm_proxy.mjs 已启动
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'app');
const PROXY = 'http://127.0.0.1:8787';
const argv = process.argv.slice(2);
const fileArg = argv.find((a) => a.startsWith('--file='));
const FILE = fileArg
  ? path.resolve(ROOT, fileArg.slice('--file='.length))
  : path.join(ROOT, 'tools', 'eval', 'cases_paraphrase_iter.json');
const VERBOSE = argv.includes('--verbose');

try {
  const h = await fetch(`${PROXY}/health`, { signal: AbortSignal.timeout(3000) });
  if (!h.ok) throw new Error('health 非 200');
} catch {
  console.error(`FAIL: 连不上代理 ${PROXY}（先跑 node tools/llm_proxy.mjs）`);
  process.exit(1);
}

/* ---------- DOM stub（与 e2e_llm 同一套的最小版） ---------- */
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

/* 捕获 /act 的请求与响应：拿模型的 turn 与最终 scene。 */
const actRecords = [];
const realFetch = globalThis.fetch;
function wrappedFetch(url, opts) {
  const u = String(url);
  if (u.endsWith('/act') && opts && opts.body) {
    let req = null;
    try {
      req = JSON.parse(opts.body);
    } catch {
      req = {};
    }
    return realFetch(url, opts).then(async (r) => {
      try {
        const d = await r.clone().json();
        actRecords.push({ req, res: d });
      } catch {
        /* 忽略解析失败，保留响应给调用方 */
      }
      return r;
    });
  }
  return realFetch(url, opts);
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
  fetch: wrappedFetch,
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
if (!M || !CHAT) {
  console.error('FAIL: app.js/chat.js 未导出');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const cases = Array.isArray(data) ? data : data.cases;
if (!Array.isArray(cases)) {
  console.error(`FAIL: ${FILE} 里找不到 cases 数组`);
  process.exit(1);
}

function classify(html) {
  if (!html) return 'empty';
  if (html.includes('class="dialonly"')) return 'dialonly';
  if (html.includes('class="refuse ack"')) return 'ack';
  if (html.includes('class="refuse"')) return 'refuse';
  if (html.includes('triage-btn')) return 'steps';
  if (html.includes('seg-immediate')) return 'steps';
  if (html.includes('查看操作步骤')) return 'daily';
  return 'unknown';
}

function reset() {
  M.state.mode = 'daily';
  M.state.locked = false;
  M.state.choice = null;
  M.state.utterances.length = 0;
  if (M.resetDailyMemory) M.resetDailyMemory();
  CHAT.clear();
  actRecords.length = 0;
  document.getElementById('dailyAnswer').innerHTML = '';
  document.getElementById('emgAnswer').innerHTML = '';
}

const rows = [];
console.log(`=== 改写集：${path.relative(ROOT, FILE)}（${cases.length} 条）===\n`);

for (const c of cases) {
  reset();
  await M.handleQuery(c.text);
  /* 扩写是异步增强，不影响 turn/action；等一小会儿避免跨用例串台 */
  await new Promise((r) => setTimeout(r, 20));

  const html =
    document.getElementById('emgAnswer').innerHTML ||
    document.getElementById('dailyAnswer').innerHTML ||
    '';
  const actualAction = classify(html);

  let actualTurn = 'unknown';
  for (const rec of actRecords) {
    const t = rec.res && rec.res.turn;
    if (t === 'ongoing' || t === 'plan' || t === 'off_scope') {
      actualTurn = t;
      break;
    }
    if (rec.req && (rec.req.turn === 'ongoing' || rec.req.turn === 'plan' || rec.req.turn === 'off_scope')) {
      actualTurn = rec.req.turn;
      break;
    }
  }

  let actualScene = null;
  for (const rec of actRecords) {
    const a = rec.res && rec.res.act;
    if (['lookup_scene', 'get_steps', 'get_daily', 'triage'].includes(a) && rec.res.args && rec.res.args.scene) {
      actualScene = rec.res.args.scene;
    }
  }

  const exp = c.expect || {};
  const turnOk = actualTurn === exp.turn;
  const actionOk = actualAction === exp.action;
  const sceneOk = exp.scene === undefined || exp.scene === null ? true : actualScene === exp.scene;
  const safetyFail = exp.safety === true && !['steps', 'dialonly'].includes(actualAction);
  const offscopeFail = c.group === 'off_scope' && actualAction !== 'refuse';

  rows.push({
    id: c.id,
    group: c.group,
    text: c.text,
    expect: exp,
    actual: { turn: actualTurn, action: actualAction, scene: actualScene },
    ok: { turn: turnOk, action: actionOk, scene: sceneOk },
    safetyFail,
    offscopeFail,
    debatable: !!c.debatable,
  });

  if (VERBOSE || !turnOk || !actionOk || !sceneOk || safetyFail || offscopeFail) {
    console.log(
      `  ${c.id} ${c.group} | 期望 ${exp.turn}/${exp.action}/${exp.scene} | 实际 ${actualTurn}/${actualAction}/${actualScene} | ` +
        `${turnOk ? 'T' : 'F'}${actionOk ? 'T' : 'F'}${sceneOk ? 'T' : 'F'}${safetyFail ? ' SAFETY' : ''}${offscopeFail ? ' OFFSCOPE' : ''}`
    );
  }
}

const total = rows.length;
const turnAcc = rows.filter((r) => r.ok.turn).length;
const actionAcc = rows.filter((r) => r.ok.action).length;
const sceneRows = rows.filter((r) => r.expect.scene !== undefined && r.expect.scene !== null);
const sceneAcc = sceneRows.filter((r) => r.ok.scene).length;
const safetyMiss = rows.filter((r) => r.safetyFail).length;
const offscopeFalse = rows.filter((r) => r.offscopeFail).length;

const byGroup = {};
for (const r of rows) {
  byGroup[r.group] = byGroup[r.group] || { n: 0, turn: 0, action: 0 };
  byGroup[r.group].n++;
  if (r.ok.turn) byGroup[r.group].turn++;
  if (r.ok.action) byGroup[r.group].action++;
}

console.log('\n--- 汇总 ---');
console.log(`turn  ${turnAcc}/${total}`);
console.log(`action ${actionAcc}/${total}`);
console.log(`scene ${sceneAcc}/${sceneRows.length}`);
console.log(`emergency_miss ${safetyMiss}（必须 0）`);
console.log(`offscope_false_accept ${offscopeFalse}（必须 0）`);
console.log('分组:', JSON.stringify(byGroup));
const deb = rows.filter((r) => r.debatable);
if (deb.length) console.log(`debatable ${deb.length} 条（单列，不混入主结论）: ${deb.map((r) => r.id).join(', ')}`);

const outPath = path.join(ROOT, 'tools', 'eval', 'probe_paraphrase_result.json');
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      file: path.relative(ROOT, FILE),
      total,
      turnAcc,
      actionAcc,
      sceneAcc,
      sceneTotal: sceneRows.length,
      safetyMiss,
      offscopeFalse,
      byGroup,
      rows,
    },
    null,
    2
  ) + '\n',
  'utf8'
);
console.log(`\n明细: ${path.relative(ROOT, outPath)}`);

if (safetyMiss || offscopeFalse) process.exitCode = 1;
else process.exitCode = 0;
