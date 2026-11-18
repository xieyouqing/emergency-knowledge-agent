/**
 * 检索边界探测：把「字符匹配会在哪些句子上出错」跑成数据
 * 用法: node tools/probe_retrieval.mjs
 *
 * 这不是单元测试，是缺陷采样器。输出用于论证「为什么必须换语义判定」，
 * 以及换之前必须补哪些回归用例。断言式回归在 tools/selftest_m1.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const APP = path.join(process.cwd(), 'app');

/* 最小 DOM stub（与 selftest 同构） */
const store = new Map();
const mk = id => ({
  id, innerHTML: '', hidden: false, value: '', textContent: '',
  addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
  scrollIntoView() {}, getAttribute: () => null, setAttribute() {}, closest: () => null
});
const document = {
  getElementById: id => (store.has(id) || store.set(id, mk(id)), store.get(id)),
  querySelectorAll: () => [], addEventListener() {}
};
const window = { document, scrollTo() {} };
const sandbox = { window, document, console, Math, String, Number, Object, Array, JSON };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'knowledge.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'), sandbox);

const M = sandbox.window.__M1__;

/* 期望语义：emergency = 真在出事；daily = 问知识/预防；refuse = 库外无关 */
const CASES = [
  // ---- A 组：真紧急，应切紧急并出步骤卡 ----
  ['A', '煤气漏了', 'emergency'],
  ['A', '着火了快跑', 'emergency'],
  ['A', '我妈摔倒了起不来', 'emergency'],
  ['A', '被困在电梯里了', 'emergency'],

  // ---- B 组：预防/知识咨询，应走日常，不应切紧急 ----
  ['B', '怎么预防煤气泄漏', 'daily'],
  ['B', '如何避免老人跌倒', 'daily'],
  ['B', '烫伤要怎么预防', 'daily'],
  ['B', '家里要不要装燃气报警器', 'daily'],

  // ---- C 组：含场景词但语义无关，应拒答 ----
  ['C', '煤气费怎么交', 'refuse'],
  ['C', '燃气热水器怎么选', 'refuse'],
  ['C', '电梯广告怎么投诉', 'refuse'],
  ['C', '电梯里遇到邻居怎么打招呼', 'refuse'],
  ['C', '地震保险怎么买', 'refuse'],
  ['C', '烫伤疤痕怎么去除', 'refuse'],
  ['C', '老人跌倒保险怎么理赔', 'refuse'],
  ['C', '汽车打不着火', 'refuse'],
];

/* 判定实际行为：danger 命中即视为 emergency 路径 */
function actual(text) {
  const r = M.routeOf(text);
  if (r.dangerId) return r.entryId ? 'emergency' : 'emergency-dialonly';
  if (r.entryId) return 'daily-hit';
  return 'refuse';
}

const rows = [];
for (const [group, text, expect] of CASES) {
  const act = actual(text);
  const r = M.routeOf(text);
  let verdict;
  if (expect === 'emergency') verdict = act.startsWith('emergency') ? 'OK' : 'MISS';
  else if (expect === 'daily') verdict = (act === 'daily-hit') ? 'OK' : 'OVER-TRIGGER';
  else verdict = (act === 'refuse') ? 'OK' : 'FALSE-HIT';
  rows.push({ group, text, expect, act, danger: r.dangerId, entry: r.entryId, verdict });
}

const pad = (s, n) => {
  let w = 0;
  for (const ch of String(s)) w += /[\u4e00-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(1, n - w));
};

console.log(pad('组', 4) + pad('输入', 28) + pad('期望', 12) + pad('实际', 20) + pad('danger', 18) + '判定');
console.log('─'.repeat(96));
for (const r of rows) {
  console.log(
    pad(r.group, 4) + pad(r.text, 28) + pad(r.expect, 12) +
    pad(r.act, 20) + pad(r.danger || '-', 18) + r.verdict
  );
}

const byGroup = {};
for (const r of rows) {
  byGroup[r.group] ||= { ok: 0, bad: 0 };
  if (r.verdict === 'OK') byGroup[r.group].ok++; else byGroup[r.group].bad++;
}

console.log('─'.repeat(96));
for (const g of ['A', 'B', 'C']) {
  const s = byGroup[g] || { ok: 0, bad: 0 };
  const label = { A: '真紧急', B: '预防咨询', C: '含词无关' }[g];
  console.log(`${g} 组（${label}）: 正确 ${s.ok} / 错误 ${s.bad}`);
}
const totalBad = rows.filter(r => r.verdict !== 'OK').length;
console.log(`\n合计 ${rows.length} 条，错误 ${totalBad} 条，准确率 ${((rows.length - totalBad) / rows.length * 100).toFixed(1)}%`);
