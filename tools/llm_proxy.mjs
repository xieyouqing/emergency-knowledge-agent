#!/usr/bin/env node
/**
 * LLM 意图判定代理（本地开发用）
 *
 * 为什么要有这个代理，而不是前端直调：
 *   API key 一旦写进 app/*.js，任何人按 F12 就能拿到并盗用。
 *   这不是取舍，是硬约束。见 docs/03 §2.4。
 *
 * 用法:
 *   node tools/llm_proxy.mjs            # 默认 127.0.0.1:8787
 *   PORT=9000 node tools/llm_proxy.mjs
 *
 * 端点:
 *   GET  /health   → {ok, model, key_present}
 *   POST /judge    → body {text}  → {intent, scene, confidence, latency_ms, cached}
 *   POST /asr      → body = 原始 WAV 二进制 → {text, duration_ms, latency_ms}
 *   POST /log      → body {records:[...]} → 追加写 logs/app-YYYY-MM-DD.log（前端日志落盘）
 *   POST /shutdown → 便于脚本收尾（仅本地回环可用）
 *
 * 设计要点（都是踩过坑才加的）:
 *   1. 只监听 127.0.0.1，不监听 0.0.0.0 —— 否则同网段任何人都能用你的 key。
 *   2. CORS 来源由 LLM_PROXY_ORIGIN 控制，**不设时默认 `*`**（本地开发方便，
 *      因为只监听回环地址，外部访问不到）。**一旦部署到公网，必须显式设成
 *      具体来源**，否则任何网页都能拿你的代理当免费 API 用。
 *      ⚠️ 2026-11-19 修正：这里原写「只允许 HTTP_PROXY_ORIGIN 指定的来源，不用 *」，
 *      有两处不符 —— 变量名实际是 LLM_PROXY_ORIGIN（见下文 151 行），
 *      且默认值确实是 `*`（实测 `OPTIONS` 对任意 Origin 都回 `*`）。
 *      注释写错了比没有注释更糟：照它配环境变量会静默无效。
 *   3. 校验 LLM 返回的 scene 必须在已知场景 id 内，否则置 null。
 *      模型编一个 "fire" 出来，前端拿不到条目就会静默变成拒答——宁可显式置 null。
 *   4. 结果按 text 做内存缓存，评测时同一句只花一次钱。
 *   5. 不把 key 打印到任何日志或响应里。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pickProvider, listProviders, DEFAULT_PROVIDER } from './asr/index.mjs';

/* 用 fileURLToPath 而不是手拼 URL 路径：
   路径含中文时，`new URL().pathname` 返回的是百分号编码串
   （D:/WorkBuddy/%E9%BB%91...），直接拼会 ENOENT。这是踩过的坑。 */
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- 日志落盘（前端 POST /log 的目标） ----------
   为什么由代理写：浏览器 JS 没有文件写权限。前端只负责攒批 + POST，
   写盘、切分、清理都在这里做。

   三条纪律：
     1. **再脱敏一次。** 不信任前端已经脱过——key 泄露是不可逆的。
     2. 单文件超 5MB 切分，保留 7 天。日志是排查工具，不是数据资产。
     3. 写盘失败只 console.error，不回 5xx 重压前端。日志坏了不能影响产品。 */
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_KEEP_DAYS = 7;

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9_.-]{8,}/gi,
  /(["']?(?:api[_-]?key|apikey|secret|token|password)["']?\s*[:=]\s*["']?)[^\s'",}]{6,}/gi
];

function scrubText(s) {
  let out = String(s ?? '');
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m, p1) => (
    // 无捕获组的正则，p1 拿到的是「偏移量数字」而不是分组文本。
    // 必须判类型，否则会把偏移量拼进日志（实测踩过：sk-xxx 被替换成 "92***"）。
    typeof p1 === 'string' && p1 ? p1 + '***' : '***'
  ));
  return out;
}

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    return true;
  } catch (e) {
    console.error('日志目录创建失败:', e.message);
    return false;
  }
}

function logFileFor(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  let base = path.join(LOG_DIR, `app-${y}-${m}-${day}.log`);
  // 超过上限就换序号文件
  try {
    if (fs.existsSync(base) && fs.statSync(base).size > LOG_MAX_BYTES) {
      let i = 1;
      while (fs.existsSync(`${base}.${i}`) && fs.statSync(`${base}.${i}`).size > LOG_MAX_BYTES) i++;
      base = `${base}.${i}`;
    }
  } catch (e) { /* 统计失败就照原文件写 */ }
  return base;
}

