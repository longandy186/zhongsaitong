// scraper/push-drafts.js
// 把本地 status:pending 的草稿推送到 GitHub 的 drafts 分支（不碰 main，不触发部署）。
// 流程：run.js 抓取生成 pending → push-drafts.js 推草稿分支 → notify.js 发飞书 →
//       用户点审核 → approve.js 从 drafts 读取、合入 main 并触发部署。
//
// 用法：GH_TOKEN=xxx node push-drafts.js   （token 也可用 .env 的 GH_TOKEN；不传则失败）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ITEMS_DIR = path.resolve(__dirname, '../src/content/items');
const REPO = process.env.REPO || 'longandy186/zhongsaitong';
const DRAFT_BRANCH = 'drafts';

// 加载本地 .env（仅当环境变量未设置时）
try {
  const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch { /* ignore */ }

const token = process.env.GH_TOKEN || '';
if (!token) { console.error('[push-drafts] GH_TOKEN 未设置'); process.exit(1); }

const headers = {
  Authorization: `Bearer ${token}`,
  'User-Agent': 'zst-push-drafts',
  Accept: 'application/vnd.github+json',
};

function statusOf(raw) {
  const m = raw.match(/^status:\s*(\w+)\s*$/m);
  return m ? m[1] : '';
}

async function pushOne(file, branch) {
  const raw = fs.readFileSync(path.join(ITEMS_DIR, file), 'utf8');
  const contentB64 = Buffer.from(raw, 'utf8').toString('base64');
  const filePath = `src/content/items/${encodeURIComponent(file)}`;
  const api = `https://api.github.com/repos/${REPO}/contents/${filePath}`;
  // 先查目标分支是否已有（拿 sha 以便更新）
  let sha = null;
  try {
    const r = await fetch(`${api}?ref=${branch}`, { headers });
    if (r.ok) sha = (await r.json()).sha;
  } catch { /* ignore */ }
  const res = await fetch(api, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `${branch === 'main' ? 'publish' : 'draft'}: ${file}`,
      content: contentB64,
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.ok) return `${file}: ✅ 已推${branch === 'main' ? '主分支(自动发布)' : '草稿'}`;
  const t = await res.text().catch(() => '');
  return `${file}: 失败(${res.status}) ${t.slice(0, 160)}`;
}

async function main() {
  const files = fs.readdirSync(ITEMS_DIR).filter((f) => f.endsWith('.md'));

  // 1) 过期清理：本地 active 且 expireAt 已过 → 翻 expired 并推 main（下线展示）
  for (const f of files) {
    const p = path.join(ITEMS_DIR, f);
    let raw = fs.readFileSync(p, 'utf8');
    if (statusOf(raw) !== 'active') continue;
    const em = raw.match(/^expireAt:\s*(\S+)\s*$/m);
    if (!em) continue;
    const exp = new Date(em[1]);
    if (!isNaN(exp) && exp < new Date()) {
      raw = raw.replace(/^status:\s*active\s*$/m, 'status: expired');
      fs.writeFileSync(p, raw, 'utf8');
      console.log('·', await pushOne(f, 'main'));
    }
  }

  // 2) 常规推送：pending→drafts（飞书审核），active（自动发布）→ main
  const out = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(ITEMS_DIR, f), 'utf8');
    const st = statusOf(raw);
    if (st === 'pending') out.push(await pushOne(f, DRAFT_BRANCH));
    else if (st === 'active') out.push(await pushOne(f, 'main'));
    // expired / done 跳过
  }
  console.log('===== push-drafts 结果 =====');
  out.forEach((l) => console.log('·', l));
  const pushed = out.filter((l) => l.includes('✅')).length;
  console.log(`\n共处理 ${out.length} 个文件，推送 ${pushed} 条`);
}

main().catch((e) => { console.error('[push-drafts] 异常:', e); process.exit(1); });
