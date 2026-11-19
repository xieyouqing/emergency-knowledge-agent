#!/usr/bin/env node
/**
 * 讯飞语音听写连通性探测（不改产品代码）
 *
 * 目的：先用最小脚本确认三件事，再决定要不要改代理
 *   ① 这组凭证能连上哪个服务（大模型 V2.0 /v1 还是旧流式版 /v2/iat）
 *   ② 鉴权签名对不对
 *   ③ 对同一段音频的识别结果与耗时（与 DeepSeek 对比用）
 *
 * 用法: node tools/probe_xfyun.mjs [wav文件]
 * 默认用 tools/probe/audio/tts_gas.wav
 *
 * 不依赖任何 npm 包：Node 22 自带 WebSocket（globalThis.WebSocket）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();

/* ---------- 读 .env（零依赖） ---------- */
function loadEnv() {
  const p = path.join(ROOT, '.env');
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/\r$/, '');
  }
  return out;
}
const env = loadEnv();
const APPID = env.XFYUN_APPID;
const API_KEY = env.XFYUN_APIKEY;
const API_SECRET = env.XFYUN_APISECRET;

if (!APPID || !API_KEY || !API_SECRET) {
  console.error('FAIL: .env 缺 XFYUN_APPID / XFYUN_APIKEY / XFYUN_APISECRET');
  process.exit(1);
}
// 只打印长度与末位，绝不打印完整值
const mask = (s) => (s ? s.slice(0, 2) + '*'.repeat(Math.max(0, s.length - 4)) + s.slice(-2) : '(空)');
console.log('=== 讯飞凭证检查（只显示掩码）===');
console.log(`  APPID     ${mask(APPID)}  长度 ${APPID.length}`);
console.log(`  APIKey    ${mask(API_KEY)}  长度 ${API_KEY.length}`);
console.log(`  APISecret ${mask(API_SECRET)}  长度 ${API_SECRET.length}`);
console.log('');

/* ---------- 鉴权 URL（官方算法：hmac-sha256 对 host/date/request-line 签名） ---------- */
function buildAuthUrl(host, reqPath) {
  const date = new Date().toUTCString();   // RFC1123 / GMT，服务端允许 ±300s
  const origin = `host: ${host}\ndate: ${date}\nGET ${reqPath} HTTP/1.1`;
  const sha = crypto.createHmac('sha256', API_SECRET).update(origin).digest('base64');
  const authOrigin = `api_key="${API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${sha}"`;
  const authorization = Buffer.from(authOrigin).toString('base64');
  const q = new URLSearchParams({ host, date, authorization });
  return `wss://${host}${reqPath}?${q.toString()}`;
}

/* ---------- 读 WAV 的 PCM 段（剥掉 44 字节头） ---------- */
function readPcm16(file) {
  const raw = fs.readFileSync(file);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw.length < 44) throw new Error('不是合法 WAV');
  const rate = dv.getUint32(24, true);
  const channels = dv.getUint16(22, true);
  const bits = dv.getUint16(34, true);
  const pcm = raw.subarray(44);
  return { pcm, rate, channels, bits, total: raw.length };
}

/* 线性插值重采样。讯飞要 16k，样本是 24k —— 直接发会变调、识别乱码
   （首次跑就是这么错的：「美美气美气漏…」）。与 app/asr.js 里同一算法。 */
function resampleTo16k(input, srcRate) {
  if (!srcRate || srcRate === 16000) return input;
  const ratio = srcRate / 16000;
  /* ⚠️ input 是 Buffer，length 是**字节数**，采样数要 /2。
     首版写成 floor(input.length / ratio) 把字节当采样用，输出长度翻倍，
     读到最后就越界（ERR_OUT_OF_RANGE at 80640）。 */
  const srcSamples = Math.floor(input.length / 2);
  const outLen = Math.floor(srcSamples / ratio);
  const out = Buffer.alloc(outLen * 2);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.min(Math.floor(pos), srcSamples - 1);
    const i1 = Math.min(i0 + 1, srcSamples - 1);
    const f = pos - i0;
    const s0 = input.readInt16LE(i0 * 2);
    const s1 = input.readInt16LE(i1 * 2);
    out.writeInt16LE(Math.round(s0 * (1 - f) + s1 * f), i * 2);
  }
  return out;
}

const wavPath = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0]
  || path.join(ROOT, 'tools', 'probe', 'audio', 'tts_gas.wav');
