/**
 * ASR provider 选择器
 *
 * 用法（代理侧）：
 *   import { pickProvider, listProviders } from './asr/index.mjs';
 *   const p = pickProvider(env);          // 按 ASR_PROVIDER 选，默认 deepseek
 *   const r = await p.transcribe(wavBuf, { timeoutMs: 15000 }, env);
 *
 * 设计上的两个刻意选择：
 *
 *   1. **默认必须是 deepseek**。抽接口不改行为——如果这次抽取悄悄换了默认，
 *      04 验收清单里所有基于 DeepSeek 的结论都要重跑，而没人会记得为什么。
 *      所以 `ASR_PROVIDER` 不配时，行为与抽取前逐字节一致。
 *
 *   2. **配错名字要报错，不许静默回落**。写 `ASR_PROVIDER=xunfei`（拼错）时
 *      如果悄悄用 deepseek，用户会以为「讯飞测过了」，实际测的是另一家。
 *      这是最坏的一类错误：结论对不上，还查不出来。
 */

import * as deepseek from './deepseek.mjs';
import * as xfyun from './xfyun.mjs';

const ALL = { deepseek, xfyun };

/** 默认 provider。改这个值等于改产品行为，须提案。 */
export const DEFAULT_PROVIDER = 'deepseek';

/**
 * @param {object} env .env 解析结果
 * @returns {{ok:boolean, id?:string, provider?:object, reason?:string}}
 */
export function pickProvider(env = {}) {
  const raw = String(env.ASR_PROVIDER || '').trim().toLowerCase();
  const name = raw || DEFAULT_PROVIDER;

  if (!ALL[name]) {
    return {
      ok: false,
      reason: `ASR_PROVIDER="${raw}" 不是已知 provider。可选：${Object.keys(ALL).join(' / ')}` +
        '（故意不静默回落——回落会让你以为测的是另一家）'
    };
  }
  const p = ALL[name];
  const av = p.available(env);
  if (!av.ok) {
    return { ok: false, reason: `${name} 不可用：${av.reason}` };
  }
  return { ok: true, id: name, provider: p };
}

/** 供 /health 与日志展示 */
export function listProviders(env = {}) {
  return Object.keys(ALL).map((k) => {
    const av = ALL[k].available(env);
    return { id: k, label: ALL[k].label, available: av.ok, reason: av.reason || null, isDefault: k === DEFAULT_PROVIDER };
  });
}

/** 直接按名取（测试用，绕过 ASR_PROVIDER） */
export function getProvider(name) {
  return ALL[name] || null;
}
