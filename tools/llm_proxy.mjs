#!/usr/bin/env node
/**
 * LLM 意图判定代理（本地开发用）
 *
 * 为什么要有这个代理，而不是前端直调：
 *   API key 一旦写进 app/*.js，任何人按 F12 就能拿到并盗用。
 *   这不是取舍，是硬约束。见 docs/03 §2.4。
 *
 * 用法:
 *   node tools/llm_proxy.mjs            # 默认 127.0.0.1:8787
 *   PORT=9000 node tools/llm_proxy.mjs
 *
 * 端点:
 *   GET  /health   → {ok, model, key_present}
 *   POST /judge    → body {text}  → {intent, scene, confidence, latency_ms, cached}
 *   POST /asr      → body = 原始 WAV 二进制 → {text, duration_ms, latency_ms}
 *   POST /log      → body {records:[...]} → 追加写 logs/app-YYYY-MM-DD.log（前端日志落盘）
 *   POST /shutdown → 便于脚本收尾（仅本地回环可用）
 *
 * 设计要点（都是踩过坑才加的）:
 *   1. 只监听 127.0.0.1，不监听 0.0.0.0 —— 否则同网段任何人都能用你的 key。
 *   2. CORS 来源由 LLM_PROXY_ORIGIN 控制，**不设时默认 `*`**（本地开发方便，
 *      因为只监听回环地址，外部访问不到）。**一旦部署到公网，必须显式设成
 *      具体来源**，否则任何网页都能拿你的代理当免费 API 用。
 *      ⚠️ 2026-11-19 修正：这里原写「只允许 HTTP_PROXY_ORIGIN 指定的来源，不用 *」，
 *      有两处不符 —— 变量名实际是 LLM_PROXY_ORIGIN（见下文 151 行），
 *      且默认值确实是 `*`（实测 `OPTIONS` 对任意 Origin 都回 `*`）。
 *      注释写错了比没有注释更糟：照它配环境变量会静默无效。
 *   3. 校验 LLM 返回的 scene 必须在已知场景 id 内，否则置 null。
 *      模型编一个 "fire" 出来，前端拿不到条目就会静默变成拒答——宁可显式置 null。
 *   4. 结果按 text 做内存缓存，评测时同一句只花一次钱。
 *   5. 不把 key 打印到任何日志或响应里。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pickProvider, listProviders, DEFAULT_PROVIDER } from './asr/index.mjs';
/* P5 判据唯一实现：与 tools/check_p5.mjs 共用。 */
import { validateP5 } from './p5_core.mjs';

/* 用 fileURLToPath 而不是手拼 URL 路径：
   路径含中文时，`new URL().pathname` 返回的是百分号编码串
   （D:/WorkBuddy/%E9%BB%91...），直接拼会 ENOENT。这是踩过的坑。 */
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- 日志落盘（前端 POST /log 的目标） ----------
   为什么由代理写：浏览器 JS 没有文件写权限。前端只负责攒批 + POST，
   写盘、切分、清理都在这里做。

   三条纪律：
     1. **再脱敏一次。** 不信任前端已经脱过——key 泄露是不可逆的。
     2. 单文件超 5MB 切分，保留 7 天。日志是排查工具，不是数据资产。
     3. 写盘失败只 console.error，不回 5xx 重压前端。日志坏了不能影响产品。 */
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_KEEP_DAYS = 7;

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9_.-]{8,}/gi,
  /(["']?(?:api[_-]?key|apikey|secret|token|password)["']?\s*[:=]\s*["']?)[^\s'",}]{6,}/gi,
];

function scrubText(s) {
  let out = String(s ?? '');
  for (const re of SECRET_PATTERNS)
    out = out.replace(re, (m, p1) =>
      // 无捕获组的正则，p1 拿到的是「偏移量数字」而不是分组文本。
      // 必须判类型，否则会把偏移量拼进日志（实测踩过：sk-xxx 被替换成 "92***"）。
      typeof p1 === 'string' && p1 ? p1 + '***' : '***'
    );
  return out;
}

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    return true;
  } catch (e) {
    console.error('日志目录创建失败:', e.message);
    return false;
  }
}

function logFileFor(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  let base = path.join(LOG_DIR, `app-${y}-${m}-${day}.log`);
  // 超过上限就换序号文件
  try {
    if (fs.existsSync(base) && fs.statSync(base).size > LOG_MAX_BYTES) {
      let i = 1;
      while (fs.existsSync(`${base}.${i}`) && fs.statSync(`${base}.${i}`).size > LOG_MAX_BYTES) i++;
      base = `${base}.${i}`;
    }
  } catch (e) {
    /* 统计失败就照原文件写 */
  }
  return base;
}

function appendLogs(records) {
  if (!ensureLogDir()) return 0;
  const lines = [];
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    let line;
    try {
      line = JSON.stringify(r);
    } catch {
      continue;
    }
    lines.push(scrubText(line));
  }
  if (!lines.length) return 0;
  try {
    fs.appendFileSync(logFileFor(), lines.join('\n') + '\n', 'utf8');
    return lines.length;
  } catch (e) {
    console.error('日志写盘失败:', e.message);
    return 0;
  }
}

function pruneLogs() {
  try {
    if (!fs.existsSync(LOG_DIR)) return;
    const cutoff = Date.now() - LOG_KEEP_DAYS * 864e5;
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!/^app-\d{4}-\d{2}-\d{2}\.log(\.\d+)?$/.test(f)) continue;
      const p = path.join(LOG_DIR, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch (e) {
    console.error('日志清理失败:', e.message);
  }
}

/* ---------- 读 .env（零依赖，不引 dotenv） ---------- */
function loadEnv() {
  const p = path.join(ROOT, '.env');
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };
const API_KEY = env.DEEPSEEK_API_KEY || '';
const BASE_URL = (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = env.DEEPSEEK_MODEL || 'deepseek-chat';
const PORT = Number(env.LLM_PROXY_PORT || 8787);
const HOST = '127.0.0.1'; // 绝不监听 0.0.0.0
const ALLOW_ORIGIN = env.LLM_PROXY_ORIGIN || '*'; // 本地开发可放宽；部署时必须收紧

if (!API_KEY) {
  console.error('FAIL: .env 里没有 DEEPSEEK_API_KEY');
  process.exit(1);
}
if (!API_KEY.startsWith('sk-')) {
  console.error('FAIL: key 格式不对。DeepSeek 的 key 以 "sk-" 开头，');
  console.error('      如果你手里的 key 带 "deepseek" 前缀，那个前缀要去掉。');
  process.exit(1);
}

/* ---------- 场景白名单：从 index.json 读，不硬编码 ---------- */
const INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'index.json'), 'utf8'));
const SCENE_IDS = INDEX.slots.map((s) => s.id);
const READY_IDS = INDEX.slots.filter((s) => s.state === 'ready').map((s) => s.id);