if (!fs.existsSync(wavPath)) {
  console.error(`FAIL: 找不到音频 ${wavPath}`);
  process.exit(1);
}
const w = readPcm16(wavPath);
const pcm = resampleTo16k(w.pcm, w.rate);
console.log('=== 音频 ===');
console.log(`  ${path.basename(wavPath)}  源 ${w.rate}Hz → 重采样 16000Hz  ${w.channels}声道 ${w.bits}bit`);
console.log(`  PCM ${(pcm.length / 1024).toFixed(0)}KB（${(pcm.length / 32000).toFixed(2)}s）`);
console.log('');

/* ---------- 跑一次识别 ---------- */
const HOST = env.XFYUN_ASR_HOST || 'iat.cn-huabei-1.xf-yun.com';
const REQ_PATH = env.XFYUN_ASR_PATH || '/v1';
const DOMAIN = env.XFYUN_ASR_DOMAIN || 'spark_asr_v2';

function transcribeOnce({ host, reqPath, domain, frameMs = 40, frameBytes = 1024 }) {
  /* frameMs=40 是文档建议的「边说边发」节奏。我们发的是已录完的文件，
     按实时节奏发 = 白等 2 秒。--fast 用 0 间隔验证这一点。 */
  return new Promise((resolve) => {
    const url = buildAuthUrl(host, reqPath);
    const ws = new WebSocket(url);
    /* ⚠️ 这里踩了两次坑，最终结论以实测为准（DEBUG_XFYUN=1 可复现）：

       实测返回（dwa=wpgs 未生效，pgs 恒为 undefined）：
         sn=1 seg=「煤」
         sn=2 seg=「煤|气」          ← 已含 sn=1 的字
         sn=3 seg=「煤|气|漏」
         sn=7 seg=「煤气漏了怎么办？」 ← 整句
         sn=8 seg=「」ls=true

       **每帧是「累计到目前的整句」，不是增量。**
       正确做法：只取最新一帧作为当前子句；ls=true 表示该子句结束，
       并入 finalized，再开新子句。

       坑 1：首版按增量把所有帧拼起来 →「美美气美气漏美气漏了…」重复 8 遍。
       坑 2：按文档写「sn + rg 区间替换」→ pgs/rg 根本没返回，逻辑空转。
       教训：**别照文档写动态修正，先用 DEBUG 看真实帧结构。** */
    let currentSeg = '';       // 当前子句的最新全文
    let finalized = '';        // 已结束子句的拼接
    const collect = () => finalized + currentSeg;
    let lastText = '';
    let sid = null;
    let settled = false;
    const t0 = Date.now();
    let firstResultMs = null;

    const finish = (r) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      resolve({ ...r, totalMs: Date.now() - t0, firstResultMs, sid });
    };

    const timer = setTimeout(() => finish({ ok: false, error: '超时（15s 未结束）', text: lastText }), 15000);

    ws.addEventListener('open', () => {
      const total = pcm.length;
      let offset = 0;
      let seq = 1;
      let status = 0;

      const send = () => {
        if (settled) return;
        if (offset >= total) {
          // 最后一帧：status=2，audio 为空
          ws.send(JSON.stringify({
            header: { app_id: APPID, status: 2 },
            payload: { audio: { encoding: 'raw', sample_rate: 16000, channels: 1, bit_depth: 16, seq, status: 2, audio: '' } }
          }));
          return;
        }
        const chunk = pcm.subarray(offset, Math.min(offset + frameBytes, total));
        offset += chunk.length;
        const payload = {
          header: { app_id: APPID, status },
          payload: {
            audio: {
              encoding: 'raw', sample_rate: 16000, channels: 1, bit_depth: 16,
              seq, status, audio: chunk.toString('base64')
            }
          }
        };
        // 首帧必须带 parameter
        if (status === 0) {
          payload.parameter = {
            iat: {
              domain,
              language: 'zh_cn',
              accent: 'mandarin',
              dwa: 'wpgs',
              result: { encoding: 'utf8', compress: 'raw', format: 'json' }
            }
          };
        }
        ws.send(JSON.stringify(payload));
        seq++;
        status = 1;
        if (frameMs > 0) setTimeout(send, frameMs); else setImmediate(send);
      };
      send();
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      const h = msg.header || {};
      if (h.sid && !sid) sid = h.sid;
      if (h.code && h.code !== 0) {
        clearTimeout(timer);
        return finish({ ok: false, error: `code=${h.code} ${h.message || ''}` });
      }
      const p = msg.payload;
      if (p && p.result && p.result.text) {
        if (firstResultMs === null) firstResultMs = Date.now() - t0;
        try {
          const inner = JSON.parse(Buffer.from(p.result.text, 'base64').toString('utf8'));
          /* 按实测语义处理：每帧 ws 是「当前子句的累计全文」，
             所以直接覆盖 currentSeg，不累加（累加会导致同一句重复 N 遍）。 */
          const pgs = p.result.pgs;
          const rg = p.result.rg;
          const seg = (inner.ws || []).map((x) => (x.cw || []).map((c) => c.w).join('')).join('');

          if (process.env.DEBUG_XFYUN) {
            console.log(`      [帧] sn=${inner.sn} pgs=${pgs || '-'} rg=${JSON.stringify(rg) || '-'} ls=${inner.ls} seg=「${seg}」`);
          }

          /* 最后一帧（ls=true）有两种实测形态，必须都处理：
               A: seg=""            → 什么都不做（整句已在上一帧给全）
               B: seg="？"          → 只带结尾标点，要**追加**而不是覆盖
             首版无条件覆盖，B 形态会把整句冲掉，只剩「？」——
             5 次里错 2 次，看着像偶发，其实是服务端切帧时机不同。
             判据用 endsWith：若 seg 已在末尾就不重复追加。 */
          if (seg) {
            if (inner.ls) {
              if (!currentSeg.endsWith(seg)) currentSeg += seg;
            } else {
              currentSeg = seg;
            }
          }
          lastText = collect();
          if (inner.ls) {
            // 子句结束：并入 finalized，清空当前
            finalized += currentSeg;
            if (process.env.DEBUG_XFYUN) console.log(`      [ls] currentSeg=「${currentSeg}」 → finalized=「${finalized}」`);
            currentSeg = '';
            clearTimeout(timer);
            finish({ ok: true, text: finalized, raw: inner });
          }
        } catch (e) {
          clearTimeout(timer);
          finish({ ok: false, error: '结果解析失败: ' + e.message });
        }
      } else if (h.status === 2) {
        clearTimeout(timer);
        finish({ ok: true, text: collect() });
      }
    });

    ws.addEventListener('error', (ev) => {
      clearTimeout(timer);
      finish({ ok: false, error: 'WebSocket 错误: ' + ((ev && ev.message) || 'unknown') });
    });

    ws.addEventListener('close', (ev) => {
      clearTimeout(timer);
      if (!settled) finish({ ok: true, text: collect(), note: `close code=${ev.code}` });
    });
  });
}

