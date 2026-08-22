// 首页顶部轮播 banner（真实图片 + 短文案，不再重复 6 个 Tab 分类）
export const BANNERS = [
  {
    title: '在塞华人的家',
    subtitle: '一个就够的信息入口',
    image: '/images/banner-belgrade.jpg',
    url: '/',
  },
  {
    title: '找房招工 更省心',
    subtitle: '本地真实房源 · 靠谱工作机会',
    image: '/images/banner-home.jpg',
    url: '/rentals/',
  },
  {
    title: '每日要闻 不错过',
    subtitle: '使馆 · 商会 · 本地媒体 · 一次看完',
    image: '/images/banner-news.jpg',
    url: '/news/',
  },
];

// 信息流中每隔 N 条插入一条广告（-1 表示不插入）
export const FEED_AD_EVERY = -1;

// 信息流广告卡片
export const FEED_ADS = [
  {
    title: '你的商家信息 出现在这里',
    desc: '首页信息流广告位招商中，触达全部在塞华人',
    image: '/images/ad-placeholder.svg',
    url: '/advertise/',
  },
];
