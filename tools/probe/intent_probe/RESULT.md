# 离线意图判定探针 · 实测结果

> 执行时间：2026-11-19 19:0x–19:3x　｜　执行人：Hermes（受用户指令「先跑探针」）
> 目的：回答「内置一个小模型来判意图/场景」是否成立，给出可复核数字，不改产品代码。
> 本文件只记**跑过什么、输出是什么**，不写「效果不错」这类结论。

---

## 1. 环境

| 项 | 值 |
|---|---|
| 运行环境 | Chrome（headless 可复现），onnxruntime-web WASM，单线程 |
| 模型 | `Xenova/bge-small-zh-v1.5` 的 `onnx/model_quantized.onnx`（q8 int8） |
| 模型体积 | **24,010,842 B ≈ 22.9 MiB**（实测下载后 `stat` 值） |
| 模型来源 | `hf-mirror.com`（**主站 huggingface.co 在本机不可达**：12s 超时，curl 返回 000；镜像 200 / 0.8s） |
| 嵌入维度 | 512 |
| 网络 | 全程 `env.allowRemoteModels = false`，模型与 WASM 全部本地文件 |
| 评测集 | `tools/eval/cases.json` 100 条（emergency 40 / prevention 30 / off_scope 30） |

## 2. 方法（为什么这个数字可信）

**零泄漏**：场景原型来自 `knowledge/*.json`（name / aliases / keywords / daily.summary）与 `index.json`；
意图原型来自**手写规范句**（逐条列在 `probe-page3.html` 的 `PROTO` 常量里），不复用评测集原句。
评测集 100 条**只用于打分**，不参与构建任何原型。

**同时给上界**：leave-one-out 最近邻（用其它 99 条做邻居）——这是「不可部署的上界」，只用于判断
「模型本身有没有区分能力」。若上界也低，换模型也没用。

**迭代过三轮，前两轮失败的原因都留在这里**（避免后来人重踩）：

| 轮次 | 原型设计 | 结果 | 失败原因 |
|---|---|---|---|
| V1 | 4 条抽象元语句/类 | 总 71%，但 **emergency 只剩 26/40** | 原型是「我家现在正在发生危险」这类元陈述，与真实口语距离远，三类分数全挤在 0.45–0.60 |
| V2 | 由知识库条目衍生（steps / daily.prevention） | 总 64%，**prevention 30/30 但 off_scope 0/30** | 原型条数严重失衡（11/11/1），只要有领域词就判 prevention；原型配比而不是模型决定结果 |
| V3 | **三类各 8 条平衡原型** | 见下 | — |

## 3. 结果（V3）

### 3.1 单句嵌入性能

| 指标 | 实测 |
|---|---|
| 模型加载（冷，首次） | 1377 ms |
| 模型加载（热，二次进入） | 536 ms |
| 单句嵌入 p50 | **21 ms** |
| 单句嵌入 p95 | **35 ms** |

> 结论：延迟不是瓶颈。3 秒预算里占 1% 量级。加载 0.5–1.4s 可以放进「首屏立即可用、模型后台接管」的分段里。

### 3.2 意图三分类（三种打分方式，100 条）

| 方案 | 总准确 | emergency | prevention | off_scope |
|---|---|---|---|---|
| 规则基线（文档记录） | 61/100 = 61% | 40/40 | 3/30 | 18/30 |
| 模型 max 相似度 | 73/100 = 73% | 37/40 | 20/30 | 16/30 |
| 模型类中心 centroid | **82/100 = 82%** | 30/40 | **29/30** | **23/30** |
| **类中心 + 规则兜底（推荐）** | **85/100 = 85%** | **40/40** | 25/30 | 20/30 |

**推荐配置的判据**：`规则命中 且 模型非 ongoing 且 top1−top2 < 0.045 → 强制 ongoing`。
即「模型拿不准、规则又命中危险词时，按紧急处理」，安全优先。

### 3.3 推荐配置的混淆矩阵

```
           ongoing  prevention   off_scope
  ongoing        40           0           0
  prevention      4          25           1
  off_scope       5           5          20
```

**代价必须写明**：这条兜底改了 18 条，其中 10 条改对（救回紧急）、8 条改错（把预防/无关判成紧急）。
净 +3 条。之所以接受，是因为两类错的代价不对称——漏掉紧急可能致伤，把预防判成紧急只是多给一段步骤。

