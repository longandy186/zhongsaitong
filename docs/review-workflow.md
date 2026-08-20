# 远程审核工作流（手机审核 + 回复即发布）

> 解决「不在电脑前也能审核」：每天自动抓取 → 推送待审到**飞书**(审核主渠道) → 手机点链接即发布/跳过 → 站点自动重建。
>
> ⚠️ **公众号账号类型约束（2026-08 核实）**：微信已不区分"订阅号/服务号"叫法，个人账号统一称「公众号」(即原订阅号)；**个人认证免费**(仅身份/名称保护)，企业「微信认证」才收 300/年。**个人公众号没有客服消息接口**(`/cgi-bin/message/custom/send` 返回 `48001 api unauthorized`)，因此**无法主动推送审核链接**。→ 审核用飞书；公众号个人号只做「导流」(群发每日要闻图文)，不参与审核。

## 闭环流程

```
GitHub Actions (每天 08:00 & 20:00 北京时间)
  ├─ 跑抓取 scraper/run.js  → 写入 pending 草稿 → 提交
  └─ 跑通知 scraper/notify.js → 汇总 pending → 推送到审核渠道
                              ↓
        你在手机上收到卡片/消息，点 [✅ 发布] 或 [⏭ 跳过] 链接
                              ↓
  链接指向 Cloudflare Pages Function  /api/approve
    ├─ 校验 HMAC 签名（防伪造）
    ├─ 调 GitHub API 把该 md 的 status 改为 active / rejected
    └─ 提交 → Cloudflare Pages 自动重建站点上线
```

审核链接是「带签名的可点击链接」，任何能渲染 Markdown 链接的渠道都适用，**无需为每个渠道单独开发交互卡片**。

## 需要配置的两处密钥

### 1. GitHub Actions Secrets（仓库 Settings → Secrets and variables → Actions）
| 变量 | 说明 |
|---|---|
| `ZHIPU_API_KEY` / `AGNES_API_KEY` | 翻译（已有） |
| `NOTIFY_CHANNEL` | 渠道名：**`feishu`(默认审核渠道)** / `wechat` / `whatsapp` / `none`。审核推荐用 `feishu` |
| `FEISHU_WEBHOOK` | 飞书群自定义机器人 webhook（审核用，填这个） |
| `WECHAT_APPID` / `WECHAT_APPSECRET` / `WECHAT_TO_OPENID` | 公众号凭证。**仅当你注册的是企业服务号**时才用于审核推送；个人公众号无客服消息接口，此渠道不可用，请改用飞书审核 |
| `APPROVE_URL` | 审核回调地址，即 Cloudflare Function 公网 URL，如 `https://zhongsaitong.pages.dev/api/approve` |
| `APPROVE_SECRET` | 签名密钥（与下方 Cloudflare 的必须一致，自行生成一段随机串） |

> 生成密钥示例：`openssl rand -hex 16`

### 2. Cloudflare Pages 环境变量（Pages 后台 → Settings → Functions → Environment variables）
| 变量 | 说明 |
|---|---|
| `APPROVE_SECRET` | 与 GitHub Actions 里的 `APPROVE_SECRET` 完全一致 |
| `GH_TOKEN` | 有 `repo` 写权限的 GitHub Personal Access Token（用于 Function 改文件并提交） |
| `REPO` | 仓库名，格式 `owner/name` |

> 注意：Cloudflare 的环境变量若含敏感值，请在后台标记为 **Secret**（加密存储）。

## 本地联调

```bash
# 仅打印 Markdown 预览，不真正发送（验证读取 pending + 生成签名链接）
cd scraper
NOTIFY_CHANNEL=none \
  APPROVE_URL="https://zhongsaitong.pages.dev/api/approve" \
  APPROVE_SECRET="testsecret" \
  node notify.js
```

在本地无法真正触发 Cloudflare Function（需部署后才有公网 `/api/approve`）。

## 如何新增一个渠道（可插拔点）

`scraper/notify.js` 的 `send(channel, text, count)` 是唯一定制点：

- **飞书**：已实现，发交互卡片（markdown 元素，链接可点）。
- **微信(公众号)**：已实现（链接模式），但**仅适用于已认证的服务号/企业号**——调用的是客服消息接口(`/cgi-bin/message/custom/send`)。**个人公众号该接口返回 `48001` 不可用**，故个人号不能靠它做审核推送。若你最终是个人公众号：① 审核改用飞书（推荐）；② 或改造成「被动回复图文」拉取式（你给公众号发"审核"→ Function 回带链接的图文，需新增 `/api/wechat` 回调 + 服务器配置）。当前 `wechat` 适配器保持，待你确定号型后再决定是否启用/改造。
- **公众号导流（与个人号匹配的做法）**：个人公众号用**群发图文接口**(每天 1 次，发给所有粉丝)做「中塞通每日要闻」内容引流——这是群发接口(`群发接口` 个人号可用)，与审核是两个独立功能。如需自动群发，可另写一个 `scraper/publish-wechat.js` 调群发接口，把已 `active` 的要闻汇总成图文发出（属于「导流」不是「审核」）。
- **WhatsApp**：在 `send()` 里加 `whatsapp` 分支，调用 Twilio / Meta Cloud API（配置 `TWILIO_SID`/`TWILIO_TOKEN`/`WA_FROM`/`WA_TO`）。

只需让新渠道把 `text`（含签名链接的 Markdown）发出去即可，审核落地逻辑全部由 `/api/approve` 统一处理，**无需改动 Function**。

## 审核动作说明

| 链接 | 效果 |
|---|---|
| `[✅ 发布]` | 该条 `status: pending → active`，上线 |
| `[⏭ 跳过]` | 该条 `status: pending → rejected`，不再推送（可在后台手动改回） |
| `[🚀 发布全部「中塞+生活」]` | 批量发布 topic 为中塞/生活的待审 |
| `[🗑 全部跳过]` | 批量跳过当前所有待审 |

## 安全

- 审核链接带 HMAC 签名，他人无法伪造发布；签名仅 16 位 hex，足够防止偶然猜测。
- 若 `APPROVE_SECRET` 泄露，重新生成并在两处同步更新即可。
- Function 仅能改 `src/content/items/*.md` 的 status 字段，不会动其他文件。

## 待办 / 备注

- N1（Cloudflare 拦截）、Tanjug（域名失效）仍未接入，本地媒体目前靠 B92 / Danas / Politika。
- 飞书交互卡片的「按钮」本质是 Markdown 链接（点开浏览器访问 Function），体验等同按钮，但无需配置飞书事件回调，最省事。
