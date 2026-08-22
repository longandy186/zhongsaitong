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

function isPending(raw) {
  return /^status:\s*pending\s*$/m.test(raw);
}

async function pushOne(file) {
  const raw = fs.readFileSync(path.join(ITEMS_DIR, file), 'utf8');
  if (!isPending(raw)) return `${file}: 跳过(非 pending)`;
  const contentB64 = Buffer.from(raw, 'utf8').toString('base64');
  const filePath = `src/content/items/${encodeURIComponent(file)}`;
  const api = `https://api.github.com/repos/${REPO}/contents/${filePath}`;
  // 先查 drafts 是否已有（拿 sha 以便更新）
  let sha = null;
  try {
    const r = await fetch(`${api}?ref=${DRAFT_BRANCH}`, { headers });
    if (r.ok) sha = (await r.json()).sha;
  } catch { /* ignore */ }
  const res = await fetch(api, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `draft: ${file}`,
      content: contentB64,
      branch: DRAFT_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.ok) return `${file}: ✅ 已推草稿`;
  const t = await res.text().catch(() => '');
  return `${file}: 失败(${res.status}) ${t.slice(0, 160)}`;
}

async function main() {
  const files = fs.readdirSync(ITEMS_DIR).filter((f) => f.endsWith('.md'));
  const out = [];
  for (const f of files) out.push(await pushOne(f));
  console.log('===== push-drafts 结果 =====');
  out.forEach((l) => console.log('·', l));
  const pushed = out.filter((l) => l.includes('✅')).length;
  console.log(`\n共扫描 ${out.length} 个文件，推送 ${pushed} 条草稿到 ${DRAFT_BRANCH} 分支`);
}

main().catch((e) => { console.error('[push-drafts] 异常:', e); process.exit(1); });