/* ---------- 依次试两个端点：V2.0 大模型 与 旧流式版 ---------- */
const FAST = process.argv.includes('--fast');
const FRAME_MS = FAST ? 0 : 40;
if (FAST) console.log('（--fast 模式：不按 40ms 实时节奏发送）\n');

const CANDIDATES = [
  { name: '语音听写大模型 V2.0', host: HOST, reqPath: REQ_PATH, domain: DOMAIN, frameMs: FRAME_MS },
  { name: '语音听写流式版（旧）', host: 'iat-api.xfyun.cn', reqPath: '/v2/iat', domain: 'iat', frameMs: FRAME_MS }
];

console.log('=== 探测：哪个服务在你这组凭证下可用 ===');
for (const c of CANDIDATES) {
  process.stdout.write(`  ${c.name}（${c.host}${c.reqPath}）… `);
  const r = await transcribeOnce(c);
  if (r.ok && r.text) {
    console.log('✅ 可用');
    console.log(`     识别: 「${r.text}」`);
    console.log(`     总耗时 ${r.totalMs}ms｜首个结果 ${r.firstResultMs}ms｜sid ${r.sid || '-'}`);
    console.log('');
    console.log('  结论：这组凭证可用于「' + c.name + '」。');
    break;
  } else {
    console.log(`✗ ${r.error || '无结果'}${r.note ? '（' + r.note + '）' : ''}`);
    if (r.text) console.log(`     部分结果: 「${r.text}」`);
  }
}

console.log('');
console.log('说明：');
console.log('  - 本脚本只读 .env，不打印任何密钥原文。');
console.log('  - 若两个端点都不通，通常是「应用里没有添加对应服务」或「该服务未领取免费额度」。');
console.log('  - 控制台：https://console.xfyun.cn/services  → 我的应用 → 服务管理');
