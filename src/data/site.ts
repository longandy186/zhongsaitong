// 中塞通 · 站点配置
export const SITE = {
  name: '中塞通',
  tagline: '塞尔维亚华人信息平台',
  description: '面向塞尔维亚华人的信息服务平台：租房、二手、招聘、中塞新闻、生活指南、供求对接',
  url: 'https://zhongsaitong.com',
  email: 'longandy2026@gmail.com',
  // 社交分享主图（og:image）：分享到微信/WhatsApp/TikTok/Telegram 时的预览大图，1200×630
  // 详情页会优先用条目自己的图片，取不到时才回退到这张
  ogImage: '/images/og-default.jpg',
  // Cloudflare Web Analytics beacon token（浏览互动统计：停留时长 / 滚动 / 点击）
  // 留空 = 不埋点；填上后到 CF 后台 Analytics & Logs → Web Analytics 就能看互动数据。
  // ⚠️ 该 token 本身公开（写在客户端 JS 里），不属机密。
  // ⚠️ 若在 CF 后台对该 Pages 项目启用了「自动注入」，此处必须留空，否则重复计数。
  cfBeaconToken: '',
};

// 信息流 Tab（7 个分类）
export const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'rentals', label: '租房' },
  { key: 'secondhand', label: '买卖' },
  { key: 'jobs', label: '招聘' },
  { key: 'news', label: '新闻' },
  { key: 'guide', label: '指南' },
  { key: 'supply', label: '供求' },
] as const;

export const CATEGORY_LABEL: Record<string, string> = {
  all: '全部',
  rentals: '租房',
  secondhand: '买卖',
  jobs: '招聘',
  news: '新闻',
  guide: '指南',
  supply: '供求',
};

// 新闻子分类（使馆 / 商会 / 要闻）
export const NEWS_KINDS = [
  { key: 'all', label: '全部' },
  { key: 'embassy', label: '使馆动态' },
  { key: 'chamber', label: '商会动态' },
  { key: 'news', label: '中塞要闻' },
];

// 类型色块（v2 五色标签系统）
export const TYPE_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  rentals: { label: '租', bg: 'rgba(39,174,96,0.12)', color: '#27AE60' },     // 租房 → 绿
  secondhand: { label: '卖', bg: 'rgba(234,88,12,0.12)', color: '#EA580C' },  // 买卖 → 橙
  jobs: { label: '招', bg: 'rgba(142,68,173,0.12)', color: '#8E44AD' },       // 招聘 → 紫
  news: { label: '讯', bg: 'rgba(123,30,59,0.12)', color: '#7B1E3B' },        // 新闻 → 酒红
  guide: { label: '指', bg: 'rgba(123,30,59,0.12)', color: '#7B1E3B' },       // 指南 → 酒红
  supply: { label: '求', bg: 'rgba(142,68,173,0.12)', color: '#8E44AD' },     // 供求 → 紫
};

// 公众号 / 视频号（二维码图片放 public/images/，注册后替换）
export const SOCIAL = {
  wechatName: '中塞通',
  wechatQr: '/images/wechat-qr-placeholder.svg',
  channelName: '中塞通',
  channelUrl: '#', // 视频号主页链接，开通后填入
  channelCard: '/images/channel-card.png',
};

// 广告合作入口
export const AD_URL = '/advertise/';

// 表单接收端（formsubmit.co 免费版：填入接收邮箱，如 https://formsubmit.co/your@email.com）
export const FORM_ENDPOINT = 'https://formsubmit.co/longandy2026@gmail.com';

