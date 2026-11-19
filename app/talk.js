/* =========================================================
   应急助手 · 语音输入（按住说话）
   从 app.js 拆出：原本 227–427 行，是 app.js 里最长的一段。

   依据 docs/01 §4.2：按住说话 → 云 ASR → 场景归一。

   为什么是「按住」而不是「点一下开始、再点结束」：用户裁决按住说话。
   为了让按住可用，实现上必须处理三件事：
     ① pointerup 可能发生在按钮外（手指滑出去了）→ 在 window 上监听
     ② 触摸设备要 touch-action:none，否则按下时页面跟着滚
     ③ 手指抖动导致提前松手 → MIN_MS 兜底提示「太短了」，不是静默丢弃

   依赖方向：talk → asr.js（录音）
             talk → app.js 的 handleQuery（**运行时**取，不在加载期取）
   ========================================================= */
(function (global) {
  'use strict';

  var LOG = global.LOG || null;
  var ASR = global.ASR || null;

  function lg(level, msg, fields) {
    if (!LOG) return;
    var t = LOG.tag('app');
    if (t[level]) t[level](msg, fields);
  }
  function logAlways(msg, fields) {
    if (LOG && LOG.always) LOG.always('app', msg, fields);
  }

  /* 识别结果要「填框 + 立即出答案」。
     这条是用户两次实测的合并结论：
       第一次：「你是不是没有连接文本框？问了也没用」→ 识别结果必须可见。
       第二次：「做成输入后直接出答案，不需要再确认」→ 不要多一步点击。
     两条不冲突：填框让老人看见自己说了什么、能改能重说，但不必先按一次「提问」。
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
    } catch (e) {
      /* ignore：某些输入类型不支持 setSelectionRange */
    }
    return true;
  }

  function setTalkHint(hintEl, msg, isInfo) {
    if (!hintEl) return;
    if (!msg) {
      hintEl.hidden = true;
      hintEl.textContent = '';
      return;
    }
    hintEl.hidden = false;
    hintEl.textContent = msg;
    hintEl.className = 'talk-hint' + (isInfo ? ' is-info' : '');
  }

  function setTalkBusy(btn, busy) {
    if (!btn) return;
    st().talk.busy = busy;
    btn.classList.toggle('is-busy', busy);
    btn.disabled = busy;
    var label = btn.querySelector('.talk-label');
    if (label) label.textContent = busy ? '正在识别…' : '按住说话';
  }

  function st() {
    return global.APP_STATE || { talk: { busy: false } };
  }

  /* 识别中要有确定性反馈（docs/01 §8 红线 1：不许无反馈等待）。
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

  /* ---------- 控制器 ----------
     两个模式各一个按钮，但**状态与 window 监听只有一份**。
     为什么：先前每个按钮各挂一个 pointerup，一次松手会触发两次 stop，
     第二次拿到 not-recording 又被当成失败提示；同时重复 start 让
     旧的 MediaStream 没关，多个音频流一起写缓冲，录出 26s/52s 的怪文件。 */
  var talkCtl = {
    btn: null,
    hint: null,
    input: null,
    downAt: 0, // 去重：pointerdown 与 keydown 可能同时打进来
    active: false,
    listening: false,
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
         没权限）必须说出来。这与语音输出的处置一致（docs/01 §6.2）。 */
      btn.classList.add('is-unavailable');
      setTalkHint(hint, cap.reason, true);
      lg('warn', '语音输入不可用', { reason: cap.reason });
    }

    function onDown(ev) {
      // 去重：同一次按下可能被 pointerdown 与 keydown 各触发一次
      var now = Date.now();
      if (now - talkCtl.downAt < 400) return;
      talkCtl.downAt = now;

      if (st().talk.busy) return;
      if (ev && ev.preventDefault) ev.preventDefault();

      if (!cap.supported) {
        setTalkHint(hint, cap.reason, true);
        return;
      }
      if (talkCtl.listening) return; // 已经在录，忽略

      /* 按住说话 = 明确的中断信号：正在念的内容立刻停。
         用 stopForAction 而不是 muteAutoRead —— 用户只是要问下一句，
         不是「以后都别念了」（2026-11-19 用户裁决）。 */
      var S = global.SPEAK;
      if (S && S.stopForAction) S.stopForAction('talk-down');

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
      if (ev.key === ' ' || ev.key === 'Enter') {
        ev.preventDefault();
        if (!ev.repeat) onDown(ev);
      }
    });
  }

  /* window 上的松手监听只挂一次（所有按钮共用）。
     理由：手指可能滑出按钮才松开，只挂按钮会永远收不到 pointerup，
     表现为「一直录到 15 秒上限」——实测踩过。

     返回值：Promise，在整条链（识别 → 填框 → 出答案 → 朗读）走完后 resolve。
     为什么要返回：测试必须能 await 到「真的出卡了」，而不是等一个固定毫秒数。
     实测踩过——e2e_asr 原来等 120ms，LLM 缓存命中时够用，清缓存后要 800–1800ms，
     测试立刻变成假失败。等完成信号永远比等时间可靠。 */
  function onTalkUp() {
    if (!talkCtl.active) return Promise.resolve('idle');
    if (!talkCtl.listening) {
      talkReset();
      return Promise.resolve('not-listening'); // start 就没成功，无需 stop
    }
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
        audioMs: r.duration_ms,
        latencyMs: r.latency_ms,
        filled: true,
        autoQuery: true,
      });
      /* 填框 + 立即出答案（用户裁决：不需要再确认）。
         填框不是为了「等确认」，是为了让老人看得见自己说了什么。
         填框失败时仍然出答案——绝不能因为界面结构变了就把识别结果吞掉。 */
      var filled = fillInput(input, r.text);
      if (!filled) lg('warn', '找不到输入框，直接提问（结果不丢）');
      /* handleQuery 由 app.js 在启动时注册到 window.APP_HANDLE_QUERY。
         运行时取（不缓存）是为了：app.js 最后加载，缓存会拿到 undefined。 */
      var hq = global.APP_HANDLE_QUERY;
      if (!hq) {
        lg('warn', 'handleQuery 未注册，识别结果仅填框');
        return 'no-handler';
      }
      /* 把 handleQuery 的 Promise 传出去，调用方才能 await 到「卡出完了」。 */
      return hq(r.text).then(function () {
        return 'done';
      });
    });
  }

  /* 录音到 15 秒上限时的接管：等同用户松手。
     没有这一步，自动停止后识别结果没人接，表现为「录了半天什么也没发生」。 */
  if (ASR)
    ASR.state.onAutoStop = function () {
      onTalkUp();
    };

  global.TALK = {
    ctl: talkCtl,
    initTalk: initTalk,
    onTalkUp: onTalkUp,
    talkReset: talkReset,
    fillInput: fillInput,
    setTalkHint: setTalkHint,
    available: !!ASR,
  };
})(typeof window !== 'undefined' ? window : globalThis);
