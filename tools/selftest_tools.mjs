/* =========================================================
   工具注册表 + 自主循环：离线断言
   为什么单独一个脚本：
     selftest_m1.mjs 已有 642 条断言、1500+ 行，再塞进去难以定位。
     本文件只测「决策链」，不测渲染 —— 渲染归 selftest 与 e2e。

   全部断言不依赖网络：
     decide / exec 都注入桩，循环本身是纯函数式决策。

   判据编号对应 docs/03 §2.5.11：
     C1 伪造 history 为空 + get_steps   → 必须被拒
     C2 lookup=false 后紧接 get_steps   → 必须被拒
     C3 同参重复调用                    → 不进入第 4 次
     C7 dial 非白名单号码               → 被拒并回落 120
     C9 紧急命中                        → 零 LLM 往返
     C10 离线                           → 走规则计划
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(msg);
  }
}

/* ---------- 最小 DOM stub（本脚本不需要渲染，只为让 app 模块能加载） ---------- */
const store = new Map();
function makeEl(id) {
  const cls = new Set();
  const e = {
    id,
    innerHTML: '',
    hidden: false,
    value: '',
    textContent: '',
    className: '',
    handlers: {},
    children: [],
    parentNode: null,
    _classes: cls,
    classList: {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      contains: (c) => cls.has(c),
      toggle: (c, on) => {
        if (on === undefined) cls.has(c) ? cls.delete(c) : cls.add(c);
        else if (on) cls.add(c);
        else cls.delete(c);
      },
    },
    addEventListener(t, f) {
      (this.handlers[t] ||= []).push(f);
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    scrollIntoView() {},
    getAttribute: () => null,
    setAttribute(k, v) {
      this._attrs = this._attrs || {};
      this._attrs[k] = v;
      if (k === 'id') {
        store.set(String(v), this);
        this.id = String(v);
      }
    },
    removeAttribute(k) {
      if (k === 'id') {
        for (const [key, val] of store.entries()) if (val === this) store.delete(key);
        this.id = '';
      }
    },
    closest: () => null,
    appendChild(c) {
      this.children.push(c);
      c.parentNode = this;
      return c;
    },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
      return c;
    },
    insertBefore(c) {
      this.children.unshift(c);
      c.parentNode = this;
      return c;
    },
  };
  return e;
}
const document = {
  getElementById(id) {
    if (!store.has(id)) store.set(id, makeEl(id));
    return store.get(id);
  },
  createElement(tag) {
    const n = makeEl('#' + tag);
    n.tagName = String(tag).toUpperCase();
    return n;
  },
  querySelectorAll: () => [],
  addEventListener() {},
  body: makeEl('body'),
};
const window = { document, scrollTo() {}, addEventListener() {}, removeEventListener() {} };
const sandbox = {
  window,
  document,
  console,
  Math,
  String,
  Number,
  Object,
  Array,
  JSON,
  Promise,
  Error,
  Date,
  RegExp,
  Set,
  Map,
  navigator: { onLine: true },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of [
  'log.js',
  'knowledge.js',
  'retrieval.js',
  'state.js',
  'chat.js',
  'tools.js',
  'agent.js',
]) {
  const p = path.join(APP, f);
  if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox);
}

const T = sandbox.window.TOOLS;
const A = sandbox.window.AGENT;
const KB = sandbox.window.KNOWLEDGE;

console.log('=== 0. 模块加载 ===');
ok(!!T, 'tools.js 应导出 window.TOOLS');
ok(!!A, 'agent.js 应导出 window.AGENT');
ok(!!KB && Object.keys(KB.entries).length > 0, '知识库应有条目');

