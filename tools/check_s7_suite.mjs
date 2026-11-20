/* =========================================================
   S7 校验器：日常回答里出现的操作动作，必须能回溯到条目字段
   判据来源：docs/01-需求基线.md §5 S7 / docs/03-技术方案.md §4

   ★ 为什么单独一个脚本（docs/08 P5 的自锁）
     P5 触发条件写的是「需要解释性长回答 **且 S7 校验手段就位**」，
     而 S7 校验的对象是「日常扩写输出」——P5 自己的产物。
     照字面执行 P5 永远不会被触发。本脚本证明这个自锁是假问题：
     **判据可以先建，输入用构造 fixture**（同 tools/selftest_m1.mjs 的投毒自检思路）。

   ★ 四个问题码
     L1 硬失败：src 缺失 / 语法错 / 字段段不存在 / 下标越界 / 场景未发布
     A  时态错位：intent=prevention 却引用 steps.*（日常问题给了紧急动作）
     B  动作未声明：actions 为空或缺失；或声明 needAction:false 却在正文复述动作
     C  正文含知识外动作：分句含动作动词，且与本条目全部字段、全部已声明动作的重合都过低

   ★ 能力边界（必须如实对外说）
     L1 只拦「编造出处」，**拦不住张冠李戴**。
     A 只能发现「日常用了 steps」，不能发现「日常该答预防却答成别的预防」。
     C 靠字符重合 + 动词表，阈值 C_TAU=0.4 是**在本测试集上标定的**，
       存在与阈值 0.045 同类的过拟合风险 —— 换一批样本必须重标，不许直接沿用。
     S7 只管「动作」，不管「事实断言」。「没有固定年限」这类不属本判据范围（属 S2）。

   ★ 一旦出现 L1，不再评 A/B/C
     动作清单本身不可信时，逐句归源没有意义，报出来只会稀释信号。

   用法:
     node tools/check_s7.mjs                                    # 内置 fixture + 投毒自检
     node tools/check_s7.mjs --suite=tools/eval/cases_s7.json    # 跑测试集
     node tools/check_s7.mjs --scan=<file>                       # 校验一批真实输出
     node tools/check_s7.mjs --json                              # 机器可读
   退出码: 0 = 全部符合预期；1 = 有断言未按预期（含投毒未红）
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/* 动作动词表只留一份：与 llm_proxy 的 P5 链路共用 s7_core。 */
import { ACT_VERBS, VERB_RE } from './s7_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const getArg = (k) => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};

/* ---------- 知识库：只取已发布条目，与产品同口径 ---------- */
function loadEntries() {
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'index.json'), 'utf8'));
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

/* ---------- 字段展平：{name, text, isAction} ----------
   isAction 决定它能不能作为「动作的来源」：
     steps.* 与 daily.prevention 是动作
     daily.summary / why / misconception 是解释，不能当动作出处
   这个区分是判据成立的关键：没有它，「轿厢内有通风口」会被当成复述动作。 */
function fieldsOf(entry) {
  const out = [];
  const daily = entry.daily || {};
  for (const [k, v] of Object.entries(daily)) {
    const isAction = k === 'prevention';
    if (Array.isArray(v)) {
      v.forEach((t, i) => out.push({ name: `daily.${k}[${i}]`, text: String(t), isAction }));
    } else if (typeof v === 'string') {
      out.push({ name: `daily.${k}`, text: v, isAction: false });
    }
  }
  for (const seg of ['immediate', 'next', 'never']) {
    (entry.steps?.[seg] || []).forEach((t, i) =>
      out.push({ name: `steps.${seg}[${i}]`, text: t.text, isAction: true })
    );
  }
  return out;
}
const FIELDS = {};
for (const [id, e] of Object.entries(ENTRIES)) FIELDS[id] = fieldsOf(e);

/* =========================================================
   文本工具
   ========================================================= */