/* P5 扩写要读条目字段。只加载已发布条目，与前端产物同口径。
   为什么在代理侧加载而不是让前端把条目传上来：
     ① 条目是公开静态数据，但「哪些字段可以被扩写」必须由服务端说了算；
     ② 前端传上来的字段一旦被改，S7 的 src 校验就失去意义。 */
const ENTRIES = {};
for (const slot of INDEX.slots) {
  const p = path.join(ROOT, 'knowledge', `${slot.id}.json`);
  if (!fs.existsSync(p)) continue;
  try {
    const e = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (e.status === 'published') ENTRIES[slot.id] = e;
  } catch {
    /* 坏条目由 validate_knowledge 负责；这里不让代理启动失败 */
  }
}

/* =========================================================
   /act 端点：让模型直接输出工具调用（docs/03 §2.5.12 D-12）
   与 /judge 的分工：
     /judge  = 「这是什么意图」（标签），路由由前端代码定
     /act    = 「下一步调哪个工具」（动作），循环由前端调度器执行

   为什么单独一个端点而不是扩 /judge：
     两者的输出契约、prompt、缓存键都不同；混在一个端点里，
     任何一方改 prompt 都会污染另一方的评测基线（03 §6 要求对照组稳定）。

   ★ 只允许输出一个动作，参数必须能用 JSON 表示。
     本端点**不判断动作是否合法**（白名单、前置条件），那归前端 tools.js 的 checkGate。
     理由：门的实现只能有一处，否则「测的」与「用的」会分叉（踩过这个坑）。
   ========================================================= */
const TOOL_SCHEMA = [
  {
    name: 'lookup_scene',
    need: 'scene',
    desc: '查这个场景有没有已发布条目。出任何内容前必须先调它一次',
    args: { scene: `<${SCENE_IDS.join('|')}>` },
  },
  {
    name: 'ask',
    need: 'scene,options',
    desc: '二选一追问，等用户点选。只在场景已确定、意图拿不准时用',
    args: { scene: '<场景id>', options: '["选项1","选项2"]（必须 2 个，每个 ≤12 字）' },
  },
  {
    name: 'get_steps',
    need: 'scene',
    desc: '出三段式急救步骤卡。只能用于「正在发生」或用户点图标',
    args: { scene: '<场景id>' },
  },
  {
    name: 'get_daily',
    need: 'scene',
    desc: '出日常解释卡。用于「怎么预防」「要不要装」这类知识性问题',
    args: { scene: '<场景id>' },
  },
  {
    name: 'triage',
    need: 'scene',
    desc: '出分诊卡。条目自带分诊问题时用它，比直接给步骤更安全',
    args: { scene: '<场景id>' },
  },
  {
    name: 'speak',
    need: 'entry_id,segment',
    desc: '朗读某个条目的指定段落。只能念条目字段，不能念自由文本',
    args: { entry_id: '<场景id>', segment: 'immediate|next|never|daily|triage' },
  },
  {
    name: 'dial',
    need: 'number',
    desc: '出拨号按钮卡。库内没有对应条目、或判断不了时用（不代为拨出）',
    args: { number: '120|119（只能用这两个）' },
  },
  {
    name: 'ack',
    need: '',
    desc: '用户明确说危险已解除（已脱困/门开了/火灭了/人没事了）时确认；只给观察提示，不出步骤',
    args: {},
  },
  {
    name: 'refuse',
    need: 'reason',
    desc: '拒答。与应急急救无关、或信息不足无法判断时用',
    args: { reason: '简短英文标识，如 off-topic / unclear' },
  },
];

