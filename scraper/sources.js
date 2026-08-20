// 中塞通 · 信息源配置
// enabled=false 的源暂不抓取（待配置/反爬/需部署），框架已兼容，后续启用即可
// env: ZHIPU_API_KEY 智谱AI Key（GLM-4-Flash 免费），用于塞尔维亚语→中文翻译

export const SOURCES = [
  {
    name: '中国驻塞使馆-重要通知',
    type: 'html',
    url: 'https://rs.china-embassy.gov.cn/lsyw/tongzhi/',
    category: 'news',
    kind: 'embassy',
    lang: 'zh',
    keywords: [],
    selector: 'a[href*="t202"]',
    enabled: true,
  },
  {
    name: '中国驻塞使馆-使馆动态',
    type: 'html',
    url: 'https://rs.china-embassy.gov.cn/sgdt/',
    category: 'news',
    kind: 'embassy',
    lang: 'zh',
    keywords: [],
    selector: 'a[href*="t202"]',
    enabled: true,
  },
  {
    name: '新华网-国际频道',
    type: 'rss',
    url: 'http://www.xinhuanet.com/world/news_world.xml',
    category: 'news',
    kind: 'news',
    lang: 'zh',
    keywords: ['塞尔维亚', '贝尔格莱德', '中塞', '匈塞', '尼什', '诺维萨德', '巴尔干'],
    maxItems: 100,
    enabled: true,
  },
  {
    name: '人民网-时政频道',
    type: 'rss',
    url: 'http://www.people.com.cn/rss/politics.xml',
    category: 'news',
    kind: 'news',
    lang: 'zh',
    keywords: ['塞尔维亚', '贝尔格莱德', '中塞', '匈塞', '巴尔干'],
    maxItems: 100,
    enabled: true,
  },
  {
    name: 'ChinaDaily-国际',
    type: 'rss',
    url: 'http://www.chinadaily.com.cn/rss/world_rss.xml',
    category: 'news',
    kind: 'news',
    lang: 'zh',
    keywords: ['Serbia', 'Serbian', 'Belgrade', 'China-Serbia'],
    maxItems: 100,
    enabled: true,
  },
  {
    name: 'Politika-塞尔维亚媒体',
    type: 'rss',
    url: 'https://www.politika.rs/rss',
    category: 'news',
    kind: 'news',
    lang: 'sr',
    keywords: [], // 空=全量收录（塞语本地媒体）
    maxItems: 15,
    enabled: true,
  },
  // ---- 以下源需额外配置后启用 ----
  {
    name: '塞尔维亚中资企业商会',
    type: 'html',
    url: '', // 待提供官网地址
    category: 'news',
    kind: 'chamber',
    lang: 'zh',
    keywords: [],
    selector: 'a',
    enabled: false,
  },
  {
    name: '微信公号-塞尔维亚相关 (wechat2rss)',
    type: 'rss',
    url: '', // 自部署 wechat2rss/RSSHub 后填入实例地址
    category: 'news',
    kind: 'news',
    lang: 'zh',
    keywords: ['塞尔维亚', '贝尔格莱德', '中塞', '华商', '塞国'],
    enabled: false,
  },
  // ---- 塞尔维亚本地媒体（塞语，自动翻译；空 keywords=回退 TOPIC_KEYWORDS 中塞相关过滤）----
  {
    name: 'B92-塞尔维亚媒体',
    type: 'rss',
    url: 'https://www.b92.net/feed/',
    category: 'news',
    kind: 'news',
    lang: 'sr',
    keywords: [], // 空=全量收录（塞语本地媒体）
    maxItems: 10,
    enabled: true,
  },
  {
    name: 'Danas-塞尔维亚媒体',
    type: 'rss',
    url: 'https://www.danas.rs/feed/',
    category: 'news',
    kind: 'news',
    lang: 'sr',
    keywords: [], // 空=全量收录（塞语本地媒体）
    maxItems: 10,
    enabled: true,
  },
  // ---- 以下源暂不可用，条件具备后启用 ----
  {
    name: 'N1-塞尔维亚媒体',
    type: 'rss',
    url: 'https://rs.n1info.com/feed/',
    category: 'news',
    kind: 'news',
    lang: 'sr',
    keywords: [],
    enabled: false, // Cloudflare JS 挑战，纯抓取被 403；需 headless 浏览器(playwright)或代理
  },
  {
    name: 'Tanjug-塞尔维亚通讯社',
    type: 'rss',
    url: '', // 域名当前不可达(连接超时)；建议以 RTS/Politika/Danas 替代
    category: 'news',
    kind: 'news',
    lang: 'sr',
    keywords: [],
    enabled: false,
  },
];

// 中塞相关关键词（用于判断是否收录）
export const TOPIC_KEYWORDS = [
  '塞尔维亚', '塞国', '贝尔格莱德', '中塞', '匈塞', '尼什', '诺维萨德', '苏博蒂察',
  '华商', '赴塞', '在塞', '塞华人', '巴尔干',
  'Serbia', 'Serbian', 'Belgrade', 'China-Serbia', 'Kina', 'Kineski', 'kinesk',
];

// 需要人工审核的敏感词（命中则跳过，避免误发）
export const BLOCK_WORDS = [
  '性爱', '赌博', '毒品', '代孕', '色情', '博彩',
];
