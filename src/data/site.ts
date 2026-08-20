// 中塞通 · 站点配置
export const SITE = {
  name: '中塞通',
  tagline: '塞尔维亚华人信息平台',
  description: '面向塞尔维亚华人的信息服务平台：租房、二手、招聘、中塞新闻、生活指南、供求对接',
  url: 'https://your-domain.com',
  email: 'contact@your-domain.com',
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

// 类型色块
export const TYPE_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  rentals: { label: '租', bg: 'rgba(233,69,96,0.12)', color: '#E94560' },
  secondhand: { label: '卖', bg: 'rgba(0,184,148,0.12)', color: '#00B894' },
  jobs: { label: '招', bg: 'rgba(9,132,227,0.12)', color: '#0984E3' },
  news: { label: '讯', bg: 'rgba(253,203,110,0.18)', color: '#B8860B' },
  guide: { label: '指', bg: 'rgba(26,26,46,0.08)', color: '#1A1A2E' },
  supply: { label: '求', bg: 'rgba(233,69,96,0.08)', color: '#C23648' },
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

// 表单接收端（formsubmit.co 免费版：注册后填入你的邮箱，如 https://formsubmit.co/your@email.com）
export const FORM_ENDPOINT = 'https://formsubmit.co/your@email.com';
