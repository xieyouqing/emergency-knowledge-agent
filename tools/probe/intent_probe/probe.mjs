/* =========================================================================
   离线意图判定探针（bge-small-zh-v1.5 int8）
   目的：回答三个问题，不改任何产品代码
     Q1 这个模型在本机能不能离线跑起来（零网络请求）
     Q2 用「产品数据当原型」能把 cases.json 的 100 条判对多少
     Q3 单句嵌入耗时多少（决定能否塞进 3 秒预算）

   ★ 方法论：零泄漏
     场景原型来自 knowledge/*.json（name/aliases/keywords/daily.summary）
     意图原型来自本文件手写的规范句（下面 INTENT_PROTOS 全数列出）
     cases.json 的 100 条 **只用于评测**，绝不参与构建原型。
     若用 cases 自身当原型再测 cases，就是最近邻自测，必然接近 100%，无意义。

   ★ 同时给一个上界（leave-one-out 最近邻），标注清楚它不可部署，
     只用来判断「模型本身有没有区分能力」——若连上界都低，换模型也没用。

   用法：node probe.mjs
   ========================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');

/* ---------- 意图原型：手写规范句，与评测集无关 ---------- */
const INTENT_PROTOS = {
  ongoing: [
    '我家现在正在发生危险，需要马上告诉我该怎么做',
    '已经出事了，火已经烧起来了，有人倒在地上了',
    '现在正在漏气、冒烟、流血，情况紧急',
    '刚刚发生了事故，人受伤了，怎么办'
  ],
  prevention: [
    '平时该怎么预防这类事情发生',
    '日常要注意什么，多久检查一次，要不要装报警器',
    '如何避免以后出这种事，有什么注意事项',
    '这个东西平时怎么保养、怎么维护'
  ],
  off_scope: [
    '跟紧急安全和疾病无关的日常问题',
    '煤气费怎么交，热水器怎么选，多少钱一方',
    '帮我写个东西，陪我聊聊天，讲个笑话',
    '今天天气怎么样，推荐一部电影'
  ]
};

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const cos = (a, b) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
};
const meanVec = (vs) => {
  const out = new Float32Array(vs[0].length);
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i];
  for (let i = 0; i < out.length; i++) out[i] /= vs.length;
  return l2(out);
};
const l2 = (v) => {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = v[i] / n;
  return o;
};

/* ---------- 加载模型 ---------- */
const t0 = Date.now();
const { pipeline, env } = await import('@huggingface/transformers');

env.allowRemoteModels = false;                       // 零网络
env.allowLocalModels = true;
env.localModelPath = path.join(HERE, 'models');
env.cacheDir = path.join(HERE, '.cache');

let extractor;
try {
  extractor = await pipeline('feature-extraction', 'bge-small-zh-v1.5', {
    dtype: 'q8',
    local_files_only: true
  });
} catch (e) {
  console.error('模型加载失败:', String(e && e.message || e).slice(0, 600));
  console.error('\n诊断：若报 onnxruntime 相关，说明 --ignore-scripts 跳过了原生二进制；');
  console.error('      可重跑 npm install（不加 --ignore-scripts）或改用 onnxruntime-web。');
  process.exit(1);
}
const loadMs = Date.now() - t0;

async function embed(texts) {
  const out = await extractor(texts, { pooling: 'mean', normalize: true });
  return out.tolist().map((row) => l2(Float32Array.from(row)));
}

/* ---------- 建原型 ---------- */
const slots = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'index.json'), 'utf8')).slots;

const sceneDocs = [];   // { id, text }
const sceneKinds = [];  // 区分「真条目」与「无内容槽位」
for (const s of slots) {
  const f = path.join(ROOT, 'knowledge', `${s.id}.json`);
  const has = fs.existsSync(f);
  const e = has ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  const parts = [s.name];
  if (e) {
    if (Array.isArray(e.aliases)) parts.push(e.aliases.join('、'));
    if (Array.isArray(e.keywords)) parts.push(e.keywords.join('、'));
    if (e.daily && e.daily.summary) parts.push(e.daily.summary);
  }
  sceneDocs.push({ id: s.id, text: parts.filter(Boolean).join('｜') });
  sceneKinds.push({ id: s.id, hasEntry: has && e && e.status === 'published' });
}

