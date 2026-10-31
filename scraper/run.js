// 中塞通 · 自动采集主流程
// 用法：ZHIPU_API_KEY=xxx node run.js   （无 key 也能跑，只采集中文源）
// 输出：在 src/content/items/ 生成 .md 文件，push 后自动部署上线

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { SOURCES, TOPIC_KEYWORDS, SR_TOPIC_KEYWORDS, BLOCK_WORDS, matchAnyKeyword } from './sources.js';
import { translateNews, polishChinese, hasKey } from './translate.js';
import { fetchOgImage } from './og-image.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ITEMS_DIR = path.resolve(__dirname, '../src/content/items');
const STATE_FILE = path.join(__dirname, 'state.json');

// 去重窗口（天）：窗口外的旧标题允许重新收录（避免"同题新闻发过一次就永远不抓"）
const DEDUP_WINDOW_DAYS = 14;
const DAY_MS = 86400000;

// AI 相关度门槛（0-10）。低于此分的条目不进审核队列（写盘但标 status: expired）。
// 打分口径见 translate.js 的 RELEVANCE_RUBRIC。想临时放宽：
//   RELEVANCE_MIN=5 node run.js     想全部放行：RELEVANCE_MIN=0 node run.js
const RELEVANCE_MIN = Number(process.env.RELEVANCE_MIN ?? 7);

// 加载本地 .env（GitHub Actions 中由 secrets 注入；已显式设置的环境变量优先级更高）
try {
  const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch {
  /* .env 不存在则忽略 */
}

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
});

// ---------- 去重：收集现有 items 的 source+title ----------
// 双源去重：
//  1) 本地 ITEMS_DIR 现有文件（loadExisting）
//  2) 若配置了 GH_TOKEN（GitHub Actions 场景），再用 mergeRemoteKeys 拉取远程 main 的
//     items 清单合并进去重集合，避免「干净 checkout 工作区只有远程部分内容 → 把已存在
//     的新闻重新抓一遍」的重复。
// 时间窗口：只对 DEDUP_WINDOW_DAYS 天内已发的同源同题去重；窗口外的旧题允许重新收录。
function loadExisting() {
  const seen = new Set();
  const clean = (s) => (s ?? '').replace(/^"+|"+$/g, '').trim();
  if (fs.existsSync(ITEMS_DIR)) {
    for (const f of fs.readdirSync(ITEMS_DIR)) {
      if (!f.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(ITEMS_DIR, f), 'utf8');
      const source = clean(content.match(/^source:\s*(.+)$/m)?.[1]);
      const srcTitle = clean(content.match(/^sourceTitle:\s*(.+)$/m)?.[1]);
      const title = srcTitle || clean(content.match(/^title:\s*(.+)$/m)?.[1]);
      if (!title) continue;
      // 只把窗口内（近期）的标题加入去重集，窗口外旧题可重新抓
      const dateM = content.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m)?.[1];
      let isRecent = false;
      if (dateM) {
        const diff = Date.now() - new Date(dateM).getTime();
        isRecent = diff >= 0 && diff < DEDUP_WINDOW_DAYS * DAY_MS;
      } else {
        // 无日期字段的旧文件，按文件修改时间判断
        const mtime = fs.statSync(path.join(ITEMS_DIR, f)).mtimeMs;
        isRecent = Date.now() - mtime < DEDUP_WINDOW_DAYS * DAY_MS;
      }
      if (isRecent) seen.add(`${source}|${title}`);
    }
  }
  return seen;
}

