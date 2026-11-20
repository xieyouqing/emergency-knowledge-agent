#!/usr/bin/env node
/**
 * 产品路径多轮上下文验证：handleQuery → runActLoop → LLM.act → /act 请求体
 *
 * 两种模式：
 *   默认（桩）  不联网。验请求契约：
 *     ① 第一次请求没有 context 字段（无记忆基线逐字不变）
 *     ② 第二次带上第一句，且不含当前句
 *     ③ 第三次按时间顺序带上前两句
 *     ④ 清空会话后（模拟刷新）请求又回到无 context
 *   --live     真代理 + 真模型，跑 cases_multi_turn.json 12 条。
 *     它回答的是「产品路径实际表现」，不是「代理侧单独表现」。
 *     2026-11-20 用户裁决 A 后：已锁定的紧急后续轮也走 /act，
 *     所以 12 条的第二轮都应消费 context（首轮紧急本来就已是 /act）。
 *     退出码只看「该带上文时带没带」（接线正确性）；动作是否符合 expected
 *     只报告，不参与退出码，因为部分期望与现行规则（如规则 7）冲突。
 *
 * 为什么必须有这个脚本：
 *   tools/probe_multi_turn.mjs 是**直接打代理**的，不经过 app/app.js。
 *   它能证明代理侧的 context 逻辑对不对，但证明不了「前端把上文接上了」。
 *
 * 前置: --live 需 node tools/llm_proxy.mjs 已启动
 * 用法: node tools/e2e_multiturn_ctx.mjs
 *       node tools/e2e_multiturn_ctx.mjs --live
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'app');
const LIVE = process.argv.includes('--live');

/* ---------- DOM stub（与 e2e_llm.mjs 同一套，够跑 handleQuery 的渲染路径） ---------- */
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
/* B 方案开关：默认开（与产品一致）；--no-seed 时关掉，跑基线对照。 */
window.ACT_SEED = !process.argv.includes('--no-seed');

/* ---------- fetch：桩模式只记录 /act；live 模式转发真代理并顺手记录 ---------- */
const actBodies = [];

