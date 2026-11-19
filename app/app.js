/* =========================================================
   应急助手 · M1 交互逻辑
   数据来源：knowledge.js（由 tools/build_knowledge_js.py 生成，
            只含 status=published 的条目，构建期已过滤，前端不再判断）

   本文件实现的五条已定方案（docs/08-M1-范围与延后项.md）：
     决定1 = 预编译 JS，双击即开
     决定2 = 纯字符串三级匹配（alias > name > keyword 计数），不引入 embedding
             ★ 2026-11-18 起实现迁至 app/retrieval.js（三层引擎统一入口），
               本文件只保留 UI 与路由。默认引擎仍为 l3，行为与 M1 基线一致。
     决定3 = 危险信号用独立关键词常量表，不读条目 keywords
             （未发布场景没有可读的 keywords，靠条目取词会漏判「着火了」）
             ★ 同上，已迁至 retrieval.js
     决定4 = 紧急模式命中但无条目 → 拨号专用卡，不给步骤（不违反 S1）
     决定5 = 日常模式只用 daily 四字段静态拼装，不调 LLM
   ========================================================= */
(function () {
  'use strict';

  var KB = window.KNOWLEDGE || { slots: [], entries: {}, data_date: '' };
  var ENTRIES = KB.entries || {};

  /* ---------- 检索与意图判定：已迁至 app/retrieval.js ----------
     迁移依据（docs/03 §7.1 D-3）：三层引擎必须能被同一份 100 条评测集
     无差别调用，否则「测的」与「用的」是两套实现，数据没有决策价值。
     危险信号表、L3 规则分、BM25、RRF、以及 B1/B2 的修复记录，
     全部见 retrieval.js 内注释，此处不再重复。 */
  var R = window.RETRIEVAL;
  if (!R) {
    throw new Error('retrieval.js 未加载：index.html 中须在 app.js 之前引入');
  }
  var detectDanger = R.detectDanger;

  /* 运行日志（app/log.js）。可选依赖：没加载就全 no-op，产品行为不变。 */
  var LOG = window.LOG || null;
  function lg(level, msg, fields) {
    if (!LOG) return;
    var t = LOG.tag('app');
    if (t[level]) t[level](msg, fields);
  }
  function logAlways(msg, fields) {
    if (LOG && LOG.always) LOG.always('app', msg, fields);
  }

  /* LLM 意图判定客户端（app/llm.js）。可选依赖：
     没加载或代理没起时，LLM 会是 undefined，全部逻辑回落 l3——
     接入 LLM 不得让应用变得「必须联网才能用」（docs/03 §5 三层兜底）。 */
  var LLM = window.LLM || null;

  /* 语音输出（app/voice.js）。同样是可选依赖：
     未加载或设备不支持时，朗读按钮仍然渲染，但点击会给出明确提示，
     绝不静默失败（docs/01 §6.2）。 */
  var V = window.TTS || null;

  /* 语音输入（app/asr.js）。M2。可选依赖：未加载时按钮不渲染，
     产品退化为纯文字，不影响任何既有功能。 */
  var ASR = window.ASR || null;

  /* 朗读一张步骤卡。文本来源只有条目字段（S1：不许编）。
     opts.auto = true 时是「自动朗读」：失败要静默，不弹提示。 */
  function speakSteps(entry, immediateSteps, opts) {
    var isAuto = !!(opts && opts.auto);
    if (!V) { if (!isAuto) showVoiceNotice('这台设备的浏览器不支持语音朗读'); return; }
    if (!V.state.supported) {
      if (!isAuto) showVoiceNotice(V.state.unavailableReason || '语音朗读暂不可用');
      return;
    }
    var script = V.composeStepsScript(entry, immediateSteps);
    V.speak(script, { force: true }).then(function (r) {
      if (r && !r.ok && r.reason !== 'cancelled' && !isAuto) {
        showVoiceNotice(r.message || '朗读失败，请重试');
      }
    });
  }

  /* ---------- 自动朗读（M2，用户裁决 B） ----------
     依据 docs/01 §2.1「语音播报是主输出通道，文字只是备份」——
     既然是主通道，就不能要求老人先找到按钮再点。

     只解决三件事，且每件都有明确的边界：

     1. **只在紧急模式自动读。** 日常模式是在问知识，自动出声会打扰
        （老人可能只是想看看，不想被念一长段解释）。

     2. **自动读失败必须静默。** 浏览器自动播放策略可能拦截（无用户手势），
        此时弹「朗读失败」只会让人困惑——因为用户根本没主动要求朗读。
        手动按钮始终是可靠路径，这条路不走通不影响可用性。

     3. **用户按过「停止」= 明确表示不想听。** 此时本会话内不再自动读，
        直到下一次提问或点图标（那是一次新的意图表达）。
        手动点「朗读一遍」不受此限制。 */
  var autoRead = { muted: false };

  function canAutoRead() {
    if (!V || !V.state.supported || !V.state.enabled) return false;
    if (state.mode !== 'emergency') return false;
    if (autoRead.muted) return false;
    return true;
  }

  /* 自动朗读的「为什么读/为什么不读」必须留痕。
     2026-11-18 那次「打字不朗读」，症状是「什么也没发生」——
     没有这行日志，就只能靠读代码猜是哪一道门槛挡住的。
     这里只在 debug 记（每次提问 1–3 次，属细节），但决定不读时用 info——
     不读是异常路径，需要能看见。 */
  function whyNoAutoRead() {
    if (!V) return 'voice-module-missing';
    if (!V.state.supported) return 'unsupported:' + (V.state.unavailableReason || 'unknown');
    if (!V.state.enabled) return 'user-disabled';
    if (state.mode !== 'emergency') return 'daily-mode-steps-card';
    if (autoRead.muted) return 'muted-after-stop';
    return 'unknown';
  }

  function autoReadCard(entry, immediateSteps) {
    if (!canAutoRead()) {
      lg('info', '自动朗读跳过（步骤卡）', { reason: whyNoAutoRead(), entryId: entry && entry.id });
      return;
    }
    lg('debug', '自动朗读步骤卡', { entryId: entry && entry.id, triageOverride: !!immediateSteps });
    speakSteps(entry, immediateSteps, { auto: true });
  }

  function autoReadTriage(entry) {
    if (!canAutoRead()) {
      lg('info', '自动朗读跳过（分诊卡）', { reason: whyNoAutoRead(), entryId: entry && entry.id });
      return;
    }
    lg('debug', '自动朗读分诊卡', { entryId: entry && entry.id });
    V.speak(V.composeTriageScript(entry), { force: true });
  }

  /* 手动朗读分诊卡（K2 补）。与 autoReadTriage 的区别只在两处：
     ① 不受 state.mode 与静默位限制（用户明确点了按钮）
     ② 失败要给提示，不能静默（这条是用户主动要求的） */
  function speakTriage(entry) {
    if (!V) { showVoiceNotice('这台设备的浏览器不支持语音朗读'); return; }
    if (!V.state.supported) { showVoiceNotice(V.state.unavailableReason || '语音朗读暂不可用'); return; }
    var script = V.composeTriageScript(entry);
    if (!script) return;
    V.speak(script, { force: true }).then(function (r) {
      if (r && !r.ok && r.reason !== 'cancelled') {
        showVoiceNotice(r.message || '朗读失败，请重试');
      }
    });
  }

  function muteAutoRead() {
    autoRead.muted = true;
    if (V) V.stop();
    lg('info', '本会话不再自动朗读（用户按了停止）');
  }

  function unmuteAutoRead() {
    if (autoRead.muted) lg('debug', '解除自动朗读静默（新一次意图表达）');
    autoRead.muted = false;
  }

  /* ---------- 日常解释卡的朗读（2026-11-18 追加） ----------
     背景（实测发现）：老人打字提问，出的多是日常解释卡；原来这张卡
     一行语音代码都没有，于是「点图标会读、打字不读」——而打字才是
     真实使用方式。点图标是演示路径，不能代表产品可用。

     边界（用户裁决：只自动读名称+摘要）：
       - 自动读只念「场景名 + 一句摘要」，不念原因与「平时怎么做」清单。
         念长了老人会按停止，等于没读。
       - 「朗读一遍」按钮念 composeDailyScript（名称+摘要+原因），是全文入口。
       - 日常卡同样受「按停止后本会话不再自动读」约束。
     为什么日常卡不受 state.mode 限制：日常模式本身就是提问发生的模式，
     要求「先切紧急才出声」等于日常永远不出声。 */
  function canAutoReadDaily() {
    if (!V || !V.state.supported || !V.state.enabled) return false;
    if (autoRead.muted) return false;
    return true;
  }

  /* opts.auto = true 时是自动朗读：失败必须静默（同 speakSteps 的理由） */
  function speakDaily(entry, opts) {
    var isAuto = !!(opts && opts.auto);
    if (!V) { if (!isAuto) showVoiceNotice('这台设备的浏览器不支持语音朗读'); return; }
    if (!V.state.supported) {
      if (!isAuto) showVoiceNotice(V.state.unavailableReason || '语音朗读暂不可用');
      return;
    }
    var script = isAuto ? V.composeDailyBriefScript(entry) : V.composeDailyScript(entry);
    if (!script) return;
    V.speak(script, { force: true }).then(function (r) {
      if (r && !r.ok && r.reason !== 'cancelled' && !isAuto) {
        showVoiceNotice(r.message || '朗读失败，请重试');
      }
    });
  }

  function autoReadDaily(entry) {
    if (!canAutoReadDaily()) {
      lg('info', '自动朗读跳过（日常卡）', {
        reason: (!V ? 'voice-module-missing'
          : !V.state.supported ? 'unsupported:' + (V.state.unavailableReason || 'unknown')
            : !V.state.enabled ? 'user-disabled' : 'muted-after-stop'),
        entryId: entry && entry.id
      });
      return;
    }
    lg('debug', '自动朗读日常卡（只读名称+摘要）', { entryId: entry && entry.id });
    speakDaily(entry, { auto: true });
  }

  /* 语音不可用时的显性提示。不用 alert（打断且老人容易误关），
     在卡片上方插一条常驻提示，可点掉。
     提示要落在「用户正看着的那个视图」：日常模式落在 dailyAnswer，
     紧急模式落在 emgAnswer。落在隐藏视图等于没提示（§6.2 静默失败）。 */
  function showVoiceNotice(msg) {
    var host = (state.mode === 'emergency') ? el.emgAnswer : el.dailyAnswer;
    if (!host) return;
    var old = host.querySelector('.voice-notice');
    if (old) old.parentNode.removeChild(old);
    var div = document.createElement('div');
    div.className = 'voice-notice';
    div.setAttribute('role', 'alert');
    div.innerHTML = '<p>' + esc(msg) + '</p>' +
      '<button type="button" class="voice-notice-close">知道了</button>';
    var btn = div.querySelector('.voice-notice-close');
    if (btn) btn.addEventListener('click', function () { div.parentNode.removeChild(div); });
    host.insertBefore(div, host.firstChild);
  }

  /* ---------- 语音输入：按住说话（M2） ----------
     依据 docs/01 §4.2：按住说话 → 云 ASR → 场景归一。

     为什么是「按住」而不是「点一下开始、再点结束」：用户裁决按住说话。
     为了让按住可用，实现上必须处理三件事：
       ① pointerup 可能发生在按钮外（手指滑出去了）→ 在 window 上监听
       ② 触摸设备要 touch-action:none，否则按下时页面跟着滚
       ③ 手指抖动导致提前松手 → MIN_MS 兜底提示「太短了」，不是静默丢弃

     识别结果**写进输入框并立即出答案**（不需要再点「提问」）——
     填框只是为了让老人看得见自己说了什么。见 fillInput 与 onTalkUp 的注释。 */
  var talk = { busy: false };   // 只保留「识别中」这一个跨按钮状态

  function setTalkHint(hintEl, msg, isInfo) {
    if (!hintEl) return;
    if (!msg) { hintEl.hidden = true; hintEl.textContent = ''; return; }
    hintEl.hidden = false;
    hintEl.textContent = msg;
    hintEl.className = 'talk-hint' + (isInfo ? ' is-info' : '');
  }

  function setTalkBusy(btn, busy) {
    if (!btn) return;
    talk.busy = busy;
    btn.classList.toggle('is-busy', busy);
    btn.disabled = busy;
    var label = btn.querySelector('.talk-label');
    if (label) label.textContent = busy ? '正在识别…' : '按住说话';
  }

  /* 识别中要有确定性反馈（01 §8 红线 1：不许无反馈等待）。
     用一条不确定进度条 + 文案，不假装百分比。 */
  function showTalkProgress(host, on) {
    if (!host) return;
    var old = host.querySelector('.talk-progress');
    if (old) old.parentNode.removeChild(old);
    if (!on) return;
    var div = document.createElement('div');
    div.className = 'talk-progress';
    host.appendChild(div);
  }

  /* 把识别结果写进对应模式的输入框，并把焦点放过去。
     为什么还要填框（2026-11-19 用户两次实测的合并结论）：
       第一次：「你是不是没有连接文本框？问了也没用」→ 识别结果必须可见。
       第二次：「做成输入后直接出答案，不需要再确认」→ 不要多一步点击。
       两条并不冲突：**填框 + 立即出答案**。文字留在框里，
       老人一样能看见自己说了什么、能改、能重说，只是不必先按一次「提问」。

     光标放到末尾：老人可能要补几个字（「再加一句，我家在六楼」）。 */
  function fillInput(input, text) {
    if (!input || !text) return false;
    input.value = text;
    try {
      input.focus();
      // 光标置末尾，不选中——选中后一打字就把整句覆盖了
      if (typeof input.setSelectionRange === 'function') {
        var n = text.length;
        input.setSelectionRange(n, n);
      }
    } catch (e) { /* ignore：某些输入类型不支持 setSelectionRange */ }
    return true;
  }

  /* ---------- 语音输入的控制器 ----------
     两个模式各一个按钮，但**状态与 window 监听只有一份**。
     为什么：先前每个按钮各挂一个 pointerup，一次松手会触发两次 stop，
     第二次拿到 not-recording 又被当成失败提示；同时重复 start 让
     旧的 MediaStream 没关，多个音频流一起写缓冲，录出 26s/52s 的怪文件。 */
  var talkCtl = {
    btn: null,
    hint: null,
    input: null,
    downAt: 0,      // 去重：pointerdown 与 keydown 可能同时打进来
    active: false,
    listening: false
  };

  function talkReset() {
    if (talkCtl.btn) {
      talkCtl.btn.classList.remove('is-rec');
      var label = talkCtl.btn.querySelector('.talk-label');
      if (label) label.textContent = '按住说话';
    }
    talkCtl.active = false;
  }

  function initTalk(btnId, hintId, inputId) {
    var btn = document.getElementById(btnId);
    var hint = document.getElementById(hintId);
    var input = document.getElementById(inputId);
    if (!btn) return;

    if (!ASR) {
      // 模块没加载：按钮不显示，而不是显示一个点了没反应的按钮
      if (btn.parentNode) btn.parentNode.hidden = true;
      else btn.hidden = true;
      return;
    }
    var cap = ASR.detect();
    if (!cap.supported) {
      /* 不支持时**仍然显示按钮**，按下给明确原因。
         隐藏按钮会让老人以为「这软件没这功能」，而真正原因（要起服务/
         没权限）必须说出来。这与语音输出的处置一致（01 §6.2）。 */
      btn.classList.add('is-unavailable');
      setTalkHint(hint, cap.reason, true);
      lg('warn', '语音输入不可用', { reason: cap.reason });
    }

    function onDown(ev) {
      // 去重：同一次按下可能被 pointerdown 与 keydown 各触发一次
      var now = Date.now();
      if (now - talkCtl.downAt < 400) return;
      talkCtl.downAt = now;

      if (talkCtl.busy) return;
      if (ev && ev.preventDefault) ev.preventDefault();

      if (!cap.supported) {
        setTalkHint(hint, cap.reason, true);
        return;
      }
      if (talkCtl.listening) return;   // 已经在录，忽略

      talkCtl.btn = btn;
      talkCtl.hint = hint;
      talkCtl.input = input;
      talkCtl.active = true;
      talkCtl.listening = true;

      btn.classList.add('is-rec');
      var label = btn.querySelector('.talk-label');
      if (label) label.textContent = '松开发送';
      setTalkHint(hint, '正在听…说完松开手指', true);

      ASR.start().then(function (r) {
        if (r && r.ok) return;
        /* 只有「这次按下还在进行中」才报错。
           若用户已松手（active=false），这次失败是过期结果，不弹提示——
           否则会出现「明明松手了，下面还跳一条失败」。 */
        if (!talkCtl.active) return;
        talkCtl.listening = false;
        talkReset();
        setTalkHint(hint, r && r.message ? r.message : '打不开麦克风。');
        lg('warn', '录音启动失败', { reason: r && r.reason, detail: r && r.message });
      });
    }

    btn.addEventListener('pointerdown', onDown);
    btn.addEventListener('keydown', function (ev) {
      if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); if (!ev.repeat) onDown(ev); }
    });
  }

  /* window 上的松手监听只挂一次（所有按钮共用）。
     理由：手指可能滑出按钮才松开，只挂按钮会永远收不到 pointerup，
     表现为「一直录到 15 秒上限」——实测踩过。 */
  /* 返回值：Promise，在整条链（识别 → 填框 → 出答案 → 朗读）走完后 resolve。
     为什么要返回：测试必须能 await 到「真的出卡了」，而不是等一个固定毫秒数。
     实测踩过——e2e_asr 原来等 120ms，LLM 缓存命中时够用，清缓存后要 800–1800ms，
     测试立刻变成假失败。等完成信号永远比等时间可靠。 */
  function onTalkUp() {
    if (!talkCtl.active) return Promise.resolve('idle');
    if (!talkCtl.listening) { talkReset(); return Promise.resolve('not-listening'); }   // start 就没成功，无需 stop
    talkCtl.listening = false;
    var btn = talkCtl.btn;
    var hint = talkCtl.hint;
    var input = talkCtl.input;
    talkCtl.active = false;
    if (btn) btn.classList.remove('is-rec');
    setTalkHint(hint, '正在识别…', true);
    setTalkBusy(btn, true);
    showTalkProgress(hint && hint.parentNode, true);

    return ASR.stop().then(function (r) {
      setTalkBusy(btn, false);
      showTalkProgress(hint && hint.parentNode, false);
      if (!r || !r.ok) {
        setTalkHint(hint, (r && r.message) || '没听清，请再说一遍。');
        lg('info', '语音输入未取得文本', { reason: r && r.reason });
        return 'no-text';
      }
      setTalkHint(hint, '');
      logAlways('语音输入', {
        text: LOG ? LOG.clipText(r.text) : r.text,
        audioMs: r.duration_ms, latencyMs: r.latency_ms,
        filled: true, autoQuery: true
      });
      /* 填框 + 立即出答案（用户裁决：不需要再确认）。
         填框不是为了「等确认」，是为了让老人看得见自己说了什么。
         填框失败时仍然出答案——绝不能因为界面结构变了就把识别结果吞掉。 */
      var filled = fillInput(input, r.text);
      if (!filled) lg('warn', '找不到输入框，直接提问（结果不丢）');
      /* 把 handleQuery 的 Promise 传出去，调用方才能 await 到「卡出完了」。 */
      return handleQuery(r.text).then(function () { return 'done'; });
    });
  }

  /* 录音到 15 秒上限时的接管：等同用户松手。
     没有这一步，自动停止后识别结果没人接，表现为「录了半天什么也没发生」。 */
  if (ASR) ASR.state.onAutoStop = function () { onTalkUp(); };

  /* ---------- 固定话术（S4：不含任何操作步骤） ---------- */
  var REFUSE_TEXT = '这个问题我答不了。我只会说应急和安全的常识，比如燃气泄漏、老人跌倒、电梯困人。';

  /* ---------- 状态 ---------- */
  var state = {
    mode: 'daily',        // 'daily' | 'emergency'
    locked: false,        // S8：命中危险信号后锁定，不可回日常
    choice: null          // triage 已选项
  };

  /* ---------- DOM ---------- */
  var el = {
    band: document.getElementById('modeBand'),
    dailyView: document.getElementById('dailyView'),
    emgView: document.getElementById('emergencyView'),
    dailyForm: document.getElementById('dailyForm'),
    emgForm: document.getElementById('emgForm'),
    dailyInput: document.getElementById('dailyInput'),
    emgInput: document.getElementById('emgInput'),
    dailyIcons: document.getElementById('dailyIcons'),
    emgIcons: document.getElementById('emgIcons'),
    dailyAnswer: document.getElementById('dailyAnswer'),
    emgAnswer: document.getElementById('emgAnswer')
  };

  var ICONS = {
    gas_leak: '💨', fire_home: '🔥', co_poisoning: '🥵',
    fall_elderly: '🧓', scald_burn: '♨️', electric_shock: '⚡',
    airway_obstruction: '🫁', drowning: '🌊', earthquake: '🏚️',
    elevator_trapped: '🛗'
  };

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- 决定2：场景检索（实现已迁至 retrieval.js） ----------
     production 默认引擎 = l3（字符规则分），与 M1 基线逐条一致；
     bm25 / hybrid 仅供评测切换，改默认值须提案（docs/03 §7.1 D-3）。 */
  function bestMatch(text) {
    var r = R.retrieve(ENTRIES, text);
    return r.entryId ? (ENTRIES[r.entryId] || null) : null;
  }

  /* ---------- 模式切换（S8） ---------- */
  function enterEmergency() {
    if (state.locked) return;
    state.locked = true;
    state.mode = 'emergency';
    el.band.hidden = false;
    el.dailyView.hidden = true;
    el.emgView.hidden = false;
    renderIcons();
    window.scrollTo(0, 0);
    // S8 是「进得去出不来」的锁，切换必须留痕（含是谁触发的）
    lg('info', '切紧急模式并锁定', { locked: true, trace: LOG ? LOG.getTrace() : null });
  }

  /* ---------- 图标区 ---------- */
  function renderIcons() {
    var html = KB.slots.map(function (s) {
      return '<button class="icon-btn" type="button" data-id="' + esc(s.id) + '">' +
        '<span class="icon-glyph" aria-hidden="true">' + (ICONS[s.id] || '•') + '</span>' +
        '<span class="icon-label">' + esc(s.name) + '</span>' +
        '</button>';
    }).join('');
    if (!html) {
      html = '<p class="section-label">内容正在准备中</p>';
    }
    el.dailyIcons.innerHTML = html;
    el.emgIcons.innerHTML = html;
  }

  /* ---------- 三段式步骤卡 ----------
     M1 契约 §4.5：tool 全部忽略，只渲染 text。
     拨号按钮由 emergency_number 驱动，依据是 S5（生命危险场景须有显式拨号按钮），
     不是已删除的 S9。与步骤级 tool 无关。 */
  function renderSteps(entry, immediateSteps, container) {
    var segMap = [
      { key: 'immediate', title: '立刻做', cls: 'seg-immediate', checkable: true },
      { key: 'next', title: '接着做', cls: 'seg-next', checkable: true },
      { key: 'never', title: '绝对不要做', cls: 'seg-never', checkable: false }
    ];

    var body = segMap.map(function (seg) {
      var arr = (seg.key === 'immediate' && immediateSteps) ? immediateSteps : (entry.steps[seg.key] || []);
      if (!arr.length) return '';
      var items = arr.map(function (step) {
        var text = esc(step.text);
        if (!seg.checkable) {
          return '<li><div class="step" role="note">' +
            '<span class="box" aria-hidden="true">×</span>' +
            '<span class="txt">' + text + '</span></div></li>';
        }
        return '<li><button class="step" type="button" aria-pressed="false">' +
          '<span class="box" aria-hidden="true"></span>' +
          '<span class="txt">' + text + '</span></button></li>';
      }).join('');
      return '<section class="seg ' + seg.cls + '">' +
        '<h3 class="seg-head"><span class="bar" aria-hidden="true"></span>' + seg.title + '</h3>' +
        '<ul class="steps">' + items + '</ul></section>';
    }).join('');

    var num = entry.emergency_number;
    container.innerHTML =
      '<article class="card">' +
        '<h2 class="card-title">' + esc(entry.name) + '</h2>' +
        body +
        '<div class="voice-row">' +
          '<button class="voice-btn" type="button" data-act="read" aria-label="朗读这张卡片">' +
            '<span class="voice-ico" aria-hidden="true">▸</span>朗读一遍' +
          '</button>' +
          '<button class="voice-btn is-stop" type="button" data-act="stop" aria-label="停止朗读">停止</button>' +
        '</div>' +
        '<div class="dial-row"><a class="dial-btn" href="tel:' + esc(num) + '">拨打 ' + esc(num) + '</a></div>' +
      '</article>';

    // 朗读：文本由 voice.js 从条目字段拼接，**不改写一个字**（S1）
    var readBtn = container.querySelector('[data-act="read"]');
    if (readBtn) {
      readBtn.addEventListener('click', function () {
        speakSteps(entry, immediateSteps);
      });
    }
    var stopBtn = container.querySelector('[data-act="stop"]');
    if (stopBtn) {
      /* 按停止不只是这次停下，还要**本会话内不再自动读**。
         理由：自动朗读如果按了停还继续读，等于用户说「别念了」而系统不听。 */
      stopBtn.addEventListener('click', function () { muteAutoRead(); });
    }

    // 打勾：点一下切换，再点取消
    container.querySelectorAll('.step[aria-pressed]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var on = btn.getAttribute('aria-pressed') === 'true';
        btn.setAttribute('aria-pressed', on ? 'false' : 'true');
        var box = btn.querySelector('.box');
        if (box) box.textContent = on ? '' : '✓';
      });
    });
  }

  /* ---------- 分诊：先问 1 个分支，再给步骤（契约 §5） ---------- */
  function renderStepsCard(entry, container) {
    if (!entry.triage || !entry.triage.options || !entry.triage.options.length) {
      renderSteps(entry, null, container);
      autoReadCard(entry, null);
      return;
    }
    var opts = entry.triage.options.map(function (o, i) {
      return '<button class="triage-btn" type="button" data-i="' + i + '">' + esc(o.label) + '</button>';
    }).join('');
    /* 分诊卡也要有朗读/停止（2026-11-19 修复 K2）。
       为什么必须补：gas_leak / earthquake / fall_elderly 三条走分诊，
       而**分诊卡就是它们的首屏**。没有这两个按钮，老人在首屏自动读完之后
       没听清就无法重播，响了也无法按停 —— M2 必做项 2「可重播、可打断」
       在这三条场景上不成立。

       位置放在选项之后：先让老人看到「要选哪个」，按钮不该挡在选项前面。 */
    container.innerHTML =
      '<article class="card">' +
        '<h2 class="card-title">' + esc(entry.name) + '</h2>' +
        '<p class="triage-q">' + esc(entry.triage.question) + '</p>' +
        '<div class="triage-opts">' + opts + '</div>' +
        '<div class="voice-row">' +
          '<button class="voice-btn" type="button" data-act="read" aria-label="再听一遍这个问题">' +
            '<span class="voice-ico" aria-hidden="true">▸</span>再听一遍' +
          '</button>' +
          '<button class="voice-btn is-stop" type="button" data-act="stop" aria-label="停止朗读">停止</button>' +
        '</div>' +
      '</article>';

    // 手动重播：与步骤卡同一套逻辑（读问题+选项+安全句），不受静默限制
    var readBtn = container.querySelector('[data-act="read"]');
    if (readBtn) {
      readBtn.addEventListener('click', function () { speakTriage(entry); });
    }
    var stopBtn = container.querySelector('[data-act="stop"]');
    if (stopBtn) {
      stopBtn.addEventListener('click', function () { muteAutoRead(); });
    }

    // 分诊阶段还没有步骤，只能读问题与选项
    autoReadTriage(entry);
    container.querySelectorAll('.triage-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var o = entry.triage.options[Number(btn.getAttribute('data-i'))];
        var override = o && o.override && o.override.immediate ? o.override.immediate : null;
        renderSteps(entry, override, container);
        // 选完就读对应的步骤（override），不能读默认步骤
        autoReadCard(entry, override);
      });
    });
  }

  /* ---------- 决定4：紧急命中但无条目 → 只给号码，不给步骤 ---------- */
  function renderDialOnly(number, container) {
    container.innerHTML =
      '<article class="dialonly">' +
        '<p class="headline">这个情况我没有可靠的操作步骤。</p>' +
        '<p>我不编步骤。请先打电话求救，接线员会一步步教你。</p>' +
        '<div class="dial-row"><a class="dial-btn" href="tel:' + esc(number) + '">拨打 ' + esc(number) + '</a></div>' +
      '</article>';
  }

  /* ---------- 拒答（S1 / S4：零步骤 + 固定话术 + 拨号按钮） ---------- */
  function renderRefuse(container) {
    container.innerHTML =
      '<article class="refuse">' +
        '<p>' + esc(REFUSE_TEXT) + '</p>' +
        '<div class="dial-row"><a class="dial-btn" href="tel:120">拨打 120</a></div>' +
      '</article>';
  }

  /* ---------- 决定5：日常模式只用 daily 四字段拼装 ---------- */
  function renderDaily(entry, container) {
    var d = entry.daily || {};
    var prev = (d.prevention || []).map(function (p) {
      return '<li>' + esc(p) + '</li>';
    }).join('');
    container.innerHTML =
      '<article class="card">' +
        '<h2 class="card-title">' + esc(entry.name) + '</h2>' +
        '<div class="explain">' +
          '<p class="lead">' + esc(d.summary || '') + '</p>' +
          (d.why ? '<p>' + esc(d.why) + '</p>' : '') +
          (prev ? '<p><b>平时怎么做</b></p><ul>' + prev + '</ul>' : '') +
          (d.misconception ? '<p class="misconception"><b>常见误区：</b>' + esc(d.misconception) + '</p>' : '') +
        '</div>' +
        '<div class="voice-row">' +
          '<button class="voice-btn" type="button" data-act="read" aria-label="朗读这段解释">' +
            '<span class="voice-ico" aria-hidden="true">▸</span>朗读一遍' +
          '</button>' +
          '<button class="voice-btn is-stop" type="button" data-act="stop" aria-label="停止朗读">停止</button>' +
        '</div>' +
        '<button class="ghost-btn" type="button" id="toSteps">查看操作步骤</button>' +
      '</article>';

    // 语音：手动读全文（名称+摘要+原因），自动只读一句摘要
    var readBtn = container.querySelector('[data-act="read"]');
    if (readBtn) {
      readBtn.addEventListener('click', function () { speakDaily(entry); });
    }
    var stopBtn = container.querySelector('[data-act="stop"]');
    if (stopBtn) {
      stopBtn.addEventListener('click', function () { muteAutoRead(); });
    }
    autoReadDaily(entry);

    var btn = container.querySelector('#toSteps');
    if (btn) {
      btn.addEventListener('click', function () {
        renderStepsCard(entry, container);
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  /* ---------- 查询入口 ---------- */
  /* 路由决策单独抽出：界面与自测脚本共用同一条判断链，避免两处逻辑不同步 */
  function routeOf(text) {
    var danger = detectDanger(text);
    var targetId = danger ? danger.id : null;
    var entry = targetId ? ENTRIES[targetId] : bestMatch(text);
    return { danger: danger, targetId: targetId, entry: entry || null };
  }

  /* 把 LLM 路由决策翻译成渲染动作。
     只处理「LLM 给出结论」的情况；返回 null 表示「LLM 没参与」，
     由调用方回落 routeOf（l3），行为与接入前完全一致。 */
  function applyLlmRoute(lr) {
    if (!lr) return null;
    if (lr.action === 'steps') {
      return { kind: 'steps', entry: ENTRIES[lr.entryId] || null };
    }
    if (lr.action === 'daily') {
      return { kind: 'daily', entry: ENTRIES[lr.entryId] || null };
    }
    if (lr.action === 'dialonly') {
      // 场景判出来了但没条目 → 只给号码，绝不给步骤（S1）
      var rule = null;
      for (var i = 0; i < R.DANGER_RULES.length; i++) {
        if (R.DANGER_RULES[i].id === lr.sceneId) { rule = R.DANGER_RULES[i]; break; }
      }
      return { kind: 'dialonly', number: (rule && rule.number) || '120' };
    }
    return { kind: 'refuse' };
  }

  function renderByAction(a, container) {
    if (a.kind === 'steps' && a.entry) renderStepsCard(a.entry, container);
    else if (a.kind === 'daily' && a.entry) renderDaily(a.entry, container);
    else if (a.kind === 'dialonly') renderDialOnly(a.number, container);
    else renderRefuse(container);
  }

  function scrollToAnswer(container) {
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* 同步路径：l3 字符检索（接入 LLM 前的主路径，现在是降级路径）
     opts.keepTrace = true 表示「调用方已经开好 trace，别覆盖」——
     handleQuery 走这条路时就传它，否则一次提问会被劈成两个 trace。 */
  function handleQuerySync(rawText, opts) {
    var text = String(rawText || '').trim();
    if (!text) {
      lg('debug', '空输入，忽略');
      return;
    }
    /* 独立调用（直接调同步路径、或端到端脚本）时自己开 trace，
       否则会沿用上一次提问的 trace，日志串起来就是错的。
       有 trace 就沿用，避免 handleQuery 的 trace 被覆盖成两个。 */
    if (LOG && !(opts && opts.keepTrace)) LOG.setTrace(LOG.newTrace('q'));
    /* 新一次提问 = 新的意图表达，解除「按停止后的静默」。
       否则老人按过一次停止，后面所有场景就再也听不到声音，而他并不知道原因。 */
    unmuteAutoRead();
    var r = routeOf(text);
    logRoute('l3', text, r);
    if (r.danger && state.mode === 'daily') enterEmergency();
    if (state.mode === 'emergency') {
      if (r.entry) renderStepsCard(r.entry, el.emgAnswer);
      else if (r.targetId) renderDialOnly(r.danger.number || '120', el.emgAnswer);
      else renderRefuse(el.emgAnswer);
      scrollToAnswer(el.emgAnswer);
      return;
    }
    if (r.entry) renderDaily(r.entry, el.dailyAnswer);
    else renderRefuse(el.dailyAnswer);
    scrollToAnswer(el.dailyAnswer);
  }

  /* 路由摘要：一次提问强制写 1 行，含输入截断与落点。
     这是把五个模块串起来的那根线——其余模块的日志都带同一个 trace。 */
  function logRoute(path, text, r) {
    logAlways('路由决策', {
      path: path,
      input: LOG ? LOG.clipText(text) : String(text).slice(0, 20),
      dangerId: r.danger ? r.danger.id : null,
      targetId: r.targetId || null,
      entryId: r.entry ? r.entry.id : null,
      mode: state.mode,
      locked: state.locked,
      kind: r.entry ? (state.mode === 'emergency' ? 'steps' : 'daily')
        : (r.targetId ? 'dialonly' : 'refuse')
    });
  }

  /* 主路径：先问 LLM 意图判定，失败则同步回落 l3。
     为什么不在等待期间先出 l3 结果再替换：会让答案闪一下再变，
     对老人来说是「界面在乱跳」。宁可等 1 秒给一个确定答案。

     返回值：Promise，渲染完成后 resolve。浏览器里调用方可以忽略；
     端到端测试（tools/e2e_llm.mjs）必须能 await 到渲染结束，
     否则测的是「有没有发起请求」而不是「有没有渲染出内容」。 */
  function handleQuery(rawText) {
    var text = String(rawText || '').trim();
    if (!text) return Promise.resolve('empty');

    /* 一次提问 = 一个 trace。在这里开，而不是在每个模块里各开一个：
       只有入口知道「这是一次新的提问」，模块自己不知道边界在哪。 */
    if (LOG) LOG.setTrace(LOG.newTrace('q'));

    /* 两条路径（同步 l3 / 异步 LLM）都从这里进，故在此解除静默。
       handleQuerySync 里也有一处，重复调用是幂等的。 */
    unmuteAutoRead();

    if (!LLM || !LLM.judge) { handleQuerySync(text, { keepTrace: true }); return Promise.resolve('sync'); }

    return LLM.judge(text).then(function (verdict) {
      var lr = LLM.routeByVerdict(verdict, ENTRIES, detectDanger, text);

      // LLM 未参与（不可用/超时/结构不合法）→ 完全走原 l3
      if (!lr) { handleQuerySync(text, { keepTrace: true }); return 'fallback'; }

      var a = applyLlmRoute(lr);
      if (!a) { handleQuerySync(text, { keepTrace: true }); return 'fallback'; }

      // S8：LLM 判定为 ongoing 或命中了步骤/拨号 → 强制切紧急，且不可回
      var toEmergency = (verdict.intent === 'ongoing') || a.kind === 'steps' || a.kind === 'dialonly';
      if (toEmergency && state.mode === 'daily') enterEmergency();

      /* LLM 路径的路由摘要：与 l3 路径同一字段，便于对比「同一个输入
         走两条路各落到哪」——B3 那类「LLM 判对了又被兜底盖掉」就靠这个比。
         写在渲染之前：日志按时间读才是因果顺序（渲染完才记，摘要会排到语音后面）。 */
      logRoute('llm', text, {
        danger: verdict.intent === 'ongoing' ? detectDanger(text) : null,
        targetId: lr.sceneId || null,
        entry: a.entry || null,
        action: a.kind
      });

      if (state.mode === 'emergency') {
        renderByAction(a, el.emgAnswer);
        scrollToAnswer(el.emgAnswer);
      } else {
        // 日常模式：只可能是 daily 或 refuse
        if (a.kind === 'daily') renderDaily(a.entry, el.dailyAnswer);
        else renderRefuse(el.dailyAnswer);
        scrollToAnswer(el.dailyAnswer);
      }
      return 'llm';
    });
  }

  function handleIconClick(id) {
    var e = ENTRIES[id];
    if (!e) {
      lg('warn', '点了未知场景图标', { id: id });
      return;
    }

    // 点图标同样是一次新的意图表达，解除静默
    unmuteAutoRead();
    if (LOG) LOG.setTrace(LOG.newTrace('i'));
    logAlways('点图标', { entryId: id, mode: state.mode, locked: state.locked });

    // 点图标 = 显式要这个场景的步骤，直接进紧急形态（S3 兜底路径）
    if (state.mode === 'daily') enterEmergency();
    if (state.mode === 'emergency') {
      renderStepsCard(e, el.emgAnswer);
      el.emgAnswer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      renderDaily(e, el.dailyAnswer);
      el.dailyAnswer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ---------- 绑定 ---------- */
  el.dailyForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = el.dailyInput.value;
    el.dailyInput.value = '';
    handleQuery(v);
  });

  el.emgForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = el.emgInput.value;
    el.emgInput.value = '';
    handleQuery(v);
  });

  el.dailyIcons.addEventListener('click', function (ev) {
    var b = ev.target.closest('.icon-btn');
    if (b) handleIconClick(b.getAttribute('data-id'));
  });
  el.emgIcons.addEventListener('click', function (ev) {
    var b = ev.target.closest('.icon-btn');
    if (b) handleIconClick(b.getAttribute('data-id'));
  });

  /* ---------- 启动 ---------- */
  renderIcons();

  /* 语音输入按钮：两个模式各一个。
     先探测，不支持也渲染按钮（按下给原因），不隐藏成「没这功能」。 */
  /* 语音输入按钮：两个模式各一个，识别结果写回各自的输入框。
     window 上的松手监听**只挂一次**（两个按钮共用一份状态）。 */
  /* ---------- 朗读语速控件（K3） ----------
     M2 必做项 2 要求「语速可调慢」。原来只有 TTS.setRate() 这个函数，
     界面上没有任何入口 —— 只有默认 0.9（偏慢），不满足「可调」。

     两档而不是三档：老人记不住哪档是自己上次选的。
       慢一点 = 0.75（比默认更慢，给听不清的）
       正常   = 1.0
     选择落盘 localStorage，下次打开仍然生效（voice.js 的 savePref 已做）。

     为什么不做成滑块：滑块要精细拖拽，老人手抖拖不准；
     两个大按钮点一下就定，且能用 aria-pressed 读出当前档位。 */
  (function initRate() {
    var row = document.getElementById('rateRow');
    if (!row) return;
    if (!V) { row.hidden = true; return; }
    /* ⚠️ 不能在这里判断 V.state.supported：
       detect() 是异步的，启动瞬间 supported 还是 false，会把控件误藏。
       改为先渲染，等探测结果回来再决定（下面的 detect().then 里处理）。 */

    var btns = row.querySelectorAll('.rate-btn');
    function paint() {
      var cur = V.state.rate;
      for (var i = 0; i < btns.length; i++) {
        var r = Number(btns[i].getAttribute('data-rate'));
        // 0.75 档：rate < 0.9 即算「慢」；1.0 档：rate >= 0.9
        var on = (r < 0.9) ? (cur < 0.9) : (cur >= 0.9);
        btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        var r = Number(ev.currentTarget.getAttribute('data-rate'));
        V.setRate(r);
        paint();
        // 立刻读一句让用户听到差别，否则他不知道按钮生效没有
        V.speak('朗读速度改好了。', { force: true });
        logAlways('语速变更', { rate: r });
      });
    }
    paint();
  })();

  initTalk('dailyTalk', 'dailyTalkHint', 'dailyInput');
  initTalk('emgTalk', 'emgTalkHint', 'emgInput');
  window.addEventListener('pointerup', onTalkUp);
  window.addEventListener('pointercancel', onTalkUp);
  window.addEventListener('keyup', function (ev) {
    if (ev.key === ' ' || ev.key === 'Enter') onTalkUp();
  });

  /* 知识库加载日志（模块 knowledge）。
     为什么放在这里而不是 knowledge.js 里：那是构建产物，手改会被覆盖。
     记的是「实际进前端的量」，与 index.json 的 ready 数对不上时就是构建出了问题。 */
  logAlways('知识库已加载', {
    slots: KB.slots.length,
    entries: Object.keys(ENTRIES).length,
    dataDate: KB.data_date,
    generatedAt: KB.generated_at || null,
    slotIds: KB.slots.map(function (s) { return s.id; }).join(',')
  });
  lg('debug', '运行环境', {
    logLevel: LOG ? LOG.stats().level : 'no-log',
    ttsModule: !!V,
    llmModule: !!LLM,
    ua: (window.navigator && window.navigator.userAgent || '').slice(0, 80)
  });

  /* 语音引擎探测：异步，不阻塞首屏。
     探测结果是「能力」判断，与「用户想不想听」是两件事：
     不支持时按钮仍渲染，点了给明确提示（不许静默失败）。 */
  if (V) {
    V.detect().then(function () {
      // 探测完才知道能不能读：不能读就把语速控件藏掉（调了也没用）
      var rateRow = document.getElementById('rateRow');
      if (rateRow) rateRow.hidden = !V.state.supported;
      if (!V.state.supported && V.state.unavailableReason) {
        // 只在用户已经进到紧急模式时才提示，避免日常首屏就被技术提示干扰
        if (state.mode === 'emergency') showVoiceNotice(V.state.unavailableReason);
      }
    });
  }

  if (!KB.slots.length) {
    el.dailyAnswer.innerHTML =
      '<article class="refuse"><p>内容正在准备中，暂时无法回答。</p>' +
      '<div class="dial-row"><a class="dial-btn" href="tel:120">拨打 120</a></div></article>';
  }

  // 供 tools/selftest_m1.mjs 调用，不参与界面渲染
  window.__M1__ = {
    detectDanger: detectDanger,
    bestMatch: function (t) { var e = bestMatch(t); return e ? e.id : null; },
    routeOf: function (t) {
      var r = routeOf(t);
      return {
        dangerId: r.danger ? r.danger.id : null,
        dangerNumber: r.danger ? r.danger.number : null,
        entryId: r.entry ? r.entry.id : null,
        dialOnly: !r.entry && !!r.targetId
      };
    },
    renderSteps: renderSteps,
    renderStepsCard: renderStepsCard,
    renderDaily: renderDaily,
    renderRefuse: renderRefuse,
    renderDialOnly: renderDialOnly,
    entries: ENTRIES,
    state: state,
    // 供自测与评测脚本调用：LLM 路由映射是纯函数，可离线断言
    applyLlmRoute: applyLlmRoute,
    handleQuerySync: handleQuerySync,
    handleQuery: handleQuery,        // 异步主路径，端到端验证用（含状态切换）
    speakSteps: speakSteps,          // 供语音自测调用
    speakDaily: speakDaily,          // 日常卡朗读（自动读摘要 / 手动读全文）
    speakTriage: speakTriage,        // 分诊卡手动重播（K2）
    // 语音输入（M2）：供自测断言能力探测与状态，不参与界面渲染
    asrState: ASR ? ASR.state : null,
    asrAvailable: !!ASR,
    // 供自测驱动完整语音流程（不真开麦克风）：看识别结果到底去了哪
    _talk: {
      ctl: talkCtl,
      up: onTalkUp,
      fill: fillInput,
      reset: talkReset
    },
    showVoiceNotice: showVoiceNotice,
    LLMAvailable: !!LLM,
    TTSAvailable: !!V,
    // 自动朗读的内部状态，供自测断言（不允许界面直接改）
    autoReadState: autoRead,
    kbMeta: { slots: KB.slots.length, entries: Object.keys(ENTRIES).length, data_date: KB.data_date }
  };
})();
