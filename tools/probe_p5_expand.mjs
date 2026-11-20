#!/usr/bin/env node
/**
 * P5 第一刀探针：用真实模型跑 /expand，产出 S7 可扫描的模型输出。
 *
 * 当前 P5 范围（刻意收窄）：
 *   只生成「解释」，不生成任何操作动作；正文出现动作动词直接判失败。
 *   所以 model_output.actions = []，needAction = false。
 *
 * 产物：tools/eval/p5_expand_output.json（只含 ok 的输出）
 * 用法：node tools/probe_p5_expand.mjs
 * 前置：node tools/llm_proxy.mjs 已启动
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROXY = 'http://127.0.0.1:8787';
const OUT = path.join(ROOT, 'tools', 'eval', 'p5_expand_output.json');

try {
  const h = await fetch(`${PROXY}/health`, { signal: AbortSignal.timeout(3000) });
  if (!h.ok) throw new Error('health 非 200');
} catch {
  console.error(`FAIL: 连不上代理 ${PROXY}（先跑 node tools/llm_proxy.mjs）`);
  process.exit(1);
}

const cases = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tools', 'eval', 'cases_s7.json'), 'utf8')
).cases;
/* 只跑已发布场景：S7 集里有未来 CPR 场景（cpr），/expand 现在没有条目。 */
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'index.json'), 'utf8'));
const ready = new Set(index.slots.filter((s) => s.state === 'ready').map((s) => s.id));

const outputs = [];
const failures = [];
const skipped = [];
console.log(`=== P5 /expand：${cases.length} 条 ===\n`);

for (const c of cases) {
  if (!ready.has(c.scene)) {
    skipped.push({ id: c.id, scene: c.scene });
    console.log(`  - ${c.id}  跳过（场景 ${c.scene} 未发布）`);
    continue;
  }
  let r = null;
  try {
    const res = await fetch(`${PROXY}/expand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: c.question,
        scene: c.scene,
        nocache: true,
        trace: `p5-${c.id}`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    r = await res.json();
  } catch (e) {
    r = { ok: false, reason: `request-error:${String(e.message || e)}` };
  }

  if (r && r.ok && r.text) {
    outputs.push({
      id: c.id,
      scene: c.scene,
      intent: c.intent || 'prevention',
      model_output: {
        text: r.text,
        actions: Array.isArray(r.actions) ? r.actions : [],
        needAction: r.needAction === true,
      },
    });
    console.log(`  ✓ ${c.id}  ${String(r.text).slice(0, 42)}…`);
  } else {
    failures.push({ id: c.id, reason: (r && r.reason) || 'unknown' });
    console.log(`  ✗ ${c.id}  ${(r && r.reason) || 'unknown'}`);
  }
}

fs.writeFileSync(OUT, JSON.stringify(outputs, null, 2) + '\n', 'utf8');
console.log(
  `\n生成成功 ${outputs.length}/${cases.length - skipped.length}；失败 ${failures.length}；跳过 ${skipped.length}`
);
if (failures.length) {
  console.log('失败明细:');
  for (const f of failures) console.log(`  - ${f.id}: ${f.reason}`);
}
console.log(`\n产物: ${path.relative(ROOT, OUT)}`);
console.log('下一步: node tools/check_s7_suite.mjs --scan=' + path.relative(ROOT, OUT));

process.exitCode = failures.length ? 1 : 0;