function stubFetch(url, opts) {
  const u = String(url);
  if (u.endsWith('/act')) {
    let body = null;
    try {
      body = JSON.parse((opts && opts.body) || '{}');
    } catch (e) {
      body = { __parse_error: String(e && e.message) };
    }
    actBodies.push(body);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          act: 'refuse',
          args: { reason: 'test-stub' },
          reason: '测试桩固定拒答，一步结束',
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

function liveFetch(url, opts) {
  const u = String(url);
  if (u.endsWith('/act')) {
    try {
      actBodies.push(JSON.parse((opts && opts.body) || '{}'));
    } catch {
      actBodies.push({ __parse_error: true });
    }
  }
  return globalThis.fetch(url, opts);
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
  fetch: LIVE ? liveFetch : stubFetch,
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
if (!M.LLMAvailable) {
  console.error('FAIL: app.js 未加载到 LLM');
  process.exit(1);
}

/* --live 把客户端超时放宽到 8s：本脚本测的是「多轮动作对不对」，
   不是「3 秒预算」（后者由 measure_latency 单独测）。产品默认仍是 2.5s。
   不放宽会被真实模型偶发的 2.5s+ 抖动误判成拒答（MT08 已踩过）。 */
if (LIVE && sandbox.window.LLM && sandbox.window.LLM.configure) {
  sandbox.window.LLM.configure({ timeout: 8000 });
}

/* ---------- 公共断言 ---------- */
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
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(a === e, `${msg}（期望 ${e}，实际 ${a}）`);
}

function contextOf(body) {
  return body && body.context ? body.context.utterances : null;
}

function resetSession() {
  M.state.mode = 'daily';
  M.state.locked = false;
  M.state.utterances.length = 0;
  document.getElementById('dailyAnswer').innerHTML = '';
  document.getElementById('emgAnswer').innerHTML = '';
}

/* 按真实 HTML 结构的 class 判落点（与 e2e_llm.mjs 同一口径） */
function classifyRender() {
  const html =
    document.getElementById('emgAnswer').innerHTML ||
    document.getElementById('dailyAnswer').innerHTML ||
    '';
  if (html.includes('class="dialonly"')) return 'dialonly';
  if (html.includes('class="refuse ack"')) return 'ack';
  if (html.includes('class="refuse"')) return 'refuse';
  if (html.includes('triage-btn')) return 'steps';
  if (html.includes('seg-immediate')) return 'steps';
  if (html.includes('查看操作步骤')) return 'daily';
  return hidEmpty(html);
}
function hidEmpty(html) {
  return html ? 'unknown' : 'empty';
}

function reportExit() {
  console.log('');
  if (fail) {
    console.log(`FAIL ${fail} 条：`);
    for (const f of fails) console.log('  - ' + f);
    process.exit(1);
  }
  console.log(`PASS ${pass}/${pass} 条断言全过`);
  process.exit(0);
}

/* ---------- 桩模式：请求契约 ---------- */
async function runStub() {
  /* 判据自检：无 context 的请求必须判为「不带上文」。
     若这里返回 true，说明判据本身写反了，后面的正向断言全是假绿。 */
  ok(
    contextOf({ text: 'x', history: [], trace: null }) === null,
    '判据自检：无 context 字段的请求必须被判为 null（否则本测试永远绿）'
  );

  console.log('=== 产品路径多轮上下文（fetch 桩，不联网）===\n');
  resetSession();

  const T1 = '厨房有股味道';
  const T2 = '现在我妈说头晕恶心';
  const T3 = '要不要开窗';

  await M.handleQuery(T1);
  await M.handleQuery(T2);
  await M.handleQuery(T3);

  console.log(`捕获 /act 请求 ${actBodies.length} 次`);
  actBodies.forEach((b, i) => {
    const c = contextOf(b);
    console.log(`  #${i + 1} text=${JSON.stringify(b.text)} context=${c ? JSON.stringify(c) : '无'}`);
  });

  ok(actBodies.length === 3, `三次提问应各发一次 /act（实际 ${actBodies.length} 次）`);

  if (actBodies[0]) {
    eq(Object.keys(actBodies[0]).sort(), ['history', 'text', 'trace'], '第一句请求体字段');
    ok(!('context' in actBodies[0]), '第一句不得带 context（A 模式基线不能变）');
    eq(actBodies[0].text, T1, '第一句 text 原样');
  }
  if (actBodies[1]) {
    eq(contextOf(actBodies[1]), [T1], '第二句应带上第一句');
    eq(actBodies[1].text, T2, '第二句 text 原样');
    ok(
      contextOf(actBodies[1]).indexOf(T2) === -1,
      '第二句的 context 不得包含当前句（当前句与上文是两件事）'
    );
  }
  if (actBodies[2]) {
    eq(contextOf(actBodies[2]), [T1, T2], '第三句应按时间顺序带前两句');
  }

  resetSession();
  await M.handleQuery('我老伴摔了');
  const after = actBodies[actBodies.length - 1];
  if (after) {
    ok(
      !('context' in after),
      '清空会话后请求不得带 context（刷新即清，不把上一个人带给下一个人）'
    );
  }
}

/* ---------- live 模式：产品路径跑 12 条多轮 ---------- */
function pad(s, n) {
  let w = 0;
  for (const ch of String(s)) w += /[一-鿿＀-￯]/.test(ch) ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(0, n - w));
}

async function runLive() {
  /* 前置：代理必须在 */
  try {
    const h = await globalThis.fetch('http://127.0.0.1:8787/health', {
      signal: AbortSignal.timeout(3000),
    });
    if (!h.ok) throw new Error('health 非 200');
  } catch (e) {
    console.error('FAIL: --live 需要代理 http://127.0.0.1:8787');
    console.error('  先跑: node tools/llm_proxy.mjs');
    process.exit(1);
  }

  const cases = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tools', 'eval', 'cases_multi_turn.json'), 'utf8')
  ).cases;

  console.log('=== 产品路径多轮（真代理 + 真模型）===\n');
  console.log(
    pad('ID', 7) +
      pad('轮2前模式', 12) +
      pad('期望', 10) +
      pad('实际', 10) +
      pad('动作', 6) +
      '上文'
  );
  console.log('-'.repeat(72));

  let actionOk = 0;
  let ctxRounds = 0;
  let lockedCases = 0;

  for (const c of cases) {
    resetSession();
    const turns = [];

    for (let i = 0; i < c.turns.length; i++) {
      const modeBefore = M.state.mode;
      actBodies.length = 0;
      let error = null;
      try {
        await M.handleQuery(c.turns[i]);
      } catch (e) {
        error = String((e && e.message) || e);
      }
      const bodies = actBodies.slice();
      turns.push({
        i,
        text: c.turns[i],
        modeBefore,
        bodies,
        error,
        got: classifyRender(),
      });
    }

    const last = turns[turns.length - 1];
    const okAction = last.got === c.expect.final_action;
    if (okAction) actionOk++;
    if (turns[1] && turns[1].modeBefore === 'emergency') lockedCases++;

    /* 接线断言：第一轮之后、仍走 /act 的轮次，必须带且只带「之前所有原话」。
       走 judge 的轮次没有 /act 请求 —— 跳过，不把 S8 的行为算成接线的错。 */
    let ctxStatus = '-';
    for (const t of turns.slice(1)) {
      if (!t.bodies.length) continue;
      ctxRounds++;
      const lens = t.bodies.map((b) => (contextOf(b) || []).length);
      const good = lens.every((n) => n === t.i);
      ok(
        good,
        `${c.id} 第${t.i + 1}句走 /act 时应带 ${t.i} 条上文（实际 ${JSON.stringify(lens)}）`
      );
      ctxStatus = good ? `${t.i}条` : `错:${JSON.stringify(lens)}`;
    }

    console.log(
      pad(c.id, 7) +
        pad(turns[1] ? turns[1].modeBefore : '-', 12) +
        pad(c.expect.final_action, 10) +
        pad(last.got, 10) +
        pad(okAction ? '✓' : '✗', 6) +
        ctxStatus
    );
    if (turns.some((t) => t.error)) {
      const errs = turns.filter((t) => t.error).map((t) => `第${t.i + 1}句: ${t.error}`);
      console.log('   异常: ' + errs.join(' | '));
      ok(false, `${c.id} 执行异常：${errs.join(' | ')}`);
    }
  }

  console.log('\n--- 汇总 ---');
  console.log(`动作符合 expected：${actionOk}/${cases.length}（仅报告，不参与退出码）`);
  console.log(`真正走 /act 且检查了上文的轮次：${ctxRounds}`);
  console.log(`轮2前已处于紧急锁定的用例：${lockedCases}/${cases.length}`);
  console.log('说明：2026-11-20 裁决 A 后，紧急锁定不再把后续轮推给 judge；');
  console.log('      锁定用例的第二轮同样走 /act 并消费 context。');
}

if (LIVE) {
  await runLive();
  reportExit();
} else {
  await runStub();
  reportExit();
}
