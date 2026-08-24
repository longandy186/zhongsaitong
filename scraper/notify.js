// scraper/notify.js
// 可插拔的「待审推送 + 卡片审核」通知模块
//
// 设计要点：
//  1. 读取所有 status: pending 的草稿，按 topic 分组。
//  2. 为每条生成「签名审核链接」，指向 Cloudflare Pages Function（/api/approve）。
//     链接带 HMAC 签名，他人无法伪造发布。
//  3. 把汇总 Markdown（含链接）按渠道发出。任何能渲染 Markdown 链接的渠道
//     （飞书 / 微信 / WhatsApp）都可用 —— 点链接即在手机上审核，无需开电脑。
//
// 用法（在 GitHub Actions 内调用）：
//   NOTIFY_CHANNEL=feishu FEISHU_WEBHOOK=xxx APPROVE_URL=https://zhongsaitong.com/api/approve APPROVE_SECRET=yyy node notify.js
//
// 本地联调：NOTIFY_CHANNEL=none 仅打印，不发真实消息。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ITEMS_DIR = path.join(__dirname, '..', 'src', 'content', 'items');

const APPROVE_URL = (process.env.APPROVE_URL || '').replace(/\/$/, '');
const SECRET = process.env.APPROVE_SECRET || '';
const CHANNEL = (process.env.NOTIFY_CHANNEL || 'none').toLowerCase();
const MAX_ITEMS = Number(process.env.NOTIFY_MAX_ITEMS || 15);
// GitHub 读取模式：设了 GH_TOKEN 即从线上 main 分支读取真实 pending（与审核发布同源，避免推线上不存在的本地缓存）
const GITHUB_REPO = process.env.GITHUB_REPO || 'longandy186/zhongsaitong';
const GH_TOKEN = process.env.GH_TOKEN || '';

// ---------- 已推送状态（防重复发卡） ----------
// 每次成功推送后，把该批 pending 的 id 记入 state.json 的 pushed[]。
// 下次运行时只推送「不在 pushed[] 且线上仍为 pending」的新条目；已推送过的跳过。
// --force 可强制全量重推。
const STATE_FILE = path.join(__dirname, 'notify-state.json');
let notifyState = { pushed: [] };
function loadNotifyState() {
  try {
    if (fs.existsSync(STATE_FILE)) notifyState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    notifyState = { pushed: [] };
  }
  if (!Array.isArray(notifyState.pushed)) notifyState.pushed = [];
}
function saveNotifyState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(notifyState, null, 2), 'utf8');
}
// 过滤出「尚未推送过」的条目；--force 时返回全部
function filterUnpushed(items) {
  const force = process.argv.includes('--force');
  if (force) return { toSend: items, skipped: [] };
  const pushedSet = new Set(notifyState.pushed);
  const toSend = [];
  const skipped = [];
  for (const it of items) {
    if (pushedSet.has(it.id)) skipped.push(it.id);
    else toSend.push(it);
  }
  return { toSend, skipped };
}
function markPushed(items) {
  for (const it of items) if (!notifyState.pushed.includes(it.id)) notifyState.pushed.push(it.id);
  saveNotifyState();
}

// ---------- 签名 ----------
function hmac(action, payload) {
  return crypto.createHmac('sha256', SECRET).update(`${action}:${payload}`).digest('hex').slice(0, 16);
}
function approveUrl(action, payload) {
  const sig = hmac(action, payload);
  const q = new URLSearchParams({ action, sig });
  // 多 id（批量）一律走 ids 参数；单条走 id 参数。
  // approve.js 对 skip 的批量也读 ids 参数，确保「全部跳过」生效。
  if (payload.includes(',')) q.set('ids', payload);
  else q.set('id', payload);
  return `${APPROVE_URL}?${q.toString()}`;
}

// 删除已发布内容的签名链接（action=delete，approve.js 从 main 删除文件）
function deleteUrl(id) {
  return approveUrl('delete', id);
}

