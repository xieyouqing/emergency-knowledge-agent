/* =========================================================
   应急助手 · 入口（路由 / 绑定 / 启动）
   2026-11-19 从 1022 行拆出，依据 docs/10 §7「往 app.js 加大功能时必须先拆」。
   拆分后本文件只做四件事：路由决策、模式切换、DOM 绑定、启动与导出。

   已迁出的部分（行为不变，只是搬家）：
     渲染（renderSteps / renderStepsCard / renderDaily / renderRefuse /
           renderDialOnly / esc）      → app/render.js
     朗读（speakSteps / autoRead* / speakDaily / speakTriage /
           muteAutoRead / showVoiceNotice）→ app/speak.js
     语音输入（initTalk / onTalkUp / clearInput / talkCtl）→ app/talk.js
     共享可变状态（mode / locked / autoRead / talk）    → app/state.js

   仍然留在这里的理由：它们需要同时知道「状态」和「渲染」，
   拆出去会产生双向依赖，反而更难读。

   五条已定方案（docs/08-M1-范围与延后项.md）：
     决定1 = 预编译 JS，双击即开
     决定2 = 纯字符串三级匹配（★ 实现已迁至 app/retrieval.js）
     决定3 = 危险信号用独立关键词常量表（★ 同上）
     决定4 = 紧急模式命中但无条目 → 拨号专用卡，不给步骤（不违反 S1）
     决定5 = 日常模式只用 daily 四字段静态拼装，不调 LLM
   ========================================================= */