// 把远程 main 的 items 去重键并入集合（异步；失败静默，不阻断抓取）
async function mergeRemoteKeys(seen) {
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!ghToken) return;
  const repo = process.env.GITHUB_REPO || 'longandy186/zhongsaitong';
  try {
    const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees/main?recursive=1`, {
      headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'zhongsaitong-run', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!treeRes.ok) return;
    const tree = await treeRes.json();
    const paths = (tree.tree || [])
      .filter((t) => t.path.startsWith('src/content/items/') && t.path.endsWith('.md'))
      .map((t) => t.path);
    const clean = (s) => (s ?? '').replace(/^"+|"+$/g, '').trim();
    for (const p of paths) {
      try {
        const r = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(p)}`, {
          headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'zhongsaitong-run', Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) continue;
        const j = await r.json();
        const content = Buffer.from(j.content, 'base64').toString('utf8');
        const source = clean(content.match(/^source:\s*(.+)$/m)?.[1]);
        const srcTitle = clean(content.match(/^sourceTitle:\s*(.+)$/m)?.[1]);
        const title = srcTitle || clean(content.match(/^title:\s*(.+)$/m)?.[1]);
        if (!title) continue;
        // 同本地逻辑：只对窗口内（14 天）的标题去重，旧题允许重新收录
        const dateM = content.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m)?.[1];
        let isRecent = false;
        if (dateM) {
          const diff = Date.now() - new Date(dateM).getTime();
          isRecent = diff >= 0 && diff < DEDUP_WINDOW_DAYS * DAY_MS;
        }
        if (isRecent) seen.add(`${source}|${title}`);
      } catch {
        /* 单条失败忽略 */
      }
    }
    console.log(`[run] 已合并远程 main 去重键 ${paths.length} 个`);
  } catch (e) {
    console.warn('[run] 合并远程去重键失败（忽略）:', e.message);
  }
}

// ---------- 关键词命中 ----------
// 用 sources.js 的 matchAnyKeyword：前边界严格（uništena 不再命中 Niš），
// 后边界按 SR_WHOLE_WORDS 决定是否放开。不要退回 t.includes()——那会放进
// Lukašenko（命中 luka）、stanovnica（命中 stan）这类完全无关的内容。
function hitKeywords(text, keywords) {
  return matchAnyKeyword(text, keywords);
}

// ---------- 自动分类（用于审核筛选）：中塞 / 生活 / 其他 ----------
const CNRS_WORDS = ['中国', '塞尔维亚', '中塞', '匈塞', '贝尔格莱德', '华商', '华人', '在塞', '赴塞', '塞国', 'kina', 'kinesk', 'china', 'serbia'];
const LIFE_WORDS = [
  '签证', '居留', '工作许可', '工作', '就业', '租房', '买房', '房价', '物价', '通胀',
  '汇率', '换汇', '医疗', '医院', '医保', '疫苗', '学校', '教育', '留学', '交通',
  '天气', '税务', '养老金', '补贴', '工资', '驾照', '保险', '使馆', '领事', '航班',
  '机场', '公交', '地铁', '水电', '网络', '电话', '银行', '超市', '移民', '入籍',
  '放假', '假期', '节假日', '节日',
];
function classifyTopic(text) {
  const t = (text || '').toLowerCase();
  if (CNRS_WORDS.some((w) => t.includes(w))) return '中塞';
  if (LIFE_WORDS.some((w) => t.includes(w))) return '生活';
  return '其他';
}

// 租房类：从中文正文尽力抽取价格/地段（v1 粗提取，后续可接结构化解析）
function extractRental(text) {
  const t = text || '';
  const priceM = t.match(/(\d[\d\s.,]*\d|\d)\s*(欧元|欧|€|EUR|RSD|第纳尔|din\b|rsd\b)/i);
  const price = priceM ? priceM[0].replace(/\s+/g, '') : '';
  const locM = t.match(/(?:位于|地点|区域|在|靠近|近)\s*([一-龥A-Za-z·]+?)(?:区|市|附近|一带|周边|站|中心)/);
  const location = locM ? locM[1] : '';
  return { price, location };
}

// ---------- 详情页补全文 ----------
// RSS 摘要通常只有 1-2 句话，导致翻译/精炼后正文太短。
// 对配置了 articleSelector 的源，抓详情页正文补进 content，AI 才有足够素材。
//
// 2026-11-01 调整：
//   · 上限 4000 → 8000 字符（4000 只够覆盖长文前 60%，后半段信息全丢）
//   · 选择器支持数组，逐个试到取到正文为止（B92/Nova 等站点改版频繁）
//   · 显式移除 script/style/iframe 后再取文本 —— B92 的正文容器尾部混着
//     googletag.cmd.push(...) 广告脚本，不清理会被当成正文送去翻译
//   · 超时 8s → 12s（塞语大站页面 300KB+）
const ARTICLE_TEXT_LIMIT = Number(process.env.ARTICLE_TEXT_LIMIT ?? 8000);