### 3.4 阈值敏感性（用于说明 0.045 不是随手取的）

| 阈值 | 总准确 | emergency |
|---|---|---|
| 0（不兜底） | 82% | 30/40 |
| 0.02 | 87% | 36/40 |
| 0.03 | 89% | 38/40 |
| 0.04 | 88% | 39/40 |
| **0.045** | **85%** | **40/40** |
| 0.06 | 80% | 40/40 |

**0.045 是「emergency 恰好回到 40/40」的最小阈值。** 低于它省下的准确率是拿紧急召回换的，不接受。

### 3.5 场景定位（70 条，expect_scene 非空）

| 方案 | 准确率 | 说明 |
|---|---|---|
| 现字符规则 `RETRIEVAL.rankByRules` | 54/70 = **77.1%** | 14 条完全无命中（返回空） |
| **模型原型方案** | 65/70 = **92.9%** | +11 条 |

字符规则的 14 条零命中示例：`厨房有股臭鸡蛋味`、`我妈在卫生间摔了`、`锅烧起来了`、`有人落水了`、`烟感器有用吗`。
模型判错的 5 条：`锅烧起来了`→scald_burn、`家里地面怎么防滑`→earthquake、`烟感器有用吗`→co_poisoning、
`炭火取暖要注意什么`→fire_home、`插座要不要装保护盖`→elevator_trapped。

### 3.6 规则闸实测（顺手核对了文档里的数）

| 组 | `detectDanger` 命中 |
|---|---|
| emergency | **40/40**（与文档一致） |
| prevention | 20/30（这些是「怎么预防煤气泄漏」被切紧急的来源） |
| off_scope | 11/30（「煤气费怎么交」这类假命中） |

## 4. 不成立/未验证的部分（不许当结论用）

| # | 项 | 状态 |
|---|---|---|
| L1 | 阈值 0.045 是在**这 100 条同一批**上选的，存在过拟合 | **需第二批样本**（`08` P9 的 20 条「单次判定拿不准」）验证，否则不得写进基线 |
| L2 | 只测了 Chrome + WASM 单线程 | **WebView2（Tauri）/ Android WebView 未测**，打包后可能不同 |
| L3 | 内存占用未测 | 24MB 模型 + WASM 运行时的峰值内存没量 |
| L4 | 100 条只有 733 字 | 平均句长 7.3 字，短句是这类模型最难的情形；长句口语表现未测 |
| L5 | 原型是我手写并**知道评测集话题** | 原型句与评测句不重复，但话题覆盖受此影响；第三方独立写原型可能不同 |

## 5. 复现命令

```bash
# 1. 依赖（仅探针目录，不动根 package.json）
cd tools/probe/intent_probe
npm install @huggingface/transformers@3.7.0 --ignore-scripts --no-audit --no-fund

# 2. 模型（主站不通，走镜像）
B=https://hf-mirror.com/Xenova/bge-small-zh-v1.5/resolve/main
mkdir -p models/bge-small-zh-v1.5/onnx
for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json; do
  curl -sSL -o models/bge-small-zh-v1.5/$f $B/$f
done
curl -sSL -o models/bge-small-zh-v1.5/onnx/model_quantized.onnx $B/onnx/model_quantized.onnx

# 3. 起静态服务（仓库根，端口任意）
cd ../../.. && python3 -m http.server 8911 --bind 127.0.0.1

# 4. 打开 http://127.0.0.1:8911/tools/probe/intent_probe/probe-page3.html
#    结果渲染在页面上；window.__RESULT.rows 含逐条分数
```

## 6. 文件清单

| 文件 | 作用 |
|---|---|
| `probe.mjs` | Node 版（未跑通：`--ignore-scripts` 缺 onnxruntime-node 原生二进制；浏览器版已替代它） |
| `probe-page.html` | V1：抽象原型，记录基线 |
| `probe-page2.html` | V2：条目衍生原型，记录失败原因 |
| `probe-page3.html` | **V3：平衡原型 + 拒判阈值 + 规则闸，最终结果** |
| `models/` | 模型文件（22.9 MB，**已 gitignore，不进仓库**） |
