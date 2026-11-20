/* =========================================================
   S7 校验器：日常回答里出现的操作动作，必须能回溯到条目字段
   判据来源：docs/01-需求基线.md §5 S7 / docs/03-技术方案.md §4

   ★ 为什么要单独一个脚本（docs/08 P5 的自锁）
     P5 的触发条件写的是「需要解释性长回答 **且 S7 校验手段就位**」。
     而 S7 校验的对象是「日常扩写输出」——那是 P5 自己的产物。
     照字面执行，P5 永远不会被触发：没输出 → 无法校验 → 条件不满足 → 不做 P5。

     本脚本证明这个自锁是假问题：**判据可以先建，输入用构造的模型输出**
     （与 tools/selftest_m1.mjs 的投毒自检同一思路）。

   ★ 两级判据，能力边界必须写清
     L1 出处存在性：src 指向的字段必须真实存在。**纯机器可判，可靠。**
     L2 语义一致性：动作文本与出处文本要有实义重合。**字符重合有漏网，不可靠。**
        实测反例：「关闭燃气阀门」挂到 daily.prevention[0]「每年检查一次燃气软管」
        上，靠共用「燃/气」二字被判 PASS —— 把紧急动作冒充成日常据实。
        所以 L2 的结论只作**提示**，不作放行依据；放行只看 L1。

   ★ 不许这样用
     本脚本不做「多少条能过」的统计。它是**单条判定器**：给一条模型输出，
     回答「这条动作能不能回溯」。要统计覆盖率，用 --scan 扫真实生成结果，
     且必须先有 P5 的生成产物 —— 在那之前 --scan 只会告诉你「无可扫文件」。

   用法:
     node tools/check_s7.mjs              # 跑内置 fixture + 投毒自检
     node tools/check_s7.mjs --json       # 机器可读输出（CI 用）
     node tools/check_s7.mjs --scan=<file>  # 校验一批真实输出（JSON 数组）
   退出码: 0 = 全部符合预期；1 = 有断言未按预期（含投毒未红）
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const scanArg = argv.find((a) => a.startsWith('--scan='));

/* ---------- 知识库：只取已发布条目，与产品同口径 ---------- */
function loadEntries() {
  const indexPath = path.join(ROOT, 'knowledge', 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const out = {};
  for (const slot of index.slots) {
    const p = path.join(ROOT, 'knowledge', slot.id + '.json');
    if (!fs.existsSync(p)) continue;
    const e = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (e.status === 'published') out[slot.id] = e;
  }
  return out;
}
const ENTRIES = loadEntries();

/* =========================================================
   L1：src 解析。返回 { ok, text, why }
   src 语法固定为 "<top>.<seg>[<idx>]"，top ∈ {daily, steps}
   —— 与 knowledge/*.json 的字段结构一一对应，不引入新格式。
   ========================================================= */
const SRC_RE = /^(daily|steps)\.([a-z_]+)\[(\d+)\]$/;

function resolveSrc(entry, src) {
  if (typeof src !== 'string') return { ok: false, why: 'src 缺失或非字符串' };
  const m = SRC_RE.exec(src);
  if (!m) return { ok: false, why: `src 语法不合规「${src}」（应形如 daily.prevention[0]）` };
  const [, top, seg, idxRaw] = m;
  const segObj = top === 'steps' ? entry.steps : entry.daily;
  if (!segObj || !(seg in segObj)) return { ok: false, why: `条目无字段 ${top}.${seg}` };
  const arr = segObj[seg];
  if (!Array.isArray(arr)) return { ok: false, why: `${top}.${seg} 不是数组` };
  const idx = Number(idxRaw);
  if (!Number.isInteger(idx) || idx < 0) return { ok: false, why: `下标非法 ${idxRaw}` };
  if (idx >= arr.length) {
    return { ok: false, why: `${top}.${seg} 长度 ${arr.length}，下标 ${idx} 越界` };
  }
  const item = arr[idx];
  const text = typeof item === 'string' ? item : item && item.text;
  if (typeof text !== 'string' || !text) {
    return { ok: false, why: `${top}.${seg}[${idx}] 无文本` };
  }
  return { ok: true, text };
}

/* =========================================================
   L2：语义一致性（弱检测，只作提示）
   判法：动作里的汉字，在出处文本中的**实义重合**。
   去掉高频虚词与标点，避免「要/的/了」把不相关文本连起来。
   阈值 3 个字：低于 3 会把「关阀门」与「关灶具」判成同一条。
   ========================================================= */
const STOP = new Set('的了是要和在有就都而及与或把被给对为以'.split(''));

function contentChars(s) {
  return [...String(s || '')].filter((ch) => /[\u4e00-\u9fa5]/.test(ch) && !STOP.has(ch));
}

function checkL2(say, srcText) {
  const a = contentChars(say);
  const b = new Set(contentChars(srcText));
  const hit = a.filter((ch) => b.has(ch));
  /* 重复字只算一次，否则「火火火」能凑够阈值 */
  const uniqHit = [...new Set(hit)];
  return { ok: uniqHit.length >= 3, hit: uniqHit, need: 3 };
}

/* =========================================================
   单条校验：给 { scene, text, actions:[{say, src}] }
   ========================================================= */
function checkOne(output) {
  const problems = [];
  const warns = [];
  const scene = output && output.scene;
  const entry = ENTRIES[scene];

  if (!entry) {
    problems.push({ level: 'L1', why: `场景「${scene}」不是已发布条目`, say: null });
    return { ok: false, problems, warns };
  }
  const actions = (output && output.actions) || [];
  if (!Array.isArray(actions) || actions.length === 0) {
    /* 没有动作 = 纯解释，天然满足 S7。这不报错，但要在 warns 里说明
       —— 否则「零动作」会被当成「校验通过」的护身符。 */
    warns.push({ level: 'info', why: '本条无操作动作（纯解释），S7 不适用' });
    return { ok: true, problems, warns };
  }

  for (const a of actions) {
    const say = a && a.say;
    if (typeof say !== 'string' || !say.trim()) {
      problems.push({ level: 'L1', why: '动作缺 say 文本', say: say });
      continue;
    }
    const r = resolveSrc(entry, a.src);
    if (!r.ok) {
      problems.push({ level: 'L1', why: r.why, say });
      continue;
    }
    const l2 = checkL2(say, r.text);
    if (!l2.ok) {
      /* L2 不通过只记 warn，不记 problem —— 字符重合会误伤合理改写。
         但必须留痕，否则「全绿」会掩盖语义漂移。 */
      warns.push({
        level: 'L2',
        why: `与出处实义重合 ${l2.hit.length} 字（需 ≥${l2.need}）`,
        say,
        src: a.src,
        srcText: r.text,
      });
    }
  }
  /* 放行只看 L1：有任何一个 L1 problem 即不通过 */
  const ok = !problems.some((p) => p.level === 'L1');
  return { ok, problems, warns };
}

/* =========================================================
   Fixtures：每条都写「期望通过还是失败」。
   判据必须能失败 —— 全是期望通过就等于没判据。
   ========================================================= */
const GAS = 'gas_leak';
const fixtures = [
  {
    name: 'F1 合规：原句直引',
    expect: true,
    output: {
      scene: GAS,
      text: '软管要年年看一眼。',
      actions: [{ say: '每年检查一次燃气软管', src: 'daily.prevention[0]' }],
    },
  },
  {
    name: 'F2 合规：改写但同义',
    expect: true,
    output: {
      scene: GAS,
      text: '用完记得关灶具和阀门。',
      actions: [{ say: '用完燃气关灶具和阀门', src: 'daily.prevention[1]' }],
    },
  },
  {
    name: 'F3 合规：引用紧急步骤',
    expect: true,
    output: {
      scene: GAS,
      text: '先开窗。',
      actions: [{ say: '打开所有门窗通风', src: 'steps.immediate[0]' }],
    },
  },
  {
    name: 'F4 越界：src 下标越界（编造动作的典型形态）',
    expect: false,
    output: {
      scene: GAS,
      text: '顺便换根金属管。',
      actions: [{ say: '去买一根金属波纹管', src: 'daily.prevention[99]' }],
    },
  },
  {
    name: 'F5 越界：src 为 null（无出处）',
    expect: false,
    output: {
      scene: GAS,
      text: '关总阀。',
      actions: [{ say: '关闭燃气总阀', src: null }],
    },
  },
  {
    name: 'F6 越界：src 语法不合规',
    expect: false,
    output: {
      scene: GAS,
      text: '随便看看。',
      actions: [{ say: '定期检查', src: 'prevention[1]' }],
    },
  },
  {
    name: 'F7 越界：src 指向不存在的字段段',
    expect: false,
    output: {
      scene: GAS,
      text: '报修。',
      actions: [{ say: '打电话报修', src: 'daily.emergency[0]' }],
    },
  },
  {
    name: 'F8 越界：场景不存在（未发布条目）',
    expect: false,
    output: {
      scene: 'cpr',
      text: '按压胸口。',
      actions: [{ say: '按压胸口', src: 'steps.immediate[0]' }],
    },
  },
  {
    name: 'F9 合规：零动作纯解释',
    expect: true,
    output: {
      scene: GAS,
      text: '燃气泄漏遇明火会爆炸，所以要先通风关阀。',
      actions: [],
    },
  },
  {
    name: 'F10 已知漏网（L2 拦不住，记 warn 不记 problem）',
    expect: true,
    output: {
      scene: GAS,
      text: '关掉阀门。',
      actions: [{ say: '关闭燃气阀门', src: 'daily.prevention[0]' }],
    },
    expectWarn: 'L2',
  },
];

/* =========================================================
   投毒自检：证明断言真的会红
   做法：把 F1 的 src 改坏，它必须从 PASS 翻成 FAIL。
   若改坏后仍 PASS，说明判据没在起作用。
   ========================================================= */
function poisonSelfTest() {
  const good = fixtures.find((f) => f.name.startsWith('F1'));
  const before = checkOne(good.output);
  const poisoned = JSON.parse(JSON.stringify(good.output));
  poisoned.actions[0].src = 'daily.prevention[999]';
  const after = checkOne(poisoned);
  return {
    beforeOk: before.ok,
    afterOk: after.ok,
    passed: before.ok === true && after.ok === false,
  };
}

/* =========================================================
   主流程
   ========================================================= */
function runFixtures() {
  const rows = fixtures.map((f) => {
    const r = checkOne(f.output);
    const pass = r.ok === f.expect;
    let warnOk = true;
    if (f.expectWarn) {
      warnOk = r.warns.some((w) => w.level === f.expectWarn);
    }
    return {
      name: f.name,
      expect: f.expect ? 'PASS' : 'FAIL',
      actual: r.ok ? 'PASS' : 'FAIL',
      verdict: pass && warnOk ? 'OK' : 'MISMATCH',
      problems: r.problems,
      warns: r.warns,
    };
  });
  return rows;
}

function runScan(file) {
  const p = path.resolve(ROOT, file);
  if (!fs.existsSync(p)) {
    return { error: `找不到文件 ${file}（--scan 需要 P5 的真实生成产物）` };
  }
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const arr = Array.isArray(data) ? data : data.items || [];
  const rows = arr.map((o, i) => {
    const r = checkOne(o);
    return { i, ok: r.ok, problems: r.problems, warns: r.warns };
  });
  const l1Bad = rows.filter((r) => !r.ok).length;
  return {
    total: rows.length,
    l1Bad,
    l2Warn: rows.reduce((n, r) => n + r.warns.filter((w) => w.level === 'L2').length, 0),
    rows,
  };
}

/* ---------- 执行 ---------- */
if (scanArg) {
  const r = runScan(scanArg.split('=')[1]);
  if (JSON_OUT) {
    console.log(JSON.stringify(r, null, 1));
  } else if (r.error) {
    console.error(r.error);
  } else {
    console.log(`扫描 ${r.total} 条：L1 不通过 ${r.l1Bad} 条，L2 提示 ${r.l2Warn} 处`);
  }
  process.exit(r.error || r.l1Bad > 0 ? 1 : 0);
}

const rows = runFixtures();
const poison = poisonSelfTest();
const mismatch = rows.filter((r) => r.verdict !== 'OK');

if (JSON_OUT) {
  console.log(JSON.stringify({ rows, poison }, null, 1));
} else {
  console.log('=== S7 校验器 · 内置 fixture ===');
  console.log(`已发布条目 ${Object.keys(ENTRIES).length} 个 | fixture ${rows.length} 条\n`);
  for (const r of rows) {
    const mark = r.verdict === 'OK' ? ' ' : '✗';
    console.log(
      `${mark} ${r.name.padEnd(46)} 期望 ${r.expect.padEnd(4)} 实际 ${r.actual.padEnd(4)}`
    );
    for (const p of r.problems) console.log(`      L1 拒绝：${p.why}`);
    for (const w of r.warns) {
      if (w.level === 'L2') console.log(`      L2 提示：${w.why}（不拦，仅留痕）`);
      if (w.level === 'info') console.log(`      · ${w.why}`);
    }
  }
  console.log('\n=== 投毒自检（证明断言真的会红）===');
  console.log(`  改坏前 F1 → ${poison.beforeOk ? 'PASS' : 'FAIL'}`);
  console.log(`  改坏后 F1 → ${poison.afterOk ? 'PASS' : 'FAIL'}`);
  console.log(`  ${poison.passed ? '✅ 判据可失败，S7 校验器成立' : '❌ 判据无效：改坏后仍通过'}`);
  console.log('\n=== 结论 ===');
  if (mismatch.length === 0 && poison.passed) {
    console.log(`  ${rows.length} 条 fixture 全部符合预期，投毒自检通过。`);
    console.log('  能力边界：L1 拦「编造出处」，L2 只能提示「语义漂移」，字符重合会漏。');
  } else {
    console.log(`  ${mismatch.length} 条 fixture 与预期不符，或投毒未红 —— 判据不可用。`);
  }
}

process.exit(mismatch.length === 0 && poison.passed ? 0 : 1);
