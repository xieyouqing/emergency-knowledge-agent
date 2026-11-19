/**
 * DeepSeek ASR provider（当前默认）
 *
 * 端点：POST {BASE_URL}/v1/tools/asr，multipart，字段 file
 * 实测（2026-11-19）：1.6s 中文语音 891 / 936 / 992 / 1328ms，识别正确
 *
 * 这是把 tools/llm_proxy.mjs 里原来的 transcribe() 原样搬过来的。
 * 行为必须与搬家前**逐字节一致**——如果这次抽取改变了默认行为，
 * 那 04 验收清单里所有基于 DeepSeek 的结论都要重测。
 */

export const id = 'deepseek';
export const label = 'DeepSeek 语音识别';

export function available(env) {
  if (!env.API_KEY) return { ok: false, reason: '缺 DEEPSEEK_API_KEY' };
  if (!env.BASE_URL) return { ok: false, reason: '缺 DEEPSEEK_BASE_URL' };
  return { ok: true };
}

/**
 * @param {Buffer} wavBuffer 完整 WAV（含头）
 * @param {{timeoutMs?:number, trace?:string}} opts
 */
export async function transcribe(wavBuffer, opts = {}, env = {}) {
  const timeoutMs = opts.timeoutMs || 15000;
  const t0 = Date.now();

  const fd = new FormData();
  // Blob 的 MIME 用 audio/wav：端点按扩展名/MIME 解析，两者给一致
  fd.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'speech.wav');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${env.BASE_URL}/v1/tools/asr`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.API_KEY}` },
      body: fd,
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message)));
    return {
      ok: false,
      provider: id,
      error: aborted ? `超时（${timeoutMs}ms）` : String((e && e.message) || e)
    };
  }
  clearTimeout(timer);

  const latency = Date.now() - t0;

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return {
      ok: false,
      provider: id,
      code: res.status,
      error: `上游 ${res.status}: ${String(t).slice(0, 200)}`
    };
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, provider: id, error: '返回不是合法 JSON' };
  }

  return {
    ok: true,
    provider: id,
    text: String(data.text || '').trim(),
    duration_ms: typeof data.duration_ms === 'number' ? data.duration_ms : null,
    latency_ms: latency,
    request_id: data.request_id || null
  };
}
