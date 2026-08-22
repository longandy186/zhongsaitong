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
//   NOTIFY_CHANNEL=feishu FEISHU_WEBHOOK=xxx APPROVE_URL=https://x.pages.dev/api/approve APPROVE_SECRET=yyy node notify.js
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

// ---------- 读取 pending ----------
function readPending() {
  if (!fs.existsSync(ITEMS_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(ITEMS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const raw = fs.readFileSync(path.join(ITEMS_DIR, f), 'utf8');
    if (!/^status:\s*pending\s*$/m.test(raw)) continue;
    const fm = raw.slice(0, (raw.indexOf('---', 3) > 0 ? raw.indexOf('---', 3) : raw.length));
    const get = (k) =>
      ((fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1] || '')
        .trim()
        .replace(/^["']|["']$/g, '');
    out.push({
      id: f.replace(/\.md$/, ''),
      file: f,
      title: get('title'),
      topic: get('topic') || '其他',
      source: get('source'),
    });
  }
  // 新的在前
  return out.reverse();
}

// ---------- 生成 Markdown ----------
// opts.heading: 卡片内 H2 标题（分批时用，如「待审核 1-15/50」）
function buildMarkdown(items, opts = {}) {
  const heading = opts.heading || `📰 中塞通 · 待审核 ${items.length} 条`;
  const groups = { 中塞: [], 生活: [], 其他: [] };
  for (const it of items) (groups[it.topic] || groups['其他']).push(it);

  let md = `## ${heading}\n\n`;
  md += `点击下方链接即可在手机上审核发布，无需开电脑。\n\n`;

  for (const g of ['中塞', '生活', '其他']) {
    const list = groups[g];
    if (!list.length) continue;
    md += `### ${g}（${list.length}）\n`;
    for (const it of list) {
      const pub = approveUrl('publish', it.id);
      const skip = approveUrl('skip', it.id);
      md += `- ${it.title}\n  [✅ 发布](${pub}) · [⏭ 跳过](${skip})\n`;
    }
    md += `\n`;
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
  if (!APPROVE_URL || !SECRET) {
    console.warn('[notify] 警告：APPROVE_URL 或 APPROVE_SECRET 未设置，仅做本地预览（channel=none 行为）');
  }
  const items = readPending();
  if (!items.length) {
    console.log('[notify] 无待审内容，跳过推送');
    return;
  }
  await send(CHANNEL, items);
}

main().catch((e) => {
  console.error('[notify] 失败:', e.message);
  process.exit(1);
});
