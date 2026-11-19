/**
 * 讯飞 语音听写大模型（中英）V2.0 provider
 *
 * 端点：wss://iat.cn-huabei-1.xf-yun.com/v1 ，domain=spark_asr_v2
 * 鉴权：hmac-sha256 对 host/date/request-line 签名，参数拼在 URL 上
 * 实测（2026-11-19）：可用；一次发完（不等 40ms 节奏）约 750–1200ms
 *
 * ⚠️ 默认 **不启用**。ASR_PROVIDER=xfyun 才走这里。
 *    原因是 2026-11-19 的对比结论：与 DeepSeek 在现有样本上 CER 同为 0%，
 *    无可测差异。留着是为了「等真实老人语音能证明差异时，切换只改一个环境变量」。
 *
 * 四个实测踩过的坑（都在下面代码里有对应处理，不要删注释）：
 *   1. 音频必须 16k。24k 直接发会变调、识别乱码。
 *   2. 每帧返回的是「累计到目前的整句」，不是增量 —— 累加会重复 N 遍。
 *   3. 最后一帧（ls=true）有时只带结尾标点（seg="？"），
 *      无条件覆盖会把整句冲掉，只剩「？」（实测 5 次错 2 次）。
 *   4. 文档建议 40ms/帧是「边说边发」的实时节奏。我们发已录完的文件，
 *      按那个节奏会白等 2 秒（实测 2971ms vs 821ms）。所以 frameMs=0。
 */

import crypto from 'node:crypto';

export const id = 'xfyun';
export const label = '讯飞 语音听写大模型 V2.0';

export function available(env) {
  if (!env.XFYUN_APPID) return { ok: false, reason: '缺 XFYUN_APPID' };
  if (!env.XFYUN_APIKEY) return { ok: false, reason: '缺 XFYUN_APIKEY' };
  if (!env.XFYUN_APISECRET) return { ok: false, reason: '缺 XFYUN_APISECRET' };
  return { ok: true };
}

/* ---------- 鉴权 URL ---------- */
function buildAuthUrl(env, host, reqPath) {
  const date = new Date().toUTCString();   // RFC1123 / GMT，服务端允许 ±300s
  // 注意「: 后面有一个空格」，且 headers 是**固定参数名**不是值
  const origin = `host: ${host}\ndate: ${date}\nGET ${reqPath} HTTP/1.1`;
  const sha = crypto.createHmac('sha256', env.XFYUN_APISECRET).update(origin).digest('base64');
  const authOrigin = `api_key="${env.XFYUN_APIKEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${sha}"`;
  const q = new URLSearchParams({
    host,
    date,
    authorization: Buffer.from(authOrigin).toString('base64')
  });
  return `wss://${host}${reqPath}?${q.toString()}`;
}

/* ---------- WAV → 裸 PCM（讯飞要 pcm，不吃 WAV 头） ---------- */
function wavToPcm(wavBuffer) {
  if (wavBuffer.length < 44) throw new Error('不是合法 WAV');
  const dv = new DataView(wavBuffer.buffer, wavBuffer.byteOffset, wavBuffer.byteLength);
  const rate = dv.getUint32(24, true);
  const channels = dv.getUint16(22, true);
  const bits = dv.getUint16(34, true);
  if (rate !== 16000) {
    // 不静默转换：转换逻辑在 asr.js（前端）负责，provider 只认 16k。
    // 若这里悄悄转，两处重采样实现可能不一致，排查时极难定位。
    throw new Error(`要求 16k 音频，实际 ${rate}Hz（重采样应在前端 asr.js 完成）`);
  }
  if (channels !== 1) throw new Error(`要求单声道，实际 ${channels}`);
  if (bits !== 16) throw new Error(`要求 16bit，实际 ${bits}`);
  return wavBuffer.subarray(44);
}

/**
 * @param {Buffer} wavBuffer 完整 WAV（16k/16bit/单声道）
 * @param {{timeoutMs?:number, trace?:string, frameMs?:number}} opts
 */
