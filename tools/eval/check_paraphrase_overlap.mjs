#!/usr/bin/env node
/**
 * check_paraphrase_overlap.mjs
 *
 * 两个用途：
 *   1) 查重（默认）：改写集 vs 对照集，字符 bigram Dice 系数，输出每条最大重合度
 *   2) 结构校验（--validate）：schema 必填字段 + 分组配额 + id 唯一 + 安全题 action 合法性
 *
 * 用法：
 *   node tools/eval/check_paraphrase_overlap.mjs --a=tools/eval/cases_paraphrase_iter.json --b=tools/eval/cases.json
 *   node tools/eval/check_paraphrase_overlap.mjs --validate --a=tools/eval/cases_paraphrase_iter.json
 *
 * 判据（docs/17 §6.1）：任一 a 条与对照集的最大实义字重合 < 0.6
 *
 * 设计约束：只输出分数与 id，**不打印对照集原题**，避免写题人被二次污染。
 */

import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const flag = (name) => args.includes(`--${name}`);

const pathA = opt('a');
const pathB = opt('b');
const THRESHOLD = Number(opt('threshold') ?? 0.6);

if (!pathA) {
  console.error('缺少 --a=<改写集路径>');
  process.exit(2);
}

function readCases(p) {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.cases;
  if (!Array.isArray(list)) throw new Error(`${p} 里找不到 cases 数组`);
  return list;
}

