/* =========================================================
   应急助手 · 语音输出（TTS）
   依据：docs/01 §2.1「语音播报是主输出通道，文字只是备份（M2 起生效）」
        docs/01 §6.2「不允许静默失败」——不可用必须明确告知

   M2 的定位（01 §158）：TTS 朗读属于 M2；但**离线原生 TTS 仍属 M3**。
   所以本文件按「三层实现，自动选最好的一层」设计：

     ① tauri  —— Tauri 打包后走 tauri-plugin-tts（Windows SAPI / Android 原生
                 TextToSpeech）。需要 npm install tauri-plugin-tts-api 且在 Tauri 内运行。
     ② web    —— 桌面浏览器的 window.speechSynthesis。
                 实测（2026-11-18，小米 Android 16）：Android 手机浏览器
                 **没有 speechSynthesis**（docs/03 §2.4 事实 4）。所以 web 层只对
                 桌面可靠；Android 的语音输出只剩 ① tauri 插件一条路（M3 打包后验），
                 Android 浏览器上自动落到 ③ none（文字 + 明确提示）。
     ③ none   —— 都没有。此时 mustNotFailSilently()：界面必须显示提示，不能装作说了。

   三条设计约束：
     A. 朗读文本只能来自条目字段（S1：不许编）。本文件不做任何改写、不总结、不加词。
     B. 语音开关状态要持久化（localStorage），老人不用每次重新打开。
     C. 语速默认 0.9 —— 老人听不清快语速。可调但默认偏慢。
   ========================================================= */