// 塞语媒体的 UI 噪声文案（按钮 / 导航 / 评论区标签），不是正文
const UI_NOISE_HEAD =
  /^(Postavi kao omiljeni Google izvor|Dodaj u omiljene|Dodaj komentar|Podeli|Prati nas|Pretplati se|Pročitaj više)\s*/i;
// ⚠️ 尾正则必须用有限长度模式，不能用 [^]* ——
//    那会把正文里出现「Pročitaj više o:」之后的全部内容一起吃掉（贪婪到结尾）。
//    包在 div/span 里的推荐位、标签云已由 pickText 的 <p> 提取策略甩掉，这里只需收尾。
const UI_NOISE_TAIL =
  /(?:\s*(?:Komentari\s*\d*|Pogledaj komentare|Pošalji komentar|Podeli:?|Prati nas|Foto:\s*\S+|Izvor:\s*\S+))+\s*$/i;
// 文章头部元信息：RTS 等源正文以「субота, 31.10.2026, 20:06 -> 21:04 Извор: РТС Аутор: xxx」开头
const ARTICLE_DATE_HEAD =
  /^(?:[\p{L}]{4,10}\s*,\s*)?\d{1,2}\.\d{1,2}\.\d{4}\.?\s*[,·]?\s*\d{1,2}:\d{2}(?:\s*(?:->|→|–|-)\s*\d{1,2}:\d{2})?\s*/u;
// 来源行「Извор: РТС」与署名「Аутор: Андрија Игић」分开处理：
// 合成一条正则时，可选第二词会把 "Аутор:" 当成来源名的第二个词吃掉，导致署名残缺。
const ARTICLE_SOURCE_HEAD = /^(?:Извор|Izvor)\s*:\s*\S+\s*/iu;
// 作者名按「两个首字母大写的词」匹配，避免把正文首词误当姓名吞掉
const ARTICLE_BYLINE_HEAD = /^(?:Аутор|Autor)\s*:\s*[\p{Lu}][\p{Ll}]*\s+[\p{Lu}][\p{Ll}]*\s*/u;
// 「阅读更多 / 相关报道 / 推荐」引导语。命中即截断，但只在其位于文本后段时才动手，
// 防止正文中间恰好出现同名词被误切。
const TAIL_MARKER = /Pročitaj više o:|Pročitajte još:|Povezane vesti|Preporučujemo|Pročitajte takođe/iu;

function cleanArticleText(raw) {
  let t = String(raw)
    .replace(/\s+/g, ' ')
    .replace(/Foto:\s*\S+/gi, '')
    .replace(/^(Uz video|Video|Foto|Pogledajte)\b.*?$/gm, '')
    .replace(/googletag[\s\S]*$/i, '') // 广告脚本尾缀
    .trim();
  // 头部的日期/来源/署名只在开头处理，避免误伤正文里出现的同名词
  t = t.replace(ARTICLE_DATE_HEAD, '');
  t = t.replace(ARTICLE_SOURCE_HEAD, '');
  t = t.replace(ARTICLE_BYLINE_HEAD, '');
  // 尾部推荐位：仅当标记落在文本后 25% 处才截断
  const cut = t.search(TAIL_MARKER);
  if (cut > 0 && cut > t.length * 0.75) t = t.slice(0, cut).trim();
  t = t.replace(UI_NOISE_HEAD, '').replace(UI_NOISE_TAIL, '').trim();
  return t;
}

/**
 * 从详情页取正文。
 * 策略：容器内若有多段 <p>，只取 <p> 的文本 —— 这样能自动甩掉包在 div/span 里的
 *      按钮文案、评论区导航、标签列表（B92/RTS 的噪声都在 p 外面）。
 *      没有 <p> 的页面（如使馆公文，正文是纯文本 + <br>）则退回整容器文本。
 * @returns {string} 清洗后的正文，取不到则空串
 */
