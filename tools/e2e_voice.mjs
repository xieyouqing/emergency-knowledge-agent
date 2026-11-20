#!/usr/bin/env node
/**
 * 端到端语音路径验证：真实 LLM 代理 + 真实 handleQuery + 桩发声
 *
 * 与 e2e_llm.mjs 的分工：
 *   e2e_llm.mjs    只验「输入 → 判定 → 路由 → 渲染」，不加载 voice.js。
 *   e2e_voice.mjs  验「渲染之后到底有没有发声、念了什么」。
 *
 * 为什么需要它：浏览器里的自动朗读失败是**静默的**（设计如此），
 * 所以「没听见」无法区分「没触发」和「被拦了」。这个脚本把触发点
 * 与朗读稿打出来，「有没有触发」变成可读的证据，剩下的才可能是浏览器策略。
 *
 * 前置: node tools/llm_proxy.mjs 已启动
 * 用法: node tools/e2e_voice.mjs
 * 退出码 0 = 全部符合预期；1 = 有不符合项
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
  console.error(`FAIL: 连不上 LLM 代理 ${PROXY}（先跑 node tools/llm_proxy.mjs）`);
  process.exit(1);
}

/* ---------- DOM stub ---------- */
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
    /* 2026-11-19 聊天式改造：紧急态靠 body.classList 标记（不再隐藏视图） */
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
    /* 2026-11-19 聊天式改造：消息气泡需要 appendChild 组装 DOM */
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
  /* 2026-11-19 聊天式改造：消息流每条回答 createElement 新容器并动态接管 id。
     stub 必须支持 createElement / setAttribute('id') 注册 / removeAttribute('id') 注销，
     否则 app.js 拿不到容器。这是 stub 能力增强，断言口径未改。 */
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

/* ---------- 发声桩：记录「念了什么」 ---------- */
const spoken = [];
function Utterance(text) {
  this.text = text;
  this.lang = '';
  this.rate = 1;
}
const synth = {
  getVoices: () => [{ name: 'Microsoft Huihui', lang: 'zh-CN' }],
  speak(u) {
    spoken.push({ text: u.text, lang: u.lang, rate: u.rate });
    if (u.onend) u.onend();
  },
  cancel() {},
  addEventListener() {},
};