(function (global) {
  'use strict';

  /* 运行日志（M0 = app/log.js）。可选依赖：没加载就全部 no-op。
     ⚠️ 语音层的日志不是「锦上添花」：朗读失败是**静默**的（自动读失败不提示），
        所以「没听见」无法从界面区分「没触发」和「被浏览器拦了」。
        只有日志能回答。这也是 2026-11-18 那次 bug 的教训。 */
  var LOG = global.LOG || null;
  function lg(level, msg, fields) {
    if (!LOG) return;
    var t = LOG.tag('voice');
    if (t[level]) t[level](msg, fields);
  }

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

  /* ---------- 引擎注册表（2026-11-19 provider 化，docs/11 选项 A） ----------

     改之前的样子：`detect()` 里一个 `if (isTauri())`，`speak()` 一个三元表达式，
     `stop()` 一个 if/else —— 引擎判定散在三处，加第三个引擎（云 TTS）要同时改三个地方。

     现在：**探测顺序、朗读、停止都由下面两张表驱动**。
     加新引擎 = 在 PROBES 与 ENGINES 各加一行 + 写它的 probe/speak/stop，不改这三个函数。

     两条刻意保留的约束（不要「优化」掉）：
       ① **顺序必须是 tauri → web → none**。`01` §2.1 定的：原生引擎音质与稳定性最好。
       ② **不跨文件拆目录**。M3 打包时 frontendDist 就是 app/，file:// 直开不能有构建步骤，
          拆目录只会增加路径管理的失败面。所以注册表就放在本文件里。 */

  /* 探测链：按顺序试，第一个成功的就是当前引擎 */
  var PROBES = [
    { id: 'tauri', label: 'Tauri 原生 TTS', probe: probeTauri },
    { id: 'web', label: '浏览器 speechSynthesis', probe: probeWeb }
  ];

  /* 朗读与停止的实现表。key 与 PROBES 的 id 必须一致。 */
  var ENGINES = {
    tauri: { id: 'tauri', label: 'Tauri 原生 TTS', speak: speakTauri, stop: stopTauri },
    web: { id: 'web', label: '浏览器 speechSynthesis', speak: speakWeb, stop: stopWeb }
  };

  function activeEngine() {
    return ENGINES[state.engine] || null;
  }

  /* 探测可用引擎。异步，因为 Tauri 插件需要动态 import。 */
  function detect() {
    var i = 0;

    function tryNext() {
      if (i >= PROBES.length) return Promise.resolve(detectNone());
      var p = PROBES[i++];
      return Promise.resolve()
        .then(function () { return p.probe(); })
        .then(function (ok) {
          if (!ok) {
            lg('info', p.label + ' 不可用，试下一个');
            return tryNext();
          }
          return activate(p.id);
        })
        .catch(function (e) {
          lg('warn', p.label + ' 探测异常，试下一个', { error: String((e && e.message) || e) });
          return tryNext();
        });
    }

    return tryNext();
  }

  /* 把某个引擎设为当前引擎，并做它需要的初始化 */
  function activate(id) {
    if (id === 'web') return activateWeb();
    state.engine = id;
    state.supported = true;
    state.unavailableReason = null;
    if (LOG && LOG.always) LOG.always('voice', '探测成功：' + id, { engine: id });
    return state;
  }

  /* 全都不行：这条分支以前藏在 detectWeb 里，现在单独一个函数，
     因为「没有引擎」和「浏览器不支持」是两件事，日志要能区分。 */
  function detectNone() {
    state.engine = 'none';
    state.supported = false;
    state.unavailableReason = state.unavailableReason || '这台设备的浏览器不支持语音朗读';
    return state;
  }

  /* 浏览器层探测：只回答「环境有没有这个 API」，不做副作用。
     失败时**强制落盘**——这是「设备没声音」的根因，必看（`01` §6.2 不许静默失败）。 */
  function probeWeb() {
    var ss = global.speechSynthesis;
    var hasUtt = typeof global.SpeechSynthesisUtterance === 'function';
    if (!ss || !hasUtt) {
      if (LOG && LOG.always) {
        LOG.always('voice', '探测失败：环境无 speechSynthesis', {
          hasSynth: !!ss, hasUtterance: hasUtt, tauri: isTauri()
        });
      }
      return false;
    }
    return true;
  }

  /* Tauri 层探测：不在 Tauri 环境里直接 false，不打日志（否则普通浏览器会刷一条无意义的 info） */
  function probeTauri() {
    if (!isTauri()) return Promise.resolve(false);
    return detectTauriPlugin();
  }

  function detectTauriPlugin() {
    /* 插件是可选依赖：没装 npm 包就视为不可用，不报错。
       用 import() 而不是静态 import，避免打包时强制要求它存在。 */
    if (typeof global.__TTsProbe === 'function') return Promise.resolve(global.__TTsProbe());
    return Promise.resolve(false);
  }

  /* 激活浏览器层：设状态 + 挑音色 + 监听音色异步填充 */
  function activateWeb() {
    var ss = global.speechSynthesis;
    state.engine = 'web';
    state.supported = true;
    state.unavailableReason = null;
    // 音色列表可能异步填充（Chrome 首次为空）
    pickVoice();
    if (ss && ss.addEventListener) ss.addEventListener('voiceschanged', pickVoice);
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
      if (LOG && LOG.always) {
        LOG.always('voice', '探测失败：无中文音色', {
          voiceCount: voices.length,
          langs: voices.slice(0, 5).map(function (v) { return v.lang; })
        });
      }
      return;
    }
    state.voiceName = chosen.name;
    state.unavailableReason = null;
    if (LOG && LOG.always) {
      LOG.always('voice', '探测成功', {
        engine: state.engine, voice: chosen.name, lang: chosen.lang, rate: state.rate
      });
    }
  }

  /* ---------- 朗读 ---------- */

  /* S5 要求的固定安全句（2026-11-19 修复 K1）。
     `01` §8 S5 原文：「生命危险场景：给关键步骤 + **播报含「同时拨打 120」** + 显式拨号按钮，
     判据：命中 life_threatening: true 的条目，播报文本须含该句，**缺一即失败**」。

     修复前实测：6 条 life_threatening 条目里 **0/6** 的朗读稿含任何「拨打」字样——
     因为朗读稿只拼条目字段（S1 不许改写），而 9 条知识库没有任何一条的 steps 写了「拨打」。
     后果：只听不看的老人，播报里不知道要同时打电话。这是安全问题，不是文案问题。

     号码取条目的 emergency_number，**不是硬写 120**：
       燃气/火灾/地震的正确号码是 119，中毒/触电/气道梗阻是 120。
       统一念 120 会让消防场景拨错号。用户 2026-11-19 裁决取本条号码。

     为什么加在播报层而不是改知识库：
       这是「怎么说」不是「说什么」——念一句「同时拨打 119」不新增任何操作指导，
       不违反 S1。改知识库则要重过源文逐字比对，且源站未必写了这句。 */
  function composeEmergencyCallSentence(entry) {
    if (!entry || !entry.life_threatening) return '';
    var num = String(entry.emergency_number || '').trim();
    if (!num) return '';
    return '同时拨打' + num + '。';
  }

  /* 把步骤卡拼成朗读稿。**只做拼接，不改写任何文字**（S1）。
     读法上做四件事，都属于「怎么读」而非「读什么」：
       - 段落标题念出来（"立刻做"），让听的人知道换段了
       - 步骤之间加停顿（用句号），避免连成一串听不清
       - 禁忌段前缀「绝对不要」，因为只念"不要开灯"容易漏掉"不要"
       - 生命危险条目末尾加「同时拨打 N」（S5，见上） */
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
      arr.forEach(function (s) {
        var t = String((s && s.text) || '').trim();
        if (!t) return;
        parts.push(t + '。');
      });
    });

    /* S5：放在「绝对不要做」之后。
       为什么不在开头：老人最先要听的是「立刻做什么」，先念号码会把最急的动作往后推。
       为什么不在中间：会打断步骤的连贯性。 */
    var call = composeEmergencyCallSentence(entry);
    if (call) parts.push(call);

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

  /* 「只读一句」的稿子：名称 + 摘要。
     为什么不直接复用 composeDailyScript：那份含 why，念完约 20 秒。
     老人问一句日常问题（"怎么预防煤气泄漏"）只想听结论，
     念长了第一反应是按停止——那就等于没读。
     全文仍留给手动「朗读一遍」。（2026-11-18 用户裁决：只自动读名称+摘要） */
  function composeDailyBriefScript(entry) {
    if (!entry || !entry.daily) return '';
    var parts = [];
    if (entry.name) parts.push(entry.name + '。');
    if (entry.daily.summary) parts.push(entry.daily.summary);
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
    /* S5 同样适用：分诊卡是 gas_leak / earthquake / fall_elderly 的**首屏**，
       此时老人还没听到任何步骤，更需要在最后听到「同时拨打 N」。
       位置放在选项之后：先听清「你在哪儿」（选项），再听「要打电话」——
       顺序反了会让人以为不用回答分诊问题、直接打电话。 */
    var call = composeEmergencyCallSentence(entry);
    if (call) parts.push(call);
    return parts.join('');
  }

  /* 主入口：读一段文本 */
  function speak(text, opts) {
    var o = opts || {};
    var t = String(text || '').trim();
    if (!t) {
      lg('debug', '朗读跳过：空文本');
      return Promise.resolve({ ok: false, reason: 'empty' });
    }
    if (!state.supported) {
      lg('warn', '朗读未执行：设备不支持', { reason: state.unavailableReason });
      return Promise.resolve({ ok: false, reason: 'unsupported', message: state.unavailableReason });
    }
    if (!state.enabled && !o.force) {
      lg('info', '朗读跳过：用户关掉了语音开关');
      return Promise.resolve({ ok: false, reason: 'disabled' });
    }

    stats.speaks++;
    var t0 = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    /* 摘要行 always：记「念了什么」的开头 20 字 + 长度。
       为什么不全记：朗读稿最长 300+ 字，全文堆积没有排查价值；
       但开头 20 字足够判断「读的是哪张卡的哪一段」。 */
    if (LOG && LOG.always) {
      LOG.always('voice', '开始朗读', {
        engine: state.engine,
        chars: t.length,
        head: t.slice(0, 20),
        force: !!o.force,
        rate: o.rate || state.rate
      });
    }
    /* 查表分发。以前是 `engine === 'tauri' ? speakTauri : speakWeb` 的三元表达式，
       加第三个引擎就要改这一行；现在只在 ENGINES 里加一行。 */
    var eng = activeEngine();
    var p = eng
      ? eng.speak(t, o)
      : Promise.resolve({ ok: false, reason: 'no-engine', message: state.unavailableReason });
    return p.then(function (r) {
      var ms = t0 ? (Date.now() - t0) : null;
      if (r && r.ok) {
        lg('debug', '朗读完成', { ms: ms, engine: r.engine });
      } else if (r && r.reason === 'cancelled') {
        lg('debug', '朗读被取消', { ms: ms });
      } else {
        // 真失败：必须 warn 落盘（自动读时界面上不提示，只有这里有痕迹）
        lg('warn', '朗读失败', { ms: ms, reason: (r && r.reason) || 'unknown', message: (r && r.message) || null });
      }
      return r;
    });
  }

  function speakTauri(text, o) {
    /* 真实实现由宿主通过 setTauriAdapter(speakFn, stopFn) 注入到 global.__TTsSpeak。
       本函数只做「有就用、没有就报告」的包装，不假装成功。

       ⚠️ 2026-11-19 修正：原文写「见 index.html 末尾的适配片段」——那个片段不存在
       （`grep -n "__TTs\|tauri" app/index.html` 零匹配）。注释指向不存在的代码，
       下一个人会白找一遍。真实注入点只有 setTauriAdapter，M3 打包时由宿主调用。 */
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
    var eng = activeEngine();
    try {
      if (eng && eng.stop) {
        eng.stop();
      } else if (global.speechSynthesis) {
        /* 兜底：没有当前引擎时（engine='none'）也可能有一个残留的合成器，
           取消一次不会有害——比「按了停止却还在念」好。 */
        global.speechSynthesis.cancel();
      }
    } catch (e) { /* 忽略 */ }
    state.speaking = false;
    stats.cancelled++;
    lg('info', '用户停止朗读');
  }

  /* 两个引擎各自的停止实现（以前它们内联在 stop() 里） */
  function stopTauri() {
    if (typeof global.__TTsStop === 'function') global.__TTsStop();
  }

  function stopWeb() {
    if (global.speechSynthesis) global.speechSynthesis.cancel();
  }

  function setEnabled(v) {
    state.enabled = !!v;
    savePref();
    if (!state.enabled) stop();
    lg('info', '语音开关变更', { enabled: state.enabled });
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
    composeDailyBriefScript: composeDailyBriefScript,
    composeTriageScript: composeTriageScript,
    composeEmergencyCallSentence: composeEmergencyCallSentence,
    state: state,
    stats: stats,
    /* 宿主注入原生 TTS 实现的唯一入口（M3 由打包层调用）。
       接口表，供断言与排查用 —— 改引擎不该只能靠读源码。 */
    engines: function () {
      return PROBES.map(function (p) { return p.id; });
    },
    activeEngine: function () { return state.engine; },
    setTauriAdapter: function (speakFn, stopFn) {
      if (typeof speakFn !== 'function') return;
      global.__TTsSpeak = speakFn;
      if (typeof stopFn === 'function') global.__TTsStop = stopFn;

      /* ⚠️ 2026-11-19 修的真 bug（docs/11 §2.3 缺陷 1）：
         detect() 判 tauri 可用性时读的是 __TTsProbe，而本函数以前只写 __TTsSpeak。
         全仓 grep：__TTsProbe 有 1 处读、0 处写。
         后果：宿主注入成功，detect() 仍判不出 tauri → engine 停在 'web'
         → speakTauri 永远不会被调用。而 Android 浏览器没有 speechSynthesis
         → 最终落地 engine='none'，老人没有声音。

         为什么「导出一个探针函数」而不是改成读 __TTsSpeak：
           保持 detectTauriPlugin 的语义（问「引擎可用吗」），不改调用方签名；
           宿主若自带更精细的 __TTsProbe（比如真的去查语言包），不覆盖它。 */
      if (typeof global.__TTsProbe !== 'function') {
        global.__TTsProbe = function () { return true; };
      }

      /* 注入可能在 detect() 之后发生（页面加载顺序不定）。
         此时 engine 已被定成 web/none，只写探针也不够——要重新探测一次。
         只在「当前不是 tauri」时重探，避免已有正确状态被推翻。 */
      if (state.engine !== 'tauri') {
        lg('info', '注入 Tauri 适配器，重新探测引擎', { before: state.engine });
        detect();
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