const intentIds = Object.keys(INTENT_PROTOS);
const [sceneVecs, intentVecs] = await Promise.all([
  embed(sceneDocs.map((d) => d.text)),
  (async () => {
    const r = {};
    for (const k of intentIds) r[k] = meanVec(await embed(INTENT_PROTOS[k]));
    return r;
  })()
]);

/* ---------- 评测集 ---------- */
const { cases } = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'eval', 'cases.json'), 'utf8'));

const caseVecs = await embed(cases.map((c) => c.text));

/* 意图三分类：取平均相似度最高的意图原型 */
function classifyIntent(v) {
  const scores = {};
  for (const k of intentIds) scores[k] = cos(v, intentVecs[k]);
  let best = null;
  for (const k of intentIds) if (!best || scores[k] > scores[best]) best = k;
  return { best, scores };
}

/* 场景：在 10 个槽位原型里取最高分 */
function classifyScene(v) {
  let bi = -1, bs = -2;
  for (let i = 0; i < sceneVecs.length; i++) {
    const s = cos(v, sceneVecs[i]);
    if (s > bs) { bs = s; bi = i; }
  }
  return { id: sceneDocs[bi].id, score: bs };
}

const CM = {};
for (const a of intentIds) { CM[a] = {}; for (const b of intentIds) CM[a][b] = 0; }
let intentHit = 0;
const perGroup = {};
const misses = [];

for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const v = caseVecs[i];
  const { best, scores } = classifyIntent(v);
  CM[c.expect_intent][best]++;
  if (best === c.expect_intent) intentHit++;
  const g = perGroup[c.group] || (perGroup[c.group] = { n: 0, hit: 0 });
  g.n++; if (best === c.expect_intent) g.hit++;
  if (best !== c.expect_intent) {
    misses.push({
      id: c.id, text: c.text, expect: c.expect_intent, got: best,
      s: Object.fromEntries(Object.entries(scores).map(([k, x]) => [k, +x.toFixed(3)]))
    });
  }
}

/* 场景准确率：只在 expect_scene 非空的样本上算 */
let sceneN = 0, sceneHit = 0;
const sceneMisses = [];
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  if (!c.expect_scene) continue;
  sceneN++;
  const r = classifyScene(caseVecs[i]);
  if (r.id === c.expect_scene) sceneHit++;
  else sceneMisses.push({ id: c.id, text: c.text, expect: c.expect_scene, got: r.id, score: +r.score.toFixed(3) });
}

/* ---------- 上界：leave-one-out 最近邻（不可部署，只测模型区分能力） ---------- */
let looHit = 0;
for (let i = 0; i < cases.length; i++) {
  let bi = -1, bs = -2;
  for (let j = 0; j < cases.length; j++) {
    if (i === j) continue;
    const s = cos(caseVecs[i], caseVecs[j]);
    if (s > bs) { bs = s; bi = j; }
  }
  if (cases[bi].expect_intent === cases[i].expect_intent) looHit++;
}

/* ---------- 延迟：单句 20 次取中位数 ---------- */
const lat = [];
for (let i = 0; i < 20; i++) {
  const t = Date.now();
  await embed([cases[i % cases.length].text]);
  lat.push(Date.now() - t);
}
lat.sort((a, b) => a - b);
const p50 = lat[Math.floor(lat.length / 2)];
const p95 = lat[Math.floor(lat.length * 0.95)] ?? lat[lat.length - 1];

/* ---------- 输出 ---------- */
const RULE_BASELINE = { ongoing: 40, prevention: 3, off_scope: 18 };