function appendLogs(records) {
  if (!ensureLogDir()) return 0;
  const lines = [];
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    let line;
    try { line = JSON.stringify(r); } catch { continue; }
    lines.push(scrubText(line));
  }
  if (!lines.length) return 0;
  try {
    fs.appendFileSync(logFileFor(), lines.join('\n') + '\n', 'utf8');
    return lines.length;
  } catch (e) {
    console.error('日志写盘失败:', e.message);
    return 0;
  }
}

function pruneLogs() {
  try {
    if (!fs.existsSync(LOG_DIR)) return;
    const cutoff = Date.now() - LOG_KEEP_DAYS * 864e5;
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!/^app-\d{4}-\d{2}-\d{2}\.log(\.\d+)?$/.test(f)) continue;
      const p = path.join(LOG_DIR, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch (e) { console.error('日志清理失败:', e.message); }
}

/* ---------- 读 .env（零依赖，不引 dotenv） ---------- */
function loadEnv() {
  const p = path.join(ROOT, '.env');
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };
const API_KEY = env.DEEPSEEK_API_KEY || '';
const BASE_URL = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = env.DEEPSEEK_MODEL || 'deepseek-chat';
const PORT = Number(env.LLM_PROXY_PORT || 8787);
const HOST = '127.0.0.1';                 // 绝不监听 0.0.0.0
const ALLOW_ORIGIN = env.LLM_PROXY_ORIGIN || '*'; // 本地开发可放宽；部署时必须收紧

if (!API_KEY) {
  console.error('FAIL: .env 里没有 DEEPSEEK_API_KEY');
  process.exit(1);
}
if (!API_KEY.startsWith('sk-')) {
  console.error('FAIL: key 格式不对。DeepSeek 的 key 以 "sk-" 开头，');
  console.error('      如果你手里的 key 带 "deepseek" 前缀，那个前缀要去掉。');
  process.exit(1);
}

/* ---------- 场景白名单：从 index.json 读，不硬编码 ---------- */
const INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'index.json'), 'utf8'));
const SCENE_IDS = INDEX.slots.map(s => s.id);
const READY_IDS = INDEX.slots.filter(s => s.state === 'ready').map(s => s.id);

const SYSTEM_PROMPT = `你是应急问答系统的意图分类器。只输出 JSON，不解释、不加代码块。

可选场景 id（只能用这些，不许自造）：
${SCENE_IDS.join(', ')}

对用户输入判定三件事：
1. intent
   - ongoing    = 危险正在发生，需要立即行动（"着火了"、"煤气漏了"、"起不来"）
   - prevention = 问预防方法、日常注意事项、知识性疑问（"怎么预防"、"多久换一次"、"要不要装"）
   - off_scope  = 与应急急救无关（缴费、投诉、选购、价格、理赔、广告、邻里关系等）
2. scene：命中的场景 id；off_scope 或无法归属时必须为 null
3. confidence：0.0-1.0

判定要点：
- "怎么预防X"、"X多久一次"、"要不要装X" 属 prevention，不是 ongoing
- "X费怎么交"、"X怎么投诉"、"X怎么选"、"X多少钱" 属 off_scope
- 只在真的正在出事时给 ongoing
- 宁可 scene 为 null，也不要猜一个相近的场景

输出格式（严格，不要多余字段）：
{"intent":"ongoing|prevention|off_scope","scene":"<id>|null","confidence":0.0}`;

/* ---------- 云 ASR ----------
   为什么必须由代理转发，而不是前端直连：
     同一个理由（key 不进前端）。而且 ASR 端点是 multipart 上传，
     前端直连还要额外暴露 endpoint。

   实测（2026-11-19）：
     POST /v1/tools/asr，字段名 `file`，16k 单声道 WAV 可解析
     返回 {"request_id":"...","text":"...","duration_ms":891}
     1.6 秒中文语音墙钟 891/936 ms —— 这是 M2 能用语音的实测依据。

   ⚠️ M3 打包后没有 Node 进程，本端点会一起消失（docs/03 D-6 已记录：
      能力归零，回落 L3）。这不是本实现的缺陷。 */