if (T && A) {
  const ENTRIES = KB.entries;
  const SCENE_IDS = KB.slots.map((s) => s.id);

  /* ---------- 1. 工具表结构 ---------- */
  console.log('\n=== 1. 工具表（9 个，含 2 个探查类） ===');
  ok(T.REGISTRY.length === 9, `应有 9 个工具，实际 ${T.REGISTRY.length}`);
  const names = T.REGISTRY.map((t) => t.name).sort();
  const expect = [
    'ack',
    'ask',
    'dial',
    'get_daily',
    'get_steps',
    'lookup_scene',
    'refuse',
    'speak',
    'triage',
  ].sort();
  ok(JSON.stringify(names) === JSON.stringify(expect), `工具清单不符：${names.join(',')}`);
  ok(
    T.REGISTRY.filter((t) => t.needsModel)
      .map((t) => t.name)
      .sort()
      .join(',') === 'ask,lookup_scene',
    '只有 lookup_scene 与 ask 应标记 needsModel（其余 6 个本地执行，这是保住 3 秒的前提）'
  );

  /* ---------- 2. C1：伪造 history 为空 + get_steps ---------- */
  console.log('\n=== 2. C1 跳步拦截（history 为空） ===');
  {
    const g = T.checkGate(
      'get_steps',
      { scene: 'fire_home' },
      {
        entries: ENTRIES,
        sceneIds: SCENE_IDS,
        history: [],
      }
    );
    ok(
      !g.ok && g.reason === 'no-lookup',
      `C1 应被拒且 reason=no-lookup，实际 ${JSON.stringify(g)}`
    );
  }

  /* ---------- 3. C2：lookup 返回 found=false 后紧接 get_steps ---------- */
  console.log('\n=== 3. C2 观察误读拦截 ===');
  {
    const g = T.checkGate(
      'get_steps',
      { scene: 'fire_home' },
      {
        entries: ENTRIES,
        sceneIds: SCENE_IDS,
        history: [
          {
            act: 'lookup_scene',
            args: { scene: 'fire_home' },
            result: { found: false, published: false },
          },
        ],
      }
    );
    ok(!g.ok && g.reason === 'no-lookup', `C2 应被拒（found=false 不算查过），实际 ${g.reason}`);
  }

  /* ---------- 4. 正常路径：lookup 成功后 get_steps 放行 ---------- */
  console.log('\n=== 4. 正常路径放行 ===');
  {
    const g = T.checkGate(
      'get_steps',
      { scene: 'fire_home' },
      {
        entries: ENTRIES,
        sceneIds: SCENE_IDS,
        history: [
          {
            act: 'lookup_scene',
            args: { scene: 'fire_home' },
            result: { found: true, published: true },
          },
        ],
      }
    );
    ok(g.ok, `lookup 成功后 get_steps 应放行，实际 ${g.reason}`);
  }

  /* ---------- 5. 场景白名单 ---------- */
  console.log('\n=== 5. 场景越界 ===');
  {
    /* ⚠️ 2026-11-19 判据修正：白名单只管「会产出内容」的工具。
       lookup_scene 是只读探查，查不存在的场景只会返回 found=false，
       放行才是对的（挡它会连「查一下发现没条目→给拨号卡」这条路一起堵死，
       实测后果：溺水问题从拨号卡退化成拒答卡，用户反而没有号码可打）。 */
    const gLook = T.checkGate(
      'lookup_scene',
      { scene: 'no_such_scene' },
      {
        entries: ENTRIES,
        sceneIds: SCENE_IDS,
        history: [],
      }
    );
    ok(gLook.ok, 'lookup_scene 允许任意场景（只读探查，越界无害）');

    const gSteps = T.checkGate(
      'get_steps',
      { scene: 'no_such_scene' },
      {
        entries: ENTRIES,
        sceneIds: SCENE_IDS,
        history: [
          {
            act: 'lookup_scene',
            args: { scene: 'no_such_scene' },
            result: { found: true, published: true },
          },
        ],
      }
    );
    ok(
      !gSteps.ok && gSteps.reason === 'scene-not-in-registry',
      `出内容的工具越界必须被拒，实际 ${gSteps.reason}`
    );
  }

  /* ---------- 6. C7：dial 白名单 ---------- */
  console.log('\n=== 6. C7 号码白名单 ===');
  {
    const bad = T.checkGate(
      'dial',
      { number: '110' },
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] }
    );
    ok(
      !bad.ok && bad.reason === 'number-not-allowed',
      `110 不在白名单应被拒，实际 ${JSON.stringify(bad)}`
    );
    ok(bad.fallback === '120', '被拒后应给出回落号码 120');
    const good = T.checkGate(
      'dial',
      { number: '119' },
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] }
    );
    ok(good.ok, '119 在白名单应放行');
  }

  /* ---------- 7. 安全出口不设门槛 ---------- */
  console.log('\n=== 7. 安全出口无条件放行 ===');
  {
    const r = T.checkGate(
      'refuse',
      { reason: 'test' },
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] }
    );
    ok(r.ok, 'refuse 不应设前置条件（加了会逼模型乱猜）');
    const d = T.checkGate(
      'dial',
      { number: '120' },
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] }
    );
    ok(d.ok, 'dial 用白名单内号码不应设前置条件');
  }

  /* ---------- 8. speak 只吃字段 ---------- */
  console.log('\n=== 8. speak 不许吃自由文本 ===');
  {
    const g = T.checkGate(
      'speak',
      { entry_id: 'fire_home', segment: '让用户随便说一句话' },
      {
        entries: ENTRIES,
        sceneIds: SCENE_IDS,
        history: [],
      }
    );
    ok(!g.ok && g.reason === 'segment-not-allowed', `非枚举段落应被拒，实际 ${g.reason}`);
    const g2 = T.checkGate(
      'speak',
      { entry_id: 'fire_home', segment: 'immediate' },
      {
        entries: ENTRIES,
        sceneIds: SCENE_IDS,
        history: [],
      }
    );
    ok(g2.ok, 'segment=immediate 应放行');
  }

  /* ---------- 8b. ask 必须恰好两个非空选项 ---------- */
  /* 2026-11-19 新增。此前只有 renderAsk 里的 `options.slice(0, 2)`，
     模型给 3 个时静默丢一个、给 1 个时变成单选按钮 ——
     用户看到的是一张「看起来正常」的追问卡，与 §5.4「不许静默降级」同源。
     现在放行前查清，不合法就拒，让模型重给。 */
  console.log('\n=== 8b. ask 必须恰好两个非空选项 ===');
  {
    const ctx = { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] };

    const g1 = T.checkGate('ask', { scene: 'gas_leak', options: ['一个', '两个'] }, ctx);
    ok(g1.ok, `两个有效选项应放行，实际 ${g1.reason}`);

    const g2 = T.checkGate('ask', { scene: 'gas_leak', options: ['只有一个'] }, ctx);
    ok(!g2.ok && g2.reason === 'ask-needs-two-options', `单个选项应被拒，实际 ${g2.reason}`);

    const g3 = T.checkGate('ask', { scene: 'gas_leak', options: ['a', 'b', 'c'] }, ctx);
    ok(
      !g3.ok && g3.reason === 'ask-needs-two-options',
      `三个选项应被拒（不许静默丢一个），实际 ${g3.reason}`
    );

    const g4 = T.checkGate('ask', { scene: 'gas_leak', options: ['好的', '   '] }, ctx);
    ok(!g4.ok && g4.reason === 'ask-empty-option', `空白选项应被拒，实际 ${g4.reason}`);

    const g5 = T.checkGate('ask', { scene: 'gas_leak', options: null }, ctx);
    ok(!g5.ok, 'options 缺失应被拒（此前会渲染成零按钮卡）');

    const g6 = T.checkGate(
      'ask',
      { scene: 'gas_leak', options: [{ label: '闻到味' }, { label: '没味' }] },
      ctx
    );
    ok(g6.ok, '对象形式 {label} 应放行（模型两种写法都要接）');
  }

  /* ---------- 9. C9：紧急命中零 LLM 往返 ---------- */
  /* C9 的判据在 2026-11-19 改过一次，原因写在这里（不是为了让测试变绿）：
     旧判据「紧急命中不得调模型」是建立在「detectDanger 无条件优先」这个
     已被证伪的设计上的。实测证明那个设计会让「怎么预防煤气泄漏」变成急救步骤卡。
     现在的设计与安全要求是：
       · 在线（有 decide）→ 模型优先，**允许**调模型，但最终必须出 steps
       · 离线 / 无 decide  → **一次都不许调模型**，直接走规则
     所以拆成两条独立断言，各自都能失败。 */
  console.log('\n=== 9a. C9 在线紧急：模型优先且必须收敛到 steps ===');
  await (async () => {
    let decideCalls = 0;
    const out = await A.run(
      '煤气漏了',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      {
        decide(t, ctx) {
          decideCalls++;
          // 模拟模型：第一次 lookup，之后 get_steps
          if (!ctx.history.some((h) => h.act === 'lookup_scene')) {
            return { act: 'lookup_scene', args: { scene: 'gas_leak' } };
          }
          return { act: 'get_steps', args: { scene: 'gas_leak' } };
        },
        exec() {},
      }
    );
    ok(decideCalls >= 1, '在线路径应调用模型（模型优先是新设计）');
    ok(out.endKind === 'steps', `在线紧急必须收敛到 steps，实际 ${out.endKind}`);
    ok(
      out.history.some((h) => h.act === 'get_steps'),
      '应执行过 get_steps'
    );
  })();

  console.log('\n=== 9b. C9 离线紧急：一次都不许调模型 ===');
  await (async () => {
    sandbox.navigator.onLine = false;
    let decideCalls = 0;
    const out = await A.run(
      '煤气漏了',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      {
        decide() {
          decideCalls++;
          return { act: 'refuse', args: { reason: 'should-not-be-called' } };
        },
        exec() {},
      }
    );
    ok(decideCalls === 0, `离线时不得调用模型，实际 ${decideCalls} 次`);
    ok(out.endKind === 'steps', `离线紧急应走规则出步骤卡，实际 ${out.endKind}`);
    sandbox.navigator.onLine = true;
  })();

  /* ---------- 10. C10：离线走规则计划 ---------- */
  console.log('\n=== 10. C10 离线模式 ===');
  await (async () => {
    sandbox.navigator.onLine = false;
    let decideCalls = 0;
    const out = await A.run(
      '今天天气怎么样',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      {
        decide() {
          decideCalls++;
          return { act: 'get_steps', args: { scene: 'fire_home' } };
        },
        exec() {},
      }
    );
    ok(decideCalls === 0, `离线时不得调用模型，实际 ${decideCalls} 次`);
    ok(out.degraded === true, '离线应标记 degraded=true（不许静默降级）');
    ok(out.endKind === 'refuse', `离线库外问题应收敛到 refuse，实际 ${out.endKind}`);
    sandbox.navigator.onLine = true;
  })();

  console.log('\n=== 11. 模型给非法动作时的降级 ===');
  await (async () => {
    const out = await A.run(
      '煤气漏了',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      { decide: () => ({ act: 'hack_the_planet', args: {} }), exec() {} }
    );
    ok(out.endKind !== null, '非法动作不得让循环无终态');
    ok(
      out.endKind === 'steps' || out.endKind === 'refuse',
      `非法动作应收敛到安全终态，实际 ${out.endKind}`
    );
  })();

  /* ---------- 12. C3：步数上限 ---------- */
  console.log('\n=== 12. C3 步数上限 ===');
  await (async () => {
    let n = 0;
    const out = await A.run(
      '测试',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      {
        maxSteps: 3,
        decide() {
          n++;
          // 一直返回非终态工具（lookup），模拟「模型不 finish」
          return { act: 'lookup_scene', args: { scene: 'fire_home' } };
        },
        exec() {},
      }
    );
    ok(out.steps.length <= 3 + 1, `步数不得显著超过上限 3，实际 ${out.steps.length}`);
    ok(out.degraded === true, '超步数应标记 degraded');
    ok(out.endKind === 'refuse', `超步数应收敛到安全出口，实际 ${out.endKind}`);
  })();

  /* ---------- 13. 非法工具名直接拒绝 ---------- */
  console.log('\n=== 13. 未知工具名 ===');
  {
    const g = T.checkGate(
      'delete_all_files',
      {},
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] }
    );
    ok(!g.ok && g.reason === 'unknown-tool', `未知工具应被拒，实际 ${g.reason}`);
  }

  /* ---------- 14. triage 只能对含分诊的条目 ---------- */
  console.log('\n=== 14. triage 前置条件 ===');
  {
    /* 2026-11-21 改：fire_home 现已加分诊（门外/楼道着火分支），不能再当「无分诊」样例。
       换用 scald_burn —— triage 仍为 null。断言语义不变：无分诊场景必须拒 triage。 */
    const withTriage = ENTRIES.gas_leak;
    const without = ENTRIES.scald_burn;
    ok(!!withTriage && !!withTriage.triage, 'gas_leak 应有分诊（用于本组断言）');
    ok(!!without && !without.triage, 'scald_burn 应无分诊（用于本组断言）');
    const h = [
      {
        act: 'lookup_scene',
        args: { scene: 'gas_leak' },
        result: { found: true, published: true },
      },
    ];
    const g1 = T.checkGate(
      'triage',
      { scene: 'gas_leak' },
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: h }
    );
    ok(g1.ok, 'gas_leak 有分诊应放行 triage');
    const h2 = [
      {
        act: 'lookup_scene',
        args: { scene: 'scald_burn' },
        result: { found: true, published: true },
      },
    ];
    const g2 = T.checkGate(
      'triage',
      { scene: 'scald_burn' },
      {
        entries: ENTRIES,
        sceneIds: SCENE_IDS,
        history: h2,
      }
    );
    ok(!g2.ok && g2.reason === 'no-triage', `scald_burn 无分诊应被拒，实际 ${g2.reason}`);
  }

  /* ---------- 15. 网络状态判断 ---------- */
  console.log('\n=== 15. 网络状态 ===');
  {
    sandbox.navigator.onLine = false;
    ok(A.netState() === 'offline', 'onLine=false 应判为 offline');
    sandbox.navigator.onLine = true;
    ok(A.netState() === 'online', 'onLine=true 应判为 online');
    const saved = sandbox.navigator;
    sandbox.navigator = {};
    ok(A.netState() === 'unknown', '无 navigator.onLine 时应在 unknown（不误判为离线）');
    sandbox.navigator = saved;
  }

  /* ---------- 16. ★ 回归：LLM 结论不得被关键词兜底覆盖（C11） ----------
     这是 2026-11-19 真实踩过的 bug：AGENT 里让 detectDanger 无条件优先，
     结果「怎么预防煤气泄漏」因含「煤气」被判紧急，把 LLM 判对的 prevention
     盖成了 steps 卡 —— 与 llm.js 2026-11-18 修的是同一个 bug 的变体。
     之后凡是改「紧急优先级」的代码，这组断言必须先红过。 */
  console.log('\n=== 16. C11 模型结论优先于关键词兜底 ===');
  await (async () => {
    let rendered = [];
    const out = await A.run(
      '怎么预防煤气泄漏', // 含「煤气」，detectDanger 会命中
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      {
        // 模拟 LLM 已判定为 prevention → 日常解释
        plan: [
          { act: 'lookup_scene', args: { scene: 'gas_leak' }, why: 'llm-lookup' },
          { act: 'get_daily', args: { scene: 'gas_leak' }, why: 'llm-prevention' },
        ],
        exec(rec, res) {
          rendered.push(res.kind);
        },
      }
    );
    ok(
      out.endKind === 'daily',
      `含场景词的预防咨询，有模型结论时应走 daily，实际 ${out.endKind}（被关键词兜底覆盖了）`
    );
    ok(!rendered.includes('steps'), '不得渲染步骤卡（这正是 S1 要禁止的错答）');

    // 反证方向：没有模型结论时才允许关键词优先
    const out2 = await A.run(
      '煤气漏了',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      { exec() {} }
    );
    ok(out2.endKind === 'steps', `无模型结论时，紧急命中应走 steps，实际 ${out2.endKind}`);
  })();

  /* ---------- 17. 加锁：出内容的工具必须经过 lookup ---------- */
  console.log('\n=== 17. 计划里缺 lookup 时必须被拦 ===');
  await (async () => {
    const out = await A.run(
      '着火了',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      {
        // 故意给一个跳过 lookup 的计划
        plan: [{ act: 'get_steps', args: { scene: 'fire_home' }, why: 'skip-lookup' }],
        exec() {},
      }
    );
    ok(
      out.steps.some((s) => s.ok === false && s.reason === 'no-lookup'),
      `跳过 lookup 的 get_steps 应被前置条件门拒绝，实际 ${JSON.stringify(out.steps)}`
    );
    /* 2026-11-21：no-lookup 不是「想编内容」，而是「模型跳过了查库」。
       场景合法且条目在库时，补一次 lookup 再执行原动作；仍必须留痕。 */
    ok(
      out.steps.some((s) => s.act === 'lookup_scene' && s.why === 'auto-lookup'),
      `no-lookup 后应自动补查，实际 ${JSON.stringify(out.steps)}`
    );
    ok(out.endKind === 'steps', `补查后应给出 steps，实际 ${out.endKind}`);
  })();
  /* ---------- 18. 同参重复：复用一次，第二次才收尾（§2.5.7 + P32） ----------
     2026-11-19 新增，2026-11-20 按 P32 修正。
     旧行为「同参即收尾」会把「主体变更后的合理重查」误杀（MT08）：
     模型想把 fall_elderly 重新确认给「孩子坠床」，被拦成拒答。
     新行为：第一次重复复用上次结果继续；第二次仍收尾，防死循环。 */
  console.log('\n=== 18. 同参重复 lookup：复用一次，第二次收尾 ===');
  await (async () => {
    let calls = 0;
    const out = await A.run(
      '孩子从床上掉下来了',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      {
        // 永远只给同一个 lookup —— 模拟真正的绕圈行为
        decide() {
          calls++;
          return { act: 'lookup_scene', args: { scene: 'fall_elderly' } };
        },
        exec() {},
      }
    );

    ok(calls <= 3, `同参重复 lookup 不应超过 3 次（首次 + 一次复用 + 一次收尾），实际 ${calls} 次`);
    ok(out.reason === 'repeat-call', `第二次重复后应收尾，实际 ${out.reason}`);
    ok(out.endKind === 'refuse', `绕圈后应收敛到安全出口，实际 ${out.endKind}`);
    ok(
      out.steps.filter((s) => s.act === 'lookup_scene').length === 2,
      `应执行 2 次 lookup（首次 + 复用一次），实际 ${out.steps.filter((s) => s.act === 'lookup_scene').length} 次`
    );
  })();

  /* 18c. 主体变更后的合理重查：重查一次后能继续出步骤，不得拒答（P32） */
  console.log('\n=== 18c. 主体变更后的重查应继续，不得拒答 ===');
  await (async () => {
    const seq = [
      { act: 'lookup_scene', args: { scene: 'fall_elderly' } },
      { act: 'lookup_scene', args: { scene: 'fall_elderly' } },
      { act: 'get_steps', args: { scene: 'fall_elderly' } },
    ];
    let i = 0;
    const out = await A.run(
      '不是他，是孩子从床上掉下来了',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      { decide: () => seq[Math.min(i++, seq.length - 1)], exec() {} }
    );
    ok(out.reason !== 'repeat-call', `合理重查不应触发防绕圈，实际 ${out.reason}`);
    ok(out.endKind === 'steps', `重查后应能出步骤卡，实际 ${out.endKind}`);
  })();

  /* 对照组：换场景查不算绕圈（否则「逐条排查」会被误杀） */
  console.log('\n=== 18b. 对照：查不同场景不算绕圈 ===');
  await (async () => {
    const seq = [
      { act: 'lookup_scene', args: { scene: 'gas_leak' } },
      { act: 'lookup_scene', args: { scene: 'co_poisoning' } },
      { act: 'get_steps', args: { scene: 'co_poisoning' } },
    ];
    let i = 0;
    const out = await A.run(
      '屋里有味道头晕',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      { decide: () => seq[Math.min(i++, seq.length - 1)], exec() {} }
    );
    ok(
      out.reason !== 'repeat-call',
      `查不同场景不应触发防绕圈（否则正常排查被误杀），实际 ${out.reason}`
    );
    ok(out.endKind === 'steps', `应正常出步骤卡，实际 ${out.endKind}`);
  })();

  /* ---------- 19. ask 的 endKind 必须如实是 'ask' ----------
     2026-11-19 新增。此前 ask 分支只 return summary('waiting-user')，
     **没有设 end** → summary 里 endKind=null、ok=false。
     功能没坏（app.js 靠 host 判断有没产出），但**观测失明**：
     probe_multi_turn 把 MT02「厨房有股味道…头晕」记成 unknown，
     看起来像「模型给不出动作」，实际是它正确追问了。
     这类「功能正常但数字显示不对」的缺陷会把排查方向带偏一整天。 */
  console.log('\n=== 19. ask 的 endKind 必须如实 ===');
  await (async () => {
    let calls = 0;
    const out = await A.run(
      '屋里有股味道不知道是不是漏气',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      {
        decide(t, ctx) {
          calls++;
          if (calls === 1) return { act: 'lookup_scene', args: { scene: 'gas_leak' } };
          return { act: 'ask', args: { scene: 'gas_leak', options: ['闻到味', '没闻到'] } };
        },
        exec() {},
      }
    );
    ok(out.endKind === 'ask', `endKind 应为 'ask'，实际 ${JSON.stringify(out.endKind)}`);
    ok(out.ok === true, 'ask 有产出，ok 应为 true（用户确实看到了追问卡）');
    ok(out.reason === 'waiting-user', `reason 应为 waiting-user，实际 ${out.reason}`);
  })();

  /* ---------- 20. ack：已脱困/状态更新（MT10，2026-11-20） ----------
     背景：用户说「现在电梯门开了」，产品仍出急救步骤卡。
     修法：新增终态工具 ack，只渲染「已经安全了」+ 观察提示，不出步骤。
     判据：工具表认识它、门放行、执行是终态、循环能收敛到 ack。 */
  console.log('\n=== 20. ack：已脱困/状态更新 ===');
  await (async () => {
    ok(!!T.byName('ack'), '工具表应认识 ack');
    ok(T.KNOWN_NAMES.indexOf('ack') >= 0, 'KNOWN_NAMES 应包含 ack');
    const g = T.checkGate('ack', {}, { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] });
    ok(g.ok, `ack 不应有前置条件，实际 ${g.reason}`);
    const r = T.execute('ack', {}, { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] });
    ok(r.ok === true, 'ack 执行应成功');
    ok(r.kind === 'ack', `ack 的 kind 应为 ack，实际 ${r.kind}`);
    ok(r.ends === true, 'ack 必须是终态');

    const out = await A.run(
      '现在电梯门开了',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      { decide: () => ({ act: 'ack', args: {} }), exec() {} }
    );
    ok(out.endKind === 'ack', `循环应收敛到 ack，实际 ${out.endKind}`);
    ok(out.ok === true, 'ack 有产出，ok 应为 true');
  })();

  /* ---------- 21. P24：断网危重状态必须先查危重条目，不得走 fall_elderly 分诊 ----------
     背景：「我妈摔倒了没有呼吸」含「摔倒」，detectDanger 会命中 fall_elderly，
     而 fall_elderly 首屏问「能自己动动胳膊腿吗」—— 对无呼吸者致命。
     修法：planRule 先查 detectSevere，命中即查 cpr / severe_bleeding。

     2026-11-21 更新（docs/14 §4.2「发布前后两套期望」）：
       cpr 与 severe_bleeding 已发布，期望由「dial 120」改为「给对应条目的 steps」。
       断言同时收紧——不只断言给了 steps，还要断言查的是**哪个**场景，
       因为「给了 steps 但查错场景」正是本条要防的错误。 */
  console.log('\n=== 21. P24：断网危重 → 危重条目，不得 fall_elderly ===');
  await (async () => {
    const saved = sandbox.navigator.onLine;
    sandbox.navigator.onLine = false;
    try {
      const severeCases = [
        { text: '我妈摔倒了没有呼吸', scene: 'cpr' },
        { text: '心跳停了', scene: 'cpr' },
        { text: '大出血止不住', scene: 'severe_bleeding' },
      ];
      for (const { text, scene } of severeCases) {
        const out = await A.run(
          text,
          { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
          { exec() {} }
        );
        ok(
          out.endKind === 'steps' || out.endKind === 'dial',
          `断网「${text}」应给步骤或拨号，实际 ${out.endKind}`
        );
        /* 硬约束：绝不查 fall_elderly —— 对无呼吸者问「能自己动动胳膊腿吗」是致命误导 */
        ok(
          !out.steps.some(
            (s) => s.act === 'lookup_scene' && s.args && s.args.scene === 'fall_elderly'
          ),
          `断网「${text}」不得查 fall_elderly`
        );
        /* 条目已发布时，必须查对应危重场景；未发布才允许 dial */
        const looked = out.steps
          .filter((s) => s.act === 'lookup_scene')
          .map((s) => s.args && s.args.scene);
        if (out.endKind === 'steps') {
          ok(looked.includes(scene), `断网「${text}」应查 ${scene}，实际查了 ${looked.join(',')}`);
        } else {
          ok(
            out.steps.some((s) => s.act === 'dial' && s.args && s.args.number === '120'),
            `断网「${text}」拨号时必须给 120`
          );
        }
      }

      const normal = await A.run(
        '我摔倒了但能说话',
        { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
        { exec() {} }
      );
      ok(
        normal.endKind === 'steps' || normal.endKind === 'triage',
        `非危重应走分诊/步骤，实际 ${normal.endKind}`
      );
      ok(normal.endKind !== 'dial', '非危重不得被 P24 误拨号');
    } finally {
      sandbox.navigator.onLine = saved;
    }
  })();

  /* ---------- 21-b. CPR 范围外：儿科 dial；溺水走 drowning（2026-11-21 更新） ----------
     2026-11-21 早：drowning 未发布，「溺水没呼吸」回 dial 是安全兜底。
     2026-11-21 晚：drowning 条目发布，成人/未标年龄的溺水改走 drowning；
     儿科仍 dial（本库没有儿科 CPR 参数）。两者都不得复用成人 cpr。 */
  console.log('\n=== 21-b. 儿科 CPR → dial；溺水 → drowning；都不得复用成人 cpr ===');
  await (async () => {
    const saved = sandbox.navigator.onLine;
    for (const online of [false, true]) {
      sandbox.navigator.onLine = online;
      try {
        const tag = online ? '在线' : '断网';
        /* 儿科：仍必须 dial 120 */
        for (const text of ['婴儿没呼吸', '宝宝心跳停了', '幼儿没呼吸']) {
          const out = await A.run(
            text,
            { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
            { exec() {} }
          );
          const looked = out.steps
            .filter((s) => s.act === 'lookup_scene')
            .map((s) => s.args && s.args.scene);
          ok(!looked.includes('cpr'), `${tag}「${text}」不得查成人 cpr`);
          ok(!looked.includes('drowning'), `${tag}「${text}」不得查 drowning（儿科未覆盖）`);
          ok(
            out.steps.some((s) => s.act === 'dial' && s.args && s.args.number === '120'),
            `${tag}「${text}」应给 dial 120`
          );
        }
        /* 溺水：不得查 cpr，必须查 drowning */
        for (const text of ['溺水没呼吸', '我爸溺水了']) {
          const out = await A.run(
            text,
            { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
            { exec() {} }
          );
          const looked = out.steps
            .filter((s) => s.act === 'lookup_scene')
            .map((s) => s.args && s.args.scene);
          ok(!looked.includes('cpr'), `${tag}「${text}」不得查成人 cpr`);
          ok(looked.includes('drowning'), `${tag}「${text}」应查 drowning，实际 ${looked.join(',') || '(无)'}`);
        }

        /* 反向：排除不得误伤。成人仍给 cpr，儿童大出血仍给 severe_bleeding
           —— 止血手法对儿童通用，只有 CPR 的参数不同。 */
        const adult = await A.run(
          '老人没有呼吸',
          { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
          { exec() {} }
        );
        ok(
          adult.steps.some(
            (s) => s.act === 'lookup_scene' && s.args && s.args.scene === 'cpr'
          ),
          `${tag}「老人没有呼吸」是成人，应给 cpr，实际 ${adult.endKind}`
        );
        const childBleed = await A.run(
          '孩子大出血',
          { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
          { exec() {} }
        );
        ok(
          childBleed.steps.some(
            (s) => s.act === 'lookup_scene' && s.args && s.args.scene === 'severe_bleeding'
          ),
          `${tag}「孩子大出血」应给 severe_bleeding（排除只针对 CPR），实际 ${childBleed.endKind}`
        );
      } finally {
        sandbox.navigator.onLine = saved;
      }
    }
  })();

  /* ---------- 22. 假设句是预案，不进入紧急 ----------
     背景：「如果发生火灾怎么办」含「火灾」，旧逻辑命中 danger → get_steps →
     前端 enterEmergency；用户只是问预案。
     修法：planRule 先认「如果/万一/假如/要是」，绕开 severe/danger，走 get_daily。 */
  console.log('\n=== 22. 假设句不进入紧急（预案 → daily） ===');
  await (async () => {
    const cases = [
      '如果发生火灾怎么办',
      '如果煤气漏了怎么办',
      '万一老人摔倒了怎么办',
      '怎么预防煤气泄漏',
    ];
    for (const text of cases) {
      const out = await A.run(
        text,
        { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
        { exec() {} }
      );
      ok(out.endKind === 'daily', `假设句「${text}」应走 daily，实际 ${out.endKind}`);
      ok(
        !out.steps.some((s) => s.act === 'get_steps' || s.act === 'triage' || s.act === 'dial'),
        `假设句「${text}」不得出 steps/triage/dial`
      );
    }
  })();

  /* ---------- 23. turn 契约：模型的 plan 标签必须能压住 steps ----------
     2026-11-21 新契约：/act 输出 turn/evidence。即使本地 turnPolicy 判 unknown，
     模型给出 turn=plan 时，调度器也必须把 get_steps/triage/dial 降级为 get_daily。
     这是“靠语义标签”而不是“靠 prompt 案例”的第一条硬断言。 */
  console.log('\n=== 23. 模型 turn=plan 必须压住 steps ===');
  await (async () => {
    const planSeq = [
      { act: 'lookup_scene', args: { scene: 'scald_burn' }, turn: 'plan', evidence: '周围没有冷水' },
      { act: 'get_steps', args: { scene: 'scald_burn' }, turn: 'plan', evidence: '周围没有冷水' },
    ];
    let i = 0;
    const out = await A.run(
      '周围没有冷水',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      { decide: () => planSeq[Math.min(i++, planSeq.length - 1)], exec() {} }
    );
    ok(out.endKind === 'daily', `turn=plan 应降级为 daily，实际 ${out.endKind}`);
    ok(
      !out.steps.some((s) => s.act === 'get_steps' || s.act === 'triage' || s.act === 'dial'),
      'turn=plan 不得出 steps/triage/dial'
    );

    const ongoingSeq = [
      { act: 'lookup_scene', args: { scene: 'scald_burn' }, turn: 'ongoing', evidence: '正在烫伤' },
      { act: 'get_steps', args: { scene: 'scald_burn' }, turn: 'ongoing', evidence: '正在烫伤' },
    ];
    let j = 0;
    const out2 = await A.run(
      '正在烫伤',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      { decide: () => ongoingSeq[Math.min(j++, ongoingSeq.length - 1)], exec() {} }
    );
    ok(out2.endKind === 'steps', `turn=ongoing 应允许 steps，实际 ${out2.endKind}`);
  })();

  /* ---------- 24. 明确否认火灾：即使“冒点烟”，也不得给 fire_home 内容 ----------
     R30：「不是着火，是我把锅烧糊了，就是冒点烟，没见明火」。
     旧行为：detectDanger 命中 fire_home → get_steps，答非所问。
     修法：isDeniedFire 明确否认闸；离线 planRule 与调度器都拦。 */
  console.log('\n=== 24. 明确否认火灾 → refuse ===');
  await (async () => {
    const text = '不是着火，是我把锅烧糊了，就是冒点烟，没见明火';
    const RET = sandbox.window.RETRIEVAL;
    ok(RET.isDeniedFire(text) === true, '「不是着火」应判为明确否认');

    const offline = await A.run(
      text,
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      { exec() {} }
    );
    ok(offline.endKind === 'refuse', `离线应 refuse，实际 ${offline.endKind}`);
    ok(!offline.steps.some((s) => s.act === 'get_steps'), '离线不得给 fire_home 步骤');

    const seq = [
      { act: 'lookup_scene', args: { scene: 'fire_home' }, turn: 'ongoing', evidence: text },
      { act: 'get_steps', args: { scene: 'fire_home' }, turn: 'ongoing', evidence: text },
    ];
    let i = 0;
    const policy = RET.turnPolicy(text);
    const out = await A.run(
      text,
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [], policy },
      { decide: () => seq[Math.min(i++, seq.length - 1)], exec() {} }
    );
    ok(policy.denyDanger === true, 'turnPolicy 应带 denyDanger=true');
    ok(out.endKind === 'refuse', `模型路径应 refuse，实际 ${out.endKind}`);
    ok(!out.steps.some((s) => s.act === 'get_steps'), '模型路径不得给 fire_home 步骤');

    const real = await A.run(
      '着火了',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      { exec() {} }
    );
    ok(real.endKind === 'steps', `对照「着火了」仍应 steps，实际 ${real.endKind}`);
  })();
}

/* ---------- 汇总 ---------- */
console.log('');
if (failures.length) {
  console.log('──────── 失败明细 ────────');
  failures.forEach((f) => console.log('  ✗ ' + f));
}
console.log(`断言 ${pass + fail} 条：通过 ${pass}，失败 ${fail}`);
if (fail === 0) console.log('PASS: 工具表与调度器全部通过');
else process.exitCode = 1;
