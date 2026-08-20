# 中塞通 · 自己发布内容操作手册

> 你是运营者，发布内容有三种方式，按使用频率排：
> 1. **在 WorkBuddy 里直接说**（最常用，30 秒）
> 2. **GitHub 网页版新建文件**（不依赖 AI，随时可发）
> 3. **本地编辑**（批量操作时用）

---

## 方式一：在 WorkBuddy 里发布（推荐，最常用）

直接把内容用自然语言告诉我，例如：

```
发布一条：新贝两室一厅出租，700欧/月，带家具，微信 xxx
```

或更详细：

```
发布：塞尔维亚中资企业商会招聘行政助理，要求中塞双语，
地点贝尔格莱德，待遇面议，联系方式微信 xxx
```

我会自动完成：写标题 → 归类（租房/买卖/招聘/新闻/指南/供求）→ 生成 .md → 构建预览 → 推送到 GitHub 上线。

**告诉我的内容越接近原文越好**，我会负责整理格式。如果是塞语内容，我会自动翻译。

---

## 方式二：GitHub 网页版新建文件（30 秒，无需装任何软件）

1. 打开你的 GitHub 仓库 → 进入 `src/content/items/` 文件夹
2. 点右上角 **Add file** → **Create new file**
3. 粘贴下面的模板，改内容
4. 文件名用英文/拼音，如 `2026-0819-zeleng-chuzu.md`
5. 点下方 **Commit changes** → 确认提交
6. 等 2-3 分钟，Cloudflare Pages 自动构建，网站更新

### 信息条目模板（复制后改）

```markdown
---
title: 新贝 两室一厅 带家具出租
category: rentals        # rentals租房 | secondhand买卖 | jobs招聘 | news新闻 | guide指南 | supply供求
price: 700€/月           # 有价格必填
location: 新贝·泽蒙
date: 2026-08-19
contact: 微信 xxx
status: active           # active直接上线 | pending待审核
images:                  # 有图就填，第一张做封面
  - /images/xxx.jpg
tags: [租房, 带家具]
source: 自己发布
---

两室一厅，约 62 平米，带全套家具，拎包入住。

- 近轻轨站，出行便利
- 房东直租，无中介费

联系方式：微信 xxx
```

**关键字段说明**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `title` | 是 | 中文标题，突出关键信息 |
| `category` | 是 | 对应首页 Tab：租房/买卖/招聘/新闻/指南/供求 |
| `date` | 是 | 当天日期，格式 `2026-08-19` |
| `contact` | 是 | 联系方式（微信/电话） |
| `status` | 否 | 默认 `active` 直接上线；写 `pending` 则仅你可见待审核 |
| `price` | 否 | 价格，显示为红色 |
| `location` | 否 | 位置 |
| `images` | 否 | 图片路径，放 `public/images/` 下 |
| `tags` | 否 | 标签，可多个 |

### 新闻类模板（含来源标注）

```markdown
---
title: 使馆提醒：来塞公民注意证件有效期
category: news
kind: embassy           # embassy使馆 | chamber商会 | news要闻
date: 2026-08-19
status: active
source: 中国驻塞使馆官网
tags: [使馆提醒]
---

正文摘要…

> 信息来源：中国驻塞使馆官网，详情见原文
```

### 图片怎么加

1. 把图片文件（jpg/png）上传到仓库的 `public/images/` 文件夹
2. 路径写 `/images/你的文件名.jpg`
3. 或直接用外部图片链接（`https://...`）

---

## 方式三：本地编辑（批量操作）

```bash
cd zhongsaitong
npm run dev    # 本地预览 http://localhost:4321
```

- 在 `src/content/items/` 新建/编辑 .md 文件
- 预览确认后 `git add . && git commit && git push`
- 推上去 Cloudflare Pages 自动上线

---

## 发布后检查

1. 打开网站首页，看新内容是否出现
2. 点进详情页，检查价格/位置/联系方式是否正确
3. 不对就改回来（GitHub 里直接编辑该文件再 commit）

---

## 下线 / 修改 / 删除

| 操作 | 方法 |
|------|------|
| **下线** | 在 WorkBuddy 说"下线 XX"，或改文件 `status: active` → `expired` |
| **修改** | GitHub 里点进文件 → 铅笔图标编辑 → commit |
| **删除** | GitHub 里点进文件 → 垃圾桶图标 → commit |

---

## 常见问题

**Q：发布的信息多久能在网上看到？**
A：提交后 Cloudflare Pages 自动构建，通常 2-3 分钟。

**Q：可以发图片吗？**
A：可以，见"图片怎么加"。

**Q：塞语内容怎么办？**
A：发给我，我翻译后发布；或你在 GitHub 里写好中文版直接提交。