const ASR_MAX_BYTES = 12 * 1024 * 1024;   // 12MB ≈ 6 分钟 16k 单声道 WAV
const ASR_TIMEOUT_MS = 15000;

/* ASR 调用统一走 tools/asr/ 里的 provider（2026-11-19 抽出）。
   为什么抽：对比脚本原来复制了一份讯飞实现，于是「两家比出的差异」可能是
   「两份代码写得不同」而不是「两家模型不同」。抽出之后对比与产品走同一份代码。

   **默认仍是 deepseek**：ASR_PROVIDER 不配时，行为与抽取前逐字节一致。
   配错名字会报错而不是静默回落——否则你以为测了讯飞，实际测的是 DeepSeek。 */
function resolveAsrProvider() {
  /* ⚠️ 这里必须传 providerEnv() 而不是只传讯飞那几个键。
     踩过：早期版本只传 XFYUN_*，导致 deepseek 的 available() 查 env.API_KEY
     拿不到值，/health 显示「deepseek 不可用：缺 DEEPSEEK_API_KEY」而
     key_present 明明是 true —— 两处用的 env 不是同一个视图。 */
  const pe = providerEnv();
  return pickProvider({ ...pe, ASR_PROVIDER: env.ASR_PROVIDER });
}

/* provider 需要的最小 env 子集：key 只传需要的，不把整个 env 递下去 */
function providerEnv() {
  return {
    // deepseek 用
    API_KEY,
    BASE_URL,
    // xfyun 用
    XFYUN_APPID: env.XFYUN_APPID,
    XFYUN_APIKEY: env.XFYUN_APIKEY,
    XFYUN_APISECRET: env.XFYUN_APISECRET,
    XFYUN_ASR_HOST: env.XFYUN_ASR_HOST,
    XFYUN_ASR_PATH: env.XFYUN_ASR_PATH,
    XFYUN_ASR_DOMAIN: env.XFYUN_ASR_DOMAIN
  };
}

/**
 * @returns {{ok:boolean, text?, provider?, error?, latency_ms?, duration_ms?, request_id?}}
 *          永不抛异常 —— 上层要结构化错误。
 */
async function transcribe(wavBuffer, opts = {}) {
  const picked = resolveAsrProvider();
  if (!picked.ok) {
    return { ok: false, provider: 'none', error: picked.reason };
  }
  try {
    const r = await picked.provider.transcribe(wavBuffer, {
      timeoutMs: opts.timeoutMs || ASR_TIMEOUT_MS,
      trace: opts.trace
    }, providerEnv());
    // provider 已保证不抛；这里再兜一层，防实现方未来改动
    return r && typeof r === 'object'
      ? r
      : { ok: false, provider: picked.id, error: 'provider 返回结构异常' };
  } catch (e) {
    return { ok: false, provider: picked.id, error: String((e && e.message) || e) };
  }
}

/* ---------- 云 TTS（只用于生成测试样本）----------
   产品里的朗读走浏览器 speechSynthesis（离线可用、零延迟）。
   这个端点不参与产品链路，存在的唯一理由是：**造 ASR 的测试样本**。
   没有它，e2e_asr.mjs 就得把 wav 二进制提交进仓库，或要求人手录音——
   两者都会让测试不可重复。

   实测（2026-11-19）：POST /v1/tools/tts，body {text}，返回 audio/wav。 */