export function transcribe(wavBuffer, opts = {}, env = {}) {
  const timeoutMs = opts.timeoutMs || 20000;
  /* frameMs 默认 0：一次性发完。
     坑 4：文档的 40ms 是「边说边发」的场景，我们发的是文件。 */
  const frameMs = typeof opts.frameMs === 'number' ? opts.frameMs : 0;
  const host = env.XFYUN_ASR_HOST || 'iat.cn-huabei-1.xf-yun.com';
  const reqPath = env.XFYUN_ASR_PATH || '/v1';
  const domain = env.XFYUN_ASR_DOMAIN || 'spark_asr_v2';

  let pcm;
  try {
    pcm = wavToPcm(wavBuffer);
  } catch (e) {
    return Promise.resolve({ ok: false, provider: id, error: String(e.message || e) });
  }

  return new Promise((resolve) => {
    const t0 = Date.now();
    /* 每帧 1024 字节（文档建议值）。太小会帧数过多、太大端点会拒
       （10163: length of $.data.audio must be between 0,13000 是 base64 后长度限制，
        1024 字节 base64 后约 1368，安全）。 */
    const FRAME = 1024;

    let currentSeg = '';   // 当前子句的最新全文（坑 2：是累计不是增量）
    let finalized = '';    // 已结束子句
    let settled = false;
    let sid = null;

    let ws;
    try {
      ws = new WebSocket(buildAuthUrl(env, host, reqPath));
    } catch (e) {
      return resolve({ ok: false, provider: id, error: 'WebSocket 构造失败: ' + String(e.message || e) });
    }

    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve({ ...r, provider: id, request_id: sid, latency_ms: Date.now() - t0 });
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: `超时（${timeoutMs}ms）`, text: finalized + currentSeg });
    }, timeoutMs);

    ws.addEventListener('open', () => {
      let off = 0;
      let seq = 1;
      let status = 0;

      const send = () => {
        if (settled) return;
        if (off >= pcm.length) {
          ws.send(JSON.stringify({
            header: { app_id: env.XFYUN_APPID, status: 2 },
            payload: {
              audio: {
                encoding: 'raw', sample_rate: 16000, channels: 1, bit_depth: 16,
                seq, status: 2, audio: ''
              }
            }
          }));
          return;
        }
        const chunk = pcm.subarray(off, Math.min(off + FRAME, pcm.length));
        off += chunk.length;
        const payload = {
          header: { app_id: env.XFYUN_APPID, status },
          payload: {
            audio: {
              encoding: 'raw', sample_rate: 16000, channels: 1, bit_depth: 16,
              seq, status, audio: chunk.toString('base64')
            }
          }
        };
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
        if (frameMs > 0) setTimeout(send, frameMs);
        else setImmediate(send);
      };
      send();
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      const h = msg.header || {};
      if (h.sid && !sid) sid = h.sid;
      if (h.code && h.code !== 0) {
        return finish({ ok: false, code: h.code, error: `${h.code} ${h.message || ''}` });
      }

      const res = msg.payload && msg.payload.result;
      if (res && res.text) {
        let inner;
        try {
          inner = JSON.parse(Buffer.from(res.text, 'base64').toString('utf8'));
        } catch { return; }
        const seg = (inner.ws || []).map((x) => (x.cw || []).map((c) => c.w).join('')).join('');

        /* 坑 3：ls=true 的帧有两种形态
             A: seg=""    → 保持现状
             B: seg="？"  → 只带结尾标点，要追加不能覆盖
           endsWith 判重，避免 A 形态重复追加。 */
        if (seg) {
          if (inner.ls) {
            if (!currentSeg.endsWith(seg)) currentSeg += seg;
          } else {
            currentSeg = seg;
          }
        }

        if (inner.ls) {
          finalized += currentSeg;
          currentSeg = '';
          return finish({ ok: true, text: finalized, duration_ms: null });
        }
      } else if (h.status === 2) {
        return finish({ ok: true, text: finalized + currentSeg, duration_ms: null });
      }
    });

    ws.addEventListener('error', (ev) => {
      finish({ ok: false, error: 'WebSocket 错误: ' + String((ev && ev.message) || 'unknown') });
    });

    ws.addEventListener('close', (ev) => {
      // 正常收尾也会走到这里：用已累积的文本，不当失败
      finish({
        ok: true,
        text: finalized + currentSeg,
        duration_ms: null,
        note: `close code=${ev.code}`
      });
    });
  });
}