const window = {
  document,
  scrollTo() {},
  addEventListener() {},
  removeEventListener() {},
  speechSynthesis: synth,
  SpeechSynthesisUtterance: Utterance,
};
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
  speechSynthesis: synth,
  SpeechSynthesisUtterance: Utterance,
  fetch,
  AbortController,
  setTimeout,
  clearTimeout,
  Promise,
  Error,
  Date,
  RegExp,
  localStorage: null,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of [
  'log.js',
  'knowledge.js',
  'retrieval.js',
  'llm.js',
  'voice.js',
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
if (!M.TTSAvailable) {
  console.error('FAIL: app.js 未加载到 voice.js');
  process.exit(1);
}
await sandbox.window.TTS.detect();

/* ---------- 用例 ---------- */
const CASES = [
  { text: '煤气漏了', card: 'steps', speaks: 1, kind: 'triage' },
  { text: '着火了', card: 'steps', speaks: 1, kind: 'steps' },
  { text: '怎么预防煤气泄漏', card: 'daily', speaks: 1, kind: 'brief' },
  { text: '今天天气怎么样', card: 'refuse', speaks: 0, kind: 'none' },
];

let pass = 0,
  fail = 0;
const fails = [];
function ok(c, m) {
  if (c) pass++;
  else {
    fail++;
    fails.push(m);
  }
}

function classify(html) {
  if (!html) return 'empty';
  if (html.includes('class="dialonly"')) return 'dialonly';
  if (html.includes('class="refuse"')) return 'refuse';
  if (html.includes('triage-btn')) return 'steps';
  if (html.includes('seg-immediate')) return 'steps';
  if (html.includes('查看操作步骤')) return 'daily';
  return 'unknown';
}

console.log('=== 端到端语音路径（真实代理 + 真实 handleQuery + 桩发声）===\n');

for (const c of CASES) {
  M.state.mode = 'daily';
  M.state.locked = false;
  M.autoReadState.muted = false;
  document.getElementById('dailyAnswer').innerHTML = '';
  document.getElementById('emgAnswer').innerHTML = '';

  const before = spoken.length;
  await M.handleQuery(c.text);
  const n = spoken.length - before;
  const html =
    document.getElementById('emgAnswer').innerHTML ||
    document.getElementById('dailyAnswer').innerHTML;
  const card = classify(html);
  const said = n ? spoken[spoken.length - 1].text : '';

  console.log(`「${c.text}」`);
  console.log(`  卡型 ${card} ｜ 模式 ${M.state.mode} ｜ 发声 ${n} 次`);
  if (said) console.log(`  念的：${said.slice(0, 60)}${said.length > 60 ? '…' : ''}`);
  console.log('');

  ok(card === c.card, `「${c.text}」卡型应为 ${c.card}，实际 ${card}`);
  ok(n === c.speaks, `「${c.text}」应发声 ${c.speaks} 次，实际 ${n} 次`);

  if (c.kind === 'brief') {
    const real = Object.values(M.entries).find((x) => x.daily && said.includes(x.daily.summary));
    ok(!!real, `「${c.text}」朗读稿里应含该条目的 summary 原文`);
    if (real && real.daily.why) {
      ok(said.includes(real.daily.why), `「${c.text}」自动朗读应念 why 全文（内容全读）`);
    }
    const p0 = real && (real.daily.prevention || [])[0];
    if (p0) ok(said.includes(p0), `「${c.text}」自动朗读应念 prevention 清单（内容全读）`);
  }
  if (c.kind === 'triage') {
    ok(said.includes('第1个'), '分诊卡自动朗读应带「第1个」序号（老人看不到屏幕也能选）');
  }
}

/* ---------- 静默链路 ---------- */
console.log('=== 按停止后的静默（本会话不再自动读） ===');
{
  M.state.mode = 'daily';
  M.state.locked = false;
  M.autoReadState.muted = true;
  const before = spoken.length;
  await M.handleQuery('怎么预防煤气泄漏');
  // handleQuery 会解除静默（新一次提问 = 新的意图表达），所以这条要的是「重新能读」
  console.log(`  新提问后 muted=${M.autoReadState.muted}，发声 ${spoken.length - before} 次`);
  ok(M.autoReadState.muted === false, '新一次提问应解除静默');
  ok(spoken.length === before + 1, '解除静默后日常卡应恢复自动朗读');
}

/* ---------- 日志落盘验证 ----------
   这一步不是形式：前端日志靠 POST /log 写盘，脚本退出前不 flush 就全丢。
   顺带把「各模块是否都留了日志」直接打出来，比人肉翻文件快。 */
{
  const L = sandbox.window.LOG;
  if (L) {
    const n = await L.flush();
    const byMod = {};
    for (const r of L.buffer) byMod[r.module] = (byMod[r.module] || 0) + 1;
    console.log('\n=== 日志落盘 ===');
    console.log(`  本次发送 ${n} 条 ｜ 各模块：${JSON.stringify(byMod)}`);
    console.log(`  stats: ${JSON.stringify(L.stats())}`);
    ok(L.buffer.length > 0, '整轮跑完应有日志记录');
    ok(
      Object.keys(byMod).length >= 3,
      `应至少涉及 3 个模块，实际 ${Object.keys(byMod).join(',') || '无'}`
    );
  }
}

console.log('\n' + '='.repeat(70));
if (fail) {
  console.log(`断言 ${pass + fail} 条：通过 ${pass}，失败 ${fail}`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
} else {
  console.log(`断言 ${pass} 条：全部通过`);
  console.log('PASS: 打字提问 → 出卡 → 发声，这条链在真实主路径上通了');
}
