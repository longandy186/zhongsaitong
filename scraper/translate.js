// AI 翻译与转写（多提供商 + 自动降级）
// 首选智谱 GLM（glm-4.7-flash，限流降级 glm-4-flash/glm-4-flashx）
// 兜底 Agnes AI（agnes-2.5-flash，输入输出免费）
// Key 从环境变量读取（本地 .env 或 GitHub Actions Secrets）

const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const AGNES_URL = 'https://apihub.agnes-ai.com/v1/chat/completions';

// 提供商列表（按优先级），同一提供商内按模型顺序尝试
const PROVIDERS = [
  {
    name: 'zhipu',
    url: GLM_URL,
    models: [process.env.GLM_MODEL || 'glm-4.7-flash', 'glm-4-flash', 'glm-4-flashx'],
    key: () => process.env.ZHIPU_API_KEY,
  },
  {
    name: 'agnes',
    url: AGNES_URL,
    models: ['agnes-2.5-flash'],
    key: () => process.env.AGNES_API_KEY,
  },
];

// 加载本地 .env（若存在；已显式设置的环境变量优先级更高，不被覆盖）
try {
  const fs = await import('node:fs');
  const envText = fs.readFileSync(new URL('./.env', import.meta.url), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch {
  /* .env 不存在则忽略 */
}

// 翻译/精炼时的正文输入长度上限（字符）。RSS 摘要 + 详情页正文合并后截断。
// 2026-11-01 由 4000 提到 9000：4000 只够覆盖长文的前 60%，后半段信息直接丢失。
export const AI_CONTENT_LIMIT = Number(process.env.AI_CONTENT_LIMIT ?? 9000);
// 单次调用输出上限。600-900 字正文约 1400 token，4096 有余量且不至于让模型注水。
const AI_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS ?? 4096);
// 判定"内容太短、需要去抓详情页"的阈值（字符，去空白后）。
// 2026-11-01 起塞语源/配置了 articleSelector 的源一律抓详情页，此阈值仅用于判断
// 抓回来的正文是否比 RSS 摘要更值得用（见 run.js pickRichest）。
export const SHORT_CONTENT_THRESHOLD = 300;

export function hasKey() {
  return PROVIDERS.some((p) => p.key());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 解析模型返回的 JSON（容忍代码块包裹、全角引号、换行、reasoning_content）
function parseJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let raw = m[0];
  // 统一 Unicode 引号/标点，避免 JSON.parse 失败
  const normalize = (s) =>
    s
      .replace(/[\u201C\u201D]/g, '"') // “ ” → "
      .replace(/[\u2018\u2019\u2032\u2033\uFF02]/g, "'")
      .replace(/\uFF0C/g, ',') // 全角逗号
      .replace(/\uFF1A/g, ':') // 全角冒号
      .replace(/\s+/g, ' ')
      .replace(/,\s*}/g, '}');
  try {
    return JSON.parse(raw);
  } catch {
    raw = normalize(raw);
    try {
      return JSON.parse(raw);
    } catch (e) {
      if (process.env.SCRAPER_DEBUG) console.error('[ai] JSON解析失败:', raw.slice(0, 300));
      return null;
    }
  }
}