(function () {
  'use strict';

  var KB = window.APP_KB || { slots: [], entries: {}, data_date: '' };
  var ENTRIES = KB.entries || {};
  /* 场景白名单：工具的前置条件门要用它判「模型是否自造了场景」。
     来源必须是注册表 slots，而不是 entries 的键 —— 前者含未发布槽位，
     后者只有已发布条目；用后者会让「未发布场景」被当成白名单外，
     从而走进 refuse 而不是 dialonly（S1 要求后者：给号码，不编内容）。 */
  var SCENE_IDS = (KB.slots || []).map(function (s) {
    return s.id;
  });

  /* ---------- 依赖：全部为可选，缺失即降级，不抛错 ----------
     唯一硬依赖是 retrieval.js：它是判定层的唯一实现，缺了就没有任何路由能力，
     与其静默降级成「什么都答不了」，不如启动即失败（保留原有 throw）。 */
  var R = window.RETRIEVAL;
  if (!R) {
    throw new Error('retrieval.js 未加载：index.html 中须在 app.js 之前引入');
  }
  var detectDanger = R.detectDanger;

  /* B 方案开关（2026-11-20）：首轮本地预置 lookup，把首轮模型往返从 2 次压到 1 次。
     **默认开**（2026-11-20 用户裁决）。要跑关闭基线，在加载本文件前设
     `window.ACT_SEED = false`；测试脚本用 `--no-seed` / `ACT_SEED=0`。
     为什么是全局开关而不是每轮参数：它影响的是「首轮要不要走快路径」，
     属部署/验收配置，不该由用户操作决定。 */
  var ACT_SEED = !(typeof window !== 'undefined' && window.ACT_SEED === false);

  var LOG = window.LOG || null;
  function lg(level, msg, fields) {
    if (!LOG) return;
    var t = LOG.tag('app');
    if (t[level]) t[level](msg, fields);
  }
  function logAlways(msg, fields) {
    if (LOG && LOG.always) LOG.always('app', msg, fields);
  }

  /* LLM 意图判定客户端。没加载或代理没起时 LLM 为 undefined，全部回落 l3——
     接入 LLM 不得让应用变得「必须联网才能用」（docs/03 §5 三层兜底）。 */
  var LLM = window.LLM || null;
  /* 语音输出 / 语音输入：同样是可选依赖。 */
  var V = window.TTS || null;
  var ASR = window.ASR || null;

  var RENDER = window.RENDER;
  if (!RENDER) {
    throw new Error('render.js 未加载：index.html 中须在 app.js 之前引入');
  }
  var SPEAK = window.SPEAK || null;
  var TALK = window.TALK || null;
  /* 工具调度器。可选依赖：缺失时 handleQuery 退回直连渲染（M2 行为）。
     为什么允许缺失：docs/10 §6 第 1 条「横切模块必须可摘除」，
     以及 selftest 的部分用例只测渲染、不需要调度器。 */
  var AGENT = window.AGENT || null;
  var esc = RENDER.esc;

  /* 本轮回答要显示的解释（2026-11-20）。
     为什么放模块作用域而不是 runActLoop 内部：execTool 是独立函数，
     读不到 runActLoop 的局部变量；而改 execTool 签名会波及所有调用点
     （含 selftest 里的同步调用），代价大于收益。
     并发安全性：产品同一时刻只有一个循环在跑（输入区在循环中禁用），
     所以这个单槽位够用。若将来支持并行提问，这里必须改成按 traceId 存。 */
  var _noteSlot = null;
  function currentNote() {
    return _noteSlot;
  }

  /* 上一条日常卡的 entry/host：用于「同场景追问不重复整卡」。
     只记最近一条；刷新即清。 */
  var _lastDaily = { entryId: null, host: null };

  /**
   * 渲染日常结果；若与上一条同 entry，则改出「还是这个条目」短通知。
   * @returns {boolean} true = 已去重（没有渲染整卡）
   */
  function renderDailyResult(entry, text, host) {
    if (!entry || !host) return false;
    var prev = _lastDaily;
    var prevStillDaily =
      prev.host &&
      prev.host !== host &&
      prev.host.innerHTML &&
      prev.host.innerHTML.indexOf('class="explain"') >= 0;
    if (prev.entryId === entry.id && prevStillDaily && RENDER.renderFollowupNotice) {
      RENDER.renderFollowupNotice(entry, text, host, prev.host);
      return true;
    }
    RENDER.renderDaily(entry, host);
    _lastDaily = { entryId: entry.id, host: host };
    return false;
  }

  /* ---------- 日常卡：expand 与自动朗读的协调（2026-11-22 用户裁决 A） ----------
     修的问题（用户真机报的）：
       静态卡一渲染就朗读**条目原文**，expand 稍后（实测 0.98–1.61s）返回并把
       屏幕上的 explain 换成**模型文本**，且以 { silent:true } 重渲染不重读。
       → 声音停在条目原文，屏幕已是模型文本。两者必然不一致，不是偶发竞争。

     做法：静态卡照旧先渲染（不给用户空白），但**先不朗读**，然后竞速：
       · expand 在 EXPAND_WAIT_MS 内返回 → 重渲染 + 用模型文本朗读，一次读对
       · 超时 → 保持静态卡 + 用条目原文朗读
       · 超时之后 expand 才回来 → **丢弃，连屏幕也不换**
         理由：一旦出声就是承诺。事后偷偷换掉屏幕文字，等于把刚才读的话作废，
         老人会以为自己听错。宁可少一段扩写，不能让人怀疑自己。

     EXPAND_WAIT_MS = 600 的依据：实测本地 expand 0.98 / 0.98 / 1.18 / 1.61s，
     线上更慢。600ms 不是「保证赶上」，而是「一部分能赶上，其余走安全分支」。
     ⚠️ 这 600ms 会加在首句出声之前，V6 的 3 秒预算是临界通过的（均值 1941ms、
     最大 2629ms），本改动后**必须重测**，不能沿用旧数据。 */
  var EXPAND_WAIT_MS = 600;

  function speakDailyAligned(entry, readText) {
    if (!SPEAK || !SPEAK.autoReadDaily) return;
    SPEAK.autoReadDaily(entry, readText ? { readText: readText } : undefined);
  }

  /* 首次出日常卡：去重判断 + 协调渲染。
     为什么和 renderDailyResult 分开：
       renderDailyResult 是「渲染 + 自动朗读」的一步到位版，用于同步 l3 路径
       （那条路径没有扩写，屏幕与声音天然同源）。
       loop / judge 路径有扩写，必须让扩写参与朗读决策，否则声音停在条目原文、
       屏幕已被模型文本替换。两条路径的差别就在这一步，故单列一个入口。
     @returns {boolean} true = 已去重（出的是「还是这个条目」短通知） */
  function renderDailyFirstTime(entry, text, host) {
    if (!entry || !host) return false;
    var prev = _lastDaily;
    var prevStillDaily =
      prev.host &&
      prev.host !== host &&
      prev.host.innerHTML &&
      prev.host.innerHTML.indexOf('class="explain"') >= 0;
    if (prev.entryId === entry.id && prevStillDaily && RENDER.renderFollowupNotice) {
      RENDER.renderFollowupNotice(entry, text, host, prev.host);
      return true;
    }
    _lastDaily = { entryId: entry.id, host: host };
    renderDailyCoordinated(entry, text, host);
    return false;
  }

  /* opts.noExpand：调用方已确定不走扩写（例如去重分支） */
  function renderDailyCoordinated(entry, text, host) {
    /* 1) 先渲染静态卡，且不朗读 —— 让用户立刻看到内容，不空白 */
    RENDER.renderDaily(entry, host, null, { silent: true });

    var canExpand = !!(LLM && LLM.expand && text);
    if (!canExpand) {
      speakDailyAligned(entry); // 没有扩写能力 → 屏幕与声音都是条目原文
      return;
    }

    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      lg('info', '扩写超时，日常卡按条目原文朗读', { waitMs: EXPAND_WAIT_MS, entryId: entry.id });
      speakDailyAligned(entry);
    }, EXPAND_WAIT_MS);

    LLM.expand(text, entry.id).then(
      function (r) {
        if (settled) {
          /* 已超时并已开始朗读 → 丢弃扩写结果。
             这里**不改屏幕**，是为了守住「读过的就是看到的」。 */
          lg('info', '扩写晚于朗读窗口，已丢弃', { entryId: entry.id });
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (!r || !r.ok || !r.text) {
          speakDailyAligned(entry);
          return;
        }
        /* 先换屏幕、再用同一段文本朗读：顺序不能反。
           反过来的话，朗读启动瞬间屏幕还是旧文本，又出现一次不一致。 */
        RENDER.renderDaily(entry, host, r, { silent: true });
        speakDailyAligned(entry, r.text);
      },
      function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        speakDailyAligned(entry);
      }
    );
  }

  /* ---------- 每步可见进展（M2.5，01 §4.25 第 2 条） ----------
     为什么放在输入区而不是消息流：
       消息流会被最终卡占位；进度是「过程中的临时状态」，不属于对话记录。
     为什么文案按动作分：
       红线 1 禁止无反馈的纯等待，但也禁止假反馈。查资料时说「正在查资料」，
       出内容时说「正在准备回答」——说的必须是这一步真的在做的事。 */
  function progressTextFor(act) {
    if (act === 'lookup_scene') return '正在查资料…';
    if (act === 'get_steps' || act === 'get_daily' || act === 'triage') return '正在准备回答…';
    if (act === 'dial') return '正在准备拨号…';
    if (act === 'ack') return '正在确认…';
    if (act === 'speak') return '正在准备朗读…';
    return '正在处理…';
  }
  function showProgress(text) {
    if (!el.progress) return;
    el.progress.textContent = text || '正在处理…';
    el.progress.hidden = false;
  }
  function hideProgress() {
    if (el.progress) el.progress.hidden = true;
  }

  /* ---------- 共享状态（定义在 state.js，这里只取引用） ---------- */
  var state = window.APP_STATE;
  if (!state) {
    throw new Error('state.js 未加载：index.html 中须在 app.js 之前引入');
  }

  /* ---------- DOM ---------- */
  /* 2026-11-19 聊天式改造后：不再有 dailyView / emergencyView 两个视图，
     答案容器由 CHAT.answerHost() 每条消息现建（动态接管 dailyAnswer/emgAnswer 这两个 id）。
     因此这里只留「跨消息常驻」的节点，答案容器一律运行时取。 */
  var el = {
    band: document.getElementById('modeBand'),
    dailyForm: document.getElementById('dailyForm'),
    emgForm: document.getElementById('emgForm'),
    dailyInput: document.getElementById('dailyInput'),
    emgInput: document.getElementById('emgInput'),
    dailyTalk: document.getElementById('dailyTalk'),
    emgTalk: document.getElementById('emgTalk'),
    msgIcons: document.getElementById('msgIcons'),
    progress: document.getElementById('progress'),
    auditPanel: document.getElementById('auditPanel'),
    auditBody: document.getElementById('auditBody'),
    auditToggle: document.getElementById('auditToggle'),
    auditClose: document.getElementById('auditClose')
  };

  /* ---------- 演示审计视图 ----------
     老人视图保持干净；评委点「审计」看模型做了什么。
     只展示代码实际拿到的字段（turn/evidence/act/args/result/来源），不推测。 */
  var _auditSteps = [];

  function auditOpen(on) {
    if (!el.auditPanel) return;
    el.auditPanel.hidden = !on;
    document.body.classList.toggle('audit-open', on);
    if (el.auditToggle) el.auditToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function auditReset(text) {
    _auditSteps = [];
    if (el.auditBody) {
      el.auditBody.innerHTML = '<p class="audit-empty">正在看：「' + esc(text || '') + '」</p>';
    }
  }

  function auditActLabel(act) {
    var m = {
      lookup_scene: '查库',
      get_steps: '步骤卡',
      get_daily: '日常卡',
      triage: '分诊',
      speak: '朗读',
      dial: '拨号',
      refuse: '拒答',
      ack: '确认',
      ask: '追问'
    };
    return m[act] || act;
  }

  function auditRecord(rec) {
    if (!rec) return;
    _auditSteps.push(rec);
    if (_auditSteps.length > 6) _auditSteps.shift();
    auditRender();
  }

  function auditRender() {
    if (!el.auditBody) return;
    if (!_auditSteps.length) {
      el.auditBody.innerHTML = '<p class="audit-empty">还没有工具调用。</p>';
      return;
    }
    var html = _auditSteps
      .map(function (rec) {
        var scene = rec.args && rec.args.scene ? rec.args.scene : '';
        var entry = scene && ENTRIES[scene] ? ENTRIES[scene] : null;
        var rows = [];
        if (rec.turn || rec.evidence) {
          rows.push(
            '<div class="audit-kv"><span class="audit-k">识别</span>' +
              esc(rec.turn || '') +
              (rec.evidence ? '（证据：「' + esc(rec.evidence) + '」）' : '') +
              '</div>'
          );
        }
        if (scene) {
          rows.push(
            '<div class="audit-kv"><span class="audit-k">场景</span>' +
              esc(entry ? entry.name : scene) +
              '</div>'
          );
        }
        rows.push(
          '<div class="audit-kv"><span class="audit-k">动作</span>' +
            esc(auditActLabel(rec.act)) +
            (rec.args && rec.args.number ? ' ' + esc(rec.args.number) : '') +
            (rec.ok === false ? '（被门拒绝：' + esc(rec.why || '') + '）' : '') +
            '</div>'
        );
        if (entry && entry.source && entry.source.name) {
          rows.push(
            '<div class="audit-kv"><span class="audit-k">来源</span><span class="audit-src">' +
              esc(entry.source.name) +
              '</span></div>'
          );
          if (entry.source.quote) {
            rows.push(
              '<div class="audit-quote">「' + esc(String(entry.source.quote).slice(0, 70)) + '…」</div>'
            );
          }
        }
        if (entry && entry.life_threatening) {
          rows.push(
            '<div class="audit-kv"><span class="audit-k">S5</span>生命危险：同时拨打 ' +
              esc(entry.emergency_number || '120') +
              '</div>'
          );
        }
        return (
          '<div class="audit-step' +
          (rec.ok === false ? ' is-bad' : '') +
          '">' +
          rows.join('') +
          '</div>'
        );
      })
      .join('');
    el.auditBody.innerHTML = html;
  }

  var CHAT = window.CHAT || null;
  if (!CHAT) {
    throw new Error('chat.js 未加载：index.html 中须在 app.js 之前引入');
  }

  /* 取「这一条回答」的容器：每次调用都新建一条助手消息。
     为什么要现建而不是复用固定容器：聊天式要求旧消息留在上面可回看，
     复用固定容器会把上一条覆盖掉（原来的 innerHTML = 就是这种行为）。 */
  function answerHost(kind) {
    return CHAT.answerHost(kind, state.mode);
  }

  /* ---------- 决定2：场景检索（实现已迁至 retrieval.js） ----------
     production 默认引擎 = l3（字符规则分），与 M1 基线逐条一致；
     bm25 / hybrid 仅供评测切换，改默认值须提案（docs/03 §7.1 D-3）。 */
  function bestMatch(text) {
    var r = R.retrieve(ENTRIES, text);
    return r.entryId ? ENTRIES[r.entryId] || null : null;
  }

  /* ---------- 模式切换（S8） ----------
     2026-11-19 聊天式改造：不再隐藏/显示两个视图（那样旧内容会消失），
     改为三件事同时发生：
       ① 顶部色带出现（不可手动关闭）
       ② 底部输入区切到紧急样式与文案（紧急态只呈现按住说话，emgForm 仅作语音识别桥接）
       ③ state.mode 变 emergency —— 之后每一条消息都带 is-emergency 标记
     回看旧消息不受影响：它们各自带自己的 mode 标记，不会被改成紧急样式。 */
  function enterEmergency() {
    if (state.locked) return;
    state.locked = true;
    state.mode = 'emergency';
    /* D-11 = A（2026-11-20）：旧助手消息保留但置灰、不可交互。
       调用点必须在新结果 answerHost() 之前 —— 见 chat.js lockOldMessages 注释。 */
    if (CHAT && CHAT.lockOldMessages) CHAT.lockOldMessages();
    el.band.hidden = false;
    el.dailyForm.hidden = true;
    el.emgForm.hidden = false;
    if (el.dailyTalk) el.dailyTalk.hidden = true;
    if (el.emgTalk) el.emgTalk.hidden = false;
    document.body.classList.add('is-emergency');
    /* S8 是「进得去出不来」的锁，切换必须留痕（含是谁触发的）。
       2026-11-20 改 always：默认日志级别是 warn，info 会被过滤；
       这是用户可见的状态切换，不能因为级别设置而消失。 */
    logAlways('切紧急模式并锁定', { locked: true, trace: LOG ? LOG.getTrace() : null });
  }

  /* ---------- 退出紧急（S8 显式退出，2026-11-20 用户裁决 B） ----------
     只有用户明确说「已经安全/脱困/火灭了」→ 模型出 ack 卡 → 用户点两次确认，
     才会走到这里。日常问题**不会**触发退出，S8 的「不自动回落」仍成立。
     退出后：模式回 daily、红色带收起、输入区切回日常、旧消息恢复可交互。 */
  function exitEmergency(container) {
    if (!state.locked && state.mode === 'daily') return false;
    if (SPEAK && SPEAK.stopForAction) SPEAK.stopForAction('exit-emergency');
    state.locked = false;
    state.mode = 'daily';
    el.band.hidden = true;
    el.dailyForm.hidden = false;
    el.emgForm.hidden = true;
    if (el.dailyTalk) el.dailyTalk.hidden = false;
    if (el.emgTalk) el.emgTalk.hidden = true;
    if (el.progress) el.progress.hidden = true;
    document.body.classList.remove('is-emergency');
    if (CHAT && CHAT.unlockOldMessages) CHAT.unlockOldMessages();
    if (container) {
      /* ack 卡自己也在紧急消息里；退出后把红边摘掉，并换成一句明确的结束语。 */
      var bubble = container.parentNode;
      if (bubble && bubble.classList) bubble.classList.remove('is-emergency');
      container.innerHTML =
        '<article class="refuse ack">' +
        '<p class="headline">已回到日常</p>' +
        '<p>可以继续提问。</p>' +
        '</article>';
    }
    logAlways('退出紧急模式（用户显式确认）', { locked: false, trace: LOG ? LOG.getTrace() : null });
    return true;
  }

  /* ---------- 图标区 ----------
     聊天式下图标区只有一处（消息流顶部那条欢迎消息里），不再是两处。
     图标点了直接出步骤卡 —— 不经过判定层，这是最快的一条路（docs/01 §3.3）。 */
  function renderIcons() {
    if (!el.msgIcons) return;
    /* 首屏只放前 4 个最常用场景：一次铺开 16 个，老人反而不知道点哪个。
       其余收进「更多场景」，展开后仍是全部 16 个。 */
    var top = KB.slots.slice(0, 4);
    var extra = KB.slots.slice(4);
    function iconBtn(s, extraClass) {
      return (
        '<button class="icon-btn' +
        (extraClass || '') +
        '" type="button" data-id="' +
        esc(s.id) +
        '">' +
        '<span class="icon-label">' +
        esc(s.name) +
        '</span>' +
        '</button>'
      );
    }
    var html = top.map(function (s) {
      return iconBtn(s, '');
    }).join('');
    if (extra.length) {
      html += extra
        .map(function (s) {
          return iconBtn(s, ' is-extra');
        })
        .join('');
      html +=
        '<button class="icon-more" type="button" data-more="1">更多场景（' +
        extra.length +
        '）</button>';
    }
    if (!html) {
      html = '<p class="section-label">内容正在准备中</p>';
    }
    el.msgIcons.innerHTML = html;
  }

  /* ---------- 查询入口 ---------- */
  /* 路由决策单独抽出：界面与自测脚本共用同一条判断链，避免两处逻辑不同步 */
  function routeOf(text) {
    /* 回合策略：hypothetical / prevention 是预案，不是现场；绕开 danger，
       直接按检索命中出日常解释。否则「如果发生火灾怎么办」「怎么预防煤气泄漏」
       都可能被关键词带成 steps 并锁进紧急。 */
    if (R.isDeniedFire && R.isDeniedFire(text)) {
      return { danger: null, targetId: null, entry: null };
    }
    var policy = R.turnPolicy ? R.turnPolicy(text) : null;
    if (policy && policy.allowSteps === false) {
      return { danger: null, targetId: null, entry: bestMatch(text) || null };
    }
    /* 与 planRule 同口径：断网/回落 judge 时也必须先认危重状态，
       否则「没有呼吸」会被 bestMatch 成日常卡，「摔倒+没呼吸」会被分诊成跌倒。 */
    if (R.isUnresponsiveWithBreathing && R.isUnresponsiveWithBreathing(text)) {
      return { danger: { id: 'cpr', number: '120' }, targetId: 'cpr', entry: null };
    }
    var severe = R.detectSevere ? R.detectSevere(text) : null;
    if (severe) {
      var isBleeding = /大出血|流血不止|止不住血/.test(severe);
      var severeScene = isBleeding ? 'severe_bleeding' : 'cpr';
      if (R.isMinorBleeding && R.isMinorBleeding(text)) {
        return { danger: null, targetId: null, entry: null };
      }
      var outOfScope =
        !isBleeding && R.isCprOutOfScope ? R.isCprOutOfScope(text) : null;
      if (outOfScope === 'drowning' && ENTRIES.drowning) {
        severeScene = 'drowning';
        outOfScope = null;
      }
      return {
        danger: { id: severeScene, number: '120' },
        targetId: severeScene,
        entry: outOfScope ? null : ENTRIES[severeScene] || null,
      };
    }
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
        if (R.DANGER_RULES[i].id === lr.sceneId) {
          rule = R.DANGER_RULES[i];
          break;
        }
      }
      return { kind: 'dialonly', number: (rule && rule.number) || '120' };
    }
    return { kind: 'refuse' };
  }

  function renderByAction(a, container) {
    if (a.kind === 'steps' && a.entry) RENDER.renderStepsCard(a.entry, container);
    else if (a.kind === 'daily' && a.entry) RENDER.renderDaily(a.entry, container);
    else if (a.kind === 'dialonly') RENDER.renderDialOnly(a.number, container);
    else if (a.kind === 'ack' && RENDER.renderAck) RENDER.renderAck(container, exitEmergency);
    else RENDER.renderRefuse(container);
  }

  /* =========================================================
     工具化接线（2026-11-19，docs/03 §2.5）
     把「工具执行结果」翻译成渲染调用。这是 AGENT 与 RENDER 之间唯一的桥。

     ★ 为什么 exec 里还要调 RENDER 的 autoRead：
       用户裁决「朗读每次回答生成后自动触发」，而 RENDER 现在就是这么做的。
       工具化之后 speak 成了独立工具，但「出卡即读」这个时机不变，
       所以这里不重复调 speak，避免读两遍。
       speak 工具留给「模型明确要求补读某段」的场景（如分诊后重读问题）。
     ========================================================= */
  function execTool(rec, res, host) {
    if (!res || !res.ok) return;

    if (res.kind === 'steps') {
      RENDER.renderStepsCard(res.entry, host, currentNote());
      return;
    }
    if (res.kind === 'daily') {
      RENDER.renderDaily(res.entry, host);
      return;
    }
    if (res.kind === 'triage') {
      RENDER.renderStepsCard(res.entry, host, currentNote()); // 有分诊时它会出分诊卡
      return;
    }
    if (res.kind === 'dial') {
      if (res.requested && state.mode === 'daily' && RENDER.renderCallRequest) {
        RENDER.renderCallRequest(res.number, host);
      } else {
        RENDER.renderDialOnly(res.number, host);
      }
      return;
    }
    if (res.kind === 'ack') {
      RENDER.renderAck(host, exitEmergency);
      return;
    }
    if (res.kind === 'refuse') {
      RENDER.renderRefuse(host);
      return;
    }
    if (res.kind === 'speak') {
      // 只按条目字段朗读，绝不念自由文本（S1/S7）
      var entry = ENTRIES[rec.args.entry_id];
      if (!entry || !SPEAK) return;
      if (rec.args.segment === 'triage') SPEAK.speakTriage(entry);
      else if (rec.args.segment === 'daily') SPEAK.speakDaily(entry);
      else SPEAK.speakSteps(entry, null);
    }
  }

  /* 把**已经算好的** LLM 路由结论翻译成工具计划。
     ⚠️ 2026-11-19 踩过的坑（e2e_llm 全部落到 steps）：
        第一版在这里又调了一次 LLM.routeByVerdict(verdict, ENTRIES, detectDanger, null)，
        第 4 个参数 text 传了 null → 内部的 danger-override 分支拿不到原文，
        且低置信度分支被二次判定覆盖，结果库外问题全变成 steps 卡。
        正确做法：**不重复判定**，直接消费调用方已经得到的 lr。

     这一步也是「工作流」与「自主循环」的接缝：
       现在：模型给 intent/scene，代码按固定规则映射到 act（一步到位）
       将来：模型直接给 act（需要代理新增 /act 端点，见 docs/03 §2.5.12 D-12）
     两种方式产出的 plan 进入同一个调度器，所以调度器本身不用改。 */
  function planFromRoute(lr) {
    if (!lr) return null;

    if (lr.action === 'steps' && lr.entryId) {
      return [
        { act: 'lookup_scene', args: { scene: lr.entryId }, why: 'llm-lookup' },
        { act: 'get_steps', args: { scene: lr.entryId }, why: lr.reason || 'llm-ongoing' }
      ];
    }
    if (lr.action === 'daily' && lr.entryId) {
      return [
        { act: 'lookup_scene', args: { scene: lr.entryId }, why: 'llm-lookup' },
        { act: 'get_daily', args: { scene: lr.entryId }, why: lr.reason || 'llm-prevention' }
      ];
    }
    if (lr.action === 'dialonly') {
      var rule = null;
      for (var i = 0; i < R.DANGER_RULES.length; i++) {
        if (R.DANGER_RULES[i].id === lr.sceneId) {
          rule = R.DANGER_RULES[i];
          break;
        }
      }
      return [
        {
          act: 'dial',
          args: { number: (rule && rule.number) || '120' },
          why: lr.reason || 'llm-unpublished'
        }
      ];
    }
    // 低置信度 / 库外 / 无场景 → 一律拒答，不给任何内容（S1）
    return [{ act: 'refuse', args: { reason: lr.reason || 'llm-off-scope' }, why: 'llm-refuse' }];
  }

  function scrollToAnswer(container) {
    /* 定位到**本轮用户气泡的顶部**，不是消息流最底部（2026-11-21 用户裁决）。
       原因：滚到底会把刚出的答案推到视口之上，老人只看到答案末尾，
       得自己往回翻才找得到开头。定位到气泡顶部则是「我说的话在上面，
       答案紧接着往下」，顺着读就行。

       只在「用户主动发起」时调用；系统追加的消息不强制滚动，
       否则老人正读到第 3 步会被拽走（docs/03 §2.5.8）。

       两级兜底：
         ① 有用户气泡 → 滚到它顶部（扣掉 sticky 头条的高度）
         ② 找不到用户气泡（极端路径，如直接点场景图标而 appendUser 失败）
            → 退回滚到底部，至少让新内容可见

       ⚠️ 传 false（瞬时）：手机上键盘收起动画会与 smooth 滚动抢同一帧，
       落点停在中间 = 用户看到的「没滚到对话记录」。
       另外真正让滚动失效的原因是选错了容器（见 chat.js 的实测数据）。 */
    if (CHAT) {
      if (CHAT.scrollToLatestUser(false)) return;
      CHAT.scrollToEnd(false);
      return;
    }
    if (container && container.scrollIntoView)
      container.scrollIntoView({ behavior: 'auto', block: 'start' });
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
       否则会沿用上一次提问的 trace，日志串起来就是错的。 */
    if (LOG && !(opts && opts.keepTrace)) LOG.setTrace(LOG.newTrace('q'));
    /* 新一次提问 = 新的意图表达，解除「按停止后的静默」。
       否则老人按过一次停止，后面所有场景就再也听不到声音，而他并不知道原因。 */
    if (SPEAK) SPEAK.unmuteAutoRead();
    /* 用户原话进消息流：老人要能回看自己说过什么（用户裁决「可查看对话记录」）。
       opts.noEcho 供 e2e / 自测用：它们只关心回答，不希望多一条用户气泡影响断言。 */
    if (CHAT && !(opts && opts.noEcho)) CHAT.appendUser(text);
    var r = routeOf(text);
    logRoute('l3', text, r);
    if (r.danger && state.mode === 'daily') enterEmergency();
    if (state.mode === 'emergency') {
      var ec = answerHost(r.entry ? 'steps' : r.targetId ? 'dialonly' : 'refuse');
      if (r.entry) RENDER.renderStepsCard(r.entry, ec);
      else if (r.targetId) RENDER.renderDialOnly(r.danger.number || '120', ec);
      else RENDER.renderRefuse(ec);
      scrollToAnswer(ec);
      return;
    }
    var dc = answerHost(r.entry ? 'daily' : 'refuse');
    if (r.entry) renderDailyResult(r.entry, text, dc);
    else RENDER.renderRefuse(dc);
    scrollToAnswer(dc);
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
      kind: r.entry
        ? state.mode === 'emergency'
          ? 'steps'
          : 'daily'
        : r.targetId
          ? 'dialonly'
          : 'refuse'
    });
  }

  /* =========================================================
     自主循环：模型选工具 → 代码校验执行 → 观察回灌 → 再选
     依据 docs/03 §2.5，用户裁决「8 个工具统一由循环调用」。

     ★ 三条安全约束（缺一条都不许上线）
       1. 每一步都过 TOOLS.checkGate。模型给的动作用代码校验，不信它自报。
       2. 被门拒绝 → 走安全出口（refuse / dial），**不许硬给内容**。
       3. 任一步异常 → 回落 judge 单次判定，保证「循环挂了也能答」。

     ★ 为什么 history 要回灌给模型：
       模型看不到「我已经查过了」就会重复查同一条，或者越过前置条件。
       history 里只有动作名、参数、结构化结果，不含卡片 HTML ——
       一段卡片 HTML 有 500+ 字，塞进 prompt 会让每步都变慢且更贵。

     ★ 追问（ask）怎么处理：
       模型给 ask 时循环暂停，把选项渲染成按钮；用户点选后由 onAskChoice
       把选择作为新的一条 user 输入重新进循环（带之前的 history）。
       这样「追问」不需要循环自己保存会话状态，复用现有的输入通道。 */
  /* ---------- B：首轮本地预置（2026-11-20，默认关） ----------
     目标：把首轮 `/act` 的 2 次模型往返（lookup → 出内容）压到 1 次。
     为什么只在首轮：后续轮已经由 A 解决记忆问题，且语义更复杂；
     首轮是 3 秒预算最紧的一轮，收益最大、风险面最小。

     三条出口：
       ① 危重词命中 → 本地 dial（0 次模型；与 ACT_PROMPT 规则 7 同向）
       ② 场景词 + 进行时词命中 → 预置 lookup_scene，模型 1 次决策出内容
       ③ 其余 → 原样走 2 次，不猜

     ⚠️ 不能用整张 DANGER_RULES 预置：它含场景名词本身，
        「怎么预防煤气泄漏」会被预置成 gas_leak，重演旧 bug。
        决策逻辑在 retrieval.js 的 seedDecision（可脱离 DOM 离线测），
        这里只把结果翻译成 AGENT 能执行的 plan / history。 */
  function seedFor(text) {
    if (!ACT_SEED || !R.seedDecision) return null;
    var d = R.seedDecision(text, ENTRIES);
    if (!d) return null;

    if (d.kind === 'dial') {
      return {
        kind: 'plan',
        plan: [{ act: 'dial', args: { number: d.number || '120' }, why: 'seed-' + d.why }],
      };
    }

    var entry = ENTRIES[d.scene];
    if (!entry) return null;
    return {
      kind: 'history',
      history: [
        {
          act: 'lookup_scene',
          args: { scene: d.scene },
          ok: true,
          result: { found: true, published: true, entry_id: entry.id },
          why: 'seed-' + d.why,
        },
      ],
    };
  }

  function runActLoop(text, context, seed) {
    var host = null;
    /* seed.history：本地已查过的场景，直接作为循环起点。
       它满足 tools.js 的 `lookup_scene` 前置条件，所以模型下一步可直接出内容；
       同一场景若模型仍想重查，会被 isRepeatedAct 拦住（已有结果，重查无新信息）。 */
    var history = seed && seed.kind === 'history' ? seed.history.slice() : [];
    var t0 = Date.now();
    /* 第一轮决策的解释（2026-11-20 用户裁决「按危险定优先级，但要同时给出解释」）。
       为什么取**第一轮**而不是导致出卡的那一轮：
         出卡那轮的 reason 必然是「已查到条目，输出步骤」这类无信息量的话；
         真正解释「为什么先处理这件事」的是第一轮选场景时的判断。
       为什么存到模块级 _noteSlot：execTool 是独立函数，读不到这里的局部变量。 */
    _noteSlot = null;
    /* 回合策略：本地判「预案/预防/现场」，作为工具约束传给代理与调度器。
       模型仍自主选工具，但允许集合被 workflow 收窄。 */
    var policy = R.turnPolicy ? R.turnPolicy(text) : null;
    /* 同步先显示：模型第一次往返要 0.8–1.5s，这期间必须有可见反馈。
       文案是真的「正在处理」，不是「请稍等，正在思考」。 */
    showProgress('正在处理…');

    function decide(t, ctx) {
      return LLM.act(t, ctx.history || [], context, policy).then(function (r) {
        if (!r || !r.ok) throw new Error(r && r.error ? r.error : 'act 不可用');
        if (_noteSlot === null && r.note) _noteSlot = r.note;
        return { act: r.act, args: r.args, why: r.reason, turn: r.turn, evidence: r.evidence };
      });
    }

    function exec(rec, res) {
      if (!res || !res.ok || !res.kind) return;
      /* 只要产出终态/追问/分诊卡，进度就让位给真实内容。 */
      hideProgress();

      /* ⚠️ 顺序必须「先切模式，再建容器、再渲染」。
         2026-11-19 修（e2e_voice「煤气漏了」应发声 1 次实际 0 次）：
         第一版是先渲染后切模式，而 speak.js 的 canAutoRead() 会检查
         `state.mode !== 'emergency'` → 渲染发生时模式还是 daily → 自动朗读被跳过。
         症状是「卡出来了但不出声」，正是 docs/01 §6.2 禁止的静默失败。
         另外 host 的 id 也取决于 mode（dailyAnswer / emgAnswer），必须先切。 */
      var toEmg = res.kind === 'steps' || res.kind === 'dial' || res.kind === 'triage';
      /* 用户明确要求拨号（requested）且当前句没有危险信号：
         只出「现在拨打 N」卡，不锁紧急。若句子里有现场危险，仍按紧急处理。 */
      if (res.kind === 'dial' && res.requested) {
        var hasDanger =
          (R.detectDanger && R.detectDanger(text)) ||
          (R.detectSevere && R.detectSevere(text));
        if (!hasDanger) {
          toEmg = false;
          lg('info', '显式拨号请求：只出拨号卡，不锁紧急', { number: res.number, text: text });
        }
      }
      if (toEmg && state.mode === 'daily') enterEmergency();

      if (!host) host = answerHost(res.kind);

      if (res.kind === 'ask') {
        renderAsk(res.result, host);
        return;
      }
      /* 日常：同一 entry 的追问不再重复整卡；只有第一次出完整卡。 */
      if (res.kind === 'daily' && res.entry) {
        /* 走协调入口：它内部自己做去重判断，首次出卡时静态先渲染、
           expand 与朗读竞速，保证「读什么就看什么」。 */
        renderDailyFirstTime(res.entry, text, host);
        return;
      }
      execTool(rec, res, host);

      /* 口头确认一次就退出：ack 是模型判「用户明确说解除」，
         再用本地 isResolved 复核原话。不明确 → 保持紧急，只留单按钮兜底。 */
      if (res.kind === 'ack' && R.isResolved && R.isResolved(text)) {
        exitEmergency(host);
      }
    }

    return AGENT.run(
      text,
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: history, policy: policy },
      {
        decide: decide,
        exec: exec,
      /* 每执行完一步更新一次，让老人知道系统还在动，而不是卡死。 */
      onStep: function (rec) {
        showProgress(progressTextFor(rec.act));
        auditRecord(rec);
      },
      /* seed.plan：危重/无条目时已由本地决定拨号，0 次模型往返。
         AGENT.run 见到 o.plan 会直接执行，不再调 decide。 */
      plan: seed && seed.kind === 'plan' ? seed.plan : undefined
    })
      .then(function (out) {
        hideProgress();
        lg('info', '自主循环完成', {
          endKind: out.endKind,
          steps: out.steps.length,
          degraded: out.degraded,
          reason: out.reason,
          ms: Date.now() - t0,
          acts: out.steps.map(function (s) {
            return s.act;
          })
        });

        /* 何时该回落单次判定：判据是「循环的失败是否属于**模型侧**失效」，
           而不是「有没有产出卡」。

           ⚠️ 2026-11-19 修（selftest 里「煤气漏了怎么办」不再切紧急）：
           第一版只看 `!host`，但 decide 失败时 finishSafe 会渲染一张 refuse 卡，
           host 因此不为 null → 阻断回落 → 用户拿到的是一张「答不了」的卡，
           而本来 judge 路径能正确识别紧急。**用「有没有卡」判断失败是错的。**

           模型侧失效的三种 reason（见 agent.js）：decide-error / decide-empty / no-decide
           —— 这些说明「没问到模型」，与「模型说这题该拒答」是两件事，必须分开。 */
        var modelSideFail =
          out.reason === 'decide-error' || out.reason === 'decide-empty' || out.reason === 'no-decide';

        if (modelSideFail || !host) {
          lg('warn', '循环未取得模型结论，回落单次判定', { reason: out.reason, hasHost: !!host });
          return LLM.judge(text).then(function (verdict) {
            return renderVerdict(text, verdict);
          });
        }
        scrollToAnswer(host);
        return out.endKind || 'loop';
      })
      .catch(function (e) {
        hideProgress();
        lg('warn', '自主循环异常，回落单次判定', { error: String((e && e.message) || e) });
        return LLM.judge(text).then(function (verdict) {
          return renderVerdict(text, verdict);
        });
      });
  }

  /* 渲染追问卡：两个大按钮，点选后作为新输入重新进循环。
     为什么不用模态框：老人容易被遮罩层困住；直接渲染在消息流里，
     他还能往上翻看之前的对话。 */
  function renderAsk(result, container) {
    var opts = (result.options || []).slice(0, 2);
    var btns = opts
      .map(function (o, i) {
        var label = typeof o === 'string' ? o : o && o.label ? o.label : String(o);
        return '<button class="ask-choice" type="button" data-i="' + i + '">' + esc(label) + '</button>';
      })
      .join('');
    container.innerHTML =
      '<article class="card ask-card">' +
      '<h2 class="card-title">先确认一下</h2>' +
      '<div class="ask-choices">' +
      btns +
      '</div>' +
      '</article>';

    /* 追问也是「一次回答」：念问题 + 两个选项，老人不用盯着屏幕找。
       固定话术，不生成操作动作。 */
    if (SPEAK && SPEAK.autoReadText) {
      var labels = opts.map(function (o) {
        return typeof o === 'string' ? o : o && o.label ? o.label : String(o);
      });
      SPEAK.autoReadText('先确认一下：' + labels.join('，还是') + '？');
    }

    container.querySelectorAll('.ask-choice').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = Number(btn.getAttribute('data-i'));
        var picked = opts[i];
        var label = typeof picked === 'string' ? picked : picked && picked.label;
        if (!label) return;
        /* 点选项 = 回答上一句追问，属于「换了一次输入」→ 掐断正在念的追问卡。
           handleQuery 内部也会 stopForAction，这里显式再调一次是为了
           「点了但 label 为空被 return」这类边界不留悬念。 */
        if (SPEAK && SPEAK.stopForAction) SPEAK.stopForAction('ask-choice');
        // 用户点选 = 一次新的输入，原话进消息流，循环重跑
        handleQuery(label);
      });
    });
  }

  /* 把 judge 结论渲染成卡（回落路径与 loop 失败共用）。
     抽出来是为了让两条路径的终态渲染只有一份实现。 */
  function renderVerdict(text, verdict) {
    var lr = LLM.routeByVerdict(verdict, ENTRIES, detectDanger, text);
    if (!lr) {
      handleQuerySync(text, { keepTrace: true, noEcho: true });
      return 'fallback';
    }
    var a = applyLlmRoute(lr);
    if (!a) {
      handleQuerySync(text, { keepTrace: true, noEcho: true });
      return 'fallback';
    }
    var toEmergency = verdict.intent === 'ongoing' || a.kind === 'steps' || a.kind === 'dialonly';
    if (toEmergency && state.mode === 'daily') enterEmergency();

    var h = answerHost(a.kind);
    if (state.mode === 'emergency') renderByAction(a, h);
    else if (a.kind === 'daily') {
      /* 与 loop 路径同一入口：去重 + 扩写/朗读协调（2026-11-22）。 */
      renderDailyFirstTime(a.entry, text, h);
    } else RENDER.renderRefuse(h);
    scrollToAnswer(h);
    return 'llm';
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
    if (SPEAK) SPEAK.unmuteAutoRead();

    /* 新一次提问 = 用户明确的「换问题」动作 → 立刻掐断正在念的那一条
       （用户裁决：有别的动作就中断）。注意是 stopForAction 不是 muteAutoRead：
       后者会让本会话再也不自动读，而用户只是想问下一句。 */
    if (SPEAK && SPEAK.stopForAction) SPEAK.stopForAction('new-query');

    /* 用户原话进消息流，只加一次（在这里加，不在 handleQuerySync 里）。
       往下所有回落 handleQuerySync 的调用都带 noEcho，
       否则「LLM 不可用 → 回落 l3」会让同一句话出现两条用户气泡。 */
    auditReset(text);
    if (CHAT) CHAT.appendUser(text);

    /* 会话上文（2026-11-20）：只收用户原话，不收模型结论。
       边界只在这里 —— 循环内部每一步都会调 decide，若在循环里记录，
       同一句会被记多次。一次 handleQuery = 一次用户输入。
       context 必须先于 push 取：当前这句话不能出现在「更早说过的话」里。 */
    /* state.js 与 app.js 是两个文件：旧缓存版的 state.js 没有 utterances。
       这里做一次惰性兜底，避免混版本时整个问答直接 TypeError。 */
    if (!state.utterances) state.utterances = [];
    var context = state.utterances.length ? { utterances: state.utterances.slice() } : null;
    state.utterances.push(text);

    if (!LLM || !LLM.judge) {
      handleQuerySync(text, { keepTrace: true, noEcho: true });
      return Promise.resolve('sync');
    }

    /* ── 主路径：自主循环（/act）──
       2026-11-19 新增（docs/03 §2.5.12 D-12，用户裁决 A）。
       decide 由 agent.js 逐步调用：模型选一个工具 → 代码校验并执行 → 把结果
       追加进 history → 再问模型下一步。**这才是「模型自主选工具」。**

       2026-11-20 用户裁决 A：**已锁定后的紧急后续轮也走 `/act`，并带会话上文。**
       原先这里是 `state.mode !== 'emergency'`，把紧急后续轮全部推给 judge；
       而 judge 路径不带 history，导致「第一句紧急、第二句补充」时模型看不到第一句。

       先纠正一个容易搞反的事实：**首次紧急轮本来就走 `/act`** ——
       它从 `mode === 'daily'` 进入，循环渲染出 steps 时才 `enterEmergency()`。
       所以本次改动只影响「已锁定后的下一句」，**首轮时延与行为一字未变**，
       01 §6 的 3 秒预算不受影响。

       与下面 judge 路径的分工（改后）：
         `/act` 可用 → 所有在线提问都走循环（含紧急后续轮）
         `/act` 不可用或返回非法 → 回落 judge 单次判定
       回落不是「降级」，而是保证「循环挂了也能答」——两条路径的终态卡是同一套渲染。 */
    if (AGENT && LLM.act) {
      /* B：只给首轮加速。有上文说明不是首轮，不预置（语义更复杂，留给模型）。 */
      return runActLoop(text, context, context ? null : seedFor(text));
    }

    return LLM.judge(text).then(function (verdict) {
      var lr = LLM.routeByVerdict(verdict, ENTRIES, detectDanger, text);

      // LLM 未参与（不可用/超时/结构不合法）→ 完全走原 l3
      if (!lr) {
        handleQuerySync(text, { keepTrace: true, noEcho: true });
        return 'fallback';
      }

      var a = applyLlmRoute(lr);
      if (!a) {
        handleQuerySync(text, { keepTrace: true, noEcho: true });
        return 'fallback';
      }

      // S8：LLM 判定为 ongoing 或命中了步骤/拨号 → 强制切紧急，且不可回
      var toEmergency = verdict.intent === 'ongoing' || a.kind === 'steps' || a.kind === 'dialonly';
      if (toEmergency && state.mode === 'daily') enterEmergency();

      /* LLM 路径的路由摘要：与 l3 路径同一字段，便于对比「同一个输入
         走两条路各落到哪」——B3 那类「LLM 判对了又被兜底盖掉」就靠这个比。
         写在渲染之前：日志按时间读才是因果顺序。 */
      logRoute('llm', text, {
        danger: verdict.intent === 'ongoing' ? detectDanger(text) : null,
        targetId: lr.sceneId || null,
        entry: a.entry || null,
        action: a.kind
      });

      /* 每条回答都新建一条消息（answerHost），不再复用固定容器。
         这一步是「可回看对话记录」的实现关键：旧消息 DOM 留在上面不动。 */
      var host = answerHost(a.kind);

      /* 有调度器就走工具链，没有就直连渲染（M2 行为，保证可摘除）。
         工具链的价值不只是「多个壳」：它保证 lookup_scene 前置条件被检查，
         所以「LLM 给出已发布场景」这件事也被机器复核了一次，而不是仅凭模型自报。 */
      if (AGENT) {
        var plan = planFromRoute(lr);
        if (!plan) {
          renderByAction(a, host);
          scrollToAnswer(host);
          return 'llm';
        }
        return AGENT.run(
          text,
          { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
          {
            plan: plan,
            exec: function (rec, res) {
              execTool(rec, res, host);
            }
          }
        ).then(function (out) {
          lg('debug', '工具链完成', {
            endKind: out.endKind,
            steps: out.steps.length,
            degraded: out.degraded
          });
          scrollToAnswer(host);
          return 'llm';
        });
      }

      if (state.mode === 'emergency') {
        renderByAction(a, host);
      } else {
        // 日常模式：只可能是 daily 或 refuse
        if (a.kind === 'daily') RENDER.renderDaily(a.entry, host);
        else RENDER.renderRefuse(host);
      }
      scrollToAnswer(host);
      return 'llm';
    });
  }

  /* talk.js 在运行时通过 window.APP_HANDLE_QUERY 取这个函数。
     为什么不在加载期直接赋给 window：talk.js 先加载，那时本文件还没执行完，
     只能拿到 undefined。运行时取永远安全。 */
  window.APP_HANDLE_QUERY = handleQuery;

  function handleIconClick(id) {
    var e = ENTRIES[id];
    if (!e) {
      lg('warn', '点了未知场景图标', { id: id });
      return;
    }

    // 点图标同样是一次新的意图表达，解除静默
    if (SPEAK) SPEAK.unmuteAutoRead();
    /* 点图标 = 用户换了一个场景 → 掐断正在念的上一条（不是 mute，见 speak.js） */
    if (SPEAK && SPEAK.stopForAction) SPEAK.stopForAction('icon');
    if (LOG) LOG.setTrace(LOG.newTrace('i'));
    logAlways('点图标', { entryId: id, mode: state.mode, locked: state.locked });

    // 点图标 = 显式要这个场景的步骤，直接进紧急形态（§3.3 兜底路径）
    /* 用户点的图标也算一次「用户说的话」：记一条用户消息，
       否则回看时只看到步骤卡、不知道当时点了什么。 */
    if (CHAT) CHAT.appendUser(e.name);
    if (state.mode === 'daily') enterEmergency();
    var host = answerHost('steps');
    if (state.mode === 'emergency') {
      RENDER.renderStepsCard(e, host);
    } else {
      RENDER.renderDaily(e, host);
    }
    scrollToAnswer(host);
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

  /* 图标区只有一处（消息流顶部），绑定一次即可。
     2026-11-19 聊天式改造前是 dailyIcons / emgIcons 两处，分别绑定。 */
  if (el.msgIcons) {
    el.msgIcons.addEventListener('click', function (ev) {
      var more = ev.target.closest('.icon-more');
      if (more) {
        var on = el.msgIcons.classList.toggle('is-expanded');
        more.textContent = on
          ? '收起场景'
          : '更多场景（' + (KB.slots.length - 4) + '）';
        return;
      }
      var b = ev.target.closest('.icon-btn');
      if (b) handleIconClick(b.getAttribute('data-id'));
    });
  }

  /* 点「拨打」也要中断朗读 —— 用户要打电话了，念着会干扰通话。
     为什么用委托而不在每个卡片里绑：
       卡片是动态生成的（每条回答一张），逐卡绑定要在 render.js 里重复四次
       （步骤卡 / 分诊卡 / 拨号卡 / 拒答卡各有 dial-row）。
       委托到消息流容器只写一处，且新追加的卡片自动生效。
     ★ 不 preventDefault：tel: 必须真的唤起拨号盘（`01` §6 平台约束）。 */
  (function bindDialInterrupt() {
    var flow = document.getElementById('msgFlow');
    if (!flow) return;
    flow.addEventListener('click', function (ev) {
      var a = ev.target.closest && ev.target.closest('.dial-btn');
      if (a && SPEAK && SPEAK.stopForAction) SPEAK.stopForAction('dial');
    });
  })();

  /* ---------- 启动 ---------- */
  renderIcons();

  if (el.auditToggle) {
    el.auditToggle.addEventListener('click', function () {
      auditOpen(el.auditPanel && el.auditPanel.hidden);
    });
  }
  if (el.auditClose) {
    el.auditClose.addEventListener('click', function () {
      auditOpen(false);
    });
  }
  try {
    if (/[?&]audit=1(?:&|$)/.test(window.location.search)) auditOpen(true);
  } catch (e) { /* 非浏览器沙箱忽略 */ }

  if (TALK) {
    TALK.initTalk('dailyTalk', 'dailyTalkHint', 'dailyInput');
    TALK.initTalk('emgTalk', 'emgTalkHint', 'emgInput');
    window.addEventListener('pointerup', TALK.onTalkUp);
    window.addEventListener('pointercancel', TALK.onTalkUp);
    window.addEventListener('keyup', function (ev) {
      if (ev.key === ' ' || ev.key === 'Enter') TALK.onTalkUp();
    });
  }

  /* 知识库加载日志（模块 knowledge）。
     为什么放在这里而不是 knowledge.js 里：那是构建产物，手改会被覆盖。
     记的是「实际进前端的量」，与 index.json 的 ready 数对不上时就是构建出了问题。 */
  logAlways('知识库已加载', {
    slots: KB.slots.length,
    entries: Object.keys(ENTRIES).length,
    dataDate: KB.data_date,
    generatedAt: KB.generated_at || null,
    slotIds: KB.slots
      .map(function (s) {
        return s.id;
      })
      .join(',')
  });
  lg('debug', '运行环境', {
    logLevel: LOG ? LOG.stats().level : 'no-log',
    ttsModule: !!V,
    llmModule: !!LLM,
    ua: ((window.navigator && window.navigator.userAgent) || '').slice(0, 80)
  });

  /* 语音引擎探测：异步，不阻塞首屏。
     探测结果是「能力」判断，与「用户想不想听」是两件事：
     不支持时按钮仍渲染，点了给明确提示（不许静默失败）。 */
  if (V) {
    V.detect().then(function () {
      if (!V.state.supported && V.state.unavailableReason) {
        // 只在用户已经进到紧急模式时才提示，避免日常首屏就被技术提示干扰
        if (state.mode === 'emergency' && SPEAK) SPEAK.showVoiceNotice(V.state.unavailableReason);
      }
    });
  }

  if (!KB.slots.length) {
    /* 知识库为空：追加一条消息，而不是往固定容器写（聊天式下没有固定容器）。 */
    var emptyHost = answerHost('refuse');
    if (emptyHost) {
      emptyHost.innerHTML =
        '<article class="refuse"><p>内容正在准备中，暂时无法回答。</p>' +
        '<div class="dial-row"><a class="dial-btn" href="tel:120">拨打 120</a></div></article>';
    }
  }

  /* 供 tools/selftest_m1.mjs 调用，不参与界面渲染。
     ⚠️ 这是 6 个测试脚本的公共契约，改名/删项会直接让断言变红。
        本文件拆分时保证：成员名与语义一字未改，全部指向新模块的同名函数。 */
  window.__M1__ = {
    detectDanger: detectDanger,
    /* 每步进展（M2.5）的测试入口 */
    progressTextFor: progressTextFor,
    progress: {
      show: showProgress,
      hide: hideProgress,
      visible: function () {
        return !!(el.progress && !el.progress.hidden);
      },
      text: function () {
        return el.progress ? el.progress.textContent : null;
      }
    },
    /* B 方案（首轮本地预置）的测试入口：不参与界面渲染 */
    seedFor: seedFor,
    actSeedEnabled: function () {
      return ACT_SEED;
    },
    exitEmergency: exitEmergency,
    /* 测试专用：清空「上一条 daily」记忆，避免连续用例被追问去重误伤。 */
    resetDailyMemory: function () {
      _lastDaily = { entryId: null, host: null };
    },
    bestMatch: function (t) {
      var e = bestMatch(t);
      return e ? e.id : null;
    },
    routeOf: function (t) {
      var r = routeOf(t);
      return {
        dangerId: r.danger ? r.danger.id : null,
        dangerNumber: r.danger ? r.danger.number : null,
        entryId: r.entry ? r.entry.id : null,
        dialOnly: !r.entry && !!r.targetId
      };
    },
    renderSteps: RENDER.renderSteps,
    renderStepsCard: RENDER.renderStepsCard,
    renderDaily: RENDER.renderDaily,
    renderRefuse: RENDER.renderRefuse,
    renderDialOnly: RENDER.renderDialOnly,
    // 追问卡渲染：点了选项 → 作为新输入重进循环。2026-11-19 导出供断言覆盖
    // （此前「实现了但没验证」——是整条链路里唯一没测试兜住的一环）
    renderAsk: renderAsk,
    entries: ENTRIES,
    state: state,
    // 供自测与评测脚本调用：LLM 路由映射是纯函数，可离线断言
    applyLlmRoute: applyLlmRoute,
    handleQuerySync: handleQuerySync,
    handleQuery: handleQuery, // 异步主路径，端到端验证用（含状态切换）
    speakSteps: SPEAK ? SPEAK.speakSteps : null, // 供语音自测调用
    speakDaily: SPEAK ? SPEAK.speakDaily : null, // 日常卡朗读（自动读摘要 / 手动读全文）
    speakTriage: SPEAK ? SPEAK.speakTriage : null, // 分诊卡手动重播（K2）
    // 语音输入（M2）：供自测断言能力探测与状态，不参与界面渲染
    asrState: ASR ? ASR.state : null,
    asrAvailable: !!ASR,
    // 供自测驱动完整语音流程（不真开麦克风）：看识别结果到底去了哪
    _talk: TALK
      ? {
          ctl: TALK.ctl,
          up: TALK.onTalkUp,
          clear: TALK.clearInput,
          reset: TALK.talkReset
        }
      : null,
    showVoiceNotice: SPEAK ? SPEAK.showVoiceNotice : null,
    LLMAvailable: !!LLM,
    TTSAvailable: !!V,
    // 自动朗读的内部状态，供自测断言（不允许界面直接改）
    autoReadState: state.autoRead,
    kbMeta: {
      slots: KB.slots.length,
      entries: Object.keys(ENTRIES).length,
      data_date: KB.data_date
    }
  };
})();
