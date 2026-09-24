// scraper/rescore-pending.js
// 给历史待审（status: pending）条目补打 AI 相关度分，低于门槛的转 expired。
//
// 背景：2026-09-25 之前的关键词过滤器是纯子串匹配 + 过量宽词表，导致
// pending 队列堆到 400+ 条，其中大量是国际新闻（卢卡申科赦免、阿巴斯联合国）、
// 体育（排球欧锦赛）、娱乐八卦、地方琐事。这批内容已有中文标题和摘要，
// 直接对中文打分即可 —— 比重新翻译便宜得多。
//
// 用法：
//   node rescore-pending.js --dry-run            # 只报告分数分布，不改文件
//   node rescore-pending.js --min 7              # 实际执行：<7 分转 expired
//   node rescore-pending.js --limit 50           # 只处理 50 条（试跑）
//   node rescore-pending.js --concurrency 6      # 并发（默认 4，注意 API 限流）
//   node rescore-pending.js --all-categories     # 连租房/二手等一起评分（默认只评 news）
//
// 幂等：已有 relevance 字段的条目默认跳过（--force 可重打）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreRelevance, hasKey } from './translate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ITEMS_DIR = path.join(__dirname, '..', 'src', 'content', 'items');

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const DRY = !!arg('dry-run', false);
const FORCE = !!arg('force', false);
const ALL_CAT = !!arg('all-categories', false);
const ONLY = arg('only', null);
const LIMIT = Number(arg('limit', 0)) || 0;
const MIN = Number(arg('min', process.env.RELEVANCE_MIN ?? 7));
// GLM 免费额度速率限制很紧（HTTP 429 / code 1302），默认低并发 + 请求间隔，
// 否则大批量跑会有大量条目因限流而打分失败。要提速就调大 --concurrency、调小 --pace。
const CONC = Math.max(1, Number(arg('concurrency', 2)) || 2);
const PACE = Math.max(0, Number(arg('pace', 700)) || 0);

