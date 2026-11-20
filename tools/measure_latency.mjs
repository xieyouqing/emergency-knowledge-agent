#!/usr/bin/env node
/**
 * F2 实测：首句播报时延（`01` §4.1 判据 4 的硬指标 ≤ 3 秒）
 *
 * 为什么需要单独的脚本：
 *   e2e_asr.mjs 只报「ASR 上游时延」和「端到端墙钟」，但判据 4 的口径是
 *   **从松手到听见第一个字**。这中间还有四段我们的代码：
 *     ① 重采样 + WAV 编码（前端 asr.js）
 *     ② 上传（本地回环，可忽略但计入）
 *     ③ LLM 判定（≤2500ms 超时，正常 900–1300ms）
 *     ④ 拼接朗读稿 + 调 speak()
 *   只报 ASR 段的数字会让人误以为「1 秒就出声了」，实际可能超 3 秒。
 *
 * 计时点（严格按判据）：
 *   t0 = 调用 ASR.stop() 的那一刻（等价于老人松手）
 *   t1 = speak() 被调用的那一刻（等价于开始播第一个字）
 *   t1 - t0 即首句播报时延
 *
 * 前置: node tools/llm_proxy.mjs 已启动
 * 用法: node tools/measure_latency.mjs [次数]
 *
 * ⚠️ 每次都会真实调用云 ASR（不缓存），默认 5 次。改次数自己传参。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'app');
const PROXY = 'http://127.0.0.1:8787';
const AUDIO = path.join(ROOT, 'tools', 'probe', 'audio');
const N = Math.max(1, Math.min(20, Number(process.argv[2] || 5)));
const BUDGET_MS = 3000;

try {
  const h = await fetch(`${PROXY}/health`, { signal: AbortSignal.timeout(3000) });
  if (!h.ok) throw new Error('health 非 200');
} catch {
  console.error(`FAIL: 连不上代理 ${PROXY}（先跑 node tools/llm_proxy.mjs）`);
  process.exit(1);
}

/* ---------- DOM / 发声桩：speak 被调用的时刻就是 t1 ---------- */
const store = new Map();
function makeEl(id) {
  const cls = new Set();
  return {
    id, innerHTML: '', hidden: false, disabled: false, value: '', textContent: '', className: '',
    handlers: {}, children: [], parentNode: null,
    classList: {
      add: (c) => cls.add(c), remove: (c) => cls.delete(c),
      contains: (c) => cls.has(c),
      toggle: (c, on) => {
        if (on === undefined) { if (cls.has(c)) cls.delete(c); else cls.add(c); }
        else if (on) cls.add(c);
        else cls.delete(c);
      }
    },
    _classes: cls,
    addEventListener(t, f) { (this.handlers[t] ||= []).push(f); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    scrollIntoView() {},
    getAttribute() { return null; },
    setAttribute() {},
    closest() { return null; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    insertBefore(c) { this.children.unshift(c); c.parentNode = this; return c; }
  };
}
const document = {
  getElementById(id) { if (!store.has(id)) store.set(id, makeEl(id)); return store.get(id); },
  /* 2026-11-19 聊天式改造：消息流每条回答 createElement 新容器并动态接管 id。
     stub 必须支持 createElement / setAttribute('id') 注册 / removeAttribute('id') 注销，
     否则 app.js 拿不到容器。这是 stub 能力增强，断言口径未改。 */
  createElement(tag) {
    const n = makeEl('#' + tag);
    n.setAttribute = function (k, v) {
      this._attrs = this._attrs || {};
      this._attrs[k] = v;
      if (k === 'id') { store.set(String(v), this); this.id = String(v); }
    };
    n.removeAttribute = function (k) {
      if (k === 'id') { for (const [key, val] of store.entries()) if (val === this) store.delete(key); this.id = ''; }
    };
    n.tagName = String(tag).toUpperCase();
    return n;
  },
  body: makeEl('body'),
  querySelectorAll() { return []; },
  addEventListener() {}
};

/* 发声桩：记录调用时刻，不模拟播放时长（判据要求的是「开始播」不是「播完」） */
const speakCalls = [];
function Utterance(text) { this.text = text; }
const synth = {
  getVoices: () => [{ name: 'Microsoft Huihui', lang: 'zh-CN' }],
  speak(u) { speakCalls.push({ at: Date.now(), text: u.text }); if (u.onend) u.onend(); },
  cancel() {}, addEventListener() {}
};

function fakeCtx() {
  return {
    sampleRate: 24000,
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createScriptProcessor: () => ({ onaudioprocess: null, connect() {}, disconnect() {} }),
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    destination: {}, close() {}
  };
}
const window = {
  document, scrollTo() {}, addEventListener() {}, removeEventListener() {},
  speechSynthesis: synth, SpeechSynthesisUtterance: Utterance,
  navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
  location: { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost' },
  isSecureContext: true, AudioContext: fakeCtx, AbortController,
  fetch: (...a) => fetch(...a), setTimeout, clearTimeout, Date, Blob, FormData
};
const sandbox = {
  window, document, console, Math, String, Number, Object, Array, JSON,
  speechSynthesis: synth, SpeechSynthesisUtterance: Utterance,
  navigator: window.navigator, location: window.location, isSecureContext: true,
  AudioContext: fakeCtx, AbortController, fetch: window.fetch,
  setTimeout, clearTimeout, Promise, Error, Date, RegExp, localStorage: null, Blob, FormData
};
sandbox.globalThis = sandbox;
/* B 方案开关：默认开（与产品一致）；ACT_SEED=0 时关掉，跑基线对照。 */
window.ACT_SEED = process.env.ACT_SEED !== '0';
vm.createContext(sandbox);

for (const f of ['log.js', 'knowledge.js', 'retrieval.js', 'llm.js', 'voice.js', 'asr.js', 'state.js', 'chat.js', 'tools.js', 'render.js', 'speak.js', 'talk.js', 'agent.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox);
}
/* 测量必须避开缓存：缓存命中的判定时延恒为 0，测出来的「合计 900ms」
   是假的好看数字（实测过：3 次全是 3ms 判定，因为同一句被缓存了）。
   这里劫持 fetch，给所有发往 /judge **和 /act** 的请求体加 nocache:true。
   ⚠️ 2026-11-20 补 /act：主路径已切到 /act，只给 /judge 加会把测量测成缓存命中的假数字。 */
const realFetch = fetch;
window.fetch = (url, opts) => {
  if (typeof url === 'string' && (url.includes('/judge') || url.includes('/act')) && opts && opts.body) {
    try {
      const body = JSON.parse(opts.body);
      body.nocache = true;
      opts = { ...opts, body: JSON.stringify(body) };
    } catch { /* 保持原样 */ }
  }
  return realFetch(url, opts);
};
sandbox.fetch = window.fetch;

const M = sandbox.window.__M1__;
const ASR = sandbox.window.ASR;
const TTS = sandbox.window.TTS;
if (!M || !ASR || !TTS) { console.error('FAIL: 模块未加载'); process.exit(1); }
if (sandbox.window.LOG) sandbox.window.LOG.config.remote = false;

/* ---------- 样本 ---------- */
const SAMPLE = 'tts_gas.wav';
if (!fs.existsSync(path.join(AUDIO, SAMPLE))) {
  console.error(`FAIL: 缺样本 ${SAMPLE}`)
  console.error('  生成：curl -s "http://127.0.0.1:8787/tts?text=煤气漏了怎么办" -o tools/probe/audio/tts_gas.wav');
  process.exit(1);
}
const raw = fs.readFileSync(path.join(AUDIO, SAMPLE));
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const srcRate = dv.getUint32(24, true);
const nSamples = (raw.length - 44) / 2;
const f32 = new Float32Array(nSamples);
for (let i = 0; i < nSamples; i++) f32[i] = dv.getInt16(44 + i * 2, true) / 32768;

/* ---------- 逐次测量 ---------- */
console.log(`=== F2 首句播报时延实测（判据 ≤ ${BUDGET_MS}ms，${N} 次，已避开 LLM 缓存）===`);
console.log(`样本 ${SAMPLE}（${(raw.length / 1024).toFixed(0)}KB，源 ${srcRate}Hz → 16k）\n`);
console.log('  次  ASR    判定    合计   首句（前 18 字）');
console.log('  ' + '-'.repeat(72));

const rows = [];
for (let k = 0; k < N; k++) {
  M.state.mode = 'daily';
  M.state.locked = false;
  /* 每次测量都是「一次新的首轮」：不清上文，上一轮的识别文本会被当作 context
     发给 /act，测的就不再是首轮，而且会改变缓存键。 */
  if (M.state.utterances) M.state.utterances.length = 0;
  M.autoReadState.muted = false;
  document.getElementById('dailyAnswer').innerHTML = '';
  document.getElementById('emgAnswer').innerHTML = '';
  document.getElementById('dailyInput').value = '';

  const beforeSpeak = speakCalls.length;

  /* t0：等价于老人松手。
     用真实 asr.js 的处理链（重采样 → 编码 → 上传 → 识别），
     这样 ① ② 两段也被计入，不是只测 ASR。 */
  const t0 = Date.now();

  // 走 asr.js 的真实产出：同一个编码函数，同一个端点
  const resampled = ASR._internals.resampleTo16k(f32, srcRate);
  const wav = ASR._internals.encodeWav(resampled, 16000);
  const tEncode = Date.now();
  const asrRes = await fetch(`${PROXY}/asr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from(wav),
    signal: AbortSignal.timeout(30000)
  }).then((r) => r.json()).catch((e) => ({ error: String(e.message || e) }));
  const tAsr = Date.now();

  if (!asrRes || !asrRes.text) {
    console.log(`  ${String(k + 1).padStart(2)}  ASR 失败，本次跳过（${asrRes && asrRes.error}）`);
    continue;
  }

  /* ③④：把识别文本喂进真实主路径。speak() 被调用的那一刻就是 t1。 */
  await M.handleQuery(asrRes.text);
  const t1 = speakCalls.length > beforeSpeak ? speakCalls[speakCalls.length - 1].at : Date.now();

  const total = t1 - t0;
  const head = speakCalls.length > beforeSpeak
    ? String(speakCalls[speakCalls.length - 1].text).slice(0, 18)
    : '（无发声）';

  rows.push({
    total,
    encode: tEncode - t0,
    asr: tAsr - tEncode,
    judge: t1 - tAsr,
    ok: speakCalls.length > beforeSpeak
  });

  console.log(
    `  ${String(k + 1).padStart(2)}  ${String(tAsr - tEncode).padStart(4)}ms  ` +
    `${String(t1 - tAsr).padStart(5)}ms  ${String(total).padStart(5)}ms   ${head}`
  );
}

/* ---------- 统计 ---------- */
if (!rows.length) {
  console.error('\nFAIL: 无有效样本，无法判定');
  process.exit(1);
}
const sorted = rows.map((r) => r.total).sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const avg = (k) => Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length);

console.log('\n=== 统计（判据：首句播报 ≤ ' + BUDGET_MS + 'ms）===');
console.log(`  样本数     ${rows.length} / ${N}`);
console.log(`  编码+重采样 均值 ${avg('encode')}ms   ← 我们自己的代码（asr.js）`);
console.log(`  云 ASR     均值 ${avg('asr')}ms   ← 上游`);
console.log(`  判定+拼接  均值 ${avg('judge')}ms   ← 我们自己的代码（LLM + voice）`);
console.log(`  合计       均值 ${avg('total')}ms ｜ P50 ${pct(0.5)}ms ｜ 最大 ${sorted[sorted.length - 1]}ms`);

const allSpoke = rows.every((r) => r.ok);
const within = sorted[sorted.length - 1] <= BUDGET_MS;

console.log('');
if (!allSpoke) console.log('  ✗ 有样本没有触发发声（链路断了，先查这个）');
if (within) {
  console.log(`  ✓ 全部 ${rows.length} 次均在 ${BUDGET_MS}ms 内，判据 4 通过（余量 ${BUDGET_MS - sorted[sorted.length - 1]}ms）`);
} else {
  const over = sorted.filter((x) => x > BUDGET_MS).length;
  console.log(`  ✗ ${over} / ${rows.length} 次超过 ${BUDGET_MS}ms —— 判据 4 未通过`);
  console.log('    可优化的两段（都是我们自己的代码）：');
  console.log('      ① 编码+重采样：改为录音时就重采样，松手后只剩编码');
  console.log('      ② 判定+拼接：先播场景名（200ms 内出声），再补读步骤');
}

console.log('\n注：本测在 Node 里跑，「开始播」= speak() 被调用。');
console.log('    真实浏览器里 speechSynthesis 真正出声通常再加 50–200ms，仍在预算内。');
console.log('    F1b（噪声/失败兜底）与真机音频输出仍须人工验，见 docs/04 §7.2。');

process.exit(within && allSpoke ? 0 : 1);