console.log('='.repeat(78));
console.log('离线意图判定探针 · bge-small-zh-v1.5 (q8 int8)');
console.log('='.repeat(78));
console.log(`模型加载耗时     ${loadMs} ms`);
console.log(`嵌入维度         ${sceneVecs[0].length}`);
console.log(`单句嵌入 p50/p95 ${p50} ms / ${p95} ms  (n=20, 不含首次)`);
console.log('');
console.log('--- Q2 意图三分类（零泄漏：原型来自手写规范句 + 知识库条目） ---');
console.log(`总准确率         ${intentHit}/${cases.length} = ${(intentHit / cases.length * 100).toFixed(1)}%`);
console.log(`规则基线(文档)   61/100 = 61.0%   [emergency40/40 + prevention3/30 + off_scope18/30]`);
const delta = intentHit - 61;
console.log(`对基线增益       ${delta >= 0 ? '+' : ''}${delta} 条`);
console.log('');
console.log('分组明细:');
for (const g of ['emergency', 'prevention', 'off_scope']) {
  const v = perGroup[g] || { n: 0, hit: 0 };
  const rb = g === 'emergency' ? RULE_BASELINE.ongoing : g === 'prevention' ? RULE_BASELINE.prevention : RULE_BASELINE.off_scope;
  console.log(`  ${g.padEnd(12)} ${String(v.hit).padStart(2)}/${v.n}   (规则基线 ${rb}/${v.n})`);
}
console.log('');
console.log('混淆矩阵（行=期望，列=预测）:');
const head = '      ' + intentIds.map((k) => k.padStart(12)).join('');
console.log(head);
for (const a of intentIds) {
  console.log('  ' + a.padEnd(4) + intentIds.map((b) => String(CM[a][b]).padStart(12)).join(''));
}
console.log('');
console.log(`--- 场景定位（10 槽位原型，仅 expect_scene 非空的 ${sceneN} 条） ---`);
console.log(`准确率           ${sceneHit}/${sceneN} = ${(sceneHit / sceneN * 100).toFixed(1)}%`);
console.log('');
console.log(`--- 上界参考（leave-one-out 最近邻，不可部署） ---`);
console.log(`上界准确率       ${looHit}/${cases.length} = ${(looHit / cases.length * 100).toFixed(1)}%`);
console.log('  ↑ 若上界很高而上面零泄漏准确率低，说明模型有区分力但原型不够好；');
console.log('    若上界也低，说明这个模型对中文短句区分力不足，换模型也没用。');
console.log('');

if (misses.length) {
  console.log(`--- 判错的 ${misses.length} 条（前 15） ---`);
  for (const m of misses.slice(0, 15)) {
    console.log(`  ${m.id} 「${m.text}」 期望 ${m.expect} → 判成 ${m.got}  ${JSON.stringify(m.s)}`);
  }
  console.log('');
}
if (sceneMisses.length) {
  console.log(`--- 场景判错（前 10） ---`);
  for (const m of sceneMisses.slice(0, 10)) {
    console.log(`  ${m.id} 「${m.text}」 期望 ${m.expect} → ${m.got} (${m.score})`);
  }
  console.log('');
}

console.log('--- 判据对照 ---');
const m1 = intentHit > 61;
const m2 = (perGroup.prevention?.hit || 0) >= 24;
const m3 = (perGroup.emergency?.hit || 0) >= 40;
console.log(`M1 准确率 > 规则基线 61%     ${intentHit}%  → ${m1 ? 'PASS' : 'FAIL'}`);
console.log(`M2 prevention ≥ 24/30       ${perGroup.prevention?.hit || 0}/30 → ${m2 ? 'PASS' : 'FAIL'}`);
console.log(`M3 emergency ≥ 40/40        ${perGroup.emergency?.hit || 0}/40 → ${m3 ? 'PASS' : 'FAIL'}`);
console.log('');
console.log(`结论：${m1 && m2 && m3 ? '三判据全过，模型可作为 L1 判定层' : '有不达标项，按 03 §5 只把模型用于达标的分支'}`);

fs.writeFileSync(path.join(HERE, 'probe-result.json'), JSON.stringify({
  at: new Date().toISOString(),
  loadMs, dim: sceneVecs[0].length, p50, p95,
  intent: { hit: intentHit, n: cases.length, cm: CM, perGroup },
  scene: { hit: sceneHit, n: sceneN },
  loo: { hit: looHit, n: cases.length },
  ruleBaseline: RULE_BASELINE,
  misses, sceneMisses,
  veredict: { m1, m2, m3 }
}, null, 1));
console.log(`\n完整结果已写入 ${path.join(HERE, 'probe-result.json')}`);
