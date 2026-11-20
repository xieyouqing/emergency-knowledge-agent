#!/usr/bin/env node
/**
 * P5 离线判据：校验 probe_p5_expand 生成的一批解释。
 *
 * 判据来源：tools/p5_core.mjs（与 /expand 代理共用一份实现）。
 * 与 S7 四码的区别（必须写清）：
 *   S7 B/C 是为「带 actions 的模型输出」设计的；纯解释文本里的普通动词
 *   （“热烟往上跑”“通过”）会被 B 误杀。P5 用独立判据：
 *   ① 动作只能来自 daily.prevention[i] 且逐字；
 *   ② 正文不得出现未声明的指令/具体动作；
 *   ③ 非空、≤160 字。
 *   不判事实正确性 —— 机器判不了。
 *
 * 用法: node tools/check_p5.mjs [--file=tools/eval/p5_expand_output.json]
 * 退出码: 0 = 全部通过；1 = 有不合格项
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateP5 } from './p5_core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const fileArg = argv.find((a) => a.startsWith('--file='));
const FILE = fileArg
  ? path.resolve(ROOT, fileArg.split('=').slice(1).join('='))
  : path.join(ROOT, 'tools', 'eval', 'p5_expand_output.json');

function loadEntries() {
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'index.json'), 'utf8'));
  const out = {};
  for (const slot of index.slots) {
    const p = path.join(ROOT, 'knowledge', `${slot.id}.json`);
    if (!fs.existsSync(p)) continue;
    const e = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (e.status === 'published') out[slot.id] = e;
  }
  return out;
}

if (!fs.existsSync(FILE)) {
  console.error(`FAIL: 找不到 ${FILE}（先跑 node tools/probe_p5_expand.mjs）`);
  process.exit(1);
}
const entries = loadEntries();
const rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let pass = 0;
const fails = [];

for (const r of rows) {
  const entry = entries[r.scene];
  if (!entry) {
    fails.push(`${r.id}: 场景 ${r.scene} 未发布`);
    continue;
  }
  const out = r.model_output || {};
  const res = validateP5(entry, out.text, out.actions);
  if (res.ok) pass++;
  else fails.push(`${r.id}: ${res.findings.join(', ')}`);
}

console.log(`P5 判据：${rows.length} 条，通过 ${pass}，失败 ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