async function callAI(system, user) {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const provider of PROVIDERS) {
      const apiKey = provider.key();
      if (!apiKey) continue;
      for (const model of provider.models) {
        try {
          const resp = await fetch(provider.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
              temperature: 0.3,
              max_tokens: AI_MAX_TOKENS,
            }),
            // 60s 超时：输出 600-900 字正文比原来的短摘要慢 2-3 倍，
            // 限流降级到 glm-4-flash 时更慢；仍保留上限防止 API 挂起卡死整个采集。
            signal: AbortSignal.timeout(60000),
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            const code = String(err?.error?.code ?? '');
            if (process.env.SCRAPER_DEBUG)
              console.error(`[ai] ${provider.name}/${model} HTTP ${resp.status}:`, JSON.stringify(err).slice(0, 120));
            // 限流类错误：1305=访问量过大、1302=已达速率限制（实测 GLM 免费额度下频繁出现）
            // 这两种都要「换下一个模型 / 降级到备用提供商」并让外层退避重试，
            // 不能 return null —— 那会直接放弃整次调用，连 Agnes 兜底都轮不到。
            // HTTP 429 一律按限流处理。其余（401/403 key 失效、400 参数错）才是真失败。
            if (resp.status === 429 || code === '1305' || code === '1302') {
              const ra = Number(resp.headers.get('retry-after'));
              if (Number.isFinite(ra) && ra > 0 && ra <= 30) await sleep(ra * 1000);
              continue;
            }
            return null;
          }
          const data = await resp.json();
          // OpenAI 兼容：优先 choices[0].message.content
          const content = data?.choices?.[0]?.message?.content;
          if (content) {
            if (process.env.SCRAPER_DEBUG) console.error(`[ai] ${provider.name}/${model} OK`);
            return content;
          }
        } catch (e) {
          if (process.env.SCRAPER_DEBUG) console.error(`[ai] ${provider.name}/${model} fetch错误:`, e.message);
          continue;
        }
      }
    }
    // 全部限流/失败则退避重试
    if (attempt < 2) await sleep(8000 * (attempt + 1));
  }
  return null;
}

/**
 * 将塞尔维亚语内容翻译为中文，并提取结构化信息
 * @returns {Promise<{title:string, summary:string, tags:string[]}|null>}
 */
// 相关度判定口径（translateNews / polishChinese / scoreRelevance 共用，保证前后一致）
// 目的：在关键词粗筛之后，用语义判断干掉「词都对但事与塞国华人无关」的内容
//       —— 例如阿巴斯在联合国提到 visa、白俄罗斯赦免囚犯、欧洲排球锦标赛。
//
// ⚠️ 设计要点：**不要让模型直接给 0-10 分，也不要让它组合多个互相关联的布尔字段**。
// 实测（GLM-4.7-Flash）：
//   ① 主观刻度有极强中心化倾向 —— 提示词写「7-8 档」就一律返回 7（31 条真实待审全部 7 分），
//      改成「4-6 档」则一律返回 4（24 条样例里 17 条 4 分）；示例里写 "relevance":7 会被整体照抄。
//   ② 改成 a/b/c/d 四个是非题后分数区分度正常了，但字段之间会打架：
//      「学校周边8482起超速」「柴油储备5000吨」「首次购房150项方案」都被判 b=false 而误杀，
//      「不发达地区融资协议」又被判 b=true 而漏放。
// 最终方案：**只让模型做一件事 —— 从固定类别表里选一个词**。保留/归档与分数全部由
// deriveScore() 映射，模型没有自由发挥空间，出错也能一眼定位到是哪一类判错。
export const RELEVANCE_RUBRIC =
  '先回答一个决定性问题，再看类别表：这条新闻的**主体事件**是什么？\n' +
  '  · 主体是「某人说了什么 / 某党承诺要做什么 / 发布了某个报告或评估 / 某企业拿到钱或开工」\n' +
  '    → 一律归入 politics 或 business，**不管它提到多少数字或领域词**。\n' +
  '    例：「总统访问某地：将投资数十亿用于道路和水」主体是总统的表态 → politics，不是 infra；\n' +
  '        「某党公布纲领：养老金减少25%」主体是政党纲领 → politics，不是 policy；\n' +
  '        「签署某项目融资协议」主体是拿到钱 → business，不是 policy。\n' +
  '  · 主体是「已经生效或已确定日期的规则/期限/金额 / 已经发生或排定的通行与供应变化 /\n' +
  '    面向公众发布的安全提醒」→ 才归入 policy、infra、price、warning。\n' +
  '再把下面这条当成硬规则执行，它优先于领域词：\n' +
  '  · 只要主体是总统/总理/部长/议员/政党/政府/议会/外交部，且动作是「访问、表示、宣布、承诺、\n' +
  '    呼吁、强调、指出、批评、评估、签署（意向）」——不论内容提到哪些领域词\n' +
  '    （道路、水、下水道、补贴、养老金、投资额、项目），一律 politics。\n' +
  '    判「是不是已经落地」的标准：有没有已经生效的日期、已经确定的金额、已经发生的通行变化。\n' +
  '    只是「将投资」「计划推进」「承诺保障」这类未来时态 → 归 politics 或 business。\n' +
  '然后把类别词填进 JSON 的 type 字段，可选类别如下（十个里选恰好一个）：\n' +
  '【会推送给读者的一类 —— 含在塞华人可以照着参考的具体信息】\n' +
  '  policy   = 已生效或已确定日期的政策、手续、证件、居留、补贴、税费、罚款、福利规则\n' +
  '  infra    = 已发生或已排定的道路/铁路/公交/水电/供暖的通车、停运、停水、检修、施工、限行\n' +
  '  price    = 物价、油价、电价、房价、工资、通胀、能源储备等经济数据\n' +
  '  warning  = 面向塞国公众的公共安全或健康预警（事故多发统计、药品食品警告、传染病、极端天气）\n' +
  '【直接归档的一类 —— 对在塞华人的决策没有可参考信息】\n' +
  '  politics = 政党声明、选举动态、政治人物言论与指控、政府会议、人事任免、外交礼节性会晤、\n' +
  '             外国媒体评论塞国政治、情报机构评估\n' +
  '  business = 企业自身的融资/贷款/投资额/经营业绩/检修/换帅/项目开工，以及政府采购与拨款\n' +
  '  school   = 面向塞国学生的招生、奖学金、助学金、培训项目与校园活动（发布方是学校或企业都一样）\n' +
  '  accident = 个案犯罪、个案交通事故、个案法院判决\n' +
  '  culture  = 节庆、展览、演出、体育赛事、娱乐八卦、名人生活、每日天气与节目预告\n' +
  '  foreign  = 与塞尔维亚无关的国际新闻、外国领导人活动、外国的政策与收费（如威尼斯旅游税）\n' +
  '再区分几个易混的：\n' +
  '  · 「学校周边七天内记录8482起超速」= warning（面向公众的统计预警）；\n' +
  '    「某路段发生车祸致六人受伤」= accident（单个事件）。\n' +
  '  · 「政府释放5000吨柴油储备」= price（影响油价）；「某企业获得1500万欧元贷款」= business。\n' +
  '  · 「首次购房母亲可申请补贴」= policy（已公布的申请政策）；「某企业宣布投资数十亿建厂」= business。\n' +
  '另外再输出 d：布尔值，表示内容是否与在塞华人的身份**直接**相关\n' +
  '（签证/居留/工作许可政策、使馆与领事通知、中塞政府间协议）。\n' +
  '绝大多数新闻 d 都是 false，只有确实在讲上述事项时才给 true，不要默认给 true。';

