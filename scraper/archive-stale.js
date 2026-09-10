// 归档「超期未审」的 pending 内容
//
// 背景：采集量长期大于人工审核速度，pending 队列会无限膨胀（2026-09-10 时积压 1049 条），
// 其中大量是已失去发布价值的旧闻。本脚本把「新闻日期超过 N 天仍未审核」的条目
// 从 pending 翻为 expired —— expired 不在站点展示、也不再进入审核队列，但文件保留（可逆）。
//
// 为什么用 date（新闻日期）而不是 scrapedAt（入库时间）判断：
//   内容的发布价值由新闻本身的日期决定。一条 8 月的新闻即使今天才被抓到，
//   发出来也是旧闻，不该占用审核位。
//
// 用法：
//   node archive-stale.js                # 默认归档超过 7 天的
//   node archive-stale.js --days 5       # 自定义阈值
//   node archive-stale.js --dry-run      # 只统计不写入
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ITEMS_DIR = path.resolve(__dirname, '../src/content/items');

const args = process.argv.slice(2);
const daysIdx = args.indexOf('--days');
const DAYS = daysIdx >= 0 ? Number(args[daysIdx + 1]) : 7;
const DRY = args.includes('--dry-run');

if (!Number.isFinite(DAYS) || DAYS <= 0) {
  console.error('[archive] --days 参数无效:', args[daysIdx + 1]);
  process.exit(1);
}

const cutoff = Date.now() - DAYS * 24 * 60 * 60 * 1000;
let scanned = 0;
let archived = 0;
let kept = 0;
const byMonth = {};

for (const f of fs.readdirSync(ITEMS_DIR)) {
  if (!f.endsWith('.md')) continue;
  const p = path.join(ITEMS_DIR, f);
  const txt = fs.readFileSync(p, 'utf8');
  // 只处理 pending；active/published/expired 一律不动
  if (!/^status:\s*pending\s*$/m.test(txt)) continue;
  scanned++;

  const dm = txt.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m);
  if (!dm) {
    kept++; // 无日期字段，保守保留
    continue;
  }
  const t = new Date(`${dm[1]}T00:00:00Z`).getTime();
  if (t < cutoff) {
    if (!DRY) {
      fs.writeFileSync(p, txt.replace(/^status:\s*pending\s*$/m, 'status: expired'), 'utf8');
    }
    archived++;
    const m = dm[1].slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + 1;
  } else {
    kept++;
  }
}

console.log(
  `[archive] 阈值 ${DAYS} 天 | 扫描 pending ${scanned} 条 → 归档 ${archived} 条、保留 ${kept} 条` +
    (DRY ? '（dry-run，未写入）' : '')
);
for (const m of Object.keys(byMonth).sort()) {
  console.log(`[archive]   ${m}: ${byMonth[m]} 条`);
}
