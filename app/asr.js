/* =========================================================
   应急助手 · 语音输入（ASR）
   依据：docs/01 §4.2「按住说话 → 云 ASR → 场景归一」

   ⚠️ 为什么不用 Web Speech API（SpeechRecognition）：
     ① Android WebView 不支持（Chromium 官方，docs/03 事实 1）
     ② 微信内不支持（事实 2）
     ③ 桌面 Chrome 虽支持，但它在服务端识别、无法控制采样率，
        且各浏览器行为不一致
   → 所以走「自己录音 + 上传云 ASR」：录音用 getUserMedia（跨平台一致），
     识别用 DeepSeek /v1/tools/asr（2026-11-19 实测 891/936ms，识别正确）。

   三个必须守住的约束：
     A. **必须处于安全上下文**（https 或 localhost）。file:// 拿不到麦克风，
        这不是 bug 是平台规则。必须明确告知，不能让用户以为按钮坏了。
     B. **必须给可见反馈**。录音中、识别中都要有状态，不许无反馈等待
        （docs/01 §8 红线 1）。
     C. **失败必须分类**。无权限 / 无设备 / 太短 / 识别为空 / 网络 / 超时，
        每类给不同的话，不合并成「识别失败」。

   采样率：浏览器 AudioContext 通常是 48k，ASR 端点吃 16k 最稳，
   所以录完要重采样。见 resampleTo16k。
   ========================================================= */
