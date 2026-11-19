/* =========================================================
   应急助手 · 入口（路由 / 绑定 / 启动）
   2026-11-19 从 1022 行拆出，依据 docs/10 §7「往 app.js 加大功能时必须先拆」。
   拆分后本文件只做四件事：路由决策、模式切换、DOM 绑定、启动与导出。

   已迁出的部分（行为不变，只是搬家）：
     渲染（renderSteps / renderStepsCard / renderDaily / renderRefuse /
           renderDialOnly / esc）      → app/render.js
     朗读（speakSteps / autoRead* / speakDaily / speakTriage /
           muteAutoRead / showVoiceNotice）→ app/speak.js
     语音输入（initTalk / onTalkUp / fillInput / talkCtl）→ app/talk.js
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
    msgIcons: document.getElementById('msgIcons')
  };

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

  var ICONS = {
    gas_leak: '💨',
    fire_home: '🔥',
    co_poisoning: '🥵',
    fall_elderly: '🧓',
    scald_burn: '♨️',
    electric_shock: '⚡',
    airway_obstruction: '🫁',
    drowning: '🌊',
    earthquake: '🏚️',
    elevator_trapped: '🛗'
  };

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
       ② 底部输入区切到紧急样式与文案（form/talk 按钮互为显隐）
       ③ state.mode 变 emergency —— 之后每一条消息都带 is-emergency 标记
     回看旧消息不受影响：它们各自带自己的 mode 标记，不会被改成紧急样式。 */
  function enterEmergency() {
    if (state.locked) return;
    state.locked = true;
    state.mode = 'emergency';
    el.band.hidden = false;
    el.dailyForm.hidden = true;
    el.emgForm.hidden = false;
    if (el.dailyTalk) el.dailyTalk.hidden = true;
    if (el.emgTalk) el.emgTalk.hidden = false;
    document.body.classList.add('is-emergency');
    // S8 是「进得去出不来」的锁，切换必须留痕（含是谁触发的）
    lg('info', '切紧急模式并锁定', { locked: true, trace: LOG ? LOG.getTrace() : null });
  }

  /* ---------- 图标区 ----------
     聊天式下图标区只有一处（消息流顶部那条欢迎消息里），不再是两处。
     图标点了直接出步骤卡 —— 不经过判定层，这是最快的一条路（docs/01 §3.3）。 */
  function renderIcons() {
    if (!el.msgIcons) return;
    var html = KB.slots
      .map(function (s) {
        return (
          '<button class="icon-btn" type="button" data-id="' +
          esc(s.id) +
          '">' +
          '<span class="icon-glyph" aria-hidden="true">' +
          (ICONS[s.id] || '•') +
          '</span>' +
          '<span class="icon-label">' +
          esc(s.name) +
          '</span>' +
          '</button>'
        );
      })
      .join('');
    if (!html) {
      html = '<p class="section-label">内容正在准备中</p>';
    }
    el.msgIcons.innerHTML = html;
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
      RENDER.renderStepsCard(res.entry, host);
      return;
    }
    if (res.kind === 'daily') {
      RENDER.renderDaily(res.entry, host);
      return;
    }
    if (res.kind === 'triage') {
      RENDER.renderStepsCard(res.entry, host); // 有分诊时它会出分诊卡
      return;
    }
    if (res.kind === 'dial') {
      RENDER.renderDialOnly(res.number, host);
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
    /* 聊天式下不再把容器滚到视口顶部（那会把上一条消息顶出去），
       改为滚到消息流底部 —— 新消息本来就在最下方。
       只在「用户主动发起」时调用；系统追加的消息不强制滚动，
       否则老人正读到第 3 步会被拽走（docs/03 §2.5.8）。 */
    if (CHAT) CHAT.scrollToEnd(true);
    else if (container && container.scrollIntoView)
      container.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
    if (r.entry) RENDER.renderDaily(r.entry, dc);
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
  function runActLoop(text) {
    var host = null;
    var history = [];
    var t0 = Date.now();

    function decide(t, ctx) {
      return LLM.act(t, ctx.history || []).then(function (r) {
        if (!r || !r.ok) throw new Error(r && r.error ? r.error : 'act 不可用');
        return { act: r.act, args: r.args, why: r.reason };
      });
    }

    function exec(rec, res) {
      if (!res || !res.ok || !res.kind) return;

      /* ⚠️ 顺序必须「先切模式，再建容器、再渲染」。
         2026-11-19 修（e2e_voice「煤气漏了」应发声 1 次实际 0 次）：
         第一版是先渲染后切模式，而 speak.js 的 canAutoRead() 会检查
         `state.mode !== 'emergency'` → 渲染发生时模式还是 daily → 自动朗读被跳过。
         症状是「卡出来了但不出声」，正是 docs/01 §6.2 禁止的静默失败。
         另外 host 的 id 也取决于 mode（dailyAnswer / emgAnswer），必须先切。 */
      var toEmg = res.kind === 'steps' || res.kind === 'dial' || res.kind === 'triage';
      if (toEmg && state.mode === 'daily') enterEmergency();

      if (!host) host = answerHost(res.kind);

      if (res.kind === 'ask') {
        renderAsk(res.result, host);
        return;
      }
      execTool(rec, res, host);
    }

    return AGENT.run(text, { entries: ENTRIES, sceneIds: SCENE_IDS, history: history }, {
      decide: decide,
      exec: exec
    })
      .then(function (out) {
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
    else if (a.kind === 'daily') RENDER.renderDaily(a.entry, h);
    else RENDER.renderRefuse(h);
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
    if (CHAT) CHAT.appendUser(text);

    if (!LLM || !LLM.judge) {
      handleQuerySync(text, { keepTrace: true, noEcho: true });
      return Promise.resolve('sync');
    }

    /* ── 主路径：自主循环（/act）──
       2026-11-19 新增（docs/03 §2.5.12 D-12，用户裁决 A）。
       decide 由 agent.js 逐步调用：模型选一个工具 → 代码校验并执行 → 把结果
       追加进 history → 再问模型下一步。**这才是「模型自主选工具」。**

       与下面 judge 路径的分工：
         /act  可用 → 走循环，模型自己决定调哪个工具、调几步
         /act  不可用或返回非法 → 回落 judge 单次判定（现 96/100 基线）
       回落不是「降级」，而是保证「循环挂了也能答」——两条路径的终态卡是同一套渲染。

       代价（已实测，docs/03 §2.5.9）：循环每步一次往返（P50 822ms），
       平均 1.71 步。所以**只在日常模式启用**：紧急模式仍走 judge + 关键词，
       以保住 01 §6 的 3 秒预算。 */
    if (AGENT && LLM.act && state.mode !== 'emergency') {
      return runActLoop(text);
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
    if (!V) {
      row.hidden = true;
      return;
    }
    /* ⚠️ 不能在这里判断 V.state.supported：
       detect() 是异步的，启动瞬间 supported 还是 false，会把控件误藏。
       改为先渲染，等探测结果回来再决定（下面的 detect().then 里处理）。 */

    var btns = row.querySelectorAll('.rate-btn');
    function paint() {
      var cur = V.state.rate;
      for (var i = 0; i < btns.length; i++) {
        var r = Number(btns[i].getAttribute('data-rate'));
        // 0.75 档：rate < 0.9 即算「慢」；1.0 档：rate >= 0.9
        var on = r < 0.9 ? cur < 0.9 : cur >= 0.9;
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
      // 探测完才知道能不能读：不能读就把语速控件藏掉（调了也没用）
      var rateRow = document.getElementById('rateRow');
      if (rateRow) rateRow.hidden = !V.state.supported;
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
          fill: TALK.fillInput,
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