// ---------- 工具：批次 & frontmatter ----------
// 批次 = 文件名前缀的 YYYYMMDD（如 20260822 → 「2026-08-22 批次」），同一批次归为一组
function deriveBatch(id) {
  const m = id.match(/^(2026\d{4})/);
  if (!m) return '未分批';
  const s = m[1];
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} 批次`;
}
function parseFrontmatter(raw, id) {
  const end = raw.indexOf('---', 3);
  const fm = raw.slice(0, end > 0 ? end : raw.length);
  const get = (k) =>
    ((fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1] || '')
      .trim()
      .replace(/^["']|["']$/g, '');
  return {
    id,
    file: id + '.md',
    title: get('title'),
    topic: get('topic') || '其他',
    source: get('source'),
    date: get('date'),
    scrapedAt: get('scrapedAt'),
    batch: deriveBatch(id),
  };
}

// ---------- 读取 pending ----------
function readPending() {
  if (!fs.existsSync(ITEMS_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(ITEMS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const raw = fs.readFileSync(path.join(ITEMS_DIR, f), 'utf8');
    if (!/^status:\s*pending\s*$/m.test(raw)) continue;
    out.push(parseFrontmatter(raw, f.replace(/\.md$/, '')));
  }
  // 新的在前
  return out.reverse();
}

// 从 GitHub 线上 main 分支读取真实 pending（与审核发布同源）。
// onlyPrefix 可限定只取某批次（如「20260822-塞尔维亚媒体」），避免拉取全量。
async function readPendingGithub(onlyPrefix) {
  if (!GH_TOKEN) return null;
  const auth = {
    Authorization: `Bearer ${GH_TOKEN}`,
    'User-Agent': 'zhongsaitong-notify',
    Accept: 'application/vnd.github+json',
  };
  const treeRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/trees/main?recursive=1`, {
    headers: auth,
  });
  if (!treeRes.ok) {
    console.warn(`[notify] GitHub tree 读取失败 ${treeRes.status}`);
    return null;
  }
  const tree = await treeRes.json();
  const paths = (tree.tree || [])
    .filter((t) => t.path.startsWith('src/content/items/') && t.path.endsWith('.md'))
    .map((t) => t.path);
  const out = [];
  for (const p of paths) {
    const id = p.split('/').pop().replace(/\.md$/, '');
    if (onlyPrefix && !id.startsWith(onlyPrefix)) continue;
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(p)}`, {
      headers: auth,
    });
    if (!r.ok) continue;
    const j = await r.json();
    const raw = Buffer.from(j.content, 'base64').toString('utf8');
    if (!/^status:\s*pending\s*$/m.test(raw)) continue;
    out.push(parseFrontmatter(raw, id));
  }
  return out.reverse();
}

// ---------- 读取 active（已发布，供管理/删除） ----------
function readActive() {
  if (!fs.existsSync(ITEMS_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(ITEMS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const raw = fs.readFileSync(path.join(ITEMS_DIR, f), 'utf8');
    if (!/^status:\s*active\s*$/m.test(raw)) continue;
    const fm = raw.slice(0, (raw.indexOf('---', 3) > 0 ? raw.indexOf('---', 3) : raw.length));
    const get = (k) =>
      ((fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1] || '')
        .trim()
        .replace(/^["']|["']$/g, '');
    out.push({
      id: f.replace(/\.md$/, ''),
      file: f,
      title: get('title'),
      category: get('category') || '',
      source: get('source'),
    });
  }
  return out.reverse();
}

// ---------- 生成 Markdown ----------
// 模板规则（用户要求）：
//   · 每条都显示【时间 + 批次】，时间加粗 🕒 醒目
//   · 先按【批次】分大块，同一批次内再按 topic（中塞/生活/其他）细分块
//   · 每条标注「抓取时间」；卡片头部标注本次「发送时间」
// opts.heading: 卡片内 H2 标题（分批时用，如「待审核 1-15/50」）
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function buildMarkdown(items, opts = {}) {
  const heading = opts.heading || `📰 中塞通 · 待审核 ${items.length} 条`;
  const sentAt = fmtTime(new Date().toISOString());

  // 按批次分组（新批次在前，未分批置底）
  const byBatch = {};
  for (const it of items) {
    const b = it.batch || '未分批';
    (byBatch[b] = byBatch[b] || []).push(it);
  }
  const batches = Object.keys(byBatch).sort((a, b) => {
    if (a === '未分批') return 1;
    if (b === '未分批') return -1;
    return b.localeCompare(a);
  });

  let md = `## ${heading}\n\n`;
  md += `> 📤 发送时间：**${sentAt}**\n`;
  md += `> 点链接即可在手机上审核发布，无需开电脑。\n\n`;

  for (const b of batches) {
    const list = byBatch[b];
    md += `### 📦 ${b}（${list.length} 条）\n\n`;
    // 批次内细分块：按 topic
    const groups = { 中塞: [], 生活: [], 其他: [] };
    for (const it of list) (groups[it.topic] || groups['其他']).push(it);
    for (const g of ['中塞', '生活', '其他']) {
      const gl = groups[g];
      if (!gl.length) continue;
      const emoji = g === '中塞' ? '🟥' : g === '生活' ? '🟦' : '⬜';
      md += `#### ${emoji} ${g}（${gl.length}）\n`;
      for (const it of gl) {
        const pub = approveUrl('publish', it.id);
        const skip = approveUrl('skip', it.id);
        const scrapeT = it.scrapedAt ? fmtTime(it.scrapedAt) : (it.date || '未记录');
        md += `- 🕓 **抓取 ${scrapeT}**　${it.title}\n  [✅ 发布](${pub}) · [⏭ 跳过](${skip})\n`;
      }
      md += `\n`;
    }
  }
  return md;
}

