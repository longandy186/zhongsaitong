// 中塞通 · 历史条目补图（一次性工具）
// 扫描 src/content/items/ 里 images 为空/缺失的条目，按其原文链接抓 og:image 补进 frontmatter；
// 源站确实没有图（如使馆公告）则写入该源的 fallbackImage 品牌封面。
//
// 用法：
//   node backfill-images.js --dry-run          # 只报告，不写文件
//   node backfill-images.js                    # 处理所有 active 条目
//   node backfill-images.js --all              # 连 pending/expired 一起补
//   node backfill-images.js --status active,pending   # 指定状态
//   node backfill-images.js --replace-picsum   # 把 picsum 随机占位图一并换掉
//   node backfill-images.js --only 使馆        # 只处理 source 名含"使馆"的
//   node backfill-images.js --limit 20         # 最多处理 20 条
//   node backfill-images.js --concurrency 6    # 并发数（默认 4，别调太高，避免被源站限流）

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './sources.js';
import { fetchOgImage } from './og-image.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ITEMS_DIR = path.resolve(__dirname, '../src/content/items');

const argv = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const DRY = !!flag('dry-run', false);
const ALL = !!flag('all', false);
const ONLY = flag('only', null);
const LIMIT = Number(flag('limit', 0)) || 0;
const CONC = Math.max(1, Number(flag('concurrency', 4)) || 4);
const REPLACE_PICSUM = !!flag('replace-picsum', false);
const STATUS = ALL ? null : String(flag('status', 'active')).split(',').map((s) => s.trim());

// ---------- frontmatter 解析 / 回写 ----------
function splitMd(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = text.slice(4, end).replace(/^\n+/, ''); // 跳过开头 ---\n
  const rest = text.slice(end + 4); // 跳过 \n---
  return { fm: fm.replace(/\n$/, ''), body: rest };
}

function hasImages(fm) {
  const lines = fm.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^images:/.test(lines[i])) continue;
    const inline = lines[i].replace(/^images:\s*/, '').trim();
    if (inline.startsWith('[') && inline.endsWith(']')) return inline.slice(1, -1).trim().length > 0;
    // 多行列表：往后看有没有 "- xxx"
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*-\s*\S/.test(lines[j])) return true;
      if (/^\S/.test(lines[j])) break;
    }
    return false;
  }
  return false;
}

function setImages(fm, url) {
  const lines = fm.split('\n');
  const out = [];
  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^images:/.test(lines[i])) {
      out.push(`images: ["${url}"]`);
      while (i + 1 < lines.length && /^\s*-\s/.test(lines[i + 1])) i++; // 吞掉旧列表项
      inserted = true;
      continue;
    }
    out.push(lines[i]);
  }
  if (!inserted) {
    const ti = out.findIndex((l) => /^tags:/.test(l));
    if (ti >= 0) out.splice(ti, 0, `images: ["${url}"]`);
    else out.push(`images: ["${url}"]`);
  }
  return out.join('\n');
}

function getField(fm, name) {
  const m = fm.match(new RegExp(`^${name}:\\s*"?([^"\\n]+)"?`, 'm'));
  return m ? m[1].trim() : '';
}

function getLink(body) {
  const m =
    body.match(/原文链接：\[[^\]]*\]\((https?:\/\/[^)]+)\)/) ||
    body.match(/\(\[[^\]]*\]\((https?:\/\/[^)]+)\)\)/) ||
    body.match(/\((https?:\/\/[^)\s]+)\)/);
  return m ? m[1] : '';
}

const SOURCE_MAP = new Map(SOURCES.map((s) => [s.name, s]));

// ---------- 主流程 ----------
async function main() {
  const files = (await fs.readdir(ITEMS_DIR)).filter((f) => f.endsWith('.md')).sort();
  const targets = [];

  for (const f of files) {
    const full = path.join(ITEMS_DIR, f);
    const text = await fs.readFile(full, 'utf8');
    const parts = splitMd(text);
    if (!parts) continue;
    const { fm, body } = parts;
    const status = getField(fm, 'status') || 'active';
    if (STATUS && !STATUS.includes(status)) continue;
    const picsum = /picsum\.photos/.test(fm);
    if (hasImages(fm) && !(REPLACE_PICSUM && picsum)) continue;
    const source = getField(fm, 'source');
    if (ONLY && !source.includes(ONLY)) continue;
    targets.push({ file: f, full, fm, body, source, link: getLink(body) });
  }

  const todo = LIMIT ? targets.slice(0, LIMIT) : targets;
  console.log(
    `待补图条目 ${targets.length} 条${LIMIT ? `（本次处理前 ${todo.length} 条）` : ''}｜并发 ${CONC}` +
      `${DRY ? '｜DRY-RUN 不写文件' : ''}${REPLACE_PICSUM ? '｜替换 picsum 占位图' : ''}` +
      `｜状态 ${STATUS ? STATUS.join('/') : '全部'}\n`
  );

  const stat = { og: 0, fallback: 0, none: 0, error: 0 };
  const unresolved = [];
  let cursor = 0;

  async function worker(id) {
    while (cursor < todo.length) {
      const t = todo[cursor++];
      const cfg = SOURCE_MAP.get(t.source);
      let url = '';
      let how = '';
      if (t.link && cfg?.ogImage !== false) {
        url = await fetchOgImage(t.link);
        if (url) how = 'og:image';
      }
      if (!url && cfg?.fallbackImage) {
        url = cfg.fallbackImage;
        how = 'fallback';
      }
      if (!url) {
        stat.none++;
        unresolved.push({ file: t.file, source: t.source, link: t.link });
        console.log(`  ⚠️  [${id}] 无图可取  ${t.file}`);
        continue;
      }
      if (how === 'og:image') stat.og++;
      else stat.fallback++;

      if (!DRY) {
        const newFm = setImages(t.fm, url);
        const newText = `---\n${newFm}\n---${t.body}`;
        try {
          await fs.writeFile(t.full, newText, 'utf8');
        } catch (e) {
          stat.error++;
          console.log(`  ❌ [${id}] 写入失败 ${t.file}: ${e.message}`);
          continue;
        }
      }
      console.log(`  ${how === 'og:image' ? '🖼 ' : '🎨'} [${id}] ${how.padEnd(8)} ${t.file}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONC, todo.length) }, (_, i) => worker(i + 1)));

  console.log('\n──────── 汇总 ────────');
  console.log(`源站 og:image 补到  ${stat.og} 条`);
  console.log(`品牌封面兜底        ${stat.fallback} 条`);
  console.log(`无图可取            ${stat.none} 条`);
  if (stat.error) console.log(`写入失败            ${stat.error} 条`);
  if (unresolved.length) {
    const bySrc = {};
    for (const u of unresolved) bySrc[u.source] = (bySrc[u.source] || 0) + 1;
    console.log('\n无图可取 按来源：');
    for (const [k, v] of Object.entries(bySrc).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}：${v} 条`);
    }
  }
  if (!DRY) console.log('\n提示：git diff 核对后再提交。');
}

main().catch((e) => {
  console.error('backfill 失败：', e);
  process.exit(1);
});