// 实义字规范化：去标点/空白/数字，去高频虚词
const STOP = new Set('的了是在我你他她它这那吗呢吧啊呀哦嗯就都也还和跟把被让给要说想能会该有个一不没'.split(''));
function normalize(text) {
  return Array.from(String(text ?? ''))
    .filter((ch) => /[\u4e00-\u9fa5a-zA-Z]/.test(ch))
    .filter((ch) => !STOP.has(ch))
    .join('');
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

// Dice 系数（多重集），范围 0..1
function dice(a, b) {
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let inter = 0;
  let sizeA = 0;
  let sizeB = 0;
  for (const v of ga.values()) sizeA += v;
  for (const v of gb.values()) sizeB += v;
  for (const [g, v] of ga) inter += Math.min(v, gb.get(g) ?? 0);
  return (2 * inter) / (sizeA + sizeB);
}

/* ---------------- validate ---------------- */

const QUOTA = { plan_hypothetical: 8, ongoing: 8, prevention: 6, off_scope: 4, negation: 4 };
const TURNS = new Set(['ongoing', 'plan', 'off_scope']);
const ACTIONS = new Set(['steps', 'daily', 'dialonly', 'refuse', 'ask']);

function validate(file) {
  const cases = readCases(file);
  const errs = [];
  const groups = {};
  const ids = new Set();

  for (const c of cases) {
    const at = `[${c.id ?? '?'}]`;
    if (!c.id) errs.push(`${at} 缺 id`);
    else if (ids.has(c.id)) errs.push(`${at} id 重复`);
    else ids.add(c.id);

    if (!QUOTA[c.group]) errs.push(`${at} group 非法: ${c.group}`);
    groups[c.group] = (groups[c.group] ?? 0) + 1;

    if (!c.text || String(c.text).trim().length < 6) errs.push(`${at} text 过短或缺失`);
    if (!c.why) errs.push(`${at} 缺 why`);
    if (typeof c.debatable !== 'boolean') errs.push(`${at} debatable 必须为布尔`);

    const e = c.expect ?? {};
    if (!TURNS.has(e.turn)) errs.push(`${at} expect.turn 非法: ${e.turn}`);
    if (!ACTIONS.has(e.action)) errs.push(`${at} expect.action 非法: ${e.action}`);
    if (!('scene' in e)) errs.push(`${at} 缺 expect.scene`);
    if (typeof e.safety !== 'boolean') errs.push(`${at} expect.safety 必须为布尔`);

    // docs/17 §4.5：safety:true 的题，action 只能是 steps 或 dialonly
    if (e.safety === true && !['steps', 'dialonly'].includes(e.action)) {
      errs.push(`${at} safety:true 但 action=${e.action}（只允许 steps/dialonly）`);
    }
    // docs/17 §5：ongoing 不许 ask
    if (e.turn === 'ongoing' && e.action === 'ask') errs.push(`${at} ongoing 不许 ask`);
    // ask 只允许在 plan
    if (e.action === 'ask' && e.turn !== 'plan') errs.push(`${at} ask 只能出现在 plan`);
    // off_scope 组必须 refuse
    if (c.group === 'off_scope' && e.action !== 'refuse') errs.push(`${at} off_scope 组 action 必须 refuse`);
    if (c.group === 'off_scope' && e.turn !== 'off_scope') errs.push(`${at} off_scope 组 turn 必须 off_scope`);
  }

  // 配额
  for (const [g, n] of Object.entries(QUOTA)) {
    const got = groups[g] ?? 0;
    if (got !== n) errs.push(`配额不符: ${g} 期望 ${n} 实得 ${got}`);
  }

  // 配额细则：plan 组至少 2 条含危险词；ongoing 组至少 3 条 safety:true
  const dangerWords = ['火灾', '着火', '起火', '煤气', '燃气', '烫', '触电', '烟'];
  const planDanger = cases.filter(
    (c) => c.group === 'plan_hypothetical' && dangerWords.some((w) => c.text.includes(w))
  ).length;
  if (planDanger < 2) errs.push(`plan_hypothetical 含危险词条数 ${planDanger} < 2`);

  const ongoingDanger = cases.filter((c) => c.group === 'ongoing' && c.expect.safety === true).length;
  if (ongoingDanger < 3) errs.push(`ongoing 组 safety:true 条数 ${ongoingDanger} < 3`);

  console.log(`\n== validate ${file} ==`);
  console.log(`总条数: ${cases.length}`);
  console.log('分组:', JSON.stringify(groups));
  console.log(`plan 含危险词: ${planDanger} 条（要求 ≥2）`);
  console.log(`ongoing 生命危险: ${ongoingDanger} 条（要求 ≥3）`);
  console.log(`debatable: ${cases.filter((c) => c.debatable).length} 条`);

  if (errs.length === 0) {
    console.log('\n结果: PASS（0 处违规）');
    return true;
  }
  console.log(`\n结果: FAIL（${errs.length} 处）`);
  for (const e of errs) console.log('  -', e);
  return false;
}

/* ---------------- overlap ---------------- */

function overlap(fileA, fileB) {
  const a = readCases(fileA);
  const b = readCases(fileB);
  const nb = b.map((c) => ({ id: c.id ?? '?', norm: normalize(c.text ?? c.question ?? '') }));

  let worst = 0;
  const rows = [];
  let over = 0;

  for (const ca of a) {
    const na = normalize(ca.text ?? '');
    let best = 0;
    let bestId = '-';
    for (const cb of nb) {
      const s = dice(na, cb.norm);
      if (s > best) {
        best = s;
        bestId = cb.id;
      }
    }
    if (best > THRESHOLD) over++;
    worst = Math.max(worst, best);
    rows.push({ id: ca.id, best, bestId, over: best > THRESHOLD });
  }

  console.log(`\n== overlap ${fileA} vs ${fileB}（阈值 ${THRESHOLD}）==`);
  for (const r of rows) {
    console.log(
      `${r.id}  max=${r.best.toFixed(3)}  ref=${r.bestId}${r.over ? '  <== 超阈值' : ''}`
    );
  }
  console.log(`\n最大重合: ${worst.toFixed(3)}`);
  console.log(`超阈值条数: ${over} / ${rows.length}`);
  return over === 0;
}

/* ---------------- main ---------------- */

let ok = true;
if (flag('validate')) ok = validate(pathA) && ok;
if (pathB) ok = overlap(pathA, pathB) && ok;

if (!flag('validate') && !pathB) {
  console.log('什么都没做：加 --validate 或 --b=<对照集>');
  process.exit(2);
}
process.exit(ok ? 0 : 1);