// 批量操作卡：一键发布全部「中塞+生活」或一键全部跳过
function buildBatchMarkdown(items) {
  let md = `## 📰 中塞通 · 批量操作\n\n`;
  const zhLife = items.filter((i) => ['中塞', '生活'].includes(i.topic)).map((i) => i.id);
  if (zhLife.length) md += `- [🚀 发布全部「中塞+生活」](${approveUrl('batch', zhLife.join(','))})\n`;
  md += `- [🗑 全部跳过](${approveUrl('skip', items.map((i) => i.id).join(','))})\n`;
  return md;
}

// 管理卡：列出已发布(active)内容，每条带「删除」链接
// 用法：node notify.js --manage   → 发一张飞书管理卡，点链接即删除并触发重新部署
function buildManageMarkdown(items) {
  let md = `## 🗂 中塞通 · 已发布内容管理（${items.length} 条）\n\n`;
  md += `点击「🗑 删除」将直接从线上移除该条并重新部署。删除不可恢复，请确认。\n\n`;
  for (const it of items) {
    const del = deleteUrl(it.id);
    const cat = it.category ? `[${it.category}] ` : '';
    md += `- ${cat}${it.title}\n  [🗑 删除](${del})\n`;
  }
  return md;
}

// ---------- 渠道分发（可插拔） ----------

