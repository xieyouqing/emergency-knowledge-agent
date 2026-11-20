/* =========================================================
   应急助手 · 自主循环调度器
   依据 docs/03 §2.5（工具注册表）与用户 2026-11-19 裁决：

     ① 先判断网络环境 → 决定走「自主循环」还是「离线模式」
     ② 8 个工具统一由本调度器执行，渲染层不再自己调朗读
     ③ 紧急在循环里但不绑定：第 0 步走本地规则，零 LLM 往返 → 保住 3 秒

   ★ 三条不可让步的边界
     1. 第 0 步永远是 detectDanger（本地，实测 emergency 40/40）。
        命中就直接出步骤卡，不问模型。这是 3 秒预算的唯一保法。
     2. 只有「探查类」工具花 LLM 往返（lookup_scene / ask）。
        动作类 6 个全部本地执行 —— 所以紧急链路 LLM 往返为 0。
     3. 任何异常 → 降级到 planRule()（纯规则计划），不允许「循环挂了就没答案」。

   为什么预算只限步数、不限时间：
     时间预算会随网络抖动误伤正常请求；步数超限是可复现的确定性事件。
     P95 步数的实测值见 docs/03 §2.5.7，硬上限取 5 是保险丝，不是决策依据。
   ========================================================= */
(function (global) {
  'use strict';

  var LOG = global.LOG || null;
  function lg(level, msg, fields) {
    if (!LOG) return;
    var t = LOG.tag('app');
    if (t[level]) t[level](msg, fields);
  }

  /* 硬上限：只防「模型不 finish」的失控，不作为「该走几步」的依据。
     为什么是 5：8 个工具里最长合理路径是
     lookup → triage → (用户选) → get_steps → speak，约 4 步；留 1 步余量。 */
  var MAX_STEPS = 5;

  function tools() {
    return global.TOOLS || null;
  }

  /* ---------- ① 网络环境判断 ----------
     为什么要单独一层而不是直接看 LLM 是否可用：
       「有网但代理没起」和「没网」的处置不同 —— 前者可在 UI 提示，后者直接离线模式。
       但**两者的行为一致**：都退离线计划（docs/03 §5.4 不许静默降级）。

     注意：navigator.onLine 只说明「有没有网络接口」，不说明「能不能连通」。
     所以判据是「onLine === false → 离线；否则尝试在线，失败再降级」。
     宁可多试一次，也不要把「有网但慢」误判成离线。 */
  function netState() {
    /* 取 navigator 的两条路径都要试：
       - 浏览器里 navigator 是全局，window.navigator 同源；
       - 自测沙箱里 window 是普通对象、navigator 挂在 sandbox 上，二者不同源。
       2026-11-19 踩过：只查 global.navigator 时沙箱恒返 unknown，
       导致「离线走规则计划」这条断言假失败（产品在浏览器里其实是好的）。 */
    var nav = null;
    if (typeof navigator !== 'undefined' && navigator) nav = navigator;
    else if (global && global.navigator) nav = global.navigator;
    if (!nav || typeof nav.onLine !== 'boolean') return 'unknown';
    return nav.onLine ? 'online' : 'offline';
  }

  /* ---------- ② 纯规则计划（离线 / 降级路径） ----------
     不调 LLM，只用本地能力。注意这条路径**能力不降级的部分**：
       紧急场景（detectDanger 命中）与点图标完全不受影响，
       只有「语义辨析」退化 —— 这与 docs/03 §5.3 记录的 L3 缺陷一致。

     ★ 为什么规则计划也要先 lookup_scene：
       前置条件门管的是「有没有查过」，不是「谁提的议」。
       如果规则计划能直接 get_steps，门就有了一个后门，
       而「门是否真的有效」正是 docs/03 §2.5.11 C1 要证明的事。
       多一步本地 lookup 的代价是 0ms，换来的是「只有一条合法路径」。 */
  function lookupThen(action, scene, why) {
    return [
      { act: 'lookup_scene', args: { scene: scene }, why: why + '-lookup' },
      { act: action, args: { scene: scene }, why: why },
    ];
  }

  function planRule(text, ctx) {
    var R = global.RETRIEVAL;
    var danger = R && R.detectDanger ? R.detectDanger(text) : null;
    var entries = ctx.entries || {};

    /* P24（2026-11-20）：断网/降级时，先看「未覆盖的危重状态」。
       为什么必须放在 detectDanger 之前：
         「我妈摔倒了没有呼吸」会命中 fall_elderly（因为「摔倒」），
         而 fall_elderly 的首屏是「能自己动一动胳膊腿吗」—— 对无呼吸者是致命的。
       为什么条目未发布就拨号：
         没有 CPR/止血内容时，宁可只给 120 拨号卡，也不给错误方向的步骤。
       场景 id 约定（给数据同学）：CPR = cpr，大出血 = severe_bleeding。
         条目发布后，这里会自动从「拨号」切到「查条目 → 出步骤」。 */
    /* 回合策略优先（2026-11-20「工作流 + 自主决策」）：
       hypothetical / prevention → 只允许查库 + 日常解释，禁止 steps/triage/dial。
       必须在 severe/danger 之前：否则「如果发生火灾怎么办」命中 fire_home 出步骤，
       「怎么预防煤气泄漏」也会被关键词带成 steps。 */
    var policy = R && R.turnPolicy ? R.turnPolicy(text) : null;
    /* 明确否认火灾：不再走 fire_home 出内容。只认“不是着火/没见明火”这类
       明确否认，不认模糊猜测；也不影响“没呼吸”等危重词。 */
    if (R && R.isDeniedFire && R.isDeniedFire(text)) {
      return [{ act: 'refuse', args: { reason: 'denied-fire' }, why: 'policy-denied-fire' }];
    }
    if (policy && policy.allowSteps === false) {
      var hitP = R.retrieve ? R.retrieve(entries, text) : null;
      if (hitP && hitP.entryId && entries[hitP.entryId]) {
        return lookupThen('get_daily', hitP.entryId, 'policy-' + policy.type);
      }
      if (danger && entries[danger.id]) {
        return lookupThen('get_daily', danger.id, 'policy-' + policy.type);
      }
      if (policy.type === 'hypothetical' && danger) {
        return [
          {
            act: 'dial',
            args: { number: danger.number || '120' },
            why: 'policy-hypothetical-no-entry',
          },
        ];
      }
      return [{ act: 'refuse', args: { reason: 'policy-no-entry' }, why: 'policy-' + policy.type }];
    }

    /* 叫不醒但还有呼吸：P20-c 未发布 → 只拨号；不得走 cpr，也不得走 fall_elderly 分诊。 */
    if (R && R.isUnresponsiveWithBreathing && R.isUnresponsiveWithBreathing(text)) {
      return [{ act: 'dial', args: { number: '120' }, why: 'unresponsive-breathing-no-entry' }];
    }

    var severe = R && R.detectSevere ? R.detectSevere(text) : null;
    if (severe) {
      var isBleeding = /大出血|流血不止|止不住血/.test(severe);
      var severeScene = isBleeding ? 'severe_bleeding' : 'cpr';
      /* 2026-11-21（docs/14 §4.2 C11/C12）：儿科与溺水不进成人 CPR。
         这一判断只对 cpr 生效——大出血条目对儿童仍适用（止血手法通用），
         所以 isBleeding 时跳过范围检查。
         命中范围外 → 回到 dial 120，与 cpr 未发布时的行为一致。 */
      var outOfScope = !isBleeding && R.isCprOutOfScope ? R.isCprOutOfScope(text) : null;
      /* 溺水条目发布后：溺水（非儿科）走 drowning；儿科仍 dial。
         仍不允许把成人 cpr 套到溺水者身上（顺序不同）。 */
      if (outOfScope === 'drowning' && entries.drowning) {
        severeScene = 'drowning';
        outOfScope = null;
      }
      if (outOfScope) {
        return [{ act: 'dial', args: { number: '120' }, why: 'cpr-out-of-scope:' + outOfScope }];
      }
      if (entries[severeScene]) {
        return lookupThen('get_steps', severeScene, 'severe-entry:' + severeScene);
      }
      return [{ act: 'dial', args: { number: '120' }, why: 'severe-no-entry:' + severe }];
    }

    if (danger) {
      var de = entries[danger.id];
      if (de) return lookupThen('get_steps', danger.id, 'danger-hit');
      return [{ act: 'dial', args: { number: danger.number || '120' }, why: 'danger-no-entry' }];
    }

    var hit = R && R.retrieve ? R.retrieve(entries, text) : null;
    if (hit && hit.entryId && entries[hit.entryId]) {
      var entry = entries[hit.entryId];
      // 有分诊先出分诊；没分诊出日常解释（离线时没有意图判定，只能给知识）
      if (entry.triage && entry.triage.options && entry.triage.options.length) {
        return lookupThen('triage', entry.id, 'rule-triage');
      }
      return lookupThen('get_daily', entry.id, 'rule-daily');
    }
    return [{ act: 'refuse', args: { reason: 'no-match' }, why: 'rule-refuse' }];
  }

  /* ---------- ③ 在线计划（探查类交给模型） ----------
     decide 是一个函数：ctx => Promise<{act, args}> | {act, args}
     它由调用方注入（app.js 传 LLM 版本，测试传桩）。
     为什么注入而不是内部直接调 LLM：
       调度器必须能离线测（selftest 有 642 条断言在跑），
       内部直连 LLM 会让所有断言变成网络依赖。 */
  function buildPlan(text, ctx, decide) {
    if (!decide) return Promise.resolve(planRule(text, ctx));
    return Promise.resolve()
      .then(function () {
        return decide(text, ctx);
      })
      .then(function (first) {
        if (!first || !first.act) {
          lg('info', '模型未给出有效动作，退规则计划', { got: first });
          return planRule(text, ctx);
        }
        return [first];
      })
      .catch(function (e) {
        lg('warn', '模型决策失败，退规则计划', { error: String((e && e.message) || e) });
        return planRule(text, ctx);
      });
  }

  /* ---------- ④ 循环驱动器 ----------
     入参：
       text    用户输入
       ctx     { entries, sceneIds, history }
       opts    { decide, exec, maxSteps, onStep }
         decide(text, ctx) → {act,args}  探查决策（无则纯规则）
         exec(step)        → 执行结果     由调用方接线到 RENDER/SPEAK
         onStep(step, res) → 每步回调     用于 UI 进度反馈与日志
     出参：
       { ok, steps, endKind, degraded, reason }

     ★ 本函数不碰 DOM、不碰 RENDER，只算「该调哪些工具、按什么顺序」。
       这样才能离线断言：给它一个假 exec，就能验证整条决策链。 */
  function run(text, ctx, opts) {
    var o = opts || {};
    var T = tools();
    if (!T) {
      return Promise.resolve({
        ok: false,
        steps: [],
        endKind: null,
        degraded: true,
        reason: 'no-tools',
      });
    }

    var history = (ctx.history || []).slice();
    var steps = [];
    var limit = typeof o.maxSteps === 'number' ? o.maxSteps : MAX_STEPS;
    var degraded = false;
    var end = null;
    /* P32（2026-11-20）：同参 lookup 第一次重复时复用上次结果继续，
       第二次才收尾。为什么只放一次：
         · 主体变更（老伴→孩子）后模型需要重新确认适用性，复用结果是正确的；
         · 但「一直只查同一个」仍是空转，必须有上限，否则死循环。
       每次 AGENT.run 重置，跨轮不累计。 */
    var repeatReuseUsed = false;

    function step(i, planList) {
      if (end) return Promise.resolve(summary('done'));
      if (i >= limit) {
        lg('warn', '步数达上限，强制收尾', { limit: limit, steps: steps.length });
        degraded = true;
        // 收尾必须是安全出口：宁可给拨号，不许留在半截
        return finishSafe('max-steps');
      }

      /* ★ 哨兵分支：act === null 表示「这一步由模型现场决定」。
         这是「真·自主循环」的入口 —— 计划不是预先写死的列表，
         而是每步都现问模型。step 拿到动作后把自己重新调一次（i 不变），
         这样前置条件、执行、history 回灌全部复用同一段代码。

         ⚠️ 2026-11-19 修：第一版只在 i=0 放了哨兵，第 2 步时
         `i >= planList.length` 直接走到 plan-exhausted → 整条循环只跑一步。
         正确做法是「按需增长」：只要还有 decide，每步都补一个哨兵。 */
      if (i >= planList.length) {
        if (!hasDecide) {
          // 计划走完还没 end → 说明计划只含非终态工具，补一个安全出口
          return finishSafe('plan-exhausted');
        }
        planList.push({ act: null, args: {}, why: 'decide-next' });
      }

      if (planList[i] && planList[i].act === null) {
        if (!o.decide) return finishSafe('no-decide');
        return Promise.resolve()
          .then(function () {
            return o.decide(text, { entries: ctx.entries, history: history, step: i });
          })
          .then(function (d) {
            if (!d || !d.act) {
              lg('info', '模型未给出有效动作，改走安全出口');
              return finishSafe('decide-empty');
            }
            // 用模型给的动作为这一步的计划；i 不变，重入本函数
            planList[i] = {
              act: d.act,
              args: d.args || {},
              why: d.why || 'model',
              turn: d.turn || null,
              evidence: d.evidence || null,
            };
            return step(i, planList);
          })
          .catch(function (e) {
            lg('warn', '模型决策异常，改走安全出口', { error: String((e && e.message) || e) });
            return finishSafe('decide-error');
          });
      }

      var planned = planList[i];
      var act = planned.act;
      var args = planned.args || {};

      /* ★ 上文只补指代，不能替代当前句（P33 / O030）。
         实测：「煤气漏了」→「手机没电了」时，模型证据引的是**上一句**，
         于是把手机没电当成了煤气现场，给了 gas_leak 步骤。
         契约要求 evidence 是「用户原话片段」，所以用「证据是否落在当前句」判：
           · 落在当前句 → 正常；
           · 只落在上文，且当前句不是纯追问 → 说明模型拿上文当现场，拒答；
           · 纯追问（「怎么办」「然后呢」）允许省略，仍走上文。
         这比再加一条 prompt 规则可靠：模型已经用证据字段自曝了依据。 */
      if (planned.evidence && text) {
        var evN = String(planned.evidence).replace(/\s+/g, '');
        var curN = String(text).replace(/\s+/g, '');
        var grounded = !!evN && (curN.indexOf(evN) !== -1 || evN.indexOf(curN) !== -1);
        var pureFollowup =
          /^(怎么办|然后呢|现在呢|那呢|怎么弄|要紧吗|严重吗|接下来呢|还怎么办)[？?。！!]*$/.test(
            curN
          );
        if (!grounded && !pureFollowup) {
          lg('info', '证据未落在当前句，判定为上文污染，拒答', {
            evidence: evN,
            text: curN,
          });
          return runOne(
            { act: 'refuse', args: { reason: 'context-not-grounded' }, why: 'ctx-not-grounded' },
            i,
            planList
          );
        }
      }

      /* ★ 上限：同参重复调用且观察相同 → 强制收尾（docs/03 §2.5.7）。

         ⚠️ 2026-11-19 补：§2.5.7 早就写了「同参重复调用且观察相同 → 强制 finish」，
         但代码里一直**没有实现** —— 文档与代码脱节。是 probe_multi_turn 的 MT08
         撞出来的：模型想查「儿童坠床」，但白名单里只有 fall_elderly，
         于是它反复 lookup_scene(fall_elderly) 直到撞上 MAX 步。
         症状：用户多等 4 次往返（≈4 秒），最后拿到一张安全出口卡。

         为什么必须「同参 **且** 观察相同」两个条件：
           只判同参会把「先查到未发布 → 稍后条目被发布 → 再查」误杀；
           只判观察相同会把「查 A 空、查 B 空」当成绕圈（那是正常排查）。
         两者同时成立 = 这一动作没有任何新信息 → 继续就是在空转。

         为什么不是「重试」而是「收尾」：
           空转不可能靠再跑一次解决，模型缺的是信息而不是运气。 */
      if (isRepeatedAct(act, args, history)) {
        /* P32：第一次同参重复 → 复用上次结果继续，不拒答。
           语义依据：同一 scene 的库内容在一次会话内不变，重查不会得到新信息；
           模型重查的真实意图是「确认这个条目是否适用于新主体」，复用结果即可。
           仍保留一次上限：第二次同参重复 → 收尾，防死循环。 */
        if (act === 'lookup_scene' && !repeatReuseUsed) {
          repeatReuseUsed = true;
          lg('info', '同参 lookup 重复：复用上次结果继续（P32）', {
            act: act,
            args: args,
            step: i,
          });
          return runOne({ act: act, args: args, why: 'repeat-reuse' }, i, planList);
        }
        lg('warn', '同参重复调用，强制收尾（防绕圈）', { act: act, args: args, step: i });
        return finishSafe('repeat-call');
      }

      /* ★ 前置条件门：不通过就按 reason 决定补救方式。
         这不是「重试」，是「换一条合法路径」——
         例如 no-lookup 时补一次 lookup 再继续，而不是把同一动作再发一遍。 */
      var gate = T.checkGate(act, args, {
        entries: ctx.entries,
        sceneIds: ctx.sceneIds,
        history: history,
      });

      if (!gate.ok) {
        lg('info', '前置条件未通过，改走安全出口', { act: act, reason: gate.reason });
        steps.push({ act: act, args: args, ok: false, reason: gate.reason });
        /* no-lookup 是「模型跳过了查库」，不是「模型想编内容」：
           场景 id 合法且条目在库时，补一次 lookup 再执行原动作，而不是直接拒答。
           这条补救必须在这里做——P014「灭火器怎么选」模型会直接给 get_daily，
           若一律 refuse，用户拿不到本可安全给出的日常卡。 */
        if (gate.reason === 'no-lookup' && args.scene && ctx.entries[args.scene]) {
          var autoLookup = T.execute(
            'lookup_scene',
            { scene: args.scene },
            { entries: ctx.entries, sceneIds: ctx.sceneIds, history: history }
          );
          if (autoLookup.ok) {
            steps.push({
              act: 'lookup_scene',
              args: { scene: args.scene },
              ok: true,
              result: autoLookup.result || null,
              why: 'auto-lookup',
            });
            history.push({
              act: 'lookup_scene',
              args: { scene: args.scene },
              result: autoLookup.result || null,
            });
            lg('info', 'no-lookup 自动补查后重试原动作', {
              scene: args.scene,
              act: act,
            });
            return step(i, planList);
          }
        }
        /* 关键：出内容的工具被拒 → 不许硬给内容，改拨号/拒答。
           这与 llm.js 的 low-confidence 分支同一立场（S1 不让编）。 */
        if (gate.reason === 'number-not-allowed') {
          /* 用户明确要求拨 110/114 等非白名单号码：不能悄悄改成 120。
             直接拒答并说明只提供 120/119，避免拨错号。 */
          if (args.requested) {
            return runOne(
              { act: 'refuse', args: { reason: 'number-not-allowed-request' }, why: 'gate-refuse' },
              i,
              planList
            );
          }
          return runOne(
            { act: 'dial', args: { number: T.FALLBACK_NUMBER }, why: 'number-fallback' },
            i,
            planList
          );
        }
        return runOne(
          { act: 'refuse', args: { reason: gate.reason }, why: 'gate-refuse' },
          i,
          planList
        );
      }

      /* 否定闸：用户明确说“不是着火/没见明火”，即使模型仍选 fire_home，
         也不给内容。只拦内容类工具；lookup 允许（便于日志与后续判断）。 */
      if (
        ctx.policy &&
        ctx.policy.denyDanger &&
        args.scene === 'fire_home' &&
        (act === 'get_steps' || act === 'get_daily' || act === 'triage')
      ) {
        lg('info', '否定闸：明确否认火灾，拒绝 fire_home 内容', {
          from: act,
          scene: args.scene,
        });
        return runOne(
          { act: 'refuse', args: { reason: 'denied-fire' }, why: 'policy-denied-fire' },
          i,
          planList
        );
      }

      /* 儿科溺水：drowning 条目是通用成人流程，儿童参数未覆盖 → dial 120。
         模型即使选了 drowning，也不能给儿童套用。 */
      if (
        (act === 'get_steps' || act === 'triage') &&
        args.scene === 'drowning' &&
        R &&
        R.isCprOutOfScope &&
        R.isCprOutOfScope(text) === 'pediatric'
      ) {
        lg('info', '儿科溺水：改拨号 120');
        return runOne(
          { act: 'dial', args: { number: '120' }, why: 'pediatric-drowning' },
          i,
          planList
        );
      }

      /* CPR 范围闸（docs/14 V4 C11/C12）：模型即使选 cpr，婴儿/儿童/溺水也不许出成人步骤。
         离线 planRule 已做同样判断；这里补在线模型路径，防止两路分叉。
         只拦 steps/triage：turn=plan 的 cpr 咨询应在下面降级为 get_daily，不能误拨号。 */
      if (
        (act === 'get_steps' || act === 'triage') &&
        args.scene === 'cpr' &&
        R &&
        R.isCprOutOfScope &&
        planned.turn !== 'plan' &&
        !(ctx.policy && ctx.policy.type === 'plan')
      ) {
        var cprScope = R.isCprOutOfScope(text);
        if (cprScope === 'drowning' && ctx.entries.drowning) {
          /* 溺水条目已发布：不套成人 cpr，但也不该只给拨号卡。
             先补 drowning 的 lookup，再把本步改成 drowning 的 get_steps。
             儿科溺水（isCprOutOfScope 返回 pediatric）仍走下面的 dial。 */
          var dl = T.execute(
            'lookup_scene',
            { scene: 'drowning' },
            { entries: ctx.entries, sceneIds: ctx.sceneIds, history: history }
          );
          if (dl.ok) {
            steps.push({
              act: 'lookup_scene',
              args: { scene: 'drowning' },
              ok: true,
              result: dl.result || null,
              why: 'cpr-to-drowning',
            });
            history.push({
              act: 'lookup_scene',
              args: { scene: 'drowning' },
              result: dl.result || null,
            });
            planList[i] = {
              act: 'get_steps',
              args: { scene: 'drowning' },
              why: 'cpr-out-of-scope-drowning',
              turn: planned.turn,
              evidence: planned.evidence,
            };
            lg('info', 'CPR 范围闸：溺水改走 drowning 条目', {});
            return step(i, planList);
          }
        }
        if (cprScope) {
          lg('info', 'CPR 范围闸：主体超出成人范围，改拨号', { scope: cprScope });
          return runOne(
            { act: 'dial', args: { number: '120' }, why: 'cpr-out-of-scope:' + cprScope },
            i,
            planList
          );
        }
      }

      /* 大出血精度闸（docs/14 V4 C10）：少量出血/划破皮不是大出血。
         模型可能因「血」字选 severe_bleeding；这里在出内容前拦住。 */
      if (
        (act === 'get_steps' || act === 'triage' || act === 'get_daily') &&
        args.scene === 'severe_bleeding' &&
        R &&
        R.isMinorBleeding &&
        R.isMinorBleeding(text)
      ) {
        lg('info', '大出血精度闸：少量出血，拒绝 severe_bleeding 内容');
        return runOne(
          { act: 'refuse', args: { reason: 'minor-bleeding' }, why: 'minor-bleeding' },
          i,
          planList
        );
      }

      /* 回合策略：优先级 = 模型 turn > 本地 policy。
         模型 turn 来自 /act 的 turn 字段（2026-11-21 新契约）；
         本地 policy 是兜底（模型没给 / 离线 / 旧缓存）。
         turn=plan 禁 steps/triage/dial；turn=off_scope 只许 refuse。 */
      var modelTurn = planned.turn || null;
      var policyTurn = ctx.policy && ctx.policy.type ? ctx.policy.type : null;
      var turn = modelTurn || policyTurn;
      var allowSteps =
        turn === 'plan' || turn === 'off_scope'
          ? false
          : turn === 'ongoing'
            ? true
            : ctx.policy
              ? ctx.policy.allowSteps !== false
              : true;

      if (turn === 'off_scope' && act !== 'refuse') {
        lg('info', '回合策略：off_scope 强制 refuse', { from: act, turn: turn });
        return runOne(
          { act: 'refuse', args: { reason: 'turn-off-scope' }, why: 'policy-turn' },
          i,
          planList
        );
      }

      if (allowSteps === false && (act === 'get_steps' || act === 'triage' || act === 'dial')) {
        if (args.scene && ctx.entries[args.scene]) {
          lg('info', '回合策略：降级为 get_daily', {
            from: act,
            scene: args.scene,
            turn: turn,
            evidence: planned.evidence || null,
          });
          return runOne(
            { act: 'get_daily', args: { scene: args.scene }, why: 'policy-downgrade' },
            i,
            planList
          );
        }
        return runOne(
          { act: 'refuse', args: { reason: 'policy-no-entry' }, why: 'policy-refuse' },
          i,
          planList
        );
      }

      return runOne(planned, i, planList);
    }

    function runOne(planned, i, planList) {
      var act = planned.act;
      var args = planned.args || {};
      var T2 = tools();
      var res = T2.execute(act, args, {
        entries: ctx.entries,
        sceneIds: ctx.sceneIds,
        history: history,
      });

      var rec = {
        act: act,
        args: args,
        ok: res.ok,
        result: res.result || null,
        why: planned.why || null,
        turn: planned.turn || null,
        evidence: planned.evidence || null,
      };
      steps.push(rec);
      // history 只记「真的执行过」的动作 —— 被门拒绝的不进 history，
      // 否则后续前置条件会把「被拒的 lookup」当成「查过了」。
      if (res.ok) history.push({ act: act, args: args, result: res.result });

      if (o.onStep) {
        try {
          o.onStep(rec, res);
        } catch (e) {
          lg('warn', 'onStep 回调抛错（已忽略，不影响循环）', { error: String(e && e.message) });
        }
      }
      if (o.exec) {
        try {
          o.exec(rec, res);
        } catch (e) {
          lg('warn', 'exec 回调抛错，降级', { error: String(e && e.message) });
        }
      }

      if (!res.ok) return finishSafe('exec-failed');
      if (res.ends) {
        end = res.kind;
        return Promise.resolve(summary('ended'));
      }

      // 非终态：继续下一步。ask 需要等用户，循环在此暂停（由 UI 重新进入）
      if (res.kind === 'ask') {
        /* ⚠️ 2026-11-19 修：原来只 return summary('waiting-user')，**没有设 end**，
           于是 summary 里 endKind = null、ok = false。
           后果不是功能坏（app.js 用 host 判断有没有产出，不靠 endKind），
           而是**统计与日志失明**：probe_multi_turn 把它记成 unknown，
           看起来像「模型给不出动作」，实际是「模型正确地追问了」。
           这类「功能正常但观测不到」的缺陷最难查，所以必须让 endKind 如实反映。

           ask 算「有产出」：用户在屏幕上确实看到了一张追问卡。 */
        end = 'ask';
        return Promise.resolve(summary('waiting-user'));
      }
      // triage 会把用户带到新的一轮（用户点选后重新 run），此处结束即可
      if (res.kind === 'triage') {
        end = 'triage';
        return Promise.resolve(summary('ended'));
      }
      return step(i + 1, planList);
    }

    /* 同参重复调用检测（docs/03 §2.5.7 的「上限」）。
       返回 true 表示「这一动作与历史里某次完全相同」。

       ⚠️ 判据的成立范围（写清楚，否则下一个人会以为它管所有工具）：
         能重复到达这里的**只有非终态工具**，即 lookup_scene 与 ask。
         终态工具（get_steps / get_daily / dial / refuse）执行完就 return，
         根本回不到 step()，所以不需要它们参与判断。
         · lookup_scene 是纯查询：参数相同 → 结果必然相同 → 同参即「无新信息」
         · ask 走的是 WAIT_USER，一次会话只允许问一次（§2.5.2），到不了第二次

       所以「同参」在 lookup_scene 上等价于「同参且同观察」，
       不需要额外比较 result —— 那不是简化，是这两个条件的合流。
       若将来新增一个**有副作用且可能返回不同结果**的探查工具，
       这里必须改成真正比较 result，否则会误杀合法的重试。 */
    function isRepeatedAct(act, args, hist) {
      if (act !== 'lookup_scene') return false;
      var argKey = JSON.stringify(args || {});
      for (var k = 0; k < hist.length; k++) {
        if (hist[k].act === act && JSON.stringify(hist[k].args || {}) === argKey) return true;
      }
      return false;
    }

    function finishSafe(reason) {
      var T3 = tools();
      // 已经在终态输出过就不再补
      if (end) return Promise.resolve(summary('already-ended'));
      var res = T3.execute(
        'refuse',
        { reason: reason },
        { entries: ctx.entries, sceneIds: ctx.sceneIds, history: history }
      );
      var rec = {
        act: 'refuse',
        args: { reason: reason },
        ok: true,
        result: res.result,
        why: 'safe-exit',
      };
      steps.push(rec);
      history.push({ act: 'refuse', args: { reason: reason }, result: res.result });
      if (o.exec) {
        try {
          o.exec(rec, res);
        } catch (e) {
          lg('warn', '安全出口渲染失败', { error: String(e && e.message) });
        }
      }
      end = 'refuse';
      degraded = true;
      return Promise.resolve(summary(reason));
    }

    function summary(reason) {
      return {
        ok: !!end,
        steps: steps,
        endKind: end,
        degraded: degraded,
        reason: reason,
        history: history,
      };
    }

    /* 入口：计划有三种来源，优先级从高到低
       ① opts.plan  —— 调用方已算好（如 app.js 消费 LLM 判定结论后映射而来）
       ② opts.decide —— 探查类交给模型（真·自主循环，需要代理 /act 端点）
       ③ 都没有      —— 纯规则计划（离线 / 降级）

       ⚠️⚠️ 2026-11-19 踩过的坑（e2e_llm 里 4 条预防/库外问题全变 steps 卡）：
       第一版让 detectDanger **无条件优先**，结果「怎么预防煤气泄漏」因为含「煤气」
       被判成紧急，把 LLM 已经判对的 prevention 盖掉 —— 这正是 llm.js 在
       2026-11-18 修过的同一个 bug（L3 那 40% 误纳率被原样搬进 LLM 路径）。

       正确优先级：
         **有 LLM 判定结论（o.plan）时，以 LLM 为准，detectDanger 不得覆盖。**
         detectDanger 只在「没有模型结论」时才当第一道判定 —— 即离线/降级路径。
       这与 docs/03 §3.7「紧急关键词先判」不冲突：那条说的是**离线或模型不可用时**的
       第一道判定，不是「永久凌驾于模型之上」。

       代价（如实记）：在线模式下紧急场景仍有 1 次 LLM 往返（实测 683–1627ms），
       不是 0 次。真正零往返的只有离线/降级路径与点图标路径。 */
    var R = global.RETRIEVAL;
    var danger = R && R.detectDanger ? R.detectDanger(text) : null;
    var hasDecide = typeof o.decide === 'function';

    if (o.plan && o.plan.length) {
      lg('debug', '使用调用方给定计划（模型结论优先，不被关键词覆盖）', {
        steps: o.plan.length,
        dangerAlsoHit: danger ? danger.id : null,
      });
      return step(0, o.plan);
    }

    /* ⚠️ 离线判断必须在 hasDecide 之前：
       断网时 decide 一定会失败（fetch 抛错），让它先跑一次只是白等 2.5 秒超时，
       而且会让「离线」这件事被当成「模型出错」。先判网络，直接走规则计划。 */
    if (netState() === 'offline') {
      lg('info', '离线模式，走规则计划（不尝试调用模型）');
      degraded = true;
      return step(0, planRule(text, ctx));
    }

    /* ⚠️⚠️⚠️ 2026-11-19 同一个坑踩了三次，每次症状都是「预防咨询变急救步骤卡」：
         第 1 次 detectDanger 无条件优先 → 「怎么预防煤气泄漏」被「煤气」命中
         第 2 次 改成 o.plan 优先，但 decide 路径仍让 detectDanger 抢先
         第 3 次 想用 detectDanger 给 refuse 兜底 → 「煤气费怎么交」又被命中

       根因一句话：**关键词只看字面，模型能看语义；在线时前者优先级必须低于后者。**
       「怎么预防煤气泄漏」与「煤气费怎么交」都含「煤气」，字面无法区分，
       只有模型分得清「问预防」和「问缴费」。这正是 docs/08 §5.1 记录的
       L3 字符匹配硬缺陷 —— 同样的错误不该在工具层再犯。

       安全性依据（不是空口）：模型在 emergency 组实测 40/40（docs/03 §6），
       不依赖关键词也全对；库外由 e2e 的 30 条 off_scope 用例兜住；
       真出事时用户还能点图标（不过判定层，直接出步骤卡，§3.3 兜底路径）。 */
    if (hasDecide) {
      lg('debug', '在线自主循环：由模型逐步选工具', {
        dangerAlsoHit: danger ? danger.id : null,
        note: 'detectDanger 在此路径不参与决策',
      });
      // 哨兵：act 为 null 表示「这一步让模型现场决定」
      return step(0, [{ act: null, args: {}, why: 'decide-first' }]);
    }

    if (danger) {
      lg('debug', '无模型结论且紧急命中，走规则计划', { dangerId: danger.id });
      return step(0, planRule(text, ctx));
    }

    return buildPlan(text, ctx, o.decide).then(function (planList) {
      return step(0, planList);
    });
  }

  global.AGENT = {
    run: run,
    planRule: planRule,
    netState: netState,
    MAX_STEPS: MAX_STEPS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