(function (global) {
  'use strict';

  /* 运行日志（可选依赖） */
  var LOG = global.LOG || null;
  function lg(level, msg, fields) {
    if (!LOG) return;
    var t = LOG.tag('asr');
    if (t[level]) t[level](msg, fields);
  }

  var TARGET_RATE = 16000;     // ASR 端点实测可用
  var MIN_MS = 400;            // 短于此视为误触，不发
  var MAX_MS = 15000;          // 上限：防止按住不放一直录
  var ENDPOINT = 'http://127.0.0.1:8787/asr';
  var TIMEOUT_MS = 15000;

  var state = {
    supported: false,
    reason: null,            // 不可用原因（用户能看懂的话）
    recording: false,
    busy: false,             // 上传/识别中
    lastText: '',
    lastError: null,
    sourceRate: 0
  };

  var stats = { tries: 0, ok: 0, failed: 0, tooShort: 0, empty: 0 };

  var ctx = null;            // AudioContext
  var stream = null;         // MediaStream
  var source = null;         // MediaStreamSource
  var proc = null;           // ScriptProcessorNode
  var chunks = [];           // Float32Array[]
  var startedAt = 0;
  var autoStopTimer = null;

  /* ---------- 能力探测 ----------
     顺序有讲究：先判安全上下文，再判 API 存在，最后判设备。
     因为「不支持」和「不安全」的处置完全不同（前者无解，后者起服务器即可）。 */
  function detect() {
    var nav = global.navigator || {};
    var md = nav.mediaDevices;

    /* localhost / 127.0.0.1 / https 之外都是不安全上下文。
       file:// 双击打开就落在这里——这是最常见的踩坑点。 */
    var secure = (typeof global.isSecureContext === 'boolean')
      ? global.isSecureContext
      : isLocalHost(global.location && global.location.hostname, global.location && global.location.protocol);

    if (!secure) {
      state.supported = false;
      state.reason = '语音输入需要先启动本地服务（地址是 localhost 或 https）。直接双击打开网页拿不到麦克风。';
      lg('warn', 'ASR 不可用：非安全上下文', { origin: global.location && global.location.origin });
      return state;
    }
    if (!md || typeof md.getUserMedia !== 'function') {
      state.supported = false;
      state.reason = '这台设备的浏览器不支持录音。';
      lg('warn', 'ASR 不可用：无 getUserMedia');
      return state;
    }
    if (typeof global.AudioContext !== 'function' && typeof global.webkitAudioContext !== 'function') {
      state.supported = false;
      state.reason = '这台设备的浏览器不支持录音处理。';
      lg('warn', 'ASR 不可用：无 AudioContext');
      return state;
    }
    state.supported = true;
    state.reason = null;
    return state;
  }

  function isLocalHost(host, proto) {
    if (proto === 'https:') return true;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  }

  /* ---------- 录音 ---------- */
  function pickAudioCtx() {
    var C = global.AudioContext || global.webkitAudioContext;
    return new C();
  }

  function start() {
    if (state.recording) return Promise.resolve({ ok: false, reason: 'already-recording' });
    /* 并发保护第二道：上一次的流没关干净时 state.recording 可能已复位，
       但 stream/ctx 还在。必须先彻底清理再开新的，否则两个音频流会一起
       往同一个 chunks 数组推数据 —— 实测录出过 26 秒 / 52 秒的音频
       （15 秒上限形同失效，且把扬声器的朗读声也录了进去）。 */
    if (stream || ctx || proc) {
      lg('warn', '检测到未清理的录音资源，先强制清理');
      cleanup();
    }
    var d = detect();
    if (!d.supported) return Promise.resolve({ ok: false, reason: 'unsupported', message: d.reason });

    chunks = [];
    return (global.navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // 关掉浏览器侧的自动增益/降噪：老人环境噪声大，过度处理反而伤语音
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })).then(function (s) {
      stream = s;
      ctx = pickAudioCtx();
      state.sourceRate = ctx.sampleRate;
      source = ctx.createMediaStreamSource(s);
      /* ScriptProcessorNode 虽已废弃，但兼容性最好（含 Android WebView）。
         用 4096 缓冲：约 85ms@48k，延迟与稳定性折中。 */
      proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = function (ev) {
        if (!state.recording) return;
        var inp = ev.inputBuffer.getChannelData(0);
        // 必须复制：inputBuffer 会被复用，直接存引用会拿到全 0
        chunks.push(new Float32Array(inp));
      };
      source.connect(proc);
      /* 接到 destination 才会持续触发 onaudioprocess。
         为避免把麦克风原声播出来（啸叫），接到一个 0 增益节点。 */
      var mute = ctx.createGain();
      mute.gain.value = 0;
      proc.connect(mute);
      mute.connect(ctx.destination);

      state.recording = true;
      startedAt = Date.now();
      lg('info', '开始录音', { rate: state.sourceRate });
      if (LOG && LOG.always) LOG.always('asr', '开始录音', { rate: state.sourceRate });

      /* 上限保险丝：防止按住不放（老人可能按住了就忘了松）。
         ⚠️ 这里必须把「被自动停了」告诉界面，否则识别结果没人接收——
            先前版本自己调 stop()，Promise 结果直接丢掉，表现为
            「录到 15 秒就没了，什么也没发生」。 */
      autoStopTimer = setTimeout(function () {
        lg('warn', '录音达到上限，自动停止', { maxMs: MAX_MS });
        if (typeof state.onAutoStop === 'function') {
          try { state.onAutoStop(); } catch (e) { /* 界面回调出错不能影响录音清理 */ }
        } else {
          stop();   // 没有界面接管时才自己停（自测场景）
        }
      }, MAX_MS);

      return { ok: true };
    }).catch(function (e) {
      var name = (e && e.name) || '';
      var msg = '打不开麦克风。';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        msg = '没有麦克风权限。请在浏览器地址栏允许使用麦克风，然后再试。';
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        msg = '这台设备没有找到麦克风。';
      } else if (name === 'NotReadableError') {
        msg = '麦克风被别的程序占用了（比如正在打电话）。关掉那个程序再试。';
      } else if (name === 'SecurityError') {
        /* 实测出现过：页面被嵌在 iframe 里且未授予 microphone 权限。
           这句话必须说清「不是你操作错了」，否则老人只会反复按按钮。 */
        msg = '页面被嵌在其他窗口里，浏览器不允许用麦克风。请在新标签页里打开这个网页。';
      } else if (name === 'NotSupportedError' || name === 'TypeError') {
        msg = '这台设备的浏览器不支持这种录音方式。可以用输入法自带的语音输入打字。';
      }
      state.lastError = name || String(msg);
      lg('warn', '打开麦克风失败', { error: state.lastError, message: msg });
      cleanup();
      return { ok: false, reason: 'mic', message: msg };
    });
  }

  /* 停止录音并识别。返回 {ok, text, ...} 或 {ok:false, reason, message} */
  function stop() {
    if (!state.recording) return Promise.resolve({ ok: false, reason: 'not-recording' });
    var ms = Date.now() - startedAt;
    state.recording = false;
    if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
    cleanupKeepCtx();

    if (ms < MIN_MS || !chunks.length) {
      stats.tooShort++;
      lg('info', '录音太短，未上传', { ms: ms, chunks: chunks.length });
      teardownCtx();
      return Promise.resolve({ ok: false, reason: 'too-short', message: '说话时间太短了，请按住多说两个字。' });
    }

    var flat = mergeChunks(chunks);
    var resampled = resampleTo16k(flat, state.sourceRate || TARGET_RATE);
    var wav = encodeWav(resampled, TARGET_RATE);
    lg('info', '录音结束，准备上传', {
      ms: ms, srcRate: state.sourceRate, samples: resampled.length, bytes: wav.byteLength
    });
    chunks = [];
    teardownCtx();

    stats.tries++;
    state.busy = true;
    return upload(wav).then(function (r) {
      state.busy = false;
      if (!r.ok) { stats.failed++; return r; }
      if (!r.text) {
        // 端点返回 200 但文本为空：多半是没说话/只有噪声
        stats.empty++;
        lg('info', '识别结果为空', { duration_ms: r.duration_ms });
        return { ok: false, reason: 'empty', message: '没有听清。请靠近一点，按住按钮再说一遍。' };
      }
      stats.ok++;
      state.lastText = r.text;
      if (LOG && LOG.always) {
        LOG.always('asr', '识别完成', {
          text: r.text.slice(0, 40), textLen: r.text.length,
          audioMs: r.duration_ms, latencyMs: r.latency_ms
        });
      }
      return { ok: true, text: r.text, duration_ms: r.duration_ms, latency_ms: r.latency_ms };
    });
  }

  function upload(wav) {
    var url = ENDPOINT + (LOG && LOG.getTrace() ? '?trace=' + encodeURIComponent(LOG.getTrace()) : '');
    var ctrl = (typeof global.AbortController === 'function') ? new global.AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;

    return (global.fetch || (global.globalThis && global.globalThis.fetch))(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: wav,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        return res.text().then(function (t) {
          return { ok: false, reason: 'http', message: '识别服务出错了（' + res.status + '）。', detail: String(t).slice(0, 120) };
        });
      }
      return res.json();
    }).then(function (d) {
      if (d && d.ok === false) return d;   // 上面 http 分支已返回
      return { ok: true, text: String((d && d.text) || '').trim(), duration_ms: d && d.duration_ms, latency_ms: d && d.latency_ms };
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      var isAbort = e && (e.name === 'AbortError' || /abort/i.test(String(e.message)));
      var msg = isAbort ? '识别太慢了，没等到结果。请再试一次。' : '连不上识别服务。请确认本地服务在运行。';
      state.lastError = String((e && e.message) || e);
      lg('error', isAbort ? 'ASR 请求超时' : 'ASR 请求失败', { error: state.lastError });
      return { ok: false, reason: isAbort ? 'timeout' : 'network', message: msg };
    });
  }

  function cancel() {
    if (!state.recording) return;
    state.recording = false;
    if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
    chunks = [];
    cleanup();
    lg('info', '录音被取消');
  }

  /* ---------- 音频处理 ---------- */

  function mergeChunks(list) {
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i].length;
    var out = new Float32Array(total);
    var off = 0;
    for (var j = 0; j < list.length; j++) { out.set(list[j], off); off += list[j].length; }
    return out;
  }

  /* 线性插值重采样到 16k。
     为什么不用 OfflineAudioContext：它对 48k→16k 的空值处理依赖浏览器实现，
     而且异步流程会让「按住松手到发请求」多一跳。线性插值对语音识别足够。
     为什么不做低通滤波：16k 目标、源多为 48k（3:1 整数倍）时简单平均即可；
     若源是 44.1k，线性插值的混叠对 ASR 影响很小（实测识别正确）。 */
  function resampleTo16k(input, srcRate) {
    if (!srcRate || srcRate === TARGET_RATE) return input;
    var ratio = srcRate / TARGET_RATE;
    var outLen = Math.floor(input.length / ratio);
    var out = new Float32Array(outLen);
    for (var i = 0; i < outLen; i++) {
      var pos = i * ratio;
      var i0 = Math.floor(pos);
      var i1 = Math.min(i0 + 1, input.length - 1);
      var frac = pos - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    return out;
  }

  /* 16bit 单声道 WAV。手写头部而不是引库：42 行，无依赖。 */
  function encodeWav(samples, rate) {
    var buf = new ArrayBuffer(44 + samples.length * 2);
    var view = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);          // fmt 块大小
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // 单声道
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);    // 字节率
    view.setUint16(32, 2, true);           // 块对齐
    view.setUint16(34, 16, true);          // 位深
    str(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    var off = 44;
    for (var i = 0; i < samples.length; i++) {
      var v = Math.max(-1, Math.min(1, samples[i]));
      // 负半区用 32768、正半区用 32767，避免溢出
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
    return buf;
  }

  /* ---------- 资源清理 ---------- */
  function cleanupKeepCtx() {
    try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } } catch (e) { /* ignore */ }
    try { if (source) source.disconnect(); } catch (e) { /* ignore */ }
    try {
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) { /* ignore */ }
    proc = null; source = null; stream = null;
  }

  function teardownCtx() {
    try { if (ctx && ctx.state !== 'closed') ctx.close(); } catch (e) { /* ignore */ }
    ctx = null;
  }

  function cleanup() {
    cleanupKeepCtx();
    teardownCtx();
  }

  global.ASR = {
    detect: detect,
    start: start,
    stop: stop,
    cancel: cancel,
    state: state,
    stats: stats,
    config: { TARGET_RATE: TARGET_RATE, MIN_MS: MIN_MS, MAX_MS: MAX_MS, ENDPOINT: ENDPOINT },
    // 供自测直接验证编码正确性（不必真开麦克风）
    _internals: {
      resampleTo16k: resampleTo16k,
      encodeWav: encodeWav,
      mergeChunks: mergeChunks,
      isLocalHost: isLocalHost
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