// 飞书：每条 interactive 卡片的 markdown 有长度上限，按每卡 ≤ MAX_ITEMS 分批，
// 确保全部待审条目都可点击，不再有「其余 N 条请到后台」的占位。
async function sendFeishu(items) {
  const hook = process.env.FEISHU_WEBHOOK;
  if (!hook) throw new Error('FEISHU_WEBHOOK 未配置');
  const total = items.length;
  const PER = MAX_ITEMS;
  let sent = 0;
  for (let i = 0; i < items.length; i += PER) {
    const chunk = items.slice(i, i + PER);
    const start = i + 1;
    const end = i + chunk.length;
    const headerTitle = `中塞通 · 待审核 ${start}-${end}/${total}`;
    const md = buildMarkdown(chunk, { heading: `待审核 ${start}-${end}/${total}（共 ${total}）` });
    const card = {
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: { title: { tag: 'plain_text', content: headerTitle }, template: 'red' },
        elements: [{ tag: 'markdown', content: md }],
      },
    };
    const r = await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(card),
    });
    if (!r.ok) throw new Error(`飞书推送失败 ${r.status}: ${await r.text()}`);
    sent++;
  }
  // 末尾补一张「批量操作」卡（一键发布中塞+生活 / 全部跳过）
  const batchCard = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: '中塞通 · 一键批量操作' }, template: 'blue' },
      elements: [{ tag: 'markdown', content: buildBatchMarkdown(items) }],
    },
  };
  const rb = await fetch(hook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(batchCard),
  });
  if (!rb.ok) throw new Error(`飞书批量卡推送失败 ${rb.status}: ${await rb.text()}`);
  console.log(`[notify] 飞书推送成功（${sent} 张明细卡 + 1 张批量卡，共 ${total} 条）`);
}

// 管理卡（已发布内容删除入口）：按每卡 ≤ MAX_ITEMS 分批发送
async function sendManageFeishu(items) {
  const hook = process.env.FEISHU_WEBHOOK;
  if (!hook) throw new Error('FEISHU_WEBHOOK 未配置');
  const total = items.length;
  const PER = MAX_ITEMS;
  let sent = 0;
  for (let i = 0; i < items.length; i += PER) {
    const chunk = items.slice(i, i + PER);
    const start = i + 1;
    const end = i + chunk.length;
    const card = {
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true },
        header: {
          title: { tag: 'plain_text', content: `中塞通 · 管理 ${start}-${end}/${total}` },
          template: 'grey',
        },
        elements: [{ tag: 'markdown', content: buildManageMarkdown(chunk) }],
      },
    };
    const r = await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(card),
    });
    if (!r.ok) throw new Error(`飞书管理卡推送失败 ${r.status}: ${await r.text()}`);
    sent++;
  }
  console.log(`[notify] 飞书管理卡推送成功（${sent} 张，共 ${total} 条已发布内容）`);
}