/** 类别 → 分数（0-10）。门槛默认 7，因此只有 policy/infra/price/warning 才进审核队列。 */
const CATEGORY_SCORE = {
  policy: 8,
  infra: 8,
  price: 8,
  warning: 8,
  politics: 5,
  business: 5,
  school: 5,
  accident: 5,
  culture: 5,
  foreign: 2,
};
// 容错：模型偶尔输出中文类别名或大小写变体
const CATEGORY_ALIAS = {
  '政策': 'policy', '手续': 'policy', '基建': 'infra', '基础设施': 'infra',
  '物价': 'price', '经济': 'price', '预警': 'warning', '安全': 'warning',
  '政治': 'politics', '企业': 'business', '商业': 'business', '学校': 'school',
  '教育': 'school', '事故': 'accident', '法院': 'accident',
  '文娱': 'culture', '文化': 'culture', '体育': 'culture', '国际': 'foreign', '外国': 'foreign',
};

/**
 * 由模型给出的类别词确定分数（0-10）。
 * @returns {number|null} 类别无法识别时返回 null（该条保持 pending，交人工判断）
 */
export function deriveScore(j) {
  if (!j || typeof j !== 'object') return null;
  let type = String(j.type ?? '').trim().toLowerCase().replace(/[\s"'`。，,.]/g, '');
  if (!type) return null;
  if (CATEGORY_ALIAS[type]) type = CATEGORY_ALIAS[type];
  const base = CATEGORY_SCORE[type];
  if (base === undefined) return null;
  // 与华人身份直接相关（签证/居留/使馆/中塞协议）的 policy 类才升到 10
  const d = j.d === true || ['true', 'yes', '是', '1'].includes(String(j.d).trim().toLowerCase());
  if (d && (type === 'policy' || type === 'warning')) return 10;
  return base;
}

/** 暴露类别表本身，便于调试与测试对照 */
export const RELEVANCE_CATEGORIES = Object.keys(CATEGORY_SCORE);

/**
 * 给已译好的中文条目打相关度分（用于历史积压重筛，比重新翻译便宜得多）
 *
 * ⚠️ JSON 示例里不写具体类别词，避免模型照抄；分数不由模型给，
 * 而由 deriveScore() 按类别映射。
 * @returns {Promise<number|null>} 0-10 整数；类别无法识别时返回 null
 */
export async function scoreRelevance(title, summary = '') {
  const text = await callAI(
    '你是塞尔维亚华人信息平台的内容主编，负责判断候选新闻「该不该推给在塞华人」。' +
      '必须严格输出 JSON，形如 {"type":"类别词","d":布尔,"reason":"不超过15字的理由"}。' +
      'type 必须原样从下面给出的十个类别词中选一个。不要输出其他内容。\n' +
      RELEVANCE_RUBRIC,
    `标题：${title}\n摘要：${String(summary).slice(0, 600)}`
  );
  const j = parseJson(text) ?? parseBareCategory(text);
  const s = deriveScore(j);
  // DEBUG_RELEVANCE=1 时打印模型原始判断，用于核对是「模型判错类别」还是「映射规则不合理」
  if (process.env.DEBUG_RELEVANCE) {
    console.error(`  [relevance] type=${j?.type} d=${j?.d} → ${s}  ${String(j?.reason ?? '').slice(0, 22)}`);
  }
  return s;
}

/**
 * 合并过短的段落。
 *
 * 背景：塞语新闻（尤其政府/机构公告）原文多为单句成段，模型倾向逐段搬运，
 * 产出「12 段、每段一句话、连续多段同一主语开头」的条列体，读起来像通告不像文章。
 * 提示词已要求它合并，但这类格式约束模型遵守率不稳定，这里加一层确定性兜底：
 * 短于 minLen 的段落一律并入前一段（首段则并入次段）。
 *
 * 只做合并、不重写文字，不会改变事实口径。
 * @param {string[]} paras
 * @param {number} minLen 视为"过短"的字数阈值
 * @returns {string[]}
 */
export function mergeShortParagraphs(paras, { maxParas = 6, minLen = 40, maxLen = 300 } = {}) {
  const arr = (paras ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (arr.length <= 1) {
    // 模型偶尔无视"数组"要求，把整篇正文塞进一个字符串（实测 RTS 有一条 500 字一段）。
    // 此时按句末标点补切，目标 3-6 段。
    if (arr.length === 1 && arr[0].length > maxLen) {
      const s = arr[0];
      const sentences = s.match(/[^。！？；]*[。！？；]|[^。！？；]+$/g) ?? [s];
      const target = Math.min(6, Math.max(3, Math.round(s.length / 180)));
      const per = Math.ceil(sentences.length / target);
      const chunks = [];
      for (let i = 0; i < sentences.length; i += per) {
        chunks.push(sentences.slice(i, i + per).join('').trim());
      }
      return chunks.filter(Boolean);
    }
    return arr;
  }

  // 第一步：只处理"极端短段"（短于 minLen 字），并入前一段。
  // ⚠️ 阈值不能定高 —— 试过 60 字，会把正常的三段文压成两段、七段通告塌成一坨。
  const out = [];
  for (const p of arr) {
    if (out.length && p.length < minLen) out[out.length - 1] += p;
    else out.push(p);
  }
  if (out.length >= 2 && out[0].length < minLen) {
    out[1] = out[0] + out[1];
    out.shift();
  }

  // 第二步：段数仍超上限时，反复合并"当前最短的相邻两段"。
  // 这样优先消化碎片，长段落尽量保持完整。
  while (out.length > maxParas) {
    let idx = 0;
    let min = Infinity;
    for (let i = 0; i < out.length - 1; i++) {
      const len = out[i].length + out[i + 1].length;
      if (len < min) {
        min = len;
        idx = i;
      }
    }
    out.splice(idx, 2, out[idx] + out[idx + 1]);
  }
  return out;
}

// ---------- 正文段落输出规格（2026-11-01 新增）----------
// 背景：此前只让模型输出 150-250 字摘要，抓到 2000+ 字原文也只用得上十分之一，
//       线上正文中位数仅 106 字，读者反馈"没看到什么具体的就没了"。
// 现改为「信息完整压缩版」：保留全部关键事实与数字，去掉铺垫与评论，
//       篇幅控制在 600-900 字（约原文的三到四成），比逐字机翻可读、比摘要完整。
const BODY_RULES = (targetLen) =>
  '\n【正文 body 写法 —— 严格遵守】\n' +
  `  · 输出字符串数组，每个元素是一个自然段，合计 ${targetLen} 字。\n` +
  '  · 第一段先说最重要的结果或结论，不要从背景写起。\n' +
  '  · 必须原样保留原文里的：具体数字、金额与货币、日期与时间节点、地名、人名及其职务、\n' +
  '    机构与企业名称、政策条款与适用条件、期限与生效范围。\n' +
  '  · 必须删掉：媒体评论与社论口吻、背景知识铺垫、重复表述、记者署名、\n' +
  '    社交平台留言引述、与事件无关的关联报道推荐。\n' +
  '  · 每段 2-4 句。按事件逻辑分段（原因/经过/影响/后续），不要机械对应原文段落。\n' +
  '  · **每个自然段至少 2 句，禁止单句成段**（原文全篇只有一两句时除外）。\n' +
  '  · **禁止连续多段用同一个主语开头**。例如连续五段都以「某机构表示」起首，\n' +
  '    这是把官网公告逐条搬过来的典型症状，必须合并成一段再叙述。\n' +
  '  · 段数宁少勿多：500 字以内用 3-4 段，700 字以上才用 5-6 段。\n' +
  '  · 原文若是滚动直播帖（多条带时间戳的快讯拼接），按主题合并成 3-6 段，\n' +
  '    不要把每条快讯各写成一段——那样读起来是一堆互不相关的碎片。\n' +
  '  · 禁止出现小标题、项目符号（-、·、1.）、加粗（**）、任何 Markdown 标记。\n' +
  '  · 禁止使用"据悉""值得一提的是""值得注意的是""总而言之""引发广泛关注""\n' +
  '    在当前形势下""业内人士指出"这类空话套话。\n' +
  '  · 只写原文确实写到的内容。不要补充你自己的背景知识，不要推测原文没说的结论，\n' +
  '    不要为了凑字数注水。原文信息少就写短，宁短勿编。\n';

/**
 * 按原文长度给正文目标字数。
 * 固定写「600-900 字」实测两头都不对：短讯被硬凑成注水文，长文反而缩到 300 字。
 */
function targetBodyLength(sourceLen) {
  if (sourceLen > 5000) return '700-900';
  if (sourceLen > 2000) return '500-700';
  if (sourceLen > 800) return '350-550';
  return '200-350';
}

/**
 * 规范化模型返回的正文。
 * 容忍三种形态：① 字符串数组（期望）② 含 \n\n 的整段字符串 ③ 带 Markdown 记号的文本。
 * @returns {string[]} 非空段落数组
 */
export function normalizeBody(raw) {
  if (!raw) return [];
  let paras = [];
  if (Array.isArray(raw)) {
    paras = raw.map((s) => String(s ?? ''));
  } else {
    paras = String(raw).split(/\n{2,}|\r\n{2,}/);
  }
  return paras
    .map((s) =>
      s
        .replace(/\r/g, '')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 小标题
        .replace(/^\s{0,3}[-*·•]\s+/gm, '') // 项目符号
        .replace(/^\s{0,3}\d+[.、)]\s+/gm, '') // 有序列表
        .replace(/\*\*(.+?)\*\*/g, '$1') // 加粗
        .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 链接只留文字
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((s) => s.length > 0 && s !== '—' && s !== '-');
}

// ---------- 专有名词保真（2026-11-07）----------
// 背景：模型对「名称保留原文」这条规则的遵守率极不稳定。同样的 prompt 连测三条，
//   结果分别是：①保留西里尔 ②音译成「瓦列沃」 ③把 Влада Јеринић 拆成「武契奇·耶里尼ћ」。
//   四轮提示词迭代（详细规则 → 白名单 → 正反示例 → 精简铁律）都没有改善，
//   小模型就是执行不了这种细粒度语义约束。
//
// 做法：把「识别哪些是专有名词」交给模型（这是语义判断，小模型能做好），
//   把「替换与还原」交给代码（确定性操作）。模型全程接触不到原名，也就无法音译。
//
// 流程：原文 ──AI提取──▶ 名称列表 ──代码占位──▶ [[N1]] 版原文 ──AI翻译──▶ 译文
//        ──代码还原──▶ 拉丁转写后的原名

// 塞尔维亚语西里尔 → 拉丁（官方 Gajica 对应，一一映射，无歧义）。
// 用代码转写而不是让模型转，因为这是纯查表工作，模型反而会出错（实测把
// Покрет 转成 Pomak、Bogoljub 转成 Bogođub）。
const CYR2LAT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z', и: 'i',
  ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', ћ: 'ć', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'č', џ: 'dž', ш: 'š',
};

/** 西里尔转拉丁，保留原有大小写（Љ→Lj 而不是 LJ）。 */
export function cyrillicToLatin(s) {
  return String(s).replace(/[\u0400-\u04FF]/g, (ch) => {
    const lower = ch.toLowerCase();
    const mapped = CYR2LAT[lower];
    if (!mapped) return ch;
    if (ch !== lower) return mapped.charAt(0).toUpperCase() + mapped.slice(1);
    return mapped;
  });
}


// 机构类后缀：这些词小写时仍可能是专名的一部分（如 "Alta banka"、"Nova televizija"）
const ORG_WORDS = [
  'banka', 'банка', 'televizija', 'телевизија', 'univerzitet', 'универзитет',
  'bolnica', 'болница', 'škola', 'школа', 'opština', 'општина',
  'ministarstvo', 'министарство', 'agencija', 'агенција',
  'kompanija', 'компанија', 'klub', 'клуб', 'fond', 'фонд',
  'institut', 'институт', 'aerodrom', 'аеродром', 'hotel', 'хотел',
  'sud', 'суд', 'zavod', 'завод',
];
const ORG_SUFFIX = new RegExp(`^(${ORG_WORDS.join('|')})$`, 'iu');
const ORG_SUFFIX_ANY = new RegExp(`\\b(${ORG_WORDS.join('|')})\\b`, 'iu');

/**
 * 判断抽取结果是否真的是专名。
 *
 * 模型会把「形容词 + 普通名词」当成名称抽出来（实测：Италијанска премијерка
 * = 意大利总理、дарк вебу = 暗网、Холандска војна полиција = 荷兰军警）。
 * 这些一旦被占位保护，译文里就会出现「Italijanska premijerka 表示…」这种鬼话。
 *
 * 判定规则（宁严勿宽，漏掉的顶多被音译，误留的会毁掉整句）：
 *   · 单词：首字母必须大写
 *   · 多词：每个词都必须大写开头；或最后一词是机构后缀且前面都是大写（Alta banka）
 */
function looksLikeProperName(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const isCap = (w) => /^\p{Lu}/u.test(w);
  if (words.length === 1) return isCap(words[0]);
  if (words.every(isCap)) return true;
  // 机构名中间常夹小写词（Narodna banka Srbije），只要含机构后缀且首词大写就认
  if (ORG_SUFFIX_ANY.test(String(name)) && isCap(words[0])) return true;
  return ORG_SUFFIX.test(words[words.length - 1]) && words.slice(0, -1).every(isCap);
}

// 国家与大城市：提示词已要求不要抽，但模型偶尔仍会抽出变格形式（Украјини）。
// 这里按拉丁转写后的词根做兜底剔除，避免译文里冒出 "Ukrajini"。
const NAME_BLOCK_STEMS = [
  'ukrajin', 'srbij', 'beograd', 'novi sad', 'kosov', 'crna gora', 'hrvatsk',
  'rusij', 'evropsk', 'nato', 'rim', 'brisel', 'kin', 'amerik', 'nemačk',
  'italij', 'francusk', 'mađarsk', 'rumun', 'bugarsk', 'grčk', 'tursk',
];

function isBlockedCommon(name) {
  const lat = cyrillicToLatin(name).toLowerCase();
  return NAME_BLOCK_STEMS.some((stem) => lat.startsWith(stem));
}

/**
 * 把原文里的西里尔专名就地转成拉丁（Ваљево→Valjevo）。
 * 模型看到拉丁专名时保留率明显高于看到占位符——实测占位符方案会整段被删掉，
 * 因为模型的任务是"编译成流畅中文"，遇到读不懂的标记就跳过。
 * @param {string} text
 * @param {string[]} names
 */
export function latinizeNames(text, names) {
  let out = String(text);
  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const lat = cyrillicToLatin(name);
    if (lat === name) continue; // 本来就是拉丁，不动
    if (out.includes(name)) out = out.split(name).join(lat);
  }
  return out;
}

/**
 * 第一阶段：让模型列出原文里必须保留原样的专有名词。
 * 失败（无 key / 限流 / 解析不出来）时返回空数组，调用方退化为纯翻译，不阻塞流程。
 * @returns {Promise<string[]>} 原文写法（西里尔或拉丁）的名称列表
 */
export async function extractNames(text) {
  const t = await callAI(
    '你是塞尔维亚语新闻的术语抽取器。任务单一：从原文中列出所有必须保留原文写法的专有名词。' +
      '严格输出 JSON 字符串数组，如 ["Ваљево","Влада Јеринић"]。不要输出数组以外的任何内容。\n' +
      '【只抽「塞尔维亚本地」的名称】—— 读者要拿这些名字去对照路牌、招牌、账单和官方文件：\n' +
      '  · 塞尔维亚的城镇、乡村、街道、小区、区名（贝尔格莱德等大城市除外）\n' +
      '  · 塞尔维亚本地的企业、银行、学校、医院、法院、机构、媒体、俱乐部、球队、赛事、产品\n' +
      '  · 塞尔维亚人名\n' +
      '【绝对不抽】\n' +
      '  · 国家名：塞尔维亚、中国、俄罗斯、美国、乌克兰、意大利、荷兰等一切国家\n' +
      '  · 国际城市：贝尔格莱德、诺维萨德、尼什、阿姆斯特丹、布鲁塞尔、罗马、柏林、\n' +
      '    巴黎、伦敦、莫斯科、华盛顿等外国主要城市（这些有通行中文译名）\n' +
      '  · 外国知名人物：武契奇、习近平、普京、梅洛尼、塔亚尼等有通行中文译名的\n' +
      '  · 国际组织：欧盟、北约、联合国、世卫组织\n' +
      '  · 职务（总统、部长、市长）、普通名词、日期、数字、金额、单纯的形容词\n' +
      '【规则】\n' +
      '  · 用原文写法，西里尔就写西里尔，不要翻译或转写。\n' +
      '  · 只取名称本身，去掉前面的介词、冠词和后面的标点。\n' +
      '  · 按出现顺序，去重，最多 30 个。',
    String(text).slice(0, 6000)
  );
  if (!t) return [];
  const m = String(t).match(/\[[\s\S]*?\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => typeof x === 'string')
      .map((x) => x.trim())
      .filter((x) => x.length >= 2 && /[\p{L}]/u.test(x))
      .filter(looksLikeProperName)
      .filter((x) => !isBlockedCommon(x))
      .slice(0, 40);
  } catch {
    return [];
  }
}

/**
 * 兜底解析：模型偶尔无视 JSON 要求，只回一个裸类别词（如 "policy"）。
 * 实测这是解析失败的主因 —— 模型答对了，是解析器把答案扔了。
 */
function parseBareCategory(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/[\s"'`。，,.：:]/g, '');
  for (const k of RELEVANCE_CATEGORIES) if (t === k || t.startsWith(k)) return { type: k };
  return null;
}

export async function translateNews(title, content) {
  const src = content.slice(0, AI_CONTENT_LIMIT);

  // 阶段一：抽取专有名词。抽取失败不影响主流程，退化为纯翻译。
  let names = [];
  try {
    names = await extractNames(`${title}\n${src}`);
  } catch {
    names = [];
  }
  // 转成拉丁（西里尔名由代码查表转写，确定无误），模型只需照抄这些拉丁词
  const latinNames = [...new Set(names.map((n) => cyrillicToLatin(n)))].filter((n) =>
    /^[\p{Lu}]/u.test(n)
  );
  const mTitle = latinizeNames(title, names);
  const mSrc = latinizeNames(src, names);

  const nameRule = latinNames.length
    ? '【译文里必须原样出现的名称 —— 最高优先级】\n' +
      `  ${latinNames.join('、')}\n` +
      '  · 上面每个名称都必须在译文中原样出现，一个都不能少、不能删、不能改拼写。\n' +
      '  · 绝对不许把它们换成中文音译（Valjevo 不能写成「瓦列沃」），也不许换成\n' +
      '    「某地」「该市」「这家银行」这类笼统说法糊弄过去。\n' +
      '  · 可以按中文语序调整位置，但名字本身必须逐字保留。\n'
    : '';

  const text = await callAI(
    '你是中塞双语新闻编辑。把塞尔维亚语/英语新闻编译成简体中文，供在塞尔维亚的华人阅读。' +
      '必须严格输出 JSON，格式：{"title":"中文标题","summary":"导语","body":["段落1","段落2"],"tags":["标签1","标签2"],"type":"类别词","d":布尔}。' +
      '不要输出 JSON 以外的任何内容。\n' +
      nameRule +
      '【其他名称】不在上面清单里的，用通行中文译名 —— 国家、国际城市、外国名人、\n' +
      '  国际组织都属于这一类（阿姆斯特丹、布鲁塞尔、罗马、梅洛尼都用中文）。\n' +
      '  但如果遇到塞尔维亚本地的小地名、小机构而清单里漏了，请保留原文，不要音译。\n' +
      '【title】不超过 30 字，说清发生了什么，不用问句、不用感叹号。\n' +
      '【summary】60-100 字的一句话导语，只概括最核心的事实，不重复标题。\n' +
      '【tags】2-4 个中文标签，每个 2-5 字，写主体对象与主题（如「贝尔格莱德」「电价」「签证」）。\n' +
      BODY_RULES(targetBodyLength(src.length)) +
      RELEVANCE_RUBRIC,
    `原标题：${mTitle}\n原文：${mSrc}`
  );
  const j = parseJson(text);
  if (!j) return j;
  j.body = mergeShortParagraphs(normalizeBody(j.body));
  j.relevance = deriveScore(j);
  return j;
}

/**
 * 中文新闻整理（中文源不需要翻译，只做结构化与排版）
 */
export async function polishChinese(title, content) {
  const text = await callAI(
    '你是中文新闻编辑。把给定的中文原文整理成适合华人读者阅读的版本。' +
      '注意：这是中文源，你的任务是**整理**不是改写——不扩写、不补充原文没有的信息、不改变事实口径。' +
      '必须严格输出 JSON，格式：{"title":"标题","summary":"导语","body":["段落1","段落2"],"tags":["标签1","标签2"],"type":"类别词","d":布尔}。' +
      '不要输出 JSON 以外的任何内容。\n' +
      '【title】沿用原标题的表述，只在超过 30 字时精简，不要另起新标题。\n' +
      '【summary】60-100 字导语。\n' +
      '【body】把原文按自然段拆成数组，保留原文的全部句子和信息，只做以下处理：\n' +
      '  · 删掉网页残留（"来源：xxx""编辑：xxx""扫一扫关注"、分享按钮文字、责任编辑署名）；\n' +
      '  · 按语义切成 2-6 段，每段 2-4 句，段与段之间逻辑递进；\n' +
      '  · 原文的换行不等于段落边界：同一句话被换行拆开的必须合并成一句，\n' +
      '    不要出现"因端午假期，"单独成段这种断句；\n' +
      '  · 发文单位署名与日期并入最后一段（原文只有署名没有正文时则整段删掉），\n' +
      '    不要各占一段；\n' +
      '  · 去掉小标题、项目符号、加粗等 Markdown 标记；\n' +
      '  · 原文只有一两句话就保持一两句话，绝不注水扩写。\n' +
      '【tags】2-4 个中文标签。\n' +
      RELEVANCE_RUBRIC,
    `原标题：${title}\n原文：${content.slice(0, AI_CONTENT_LIMIT)}`
  );
  const j = parseJson(text);
  if (!j) return j;
  j.body = mergeShortParagraphs(normalizeBody(j.body));
  j.relevance = deriveScore(j);
  return j;
}
