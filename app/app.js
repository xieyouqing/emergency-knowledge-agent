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

  /* LLM 意图判定客户端（app/llm.js）。可选依赖：
     没加载或代理没起时，LLM 会是 undefined，全部逻辑回落 l3——
     接入 LLM 不得让应用变得「必须联网才能用」（docs/03 §5 三层兜底）。 */
  var LLM = window.LLM || null;

  /* 语音输出（app/voice.js）。同样是可选依赖：
     未加载或设备不支持时，朗读按钮仍然渲染，但点击会给出明确提示，
     绝不静默失败（docs/01 §6.2）。 */
  var V = window.TTS || null;

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

  function autoReadCard(entry, immediateSteps) {
    if (!canAutoRead()) return;
    speakSteps(entry, immediateSteps, { auto: true });
  }

  function autoReadTriage(entry) {
    if (!canAutoRead()) return;
    V.speak(V.composeTriageScript(entry), { force: true });
  }

  function muteAutoRead() {
    autoRead.muted = true;
    if (V) V.stop();
  }

  function unmuteAutoRead() {
    autoRead.muted = false;
  }

  /* 语音不可用时的显性提示。不用 alert（打断且老人容易误关），
     在卡片上方插一条常驻提示，可点掉。 */
  function showVoiceNotice(msg) {
    var host = el.emgAnswer;
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
    container.innerHTML =
      '<article class="card">' +
        '<h2 class="card-title">' + esc(entry.name) + '</h2>' +
        '<p class="triage-q">' + esc(entry.triage.question) + '</p>' +
        '<div class="triage-opts">' + opts + '</div>' +
      '</article>';
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
        '<button class="ghost-btn" type="button" id="toSteps">查看操作步骤</button>' +
      '</article>';

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

  /* 同步路径：l3 字符检索（接入 LLM 前的主路径，现在是降级路径） */
  function handleQuerySync(rawText) {
    var text = String(rawText || '').trim();
    if (!text) return;
    /* 新一次提问 = 新的意图表达，解除「按停止后的静默」。
       否则老人按过一次停止，后面所有场景就再也听不到声音，而他并不知道原因。 */
    unmuteAutoRead();
    var r = routeOf(text);
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

  /* 主路径：先问 LLM 意图判定，失败则同步回落 l3。
     为什么不在等待期间先出 l3 结果再替换：会让答案闪一下再变，
     对老人来说是「界面在乱跳」。宁可等 1 秒给一个确定答案。

     返回值：Promise，渲染完成后 resolve。浏览器里调用方可以忽略；
     端到端测试（tools/e2e_llm.mjs）必须能 await 到渲染结束，
     否则测的是「有没有发起请求」而不是「有没有渲染出内容」。 */
  function handleQuery(rawText) {
    var text = String(rawText || '').trim();
    if (!text) return Promise.resolve('empty');

    /* 两条路径（同步 l3 / 异步 LLM）都从这里进，故在此解除静默。
       handleQuerySync 里也有一处，重复调用是幂等的。 */
    unmuteAutoRead();

    if (!LLM || !LLM.judge) { handleQuerySync(text); return Promise.resolve('sync'); }

    return LLM.judge(text).then(function (verdict) {
      var lr = LLM.routeByVerdict(verdict, ENTRIES, detectDanger, text);

      // LLM 未参与（不可用/超时/结构不合法）→ 完全走原 l3
      if (!lr) { handleQuerySync(text); return 'fallback'; }

      var a = applyLlmRoute(lr);
      if (!a) { handleQuerySync(text); return 'fallback'; }

      // S8：LLM 判定为 ongoing 或命中了步骤/拨号 → 强制切紧急，且不可回
      var toEmergency = (verdict.intent === 'ongoing') || a.kind === 'steps' || a.kind === 'dialonly';
      if (toEmergency && state.mode === 'daily') enterEmergency();

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
    if (!e) return;

    // 点图标同样是一次新的意图表达，解除静默
    unmuteAutoRead();

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

  /* 语音引擎探测：异步，不阻塞首屏。
     探测结果是「能力」判断，与「用户想不想听」是两件事：
     不支持时按钮仍渲染，点了给明确提示（不许静默失败）。 */
  if (V) {
    V.detect().then(function () {
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
    showVoiceNotice: showVoiceNotice,
    LLMAvailable: !!LLM,
    TTSAvailable: !!V,
    // 自动朗读的内部状态，供自测断言（不允许界面直接改）
    autoReadState: autoRead,
    kbMeta: { slots: KB.slots.length, entries: Object.keys(ENTRIES).length, data_date: KB.data_date }
  };
})();
