import { defineCollection, z } from 'astro:content';

// 信息条目：租房 / 二手 / 招聘 / 新闻 / 指南 / 供求
const items = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    sourceTitle: z.string().optional(),
    category: z.enum(['rentals', 'secondhand', 'jobs', 'news', 'guide', 'supply']),
    // 新闻子类型：使馆动态 / 商会动态 / 要闻（仅 news 使用）
    kind: z.enum(['embassy', 'chamber', 'news']).default('news'),
    price: z.string().optional(),
    location: z.string().optional(),
    date: z.coerce.date(),
    contact: z.string().optional(),
    featured: z.boolean().default(false),
    status: z.enum(['active', 'pending', 'expired', 'done']).default('active'),
    // 多图，第一张用于卡片
    images: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    source: z.string().optional(),
    // GEO：可直接引用的摘要（2-3 句结论，用于 meta description + JSON-LD + 详情页摘要段）
    summary: z.string().optional(),
    // 商业标记：置顶高亮 / 商家
    promoted: z.boolean().default(false),
  }),
});

export const collections = { items };
