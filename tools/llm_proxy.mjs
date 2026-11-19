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
2. 只有「危险正在发生」才出 get_steps。问「怎么预防」「要不要装」「多久一次」一律出 get_daily。
3. 与应急急救无关（缴费、投诉、价格、理赔、广告、邻里关系）一律 refuse。
   **但「选购类」要分两种，不能一律 refuse（2026-11-19 修）**：
   · **安全防护设备**的选购 → get_daily（属 prevention）。清单：燃气报警器、烟感器、
     一氧化碳报警器、灭火器、防滑垫、扶手、插座保护盖、漏电保护器、防坠网。
     判断原则：**买错或没装会直接导致防护失效、进而伤人**的，就是防护设备。
   · **消费品**的选购 → refuse。清单：燃气热水器、护理床、跌打药、电梯房、按摩椅。
     判断原则：买错只影响价格、舒适或效果，**不会因为选错就在险情里保护失效**。
   ⚠️ 为什么这条要单独写：「灭火器怎么选」曾被判成「商品选购，与应急无关」→ refuse，
   而标注要求 daily。根因是旧规则 3「选购一律 refuse」与规则 2「要不要装→get_daily」
   **自相矛盾**（「家里要不要装燃气报警器」走规则 2 对，「灭火器怎么选」走规则 3 错）。
   灭火器选错类型（如水基灭不了电器火）会在关键时刻失效，这与「没装报警器」是同一类风险。
4. 场景拿不准就给 refuse，不要猜一个相近的场景。
5. 已经拿到结果就停止，不要重复查同一个场景。
6. **紧急场景一律不许用 ask 追问，直接出内容或拨号。**
   具体征兆包括：闻到异味/臭味/煤气味、看到明火或烟、有人倒地/叫不醒/抽搐、
   有人触电、有人溺水、大出血、被烫伤、电梯困人、地震。
   用户加「不知道是不是」「好像是」「可能」这类不确定词，**不改变判定** ——
   他只是不能确认，不是没有征兆。**闻到异味就按泄漏处理，宁可多给。**
   **为什么紧急不许问**：紧急链路每问一句，用户要多等约 1 秒且可能根本不回答
   （手在抖、人已昏迷、在跑）。宁可给一个覆盖更坏情况的步骤，也不要停下来问。
   ⚠️ 不要把「器具故障」当需要处理的情形 —— 例如「打不着火」但没提任何味道/异响：
   那是家务事，不是急救，应 refuse。本产品不做「先确认再决定管不管」的追问。
7. **本库没有覆盖的急症，必须直接 dial，不许 get_steps。**
   未覆盖清单：**没有呼吸 / 无呼吸 / 呼吸停止 / 心跳停止 / 叫不醒且无反应（需 CPR）、
   大出血、昏迷不醒、抽搐不止、卒中（嘴歪眼斜半身不遂）**。
   为什么这条比「给步骤」更安全：库里的 fall_elderly 首屏会问
   「现在能自己试着动一动胳膊腿吗？」—— **对一个已经没呼吸的人问这句是致命的**。
   给不出的内容宁可不给，直接给 120 拨号按钮。
   注意：airway_obstruction 只讲噎食（海姆立克），**不是 CPR**，不要拿它顶替。
   ⚠️⚠️ **触发条件必须由用户明说，不许推测。**
   用户只说「倒了 / 摔了 / 跌了一跤」，**没提呼吸和意识**时，不要假设最坏情况，
   按常规出 triage 或 get_steps（fall_elderly 的分诊会自己问「能不能动胳膊腿」，
   这对清醒的摔伤者是合适的）。只有当用户**明确说出**「没呼吸 / 没反应 / 叫不醒 /
   昏迷 / 大出血」时才 dial。
   判断依据是「用户说了什么」，不是「可能会怎样」。过度保守会让用户拿不到任何处置指引，
   比给分诊卡更差。

