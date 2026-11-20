# 评测口径（先看这张表，再引用任何准确率）

> 建立日：2026-11-20　｜　对应 `08 P29`
> **一句话：`run_eval --engine=llm` 测的是 `/judge`，`probe_loop` 测的是 `/act`；两者不是同一条路，数字不能互换、不能平均、不能只报一个。**

## 1. 脚本 → 路径 → 数字

| 脚本 | 实际路径 | 测什么 | 当前数字（2026-11-21） |
|---|---|---|---|
| `run_eval.mjs --engine=l3` | **离线检索/规则** | 断网兜底能力 | 61/100（emergency 40/40、prevention 3/30、off_scope 18/30） |
| `run_eval.mjs --engine=bm25` / `hybrid` | 离线检索 | 检索层对照 | 见脚本输出；不是产品在线成绩 |
| `run_eval.mjs --engine=llm` | **`/judge` 单次判定** | 模型给标签 → 代码映射动作 | **98/100 action**（意图 98、场景 97；安全项 0/0） |
| `probe_loop.mjs` | **`/act` 自主循环** | 模型选工具 + 前置条件门 + 完整循环 | **99/100**（P020 内容缺口） |
| `probe_multi_turn.mjs --mode=partition` | **`/act` 自主循环 + context** | 多轮/记忆 | **12/12** |
| `probe_heldout.mjs` | **`/act` 自主循环** | 留出集 | **39/42（33/35）**；**v2 已被 prompt 改动污染**，只能当回归参考 |
| `e2e_llm.mjs` | **产品主路径（`/act`）** | 真代理 + 真模型 + 渲染 | 51/51 断言（12 条输入） |

## 2. 引用规则

1. **报数字必须带路径**：写「`/act` 99/100」或「`/judge` 98/100」，不写「准确率 99%」。
2. **不能拿 `/act` 的数字证明 `/judge` 变好，反之亦然**。改了一份 prompt，另一条路的数字不动是正常的（`08 P29` 的原始症状）。
3. **96 是 M3 的联网验收基线**（`03` §6：联网态不得低于 M2.5），不是产品主路径的当前上限。
4. **99 是 `/act` 在 100 条开发集上的成绩**；这批题同时是开发集与测试集（`08 P17`），不能当泛化能力。
5. **留出集 v2 已污染**（`08 P22`）：P32/ack 的 prompt 改动之后，39/42 只能当回归参考；要对外报泛化，需另造新集。
6. 任何「全绿」都要能指出**投毒/反证**；没做过投毒的断言，等于没测（`docs/09`）。

## 3. 常用命令

```bash
# 离线兜底
node tools/eval/run_eval.mjs --engine=l3

# /judge 单次判定（需代理）
node tools/eval/run_eval.mjs --engine=llm

# /act 完整循环（需代理）
node tools/probe_loop.mjs

# 多轮 / 留出集（需代理）
node tools/probe_multi_turn.mjs --mode=partition --nocache
node tools/probe_heldout.mjs
```

## 4. 为什么没有 `run_eval --engine=act`

`probe_loop.mjs` 就是 `/act` 的完整评测；再给 `run_eval` 加一个 `--engine=act` 等于把同一套循环写两遍，违背「判据只能有一处实现」（`docs/03` §2.5.11 C1 的立场）。
**长期方向**（未做）：让两套 prompt 共用规则片段，或让 `run_eval` 输出一张「/judge vs /act」对照表；在此之前，用本文这张表防止混用。
