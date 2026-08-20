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
              max_tokens: 1024,
            }),
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            if (process.env.SCRAPER_DEBUG)
              console.error(`[ai] ${provider.name}/${model} HTTP ${resp.status}:`, JSON.stringify(err).slice(0, 120));
            // 1305 = 访问量过大（限流），换下一个模型/提供商
            if (err?.error?.code === '1305') continue;
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
export async function translateNews(title, content) {
  const text = await callAI(
    '你是中塞双语新闻编辑。将塞尔维亚语/英语新闻翻译成简体中文，并提取关键信息。' +
      '必须严格输出 JSON，格式：{"title":"中文标题","summary":"80字以内中文摘要","tags":["标签1","标签2"]}。不要输出其他内容。',
    `原标题：${title}\n原文：${content.slice(0, 1500)}`
  );
  return parseJson(text);
}

/**
 * 中文新闻精炼（生成更吸引人的标题 + 摘要）
 */
export async function polishChinese(title, content) {
  const text = await callAI(
    '你是中文新闻编辑。将给定新闻改写为更简洁、适合华人读者阅读的版本。' +
      '必须严格输出 JSON，格式：{"title":"优化后的标题","summary":"80字以内摘要","tags":["标签1","标签2"]}。不要输出其他内容。',
    `原标题：${title}\n正文：${content.slice(0, 1500)}`
  );
  return parseJson(text);
}
