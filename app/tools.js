/* =========================================================
   应急助手 · 工具注册表（8 个工具 + 前置条件门 + 白名单）
   依据 docs/03 §2.5。用户 2026-11-19 裁决：8 个工具全部上，统一由循环调度。

   ★ 本文件的三条硬约束（写在这里防止被简化掉）
     1. 拨号工具**只生成按钮，永不代为拨出**（01 §6 段末、§4.6）
     2. 出内容的工具必须有 lookup_scene 前置条件；dial / refuse 作为安全出口不设门槛
     3. speak 只吃「条目字段」，不吃自由文本（否则违反 S1/S7）

   为什么「前置条件」比 prompt 有效：
     history 由**代码**写入，不由模型自报。模型无法声明「我查过了」，
     只能实际调用一次 lookup_scene，代码才会写入记录。这是伪造不了的。

   工具的两种类别（决定是否花 LLM 往返）：
     探查类（NEED_MODEL）：lookup_scene / ask —— 由模型决定调哪个
     动作类（本地执行）：其余 6 个 —— 由代码按下表的规则执行
   紧急链路因此可以零 LLM 往返：detectDanger 命中 → 直接 get_steps/triage/dial。
   ========================================================= */
(function (global) {
  'use strict';

  var LOG = global.LOG || null;
  function lg(level, msg, fields) {
    if (!LOG) return;
    var t = LOG.tag('app');
    if (t[level]) t[level](msg, fields);
  }

  /* ---------- 号码白名单 ----------
     为什么必须白名单而不是「看起来像号码就行」：
     模型若给出 110/114/1199 这类号码，用户拨出去会浪费救援资源或打不通。
     白名单来源只有三处：条目自带的 emergency_number、DANGER_RULES 的 number、兜底 120。 */
  var FALLBACK_NUMBER = '120';

  function allowedNumbers(entries) {
    var set = { 120: true, 119: true };
    for (var id in entries || {}) {
      if (entries[id] && entries[id].emergency_number) set[entries[id].emergency_number] = true;
    }
    var R = global.RETRIEVAL;
    if (R && R.DANGER_RULES) {
      for (var i = 0; i < R.DANGER_RULES.length; i++) {
        if (R.DANGER_RULES[i].number) set[R.DANGER_RULES[i].number] = true;
      }
    }
    return set;
  }

  /* ---------- 8 个工具的声明 ----------
     needsModel = true 的才是「探查类」，其余为本地动作。
     结束循环的工具：get_steps / get_daily / dial / refuse（产出终态卡）
     triage 不结束：它等用户点选；ask 也不结束：它等用户回答。 */
  var REGISTRY = [
    {
      name: 'lookup_scene',
      needsModel: true,
      endsLoop: false,
      desc: '查这个场景有没有已发布条目',
      args: ['scene'],
    },
    {
      name: 'ask',
      needsModel: true,
      endsLoop: false,
      desc: '二选一追问，等用户点选',
      args: ['scene', 'options'],
    },
    {
      name: 'get_steps',
      needsModel: false,
      endsLoop: true,
      desc: '出三段式步骤卡',
      args: ['scene'],
      requires: 'lookup_scene',
    },
    {
      name: 'get_daily',
      needsModel: false,
      endsLoop: true,
      desc: '出日常解释卡',
      args: ['scene'],
      requires: 'lookup_scene',
    },
    {
      name: 'triage',
      needsModel: false,
      endsLoop: false,
      desc: '出分诊卡（条目含 triage 才可调）',
      args: ['scene'],
      requires: 'lookup_scene',
    },
    {
      name: 'speak',
      needsModel: false,
      endsLoop: false,
      desc: '朗读某条目的指定段落（只吃字段，不吃自由文本）',
      args: ['entry_id', 'segment'],
    },
    {
      name: 'dial',
      needsModel: false,
      endsLoop: true,
      desc: '出拨号按钮卡（不代为拨出）',
      args: ['number'],
    },
    {
      name: 'refuse',
      needsModel: false,
      endsLoop: true,
      desc: '出拒答卡（固定话术、零步骤）',
      args: ['reason'],
    },
  ];

  function byName(name) {
    for (var i = 0; i < REGISTRY.length; i++) {
      if (REGISTRY[i].name === name) return REGISTRY[i];
    }
    return null;
  }

  var KNOWN_NAMES = REGISTRY.map(function (t) {
    return t.name;
  });

  /* ---------- history 查询 ----------
     history 的元素形如 { act, args, result }，由调度器在**执行后**追加。
     下方所有前置条件都只读 history，不读模型的话。 */
  function findLookupOK(history, scene) {
    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      if (h.act === 'lookup_scene' && h.args && h.args.scene === scene) {
        if (h.result && h.result.found && h.result.published) return true;
      }
    }
    return false;
  }

  /* ---------- 前置条件门 ----------
     返回 { ok: true } 或 { ok: false, reason }。
     ★ 安全出口（dial / refuse）不设门槛 —— 加了门槛反而会逼模型乱猜，
       且 docs/01 §3.3 的定位就是「无条件出口」。 */
  function checkGate(act, args, ctx) {
    var def = byName(act);
    if (!def) return { ok: false, reason: 'unknown-tool' };

    // 参数完整性：所有声明过的参数都必须给
    for (var i = 0; i < def.args.length; i++) {
      if (args == null || args[def.args[i]] === undefined || args[def.args[i]] === null) {
        return { ok: false, reason: 'missing-arg:' + def.args[i] };
      }
    }

    /* 场景白名单：越界直接非法，不进循环。

       ⚠️ 2026-11-19 修（e2e「有人落水了」被判 refuse）：
       第一版对**所有**工具都强制 scene ∈ 白名单，但白名单来自前端产物，
       而产物只含**已发布**槽位（9 个）—— 于是 drowning（slot 未发布）被拒。
       后果：模型正确地走「查一下→发现没条目→给拨号卡」，却被门拦住，
       用户拿到的是拒答卡（比拨号卡更差：没有号码可打）。

       正确区分：
         · lookup_scene 是**只读探查**，参数越界无害 —— 查不存在的场景
           自然返回 found=false，不产出任何内容。所以它**允许任意字符串**。
         · 其余工具（get_steps / get_daily / triage / speak）会产出内容，
           必须严格在白名单内 —— 这才是「防模型自造场景」该管的地方。 */
    if (args && args.scene !== undefined && args.scene !== null && act !== 'lookup_scene') {
      if (!ctx.sceneIds || ctx.sceneIds.indexOf(args.scene) < 0) {
        return { ok: false, reason: 'scene-not-in-registry' };
      }
    }

    // 前置条件：出内容的工具必须先成功 lookup 过同一个 scene
    if (def.requires === 'lookup_scene') {
      if (!findLookupOK(ctx.history, args.scene)) {
        return { ok: false, reason: 'no-lookup' };
      }
      // 还要再确认一次条目在库（entries 由调用方注入）
      var entry = ctx.entries && ctx.entries[args.scene];
      if (!entry) return { ok: false, reason: 'entry-missing' };
    }

    // triage 只能对含分诊的条目调用
    if (act === 'triage') {
      var e2 = ctx.entries && ctx.entries[args.scene];
      if (!e2 || !e2.triage || !e2.triage.options || !e2.triage.options.length) {
        return { ok: false, reason: 'no-triage' };
      }
    }

    /* ask：必须**恰好两个**可用选项。
       ⚠️ 2026-11-19 补（此前只有 renderAsk 里的 `options.slice(0, 2)`）：
       那个写法在模型给 3 个时静默丢一个、给 1 个时变成单选按钮，
       而用户看到的是一张「看起来正常」的追问卡 —— 与 docs/03 §5.4
       「不许静默降级」是同一类错误。放行前查清，不合法就拒，
       让模型看到 ask-needs-two-options 重给，而不是让用户替它承担。

       为什么必须是 2：`01` §2.4 已裁决老人产品不做连续追问，
       二选一是「一次点击能答完」的形式上限。 */
    if (act === 'ask') {
      var asks = args.options;
      if (!asks || typeof asks.length !== 'number' || asks.length !== 2) {
        return { ok: false, reason: 'ask-needs-two-options' };
      }
      for (var k = 0; k < 2; k++) {
        var one = asks[k];
        var lab = typeof one === 'string' ? one : one && one.label;
        if (typeof lab !== 'string' || !lab.replace(/\s/g, '')) {
          return { ok: false, reason: 'ask-empty-option' };
        }
      }
    }

    // dial：号码必须在白名单内
    if (act === 'dial') {
      var allowed = allowedNumbers(ctx.entries);
      if (!allowed[String(args.number)]) {
        return { ok: false, reason: 'number-not-allowed', fallback: FALLBACK_NUMBER };
      }
    }

    // speak：只吃条目字段，不吃自由文本
    if (act === 'speak') {
      var e3 = ctx.entries && ctx.entries[args.entry_id];
      if (!e3) return { ok: false, reason: 'entry-missing' };
      if (['immediate', 'next', 'never', 'daily', 'triage'].indexOf(args.segment) < 0) {
        return { ok: false, reason: 'segment-not-allowed' };
      }
    }

    return { ok: true, def: def };
  }

  /* ---------- 执行 ----------
     返回 { ok, result, kind, ends }。
     ★ 这里只算「事实」，不碰 DOM —— 渲染由调用方用 RENDER 完成。
       分开的理由：工具表要能被离线断言（selftest 直接调 execute 即可），
       不需要造 DOM。 */
  function execute(act, args, ctx) {
    var gate = checkGate(act, args, ctx);
    if (!gate.ok) {
      lg('warn', '工具调用被前置条件拒绝', { act: act, reason: gate.reason });
      return { ok: false, reason: gate.reason, fallbackNumber: gate.fallback || null, ends: false };
    }

    var entries = ctx.entries || {};
    var entry;

    if (act === 'lookup_scene') {
      entry = entries[args.scene];
      var res = {
        found: !!entry,
        published: !!(entry && entry.status === 'published'),
        entry_id: entry ? entry.id : null,
      };
      // published 兜底：构建产物里只会有 published 条目，但自测会传任意条目
      if (entry && entry.status === undefined) res.published = true;
      return { ok: true, result: res, ends: false };
    }

    if (act === 'get_steps') {
      entry = entries[args.scene];
      return { ok: true, result: { entryId: entry.id }, kind: 'steps', entry: entry, ends: true };
    }

    if (act === 'get_daily') {
      entry = entries[args.scene];
      return { ok: true, result: { entryId: entry.id }, kind: 'daily', entry: entry, ends: true };
    }

    if (act === 'triage') {
      entry = entries[args.scene];
      return { ok: true, result: { entryId: entry.id }, kind: 'triage', entry: entry, ends: false };
    }

    if (act === 'speak') {
      return {
        ok: true,
        result: { entryId: args.entry_id, segment: args.segment },
        kind: 'speak',
        ends: false,
      };
    }

    if (act === 'dial') {
      return {
        ok: true,
        result: { number: String(args.number) },
        kind: 'dial',
        entry: null,
        number: String(args.number),
        ends: true,
      };
    }

    if (act === 'refuse') {
      return {
        ok: true,
        result: { reason: args.reason || 'unspecified' },
        kind: 'refuse',
        ends: true,
      };
    }

    if (act === 'ask') {
      return {
        ok: true,
        result: { scene: args.scene, options: args.options },
        kind: 'ask',
        ends: false,
      };
    }

    return { ok: false, reason: 'unhandled-tool', ends: false };
  }

  global.TOOLS = {
    REGISTRY: REGISTRY,
    KNOWN_NAMES: KNOWN_NAMES,
    byName: byName,
    checkGate: checkGate,
    execute: execute,
    allowedNumbers: allowedNumbers,
    findLookupOK: findLookupOK,
    FALLBACK_NUMBER: FALLBACK_NUMBER,
  };
})(typeof window !== 'undefined' ? window : globalThis);
