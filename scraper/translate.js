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
export const AI_CONTENT_LIMIT = 4000;
// 判定"内容太短、需要去抓详情页"的阈值（字符，去空白后）
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
              max_tokens: 2048,
            }),
            signal: AbortSignal.timeout(30000), // 30s 超时，防止 API 挂起卡死整个采集
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
  const text = await callAI(
    '你是中塞双语新闻编辑。将塞尔维亚语/英语新闻翻译成简体中文，并提取关键信息。' +
      '必须严格输出 JSON，格式：{"title":"中文标题","summary":"150-250字中文摘要（保留关键事实、数据、时间、地点，宁详勿略）","tags":["标签1","标签2"],"type":"类别词","d":布尔}。不要输出其他内容。\n' +
      RELEVANCE_RUBRIC,
    `原标题：${title}\n原文：${content.slice(0, AI_CONTENT_LIMIT)}`
  );
  const j = parseJson(text);
  if (!j) return j;
  j.relevance = deriveScore(j);
  return j;
}

/**
 * 中文新闻精炼（生成更吸引人的标题 + 摘要）
 */
export async function polishChinese(title, content) {
  const text = await callAI(
    '你是中文新闻编辑。将给定新闻改写为更简洁、适合华人读者阅读的版本，保留关键事实、数据、时间、地点。' +
      '必须严格输出 JSON，格式：{"title":"优化后的标题","summary":"150-250字中文摘要（宁详勿略）","tags":["标签1","标签2"],"type":"类别词","d":布尔}。不要输出其他内容。\n' +
      RELEVANCE_RUBRIC,
    `原标题：${title}\n正文：${content.slice(0, AI_CONTENT_LIMIT)}`
  );
  const j = parseJson(text);
  if (!j) return j;
  j.relevance = deriveScore(j);
  return j;
}
