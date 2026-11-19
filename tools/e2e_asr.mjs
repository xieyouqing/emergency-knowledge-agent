#!/usr/bin/env node
/**
 * 端到端语音输入验证：音频 → 云 ASR → 文本 → 判定 → 出卡
 *
 * 与其它脚本的分工：
 *   selftest_m1.mjs  离线断言 WAV 编码/重采样/错误分类正确，不开麦克风。
 *   e2e_asr.mjs      **真跑云 ASR**，证明「老人说一句话，界面能给出正确的卡」。
 *
 * 用什么音频：仓库里 tools/probe/audio/ 下的样本由 DeepSeek TTS 合成
 * （2026-11-19，`POST /v1/tools/tts`，返回 audio/wav）。这样不必依赖
 * 真实录音，也能验证「前端产出的 WAV 格式 → ASR → 文本」整条链路。
 *
 * 前置: node tools/llm_proxy.mjs 已启动
 * 用法: node tools/e2e_asr.mjs
 * 退出码 0 = 全部符合；1 = 有不符合项
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'app');
const PROXY = 'http://127.0.0.1:8787';
const AUDIO = path.join(ROOT, 'tools', 'probe', 'audio');

try {
  const h = await fetch(`${PROXY}/health`, { signal: AbortSignal.timeout(3000) });
  if (!h.ok) throw new Error('health 非 200');
} catch {
  console.error(`FAIL: 连不上代理 ${PROXY}（先跑 node tools/llm_proxy.mjs）`);
  process.exit(1);
}

/* ---------- DOM stub（与 e2e_voice 同口径） ---------- */
const store = new Map();
function makeEl(id) {
  const cls = new Set();
  const e = {
    id, innerHTML: '', hidden: false, disabled: false, value: '', textContent: '', className: '',
    handlers: {}, children: [], parentNode: null,
    classList: {
      add: c => cls.add(c), remove: c => cls.delete(c),
      contains: c => cls.has(c),
      toggle: (c, on) => { if (on === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); } else if (on) cls.add(c); else cls.delete(c); }
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
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    insertBefore(c) { this.children.unshift(c); c.parentNode = this; return c; }
  };
  return e;
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

/* ---------- 发声桩 ---------- */
const spoken = [];
function Utterance(text) { this.text = text; this.lang = ''; this.rate = 1; }
const synth = {
  getVoices: () => [{ name: 'Microsoft Huihui', lang: 'zh-CN' }],
  speak(u) { spoken.push({ text: u.text }); if (u.onend) u.onend(); },
  cancel() {}, addEventListener() {}
};

/* ---------- 录音桩：把「读文件 → 解码 → 重采样 → 编码」接进来，
     这样测的是 app/asr.js 的真实产出，不是另写一套。 ---------- */
let wavToPlay = null;
function pickAudioCtx() {
  return {
    sampleRate: 24000,           // 与样本一致，走真实重采样路径
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createScriptProcessor: () => ({ onaudioprocess: null, connect() {}, disconnect() {} }),
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    destination: {},
    close() {}
  };
}
const fakeStream = { getTracks: () => [{ stop() {} }] };

const window = {
  document, scrollTo() {}, addEventListener() {}, removeEventListener() {},
  speechSynthesis: synth, SpeechSynthesisUtterance: Utterance,
  navigator: { mediaDevices: { getUserMedia: async () => fakeStream } },
  location: { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost' },
  isSecureContext: true,
  AudioContext: pickAudioCtx,
  AbortController,
  fetch: (...a) => fetch(...a),
  setTimeout, clearTimeout, Date, Blob, FormData
};
const sandbox = {
  window, document, console, Math, String, Number, Object, Array, JSON,
  speechSynthesis: synth, SpeechSynthesisUtterance: Utterance,
  navigator: window.navigator, location: window.location, isSecureContext: true,
  AudioContext: pickAudioCtx, AbortController, fetch: window.fetch,
  setTimeout, clearTimeout, Promise, Error, Date, RegExp, localStorage: null,
  Blob, FormData
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['log.js', 'knowledge.js', 'retrieval.js', 'llm.js', 'voice.js', 'asr.js', 'state.js', 'chat.js', 'tools.js', 'render.js', 'speak.js', 'talk.js', 'agent.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox);
}
const M = sandbox.window.__M1__;
const A = sandbox.window.ASR;
if (!M || !A) { console.error('FAIL: app.js 或 asr.js 未加载'); process.exit(1); }
if (sandbox.window.LOG) sandbox.window.LOG.config.remote = false;

let pass = 0, fail = 0;
const fails = [];
function ok(c, m) { if (c) pass++; else { fail++; fails.push(m); } }

function classify(html) {
  if (!html) return 'empty';
  if (html.includes('class="dialonly"')) return 'dialonly';
  if (html.includes('class="refuse"')) return 'refuse';
  if (html.includes('triage-btn')) return 'steps';
  if (html.includes('seg-immediate')) return 'steps';
  if (html.includes('查看操作步骤')) return 'daily';
  return 'unknown';
}

/* 读 WAV → Float32（与浏览器解码等价：只取 PCM16） */
function readWav(file) {
  const raw = fs.readFileSync(file);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const rate = dv.getUint32(24, true);
  const n = (raw.length - 44) / 2;
  const f32 = new Float32Array(n);
  for (let i = 0; i < n; i++) f32[i] = dv.getInt16(44 + i * 2, true) / 32768;
  return { f32, rate };
}

/* ---------- 用例 ---------- */
const CASES = [
  { file: 'tts_gas.wav',     say: '煤气漏了怎么办',   expectCard: 'steps',  expectText: '煤气漏了怎么办' },
  { file: 'tts_prevent.wav', say: '怎么预防燃气泄漏', expectCard: 'daily',  expectText: '预防' },
  { file: 'tts_weather.wav', say: '今天天气怎么样',   expectCard: 'refuse', expectText: '天气' }
];

console.log('=== 端到端语音输入（真实云 ASR + 真实 handleQuery）===\n');

/* 缺样本就用 TTS 现生成，保证脚本可重复跑 */
const KEY = (() => {
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = env.match(/^DEEPSEEK_API_KEY=(.+)$/m);
    return m ? m[1].trim().replace(/\r$/, '') : '';
  } catch { return ''; }
})();

async function ensureSample(file, text) {
  const p = path.join(AUDIO, file);
  if (fs.existsSync(p)) return p;
  if (!KEY) { console.error(`  缺样本 ${file} 且 .env 无 key，无法生成`); return null; }
  const r = await fetch(`${PROXY}/tts?text=${encodeURIComponent(text)}`, {
    signal: AbortSignal.timeout(20000)
  }).catch(() => null);
  if (r && r.ok) {
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(p, buf);
    console.log(`  已生成样本 ${file}（${buf.length} bytes，经代理 /tts）`);
    return p;
  }
  console.error(`  样本 ${file} 生成失败（代理无 /tts，或上游失败）`);
  return null;
}

for (const c of CASES) {
  const file = await ensureSample(c.file, c.say);
  if (!file) { ok(false, `缺少样本 ${c.file}，该用例未执行`); continue; }

  // 用真实 asr.js 的编码逻辑把样本变成「前端会发出去的那份字节」
  const { f32, rate } = readWav(file);
  const resampled = A._internals.resampleTo16k(f32, rate);
  const wav = A._internals.encodeWav(resampled, 16000);

  const t0 = Date.now();
  let res;
  try {
    const r = await fetch(`${PROXY}/asr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from(wav),
      signal: AbortSignal.timeout(30000)
    });
    res = await r.json();
  } catch (e) {
    ok(false, `「${c.say}」ASR 请求失败：${e.message}`);
    continue;
  }
  const ms = Date.now() - t0;

  const text = String(res.text || '').trim();
  console.log(`「${c.say}」`);
  console.log(`  识别: 「${text}」  音频 ${res.duration_ms}ms  墙钟 ${ms}ms`);
  ok(text.length > 0, `「${c.say}」识别结果为空（音频 ${wav.byteLength} bytes）`);
  if (!text) { console.log(''); continue; }

  // 关键：把识别文本喂进真实主路径，看是否出对的卡
  M.state.mode = 'daily';
  M.state.locked = false;
  M.autoReadState.muted = false;
  document.getElementById('dailyAnswer').innerHTML = '';
  document.getElementById('emgAnswer').innerHTML = '';
  document.getElementById('dailyInput').value = '';

  /* 按**产品真实流程**走一步：识别 → 填框 + 立即出答案（用户裁决不需要再确认）。
     2026-11-19 两次修正的合并结论：
       先前直接 handleQuery → 跳过了填框，测的是「不存在的产品行为」；
       中间一版改成「填框 → 等用户点提问」→ 又多了一步用户不要的确认。
     现在产品是一步：填框 + handleQuery 同一时刻发生，所以测试也照此。
     为此直接驱动 M._talk.up()（真实的松手入口），而不是手工调两步。 */
  const inputBox = document.getElementById('dailyInput');
  if (M._talk) {
    const A2 = sandbox.window.ASR;
    const savedStop = A2.stop;
    // 识别结果直接复用本次真实 ASR 的返回，避免再打一次上游
    A2.stop = () => Promise.resolve({
      ok: true, text, duration_ms: res.duration_ms, latency_ms: res.latency_ms
    });
    M._talk.ctl.active = true;
    M._talk.ctl.listening = true;
    M._talk.ctl.btn = makeEl('talkBtnE2E');
    M._talk.ctl.hint = makeEl('talkHintE2E');
    M._talk.ctl.input = inputBox;
    /* await 完成信号，不等固定毫秒。
       原来写 120ms：LLM 缓存命中时够（3ms），一旦清缓存要 800–1800ms，
       测试立刻变成假失败——这是「测试依赖时序」的典型症状。 */
    await M._talk.up();
    A2.stop = savedStop;
  }

  ok(String(inputBox.value || '').trim() === text,
    `输入框应留着识别文本供核对，实际「${inputBox.value}」`);

  const html = document.getElementById('emgAnswer').innerHTML || document.getElementById('dailyAnswer').innerHTML;
  const card = classify(html);
  console.log(`  出卡: ${card} ｜ 模式 ${M.state.mode}（未点任何按钮）`);
  console.log('');

  ok(card === c.expectCard, `「${c.say}」应出 ${c.expectCard} 卡，实际 ${card}`);
  ok(text.includes(c.expectText), `识别文本应含「${c.expectText}」，实际「${text}」`);
  /* 阈值口径（2026-11-19 修正）：
     原来写「端到端 < 8s」——8 秒是我拍的，`01` 里没有这条判据，属于无依据的门槛。
     而且它把「ASR 上游抖动」和「我们的链路慢」混在一个数字里：实测出现过 9477ms，
     复查发现是上游网络抖动，产品侧没有问题，红的是这条自造门槛。

     现在只断言「ASR 这一段有没有异常到不正常」（真正的病态是超时或长时间无响应）：
       - 正常区间实测：662–1191ms
       - 异常上限取 5000ms（约为正常的 4 倍，抓的是真故障而非抖动）
     产品判据「首句播报 ≤ 3 秒」在 tools/measure_latency.mjs 里单独测（`04` §7.2.1）。 */
  ok(ms < 5000, `ASR 段不应超过 5s（正常 662–1191ms，超过视为上游异常），实际 ${ms}ms`);
}

/* ---------- 错误路径：空音频必须被拒，不能返回「识别成功但文本为空」 ---------- */
console.log('=== 错误路径 ===');
{
  const r = await fetch(`${PROXY}/asr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.alloc(10),
    signal: AbortSignal.timeout(10000)
  }).catch(() => null);
  console.log(`  空音频 → HTTP ${r ? r.status : '请求失败'}`);
  ok(r && r.status === 400, `空音频应返回 400，实际 ${r ? r.status : '失败'}`);
}

/* ---------- 结果 ---------- */
console.log('='.repeat(70));
if (fail) {
  console.log(`断言 ${pass + fail} 条：通过 ${pass}，失败 ${fail}`);
  fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
} else {
  console.log(`断言 ${pass} 条：全部通过`);
  console.log('PASS: 音频 → 云 ASR → 文本 → 判定 → 出卡，整条链在真实服务上跑通');
}