const STOP = new Set('的了是要和在有就都而及与或把被给对为以这那很不没别也还再个些'.split(''));

function contentChars(s) {
  return [...String(s || '')].filter((ch) => /[\u4e00-\u9fa5]/.test(ch) && !STOP.has(ch));
}

/* 分句：标点全切。逗号顿号都切，否则「喊人、捂湿毛巾、贴地快走」会被当成一个长句，
   与任何单一字段的重合都上不去，造成假 C。 */
function clauses(text) {
  return String(text || '')
    .split(/[，。；：、！？\n\r\t]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* 动作动词表来自 shared core（见文件头 import）。
   刻意不收：防、玩、有、是、给、记住、注意、建议、最好。 */
function hasVerb(clause) {
  return VERB_RE.test(clause);
}

/* 重合率：分句实义字被目标文本覆盖的比例 */
function overlap(clause, target) {
  const a = contentChars(clause);
  if (!a.length) return 0;
  const b = new Set(contentChars(target));
  const hit = [...new Set(a.filter((ch) => b.has(ch)))];
  return hit.length / a.length;
}

/* =========================================================
   L1：src 解析
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
  if (typeof text !== 'string' || !text) return { ok: false, why: `${top}.${seg}[${idx}] 无文本` };
  return { ok: true, text };
}

/* =========================================================
   主体分析：给 (entry, output, intent) 返回 findings
   ========================================================= */
const C_TAU = 0.4; // 在本测试集上标定，见文件头「能力边界」
/* C2 跨场景搬运的两个阈值：本条目重合低于 0.7 说明它不是本场景的说法，
   别的场景重合达 0.6 说明它确实属于别处。中间地带是「两边都沾」的模糊表述，不动它。 */
const CROSS_OWN_MAX = 0.7;
const CROSS_OTHER_MIN = 0.6;

function analyze(entry, output, intent) {
  const problems = []; // L1
  const findings = []; // A/B/C

  const actions = Array.isArray(output && output.actions) ? output.actions : null;
  const declaredSays = (actions || []).map((a) => (a && a.say) || '').filter(Boolean);
  const text = (output && output.text) || '';

  /* ---- L1 ---- */
  for (const a of actions || []) {
    const say = a && a.say;
    if (typeof say !== 'string' || !say.trim()) {
      problems.push({ level: 'L1', why: '动作缺 say 文本' });
      continue;
    }
    const r = resolveSrc(entry, a.src);
    if (!r.ok) problems.push({ level: 'L1', why: r.why, say });
  }

  /* 有 L1 就不再评 A/B/C —— 动作清单本身不可信 */
  if (problems.length) return { ok: false, problems, findings };

  /* ---- A 时态错位 ---- */
  if (intent === 'prevention') {
    const stepRefs = (actions || []).filter((a) => String(a && a.src).startsWith('steps.'));
    if (stepRefs.length) {
      findings.push({
        code: 'A',
        why: `预防咨询引用了 ${stepRefs.length} 条 steps.*（紧急动作）`,
        detail: stepRefs.map((a) => a.src),
      });
    }
  }

  /* ---- B 动作未声明 ---- */
  const isEmpty = !actions || actions.length === 0;
  if (isEmpty) {
    const need = output && output.needAction;
    const actionFields = FIELDS[entry.id].filter((f) => f.isAction);
    const actionClauses = clauses(text).filter(
      (c) =>
        contentChars(c).length >= 3 &&
        hasVerb(c) &&
        actionFields.some((f) => overlap(c, f.text) >= 0.5)
    );
    if (need !== false) {
      findings.push({
        code: 'B',
        why:
          need === true
            ? '声明 needAction:true 但 actions 为空'
            : 'actions 为空且未声明 needAction（默认按需要动作处理）',
      });
    } else if (actionClauses.length) {
      findings.push({
        code: 'B',
        why: `声明 needAction:false，但正文有 ${actionClauses.length} 个分句在复述知识里的动作`,
        detail: actionClauses,
      });
    }
  }

  /* ---- C 正文含知识外动作 ----
     两条子规则，成因不同，必须分开判：
       C1 本条目内找不到出处（bestOwn < C_TAU）
       C2 出处其实在**别的场景**（bestOther 高、bestOwn 不高）——
          「gas_leak 里让用户装一氧化碳报警器」这种，L1 查不出（两条 src 都合法），
          靠 C1 也查不出（与「燃气报警器」共享 4 个字刚好压线），只有比对全库才发现。 */
  const ownTexts = FIELDS[entry.id].map((f) => f.text).concat(declaredSays);
  const otherTexts = Object.entries(FIELDS)
    .filter(([id]) => id !== entry.id)
    .flatMap(([, fs]) => fs.map((f) => f.text));
  const unknown = [];
  for (const c of clauses(text)) {
    if (contentChars(c).length < 4) continue; // 太短判不准，放过
    if (!hasVerb(c)) continue; // 无动作动词 = 铺垫/评价/解释，不算 C
    const bestOwn = ownTexts.length ? Math.max(...ownTexts.map((t) => overlap(c, t))) : 0;
    const bestOther = otherTexts.length ? Math.max(...otherTexts.map((t) => overlap(c, t))) : 0;
    if (bestOwn < C_TAU) {
      unknown.push({ clause: c, kind: 'C1 无出处', own: +bestOwn.toFixed(2) });
    } else if (bestOwn < CROSS_OWN_MAX && bestOther >= CROSS_OTHER_MIN) {
      unknown.push({
        clause: c,
        kind: 'C2 跨场景搬运',
        own: +bestOwn.toFixed(2),
        other: +bestOther.toFixed(2),
      });
    }
  }
  if (unknown.length) {
    findings.push({
      code: 'C',
      why: `正文有 ${unknown.length} 个分句与知识无对应`,
      detail: unknown,
    });
  }

  return { ok: findings.length === 0, problems, findings };
}

/* 单条校验：给 {scene, intent, text, actions, needAction} */
function checkOne(output) {
  const scene = output && output.scene;
  const entry = ENTRIES[scene];
  if (!entry) {
    return {
      ok: false,
      problems: [{ level: 'L1', why: `场景「${scene}」不是已发布条目` }],
      findings: [],
    };
  }
  return analyze(entry, output, output.intent || 'prevention');
}

/* =========================================================
   内置 fixture（覆盖 L1 与 A/B 基线，不含测试集的 28 条）
   ========================================================= */
const GAS = 'gas_leak';
const fixtures = [
  { name: 'F1 合规：原句直引', expect: true, output: { scene: GAS, intent: 'prevention', text: '软管要年年看一眼。', actions: [{ say: '每年检查一次燃气软管', src: 'daily.prevention[0]' }], needAction: true } },
  { name: 'F2 合规：改写但同义', expect: true, output: { scene: GAS, intent: 'prevention', text: '用完记得关灶具和阀门。', actions: [{ say: '用完燃气关灶具和阀门', src: 'daily.prevention[1]' }], needAction: true } },
  { name: 'F3 合规：紧急态引用 steps', expect: true, output: { scene: GAS, intent: 'ongoing', text: '先开窗。', actions: [{ say: '打开所有门窗通风', src: 'steps.immediate[0]' }], needAction: true } },
  { name: 'F4 越界：src 下标越界', expect: false, output: { scene: GAS, intent: 'prevention', text: '顺便换根金属管。', actions: [{ say: '去买一根金属波纹管', src: 'daily.prevention[99]' }], needAction: true } },
  { name: 'F5 越界：src 为 null', expect: false, output: { scene: GAS, intent: 'prevention', text: '关总阀。', actions: [{ say: '关闭燃气总阀', src: null }], needAction: true } },
  { name: 'F6 越界：src 语法不合规', expect: false, output: { scene: GAS, intent: 'prevention', text: '随便看看。', actions: [{ say: '定期检查', src: 'prevention[1]' }], needAction: true } },
  { name: 'F7 越界：src 字段段不存在', expect: false, output: { scene: GAS, intent: 'prevention', text: '报修。', actions: [{ say: '打电话报修', src: 'daily.emergency[0]' }], needAction: true } },
  { name: 'F8 越界：场景未发布', expect: false, output: { scene: 'cpr', intent: 'prevention', text: '按压胸口。', actions: [{ say: '按压胸口', src: 'steps.immediate[0]' }], needAction: true } },
  { name: 'F9 合规：零动作纯解释', expect: true, output: { scene: 'elevator_trapped', intent: 'prevention', text: '电梯困人是设备保护动作，轿厢内有通风口，短时间不会缺氧。', actions: [], needAction: false } },
  { name: 'F10 越界：A 时态错位', expect: false, output: { scene: 'elevator_trapped', intent: 'prevention', text: '别慌，按警铃等救援。', actions: [{ say: '按黄色警铃或通话键', src: 'steps.immediate[0]' }], needAction: true } },
];

/* =========================================================
   投毒自检：证明断言真的会红
   ========================================================= */
function poisonSelfTest() {
  const good = fixtures.find((f) => f.name.startsWith('F1'));
  const before = checkOne(good.output);
  const bad = JSON.parse(JSON.stringify(good.output));
  bad.actions[0].src = 'daily.prevention[999]';
  const after = checkOne(bad);
  return { beforeOk: before.ok, afterOk: after.ok, passed: before.ok === true && after.ok === false };
}

/* =========================================================
   测试集模式
   ========================================================= */
function runSuite(file) {
  const p = path.resolve(ROOT, file);
  if (!fs.existsSync(p)) return { error: `找不到测试集 ${file}` };
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rows = (data.cases || []).map((c) => {
    const entry = ENTRIES[c.scene];
    const r = entry
      ? analyze(entry, c.model_output, c.intent || 'prevention')
      : {
          ok: false,
          problems: [{ level: 'L1', why: `场景「${c.scene}」不是已发布条目` }],
          findings: [],
        };
    const actual = [
      ...new Set([...r.problems.map(() => 'L1'), ...r.findings.map((f) => f.code)]),
    ].sort();
    const want = [...new Set(c.expect.findings || [])].sort();
    const same = actual.length === want.length && actual.every((x, i) => x === want[i]);
    const verdictOk = (c.expect.verdict === 'pass') === r.ok;
    return {
      id: c.id,
      class: c.class,
      want,
      actual,
      verdict: same && verdictOk ? 'OK' : 'MISMATCH',
      problems: r.problems,
      findings: r.findings,
      why: c.why,
    };
  });
  return {
    title: data.purpose,
    total: rows.length,
    ok: rows.filter((r) => r.verdict === 'OK').length,
    rows,
  };
}

/* =========================================================
   scan 模式
   ========================================================= */
function runScan(file) {
  const p = path.resolve(ROOT, file);
  if (!fs.existsSync(p)) return { error: `找不到文件 ${file}（--scan 需要真实生成产物）` };
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const arr = Array.isArray(data) ? data : data.items || [];
  const rows = arr.map((o, i) => {
    const r = checkOne(o);
    return { i, id: o.id, ok: r.ok, problems: r.problems, findings: r.findings };
  });
  return {
    total: rows.length,
    bad: rows.filter((r) => !r.ok).length,
    byCode: rows.reduce((m, r) => {
      for (const c of [...r.problems.map(() => 'L1'), ...r.findings.map((f) => f.code)]) {
        m[c] = (m[c] || 0) + 1;
      }
      return m;
    }, {}),
    rows,
  };
}

/* =========================================================
   执行
   ========================================================= */
const scanArg = getArg('scan');
const suiteArg = getArg('suite');

if (scanArg) {
  const r = runScan(scanArg);
  if (JSON_OUT) console.log(JSON.stringify(r, null, 1));
  else if (r.error) console.error(r.error);
  else {
    console.log(`扫描 ${r.total} 条：不通过 ${r.bad} 条`);
    console.log(`问题分布 ${JSON.stringify(r.byCode)}`);
    for (const row of r.rows.filter((x) => !x.ok).slice(0, 10)) {
      const codes = [...row.problems.map(() => 'L1'), ...row.findings.map((f) => f.code)];
      console.log(`  #${row.i} ${row.id || ''} → ${codes.join('+')}`);
      for (const f of row.findings) {
        if (f.detail) console.log(`      ${f.code}: ${JSON.stringify(f.detail).slice(0, 160)}`);
      }
    }
  }
  process.exit(r.error || r.bad > 0 ? 1 : 0);
}

if (suiteArg) {
  const r = runSuite(suiteArg);
  if (JSON_OUT) console.log(JSON.stringify(r, null, 1));
  else if (r.error) console.error(r.error);
  else {
    console.log(`=== S7 测试集：${r.total} 条 ===`);
    console.log(`${r.ok}/${r.total} 条与预期一致\n`);
    for (const row of r.rows) {
      const flag = row.verdict === 'OK' ? ' ' : '✗';
      console.log(
        `${flag} ${row.id.padEnd(8)} ${row.class.padEnd(16)} 期望 [${row.want.join(',') || '无'}] 实际 [${row.actual.join(',') || '无'}]`
      );
      if (row.verdict !== 'OK') {
        for (const p of row.problems) console.log(`        L1：${p.why}`);
        for (const f of row.findings) {
          console.log(`        ${f.code}：${f.why}`);
          if (f.detail) console.log(`            ${JSON.stringify(f.detail).slice(0, 200)}`);
        }
        console.log(`        期望理由：${row.why}`);
      }
    }
    const bad = r.rows.filter((x) => x.verdict !== 'OK');
    console.log(`\n${bad.length === 0 ? '全部一致' : `${bad.length} 条不一致，见上`}`);
  }
  process.exit(r.error || r.rows.some((x) => x.verdict !== 'OK') ? 1 : 0);
}

/* ---------- 默认：内置 fixture ---------- */
const rows = fixtures.map((f) => ({ name: f.name, expect: f.expect, ...checkOne(f.output) }));
const poison = poisonSelfTest();
const mismatch = rows.filter((r) => r.ok !== r.expect);

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        rows: rows.map((r) => ({ name: r.name, ok: r.ok, problems: r.problems, findings: r.findings })),
        poison,
      },
      null,
      1
    )
  );
} else {
  console.log('=== S7 校验器 · 内置 fixture ===');
  console.log(`已发布条目 ${Object.keys(ENTRIES).length} 个 | fixture ${rows.length} 条 | C_TAU ${C_TAU}\n`);
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(34)} 期望 ${r.expect ? 'PASS' : 'FAIL'} 实际 ${r.ok ? 'PASS' : 'FAIL'}`);
    for (const p of r.problems) console.log(`      L1 拒绝：${p.why}`);
    for (const f of r.findings) console.log(`      ${f.code} 检出：${f.why}`);
  }
  console.log('\n=== 投毒自检 ===');
  console.log(
    `  改坏前 F1 → ${poison.beforeOk ? 'PASS' : 'FAIL'}｜改坏后 F1 → ${poison.afterOk ? 'PASS' : 'FAIL'}`
  );
  console.log(`  ${poison.passed ? '✅ 判据可失败' : '❌ 判据无效：改坏后仍通过'}`);
  console.log(mismatch.length ? `\n✗ ${mismatch.length} 条与预期不符` : '\n全部符合预期');
}

process.exit(mismatch.length === 0 && poison.passed ? 0 : 1);