const ACT_PROMPT = `你是应急问答系统的工具调度器。只输出 JSON，不解释、不加代码块。

可选场景 id（只能用这些，不许自造）：
${SCENE_IDS.join(', ')}

可用工具（每次只选一个）：
${TOOL_SCHEMA.map((t) => `- ${t.name}(${Object.keys(t.args).join(', ')})：${t.desc}`).join('\n')}

硬规则（违反即视为错误）：
1. 调用 get_steps / get_daily / triage / speak 之前，history 里必须已经有同场景的 lookup_scene 且其 found=true。
   没有就**先输出 lookup_scene**，不要直接出内容。
2. 只有「危险正在发生」才出 get_steps。问预防、问要不要做、问频次，或描述尚未发生 / 已结束的情形，
   一律出 get_daily。是现场还是预案由 turn 判断，不要靠句子里有没有某个词来硬套。
3. 与应急急救无关（缴费、投诉、价格、理赔、广告、邻里关系）一律 refuse。
   选购类要分两种：**买错或没装会直接导致防护失效、进而伤人的**（燃气报警器、烟感器、
   一氧化碳报警器、灭火器、防滑垫、扶手、插座保护盖、漏电保护器、防坠网）→ get_daily；
   **买错只影响价格、舒适或效果的** → refuse。
   设备的使用参数如果**会直接影响人身安全**（如热水器温度、取暖温度）→ get_daily；
   纯购买、价格、维修 → refuse。
4. 场景拿不准就给 refuse，不要猜一个相近的场景。
5. 已经拿到结果就停止，不要重复查同一个场景。
   **同一 scene 只需查一次：found=true 就是最终结果**；用户换了描述对象不改变库内有没有这个条目。
6. **紧急场景一律不许用 ask 追问，直接出内容或拨号。**
   用户加「不知道是不是」「好像是」「可能」这类不确定词，**不改变判定** ——
   他只是不能确认，不是没有征兆。
   **为什么紧急不许问**：紧急链路每问一句，用户要多等约 1 秒且可能根本不回答
   （手在抖、人已昏迷、在跑）。宁可给一个覆盖更坏情况的步骤，也不要停下来问。
   ⚠️ 器具本身故障、但没有泄漏 / 异味 / 异响 / 烟等任何现场信号时（如打不着火），
   属家用设备报修，不是急救，应 refuse。本产品不做「先确认再决定管不管」的追问。
7. **先按用户明确说出的状态选条目，不许推测；本库没有的才 dial。**
   · 明确说「没有呼吸 / 无呼吸 / 呼吸停止 / 心跳停止 / 没有脉搏」→ cpr（先 lookup 再 get_steps）。
   · 明确说「大出血 / 流血不止 / 止不住血」→ severe_bleeding。
   · 明确说卒中表现（嘴歪眼斜、半身不遂）→ stroke。
   · **溺水 / 落水 / 掉水里**：即使没有呼吸，也用 **drowning** 条目（先清理口鼻、开放气道、吹 2-5 口气，再按压），
     不要套用成人 cpr 条目。
   · **例外（只针对 CPR）**：婴儿 / 宝宝 / 新生儿 / 幼儿 / 儿童 / 小孩 / 孩子，
     即使没有呼吸，也**直接 dial 120**；本库没有儿科 CPR，不得套用成人手法。
     **这条例外不许扩大**：儿童跌倒、烫伤、噎食等仍走对应条目（如 fall_elderly 分诊），不要一律拨号。
   · **例外二：少量出血、划破皮、能自行止住的血不是大出血**，不要用 severe_bleeding。
   · **叫不醒但还有呼吸 / 有呼吸但没反应**：本库没有对应条目，直接 dial 120；
     不得用 cpr，也不得走 fall_elderly 分诊。
   · 昏迷不醒、抽搐不止：未覆盖，直接 dial 120。
   为什么不能猜：fall_elderly 首屏会问「现在能自己试着动一动胳膊腿吗？」——
   对一个已经没呼吸的人问这句是致命的。给不出的内容宁可不给。
   注意：airway_obstruction 只讲噎食（海姆立克），**不是 CPR**，不要拿它顶替。
   ⚠️ **触发条件必须由用户明说。** 只说「倒了 / 摔了 / 跌了一跤」、没提呼吸和意识时，
   不要假设最坏情况，按常规出 triage 或 get_steps（fall_elderly 的分诊会问能不能动，
   这对清醒的摔伤者是合适的）。判断依据是「用户说了什么」，不是「可能会怎样」。
8. **用户明确说危险已经解除（已脱困 / 门开了 / 火灭了 / 人没事了 / 已经不漏了）时，用 ack**，
   不要再出 get_steps。ack 只给确认与观察提示，不出步骤；它不是拒答，也不等于「不关心」。
   注意：只有**用户明确说解除**才算；不确定的话仍按现场处置。
   **更正原因不等于解除** —— 按更正后的情况重新判断，与应急无关就 refuse，不要用 ack。

turn 是什么（只判这一件事，不写案例）：
- ongoing：用户报告**当前正在发生**的感官或身体事实
- plan：假设、预防、知识性，描述**尚未发生或已结束**的事
- off_scope：与应急急救无关
turn 与 act 必须一致：turn=plan 时不许 get_steps / triage / dial；
turn=off_scope 时只能 refuse。
evidence：用户原话里支持 turn 的片段，**不得为空**。

输出格式（严格）：
{"turn":"ongoing|plan|off_scope","evidence":"<用户原话片段>","act":"<工具名>","args":{...},"reason":"<一句话，为什么选它>","note":"<一句话解释，可空>"}

note 是什么（只影响卡片上多不多一行字，**不参与你是否回答的决策**）：
· 当用户**一句话里说了两件互不相干的事**时，note 填一句给用户看的解释，
  说清你先办哪件、另一件稍后；其余情况（包括你决定 refuse 时）一律填 ""。
· note 为空只表示「不需要多解释一句」，**绝不表示这件事不该回答**。
· note 会原样显示给用户，所以：人话、≤25 字、**不得含任何具体操作动作**。
  操作只能来自知识库 steps，模型写了就是自造动作（违反 S1/S7）。
· reason 仍是给开发看的技术说明，措辞不用改。两者用途不同，不要互相抄。

`;

/* 缓存键必须与 /judge 分开：同一句话在两套 prompt 下结论不同 */
const actCache = new Map();
/* 缓存上限。满时不全清（那会让已稳定的答案重新摇），改为淘汰最旧 1/8。
   800 的依据：100 条评测集 × 最多 6 步 ≈ 600 个键，留 200 余量。 */
const ACT_CACHE_MAX = 800;

const SYSTEM_PROMPT = `你是应急问答系统的意图分类器。只输出 JSON，不解释、不加代码块。

可选场景 id（只能用这些，不许自造）：
${SCENE_IDS.join(', ')}

对用户输入判定三件事：
1. intent
   - ongoing    = 当前正在发生的危险或行动需求
   - prevention = 预防、日常注意事项、知识性疑问
   - off_scope  = 与应急急救无关
2. scene：命中的场景 id；off_scope 或无法归属时必须为 null
3. confidence：0.0-1.0

判定要点：
- 判断依据是「用户此刻是否在描述正在发生的事」，不是关键词
- 问「怎么用、有没有用、会怎么样、多久一次、参数设多少」这类知识或预防问题，属 prevention
- 问「买哪种、怎么选、价格、维修」属 off_scope；**安全防护设备除外**（买错或没装会直接导致防护失效）
- 安全防护设备的选购按 prevention；纯消费品选购按 off_scope。
  原则：**买错或没装会直接导致防护失效、进而伤人**的属前者
- 只在真的正在出事时给 ongoing
- 宁可 scene 为 null，也不要猜一个相近的场景

turn 是同一件事的另一层标签（不另举例）：
- ongoing：当前正在发生
- plan：假设/预防/尚未发生或已结束
- off_scope：与应急急救无关
evidence：用户原话里支持 turn 的片段，不得为空。

输出格式（严格）：
{"intent":"ongoing|prevention|off_scope","turn":"ongoing|plan|off_scope","evidence":"<用户原话片段>","scene":"<id>|null","confidence":0.0}`;

/* ---------- 云 ASR ----------
   为什么必须由代理转发，而不是前端直连：
     同一个理由（key 不进前端）。而且 ASR 端点是 multipart 上传，
     前端直连还要额外暴露 endpoint。

   实测（2026-11-19）：
     POST /v1/tools/asr，字段名 `file`，16k 单声道 WAV 可解析
     返回 {"request_id":"...","text":"...","duration_ms":891}
     1.6 秒中文语音墙钟 891/936 ms —— 这是 M2 能用语音的实测依据。

   ⚠️ M3 打包后没有 Node 进程，本端点会一起消失（docs/03 D-6 已记录：
      能力归零，回落 L3）。这不是本实现的缺陷。 */
const ASR_MAX_BYTES = 12 * 1024 * 1024; // 12MB ≈ 6 分钟 16k 单声道 WAV
const ASR_TIMEOUT_MS = 15000;

/* ASR 调用统一走 tools/asr/ 里的 provider（2026-11-19 抽出）。
   为什么抽：对比脚本原来复制了一份讯飞实现，于是「两家比出的差异」可能是
   「两份代码写得不同」而不是「两家模型不同」。抽出之后对比与产品走同一份代码。

   **默认仍是 deepseek**：ASR_PROVIDER 不配时，行为与抽取前逐字节一致。
   配错名字会报错而不是静默回落——否则你以为测了讯飞，实际测的是 DeepSeek。 */
