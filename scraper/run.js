// 中塞通 · 自动采集主流程
// 用法：ZHIPU_API_KEY=xxx node run.js   （无 key 也能跑，只采集中文源）
// 输出：在 src/content/items/ 生成 .md 文件，push 后自动部署上线

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { SOURCES, TOPIC_KEYWORDS, BLOCK_WORDS } from './sources.js';
import { translateNews, polishChinese, hasKey } from './translate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ITEMS_DIR = path.resolve(__dirname, '../src/content/items');
const STATE_FILE = path.join(__dirname, 'state.json');

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
      if (title) seen.add(`${source}|${title}`);
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
        if (title) seen.add(`${source}|${title}`);
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
function hitKeywords(text, keywords) {
  const t = text.toLowerCase();
  return keywords.some((k) => t.includes(k.toLowerCase()));
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
  // 关键词过滤：源显式给了 keywords 才过滤；空 keywords 表示全量收录
  // （塞语本地媒体全量翻译，中文国际媒体按中塞关键词筛）
  const keywords = source.keywords ?? [];
  const filtered = keywords.length
    ? items.filter((it) => hitKeywords(`${it.title} ${it.content}`, keywords))
    : items;
  return filtered;
}
// ---------- 生成 .md ----------
function buildMd(entry) {
  const { source, item, category, kind, finalTitle, body, note, topic, autoPublish, price, location, contact, summary, images } = entry;
  const d = item.pubDate ?? new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const tags = item.tags?.length ? item.tags : [autoPublish ? '租房' : '新闻'];
  const srcText = item.link ? `[${source.name}](${item.link})` : source.name;
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
    `status: ${autoPublish ? 'active' : 'pending'}`,
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
  if (price) fmLines.push(`price: ${esc(price)}`);
  if (location) fmLines.push(`location: ${esc(location)}`);
  if (contact) fmLines.push(`contact: ${esc(contact)}`);
  if (summary) fmLines.push(`summary: ${esc(summary)}`);
  if (images?.length) fmLines.push(`images: [${images.map((u) => `"${u}"`).join(', ')}]`);
  fmLines.push(`tags: [${tags.map((t) => `"${t}"`).join(', ')}]`);
  fmLines.push('---', '');
  const fm = fmLines.join('\n');

  const lines = [
    `# ${finalTitle}`,
    '',
    ...body.map((l) => l.replace(/\s+/g, ' ').trim()),
    '',
    `> 本文由 ${srcText} 自动采集整理${note ? '，' + note : ''}`,
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
  let summary = item.content.slice(0, 150);
  let tags = null;
  let note = '';
  let price, location, contact;

  if (source.autoPublish) {
    // 自动发布类（如租房）：保留原文，不做 AI 改写，避免误改价格/户型等关键信息
    if (source.category === 'rentals') {
      const ex = extractRental(`${item.title} ${item.content}`);
      price = ex.price;
      location = ex.location;
    }
  } else if (source.lang === 'sr') {
    // 塞尔维亚语 → 中文翻译
    const t = await translateNews(item.title, item.content);
    if (t) {
      finalTitle = t.title;
      summary = t.summary;
      tags = t.tags;
      note = 'AI 翻译，仅供参考';
    } else {
      // 无翻译能力则跳过塞语内容
      return null;
    }
  } else if (hasKey()) {
    // 中文源精炼
    const p = await polishChinese(item.title, item.content.slice(0, 1500));
    if (p?.title) {
      finalTitle = p.title;
      if (p.summary) summary = p.summary;
      tags = p.tags;
      note = 'AI 整理';
    }
  }

  return {
    source,
    item: { ...item, tags },
    category: source.category,
    kind: source.kind,
    autoPublish: !!source.autoPublish,
    finalTitle,
    topic: classifyTopic(`${finalTitle} ${summary}`),
    body: [
      summary ? summary : '',
      item.link ? `原文链接：[${item.title}](${item.link})` : '',
    ].filter(Boolean),
    note,
    price,
    location,
    contact,
    summary,
    images: item.images ?? [],
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
    hasTranslateKey: hasKey(),
    sources: summary,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(report, null, 2), 'utf8');

  console.log('===== 采集报告 =====');
  for (const s of summary) console.log('·', s);
  console.log(`\n新增 ${created.length} 条，跳过 ${skipped.length} 条，失败 ${failed.length} 个源`);
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