// ---------- frontmatter 读写（只动需要的行，保留其余原样） ----------
function splitDoc(raw) {
  if (!raw.startsWith('---')) return null;
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return null;
  return { fm: raw.slice(4, end).replace(/^\n+/, ''), body: raw.slice(end + 4) };
}
function getField(fm, name) {
  const m = fm.match(new RegExp(`^${name}:\\s*"?([^"\\n]*)"?\\s*$`, 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
}
/** 插入或替换 frontmatter 字段；existing=false 时插到 tags 之前（没有 tags 就追加到末尾） */
function setField(fm, name, value) {
  const re = new RegExp(`^${name}:.*$`, 'm');
  const line = `${name}: ${value}`;
  if (re.test(fm)) return fm.replace(re, line);
  const lines = fm.split('\n');
  const ti = lines.findIndex((l) => /^tags:/.test(l));
  if (ti >= 0) lines.splice(ti, 0, line);
  else lines.push(line);
  return lines.join('\n');
}

// ---------- 收集待审条目 ----------
const files = fs.readdirSync(ITEMS_DIR).filter((f) => f.endsWith('.md'));
const targets = [];
const skippedScored = [];
for (const f of files) {
  const p = path.join(ITEMS_DIR, f);
  const raw = fs.readFileSync(p, 'utf8');
  const doc = splitDoc(raw);
  if (!doc) continue;
  if (getField(doc.fm, 'status') !== 'pending') continue;
  if (!ALL_CAT && getField(doc.fm, 'category') !== 'news') continue;
  if (ONLY && !getField(doc.fm, 'source').includes(ONLY)) continue;
  if (!FORCE && Number.isFinite(Number(getField(doc.fm, 'relevance'))) && getField(doc.fm, 'relevance') !== '') {
    skippedScored.push(f);
    continue;
  }
  targets.push({ p, f, doc, title: getField(doc.fm, 'title'), summary: getField(doc.fm, 'summary') });
}

console.log(`待审条目 ${targets.length} 条待打分（已打分跳过 ${skippedScored.length} 条）｜门槛 ${MIN}/10｜并发 ${CONC}${DRY ? '｜DRY-RUN 不写文件' : ''}\n`);
if (!targets.length) process.exit(0);
if (!hasKey()) {
  console.error('❌ 未配置 AI Key（ZHIPU_API_KEY / AGNES_API_KEY），无法打分。');
  process.exit(1);
}

const todo = LIMIT ? targets.slice(0, LIMIT) : targets;
const results = [];
let done = 0;

async function worker(queue) {
  while (queue.length) {
    const t = queue.shift();
    let score = null;
    for (let attempt = 1; attempt <= 3 && score === null; attempt++) {
      try {
        score = await scoreRelevance(t.title, t.summary);
      } catch (e) {
        if (attempt === 3) console.warn(`  ⚠️ 打分失败 ${t.f.slice(0, 34)}: ${e.message}`);
      }
      // scoreRelevance 失败时返回 null 而不是抛错，这里显式退避重试
      if (score === null && attempt < 3) await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
    done++;
    if (score === null) {
      results.push({ ...t, score: null, action: 'skip' });
      console.log(`[${done}/${todo.length}] ⏭️  打分失败，保持 pending  ${t.title?.slice(0, 42)}`);
      continue;
    }
    const low = score < MIN;
    results.push({ ...t, score, action: low ? 'archive' : 'keep' });
    console.log(
      `[${done}/${todo.length}] ${low ? '📦 归档' : '✅ 保留'} ${String(score).padStart(2)}/10  ${t.title?.slice(0, 44)}`
    );

    if (!DRY) {
      // 只写 relevance + status。归档理由由「relevance < 门槛」自明，
      // 不额外造 note 字段 —— 本项目的 note 是写进正文的（见 run.js buildMd 的
      // `> 本文由 … 自动采集整理，${note}`），frontmatter 里没有这个键，
      // 造出来会让重筛过的条目和新抓条目字段不一致。
      let fm = setField(t.doc.fm, 'relevance', score);
      if (low) fm = setField(fm, 'status', 'expired');
      fs.writeFileSync(t.p, `---\n${fm}\n---${t.doc.body}`, 'utf8');
    }
    if (PACE) await new Promise((r) => setTimeout(r, PACE));
  }
}

const queue = [...todo];
await Promise.all(Array.from({ length: Math.min(CONC, queue.length) }, () => worker(queue)));

// ---------- 汇总 ----------
const ok = results.filter((r) => r.score !== null);
const arch = ok.filter((r) => r.action === 'archive');
const keep = ok.filter((r) => r.action === 'keep');
const failedN = results.filter((r) => r.score === null).length;

const dist = new Map();
for (const r of ok) dist.set(r.score, (dist.get(r.score) ?? 0) + 1);

console.log('\n===== 打分分布 =====');
for (const s of [...dist.keys()].sort((a, b) => b - a)) {
  const n = dist.get(s);
  console.log(`  ${String(s).padStart(2)}/10  ${'█'.repeat(Math.min(n, 60))} ${n}`);
}
console.log(`\n✅ 保留 pending：${keep.length} 条`);
console.log(`📦 转 expired：${arch.length} 条`);
if (failedN) console.log(`⏭️  打分失败保持原状：${failedN} 条`);

if (arch.length) {
  console.log('\n----- 归档的条目（前 40，可核对是否有误杀）-----');
  for (const r of arch.slice(0, 40)) console.log(`  [${r.score}/10] ${r.title?.slice(0, 62)}`);
}
if (keep.length) {
  console.log('\n----- 保留的条目（前 40）-----');
  for (const r of keep.slice(0, 40)) console.log(`  [${r.score}/10] ${r.title?.slice(0, 62)}`);
}
if (DRY) console.log('\n[DRY-RUN] 未写任何文件。去掉 --dry-run 即实际执行。');