输出格式（严格）：
{"act":"<工具名>","args":{...},"reason":"<一句话，为什么选它>"}`;

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
   - ongoing    = 危险正在发生，需要立即行动（"着火了"、"煤气漏了"、"起不来"）
   - prevention = 问预防方法、日常注意事项、知识性疑问（"怎么预防"、"多久换一次"、"要不要装"）
   - off_scope  = 与应急急救无关（缴费、投诉、选购、价格、理赔、广告、邻里关系等）
2. scene：命中的场景 id；off_scope 或无法归属时必须为 null
3. confidence：0.0-1.0

判定要点：
- "怎么预防X"、"X多久一次"、"要不要装X" 属 prevention，不是 ongoing
- "X费怎么交"、"X怎么投诉"、"X多少钱" 属 off_scope
- **"X怎么选"要分两种（2026-11-19 修，旧版一律归 off_scope 与上一条自相矛盾）**：
  · **安全防护设备** → prevention（燃气报警器、烟感器、一氧化碳报警器、灭火器、
    防滑垫、扶手、插座保护盖、漏电保护器）。判断原则：**买错或没装会直接导致
    防护失效、进而伤人**。
  · **消费品** → off_scope（燃气热水器、护理床、跌打药、电梯房、按摩椅）。
    判断原则：买错只影响价格、舒适或效果，不会在险情里保护失效。
- 只在真的正在出事时给 ongoing
- 宁可 scene 为 null，也不要猜一个相近的场景

输出格式（严格，不要多余字段）：
{"intent":"ongoing|prevention|off_scope","scene":"<id>|null","confidence":0.0}`;

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
      max_tokens: 80,
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

  const result = {
    intent,
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

/* ---------- 让模型选一个工具（/act）----------
   history 只传「动作摘要」，不传原文与渲染结果：
     一段长 history 会把 prompt 撑爆并拖慢首字；而模型判断下一步只需要知道
     「已经查过哪些场景、拿到什么结论」，不需要知道卡片长什么样。
     实测（03 §2.4）单次往返 683–1627ms，prompt 越长越靠上限。

   ★ 本函数**不校验动作合法性**。只做「结构合法性」检查（有没有 act、是不是字符串）。
     白名单与前置条件归前端 tools.js —— 一处实现，避免两套判据打架。 */
async function act(text, opts = {}) {
  const history = Array.isArray(opts.history) ? opts.history : [];
  const noCache = opts.noCache === true;

  /* 缓存键含 history：同一句话在不同上下文下该调的工具不同。
     只取「动作名+场景」拼键，不含 reason（模型措辞会变，会让缓存命中率归零）。 */
  const key =
    text + '|' + history.map((h) => `${h.act}:${(h.args && h.args.scene) || ''}`).join('>');
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

  const userMsg = `用户说：${text}

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
      max_tokens: 320,
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

  const out = {
    act: actName,
    args,
    reason: String(obj.reason || '').slice(0, 120),
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
    try {
      const body = JSON.parse(await readBody(req));
      text = String(body.text || '').trim();
      history = Array.isArray(body.history) ? body.history.slice(-6) : [];
      trace = typeof body.trace === 'string' ? body.trace.slice(0, 64) : null;
      noCache = body.nocache === true;
    } catch {
      return json(res, 400, { error: 'body 不是合法 JSON' });
    }
    if (!text) return json(res, 400, { error: 'text 为空' });
    if (text.length > 500) return json(res, 400, { error: 'text 超过 500 字' });

    try {
      const r = await act(text, { history, noCache });
      proxyLog('info', 'act 完成', {
        trace,
        act: r.act,
        args: r.args,
        cached: r.cached,
        latency_ms: r.latency_ms,
        history_len: history.length,
        text_len: text.length,
      });
      return json(res, 200, r);
    } catch (e) {
      proxyLog('error', 'act 失败', { trace, error: scrubText(String(e.message || e)) });
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