async function send(channel, items) {
  if (channel === 'feishu') {
    return sendFeishu(items);
  }

  if (channel === 'whatsapp') {
    // TODO(插拔点)：接入 Twilio / Meta Cloud API
    // 参考：POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
    //       body= markup 文本, To=whatsapp:+86..., From=whatsapp:+1...(沙箱号)
    // 链接在 WhatsApp 中同样可点击。配置：TWILIO_SID / TWILIO_TOKEN / WA_FROM / WA_TO
    throw new Error('WhatsApp 适配器待接入：设置 TWILIO_* 并实现 send()');
  }

  if (channel === 'wechat') {
    // 公众号「链接模式」：用客服消息(text)把每条待审的签名审核链接发出。
    // 客服文本消息支持 <a href> 链接，在微信内点开即命中 /api/approve。
    // 需配置：WECHAT_APPID / WECHAT_APPSECRET / WECHAT_TO_OPENID（发给自己审核）
    // 注：客服消息要求接收方 48h 内与公众号互动过；纯订阅号无此接口则用图文/模板消息替代。
    const appid = process.env.WECHAT_APPID;
    const secret = process.env.WECHAT_APPSECRET;
    const to = process.env.WECHAT_TO_OPENID;
    if (!appid || !secret || !to) {
      throw new Error('WECHAT_APPID / WECHAT_APPSECRET / WECHAT_TO_OPENID 未配置');
    }
    // 1) 获取 access_token
    const tokRes = await fetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`
    );
    const tok = await tokRes.json();
    if (!tok.access_token) throw new Error('获取 access_token 失败: ' + JSON.stringify(tok));
    const AT = tok.access_token;

    // 2) 分条发送（每条 8 条左右，避免超过客服文本长度上限）
    const PER = 8;
    let sent = 0;
    for (let i = 0; i < items.length; i += PER) {
      const chunk = items.slice(i, i + PER);
      let content =
        i === 0 ? `📰 中塞通 · 待审核 ${items.length} 条（点链接审核）：\n` : '继续：\n';
      for (const it of chunk) {
        const pub = approveUrl('publish', it.id);
        const skip = approveUrl('skip', it.id);
        content += `${it.title}\n<a href="${pub}">✅发布</a> <a href="${skip}">⏭跳过</a>\n`;
      }
      const r = await fetch(
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${AT}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ touser: to, msgtype: 'text', text: { content } }),
        }
      );
      const j = await r.json();
      if (j.errcode) throw new Error('公众号发送失败: ' + JSON.stringify(j));
      sent++;
    }
    console.log(`[notify] 公众号推送成功（${sent} 条消息）`);
    return;
  }

  // none / 未知：仅打印，方便本地联调
  console.log('\n========== [notify] channel=none，待审推送预览 ==========\n');
  console.log(buildMarkdown(items));
  console.log('\n----------------------------------------------------------\n');
  console.log(buildBatchMarkdown(items));
  console.log('\n==========================================================\n');
}

// ---------- 主流程 ----------
async function main() {
  const isManage = process.argv.includes('--manage');
  const onlyIdx = process.argv.indexOf('--only');
  const onlyPrefix = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
  if (!APPROVE_URL || !SECRET) {
    console.warn('[notify] 警告：APPROVE_URL 或 APPROVE_SECRET 未设置，仅做本地预览（channel=none 行为）');
  }

  if (isManage) {
    const items = readActive();
    if (!items.length) {
      console.log('[notify] 无已发布内容');
      return;
    }
    if (CHANNEL === 'none') {
      console.log('\n========== [notify] 管理卡预览(已发布内容) ==========\n');
      console.log(buildManageMarkdown(items));
      console.log('\n======================================================\n');
      return;
    }
    if (CHANNEL === 'feishu') return sendManageFeishu(items);
    console.log('[notify] --manage 仅支持 feishu / none 渠道');
    return;
  }

  // 优先从 GitHub 线上读取真实 pending（与审核发布同源），否则回退本地。
  let items;
  if (GH_TOKEN) {
    try {
      const gh = await readPendingGithub(onlyPrefix);
      if (gh && gh.length) {
        items = gh;
        console.log(`[notify] 已从 GitHub 读取 ${items.length} 条待审`);
      } else {
        console.warn('[notify] GitHub 读取为空，回退本地');
        items = readPending();
      }
    } catch (e) {
      console.warn('[notify] GitHub 读取异常，回退本地:', e.message);
      items = readPending();
    }
  } else {
    items = readPending();
  }
  if (onlyPrefix) items = items.filter((i) => i.id.startsWith(onlyPrefix));
  if (!items.length) {
    console.log('[notify] 无待审内容，跳过推送');
    return;
  }

  // 防重复：只推尚未推送过的；--force 全量重推
  loadNotifyState();
  const { toSend, skipped } = filterUnpushed(items);
  console.log(`[notify] 待推送 ${toSend.length} 条，已推过跳过 ${skipped.length} 条`);
  if (!toSend.length) {
    console.log('[notify] 本轮无新增待审，不重复推送（可用 --force 强制全量重推）');
    return;
  }
  await send(CHANNEL, toSend);
  // 推送成功后记录，避免下次重复发
  markPushed(toSend);
  console.log(`[notify] 已推送并记录 ${toSend.length} 条`);
}

main().catch((e) => {
  console.error('[notify] 失败:', e.message);
  process.exit(1);
});
