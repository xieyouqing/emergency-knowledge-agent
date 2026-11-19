/* =========================================================
   应急助手 · 渲染层（纯渲染 + 事件绑定）
   从 app.js 拆出：原本 505–688 行，与状态、路由、语音混在一起。

   本层遵守一条硬规则（S1 / S7）：
     **所有可见文字只来自条目字段**（steps / never / daily / triage / name），
     本文件不做任何拼写改写，也不生成任何库外句子。
     唯一固定的自然语言是 REFUSE_TEXT，它是 S4 规定的拒答话术，不含操作动作。

   拆分带来的唯一行为变化（已在交付说明中列明）：
     渲染函数仍然会触发朗读（autoRead*），因为「出卡就念」是 M2 已验收的行为。
     后续工具化（docs/03 §2.5）会把朗读改为由调度器调用 speak 工具，
     届时删掉这里的三处 autoRead 调用即可，不需要改任何渲染结构。
   ========================================================= */
(function (global) {
  'use strict';

  var LOG = global.LOG || null;

  function lg(level, msg, fields) {
    if (!LOG) return;
    var t = LOG.tag('app');
    if (t[level]) t[level](msg, fields);
  }

  /* ⚠️ 朗读层必须**运行时取**，不能在加载期缓存到局部变量。
     踩过的坑（2026-11-19 拆分当天）：render.js 在 speak.js 之前加载，
     加载期写成 `var SPEAK = global.SPEAK` 会永久拿到 null，
     表现是「渲染正常、朗读全部静默」——13 条断言变红才发现。
     这正是 docs/10 §6 第 2 条「不能依赖 script 顺序」的实例。 */
  function speakLayer() {
    return global.SPEAK || null;
  }

  /* 朗读调用统一走这里：SPEAK 缺失时退化为静默 no-op。
     docs/10 §6 第 1 条「横切模块必须可摘除」——没加载 speak 时产品仍可用。 */
  function speak(what, entry, extra) {
    var S = speakLayer();
    if (!S || !S[what]) {
      lg('debug', '朗读层缺失，跳过', { what: what, entryId: entry && entry.id });
      return;
    }
    if (what === 'autoReadCard') S.autoReadCard(entry, extra);
    else S[what](entry);
  }

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------- 三段式步骤卡 ----------
     契约 §4.5：tool 全部忽略，只渲染 text。
     拨号按钮由 emergency_number 驱动，依据是 S5（生命危险场景须有显式拨号按钮），
     不是已删除的 S9。与步骤级 tool 无关。 */
  function renderSteps(entry, immediateSteps, container) {
    var segMap = [
      { key: 'immediate', title: '立刻做', cls: 'seg-immediate', checkable: true },
      { key: 'next', title: '接着做', cls: 'seg-next', checkable: true },
      { key: 'never', title: '绝对不要做', cls: 'seg-never', checkable: false },
    ];

    var body = segMap
      .map(function (seg) {
        var arr =
          seg.key === 'immediate' && immediateSteps ? immediateSteps : entry.steps[seg.key] || [];
        if (!arr.length) return '';
        var items = arr
          .map(function (step) {
            var text = esc(step.text);
            if (!seg.checkable) {
              return (
                '<li><div class="step" role="note">' +
                '<span class="box" aria-hidden="true">×</span>' +
                '<span class="txt">' +
                text +
                '</span></div></li>'
              );
            }
            return (
              '<li><button class="step" type="button" aria-pressed="false">' +
              '<span class="box" aria-hidden="true"></span>' +
              '<span class="txt">' +
              text +
              '</span></button></li>'
            );
          })
          .join('');
        return (
          '<section class="seg ' +
          seg.cls +
          '">' +
          '<h3 class="seg-head"><span class="bar" aria-hidden="true"></span>' +
          seg.title +
          '</h3>' +
          '<ul class="steps">' +
          items +
          '</ul></section>'
        );
      })
      .join('');

    var num = entry.emergency_number;
    container.innerHTML =
      '<article class="card">' +
      '<h2 class="card-title">' +
      esc(entry.name) +
      '</h2>' +
      body +
      '<div class="voice-row">' +
      '<button class="voice-btn" type="button" data-act="read" aria-label="朗读这张卡片">' +
      '<span class="voice-ico" aria-hidden="true">▸</span>朗读一遍' +
      '</button>' +
      '<button class="voice-btn is-stop" type="button" data-act="stop" aria-label="停止朗读">停止</button>' +
      '</div>' +
      '<div class="dial-row"><a class="dial-btn" href="tel:' +
      esc(num) +
      '">拨打 ' +
      esc(num) +
      '</a></div>' +
      '</article>';

    // 朗读：文本由 voice.js 从条目字段拼接，**不改写一个字**（S1）
    var readBtn = container.querySelector('[data-act="read"]');
    if (readBtn) {
      readBtn.addEventListener('click', function () {
        var S1 = speakLayer();
        if (S1) S1.speakSteps(entry, immediateSteps);
      });
    }
    var stopBtn = container.querySelector('[data-act="stop"]');
    if (stopBtn) {
      /* 按停止不只是这次停下，还要**本会话内不再自动读**。
         理由：自动朗读如果按了停还继续读，等于用户说「别念了」而系统不听。 */
      stopBtn.addEventListener('click', function () {
        var S4 = speakLayer();
        if (S4) S4.muteAutoRead();
      });
    }

    // 打勾：点一下切换，再点取消。按容器隔离 → 聊天流里多张卡片互不串状态
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
      speak('autoReadCard', entry, null);
      return;
    }
    var opts = entry.triage.options
      .map(function (o, i) {
        return (
          '<button class="triage-btn" type="button" data-i="' +
          i +
          '">' +
          esc(o.label) +
          '</button>'
        );
      })
      .join('');
    /* 分诊卡也要有朗读/停止（2026-11-19 修复 K2）。
       为什么必须补：gas_leak / earthquake / fall_elderly 三条走分诊，
       而**分诊卡就是它们的首屏**。没有这两个按钮，老人在首屏自动读完之后
       没听清就无法重播，响了也无法按停 —— M2 必做项 2「可重播、可打断」
       在这三条场景上不成立。 */
    container.innerHTML =
      '<article class="card">' +
      '<h2 class="card-title">' +
      esc(entry.name) +
      '</h2>' +
      '<p class="triage-q">' +
      esc(entry.triage.question) +
      '</p>' +
      '<div class="triage-opts">' +
      opts +
      '</div>' +
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
      readBtn.addEventListener('click', function () {
        var S2 = speakLayer();
        if (S2) S2.speakTriage(entry);
      });
    }
    var stopBtn = container.querySelector('[data-act="stop"]');
    if (stopBtn) {
      stopBtn.addEventListener('click', function () {
        var S4 = speakLayer();
        if (S4) S4.muteAutoRead();
      });
    }

    // 分诊阶段还没有步骤，只能读问题与选项
    speak('autoReadTriage', entry);
    container.querySelectorAll('.triage-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var o = entry.triage.options[Number(btn.getAttribute('data-i'))];
        var override = o && o.override && o.override.immediate ? o.override.immediate : null;
        renderSteps(entry, override, container);
        // 选完就读对应的步骤（override），不能读默认步骤
        speak('autoReadCard', entry, override);
      });
    });
  }

  /* ---------- 紧急命中但无条目 → 只给号码，不给步骤 ---------- */
  function renderDialOnly(number, container) {
    container.innerHTML =
      '<article class="dialonly">' +
      '<p class="headline">这个情况我没有可靠的操作步骤。</p>' +
      '<p>我不编步骤。请先打电话求救，接线员会一步步教你。</p>' +
      '<div class="dial-row"><a class="dial-btn" href="tel:' +
      esc(number) +
      '">拨打 ' +
      esc(number) +
      '</a></div>' +
      '</article>';
  }

  /* ---------- 拒答（S1 / S4：零步骤 + 固定话术 + 拨号按钮） ---------- */
  var REFUSE_TEXT =
    '这个问题我答不了。我只会说应急和安全的常识，比如燃气泄漏、老人跌倒、电梯困人。';

  function renderRefuse(container) {
    container.innerHTML =
      '<article class="refuse">' +
      '<p>' +
      esc(REFUSE_TEXT) +
      '</p>' +
      '<div class="dial-row"><a class="dial-btn" href="tel:120">拨打 120</a></div>' +
      '</article>';
  }

  /* ---------- 日常模式只用 daily 四字段拼装 ---------- */
  function renderDaily(entry, container) {
    var d = entry.daily || {};
    var prev = (d.prevention || [])
      .map(function (p) {
        return '<li>' + esc(p) + '</li>';
      })
      .join('');
    container.innerHTML =
      '<article class="card">' +
      '<h2 class="card-title">' +
      esc(entry.name) +
      '</h2>' +
      '<div class="explain">' +
      '<p class="lead">' +
      esc(d.summary || '') +
      '</p>' +
      (d.why ? '<p>' + esc(d.why) + '</p>' : '') +
      (prev ? '<p><b>平时怎么做</b></p><ul>' + prev + '</ul>' : '') +
      (d.misconception
        ? '<p class="misconception"><b>常见误区：</b>' + esc(d.misconception) + '</p>'
        : '') +
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
      readBtn.addEventListener('click', function () {
        var S3 = speakLayer();
        if (S3) S3.speakDaily(entry);
      });
    }
    var stopBtn = container.querySelector('[data-act="stop"]');
    if (stopBtn) {
      stopBtn.addEventListener('click', function () {
        var S4 = speakLayer();
        if (S4) S4.muteAutoRead();
      });
    }
    speak('autoReadDaily', entry);

    var btn = container.querySelector('#toSteps');
    if (btn) {
      btn.addEventListener('click', function () {
        renderStepsCard(entry, container);
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  global.RENDER = {
    esc: esc,
    renderSteps: renderSteps,
    renderStepsCard: renderStepsCard,
    renderDialOnly: renderDialOnly,
    renderRefuse: renderRefuse,
    renderDaily: renderDaily,
    REFUSE_TEXT: REFUSE_TEXT,
  };
})(typeof window !== 'undefined' ? window : globalThis);
