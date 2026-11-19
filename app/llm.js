/* =========================================================
   应急助手 · LLM 意图判定客户端
   依据：docs/03 §2（判定层）、§5（三层兜底）

   为什么前端不直连 DeepSeek：
     key 写进 app/*.js，任何人 F12 就能拿到并盗用。这是硬约束不是取舍。
     所以前端只调本机代理（tools/llm_proxy.mjs），key 只在代理进程里。

   三个必须守住的行为（都有断言）：
     1. 代理不可用 → 静默回落 l3，不弹错误、不白屏（S1 的可用性前提）
     2. 超时 → 同上。默认 2500ms，宁可退字符检索也不让老人干等
     3. 返回的 scene 不在已发布集合内 → 不给步骤，只给拨号卡（S1 不许编）

   注意：本文件不含任何密钥，也不读 .env（浏览器读不到）。
   ========================================================= */
(function (global) {
  'use strict';

  /* 运行日志（M0 = app/log.js）。可选依赖：没加载就全部 no-op。 */
  var LOG = global.LOG || null;
  function lg(level, msg, fields) {
    if (!LOG) return;
    var t = LOG.tag('llm');
    if (t[level]) t[level](msg, fields);
  }

  var DEFAULT_ENDPOINT = 'http://127.0.0.1:8787/judge';
  var DEFAULT_TIMEOUT = 2500;

  /* 置信度门槛（docs/03 §2.2「低于阈值不猜」+ §3.5）
     2026-11-18 实测标定，不是拍的：
       100 条评测集上 confidence 分布 min=0.55 / P05=0.75 / P50=0.95；
       两条判错样本里，O005「燃气灶打不着火」conf=0.55，P014「灭火器怎么选」conf=0.95。
       扫描 T=0.50→0.90：T=0.60 时 ④ 库外误纳率 96.7% → 100%（归零），
       综合准确率仅从 98.0% 降到 97.0%，代价是 2 条正确样本被降级。
     结论：0.60 是使安全项归零的最小阈值，取它。
     代价已知：P014 那类「高置信度判错」阈值救不了，只能靠改 prompt 或补样本。 */
  var MIN_CONFIDENCE = 0.60;

  var cfg = {
    endpoint: DEFAULT_ENDPOINT,
    timeout: DEFAULT_TIMEOUT,
    enabled: true,
    // 最近一次失败原因，供界面提示与排查（不展示给最终用户）
    lastError: null
  };

  /* ---------- 状态 ---------- */
  var stats = {
    calls: 0,
    ok: 0,
    failed: 0,
    timeouts: 0,
    fallbacks: 0
  };

  function configure(opts) {
    if (!opts) return cfg;
    if (opts.endpoint) cfg.endpoint = opts.endpoint;
    if (typeof opts.timeout === 'number') cfg.timeout = opts.timeout;
    if (typeof opts.enabled === 'boolean') cfg.enabled = opts.enabled;
    return cfg;
  }

  /* 带超时的 fetch。AbortController 是唯一可靠的中断方式：
     fetch 本身没有 timeout 参数，靠 Promise.race 只能「假装」超时，
     底层请求仍在跑，会继续占连接。 */
  function fetchWithTimeout(url, body, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error('代理返回 ' + r.status + ': ' + String(t).slice(0, 120));
        });
      }
      return r.json();
    }, function (e) {
      clearTimeout(timer);
      throw e;
    });
  }

  /**
   * 判定一句输入。
   * @returns {Promise<{ok:boolean, intent:string|null, scene:string|null,
   *                    confidence:number, source:'llm'|'fallback', error?:string}>}
   *
   * 永远 resolve，永不 reject —— 调用方不该为「模型挂了」写 try/catch。
   */
  function judge(text) {
    var t = String(text || '').trim();
    if (!cfg.enabled || !t) {
      lg('debug', '判定跳过', { reason: cfg.enabled ? 'empty-text' : 'disabled' });
      return Promise.resolve({ ok: false, intent: null, scene: null, confidence: 0, source: 'fallback', error: 'disabled' });
    }

    stats.calls++;
    var t0 = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    // trace 带进代理，这样代理侧那行日志能与前端对齐
    var trace = LOG ? LOG.getTrace() : null;
    return fetchWithTimeout(cfg.endpoint, { text: t, trace: trace }, cfg.timeout)
      .then(function (d) {
        if (!d || typeof d.intent !== 'string') {
          throw new Error('代理返回结构不合法');
        }
        stats.ok++;
        cfg.lastError = null;
        var v = {
          ok: true,
          intent: d.intent,
          scene: d.scene === undefined ? null : d.scene,
          sceneUnpublished: !!d.scene_unpublished,
          confidence: typeof d.confidence === 'number' ? d.confidence : 0,
          latency: d.latency_ms || 0,
          cached: !!d.cached,
          source: 'llm'
        };
        /* 摘要行 always：这是「为什么给/不给步骤」的源头，必须落盘。
           belowThreshold 单独算出来，省得看日志的人自己比 0.60。 */
        if (LOG && LOG.always) {
          LOG.always('llm', '判定完成', {
            intent: v.intent,
            scene: v.scene,
            confidence: v.confidence,
            belowThreshold: v.confidence < MIN_CONFIDENCE,
            sceneUnpublished: v.sceneUnpublished,
            cached: v.cached,
            modelMs: v.latency,
            ms: t0 ? (Date.now() - t0) : null
          });
        }
        return v;
      })
      .catch(function (e) {
        var isTimeout = e && (e.name === 'AbortError' || /abort/i.test(String(e.message)));
        if (isTimeout) stats.timeouts++; else stats.failed++;
        stats.fallbacks++;
        cfg.lastError = isTimeout ? 'timeout' : String((e && e.message) || e);
        /* 关键：这里不抛错。返回 fallback 让调用方走 l3。
           模型不可用是常态（断网、代理没起、key 过期），
           它不该表现为用户看到的一个错误弹窗。
           但**必须记 warn**：这是降级事件，不是正常路径。 */
        lg('warn', isTimeout ? '判定超时，回落 l3' : '判定失败，回落 l3', {
          timeoutMs: cfg.timeout,
          ms: t0 ? (Date.now() - t0) : null,
          error: cfg.lastError
        });
        return { ok: false, intent: null, scene: null, confidence: 0, source: 'fallback', error: cfg.lastError };
      });
  }

  /* 健康检查：界面可选用来决定是否显示「语义模式」标记 */
  function health() {
    return fetch(cfg.endpoint.replace(/\/judge$/, '/health'), { method: 'GET' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /**
   * 把 LLM 判定映射成路由决策。
   *
   * 这是整个接入里最需要小心的一步：LLM 只给标签，路由由代码定
   * （docs/03 §2 A1「判定层只输出标签，不输出文字」）。
   *
   * @param verdict judge() 的返回值
   * @param entries 已发布条目表
   * @param dangerRules 危险信号判定函数（l3 的，作为安全兜底）
   */
  function routeByVerdict(verdict, entries, detectDanger, text) {
    var decision = decideRoute(verdict, entries, detectDanger, text);
    /* 路由结论必须落盘（always）：`reason` 字段是「为什么给这张卡」
       的唯一解释，包括 danger-override / low-confidence 这些分支。
       2026-11-18「电梯广告怎么投诉」误给步骤卡，就是靠这个字段定位的。 */
    if (LOG && LOG.always) {
      LOG.always('llm', decision ? '路由结论' : '路由未参与', {
        action: decision ? decision.action : null,
        entryId: decision ? decision.entryId : null,
        sceneId: decision ? decision.sceneId : null,
        reason: decision ? decision.reason : 'llm-unavailable'
      });
    }
    return decision;
  }

  function decideRoute(verdict, entries, detectDanger, text) {
    // 兜底：LLM 不可用 → 完全走原 l3 逻辑，行为与接入前一致
    if (!verdict || !verdict.ok) {
      lg('debug', '路由未参与（LLM 无结论），交回 l3');
      return null;
    }

    /* 置信度门槛：低于阈值一律不猜（docs/03 §2.2）。
       为什么不「低置信度时给拨号卡」：给号码也要先判对场景，判不对时
       给的是错场景的号码（「燃气灶打不着火」会拿到 119）。
       拒答卡本身带 tel:120 拨号按钮（S4），图标区也仍在，
       所以「拒答」不等于「用户无路可走」。 */
    if (typeof verdict.confidence === 'number' && verdict.confidence < MIN_CONFIDENCE) {
      lg('info', '置信度低于门槛，降级为拒答', {
        confidence: verdict.confidence, threshold: MIN_CONFIDENCE,
        intent: verdict.intent, scene: verdict.scene
      });
      return {
        action: 'refuse',
        entryId: null,
        reason: 'low-confidence',
        confidence: verdict.confidence
      };
    }

    var scene = verdict.scene;
    var hasEntry = !!(scene && entries && entries[scene]);

    /* 关键词兜底：**只在 LLM 认为是紧急、但归不出场景时**启用。
     *
     * ⚠️ 2026-11-18 修 bug：上一版的条件是「只要关键词命中且该场景有条目」就给步骤，
     *    结果「电梯广告怎么投诉」（LLM 正确判 off_scope → scene=null）因为含「电梯」
     *    被兜底成 elevator_trapped 的步骤卡 —— 用户问投诉，收到急救步骤。
     *    这正是 L3 那个 40% 误纳率，被原样搬到了 LLM 路径上，
     *    把 LLM 判对的结论又盖掉了。
     *
     * 收紧后的规则：
     *   - ongoing + 有场景   → 正常走 llm-ongoing（不需要兜底）
     *   - ongoing + 无场景   → 用关键词兜底（LLM 认为是紧急，只是说不出是哪个场景）
     *   - prevention        → 尊重 LLM，**不**兜底（「怎么预防煤气泄漏」不该给步骤卡）
     *   - off_scope         → 尊重 LLM，**不**兜底（关键词命中不等于正在出事）
     *
     * 代价：LLM 若把「煤气漏了」误判成 off_scope，兜底不再救它。
     * 但实测 LLM 在 ongoing 类上 40/40，这个代价可接受；
     * 反过来「误给急救步骤」的代价不可接受——它违背 S1（不许编/不许答不该答的）。
     */
    var danger = (verdict.intent === 'ongoing' && !hasEntry && detectDanger)
      ? detectDanger(text) : null;
    if (danger && entries && entries[danger.id]) {
      return { action: 'steps', entryId: danger.id, reason: 'danger-override' };
    }

    if (verdict.intent === 'ongoing') {
      if (hasEntry) return { action: 'steps', entryId: scene, reason: 'llm-ongoing' };
      if (scene) return { action: 'dialonly', entryId: null, sceneId: scene, reason: 'llm-ongoing-unpublished' };
      return { action: 'refuse', entryId: null, reason: 'llm-ongoing-noscene' };
    }

    if (verdict.intent === 'prevention') {
      if (hasEntry) return { action: 'daily', entryId: scene, reason: 'llm-prevention' };
      return { action: 'refuse', entryId: null, reason: 'llm-prevention-noscene' };
    }

    // off_scope 以及任何未知 intent
    return { action: 'refuse', entryId: null, reason: 'llm-off-scope' };
  }

  global.LLM = {
    judge: judge,
    health: health,
    configure: configure,
    config: cfg,
    stats: stats,
    routeByVerdict: routeByVerdict,
    DEFAULT_ENDPOINT: DEFAULT_ENDPOINT
  };
})(typeof window !== 'undefined' ? window : globalThis);
