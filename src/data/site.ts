// 中塞通 · 站点配置
export const SITE = {
  name: '中塞通',
  tagline: '塞尔维亚华人信息平台',
  description: '面向塞尔维亚华人的信息服务平台：租房、二手、招聘、中塞新闻、生活指南、供求对接',
  url: 'https://zhongsaitong.com',
  email: 'longandy2026@gmail.com',
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