function resolveAsrProvider() {
  /* ⚠️ 这里必须传 providerEnv() 而不是只传讯飞那几个键。
     踩过：早期版本只传 XFYUN_*，导致 deepseek 的 available() 查 env.API_KEY
     拿不到值，/health 显示「deepseek 不可用：缺 DEEPSEEK_API_KEY」而
     key_present 明明是 true —— 两处用的 env 不是同一个视图。 */
  const pe = providerEnv();
  return pickProvider({ ...pe, ASR_PROVIDER: env.ASR_PROVIDER });
}

/* provider 需要的最小 env 子集：key 只传需要的，不把整个 env 递下去 */
function providerEnv() {
  return {
    // deepseek 用
    API_KEY,
    BASE_URL,
    // xfyun 用
    XFYUN_APPID: env.XFYUN_APPID,
    XFYUN_APIKEY: env.XFYUN_APIKEY,
    XFYUN_APISECRET: env.XFYUN_APISECRET,
    XFYUN_ASR_HOST: env.XFYUN_ASR_HOST,
    XFYUN_ASR_PATH: env.XFYUN_ASR_PATH,
    XFYUN_ASR_DOMAIN: env.XFYUN_ASR_DOMAIN,
  };
}

/**
 * @returns {{ok:boolean, text?, provider?, error?, latency_ms?, duration_ms?, request_id?}}
 *          永不抛异常 —— 上层要结构化错误。
 */
async function transcribe(wavBuffer, opts = {}) {
  const picked = resolveAsrProvider();
  if (!picked.ok) {
    return { ok: false, provider: 'none', error: picked.reason };
  }
  try {
    const r = await picked.provider.transcribe(
      wavBuffer,
      {
        timeoutMs: opts.timeoutMs || ASR_TIMEOUT_MS,
        trace: opts.trace,
      },
      providerEnv()
    );
    // provider 已保证不抛；这里再兜一层，防实现方未来改动
    return r && typeof r === 'object'
      ? r
      : { ok: false, provider: picked.id, error: 'provider 返回结构异常' };
  } catch (e) {
    return { ok: false, provider: picked.id, error: String((e && e.message) || e) };
  }
}

/* ---------- 云 TTS（只用于生成测试样本）----------
   产品里的朗读走浏览器 speechSynthesis（离线可用、零延迟）。
   这个端点不参与产品链路，存在的唯一理由是：**造 ASR 的测试样本**。
   没有它，e2e_asr.mjs 就得把 wav 二进制提交进仓库，或要求人手录音——
   两者都会让测试不可重复。

   实测（2026-11-19）：POST /v1/tools/tts，body {text}，返回 audio/wav。 */
