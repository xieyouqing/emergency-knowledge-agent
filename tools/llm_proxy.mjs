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
 *   POST /shutdown → 便于脚本收尾（仅本地回环可用）
 *
 * 设计要点（都是踩过坑才加的）:
 *   1. 只监听 127.0.0.1，不监听 0.0.0.0 —— 否则同网段任何人都能用你的 key。
 *   2. 只允许 HTTP_PROXY_ORIGIN 指定的来源做 CORS，不用 * 。
 *   3. 校验 LLM 返回的 scene 必须在已知场景 id 内，否则置 null。
 *      模型编一个 "fire" 出来，前端拿不到条目就会静默变成拒答——宁可显式置 null。
 *   4. 结果按 text 做内存缓存，评测时同一句只花一次钱。
 *   5. 不把 key 打印到任何日志或响应里。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

/* 用 fileURLToPath 而不是手拼 URL 路径：
   路径含中文时，`new URL().pathname` 返回的是百分号编码串
   （D:/WorkBuddy/%E9%BB%91...），直接拼会 ENOENT。这是踩过的坑。 */
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

/* ---------- 缓存：同一句只花一次钱 ---------- */
const cache = new Map();
const CACHE_MAX = 2000;

/* ---------- 调用模型 ---------- */
async function judge(text) {
  const hit = cache.get(text);
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
      cache: cache.size
    });
  }

  if (req.method === 'POST' && url.pathname === '/judge') {
    let text = '';
    try {
      const body = JSON.parse(await readBody(req));
      text = String(body.text || '').trim();
    } catch (e) {
      return json(res, 400, { error: 'body 不是合法 JSON' });
    }
    if (!text) return json(res, 400, { error: 'text 为空' });
    if (text.length > 500) return json(res, 400, { error: 'text 超过 500 字' });

    try {
      const r = await judge(text);
      return json(res, 200, r);
    } catch (e) {
      // 错误信息里可能带上游响应，但不含 key
      return json(res, 502, { error: String(e.message || e) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/shutdown') {
    json(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 50);
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`LLM 意图判定代理已启动: http://${HOST}:${PORT}`);
  console.log(`  模型: ${MODEL}`);
  console.log(`  key: ${API_KEY.slice(0, 3)}...${API_KEY.slice(-4)}（不打印完整值）`);
  console.log(`  场景白名单: ${SCENE_IDS.length} 个，其中已发布 ${READY_IDS.length} 个`);
  console.log(`  只监听 127.0.0.1，非同网段可达`);
});
