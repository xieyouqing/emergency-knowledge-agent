#!/usr/bin/env node
/**
 * 两家的识别对比：干净音频 + 加噪音频
 *
 * 为什么要在本地「造噪」而不是去找真实噪声录音：
 *   手头只有 TTS 合成的干净语音。而 F1a（60dB 噪声下的可用性）一直挂着未验。
 *   与其空等真实样本，不如**在已知信噪比下做可控对比**——
 *   能不能扛噪是模型的属性，两家用同一段加噪音频喂，差异就有意义。
 *
 * 造噪方法：白噪声按目标 SNR 混入。
 *   SNR(dB) = 20 * log10(signalRMS / noiseRMS)
 *   取 SNR = 20 / 10 / 5 dB 三档（越小越吵）。默认语音 RMS 已经不大，
 *   5dB 大约相当于「街上车流 + 旁边有人说话」。
 *
 * 用法: node tools/compare_asr.mjs
 * 前置: node tools/llm_proxy.mjs 已启动（走它的 /asr，即 DeepSeek）
 *       讯飞走 tools/probe_xfyun.mjs 里的同一套逻辑（这里直接复用其核心步骤）
 *
 * ⚠️ 2026-11-19 修订：本脚本原来复制了一份讯飞实现。那是陷阱——
 *    「两家比出的差异」可能来自「两份代码写得不同」，而不是「两家模型不同」。
 *    现在两家都走 tools/asr/ 里产品用的同一份 provider，差异才只可能来自模型。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getProvider } from './asr/index.mjs';

const ROOT = process.cwd();
const AUDIO = path.join(ROOT, 'tools', 'probe', 'audio');
const PROXY = 'http://127.0.0.1:8787';

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

/* ---------- WAV 读写（16bit 单声道） ---------- */
function readWav(file) {
  const raw = fs.readFileSync(file);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const rate = dv.getUint32(24, true);
  const n = Math.floor((raw.length - 44) / 2);
  const s = new Int16Array(n);
  for (let i = 0; i < n; i++) s[i] = dv.getInt16(44 + i * 2, true);
  return { rate, samples: s };
}

function writeWav16k(file, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(samples[i])));
    data.writeInt16LE(v, i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

function resampleTo16k(input, srcRate) {
  if (srcRate === 16000) return input;
  const ratio = srcRate / 16000;
  const out = new Float64Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const f = pos - i0;
    out[i] = input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}

/* ---------- 按目标 SNR 加白噪声 ---------- */
function addNoise(samples, snrDb, seed) {
  // 线性同余伪随机，保证可复现（同 seed 同噪声）
  let x = seed || 12345;
  const rnd = () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff * 2 - 1;
  };
  let sigPow = 0;
  for (let i = 0; i < samples.length; i++) sigPow += samples[i] * samples[i];
  sigPow /= samples.length;
  const sigRms = Math.sqrt(sigPow);
  const noiseRms = sigRms / Math.pow(10, snrDb / 20);
  const out = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] + rnd() * noiseRms;
  return out;
}

/* ---------- 两家都走 tools/asr/ 的 provider ----------
   ⚠️ 这里曾经各自复制了一份实现，那是个陷阱：
      「两家比出的差异」可能来自「两份代码写得不同」，而不是「两家模型不同」。
      现在两者用产品同一份 provider 代码，差异才只可能来自模型。 */
const providerEnv = {
  API_KEY: env.DEEPSEEK_API_KEY,
  BASE_URL: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
  XFYUN_APPID: env.XFYUN_APPID,
  XFYUN_APIKEY: env.XFYUN_APIKEY,
  XFYUN_APISECRET: env.XFYUN_APISECRET,
  XFYUN_ASR_HOST: env.XFYUN_ASR_HOST,
  XFYUN_ASR_PATH: env.XFYUN_ASR_PATH,
  XFYUN_ASR_DOMAIN: env.XFYUN_ASR_DOMAIN
};

const P_DS = getProvider('deepseek');
const P_XF = getProvider('xfyun');

/** provider 统一吃完整 WAV，返回结构化结果（不抛） */
async function run(p, wavBuf) {
  const av = p.available(providerEnv);
  if (!av.ok) return { ok: false, text: '', latency_ms: 0, error: av.reason };
  return p.transcribe(wavBuf, { timeoutMs: 20000 }, providerEnv);
}