async function synthesize(text) {
  const res = await fetch(`${BASE_URL}/v1/tools/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`TTS 上游 ${res.status}: ${String(t).slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/* ---------- 从模型输出里取出 JSON 对象 ----------
   ⚠️ 2026-11-19 加（probe_multi_turn 实测撞出来，两次都不是同一个症状）：

     第 1 次（max_tokens=160）：模型把 reason 写长 → JSON 被**截断在字符串中间**
       → 直解析抛错 → 前端回落单次判定 → 循环那一步的动作丢失。
     第 2 次（把 max_tokens 提到 320）：JSON 完整了，但模型在它**后面又追加
       「注：fall_elderly 是老人跌倒，儿童坠床…」这类解释文字**
       → 整段仍不是合法 JSON → 同一个错误的另一副面孔。

     结论：**"模型只输出 JSON" 是一个请求，不是保证。** prompt 写再多遍
     「只输出 JSON，不解释」也管不住——必须由解析侧容错。
     这不是宽松化：取出的仍必须是**一个完整配平的对象**，
     截断/不配平照样报错（下面括号计数不平就返回 null）。

     顺序：直解析 → 去 ```json 围栏 → 从第一个 { 起做括号计数（跳过字符串内的括号）。 */
function extractJson(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;

  try {
    return JSON.parse(s);
  } catch {
    /* 继续尝试 */
  }

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* 继续尝试 */
    }
  }

  const start = s.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/* ---------- 缓存：同一句只花一次钱 ---------- */
const cache = new Map();
const CACHE_MAX = 2000;

/* ---------- 调用模型 ---------- */
async function judge(text, opts) {
  const noCache = !!(opts && opts.noCache);
  const hit = noCache ? null : cache.get(text);
  if (hit) return { ...hit, cached: true, latency_ms: 0 };

  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0,
      max_tokens: 120,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`上游 ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '{}';
  const latency = Date.now() - t0;

  let obj = extractJson(raw);
  if (!obj) throw new Error(`模型返回不是合法 JSON: ${String(raw).slice(0, 120)}`);

  /* 收紧模型输出：任何越界值一律降级为安全值 */
  let intent = String(obj.intent || '').trim();
  if (!['ongoing', 'prevention', 'off_scope'].includes(intent)) intent = 'off_scope';

  let scene = obj.scene;
  if (scene === 'null' || scene === '' || scene === undefined) scene = null;
  if (scene !== null && !SCENE_IDS.includes(scene)) scene = null; // 自造场景 → null

  // 一致性：off_scope 不该带场景
  if (intent === 'off_scope') scene = null;

  let confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  /* turn：模型的「现场/预案/无关」标签；缺失时按 intent 映射，
     保证旧模型/旧缓存也能给出稳定结构。 */
  let turn = String(obj.turn || '').trim();
  if (!['ongoing', 'plan', 'off_scope'].includes(turn)) {
    turn = intent === 'ongoing' ? 'ongoing' : intent === 'prevention' ? 'plan' : 'off_scope';
  }
  const evidence = String(obj.evidence || '').slice(0, 120);

  const result = {
    intent,
    turn,
    evidence,
    scene,
    // scene_unpublished: 判出了场景但该场景还没有条目 → 前端只能给拨号卡
    scene_unpublished: scene !== null && !READY_IDS.includes(scene),
    confidence,
    latency_ms: latency,
    cached: false,
    model: data?.model || MODEL,
  };

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(text, result);
  return result;
}

/* 代理自己的日志：与前端同一份文件、同一套字段，这样按 trace 能拼出
   「前端发了什么 → 代理调了模型 → 模型答了什么 → 代理回了什么」。 */
function proxyLog(level, msg, fields = {}) {
  const rec = {
    ts: new Date().toISOString(),
    level,
    module: 'proxy',
    trace: fields.trace || null,
    msg,
    ...fields,
  };
  if ('trace' in rec && typeof rec.trace === 'undefined') rec.trace = null;
  appendLogs([rec]);
}

/* ---------- P5：日常解释扩写（/expand） ----------
   范围（第一版，刻意收窄）：
     · 只解释「为什么 / 常见误区」，不复述操作步骤；
     · 操作步骤由前端静态字段单独列出，模型不生成动作。
   这样 S7 的动作约束从结构上就成立：没有 actions；若正文出现动作动词，直接判失败，
   前端回落静态日常卡。后续要允许「带出处的动作」再扩展 actions/src。 */
const EXPAND_PROMPT = `你是应急科普解释器。只输出 JSON，不解释、不加代码块。
给定条目的 summary / why / misconception 和 prevention 列表，用老人能听懂的话解释。
硬规则：
1. 只解释原因、原理、后果、常见误区。
2. **可以复述 prevention 列表里已有的动作，但必须逐字复述**，
   并在 actions 里写出 {"say":"<逐字>","src":"daily.prevention[i]"}。
   **可以为解释原因举例**（如「开灯、按门铃产生的火花」），
   但不得写成让用户做某件事的祈使句；
   **不要以动作开头**（打开/关闭/拨打/检查/通风……一律不要）。
3. 正文里出现的每一个动作，都必须能在 actions 里找到 say；
   没写进 actions 的动作 = 违规，会被拒绝。
4. 不复述知识库里没有的事实；不编数字、不编药名、不编诊断。
5. ≤120 个汉字；口语化。
输出格式（严格）：
{"text":"<解释>","actions":[{"say":"<逐字动作>","src":"daily.prevention[0]"}],"needAction":true}
没有动作时：{"text":"<解释>","actions":[],"needAction":false}`;

/* 祈使/动作短语的检测在 tools/p5_core.mjs（与离线检查器共用一份）。 */
const expandCache = new Map();
const EXPAND_CACHE_MAX = 500;

async function callExpandModel(facts, question, feedback) {
  const feedbackLine = feedback
    ? `\n上一版被拒：${feedback}。请重写：不要写祈使句，把具体动作改成名词短语；动作只能逐字引用 prevention 列表。` +
      `常见替换：开灯→电火花；按门铃→门铃电火花；打电话→手机电火花；通风→空气流通；离开→人处在安全位置。`
    : '';
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: EXPAND_PROMPT },
        {
          role: 'user',
          content: `条目字段：${JSON.stringify(facts)}\n用户问：${question}${feedbackLine}\n只输出 JSON。`,
        },
      ],
      temperature: 0,
      max_tokens: 220,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`上游 ${res.status}: ${String(body).slice(0, 200)}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '{}';
  return extractJson(raw) || {};
}

async function expand(question, scene, opts = {}) {
  const noCache = opts.noCache === true;
  const key = `${scene}|${question}`;
  if (!noCache) {
    const hit = expandCache.get(key);
    if (hit) return { ...hit, cached: true, latency_ms: 0 };
  }
  const entry = ENTRIES[scene];
  if (!entry) return { ok: false, reason: 'scene-not-ready' };

  const daily = entry.daily || {};
  const prevention = Array.isArray(daily.prevention) ? daily.prevention : [];
  const facts = {
    name: entry.name,
    summary: daily.summary || '',
    why: daily.why || '',
    misconception: daily.misconception || '',
    /* 带编号给模型逐字引用；只允许这一组动作。 */
    prevention: prevention.map((s, i) => `${i}: ${s}`),
  };
  const t0 = Date.now();
  /* 最多两次：第一次不过，把拒绝原因回喂，让模型用名词短语重写一次。
     判据不变；重试只给一次改正机会，失败仍回落静态卡。 */
  let checked = null;
  let text = '';
  let lastReason = '';
  let attempts = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    attempts = attempt + 1;
    const obj = await callExpandModel(facts, question, attempt ? lastReason : '');
    text = String((obj && obj.text) || '').trim();
    if (!text) {
      lastReason = 'empty-text';
      continue;
    }
    if (text.length > 160) {
      lastReason = 'too-long';
      continue;
    }
    checked = validateP5(entry, text, obj && obj.actions);
    if (checked.ok) break;
    lastReason = checked.findings[0] || 'p5-reject';
  }

  const latency = Date.now() - t0;
  if (!checked || !checked.ok) {
    return { ok: false, reason: lastReason, latency_ms: latency, attempts };
  }

  const out = {
    ok: true,
    text,
    actions: checked.actions,
    needAction: checked.needAction,
    latency_ms: latency,
    attempts,
    cached: false,
  };
  if (expandCache.size >= EXPAND_CACHE_MAX) {
    /* 淘汰最旧 1/8，不全清：与 actCache 同一理由，避免已稳定解释重新摇 */
    const drop = Math.max(1, Math.floor(expandCache.size / 8));
    let i = 0;
    for (const k of expandCache.keys()) {
      expandCache.delete(k);
      if (++i >= drop) break;
    }
  }
  expandCache.set(key, out);
  return out;
}

/* ---------- 让模型选一个工具（/act）----------
   history 只传「动作摘要」，不传原文与渲染结果：
     一段长 history 会把 prompt 撑爆并拖慢首字；而模型判断下一步只需要知道
     「已经查过哪些场景、拿到什么结论」，不需要知道卡片长什么样。
     实测（03 §2.4）单次往返 683–1627ms，prompt 越长越靠上限。

   ★ 本函数**不校验动作合法性**。只做「结构合法性」检查（有没有 act、是不是字符串）。
     白名单与前置条件归前端 tools.js —— 一处实现，避免两套判据打架。 */
/* ---------- 会话上文规范化（M2.5 记忆，2026-11-20） ----------
   判据 M4：注入的上文 ≤ 800 字，且只保留最近 5 轮。
   裁剪放在**这里（代理侧）而不是前端**：前端只管往上传，上限只有一处实现，
   否则前端改一次、代理不知道，两边数字对不上。

   ★ 只接受「用户原话」，不接受任何结论字段。
     依据 docs/03 §2.6.5 R1：模型判定的 intent/scene 一旦进记忆，错误会累积，
     且没有任何机制能发现——第一轮判错，后面每轮都在错的基础上继续。 */
const CTX_MAX_UTTERANCES = 5;
const CTX_MAX_TOTAL = 800;
const CTX_MAX_ONE = 200;

function normalizeContext(raw) {
  if (!raw || typeof raw !== 'object') return { utterances: [] };
  const src = Array.isArray(raw.utterances) ? raw.utterances : [];
  let list = src.filter((u) => typeof u === 'string').map((u) => u.trim()).filter(Boolean);

  // 单条超长：截断而非丢弃，丢掉会让模型以为用户没说过
  list = list.map((u) => (u.length > CTX_MAX_ONE ? u.slice(0, CTX_MAX_ONE) + '…' : u));

  // 只留最近 5 条
  list = list.slice(-CTX_MAX_UTTERANCES);

  // 总量超 800 字：从最旧的开始丢
  while (list.length > 1 && list.join('').length > CTX_MAX_TOTAL) list.shift();

  return { utterances: list };
}

async function act(text, opts = {}) {
  const history = Array.isArray(opts.history) ? opts.history : [];
  const noCache = opts.noCache === true;
  const ctx = normalizeContext(opts.context);

  /* 缓存键必须含上文（2026-11-20 加）。
     ⚠️ 不含会出安全事故：同一句「她还有呼吸」在第一轮「老人倒地」下该给
     fall_elderly，在另一轮「孩子烫伤」下该给 scald_burn。键里没有上文，
     两个不同上下文会命中同一份缓存 —— 第二个用户拿到第一个的答案。
     这正是 MT07 那类错误在缓存层的翻版。 */
  const ctxKey = ctx.utterances.length ? ctx.utterances.join('>') : '';
  const key =
    text +
    '|' +
    ctxKey +
    '|' +
    `turn:${opts.turn || ''}|` +
    history.map((h) => `${h.act}:${(h.args && h.args.scene) || ''}`).join('>');
  if (!noCache) {
    const hit = actCache.get(key);
    if (hit) return { ...hit, cached: true, latency_ms: 0 };
  }

  const histLines = history.length
    ? history
        .map(
          (h, i) =>
            `${i + 1}. ${h.act}(${JSON.stringify(h.args || {})}) → ${JSON.stringify(h.result || {})}`
        )
        .join('\n')
    : '（还没有调用过任何工具）';

  /* ⚠️ context 为空时，本块**一个字都不插**。
     原因：A 模式（无记忆）与 100 条单轮评测的基线必须在加记忆前后完全一致。
     若空 context 也插一个空标签，prompt 变了，历史数字就不能再拿来对照了。
     `probe_multi_turn` 的 A 组就是靠这一点保持「== 现状产品行为」。 */
  /* 分区注入的三件事：
     ① 块标题 + 顺序 —— 让模型知道哪句是过去、哪句是现在。
     ② 「不是现在说的」 —— 防 MT10「现在电梯门开了」被当当前情境，给已脱困者急救步骤。
     ③ 「冲突时以这句为准」 —— 一条明确的冲突裁决指令。

     ⚠️ 2026-11-20 修正归因：原先我写「③ 缺了模型就只能猜」，这是错的。
     实测 reason 证明模型**完全看懂**更正（原话：「用户先说煤气漏了，虽然后续改口为油烟味，
     但已出现疑似燃气泄漏的表述，按泄漏场景先查条目，宁可多给」）——
     它看懂后**主动选择无视**，因为 ACT_PROMPT 规则 6 写着「闻到异味就按泄漏处理，宁可多给」，
     那是 system 级的硬指令，压过了 user message 里的更正。
     所以 ③ 的真实作用不是「帮模型理解」，而是**提供一条与规则 6 平级、指向相反的裁决指令**。

     ACT_CTX_STYLE 仅供消融实验：full=默认 / plain=只有标签无裁决指令 / raw=纯上文无标签。
     不设则为 full，与上线行为一致。 */
  const style = String(process.env.ACT_CTX_STYLE || 'full');
  let ctxBlock;
  if (!ctx.utterances.length) {
    ctxBlock = `用户说：${text}`;
  } else if (style === 'raw') {
    ctxBlock = `${ctx.utterances.join('\n')}\n${text}`;
  } else if (style === 'plain') {
    ctxBlock = `【更早说过的话】以下是用户**之前**说的，不是现在说的，按时间从早到晚：
${ctx.utterances.map((u, i) => `${i + 1}. ${u}`).join('\n')}

【当前这句话】用户刚说的：
${text}`;
  } else {
    ctxBlock = `【更早说过的话】以下是用户**之前**说的，不是现在说的，按时间从早到晚：
${ctx.utterances.map((u, i) => `${i + 1}. ${u}`).join('\n')}

【当前这句话】用户刚说的。**与上文冲突时，以这句为准**：
${text}

上文只用于理解指代、主体变更，或补充**同一现场**的细节。
如果当前这句话是一个新的、与上文场景无关的话题，就按当前这句话单独判断，
不要把上文里的场景当成现在正在发生。`;
  }
  const policyLine = opts.turn
    ? `\n本轮类型：${opts.turn}。${
        opts.allowSteps === false
          ? '只允许 lookup_scene / get_daily / refuse；禁止 get_steps / triage / dial。'
          : ''
      }`
    : '';
  const userMsg = `${ctxBlock}${policyLine}

已经调用过的工具与结果：
${histLines}

现在应该调用哪个工具？只输出 JSON。`;

  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: ACT_PROMPT },
        { role: 'user', content: userMsg },
      ],
      temperature: 0,
      /* 160 → 320（2026-11-19 修，probe_multi_turn 实测 MT08 撞出来）：
         max_tokens=160 时，模型若把 reason 写长（>100 字），JSON 会被**截断在
         字符串中间** → 解析抛「模型返回不是合法 JSON」→ 前端回落单次判定。
         症状很隐蔽：用户最终仍拿到答案，但**走的是回落路径**，
         循环里那一步的动作丢失（MT08 从 steps 掉成 unknown）。

         prompt 里「reason 一句话」管不住 —— 那是**请求**不是**保证**，上限必须给足。
         320 的依据：实测最长响应 211 token，留 100 余量。 */
      max_tokens: 420,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`上游 ${res.status}: ${String(body).slice(0, 200)}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '{}';
  const obj = extractJson(raw);
  if (!obj) throw new Error(`模型返回不是合法 JSON: ${String(raw).slice(0, 120)}`);

  const actName = String(obj.act || '').trim();
  if (!actName) throw new Error('模型没给出 act 字段');

  const args = obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args) ? obj.args : {};

  /* turn/evidence：模型的回合标签。缺失时回落前端本地策略（opts.turn），
     保证旧模型、旧缓存、测试桩都不会因为新字段缺失而失败。 */
  let turn = String(obj.turn || '').trim();
  if (!['ongoing', 'plan', 'off_scope'].includes(turn)) {
    turn = ['ongoing', 'plan', 'off_scope'].includes(opts.turn) ? opts.turn : null;
  }
  const evidence = String(obj.evidence || '').slice(0, 120);

  const out = {
    turn,
    evidence,
    act: actName,
    args,
    reason: String(obj.reason || '').slice(0, 120),
    /* note：给用户看的解释（2026-11-20）。空字符串是合法值 —— 模型只在
       「一句话里出现两件以上不同的事」时才填，其余时候必须留空，
       避免给老人加一句没用的噪音。
       不做长度强制截断到 25 字：prompt 是请求不是保证，硬截会把句子截成半句；
       超过 60 字的直接丢弃（说明模型没按格式写），宁可不显示也不显示半句话。 */
    note: typeof obj.note === 'string' ? String(obj.note).trim().slice(0, 60) : '',
    latency_ms: Date.now() - t0,
    cached: false,
    model: data?.model || MODEL,
  };

  /* ⚠️ 2026-11-19 改：原来是 `if (actCache.size >= 800) actCache.clear()`，
     满 800 条**全清**。这会让已经稳定的答案重新去问模型 → 重新摇。

     为什么这是真问题（实测支撑）：
       稳定性探针（tools/probe_stability.mjs）实测三条边界样本的摇摆率
       P006 40% / P020 25% / O008 45%。这些摇摆**只发生在缓存未命中时**。
       全清之后它们全部回到未命中状态，于是「刚才还稳定」的答案重新开始摇。
       演示时反复测很容易超过 800 次，那时光清一次就会重新洗牌。

     改成 LRU（删最旧 1/8），保留绝大多数已稳定的答案。
     同时加日志：全清/批量淘汰必须留痕，否则事后无法确认「是否发生过」——
     这类「静默改变行为」的事，没有日志就只能靠猜。 */
  if (actCache.size >= ACT_CACHE_MAX) {
    const drop = Math.ceil(ACT_CACHE_MAX / 8);
    let n = 0;
    for (const k of actCache.keys()) {
      if (n++ >= drop) break;
      actCache.delete(k);
    }
    proxyLog('info', 'act 缓存达上限，淘汰最旧一批（LRU）', {
      evicted: n,
      remain: actCache.size,
      max: ACT_CACHE_MAX,
    });
  }
  actCache.set(key, out);
  return out;
}

/* ---------- HTTP 服务 ---------- */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body 过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readBodyBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body 过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      model: MODEL,
      key_present: !!API_KEY,
      scenes: SCENE_IDS.length,
      ready: READY_IDS.length,
      cache: cache.size,
      log_dir: path.relative(ROOT, LOG_DIR).replace(/\\/g, '/'),
      log_keep_days: LOG_KEEP_DAYS,
      asr_provider: (() => {
        const p = resolveAsrProvider();
        return p.ok ? p.id : 'unavailable:' + p.reason;
      })(),
      asr_default: DEFAULT_PROVIDER,
      asr_providers: listProviders(providerEnv()),
    });
  }

  /* 清缓存：`03` v1.7 写明「复跑评测前须清代理缓存」，但一直没提供方法。
     没有它，评测跑第二次就是拿缓存自欺（latency_ms 恒为 0）。
     仅测试/评测用，不影响产品路径。 */
  if (req.method === 'POST' && url.pathname === '/cache/clear') {
    /* 两套缓存必须一起清（2026-11-19 修：原来只清 cache，
       结果评测跑出「总耗时 1s」——全是 act 缓存命中，测的不是真实时延）。
       这与 docs/03 v1.7 立的第 2 条纪律「复跑评测前须清缓存」直接相关：
       清不干净等于没清。 */
    const nJudge = cache.size;
    const nAct = actCache.size;
    cache.clear();
    actCache.clear();
    proxyLog('info', '清空缓存', { judge: nJudge, act: nAct });
    return json(res, 200, { ok: true, cleared: nJudge + nAct, judge: nJudge, act: nAct });
  }

  if (req.method === 'POST' && url.pathname === '/judge') {
    let text = '';
    let trace = null;
    let noCache = false;
    try {
      const body = JSON.parse(await readBody(req));
      text = String(body.text || '').trim();
      trace = typeof body.trace === 'string' ? body.trace.slice(0, 64) : null;
      // nocache: 测真实时延用（缓存命中的 latency 恒为 0，测不出东西）
      noCache = body.nocache === true;
    } catch (e) {
      return json(res, 400, { error: 'body 不是合法 JSON' });
    }
    if (!text) return json(res, 400, { error: 'text 为空' });
    if (text.length > 500) return json(res, 400, { error: 'text 超过 500 字' });

    try {
      const t0 = Date.now();
      const r = await judge(text, { noCache });
      proxyLog('info', 'judge 完成', {
        trace,
        intent: r.intent,
        scene: r.scene,
        confidence: r.confidence,
        cached: r.cached,
        latency_ms: r.latency_ms,
        total_ms: Date.now() - t0,
        text_len: text.length,
      });
      return json(res, 200, r);
    } catch (e) {
      // 错误信息里可能带上游响应，但不含 key
      proxyLog('error', 'judge 失败', { trace, error: scrubText(String(e.message || e)) });
      return json(res, 502, { error: String(e.message || e) });
    }
  }

  /* ---------- /act：让模型选工具（docs/03 §2.5.12 D-12） ---------- */
  if (req.method === 'POST' && url.pathname === '/act') {
    let text = '';
    let history = [];
    let trace = null;
    let noCache = false;
    let context = null;
    let turn = null;
    let allowSteps = true;
    try {
      const body = JSON.parse(await readBody(req));
      text = String(body.text || '').trim();
      history = Array.isArray(body.history) ? body.history.slice(-6) : [];
      /* 回合策略由前端本地规则算出；这里只做白名单，避免任意字符串进 prompt。 */
      const t = String(body.turn || '').trim();
      turn = ['hypothetical', 'prevention', 'ongoing', 'unknown'].includes(t) ? t : null;
      allowSteps = body.allow_steps !== false;
      /* 会话上文：缺失或结构非法一律按「无记忆」处理，不报错。
         与代理现有「静默回落」的立场一致（03 §2.6.4 约束 1）——
         记忆是增强项，它坏了不该让整个问答失败。 */
      context = body.context && typeof body.context === 'object' ? body.context : null;
      trace = typeof body.trace === 'string' ? body.trace.slice(0, 64) : null;
      noCache = body.nocache === true;
    } catch {
      return json(res, 400, { error: 'body 不是合法 JSON' });
    }
    if (!text) return json(res, 400, { error: 'text 为空' });
    if (text.length > 500) return json(res, 400, { error: 'text 超过 500 字' });

    try {
      const r = await act(text, { history, noCache, context, turn, allowSteps });
      proxyLog('info', 'act 完成', {
        trace,
        act: r.act,
        args: r.args,
        cached: r.cached,
        latency_ms: r.latency_ms,
        history_len: history.length,
        turn,
        allow_steps: allowSteps,
        /* ctx_len 必须落盘：否则事后无法区分「记忆没生效」与「记忆生效但没用」，
           这两种情况要改的地方完全不同。 */
        ctx_len: Array.isArray(context && context.utterances) ? context.utterances.length : 0,
        text_len: text.length,
      });
      return json(res, 200, r);
    } catch (e) {
      proxyLog('error', 'act 失败', { trace, error: scrubText(String(e.message || e)) });
      return json(res, 502, { error: String(e.message || e) });
    }
  }

  /* ---------- /expand：P5 日常解释扩写（只解释，不生成动作） ---------- */
  if (req.method === 'POST' && url.pathname === '/expand') {
    let question = '';
    let scene = '';
    let trace = null;
    let noCache = false;
    try {
      const body = JSON.parse(await readBody(req));
      question = String(body.question || '').trim();
      scene = String(body.scene || '').trim();
      trace = typeof body.trace === 'string' ? body.trace.slice(0, 64) : null;
      noCache = body.nocache === true;
    } catch {
      return json(res, 400, { error: 'body 不是合法 JSON' });
    }
    if (!question) return json(res, 400, { error: 'question 为空' });
    if (question.length > 500) return json(res, 400, { error: 'question 超过 500 字' });
    if (!scene || !READY_IDS.includes(scene)) {
      return json(res, 400, { error: 'scene 未发布或缺失' });
    }

    try {
      const r = await expand(question, scene, { noCache });
      proxyLog('info', r.ok ? 'expand 完成' : 'expand 拒绝', {
        trace,
        scene,
        ok: r.ok,
        reason: r.reason || null,
        cached: r.cached || false,
        latency_ms: r.latency_ms || 0,
        text_len: r.text ? r.text.length : 0,
      });
      /* ok:false 仍回 200：这是「安全回落」不是服务故障，前端据此保留静态卡。 */
      return json(res, 200, r);
    } catch (e) {
      proxyLog('error', 'expand 失败', { trace, error: scrubText(String(e.message || e)) });
      return json(res, 502, { error: String(e.message || e) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/log') {
    let records = [];
    try {
      const raw = await readBody(req, 512 * 1024);
      const body = JSON.parse(raw);
      records = Array.isArray(body.records) ? body.records : [];
    } catch (e) {
      // 日志本身写不进去不该让调用方重试，直接 200 但如实说没写
      return json(res, 200, { ok: false, written: 0, error: 'body 解析失败' });
    }
    const written = appendLogs(records);
    return json(res, 200, { ok: true, written, received: records.length });
  }

  /* ASR：前端发原始 WAV 二进制（application/octet-stream），这里包成
     multipart 转发。为什么不用前端直接发 multipart：浏览器组 multipart
     的代码与 curl 不同，出错时难判定是编码问题还是端点问题。
     统一在代理侧组，前端只负责「把字节发出去」。 */
  if (req.method === 'POST' && url.pathname === '/asr') {
    let trace = null;
    try {
      trace = (url.searchParams.get('trace') || '').slice(0, 64) || null;
    } catch {
      /* ignore */
    }
    let buf;
    try {
      buf = await readBodyBuffer(req, ASR_MAX_BYTES);
    } catch (e) {
      proxyLog('warn', 'ASR 音频过大被拒', { trace, error: String(e.message || e) });
      return json(res, 413, { error: '音频过大（上限 12MB）' });
    }
    if (!buf || buf.length < 100) {
      proxyLog('warn', 'ASR 音频为空', { trace, bytes: buf ? buf.length : 0 });
      return json(res, 400, { error: '音频为空' });
    }

    const t0 = Date.now();
    /* provider 返回结构化结果、不抛异常（见 tools/asr/README.mjs 的接口约定），
       所以这里不用 try/catch，改为判断 r.ok。 */
    const r = await transcribe(buf, { trace });

    if (!r.ok) {
      const msg = String(r.error || '识别失败');
      const isTimeout = /超时|timeout/i.test(msg);
      proxyLog('error', isTimeout ? 'ASR 超时' : 'ASR 失败', {
        trace,
        provider: r.provider,
        bytes: buf.length,
        code: r.code || null,
        error: scrubText(msg),
      });
      return json(res, isTimeout ? 504 : 502, {
        error: scrubText(msg),
        provider: r.provider,
      });
    }

    /* 摘要必落盘：识别文本是「用户到底说了什么」的唯一记录，
       出错时第一个要看的就是它（截断同前端规则）。
       provider 也记：同一个音频换供应商后结果变了，日志能看出来。 */
    proxyLog('info', 'ASR 完成', {
      trace,
      provider: r.provider,
      bytes: buf.length,
      text: String(r.text || '').slice(0, 40),
      text_len: String(r.text || '').length,
      audio_ms: r.duration_ms,
      upstream_ms: r.latency_ms,
      total_ms: Date.now() - t0,
    });
    return json(res, 200, {
      text: String(r.text || '').trim(),
      duration_ms: r.duration_ms,
      latency_ms: r.latency_ms,
      provider: r.provider,
      request_id: r.request_id || null,
    });
  }

  /* 仅用于生成 e2e_asr 的测试样本，不参与产品链路 */
  if (req.method === 'GET' && url.pathname === '/tts') {
    const text = String(url.searchParams.get('text') || '').trim();
    if (!text) return json(res, 400, { error: 'text 为空' });
    if (text.length > 200) return json(res, 400, { error: 'text 超过 200 字' });
    try {
      const buf = await synthesize(text);
      proxyLog('info', 'TTS 合成（测试样本）', { text: text.slice(0, 40), bytes: buf.length });
      cors(res);
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': buf.length });
      res.end(buf);
    } catch (e) {
      proxyLog('error', 'TTS 失败', { error: scrubText(String(e.message || e)) });
      return json(res, 502, { error: scrubText(String(e.message || e)) });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/shutdown') {
    json(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 50);
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  ensureLogDir();
  pruneLogs();
  // 每天清一次旧日志；进程退出就一起结束，不用 unref 之外的清理逻辑
  setInterval(pruneLogs, 24 * 3600 * 1000).unref();
  proxyLog('info', '代理启动', { port: PORT, model: MODEL, ready: READY_IDS.length });

  console.log(`LLM 意图判定代理已启动: http://${HOST}:${PORT}`);
  console.log(`  模型: ${MODEL}`);
  console.log(`  key: ${API_KEY.slice(0, 3)}...${API_KEY.slice(-4)}（不打印完整值）`);
  console.log(`  场景白名单: ${SCENE_IDS.length} 个，其中已发布 ${READY_IDS.length} 个`);
  console.log(`  日志目录: ${path.relative(ROOT, LOG_DIR)}（保留 ${LOG_KEEP_DAYS} 天）`);
  console.log(`  只监听 127.0.0.1，非同网段可达`);
});
