# 中塞通 · 塞尔维亚华人信息平台

移动优先的华人信息平台：**小红书式图片信息流**，7 个分类 Tab。
基于 **Astro 静态站 + GitHub 仓库 + Cloudflare Pages**，除域名外零成本。

## 快速开始

```bash
npm install
npm run dev      # 本地预览 http://localhost:4321
npm run build    # 构建到 dist/
```

## 内容目录（即"后台"）

所有内容都在 `src/content/items/`，每条一个 `.md` 文件。

**发布一条信息 = 新增一个 .md 文件，push 后几分钟自动上线。**

### frontmatter 格式

```yaml
---
title: 泽蒙区 二室一厅 带家具出租   # 中文标题
category: rentals                  # rentals | secondhand | jobs | news | guide | supply
kind: news                         # 仅新闻：embassy(使馆) | chamber(商会) | news(要闻)
price: 700€/月                     # 可选
location: 新贝·泽蒙                # 可选
date: 2026-08-19                   # 发布日期
contact: 微信 xxx                  # 联系方式
images:                            # 可选，1-3 张，第一张用于卡片
  - /images/xxx.jpg
tags: [租房, 带家具]               # 可选
source: 4zida.rs                   # 来源标注
featured: false                    # 置顶
promoted: false                    # 付费推广
status: active                     # active | expired | done
---
正文（Markdown）
```

## 页面结构

| 路由 | 页面 |
|------|------|
| `/` | 首页信息流（全部，双列图片流） |
| `/rentals/` `/secondhand/` `/jobs/` `/news/` `/guide/` `/supply/` | 分类浏览 |
| `/news/` | 新闻页内含使馆/商会/要闻筛选 |
| `/post/[slug]/` | 信息详情（图墙） |
| `/publish/` | 发布投稿 |
| `/advertise/` | 广告合作（商业转化） |
| `/search?q=` | 搜索 |

## 商业转化

- 广告位配置：`src/data/ads.ts`（首页 banner 轮播 + 信息流插卡，间隔 `FEED_AD_EVERY`）
- 推广位：信息条目 `promoted: true` → 卡片带"推广"标识
- 广告合作页：`/advertise/`

## 双端导流

- 首页顶部关注条：公众号二维码 + 视频号入口（`src/data/site.ts` 的 `SOCIAL`）
- 详情页文末关注引导
- 公众号/视频号二维码图片放 `public/images/`

## 部署

1. 推送到 GitHub（私有仓库）
2. Cloudflare Pages → Create Project → 连接 GitHub 仓库
3. 构建配置：`npm run build`，输出目录 `dist`
4. 绑定域名（Cloudflare 免费）

## 需要替换的配置

- `astro.config.mjs` 中 `site` 域名
- `src/data/site.ts`：`url`、`email`、`FORM_ENDPOINT`、`SOCIAL`（二维码/视频号）
- `public/images/` 下替换真实二维码图

## 运营工作流

见 `docs/content-workflow.md`：采集 → AI 翻译转写 → 生成稿件 → 审核 → 发布 → 自动部署，
人工只做审核 / 发布 / 删除。

**自己发布内容**：见 `docs/publish-guide.md`（WorkBuddy 一句话发布 / GitHub 网页版 / 本地编辑三种方式 + 模板）。

## 自动信息采集（GitHub Actions）

采集器位于 `scraper/`，定时（每天 8/14/20 点）抓取信息源，自动生成稿件并提交，
Cloudflare Pages 自动部署。**采集的内容默认 `status: pending`，不会直接上线**，
你在 WorkBuddy 里审核后改为 `active` 才展示。

```bash
cd scraper
npm install
ZHIPU_API_KEY=xxx node run.js    # 采集+翻译，输出到 ../src/content/items/
```

- 信息源配置：`scraper/sources.js`（使馆公告、新华/人民/ChinaDaily RSS、Politika 等）
- 翻译：双 AI 提供商自动降级——首选智谱 GLM（`glm-4.7-flash`，限流自动降级 `glm-4-flash`/`glm-4-flashx`），兜底 Agnes（`agnes-2.5-flash`，免费）
- 定时任务：`.github/workflows/scrape.yml`（cron，也可手动触发）
- 去重：按 `source + sourceTitle` 比对已发布内容，跳过重复

### 需要配置的 Secrets（GitHub → Settings → Secrets and variables → Actions）

| Secret | 用途 |
|--------|------|
| `ZHIPU_API_KEY` | 智谱 AI Key（bigmodel.cn 注册，GLM-4.7-Flash 免费，200K 上下文） |
| `AGNES_API_KEY` | Agnes AI Key（agnes-ai.com，agnes-2.5-flash 免费，兜底用） |

### 待启用的信息源（改 `enabled: true` 即可）

| 源 | 前提 |
|----|------|
| 塞尔维亚中资企业商会 | 提供官网地址 |
| 微信公号 (wechat2rss) | 自部署 RSSHub/wechat2rss 实例 |
| N1/Tanjug/B92 本地媒体 | 反爬，需代理方案 |
