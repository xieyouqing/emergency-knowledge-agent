/* =========================================================
   应急助手 · 语音输出（TTS）
   依据：docs/01 §2.1「语音播报是主输出通道，文字只是备份（M2 起生效）」
        docs/01 §6.2「不允许静默失败」——不可用必须明确告知

   M2 的定位（01 §158）：TTS 朗读属于 M2；但**离线原生 TTS 仍属 M3**。
   所以本文件按「三层实现，自动选最好的一层」设计：

     ① tauri  —— Tauri 打包后走 tauri-plugin-tts（Windows SAPI / Android 原生
                 TextToSpeech）。需要 npm install tauri-plugin-tts-api 且在 Tauri 内运行。
     ② web    —— 浏览器 / Android WebView 的 window.speechSynthesis。
                 实测确认：Android WebView **支持 speechSynthesis**（不支持的是
                 SpeechRecognition，见 docs/03 §2.4）。所以网页版和 APK 都能用。
     ③ none   —— 都没有。此时 mustNotFailSilently()：界面必须显示提示，不能装作说了。

   三条设计约束：
     A. 朗读文本只能来自条目字段（S1：不许编）。本文件不做任何改写、不总结、不加词。
     B. 语音开关状态要持久化（localStorage），老人不用每次重新打开。
     C. 语速默认 0.9 —— 老人听不清快语速。可调但默认偏慢。
   ========================================================= */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'emergency-tts-pref';

  /* ---------- 状态 ---------- */
  var state = {
    engine: 'none',       // 'tauri' | 'web' | 'none'
    supported: false,
    enabled: true,        // 用户是否想听（持久化）
    speaking: false,
    rate: 0.9,            // 默认偏慢，老人友好
    lang: 'zh-CN',
    voiceName: null,      // 实际选中的音色名，供诊断显示
    lastError: null,
    // 不可用原因（给界面提示用，必须是用户能看懂的话）
    unavailableReason: null
  };

  var stats = { speaks: 0, completes: 0, errors: 0, cancelled: 0 };

  function loadPref() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (typeof p.enabled === 'boolean') state.enabled = p.enabled;
      if (typeof p.rate === 'number' && p.rate >= 0.5 && p.rate <= 2) state.rate = p.rate;
    } catch (e) { /* localStorage 不可用就忽略，不影响功能 */ }
  }

  function savePref() {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          enabled: state.enabled, rate: state.rate
        }));
      }
    } catch (e) { /* 同上 */ }
  }

  /* ---------- 引擎探测 ---------- */

  /* Tauri 环境判定：Tauri 2 会注入 __TAURI_INTERNALS__。
     注意不要用 window.__TAURI__（那是 withGlobalTauri 才有的可选注入）。 */
  function isTauri() {
    return !!(global.__TAURI_INTERNALS__ || global.__TAURI__);
  }

  /* 探测可用引擎。异步，因为 Tauri 插件需要动态 import。 */
  function detect() {
    // ① Tauri 插件优先（原生引擎，音质与稳定性最好）
    if (isTauri()) {
      return detectTauriPlugin().then(function (ok) {
        if (ok) {
          state.engine = 'tauri';
          state.supported = true;
          state.unavailableReason = null;
          return state;
        }
        return detectWeb();
      }).catch(function () { return detectWeb(); });
    }
    return Promise.resolve(detectWeb());
  }

  function detectTauriPlugin() {
    /* 插件是可选依赖：没装 npm 包就视为不可用，不报错。
       用 import() 而不是静态 import，避免打包时强制要求它存在。 */
    if (typeof global.__TTsProbe === 'function') return Promise.resolve(global.__TTsProbe());
    return Promise.resolve(false);
  }

  function detectWeb() {
    var ss = global.speechSynthesis;
    if (!ss || typeof global.SpeechSynthesisUtterance !== 'function') {
      state.engine = 'none';
      state.supported = false;
      state.unavailableReason = '这台设备的浏览器不支持语音朗读';
      return state;
    }
    state.engine = 'web';
    state.supported = true;
    state.unavailableReason = null;
    // 音色列表可能异步填充（Chrome 首次为空）
    pickVoice();
    if (ss.addEventListener) ss.addEventListener('voiceschanged', pickVoice);
    return state;
  }

  function pickVoice() {
    var ss = global.speechSynthesis;
    if (!ss || !ss.getVoices) return;
    var voices = ss.getVoices() || [];
    if (!voices.length) return;
    var zh = voices.filter(function (v) {
      return /^zh(-|_)?/i.test(v.lang || '') || /Chinese|中文|普通话/i.test(v.name || '');
    });
    // 优先女声（01 §4.3 对 Windows 的要求是默认 Huihui，这里取同类偏好）
    var preferFemale = zh.filter(function (v) {
      return /female|huihui|yaoyao|xiaoxiao|女/i.test(v.name || '');
    });
    var chosen = preferFemale[0] || zh[0] || null;
    /* 关键：没有中文音色 = 说出来是英文腔或乱读。
       这不报错，但等于「不可用」，必须让界面知道（06 §6.2 不许静默失败）。 */
    if (!chosen) {
      state.supported = false;
      state.unavailableReason = '这台设备没有装中文语音包，朗读会读成外文';
      return;
    }
    state.voiceName = chosen.name;
  }

  /* ---------- 朗读 ---------- */

  /* 把步骤卡拼成朗读稿。**只做拼接，不改写任何文字**（S1）。
     读法上做三件事，都属于「怎么读」而非「读什么」：
       - 段落标题念出来（"立刻做"），让听的人知道换段了
       - 步骤之间加停顿（用句号），避免连成一串听不清
       - 禁忌段前缀「绝对不要」，因为只念"不要开灯"容易漏掉"不要" */
  function composeStepsScript(entry, immediateOverride) {
    if (!entry || !entry.steps) return '';
    var parts = [];
    if (entry.name) parts.push(entry.name + '。');

    var segs = [
      { key: 'immediate', title: '立刻做', data: immediateOverride || entry.steps.immediate },
      { key: 'next', title: '接着做', data: entry.steps.next },
      { key: 'never', title: '绝对不要做', data: entry.steps.never }
    ];

    segs.forEach(function (seg) {
      var arr = seg.data || [];
      if (!arr.length) return;
      parts.push(seg.title + '。');
      arr.forEach(function (s, i) {
        var t = String((s && s.text) || '').trim();
        if (!t) return;
        parts.push(t + '。');
      });
    });
    return parts.join('');
  }

  function composeDailyScript(entry) {
    if (!entry || !entry.daily) return '';
    var d = entry.daily;
    var parts = [];
    if (entry.name) parts.push(entry.name + '。');
    if (d.summary) parts.push(d.summary);
    if (d.why) parts.push(d.why);
    return parts.join('');
  }

  /* 分诊卡阶段还没有步骤，只能把问题和选项念出来。
     为什么必须念选项：老人看不清屏幕时，「你现在在哪儿」之后如果听不到
     「在室内 / 在室外 / 被埋或被困」，就无从选择，等于卡死在这里。 */
  function composeTriageScript(entry) {
    if (!entry || !entry.triage) return '';
    var parts = [];
    if (entry.name) parts.push(entry.name + '。');
    if (entry.triage.question) parts.push(entry.triage.question);
    (entry.triage.options || []).forEach(function (o, i) {
      var label = String((o && o.label) || '').trim();
      if (label) parts.push('第' + (i + 1) + '个，' + label + '。');
    });
    return parts.join('');
  }

  /* 主入口：读一段文本 */
  function speak(text, opts) {
    var o = opts || {};
    var t = String(text || '').trim();
    if (!t) return Promise.resolve({ ok: false, reason: 'empty' });
    if (!state.supported) {
      return Promise.resolve({ ok: false, reason: 'unsupported', message: state.unavailableReason });
    }
    if (!state.enabled && !o.force) {
      return Promise.resolve({ ok: false, reason: 'disabled' });
    }

    stats.speaks++;
    return state.engine === 'tauri' ? speakTauri(t, o) : speakWeb(t, o);
  }

  function speakTauri(text, o) {
    /* 真实实现由宿主注入（见 index.html 末尾的适配片段）。
       本函数只做「有就用、没有就报告」的包装，不假装成功。 */
    var fn = global.__TTsSpeak;
    if (typeof fn !== 'function') {
      stats.errors++;
      state.lastError = 'tauri-tts-adapter-missing';
      return Promise.resolve({ ok: false, reason: 'adapter-missing' });
    }
    state.speaking = true;
    return Promise.resolve(fn(text, { rate: o.rate || state.rate, lang: o.lang || state.lang }))
      .then(function () { state.speaking = false; stats.completes++; return { ok: true, engine: 'tauri' }; })
      .catch(function (e) {
        state.speaking = false; stats.errors++;
        state.lastError = String((e && e.message) || e);
        return { ok: false, reason: 'error', message: state.lastError };
      });
  }

  function speakWeb(text, o) {
    var ss = global.speechSynthesis;
    var U = global.SpeechSynthesisUtterance;
    return new Promise(function (resolve) {
      try { ss.cancel(); } catch (e) { /* 某些实现 cancel 会抛，忽略 */ }

      var u = new U(text);
      u.lang = o.lang || state.lang;
      u.rate = o.rate || state.rate;
      u.pitch = 1;
      u.volume = 1;
      if (state.voiceName && ss.getVoices) {
        var voices = ss.getVoices() || [];
        for (var i = 0; i < voices.length; i++) {
          if (voices[i].name === state.voiceName) { u.voice = voices[i]; break; }
        }
      }

      var settled = false;
      function done(r) { if (!settled) { settled = true; state.speaking = false; resolve(r); } }

      u.onend = function () { stats.completes++; done({ ok: true, engine: 'web' }); };
      u.onerror = function (ev) {
        // 'interrupted' / 'canceled' 是主动取消，不算错误
        var err = (ev && ev.error) || 'unknown';
        if (err === 'interrupted' || err === 'canceled') { stats.cancelled++; done({ ok: false, reason: 'cancelled' }); return; }
        stats.errors++;
        state.lastError = err;
        done({ ok: false, reason: 'error', message: err });
      };

      state.speaking = true;
      try {
        ss.speak(u);
      } catch (e) {
        state.speaking = false; stats.errors++;
        state.lastError = String((e && e.message) || e);
        done({ ok: false, reason: 'throw', message: state.lastError });
      }
    });
  }

  function stop() {
    try {
      if (state.engine === 'tauri' && typeof global.__TTsStop === 'function') global.__TTsStop();
      else if (global.speechSynthesis) global.speechSynthesis.cancel();
    } catch (e) { /* 忽略 */ }
    state.speaking = false;
    stats.cancelled++;
  }

  function setEnabled(v) {
    state.enabled = !!v;
    savePref();
    if (!state.enabled) stop();
  }

  function setRate(r) {
    var n = Number(r);
    if (n >= 0.5 && n <= 2) { state.rate = n; savePref(); }
  }

  loadPref();

  global.TTS = {
    detect: detect,
    speak: speak,
    stop: stop,
    setEnabled: setEnabled,
    setRate: setRate,
    composeStepsScript: composeStepsScript,
    composeDailyScript: composeDailyScript,
    composeTriageScript: composeTriageScript,
    state: state,
    stats: stats,
    setTauriAdapter: function (speakFn, stopFn) {
      if (typeof speakFn === 'function') global.__TTsSpeak = speakFn;
      if (typeof stopFn === 'function') global.__TTsStop = stopFn;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