function pickText($, selectors) {
  for (const sel of [].concat(selectors)) {
    const $el = $(sel).first();
    if (!$el.length) continue;
    // 克隆一份再删噪声节点，避免破坏后续选择器匹配
    const $c = $el.clone();
    $c.find('script,style,noscript,iframe,form,button,video,audio,svg').remove();
    $c.find('figcaption,.caption,.photo-caption,.related,.share,.social,.advert,.advertisement').remove();

    const $p = $c.find('p');
    const raw = $p.length >= 2 ? $p.toArray().map((el) => $(el).text()).join(' ') : $c.text();
    const text = cleanArticleText(raw);

    // 命中选择器但正文极短（使馆放假通知只有 80 字）也照收 —— 那是原文真实长度，
    // 不能当成"没抓到"而回退到更长但更脏的兜底容器。
    // 首个候选选择器（源显式配置的）用低阈值，兜底的 'article' 才用高阈值。
    const isPrimary = sel === [].concat(selectors)[0];
    const minLen = isPrimary ? 20 : 120;
    if (text.length >= minLen) return text;
  }
  return '';
}

async function fetchFullArticle(item, selectors) {
  if (!item.link || !selectors) return '';
  try {
    const resp = await fetch(item.link, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return '';
    const html = await resp.text();
    const $ = cheerio.load(html);
    const cands = [].concat(selectors);
    // 额外兜底：article 标签（部分源未单独配置选择器）
    const text = pickText($, [...cands, 'article']);
    return text.slice(0, ARTICLE_TEXT_LIMIT);
  } catch {
    return ''; // 详情页失败静默，回退 RSS 摘要
  }
}

// 取「更值得用」的正文：详情页正文与 RSS 摘要取长者。
// 有些源 RSS 本身就带全文（content:encoded），此时抓回的可能反而是摘要页。
function pickRichest(rssContent, fullText) {
  const a = (rssContent ?? '').trim();
  const b = (fullText ?? '').trim();
  return b.length > a.length ? b : a;
}

// ---------- HTML 抓取（使馆公告） ----------
async function fetchHtmlSource(source) {
  const resp = await fetch(source.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();
  const $ = cheerio.load(html);
  const items = [];
  const base = new URL(source.url).origin;
  $(source.selector).each((_, el) => {
    const $a = $(el);
    const title = $a.text().trim().replace(/\s+/g, ' ');
    if (!title) return;
    const rawHref = $a.attr('href') ?? '';
    if (!rawHref) return;
    // 跳过非文章链接（如 js 或分类页）
    if (/\.htm|\.shtml|\.html/.test(rawHref)) {
      let link;
      try {
        link = new URL(rawHref, source.url).href;
      } catch {
        link = base + rawHref.replace(/^\.\//, '/');
      }
      // 提取标题尾部日期（使馆格式："标题（2026-04-22）"）
      const m = title.match(/^(.*)（(\d{4}-\d{2}-\d{2})）$/);
      const cleanTitle = m ? m[1].trim() : title;
      const pubDate = m ? new Date(m[2]) : new Date();
      items.push({ title: cleanTitle, link, content: '', pubDate });
    }
  });
  // 去重并限制条数
  const seen = new Set();
  const uniq = [];
  for (const it of items) {
    if (seen.has(it.link)) continue;
    seen.add(it.link);
    uniq.push(it);
    if (uniq.length >= 15) break;
  }
  return uniq;
}

// 从 RSS item 抽取图片：enclosure / media:content / content 内 <img>
function extractImages(it) {
  const imgs = [];
  const push = (u) => {
    if (u && /^https?:\/\//i.test(u) && !imgs.includes(u)) imgs.push(u);
  };
  // 1) enclosure
  if (it.enclosure?.url) push(it.enclosure.url);
  // 2) media:content（rss-parser 放到 it['media:content'] 或 it.media）
  const media = it['media:content'] ?? it.media?.['media:content'];
  if (Array.isArray(media)) media.forEach((m) => push(m?.$.url || m?.url));
  else if (media?.$.url) push(media.$.url);
  // 3) content 里的 <img>
  const html = it['content:encoded'] ?? it.content ?? '';
  if (html) {
    const $ = cheerio.load(html);
    $('img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original');
      push(src);
    });
  }
  return imgs.slice(0, 5); // 最多保留 5 张
}

// 图片三级兜底：RSS/正文抽到的图 → 详情页 og:image → 源级 fallbackImage（品牌封面）
// 背景：RTS 的 RSS 完全不带 enclosure/media/正文 img（256 条全无图），
//       使馆源是 HTML 抓取且页面只有 logo，同样抽不到图。
async function resolveImages(source, item) {
  const own = (item.images ?? []).filter(Boolean);
  if (own.length) return own;
  // source.ogImage === false 可关闭（如详情页 og:image 是站点 logo 的源）
  if (source.ogImage !== false && item.link) {
    const og = await fetchOgImage(item.link);
    if (og) return [og];
  }
  if (source.fallbackImage) return [source.fallbackImage];
  return [];
}

// ---------- RSS 抓取 ----------
async function fetchRssSource(source) {
  const feed = await parser.parseURL(source.url);
  // RSS 内部去重（按链接）
  const seenLinks = new Set();
  const items = (feed.items ?? [])
    .slice(0, source.maxItems ?? 25)
    .map((it) => ({
      title: (it.title ?? '').trim().replace(/\s+/g, ' '),
      link: it.link ?? it.guid ?? '',
      content: (it.contentSnippet ?? it.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      images: extractImages(it),
      pubDate: it.isoDate ? new Date(it.isoDate) : new Date(),
    }))
    .filter((it) => it.title && !seenLinks.has(it.link) && seenLinks.add(it.link));
  // 关键词过滤：
  //  - 源显式给了 keywords → 按源关键词过滤（中文国际媒体按中塞关键词筛）
  //  - 空 keywords：
  //    · 塞语源（lang='sr'）→ 回退 SR_TOPIC_KEYWORDS（中塞+实用主题），避免全量翻译浪费 token
  //    · 其他（使馆公告等）→ 全量收录
  let keywords = source.keywords ?? [];
  if (!keywords.length && source.lang === 'sr') keywords = SR_TOPIC_KEYWORDS;
  const filtered = keywords.length
    ? items.filter((it) => hitKeywords(`${it.title} ${it.content}`, keywords))
    : items;
  return filtered;
}
// ---------- 生成 .md ----------
function buildMd(entry) {
  const { source, item, category, kind, finalTitle, body, note, topic, autoPublish, price, location, contact, summary, images, relevance, statusOverride } = entry;
  const d = item.pubDate ?? new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const tags = item.tags?.length ? item.tags : [autoPublish ? '租房' : '新闻'];
  const esc = (s) => `"${String(s).replace(/"/g, "'")}"`;

  // 自动发布类（如租房）：直接 active + 30 天过期，不经飞书审核
  const fmLines = [
    '---',
    `title: ${esc(finalTitle)}`,
    `sourceTitle: ${esc(item.title)}`,
    `category: ${category}`,
    `kind: ${kind}`,
    `date: ${dateStr}`,
    `scrapedAt: ${new Date().toISOString()}`,
    `status: ${autoPublish ? 'active' : statusOverride ?? 'pending'}`,
  ];
  if (autoPublish) {
    const exp = new Date(d.getTime() + 30 * 86400000);
    const expStr = `${exp.getFullYear()}-${String(exp.getMonth() + 1).padStart(2, '0')}-${String(
      exp.getDate()
    ).padStart(2, '0')}`;
    fmLines.push(`expireAt: ${expStr}`);
  }
  fmLines.push(`source: ${esc(source.name)}`);
  fmLines.push(`topic: ${autoPublish ? '生活' : topic ?? '其他'}`);
  if (Number.isFinite(relevance)) fmLines.push(`relevance: ${relevance}`);
  if (price) fmLines.push(`price: ${esc(price)}`);
  if (location) fmLines.push(`location: ${esc(location)}`);
  if (contact) fmLines.push(`contact: ${esc(contact)}`);
  if (summary) fmLines.push(`summary: ${esc(summary)}`);
  if (images?.length) fmLines.push(`images: [${images.map((u) => `"${u}"`).join(', ')}]`);
  fmLines.push(`tags: [${tags.map((t) => `"${t}"`).join(', ')}]`);
  fmLines.push('---', '');
  const fm = fmLines.join('\n');

  // 正文：每个段落独立成段（Markdown 用空行分段）。
  // 注意段落之间必须留空行，否则 Astro 会把整篇渲染成一个 <p>——这正是
  // 旧版正文"一大坨字、扫两眼就到底"的直接原因。
  const paragraphs = (body ?? [])
    .map((p) => String(p ?? '').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);

  // 出处行：只列原站链接，不写"自动采集/AI 翻译"之类的机械说明。
  const credit = item.link ? `> 原文：[${item.title}](${item.link})` : `> 来源：${source.name}`;

  const lines = [
    `# ${finalTitle}`,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    credit,
  ];
  return fm + lines.join('\n');
}

// 功能性页面标题（使馆站内导航类，跳过）
const FUNCTIONAL_TITLES = ['联系我们', '收藏本站', '设为首页', '网站地图', '版权声明', '免责声明'];

// ---------- 对单条新闻做翻译/精炼 ----------
async function processEntry(source, item) {
  // 敏感词拦截
  if (BLOCK_WORDS.some((w) => item.title.toLowerCase().includes(w.toLowerCase()))) return null;
  // 功能性页面跳过
  if (FUNCTIONAL_TITLES.some((w) => item.title.includes(w))) return null;

  let finalTitle = item.title;
  let summary = item.content.slice(0, 400);
  let body = [];
  let tags = null;
  let note = '';
  let price, location, contact;
  let relevance = null; // AI 相关度 0-10（null=未评分）

  // 详情页补全文：只要源配置了 articleSelector 就**一律抓**，
  // 不再以「RSS 摘要短于 300 字」为前提 —— RSS 摘要常常有 300-500 字但依然不是全文，
  // 旧逻辑在这里漏抓了一大批。抓回来和 RSS 内容取长者（见 pickRichest）。
  let content = item.content;
  if (source.articleSelector) {
    const full = await fetchFullArticle(item, source.articleSelector);
    content = pickRichest(item.content, full);
  }

  if (source.autoPublish) {
    // 自动发布类（如租房）：保留原文，不做 AI 改写，避免误改价格/户型等关键信息
    if (source.category === 'rentals') {
      const ex = extractRental(`${item.title} ${item.content}`);
      price = ex.price;
      location = ex.location;
    }
    body = content ? [content] : [];
  } else if (source.lang === 'sr') {
    // 塞尔维亚语 → 中文编译（输出分段正文）
    const t = await translateNews(item.title, content);
    if (t) {
      finalTitle = t.title;
      if (t.summary) summary = t.summary;
      body = t.body ?? [];
      tags = t.tags;
      relevance = t.relevance ?? null;
      note = 'AI 翻译';
    } else {
      // 无翻译能力则跳过塞语内容
      return null;
    }
  } else if (hasKey()) {
    // 中文源整理（不翻译，只做结构化与排版）
    const p = await polishChinese(item.title, content);
    if (p?.title) {
      finalTitle = p.title;
      if (p.summary) summary = p.summary;
      body = p.body ?? [];
      tags = p.tags;
      relevance = p.relevance ?? null;
      note = 'AI 整理';
    }
  }

  // 兜底：AI 未返回正文（无 key / 解析失败 / 模型没按要求输出），
  // 用摘要或原文顶上，保证页面不会是空壳。
  if (!body.length) {
    if (summary) body = [summary];
    else if (content) body = [content.slice(0, 1200)];
  }

  return {
    source,
    item: { ...item, tags },
    category: source.category,
    kind: source.kind,
    autoPublish: !!source.autoPublish,
    finalTitle,
    topic: classifyTopic(`${finalTitle} ${summary} ${body.join(' ')}`),
    body,
    note,
    price,
    location,
    contact,
    summary,
    relevance,
    images: await resolveImages(source, item),
  };
}

// ---------- 主流程 ----------
async function main() {
  const existing = loadExisting();
  // 合并远程 main 去重键，避免干净工作区重复抓取
  await mergeRemoteKeys(existing);
  const enabled = SOURCES.filter((s) => s.enabled && s.url);
  const created = [];
  const skipped = [];
  const failed = [];
  const dropped = [];
  const summary = [];

  for (const source of enabled) {
    try {
      let items = source.type === 'rss' ? await fetchRssSource(source) : await fetchHtmlSource(source);
      summary.push(`${source.name}: 抓取 ${items.length} 条`);

      for (const item of items) {
        // 去重
        if (existing.has(`${source.name}|${item.title}`)) {
          skipped.push(item.title);
          continue;
        }
        // 使馆 HTML 标题带日期，去掉尾部日期括号用于去重键
        const cleanTitle = item.title.replace(/\s*（\d{4}-\d{2}-\d{2}）$/, '');
        if (existing.has(`${source.name}|${cleanTitle}`)) {
          skipped.push(item.title);
          continue;
        }

        const entry = await processEntry(source, item);
        if (!entry) {
          skipped.push(item.title);
          continue;
        }

        // 相关度门槛：AI 打分低于阈值的不进审核队列。
        // 注意必须「写文件 + status: expired」而不是直接丢弃——去重集 loadExisting()
        // 是扫 items 目录里的 .md 得出的，不落盘的话同一篇会在每轮抓取被重复翻译，
        // 直到它滚出 RSS 窗口为止。expired 不参与 notify（只读 pending）、不上站点列表。
        const rel = entry.relevance;
        const lowRelevance = !entry.autoPublish && Number.isFinite(rel) && rel < RELEVANCE_MIN;
        if (lowRelevance) {
          entry.statusOverride = 'expired';
          entry.note = [entry.note, `相关度 ${rel}/10 低于门槛 ${RELEVANCE_MIN}，自动归档`]
            .filter(Boolean)
            .join(' · ');
          dropped.push({ title: entry.finalTitle, source: entry.source.name, relevance: rel });
        }

        // 写入文件：文件名基于内容哈希（而非序号），杜绝「不同源同序号 → 覆盖已发布文件」的碰撞
        const d = item.pubDate ?? new Date();
        const datePrefix = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
          d.getDate()
        ).padStart(2, '0')}`;
        const slug = source.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').slice(-6) || 'src';
        const hash = createHash('sha1').update(`${source.name}|${item.title}`).digest('hex').slice(0, 6);
        const filename = `${datePrefix}-${slug}-${hash}.md`;
        // 若文件已存在（内容同源同标题），保留既有文件及其发布状态，跳过本次重写，防止覆盖已发布条目
        if (fs.existsSync(path.join(ITEMS_DIR, filename))) {
          skipped.push(item.title);
          existing.add(`${source.name}|${item.title}`);
          continue;
        }
        const md = buildMd(entry);
        fs.writeFileSync(path.join(ITEMS_DIR, filename), md, 'utf8');
        existing.add(`${source.name}|${item.title}`);
        created.push({ file: filename, title: entry.finalTitle });
      }
    } catch (e) {
      failed.push(`${source.name}: ${e.message}`);
      summary.push(`${source.name}: 失败 (${e.message.slice(0, 60)})`);
    }
  }

  // 写报告
  const report = {
    time: new Date().toISOString(),
    created: created.length,
    skipped: skipped.length,
    failed: failed.length,
    relevanceMin: RELEVANCE_MIN,
    lowRelevance: dropped.length,
    hasTranslateKey: hasKey(),
    sources: summary,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(report, null, 2), 'utf8');

  console.log('===== 采集报告 =====');
  for (const s of summary) console.log('·', s);
  console.log(`\n新增 ${created.length} 条，跳过 ${skipped.length} 条，失败 ${failed.length} 个源`);
  console.log(`相关度门槛 ${RELEVANCE_MIN}/10：${dropped.length} 条低于门槛已自动归档（不进审核）`);
  if (dropped.length) {
    console.log('\n归档样例（最多 10 条）：');
    for (const d of dropped.slice(0, 10)) console.log(`· [${d.relevance}/10] ${d.title?.slice(0, 46)}`);
  }
  console.log(`\n→ 实际进入审核队列：${created.length - dropped.length} 条`);
  if (failed.length) {
    console.log('\n失败源：');
    failed.forEach((f) => console.log('·', f));
  }
  if (!hasKey()) {
    console.log('\n[提示] 未配置 ZHIPU_API_KEY，塞尔维亚语源已跳过翻译。注册智谱获取免费 key：bigmodel.cn');
  }
}

main().catch((e) => {
  console.error('采集器异常退出：', e);
  process.exit(1);
});
