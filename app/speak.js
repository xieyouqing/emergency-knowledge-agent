/* =========================================================
   应急助手 · 朗读编排（speak 层）
   从 app.js 拆出：原本 8 个朗读相关函数散在 60–225 行，与渲染混在一起。

   职责边界（很重要）：
     本文件**只决定「读什么、什么时候读、读失败怎么办」**，
     不决定「文本怎么写」。文本一律由 voice.js 的 compose* 从条目字段拼接，
     本文件不改写一个字（S1：不许编）。

   依赖方向：speak → voice.js（compose/speak/stop）
             不依赖 render.js（避免「渲染调朗读、朗读调渲染」的加载期互锁）
   ========================================================= */
(function (global) {
  'use strict';

  var LOG = global.LOG || null;
  var V = global.TTS || null;

  function lg(level, msg, fields) {
    if (!LOG) return;
    var t = LOG.tag('app');
    if (t[level]) t[level](msg, fields);
  }

  /* 与 render.js 的 esc 等价。此处不引用 RENDER.esc：
     speak 在 render 之后加载只是当前约定，不该把「加载顺序」变成隐藏依赖
     （docs/10 §6 第 2 条明确禁止依赖 script 顺序）。开销是一次字符串替换，可忽略。 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function st() {
    return global.APP_STATE || { mode: 'daily', autoRead: { muted: false } };
  }

  /* 提示落在「用户正看着的那条消息」上。
     2026-11-19 改：聊天式界面下不再有两个视图可切换，
     改为「最新那条助手消息的气泡」；没有时退回消息流容器。
     落在不可见的地方等于没提示（docs/01 §6.2 静默失败，实测踩过）。 */
  function noticeHost() {
    var msgs = global.CHAT && global.CHAT.messages;
    if (msgs && msgs.length) {
      for (var i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') return msgs[i].el;
      }
    }
    var id = st().mode === 'emergency' ? 'emgAnswer' : 'dailyAnswer';
    return document.getElementById(id) || document.getElementById('msgFlow');
  }

  /* 语音不可用时的显性提示。不用 alert（打断且老人容易误关），
     在卡片上方插一条常驻提示，可点掉。 */
  function showVoiceNotice(msg) {
    var host = noticeHost();
    if (!host) return;
    var old = host.querySelector('.voice-notice');
    if (old) old.parentNode.removeChild(old);
    var div = document.createElement('div');
    div.className = 'voice-notice';
    div.setAttribute('role', 'alert');
    div.innerHTML =
      '<p>' +
      esc(msg) +
      '</p>' +
      '<button type="button" class="voice-notice-close">知道了</button>';
    var btn = div.querySelector('.voice-notice-close');
    if (btn)
      btn.addEventListener('click', function () {
        div.parentNode.removeChild(div);
      });
    host.insertBefore(div, host.firstChild);
  }

  /* ---------- 手动朗读：步骤卡 ---------- */
  /* opts.auto = true 时是「自动朗读」：失败要静默，不弹提示。 */
  function speakSteps(entry, immediateSteps, opts) {
    var isAuto = !!(opts && opts.auto);
    if (!V) {
      if (!isAuto) showVoiceNotice('这台设备的浏览器不支持语音朗读');
      return;
    }
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
     1. **只在紧急模式自动读步骤卡。** 日常解释按用户裁决只读名称+摘要。
     2. **自动读失败必须静默。** 浏览器自动播放策略可能拦截（无用户手势），
        此时弹「朗读失败」只会让人困惑——用户根本没主动要求朗读。
     3. **用户按过「停止」= 明确表示不想听。** 本会话内不再自动读，
        直到下一次提问或点图标（那是一次新的意图表达）。手动点「朗读一遍」不受限制。 */
  function canAutoRead() {
    if (!V || !V.state.supported || !V.state.enabled) return false;
    if (st().mode !== 'emergency') return false;
    if (st().autoRead.muted) return false;
    return true;
  }

  /* 自动朗读的「为什么读/为什么不读」必须留痕。
     2026-11-18 那次「打字不朗读」，症状是「什么也没发生」——
     没有这行日志，就只能靠读代码猜是哪一道门槛挡住的。 */
  function whyNoAutoRead() {
    if (!V) return 'voice-module-missing';
    if (!V.state.supported) return 'unsupported:' + (V.state.unavailableReason || 'unknown');
    if (!V.state.enabled) return 'user-disabled';
    if (st().mode !== 'emergency') return 'daily-mode-steps-card';
    if (st().autoRead.muted) return 'muted-after-stop';
    return 'unknown';
  }

  function autoReadCard(entry, immediateSteps) {
    if (!canAutoRead()) {
      lg('info', '自动朗读跳过（步骤卡）', {
        reason: whyNoAutoRead(),
        entryId: entry && entry.id,
      });
      return;
    }
    lg('debug', '自动朗读步骤卡', {
      entryId: entry && entry.id,
      triageOverride: !!immediateSteps,
    });
    speakSteps(entry, immediateSteps, { auto: true });
  }

  function autoReadTriage(entry) {
    if (!canAutoRead()) {
      lg('info', '自动朗读跳过（分诊卡）', {
        reason: whyNoAutoRead(),
        entryId: entry && entry.id,
      });
      return;
    }
    lg('debug', '自动朗读分诊卡', { entryId: entry && entry.id });
    V.speak(V.composeTriageScript(entry), { force: true });
  }

  /* 手动朗读分诊卡（K2 补）。与 autoReadTriage 的区别只在两处：
     ① 不受 mode 与静默位限制（用户明确点了按钮）
     ② 失败要给提示，不能静默 */
  function speakTriage(entry) {
    if (!V) {
      showVoiceNotice('这台设备的浏览器不支持语音朗读');
      return;
    }
    if (!V.state.supported) {
      showVoiceNotice(V.state.unavailableReason || '语音朗读暂不可用');
      return;
    }
    var script = V.composeTriageScript(entry);
    if (!script) return;
    V.speak(script, { force: true }).then(function (r) {
      if (r && !r.ok && r.reason !== 'cancelled') {
        showVoiceNotice(r.message || '朗读失败，请重试');
      }
    });
  }

  function muteAutoRead() {
    st().autoRead.muted = true;
    if (V) V.stop();
    lg('info', '本会话不再自动朗读（用户按了停止）');
  }

  function unmuteAutoRead() {
    if (st().autoRead.muted) lg('debug', '解除自动朗读静默（新一次意图表达）');
    st().autoRead.muted = false;
  }

  /* ---------- 朗读中断（2026-11-19 用户裁决） ----------
     用户原话：「朗读的话，每次回答生成后都自动触发，用户有别的动作就中断」

     中断（换问题 / 要拨号）：
       按住说话、提交文字、点图标、点追问选项、点拨打
     不中断：
       · 点打勾 —— 打勾是「跟着念的步骤做」，掐断等于不让他跟读
         （`01` §4.1 第 5 条的安全设计要求：防慌乱时重复操作）
       · 往上滚动看旧记录 —— 只是回看，不是换问题

     ★ 与 muteAutoRead 的区别（用错会造成事故）：
       muteAutoRead = **持久**状态，本会话内不再自动读，只有新提问才解除。
       本函数 = **只停当前这一条**，下一条回答照常播。
       若这里误用 muteAutoRead，老人按一次「按住说话」就再也听不到任何朗读，
       而且他不会知道原因（静默失败，`01` §6.2 禁止）。 */
  function stopForAction(what) {
    if (!V) return;
    V.stop();
    lg('debug', '朗读被用户动作中断', { action: what, muted: !!st().autoRead.muted });
  }

  /* ---------- 日常解释卡的朗读（2026-11-18 追加） ----------
     背景（实测发现）：老人打字提问，出的多是日常解释卡；原来这张卡
     一行语音代码都没有，于是「点图标会读、打字不读」——而打字才是真实使用方式。

     边界（用户裁决：只自动读名称+摘要）：
       - 自动读只念「场景名 + 一句摘要」，不念原因与清单。念长了老人会按停止，等于没读。
       - 「朗读一遍」按钮念全文。
       - 日常卡同样受「按停止后本会话不再自动读」约束。
     为什么日常卡不受 mode 限制：日常模式本身就是提问发生的模式，
     要求「先切紧急才出声」等于日常永远不出声。 */
  function canAutoReadDaily() {
    if (!V || !V.state.supported || !V.state.enabled) return false;
    if (st().autoRead.muted) return false;
    return true;
  }

  /* opts.auto = true 时是自动朗读：失败必须静默（同 speakSteps 的理由） */
  function speakDaily(entry, opts) {
    var isAuto = !!(opts && opts.auto);
    if (!V) {
      if (!isAuto) showVoiceNotice('这台设备的浏览器不支持语音朗读');
      return;
    }
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
        reason: !V
          ? 'voice-module-missing'
          : !V.state.supported
            ? 'unsupported:' + (V.state.unavailableReason || 'unknown')
            : !V.state.enabled
              ? 'user-disabled'
              : 'muted-after-stop',
        entryId: entry && entry.id,
      });
      return;
    }
    lg('debug', '自动朗读日常卡（只读名称+摘要）', { entryId: entry && entry.id });
    speakDaily(entry, { auto: true });
  }

  global.SPEAK = {
    speakSteps: speakSteps,
    autoReadCard: autoReadCard,
    autoReadTriage: autoReadTriage,
    speakTriage: speakTriage,
    canAutoRead: canAutoRead,
    canAutoReadDaily: canAutoReadDaily,
    speakDaily: speakDaily,
    autoReadDaily: autoReadDaily,
    muteAutoRead: muteAutoRead,
    unmuteAutoRead: unmuteAutoRead,
    stopForAction: stopForAction,
    showVoiceNotice: showVoiceNotice,
  };
})(typeof window !== 'undefined' ? window : globalThis);