async function synthesize(text) {
  const res = await fetch(`${BASE_URL}/v1/tools/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({ text })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`TTS 上游 ${res.status}: ${String(t).slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/* ---------- 缓存：同一句只花一次钱 ---------- */
const cache = new Map();
const CACHE_MAX = 2000;

/* ---------- 调用模型 ---------- */
async function judge(text, opts) {
  const noCache = !!(opts && opts.noCache);
  const hit = noCache ? null : cache.get(text);
  if (hit) return { ...hit, cached: true, latency_ms: 0 };

  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text }
      ],
      temperature: 0,
      max_tokens: 80,
      response_format: { type: 'json_object' }
    })
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`上游 ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '{}';
  const latency = Date.now() - t0;

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error(`模型返回不是合法 JSON: ${raw.slice(0, 120)}`);
  }

  /* 收紧模型输出：任何越界值一律降级为安全值 */
  let intent = String(obj.intent || '').trim();
  if (!['ongoing', 'prevention', 'off_scope'].includes(intent)) intent = 'off_scope';

  let scene = obj.scene;
  if (scene === 'null' || scene === '' || scene === undefined) scene = null;
  if (scene !== null && !SCENE_IDS.includes(scene)) scene = null;  // 自造场景 → null

  // 一致性：off_scope 不该带场景
  if (intent === 'off_scope') scene = null;

  let confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  const result = {
    intent,
    scene,
    // scene_unpublished: 判出了场景但该场景还没有条目 → 前端只能给拨号卡
    scene_unpublished: scene !== null && !READY_IDS.includes(scene),
    confidence,
    latency_ms: latency,
    cached: false,
    model: data?.model || MODEL
  };

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(text, result);
  return result;
}

/* 代理自己的日志：与前端同一份文件、同一套字段，这样按 trace 能拼出
   「前端发了什么 → 代理调了模型 → 模型答了什么 → 代理回了什么」。 */
function proxyLog(level, msg, fields = {}) {
  const rec = {
    ts: new Date().toISOString(),
    level,
    module: 'proxy',
    trace: fields.trace || null,
    msg,
    ...fields
  };
  if ('trace' in rec && typeof rec.trace === 'undefined') rec.trace = null;
  appendLogs([rec]);
}

/* ---------- HTTP 服务 ---------- */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('body 过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readBodyBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('body 过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      model: MODEL,
      key_present: !!API_KEY,
      scenes: SCENE_IDS.length,
      ready: READY_IDS.length,
      cache: cache.size,
      log_dir: path.relative(ROOT, LOG_DIR).replace(/\\/g, '/'),
      log_keep_days: LOG_KEEP_DAYS,
      asr_provider: (() => {
        const p = resolveAsrProvider();
        return p.ok ? p.id : 'unavailable:' + p.reason;
      })(),
      asr_default: DEFAULT_PROVIDER,
      asr_providers: listProviders(providerEnv())
    });
  }

  /* 清缓存：`03` v1.7 写明「复跑评测前须清代理缓存」，但一直没提供方法。
     没有它，评测跑第二次就是拿缓存自欺（latency_ms 恒为 0）。
     仅测试/评测用，不影响产品路径。 */
  if (req.method === 'POST' && url.pathname === '/cache/clear') {
    const n = cache.size;
    cache.clear();
    proxyLog('info', '清空判定缓存', { cleared: n });
    return json(res, 200, { ok: true, cleared: n });
  }

  if (req.method === 'POST' && url.pathname === '/judge') {
    let text = '';
    let trace = null;
    let noCache = false;
    try {
      const body = JSON.parse(await readBody(req));
      text = String(body.text || '').trim();
      trace = typeof body.trace === 'string' ? body.trace.slice(0, 64) : null;
      // nocache: 测真实时延用（缓存命中的 latency 恒为 0，测不出东西）
      noCache = body.nocache === true;
    } catch (e) {
      return json(res, 400, { error: 'body 不是合法 JSON' });
    }
    if (!text) return json(res, 400, { error: 'text 为空' });
    if (text.length > 500) return json(res, 400, { error: 'text 超过 500 字' });

    try {
      const t0 = Date.now();
      const r = await judge(text, { noCache });
      proxyLog('info', 'judge 完成', {
        trace,
        intent: r.intent,
        scene: r.scene,
        confidence: r.confidence,
        cached: r.cached,
        latency_ms: r.latency_ms,
        total_ms: Date.now() - t0,
        text_len: text.length
      });
      return json(res, 200, r);
    } catch (e) {
      // 错误信息里可能带上游响应，但不含 key
      proxyLog('error', 'judge 失败', { trace, error: scrubText(String(e.message || e)) });
      return json(res, 502, { error: String(e.message || e) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/log') {
    let records = [];
    try {
      const raw = await readBody(req, 512 * 1024);
      const body = JSON.parse(raw);
      records = Array.isArray(body.records) ? body.records : [];
    } catch (e) {
      // 日志本身写不进去不该让调用方重试，直接 200 但如实说没写
      return json(res, 200, { ok: false, written: 0, error: 'body 解析失败' });
    }
    const written = appendLogs(records);
    return json(res, 200, { ok: true, written, received: records.length });
  }

  /* ASR：前端发原始 WAV 二进制（application/octet-stream），这里包成
     multipart 转发。为什么不用前端直接发 multipart：浏览器组 multipart
     的代码与 curl 不同，出错时难判定是编码问题还是端点问题。
     统一在代理侧组，前端只负责「把字节发出去」。 */
  if (req.method === 'POST' && url.pathname === '/asr') {
    let trace = null;
    try { trace = (url.searchParams.get('trace') || '').slice(0, 64) || null; } catch { /* ignore */ }
    let buf;
    try {
      buf = await readBodyBuffer(req, ASR_MAX_BYTES);
    } catch (e) {
      proxyLog('warn', 'ASR 音频过大被拒', { trace, error: String(e.message || e) });
      return json(res, 413, { error: '音频过大（上限 12MB）' });
    }
    if (!buf || buf.length < 100) {
      proxyLog('warn', 'ASR 音频为空', { trace, bytes: buf ? buf.length : 0 });
      return json(res, 400, { error: '音频为空' });
    }

    const t0 = Date.now();
    /* provider 返回结构化结果、不抛异常（见 tools/asr/README.mjs 的接口约定），
       所以这里不用 try/catch，改为判断 r.ok。 */
    const r = await transcribe(buf, { trace });

    if (!r.ok) {
      const msg = String(r.error || '识别失败');
      const isTimeout = /超时|timeout/i.test(msg);
      proxyLog('error', isTimeout ? 'ASR 超时' : 'ASR 失败', {
        trace,
        provider: r.provider,
        bytes: buf.length,
        code: r.code || null,
        error: scrubText(msg)
      });
      return json(res, isTimeout ? 504 : 502, {
        error: scrubText(msg),
        provider: r.provider
      });
    }

    /* 摘要必落盘：识别文本是「用户到底说了什么」的唯一记录，
       出错时第一个要看的就是它（截断同前端规则）。
       provider 也记：同一个音频换供应商后结果变了，日志能看出来。 */
    proxyLog('info', 'ASR 完成', {
      trace,
      provider: r.provider,
      bytes: buf.length,
      text: String(r.text || '').slice(0, 40),
      text_len: String(r.text || '').length,
      audio_ms: r.duration_ms,
      upstream_ms: r.latency_ms,
      total_ms: Date.now() - t0
    });
    return json(res, 200, {
      text: String(r.text || '').trim(),
      duration_ms: r.duration_ms,
      latency_ms: r.latency_ms,
      provider: r.provider,
      request_id: r.request_id || null
    });
  }

  /* 仅用于生成 e2e_asr 的测试样本，不参与产品链路 */
  if (req.method === 'GET' && url.pathname === '/tts') {
    const text = String(url.searchParams.get('text') || '').trim();
    if (!text) return json(res, 400, { error: 'text 为空' });
    if (text.length > 200) return json(res, 400, { error: 'text 超过 200 字' });
    try {
      const buf = await synthesize(text);
      proxyLog('info', 'TTS 合成（测试样本）', { text: text.slice(0, 40), bytes: buf.length });
      cors(res);
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': buf.length });
      res.end(buf);
    } catch (e) {
      proxyLog('error', 'TTS 失败', { error: scrubText(String(e.message || e)) });
      return json(res, 502, { error: scrubText(String(e.message || e)) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/shutdown') {
    json(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 50);
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  ensureLogDir();
  pruneLogs();
  // 每天清一次旧日志；进程退出就一起结束，不用 unref 之外的清理逻辑
  setInterval(pruneLogs, 24 * 3600 * 1000).unref();
  proxyLog('info', '代理启动', { port: PORT, model: MODEL, ready: READY_IDS.length });

  console.log(`LLM 意图判定代理已启动: http://${HOST}:${PORT}`);
  console.log(`  模型: ${MODEL}`);
  console.log(`  key: ${API_KEY.slice(0, 3)}...${API_KEY.slice(-4)}（不打印完整值）`);
  console.log(`  场景白名单: ${SCENE_IDS.length} 个，其中已发布 ${READY_IDS.length} 个`);
  console.log(`  日志目录: ${path.relative(ROOT, LOG_DIR)}（保留 ${LOG_KEEP_DAYS} 天）`);
  console.log(`  只监听 127.0.0.1，非同网段可达`);
});