/* ---------- 字符错误率 CER（字级，中文不需要分词） ---------- */
function cer(ref, hyp) {
  const a = [...ref.replace(/[？?。，,！!、\s]/g, '')];
  const b = [...hyp.replace(/[？?。，,！!、\s]/g, '')];
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return a.length ? dp[a.length][b.length] / a.length : 0;
}

/* ---------- 主流程 ---------- */
const CASES = [
  { file: 'tts_gas.wav', ref: '煤气漏了怎么办' },
  { file: 'tts_prevent.wav', ref: '怎么预防燃气泄漏' },
  { file: 'tts_weather.wav', ref: '今天天气怎么样' }
];
const SNRS = [null, 20, 10, 5];   // null = 原声

console.log('=== 两家 ASR 对比（同一段音频，含可控 SNR 加噪）===');
console.log('    ref = 参考文本，CER = 字符错误率（越低越好）\n');

const rows = [];
for (const c of CASES) {
  const src = readWav(path.join(AUDIO, c.file));
  const base = resampleTo16k(Float64Array.from(src.samples), src.rate);

  for (const snr of SNRS) {
    const samples = snr === null ? base : addNoise(base, snr, 42);
    // 落盘成临时 wav（DeepSeek 走代理需要 WAV 字节；讯飞只用 PCM 段）
    const tmp = path.join(AUDIO, `_cmp_${snr === null ? 'clean' : 'snr' + snr}.wav`);
    writeWav16k(tmp, samples);

    const wavBuf = fs.readFileSync(tmp);
    const [ds, xf] = await Promise.all([run(P_DS, wavBuf), run(P_XF, wavBuf)]);
    if (!ds.ok) console.log(`  ⚠️ deepseek 失败: ${ds.error}`);
    if (!xf.ok) console.log(`  ⚠️ xfyun 失败: ${xf.error}`);
    const rmse = { ds: cer(c.ref, ds.text), xf: cer(c.ref, xf.text) };
    rows.push({ file: c.file, snr, ref: c.ref, ds, xf, rmse });

    const tag = snr === null ? '原声  ' : `SNR ${String(snr).padStart(2)}dB`;
    console.log(`${path.basename(c.file).padEnd(16)} ${tag}`);
    console.log(`  DeepSeek ${String(ds.latency_ms || 0).padStart(5)}ms  CER ${(rmse.ds * 100).toFixed(0).padStart(3)}%  「${ds.text}」`);
    console.log(`  讯飞V2.0 ${String(xf.latency_ms || 0).padStart(5)}ms  CER ${(rmse.xf * 100).toFixed(0).padStart(3)}%  「${xf.text}」`);
    console.log('');
  }
}

function writePcm16k(samples) {
  const b = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]))), i * 2);
  }
  return b;
}

/* ---------- 汇总 ---------- */
console.log('=== 汇总 ===');
const bySnr = new Map();
for (const r of rows) {
  const k = r.snr === null ? 'clean' : r.snr;
  if (!bySnr.has(k)) bySnr.set(k, { ds: [], xf: [], dsMs: [], xfMs: [] });
  const g = bySnr.get(k);
  g.ds.push(r.rmse.ds); g.xf.push(r.rmse.xf);
  g.dsMs.push(r.ds.latency_ms || 0); g.xfMs.push(r.xf.latency_ms || 0);
}
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
console.log('  条件      DeepSeek CER   讯飞 CER     DeepSeek 时延   讯飞时延');
for (const [k, g] of bySnr) {
  const label = (k === 'clean' ? '原声' : 'SNR ' + k + 'dB').padEnd(9);
  console.log(
    `  ${label} ${(avg(g.ds) * 100).toFixed(0).padStart(8)}%  ${(avg(g.xf) * 100).toFixed(0).padStart(8)}%  ` +
    `${String(Math.round(avg(g.dsMs))).padStart(10)}ms  ${String(Math.round(avg(g.xfMs))).padStart(8)}ms`
  );
}
console.log('');
console.log('注：CER 基于 TTS 合成音，语音清晰无口音；噪声是白噪声，与真实街道/火场噪声谱不同。');
console.log('    这个对比回答的是「同一段音频谁认得更准、谁更快」，不回答「真实老人方言能否识别」。');

/* 清理临时文件 */
for (const snr of SNRS) {
  const f = path.join(AUDIO, `_cmp_${snr === null ? 'clean' : 'snr' + snr}.wav`);
  try { fs.unlinkSync(f); } catch { /* ignore */ }
}
