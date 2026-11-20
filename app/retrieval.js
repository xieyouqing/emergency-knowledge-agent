/* =========================================================
   应急助手 · 检索层（三层引擎统一入口）
   依据：docs/03-技术方案.md §3 / §5

   为什么单独成文件（docs/03 §7.1 D-3 的连带改动）:
     三层引擎必须能被同一份 100 条评测集无差别调用，
     否则「测的」和「用的」是两套实现，数据没有决策价值。
     故检索逻辑全部收在此处，app.js 只负责 UI 与路由。

   三个引擎（全部同步、全部离线可用）:
     l3     字符规则分（离散：alias 10 / name 9 / keyword 4+k）
            ★ 生产默认。三层兜底的最底层，自带绝对判据
     bm25   中文 bigram 的 BM25（无界分，不能做绝对阈值）
     hybrid RRF 融合 l3 + bm25（相对排序，用于对照实验）

   ⚠️ 切生产默认引擎属「取舍」类决定，须先提案，不许在这里偷偷改。
      当前 RETRIEVAL_ENGINE = 'l3'，与 M1 基线逐条一致。
   ========================================================= */
(function (global) {
  'use strict';

  /* 运行日志（M0 = app/log.js）。可选依赖：
     日志没加载时全部退化为 no-op，检索行为一个字都不变。 */
  var LOG = global.LOG || null;
  function lg(level, msg, fields) {
    if (!LOG) return;
    var t = LOG.tag('retrieval');
    if (t[level]) t[level](msg, fields);
  }

  /* ---------- 危险信号关键词表（L3 的意图判定，非场景检索） ----------
     覆盖 index.json 全部 10 个场景的典型口语说法。
     number 取 docs/02-数据契约 §4.1 候选池表的「默认主推号码」，
     未发布场景没有条目可读，故在此写死。

     已知代价（不藏）：纯词命中即切紧急，所以「怎么预防燃气泄漏」
     这类日常提问也会切紧急。这是 docs/01 §3.0「策略 C：宁可多切，
     不做降级」的直接后果，不是实现缺陷。 */

  /* 命中顺序 = 优先级。数组靠前先命中即返回，所以顺序本身就是规则。
     2026-11-18 修复 B2：co_poisoning 必须在 gas_leak 之前。
       原因：「好像煤气中毒了」含「煤气」，gas_leak 在前会被误判成泄漏。
       但两者处置相反——泄漏是关阀+撤离(119)，中毒是搬离+通风(120)，
       判错方向比不答更危险。
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

  /* ---------- 生产默认引擎 ----------
     'l3' = 现状，与 M1 基线逐条一致。
     改成 'hybrid' 前必须先证明它在 100 条集上更好，且通过提案。 */
  var RETRIEVAL_ENGINE = 'l3';

  /* ---------- 工具 ---------- */
  function norm(s) {
    return String(s || '').replace(/\s+/g, '').toLowerCase();
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

  /* ---------- 危险信号判定（意图层，与场景检索正交） ---------- */
  function detectDanger(text) {
    var t = norm(text);
    for (var i = 0; i < DANGER_RULES.length; i++) {
      var r = DANGER_RULES[i];
      for (var j = 0; j < r.words.length; j++) {
        if (hitNoNegation(t, r.words[j])) {
          /* 记「命中哪个词」而不是只记「命中了」：
             否定前缀误判（「打不着火」）只能靠命中词定位。 */
          lg('debug', '危险信号命中', { rule: r.id, word: r.words[j], number: r.number });
          return r;
        }
      }
    }
    lg('debug', '危险信号未命中');
    return null;
  }

  /* ---------- B 方案用：严格危重词 / 进行时词（2026-11-20） ----------
     为什么不直接用 DANGER_RULES 做预置：
       DANGER_RULES 是**场景词**，含「煤气」「着火」这类字面词，
       「怎么预防煤气泄漏」也会命中。拿它预置 lookup 会把预防咨询
       预置成紧急场景，重演 2026-11-19 的旧 bug（三次踩坑，见 agent.js 注释）。

     两张表分工：
       SEVERE_WORDS  = 明确需要拨号的危重状态（无呼吸/心跳停/大出血）
       ONGOING_WORDS = 危险正在发生的进行时（漏了/着火了/倒地/被困）
     两张表都**不含**场景名词本身，且调用方还会再排除「预防/要不要/多久」类措辞。
     它们是 B 方案的**加速条件**，不是新的安全判据 —— 不命中就回落现有 2 次往返。 */
  var SEVERE_WORDS = [
    '没有呼吸', '没呼吸', '无呼吸', '呼吸停止', '呼吸停了',
    '心跳停止', '心跳停了', '没有脉搏', '无脉搏',
    '大出血', '流血不止', '止不住血'
  ];
  var ONGOING_WORDS = [
    '漏了', '在漏', '漏气',
    '着了', '着火', '起火', '冒烟', '烟很大', '有烟',
    '倒地', '倒在地上', '晕倒', '起不来', '爬不起来',
    '摔了', '摔倒', '跌了', '绊倒',
    '困在', '被困', '触电', '电到',
    '溺水', '落水', '掉水里',
    '噎住', '卡住喉咙',
    '烫了', '烫到', '被烫', '烫起泡',
    '流血不止', '止不住'
  ];

  function detectFrom(text, words) {
    var t = norm(text);
    for (var i = 0; i < words.length; i++) {
      if (hitNoNegation(t, words[i])) return words[i];
    }
    return null;
  }
  function detectSevere(text) {
    return detectFrom(text, SEVERE_WORDS);
  }
  function detectOngoing(text) {
    return detectFrom(text, ONGOING_WORDS);
  }

  /* ---------- CPR 范围外主体（2026-11-21，docs/14 §2.2 / §4.2 C11-C12） ----------

     要解决的实际错误：`cpr` 条目发布后，「婴儿没呼吸」「溺水没呼吸」直接拿到了
     成人 CPR 步骤（按压 5-6cm、30:2）。`14` §2.2 明确这两类本轮不做——
     婴幼儿的按压深度/手法/比例不同，溺水复苏的优先顺序也不同。

     ⚠️ 为什么必须在**发布后**才暴露出这个问题：
       cpr 未发布时，`planRule` 的 severe 分支查不到条目，落到 `dial 120`（安全兜底）；
       条目一发布，同一个分支立刻变成「无差别给成人步骤」。
       **是发布动作把兜底变成了越界，不是新增代码引入的。**

     代价说清（不藏）：
       「孩子」在中文口语里也可能指成年子女（「我孩子在外地工作」）。
       所以把它也列进来，会产生一种误判：成年子女无呼吸时只给拨号卡、不给按压步骤。
       这个误判的方向是**少给内容**（dial 120 仍是正确的第一动作），不是给错内容。
       反过来若不列，「孩子没呼吸」会拿到成人按压深度——那才是给错。
       两害相权取「少给」。 */
  var PEDIATRIC_WORDS = ['婴儿', '宝宝', '新生儿', '幼儿', '小孩', '儿童', '孩子'];
  var DROWNING_WORDS = ['溺水', '落水', '掉水里', '淹了', '淹死', '水里捞', '水中'];

  function isCprOutOfScope(text) {
    var t = norm(text);
    for (var i = 0; i < PEDIATRIC_WORDS.length; i++) {
      if (t.indexOf(PEDIATRIC_WORDS[i]) !== -1) return 'pediatric';
    }
    for (var j = 0; j < DROWNING_WORDS.length; j++) {
      if (t.indexOf(DROWNING_WORDS[j]) !== -1) return 'drowning';
    }
    return null;
  }

  /* 「叫不醒 / 没反应，但还有呼吸」：P20-c 条目未发布前只能拨号（docs/14 C5/C6）。
     为什么不能落 cpr：还有呼吸的人不需要胸外按压；也不能落 fall_elderly 分诊。 */
  var UNRESPONSIVE_RE = /叫不醒|叫不应|没反应|无反应|无意识|意识不清|昏迷/;
  var BREATHING_RE = /还有呼吸|有呼吸|呼吸正常|在呼吸|呼吸平稳/;
  function isUnresponsiveWithBreathing(text) {
    var t = norm(text);
    return UNRESPONSIVE_RE.test(t) && BREATHING_RE.test(t);
  }

  /* 轻微出血：少量、能止住、划破皮。不能因为出现「血」就走大出血条目。 */
  var MINOR_BLEEDING_RE = /没出多少血|没流多少血|一点点血|少量出血|小口子|划破|擦破|破了点皮/;
  function isMinorBleeding(text) {
    var t = norm(text);
    if (!MINOR_BLEEDING_RE.test(t)) return false;
    /* 同时明确说「止不住 / 大出血」时，仍按危重处理。 */
    return !/大出血|流血不止|止不住血|止不住/.test(t);
  }

  /* 「如果/万一/假如……怎么办」问的是预案，不是现在出事。
     为什么单独成一个判据而不是塞进 DANGER_RULES：
       「如果发生火灾怎么办」仍含「火灾」，但它不该触发紧急锁定；
       把否定/假设当成一种「场景」会让词表越来越糊。
     这个词表只影响路由，不改变任何条目的危险信号判定。 */
  var HYPOTHETICAL_RE = /如果|万一|假如|要是|倘若|假使/;
  function isHypothetical(text) {
    return HYPOTHETICAL_RE.test(norm(text));
  }

  /* 用户是否明确说「已经解除」。
     只用于「ack 之后自动退出紧急」这一道复核；模型误 ack 时不能把老人退出。
     不明确 → 保持紧急，只给单次点击兜底。 */
  var RESOLVED_RE =
    /已经.{0,4}(安全|没事|脱困|出来|得救)|安全了|没事了|脱困了|出来了|得救了|门开了|火灭了|灭了|缓过来了|不漏了|不漏气|没有危险了/;
  function isResolved(text) {
    var t = norm(text);
    /* 「应该没事了吧 / 好像安全了」是猜测，不是确认；规则 8 明确不算解除。 */
    if (/好像|可能|应该|也许|大概|是不是|不确定|似乎/.test(t)) return false;
    return RESOLVED_RE.test(t);
  }

  /* 用户是否明确否认“着火/火灾”这一类危险。
     为什么要单独一条：R30「不是着火，是锅烧糊了，冒点烟」里，
     “冒点烟”会让词表命中 fire_home；但用户已经明确否认火灾。
     这只处理「明确否认」，不处理模糊猜测；也不覆盖“没呼吸”等危重词。 */
  var DENIED_FIRE_RE = /不是(着|起|冒)?火|不是火灾|并非(着|起)火|没见明火|没有明火|没看到明火/;
  function isDeniedFire(text) {
    var t = norm(text);
    if (/好像|可能|应该|也许|大概|是不是|不确定|似乎/.test(t)) return false;
    return DENIED_FIRE_RE.test(t);
  }

  /* 回合策略（2026-11-20 用户裁决「工作流 + 自主决策」）：
     先用本地规则判「这一轮是在问预案/预防，还是现场正在发生」，
     再把这个结论作为**工具约束**交给 /act；模型仍在允许的工具里自主选。
     为什么不用再调一次 /judge：这是路由约束，不是语义判定；本地规则足够，
     且不增加首轮 3 秒预算的往返。

     只约束两种情况：
       hypothetical / prevention → allowSteps=false（禁 get_steps/triage/dial）
       ongoing / unknown          → allowSteps=true（保持自主）
     不试图判 off_scope —— 那仍交给模型/refuse，避免误伤「安全防护设备选购」。 */
  var PLAN_RE =
    /怎么预防|如何预防|怎么防止|如何避免|要不要|该不该|多久|注意事项|怎么选|有用吗|平时|日常检查|怎么检查/;

  function turnPolicy(text) {
    var t = norm(text);
    if (!t) return { type: 'unknown', allowSteps: true, denyDanger: false };
    var denyDanger = isDeniedFire(t);
    if (isHypothetical(t)) {
      return { type: 'hypothetical', allowSteps: false, denyDanger: denyDanger };
    }
    if (PLAN_RE.test(t)) {
      return { type: 'prevention', allowSteps: false, denyDanger: denyDanger };
    }
    var severe = detectSevere(t);
    var danger = detectDanger(t);
    var ongoing = detectOngoing(t);
    if (severe || (danger && ongoing)) {
      return { type: 'ongoing', allowSteps: true, denyDanger: denyDanger };
    }
    return { type: 'unknown', allowSteps: true, denyDanger: denyDanger };
  }

  /* B 方案的纯决策函数：只回答「首轮该不该本地预置、预置成什么」。
     为什么放在检索层而不是 app.js：它是**判定逻辑**，必须能脱离 DOM 离线测；
     app.js 只负责把结果翻译成 plan/history。
     返回：
       null                          → 不预置，走现有 2 次往返
       {kind:'dial', number, why}    → 本地直接拨号（0 次模型）
       {kind:'lookup', scene, why}   → 预置 lookup，模型 1 次决策出内容

     ⚠️ 预防类措辞优先排除：`怎么预防煤气泄漏` 含场景词，但不是在说事。 */
  /* 除预防外，还要排除「检查/平时/有没有」与事务性咨询（保险/理赔/投诉/费用）。
     依据 2026-11-20 开发集误报：P004「平时怎么检查有没有漏气」、
     O011「摔倒保险怎么理赔」都含进行时词，但不是在说「正在出事」。 */
  var PREVENTION_RE =
    /预防|防止|避免|要不要|多久|注意事项|安全吗|有用吗|怎么防|检查|平时|有没有|保险|理赔|投诉|缴费|费用|多少钱/;

  function seedDecision(text, entries) {
    var t = String(text || '');
    if (!t || PREVENTION_RE.test(t)) return null;

    if (isUnresponsiveWithBreathing(t)) {
      return { kind: 'dial', number: '120', why: 'unresponsive-breathing-no-entry' };
    }

    var severe = detectSevere(t);
    if (severe) {
      /* 2026-11-21：cpr / severe_bleeding 已发布，危重不再无条件拨号。
         与 planRule 同口径：婴儿/儿童/溺水不进成人 cpr → dial；其余查条目。
         条目没发布时仍然 dial（安全兜底不变）。 */
      var isBleeding = /大出血|流血不止|止不住血/.test(severe);
      var severeScene = isBleeding ? 'severe_bleeding' : 'cpr';
      var outOfScope = !isBleeding && isCprOutOfScope(t);
      /* 溺水的专属条目已发布：成人/未标明年龄的溺水走 drowning，
         不再因为「不能用成人 cpr」而一刀切拨号。儿科仍 dial（无儿科 CPR）。 */
      if (outOfScope === 'drowning' && entries && entries.drowning) {
        severeScene = 'drowning';
        outOfScope = null;
      }
      if (!outOfScope && (entries || {})[severeScene]) {
        return {
          kind: 'lookup',
          scene: severeScene,
          number: '120',
          why: 'severe-entry:' + severeScene,
        };
      }
      return { kind: 'dial', number: '120', why: 'severe:' + severe };
    }

    var danger = detectDanger(t);
    if (!danger) return null;
    var ongoing = detectOngoing(t);
    if (!ongoing) return null;

    var entry = (entries || {})[danger.id];
    if (!entry) {
      return { kind: 'dial', number: danger.number || '120', why: 'no-entry:' + danger.id };
    }
    return { kind: 'lookup', scene: danger.id, number: danger.number, why: 'ongoing:' + ongoing };
  }

  /* =========================================================
     引擎 A：L3 字符规则分
     离散分数自带绝对判据：top > 0 = 规则命中，top == 0 = 未命中。
     这是三层里唯一不需要分布假设的绝对判据（docs/03 §5.2）。
     ========================================================= */

  /* alias 命中 10 分（口语说法最可信）
     name  命中  9 分
     keyword 命中 4 + 命中个数（随个数增长，但低于 name）
     alias 反向包含 6 分（用户输入是别名的一部分，如输入「电梯」对上「电梯困住」）

     ⚠️ 正向匹配全部走 hitNoNegation，不用裸 indexOf。
        2026-11-18 回归修复：「汽车打不着火」含子串「着火」，
        fire_home 还没有条目时这条不会暴露（bestMatch 无从命中）；
        条目发布后立刻变成误判——detectDanger 有否定检查、这里没有，
        同一个词表两条路径检查不一致就是 bug。
        否定前缀只用于正向匹配；反向包含（a.indexOf(t)）是「用户输入更短」，
        不存在否定语义，故不检查。 */
  function scoreEntryByRules(entry, text) {
    var t = norm(text);
    var best = 0;
    var why = '';
    var aliases = entry.aliases || [];
    for (var i = 0; i < aliases.length; i++) {
      var a = norm(aliases[i]);
      if (!a) continue;
      if (hitNoNegation(t, a)) {
        if (best < 10) { best = 10; why = 'alias:' + aliases[i]; }
      } else if (a.indexOf(t) !== -1 && t.length >= 2) {
        if (best < 6) { best = 6; why = 'alias-rev:' + aliases[i]; }
      }
    }
    if (entry.name && best < 9 && hitNoNegation(t, entry.name)) {
      best = 9; why = 'name';
    }
    var kw = 0;
    (entry.keywords || []).forEach(function (k) {
      if (k && hitNoNegation(t, k)) kw++;
    });
    if (kw > 0) {
      var s = 4 + Math.min(kw, 4);
      if (s > best) { best = s; why = 'keyword*' + kw; }
    }
    return { score: best, why: best > 0 ? why : '' };
  }

  function rankByRules(entries, text) {
    var out = [];
    var detail = [];
    entries.forEach(function (e) {
      var r = scoreEntryByRules(e, text);
      // 逐条得分只在 debug 记：一次提问 9 条，落盘会淹没摘要
      if (r.score > 0) detail.push({ id: e.id, score: r.score, why: r.why });
      if (r.score > 0) out.push({ id: e.id, score: r.score, by: 'l3', why: r.why });
    });
    out.sort(function (x, y) { return y.score - x.score; });
    lg('debug', 'L3 规则打分', { hit: out.length, top: detail.slice(0, 3) });
    return out;
  }

  /* =========================================================
     引擎 B：BM25（中文 bigram）

     分词：不用词典，中文按二元组切（「煤气泄漏」→ 煤气/气泄/泄漏），
           ASCII 连续段整体成词（"120" → "120"）。
           选 bigram 而非单字：单字区分度太低（「电梯」与「电梯广告」
           共享「电」「梯」，反而放大误命中）。
           不引词典：3 条条目规模下，词典维护成本 > 收益（docs/03 §3.3）。

     检索单元：一条 entry = 一个单元（D1 整条），不切块。
           依据 docs/03 §3.1：切块触发条件是单场景字段 > 8KB 或挂载文档 ≥ 3，
           当前 3 条 entry 各 1–2KB，远未触发。

     检索文本字段：name + aliases + keywords（场景标识）。
           刻意不含 steps / daily —— 这一层的任务是「定位场景」，
           不是「找答案段落」。把 steps 拼进来会让「拨打」这类
           通用动词参与打分，反而稀释场景词权重。
     ========================================================= */
  var BM25_K1 = 1.2;
  var BM25_B = 0.75;
  var RRF_K = 60;

  function tokenize(text) {
    var s = String(text || '').toLowerCase();
    var out = [];
    var re = /[\u4e00-\u9fff]+|[a-z0-9]+/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      var seg = m[0];
      if (/^[a-z0-9]+$/.test(seg)) { out.push(seg); continue; }
      if (seg.length === 1) { out.push(seg); continue; }
      for (var i = 0; i + 1 < seg.length; i++) out.push(seg.substr(i, 2));
    }
    return out;
  }

  function searchableText(entry) {
    var parts = [];
    if (entry.name) parts.push(entry.name);
    (entry.aliases || []).forEach(function (a) { parts.push(a); });
    (entry.keywords || []).forEach(function (k) { parts.push(k); });
    return parts.join(' ');
  }

  var _idxCache = { key: '', idx: null };

  function buildIndex(entries) {
    var key = entries.map(function (e) { return e.id; }).join(',');
    if (_idxCache.key === key && _idxCache.idx) return _idxCache.idx;

    var docs = [];
    var df = {};
    var totalLen = 0;
    entries.forEach(function (e) {
      var tokens = tokenize(searchableText(e));
      var tf = {};
      tokens.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
      docs.push({ id: e.id, tf: tf, len: tokens.length });
      Object.keys(tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      totalLen += tokens.length;
    });

    var idx = {
      docs: docs,
      df: df,
      N: docs.length,
      avgdl: docs.length ? totalLen / docs.length : 0
    };
    _idxCache = { key: key, idx: idx };
    return idx;
  }

  function rankByBM25(entries, text) {
    var idx = buildIndex(entries);
    var qTokens = tokenize(text);
    if (!qTokens.length || !idx.N) return [];

    // query 去重，避免同一 bigram 重复计分
    var seen = {};
    var q = qTokens.filter(function (t) {
      if (seen[t]) return false;
      seen[t] = true;
      return true;
    });

    var out = [];
    idx.docs.forEach(function (d) {
      var score = 0;
      var hits = [];
      q.forEach(function (t) {
        var f = d.tf[t] || 0;
        if (!f) return;
        var n = idx.df[t] || 0;
        // IDF：加 1 保证非负（Lucene 写法），3 条文档时也不会出现负权重
        var idf = Math.log(1 + (idx.N - n + 0.5) / (n + 0.5));
        var denom = f + BM25_K1 * (1 - BM25_B + BM25_B * (d.len / (idx.avgdl || 1)));
        score += idf * (f * (BM25_K1 + 1)) / (denom || 1);
        hits.push(t);
      });
      if (score > 0) out.push({ id: d.id, score: score, by: 'bm25', why: 'terms:' + hits.join('|') });
    });
    out.sort(function (x, y) { return y.score - x.score; });
    return out;
  }

  /* =========================================================
     RRF 融合（Reciprocal Rank Fusion）

     为什么不用加权求和：BM25 分无界、L3 规则分是 10 分制，
     直接相加必须先归一化，而归一化系数会随候选集分布漂移
     （docs/03 §3.3.2）。RRF 只用排名，无此问题。

     ⚠️ RRF 分数只可用于排序，不可做绝对阈值：
        只召回一路时 top1 恒为 1/61，两路都第一恒为 2/61，
        与内容相关度无关（docs/03 §3.5.2）。
     ========================================================= */
  function rrfFuse(lists) {
    var agg = {};
    lists.forEach(function (list) {
      list.forEach(function (item, i) {
        var a = agg[item.id] || (agg[item.id] = { id: item.id, score: 0, by: [], ruleScore: 0, why: '' });
        a.score += 1 / (RRF_K + i + 1);
        if (a.by.indexOf(item.by) === -1) a.by.push(item.by);
        if (item.by === 'l3' && item.score > a.ruleScore) {
          a.ruleScore = item.score;
          a.why = item.why;
        }
      });
    });
    var out = Object.keys(agg).map(function (k) { return agg[k]; });
    out.sort(function (x, y) { return y.score - x.score; });
    out.forEach(function (a) {
      a.by = a.by.join('+');
      a.why = a.why || a.by;
    });
    return out;
  }

  /* =========================================================
     统一入口

     返回结构固定为 { entryId, score, layer, matchedBy, candidates }，
     三个引擎同一形状 —— 这是评测脚本能无差别换引擎的前提。
     ========================================================= */
  function retrieve(entries, text, opts) {
    var list = entries;
    if (!Array.isArray(list)) {
      list = Object.keys(entries || {}).map(function (k) { return entries[k]; });
    }
    var engine = (opts && opts.engine) || RETRIEVAL_ENGINE;
    var t = String(text || '').trim();
    var empty = { entryId: null, score: 0, layer: engine, matchedBy: '', candidates: [] };
    if (!t || !list.length) {
      lg('debug', '检索空输入', { engine: engine, entries: list.length });
      return empty;
    }

    var t0 = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    var candidates;
    if (engine === 'bm25') {
      candidates = rankByBM25(list, t).map(function (c) {
        return { id: c.id, score: c.score, by: 'bm25', why: c.why };
      });
    } else if (engine === 'hybrid') {
      candidates = rrfFuse([rankByRules(list, t), rankByBM25(list, t)]);
    } else {
      candidates = rankByRules(list, t);
    }

    if (!candidates.length) {
      // 未命中不是错误，但必须留痕：这是「为什么给了拒答」的唯一依据
      lg('debug', '检索未命中任何条目', { engine: engine, entries: list.length });
      return empty;
    }
    var top = candidates[0];
    var result = {
      entryId: top.id,
      score: top.score,
      layer: engine,
      matchedBy: top.by || engine,
      why: top.why || '',
      candidates: candidates
    };
    /* 每个模块每次提问强制写 1 行摘要（always）：默认 WARN 级别下
       「各模块都有日志」才不是空话。候选清单属细节，留 debug。 */
    if (LOG && LOG.always) {
      LOG.always('retrieval', '检索完成', {
        engine: engine,
        entryId: result.entryId,
        score: result.score,
        matchedBy: result.matchedBy,
        why: result.why,
        candidateCount: candidates.length,
        top3: candidates.slice(0, 3).map(function (c) {
          return (c.id || c.entryId) + ':' + c.score;
        }),
        ms: t0 ? (Date.now() - t0) : null
      });
    }
    return result;
  }

  function listEngines() {
    return ['l3', 'bm25', 'hybrid'];
  }

  global.RETRIEVAL = {
    // 检索
    retrieve: retrieve,
    engines: listEngines,
    defaultEngine: function () { return RETRIEVAL_ENGINE; },
    // 意图层（危险信号判定，独立于检索引擎）
    detectDanger: detectDanger,
    DANGER_RULES: DANGER_RULES,
    // B 方案加速用的两张表（不参与原有判定）
    detectSevere: detectSevere,
    detectOngoing: detectOngoing,
    isCprOutOfScope: isCprOutOfScope,
    isUnresponsiveWithBreathing: isUnresponsiveWithBreathing,
    isMinorBleeding: isMinorBleeding,
    PEDIATRIC_WORDS: PEDIATRIC_WORDS,
    DROWNING_WORDS: DROWNING_WORDS,
    isHypothetical: isHypothetical,
    isResolved: isResolved,
    isDeniedFire: isDeniedFire,
    turnPolicy: turnPolicy,
    seedDecision: seedDecision,
    SEVERE_WORDS: SEVERE_WORDS,
    ONGOING_WORDS: ONGOING_WORDS,
    // 单引擎直调（评测与调试用）
    rankByRules: rankByRules,
    rankByBM25: rankByBM25,
    rrfFuse: rrfFuse,
    // 暴露内部件供自测
    _internals: {
      norm: norm,
      hitNoNegation: hitNoNegation,
      scoreEntryByRules: scoreEntryByRules,
      tokenize: tokenize,
      searchableText: searchableText,
      buildIndex: buildIndex,
      constants: { BM25_K1: BM25_K1, BM25_B: BM25_B, RRF_K: RRF_K, NEG_PREFIX: NEG_PREFIX }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
