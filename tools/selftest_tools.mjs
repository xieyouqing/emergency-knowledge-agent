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
  console.log('\n=== 1. 工具表（8 个，含 2 个探查类） ===');
  ok(T.REGISTRY.length === 8, `应有 8 个工具，实际 ${T.REGISTRY.length}`);
  const names = T.REGISTRY.map((t) => t.name).sort();
  const expect = [
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
    const withTriage = ENTRIES.gas_leak;
    const without = ENTRIES.fire_home;
    ok(!!withTriage && !!withTriage.triage, 'gas_leak 应有分诊（用于本组断言）');
    ok(!!without && !without.triage, 'fire_home 应无分诊（用于本组断言）');
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
        args: { scene: 'fire_home' },
        result: { found: true, published: true },
      },
    ];
    const g2 = T.checkGate(
      'triage',
      { scene: 'fire_home' },
      {
        entries: ENTRIES,
        sceneIds: SCENE_IDS,
        history: h2,
      }
    );
    ok(!g2.ok && g2.reason === 'no-triage', `fire_home 无分诊应被拒，实际 ${g2.reason}`);
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
    ok(out.endKind === 'refuse', `被拒后应收敛到 refuse，实际 ${out.endKind}`);
  })();
  /* ---------- 18. 上限：同参重复调用必须收尾（§2.5.7） ----------
     2026-11-19 新增。此前这一条**只有文档、没有代码也没有断言** ——
     是 probe_multi_turn 的 MT08 撞出来的：模型想查「儿童坠床」，
     而白名单只有 fall_elderly，于是反复 lookup_scene(fall_elderly)，
     空转到撞上 MAX 步，用户白等 4 次往返（≈4 秒）。

     §2.5.7 原文：「同参重复调用且观察相同 → 强制 finish」，
     并强调「只设下限 = 允许死循环」。本节就是把这句话变成判据。 */
  console.log('\n=== 18. 上限：同参重复 lookup 必须强制收尾 ===');
  await (async () => {
    let calls = 0;
    const out = await A.run(
      '孩子从床上掉下来了',
      { entries: ENTRIES, sceneIds: SCENE_IDS, history: [] },
      {
        // 永远只给同一个 lookup —— 模拟 MT08 的绕圈行为
        decide() {
          calls++;
          return { act: 'lookup_scene', args: { scene: 'fall_elderly' } };
        },
        exec() {},
      }
    );

    ok(calls <= 2, `同参重复 lookup 不应被调用超过 2 次（首次 + 一次判重），实际 ${calls} 次`);
    ok(out.reason === 'repeat-call', `收尾原因应为 repeat-call，实际 ${out.reason}`);
    ok(out.endKind === 'refuse', `绕圈后应收敛到安全出口，实际 ${out.endKind}`);
    ok(
      out.steps.filter((s) => s.act === 'lookup_scene').length <= 1,
      '重复的 lookup 不该被真的执行（进了 history 就会污染后续前置条件）'
    );
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
