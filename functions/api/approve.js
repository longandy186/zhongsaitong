// functions/api/approve.js
// Cloudflare Pages Function：接收「审核链接」回调，更新 GitHub 上的 md 状态。
//
// 审核链接由 scraper/notify.js 生成（带 HMAC 签名），例如：
//   /api/approve?action=publish&id=2026xxx&sig=abcd...
//   /api/approve?action=batch&ids=a,b,c&sig=abcd...
//   /api/approve?action=skip&ids=a,b,c&sig=abcd...
//
// 部署后需在 Cloudflare Pages 后台设置环境变量（Secrets）：
//   APPROVE_SECRET  —— 与 notify.js 的 APPROVE_SECRET 一致
//   GH_TOKEN        —— 有 repo 写权限的 GitHub Personal Access Token
//   REPO            —— 仓库名 owner/name
//
// 推送改动到 GitHub 后，Cloudflare Pages 会自动重建站点上线。

// HMAC（Web Crypto，Cloudflare Workers 运行时）
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function html(body) {
  return new Response(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px;color:#222">${body}</body>`, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function deny() {
  return new Response('签名无效或参数错误', { status: 403 });
}

// Cloudflare Workers 无 Node Buffer，用 atob/btoa + TextEncoder 处理 base64
function b64ToString(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function stringToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const sig = url.searchParams.get('sig') || '';
  const id = url.searchParams.get('id');
  const ids = url.searchParams.get('ids');

  const secret = env.APPROVE_SECRET || '';
  const repo = env.REPO || '';
  const token = env.GH_TOKEN || '';

  if (!secret || !repo || !token) {
    return html('<h2>⚠️ 未配置</h2><p>请在 Cloudflare Pages 后台设置 APPROVE_SECRET / GH_TOKEN / REPO。</p>');
  }

  // 1) 校验签名并解析目标
  let targets = [];
  let mode = null;
  const actions = {
    publish: () => (id ? ((targets = [id]), (mode = 'publish')) : null),
    skip: () => (id ? ((targets = [id]), (mode = 'skip')) : null),
    batch: () => (ids ? ((targets = ids.split(',')), (mode = 'publish')) : null),
    delete: () => (id ? ((targets = [id]), (mode = 'delete')) : null),
  };
  // skip / delete 批量也复用 ids
  if ((action === 'skip' || action === 'delete') && ids) {
    targets = ids.split(',');
    mode = action;
  } else if (actions[action]) {
    actions[action]();
  }
  if (!targets.length || !mode) return deny();

  const payload = mode === 'publish' && action === 'batch' ? ids : (action === 'skip' || action === 'delete') && ids ? ids : id;
  const expected = await hmacHex(secret, `${action}:${payload}`);
  if (expected !== sig) return deny();

  // 2) 逐条处理
  //    发布/跳过：从 drafts 草稿读取 → 写入 main → 清理草稿
  //    删除：直接从 main 删除文件（已发布内容都在 main）→ 触发部署
  const results = [];
  const branch = 'main';
  const draftBranch = 'drafts';
  for (const tid of targets) {
    const fileName = `${encodeURIComponent(tid)}.md`;
    const contentPath = `src/content/items/${fileName}`;
    const draftApi = `https://api.github.com/repos/${repo}/contents/${contentPath}?ref=${draftBranch}`;
    const mainApi = `https://api.github.com/repos/${repo}/contents/${contentPath}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'zst-approve',
      Accept: 'application/vnd.github+json',
    };

    if (mode === 'delete') {
      // 删除：直接删 main 上的文件
      let mainSha = null;
      try {
        const r = await fetch(mainApi, { headers });
        if (r.ok) mainSha = (await r.json()).sha;
      } catch { /* ignore */ }
      if (!mainSha) {
        results.push(`${tid}: main 无此文件(无需删除)`);
        continue;
      }
      const delRes = await fetch(mainApi, {
        method: 'DELETE',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: `delete: ${tid}`,
          branch,
          sha: mainSha,
        }),
      });
      if (!delRes.ok) {
        results.push(`${tid}: 删除失败(${delRes.status})`);
        continue;
      }
      // 同时清理可能残留的草稿
      let draftSha = null;
      try {
        const r = await fetch(draftApi, { headers });
        if (r.ok) draftSha = (await r.json()).sha;
      } catch { /* ignore */ }
      if (draftSha) {
        await fetch(draftApi, {
          method: 'DELETE',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ message: `delete: 移除草稿 ${tid}`, branch: draftBranch, sha: draftSha }),
        });
      }
      results.push(`${tid}: 🗑 已删除`);
      continue;
    }

    // 2.1 优先从 drafts 草稿读取；草稿不存在时回退 main（兼容历史遗留 pending）
    let sourceApi = draftApi;
    let sourceSha = null;
    let content = null;
    try {
      const r = await fetch(draftApi, { headers });
      if (r.ok) {
        const d = await r.json();
        sourceSha = d.sha;
        content = b64ToString(d.content);
      }
    } catch { /* ignore */ }
    if (content === null) {
      try {
        const r = await fetch(mainApi, { headers });
        if (r.ok) { const d = await r.json(); sourceSha = d.sha; content = b64ToString(d.content); sourceApi = mainApi; }
      } catch { /* ignore */ }
    }
    if (content === null) {
      results.push(`${tid}: 草稿与 main 均无此文件`);
      continue;
    }

    const newStatus = mode === 'publish' ? 'active' : 'rejected';
    const newContent0 = content.replace(/^status:\s*pending\s*$/m, `status: ${newStatus}`);
    if (newContent0 === content) {
      results.push(`${tid}: 状态未变(已处理过或非 pending)`);
      continue;
    }
    let newContent = newContent0;
    // 发布时记录审核发布时间（用于排序：优先按 publishedAt）
    if (mode === 'publish') {
      const now = new Date().toISOString();
      if (/^publishedAt:/m.test(newContent)) {
        newContent = newContent.replace(/^publishedAt:.*$/m, `publishedAt: ${now}`);
      } else {
        newContent = newContent.replace(/^(status: active)$/m, `$1\npublishedAt: ${now}`);
      }
    }

    // 2.2 写入 main（已存在则更新，不存在则创建）→ 触发部署
    let mainSha = null;
    try {
      const r = await fetch(mainApi, { headers });
      if (r.ok) mainSha = (await r.json()).sha;
    } catch { /* ignore */ }
    const putRes = await fetch(mainApi, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: `review: ${mode} ${tid}`,
        content: stringToB64(newContent),
        branch,
        ...(mainSha ? { sha: mainSha } : {}),
      }),
    });
    if (!putRes.ok) {
      results.push(`${tid}: 写入 main 失败(${putRes.status})`);
      continue;
    }

    // 2.3 清理草稿（仅当来源是草稿时）
    if (sourceApi === draftApi && sourceSha) {
      await fetch(draftApi, {
        method: 'DELETE',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: `review: 移除草稿 ${tid}`,
          branch: draftBranch,
          sha: sourceSha,
        }),
      });
    }
    results.push(`${tid}: ${mode === 'publish' ? '✅ 已发布' : '⏭ 已跳过'}`);
  }

  const verb = mode === 'publish' ? '发布' : mode === 'delete' ? '删除' : '跳过';
  return html(
    `<h2>中塞通 · 审核${verb}</h2>` +
      `<p>共处理 <b>${targets.length}</b> 条。</p>` +
      `<pre style="background:#f5f5f5;padding:12px;border-radius:8px;white-space:pre-wrap">${results.join('\n')}</pre>` +
      `<p>站点将在数分钟内自动重建上线。可关闭此页。</p>`
  );
}
