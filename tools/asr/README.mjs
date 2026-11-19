/**
 * ASR Provider 接口定义（约定，不是代码约束）
 *
 * 为什么要有这一层：
 *   2026-11-19 实测讯飞后发现一件必须避免的事——对比脚本里复制了一份讯飞实现，
 *   于是「两家比出的差异」可能是「两份代码写得不同」，而不是「两家模型不同」。
 *   抽成 provider 之后，对比脚本和产品走**同一份代码**，差异才只可能来自模型。
 *
 * 统一接口（所有 provider 必须实现）：
 *
 *   export const id = 'deepseek' | 'xfyun'
 *   export const label = '给人看的名字'
 *   export function available(env) -> { ok: boolean, reason?: string }
 *   export async function transcribe(wavBuffer, opts) -> Result
 *
 * 入参：
 *   wavBuffer  Buffer，**完整 WAV**（含 44 字节头，16k/16bit/单声道）
 *              为什么给完整 WAV 而不是裸 PCM：不同供应商要的东西不同，
 *              统一在 provider 内部剥头/转换，调用方不必知道细节。
 *   opts       { timeoutMs?: number, trace?: string }
 *
 * 返回（成功）：
 *   {
 *     ok: true,
 *     text: string,              // 识别文本，已 trim
 *     latency_ms: number,        // 本次调用耗时（含网络）
 *     duration_ms: number|null,  // 音频时长（供应商给就给，不给就 null）
 *     provider: string,          // = id
 *     request_id: string|null    // 供应商的请求 id，排障用
 *   }
 *
 * 返回（失败）：
 *   { ok: false, provider: string, error: string, code?: string|number }
 *   —— **不抛异常**。上层（代理 /log 与 HTTP 响应）需要结构化错误，
 *      throw 会让调用方必须写 try/catch，容易漏。
 *
 * 三条硬约束：
 *   1. **不许在错误信息里回显密钥**。上游返回 401 时可能带 Authorization 片段。
 *   2. **不许重试**。重试会放大费用，且老人的等待时间会翻倍。
 *      失败就让上层按「识别失败」处理（前端有 8 类错误文案）。
 *   3. **超时由 provider 自己管**。统一的 timeoutMs 由调用方传入，
 *      但实现方式不同（HTTP 用 AbortController，WebSocket 用定时器）。
 */

export const SPEC_VERSION = '1.0';
