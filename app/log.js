/* =========================================================
   应急助手 · 日志底座（M0）
   依据：用户要求「各个模块都有代码运行日志」，2026-11-19 裁决：
     ① 去向 = 日志文件 + 控制台
     ② 默认级别 = WARN 以上
     ③ 要 traceId 串起一次提问的全链路

   三个必须守住的约束（每条都有断言）：
     A. **不许泄露密钥**。日志字段与 msg 都过一遍脱敏；代理侧收到也再脱一次，
        不信前端自觉（docs/01 §8 密钥红线）。
     B. **日志不能改变产品行为**。任何内部异常一律吞掉——日志挂了不能白屏。
     C. **提问原文只记前 40 字**。它是老人说的话，本地文件可留但不许全文堆积。

   为什么前端自己写不了文件：浏览器 JS 无文件写权限。所以落盘靠本地代理
   的 POST /log（tools/llm_proxy.mjs）。代理没起 / 将来打包 APK 时，
   自动退化为「控制台 + 内存环形缓冲」，功能不受影响。
   ========================================================= */
(function (global) {
  'use strict';

  /* 真实全局。浏览器里就是 window；但被塞进 vm 沙箱时，window 只是沙箱里的
     一个普通对象，setInterval / fetch 挂在沙箱顶层。所以要单独取一份。 */
  var G = (typeof globalThis !== 'undefined' && globalThis) ? globalThis : global;

  var LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

  var cfg = {
    // 默认只出 warn 以上（用户裁决）。?log=debug 或 ?log=info 可临时放开。
    level: 'warn',
    // 落盘端点。代理没起时 POST 会失败，静默降级到内存+控制台。
    endpoint: 'http://127.0.0.1:8787/log',
    // 环形缓冲容量：够还原「刚才发生了什么」，又不至于占内存
    bufferSize: 500,
    // 批量发送：每 20 条或每 2 秒 flush 一次，避免一次提问打 15 个请求
    flushEvery: 20,
    flushMs: 2000,
    console: true,
    remote: true,
    // 提问原文截断长度
    textMax: 40
  };

  /* ---------- 状态 ---------- */
  var buffer = [];          // 环形缓冲（最近的日志，供界面/自测读取）
  var pending = [];         // 待发送
  var dropped = 0;          // 因缓冲满被丢弃的条数（自身也要可观察）
  var selfErrors = { flushFail: 0, sendFail: 0, noTransport: 0, lastError: null };
  var traceSeq = 0;
  var current = null;       // 当前 traceId

  /* ---------- 脱敏 ----------
     不依赖「前端记得别记 key」。凡是长得像密钥的一律替换。
     规则保守：宁可多脱，不可漏脱。 */
  var SECRET_PATTERNS = [
    /sk-[A-Za-z0-9_\-]{8,}/g,                    // deepseek / openai 风格
    /Bearer\s+[A-Za-z0-9_\-\.]{8,}/gi,
    /(['"]?(?:api[_-]?key|apikey|secret|token|password)['"]?\s*[:=]\s*['"]?)[^\s'",}]{6,}/gi
  ];

  function scrubString(s) {
    var out = String(s == null ? '' : s);
    for (var i = 0; i < SECRET_PATTERNS.length; i++) {
      out = out.replace(SECRET_PATTERNS[i], function (m, p1) {
        /* 带字段名（有捕获组）→ 保留字段名只换值；否则整体替换。
           ⚠️ 必须判类型：无捕获组时 p1 收到的是**偏移量数字**，
           直接拼接会把偏移量写进日志（实测：sk-xxx 变成 "92***"）。 */
        if (typeof p1 === 'string' && p1) return p1 + '***';
        return '***';
      });
    }
    return out;
  }

  function scrub(obj, depth) {
    var d = depth || 0;
    if (d > 4) return '[deep]';
    if (obj == null) return obj;
    if (typeof obj === 'string') return scrubString(obj);
    if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
    if (typeof obj === 'function') return '[fn]';
    if (Object.prototype.toString.call(obj) === '[object Array]') {
      return obj.slice(0, 50).map(function (x) { return scrub(x, d + 1); });
    }
    if (typeof obj === 'object') {
      var out = {};
      var keys = Object.keys(obj).slice(0, 40);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        // 字段名本身像密钥的，整条值替掉（防 key 藏在名字里）
        if (/^(api[_-]?key|apikey|secret|token|password|authorization)$/i.test(k)) {
          out[k] = '***';
        } else {
          out[k] = scrub(obj[k], d + 1);
        }
      }
      return out;
    }
    return String(obj);
  }

  /* ---------- 级别 ---------- */
  function levelOf() {
    try {
      var q = global.location && global.location.search;
      if (q) {
        var m = /[?&]log=([a-z]+)/i.exec(q);
        if (m && LEVELS[m[1].toLowerCase()]) return m[1].toLowerCase();
      }
    } catch (e) { /* ignore */ }
    return cfg.level;
  }

  function should(level) {
    return (LEVELS[level] || 20) >= (LEVELS[levelOf()] || 30);
  }

  /* ---------- 「每模块一条」例外 ----------
     默认级别是 WARN+，那正常提问一行都不会落盘——「各模块都有日志」
     就成了空话。所以留一个受控例外：每次提问，每个模块**只写 1 行摘要**，
     绕过级别筛选（force），细节行（逐条得分、候选列表）仍要 ?log=debug。

     为什么不用「把默认改成 info」：一次提问的细节有十几行，全落盘会淹没问题。
     摘要行的定位是「知道发生过、结果是什么」，细节留给排查时按 trace 打开。 */
  function always(module, msg, fields) {
    return emitRaw('info', module, msg, fields, true);
  }

  /* ---------- trace ---------- */
  function newTrace(prefix) {
    traceSeq++;
    var t = (prefix || 'q') + '-' + Date.now().toString(36) + '-' + traceSeq;
    return t;
  }

  function setTrace(t) { current = t; return current; }
  function getTrace() { return current; }

  /* ---------- 核心 ----------
     force=true 绕过级别筛选（只给 always 用），其余行为完全一致。 */
  function emit(level, module, msg, fields) {
    return emitRaw(level, module, msg, fields, false);
  }

  function emitRaw(level, module, msg, fields, force) {
    try {
      if (!force && !should(level)) return null;
      var rec = {
        ts: new Date().toISOString(),
        level: level,
        module: module,
        trace: current || null,
        msg: scrubString(msg),
        ms: (fields && typeof fields.ms === 'number') ? fields.ms : null
      };
      if (fields) {
        var f = scrub(fields);
        // ms 已提到顶层，字段里不重复
        if (f && typeof f === 'object' && 'ms' in f) delete f.ms;
        // 其余字段平铺，方便 grep；与固定字段同名的丢掉避免覆盖
        for (var k in f) {
          if (!Object.prototype.hasOwnProperty.call(f, k)) continue;
          if (k === 'ts' || k === 'level' || k === 'module' || k === 'trace' || k === 'msg') continue;
          rec[k] = f[k];
        }
      }

      // 环形缓冲
      buffer.push(rec);
      if (buffer.length > cfg.bufferSize) {
        buffer.shift();
        dropped++;
      }

      // 控制台
      if (cfg.console && global.console) {
        var line = '[' + rec.module + '] ' + rec.msg +
          (rec.trace ? ' {trace:' + rec.trace + '}' : '');
        var fn = global.console[level === 'debug' ? 'log' : level] || global.console.log;
        try { fn.call(global.console, line); } catch (e) { /* ignore */ }
      }

      // 待发送（落盘）
      if (cfg.remote) {
        pending.push(rec);
        if (pending.length >= cfg.flushEvery) flush();
      }
      return rec;
    } catch (e) {
      // 约束 B：日志自身出错不许影响产品
      selfErrors.lastError = String((e && e.message) || e);
      return null;
    }
  }

  /* ---------- 落盘 ----------
     优先 sendBeacon（页面关闭时也能送出去），否则 fetch(keepalive)。
     失败只记计数，不重试、不弹出提示——日志不该干扰用户。

     ⚠️ 取 fetch 时要同时看 globalThis：本文件可能被挂到 window，
        而某些宿主（自测沙箱、旧 WebView）只在顶层有 fetch。
        2026-11-19 实测踩过：只看 global.fetch 时日志被静默丢光，
        且 sendFail 仍是 0——「丢得无声无息」是最难查的一类问题。 */
  function netFetch() {
    if (typeof global.fetch === 'function') return global.fetch;
    if (G && G !== global && typeof G.fetch === 'function') {
      return function (u, o) { return G.fetch(u, o); };
    }
    return null;
  }

  function flush() {
    if (!cfg.remote || !pending.length) return Promise.resolve(0);
    var batch = pending.splice(0, pending.length);
    var body;
    try { body = JSON.stringify({ records: batch }); } catch (e) {
      selfErrors.flushFail++;
      selfErrors.lastError = 'stringify: ' + String((e && e.message) || e);
      return Promise.resolve(0);
    }

    function done(ok, err) {
      if (!ok) {
        selfErrors.sendFail++;
        selfErrors.lastError = String(err || 'send-failed');
      }
    }

    try {
      /* 优先 fetch 而不是 sendBeacon：
         sendBeacon 对 application/json 会触发 CORS 预检，被拦时**仍然返回 true**，
         于是「发成功」与「被拦」在计数上无法区分（假成功）。
         fetch 能拿到真实 HTTP 状态，失败可计数。sendBeacon 只当兜底。 */
      var f = netFetch();
      if (f) {
        return f(cfg.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true
        }).then(function (r) {
          done(r && r.ok, r && !r.ok ? 'http-' + r.status : null);
          return r && r.ok ? batch.length : 0;
        }).catch(function (e) {
          done(false, (e && e.message) || 'fetch-failed');
          return 0;
        });
      }
      if (global.navigator && typeof global.navigator.sendBeacon === 'function') {
        var blob = (typeof Blob === 'function') ? new Blob([body], { type: 'application/json' }) : body;
        var ok = global.navigator.sendBeacon(cfg.endpoint, blob);
        done(!!ok, ok ? null : 'beacon-rejected');
        return Promise.resolve(ok ? batch.length : 0);
      }
      /* 两条路都没有：**必须计数**，不能当成功。
         静默丢弃会让「日志里没有」和「没发生过」混为一谈。 */
      selfErrors.noTransport++;
      selfErrors.lastError = 'no-transport';
      return Promise.resolve(0);
    } catch (e) {
      selfErrors.flushFail++;
      selfErrors.lastError = String((e && e.message) || e);
      return Promise.resolve(0);
    }
  }

  /* ---------- 定时 flush ---------- */
  try {
    var si = (typeof global.setInterval === 'function') ? global.setInterval
      : (G && typeof G.setInterval === 'function' ? G.setInterval : null);
    if (si) si.call(global, function () { try { flush(); } catch (e) { /* ignore */ } }, cfg.flushMs);
  } catch (e) { /* ignore */ }

  /* ---------- 页面关闭时兜底 flush ----------
     没有这层，老人用完直接关页面，缓冲区里最后几条（往往正是出问题的那几条）
     就永远丢在内存里。visibilitychange 比 beforeunload 更可靠
     （移动端切后台不一定触发 unload）。 */
  try {
    if (global.addEventListener) {
      global.addEventListener('pagehide', function () { try { flush(); } catch (e) { /* ignore */ } });
      if (global.document && global.document.addEventListener) {
        global.document.addEventListener('visibilitychange', function () {
          try { if (global.document.visibilityState === 'hidden') flush(); } catch (e) { /* ignore */ }
        });
      }
    }
  } catch (e) { /* ignore */ }

  /* ---------- 提问原文截断 ---------- */
  function clipText(s) {
    var t = String(s == null ? '' : s);
    return t.length > cfg.textMax ? t.slice(0, cfg.textMax) + '…(' + t.length + '字)' : t;
  }

  /* ---------- 对外 ---------- */
  function tag(module) {
    return {
      debug: function (msg, f) { return emit('debug', module, msg, f); },
      info: function (msg, f) { return emit('info', module, msg, f); },
      warn: function (msg, f) { return emit('warn', module, msg, f); },
      error: function (msg, f) { return emit('error', module, msg, f); }
    };
  }

  global.LOG = {
    tag: tag,
    emit: emit,
    always: always,
    flush: flush,
    newTrace: newTrace,
    setTrace: setTrace,
    getTrace: getTrace,
    clipText: clipText,
    scrub: scrub,
    scrubString: scrubString,
    config: cfg,
    // 供自测与界面读取
    buffer: buffer,
    pending: pending,
    stats: function () {
      return {
        level: levelOf(),
        buffered: buffer.length,
        dropped: dropped,
        pending: pending.length,
        flushFail: selfErrors.flushFail,
        sendFail: selfErrors.sendFail,
        noTransport: selfErrors.noTransport,
        lastError: selfErrors.lastError
      };
    },
    reset: function () {
      buffer.length = 0; pending.length = 0; dropped = 0;
      selfErrors.flushFail = 0; selfErrors.sendFail = 0; selfErrors.noTransport = 0; selfErrors.lastError = null;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
