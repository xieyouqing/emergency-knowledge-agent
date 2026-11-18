/* =========================================================
   应急助手 · M1 交互逻辑
   数据来源：knowledge.js（由 tools/build_knowledge_js.py 生成，
            只含 status=published 的条目，构建期已过滤，前端不再判断）

   本文件实现的五条已定方案（docs/08-M1-范围与延后项.md）：
     决定1 = 预编译 JS，双击即开
     决定2 = 纯字符串三级匹配（alias > name > keyword 计数），不引入 embedding
     决定3 = 危险信号用独立关键词常量表，不读条目 keywords
             （未发布场景没有可读的 keywords，靠条目取词会漏判「着火了」）
     决定4 = 紧急模式命中但无条目 → 拨号专用卡，不给步骤（不违反 S1）
     决定5 = 日常模式只用 daily 四字段静态拼装，不调 LLM
   ========================================================= */
(function () {
  'use strict';

  var KB = window.KNOWLEDGE || { slots: [], entries: {}, data_date: '' };
  var ENTRIES = KB.entries || {};

  /* ---------- 决定3：危险信号关键词表 ----------
     覆盖 index.json 全部 10 个场景的典型口语说法。
     number 取 docs/02-数据契约 §4.1 候选池表的「默认主推号码」，
     未发布场景没有条目可读，故在此写死。
     已知代价（写进交付说明，不藏）：纯词命中即切紧急，
     所以「怎么预防燃气泄漏」这类日常提问也会切到紧急模式。
     这是 docs/01 §3.0「策略 C：宁可多切，不做降级」的直接后果。 */
  /* 命中顺序 = 优先级。数组靠前先命中即返回，所以顺序本身就是规则。
     2026-11-18 修复 B2：co_poisoning 必须在 gas_leak 之前。
       原因：「好像煤气中毒了」含「煤气」，gas_leak 在前会被误判成泄漏。
       但两者处置相反——泄漏是关阀+撤离(119)，中毒是搬离+通风(120)，判错方向比不答更危险。
       已验证「煤气漏了」「闻到煤气味」不含 co_poisoning 任何词，前移不会误伤。 */
  var DANGER_RULES = [
    { id: 'fire_home', number: '119', words: ['着火', '起火', '冒烟', '火灾', '火警', '烧起来', '着了', '烟很大', '有烟', '烧了', '扑火', '火势'] },
    { id: 'co_poisoning', number: '120', words: ['一氧化碳', '煤气中毒', '炭火', '烧炭', '炭盆', '煤炉', '头晕恶心', '头痛恶心', '中毒'] },
    { id: 'gas_leak', number: '119', words: ['燃气', '煤气', '天然气', '液化气', '漏气', '煤气味', '臭鸡蛋', '怪味', '异味', '气罐', '气瓶'] },
    { id: 'fall_elderly', number: '120', words: ['摔倒', '跌倒', '摔了', '起不来', '爬不起来', '摔伤', '跌了'] },
    /* 2026-11-18 修复 B1：补「烫起泡」类口语说法。
       原来只有「烫伤/开水烫/油烫/烫到/烫了」，「孩子被热水烫起泡了」一个都不含，
       导致孩子烫伤时系统回「我答不了」——该答不答是最糟的失败方式。
       不加单字「烫」：会让「麻辣烫怎么做」「烫头发」误命中急救，
       宁可漏几个怪说法，不可让无关问题触发急救卡。 */
    { id: 'scald_burn', number: '120', words: ['烫伤', '烧伤', '烧烫伤', '开水烫', '热水烫', '油烫', '烫到', '烫了', '烫起泡', '烫出泡', '被烫', '烫红'] },
    { id: 'electric_shock', number: '120', words: ['触电', '电到', '电击', '漏电', '被电', '电伤'] },
    { id: 'airway_obstruction', number: '120', words: ['噎住', '噎着', '卡住喉咙', '卡喉', '呼吸困难', '喘不上', '呛到', '窒息', '异物'] },
    { id: 'drowning', number: '120', words: ['溺水', '落水', '掉水里', '淹了', '淹死', '水里捞'] },
    { id: 'earthquake', number: '119', words: ['地震', '余震', '房子塌', '楼塌', '震了', '晃动'] },
    { id: 'elevator_trapped', number: '119', words: ['电梯', '困在', '关在里面', '电梯停', '被困'] }
  ];

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

  function norm(s) {
    return String(s || '').replace(/\s+/g, '').toLowerCase();
  }

  /* ---------- 决定2：三级匹配 ----------
     alias 命中 10 分（口语说法最可信）
     name  命中  9 分
     keyword 命中 4 + 命中个数（分数随命中数增长，但低于 name） */
  function scoreEntry(entry, text) {
    var t = norm(text);
    var best = 0;
    var aliases = entry.aliases || [];
    for (var i = 0; i < aliases.length; i++) {
      var a = norm(aliases[i]);
      if (!a) continue;
      if (t.indexOf(a) !== -1) { best = Math.max(best, 10); }
      else if (a.indexOf(t) !== -1 && t.length >= 2) { best = Math.max(best, 6); }
    }
    if (entry.name && t.indexOf(norm(entry.name)) !== -1) best = Math.max(best, 9);
    var kw = 0;
    (entry.keywords || []).forEach(function (k) {
      if (k && t.indexOf(norm(k)) !== -1) kw++;
    });
    if (kw > 0) best = Math.max(best, 4 + Math.min(kw, 4));
    return best;
  }

  function bestMatch(text) {
    var winner = null, top = 0;
    KB.slots.forEach(function (slot) {
      var e = ENTRIES[slot.id];
      if (!e) return;
      var s = scoreEntry(e, text);
      if (s > top) { top = s; winner = e; }
    });
    return top > 0 ? winner : null;
  }

  /* 中文没有词边界：「打不着火」含子串「着火」，会把汽车电瓶亏电误判成火灾。
     治法是对命中位置做否定前缀检查，而不是给每个词写特例。
     目前覆盖：不 / 没 / 别 / 未，「打不」单独处理（打不着火、打不燃）。 */
  var NEG_PREFIX = ['不', '没', '别', '未'];

  function hitNoNegation(text, word) {
    var w = norm(word);
    if (!w) return false;
    var idx = text.indexOf(w);
    while (idx !== -1) {
      var prev1 = idx > 0 ? text.charAt(idx - 1) : '';
      var prev2 = idx > 1 ? text.substr(idx - 2, 2) : '';
      var negated = NEG_PREFIX.indexOf(prev1) !== -1 || prev2 === '打不';
      if (!negated) return true;
      idx = text.indexOf(w, idx + 1);
    }
    return false;
  }

  function detectDanger(text) {
    var t = norm(text);
    for (var i = 0; i < DANGER_RULES.length; i++) {
      var r = DANGER_RULES[i];
      for (var j = 0; j < r.words.length; j++) {
        if (hitNoNegation(t, r.words[j])) return r;
      }
    }
    return null;
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
        '<div class="dial-row"><a class="dial-btn" href="tel:' + esc(num) + '">拨打 ' + esc(num) + '</a></div>' +
      '</article>';

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
    container.querySelectorAll('.triage-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var o = entry.triage.options[Number(btn.getAttribute('data-i'))];
        var override = o && o.override && o.override.immediate ? o.override.immediate : null;
        renderSteps(entry, override, container);
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

  function handleQuery(rawText) {
    var text = String(rawText || '').trim();
    if (!text) return;

    var r = routeOf(text);

    // S8：日常模式命中危险信号 → 强制切紧急，且不可回
    if (r.danger && state.mode === 'daily') enterEmergency();

    if (state.mode === 'emergency') {
      if (r.entry) {
        renderStepsCard(r.entry, el.emgAnswer);
      } else if (r.targetId) {
        // 命中了危险信号，但该场景还没有已发布条目
        renderDialOnly(r.danger.number || '120', el.emgAnswer);
      } else {
        renderRefuse(el.emgAnswer);
      }
      el.emgAnswer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (r.entry) renderDaily(r.entry, el.dailyAnswer);
    else renderRefuse(el.dailyAnswer);
    el.dailyAnswer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleIconClick(id) {
    var e = ENTRIES[id];
    if (!e) return;

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
    kbMeta: { slots: KB.slots.length, entries: Object.keys(ENTRIES).length, data_date: KB.data_date }
  };
})();
