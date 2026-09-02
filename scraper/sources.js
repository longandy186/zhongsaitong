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
    keywords: [], // 空=用 SR_TOPIC_KEYWORDS 过滤（中塞+实用主题）
    articleSelector: '.article-content', // RSS 摘要太短时抓详情页补全文
    maxItems: 40,
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
  // ---- 租房：华人社区公众号（RSSHub/wechat2rss 转 RSS）----
  // autoPublish=true：自动发布、不经飞书逐条审核；写入即 active + 30 天 expireAt。
  // URL 就绪后把 enabled 改为 true 即可。
  {
    name: '华人社区租房 (微信公众号-RSSHub)',
    type: 'rss',
    url: '', // TODO: 填入 RSSHub/wechat2rss 实例地址，如 https://rsshub.example.com/wechat/...
    category: 'rentals',
    kind: 'rental',
    lang: 'zh',
    keywords: [], // 全量收录该号租房帖
    maxItems: 30,
    autoPublish: true,
    enabled: false,
  },
  // ---- 塞尔维亚本地媒体（塞语，自动翻译；空 keywords=回退 SR_TOPIC_KEYWORDS 中塞相关过滤）----
  {
    name: 'B92-塞尔维亚媒体',
    type: 'rss',
    url: 'https://www.b92.net/info/rss/vesti.xml', // 分类"新闻"feed，避免首页混入子站娱乐/八卦内容
    category: 'news',
    kind: 'news',
    lang: 'sr',
    keywords: [], // 空=用 SR_TOPIC_KEYWORDS 过滤
    maxItems: 25,
    enabled: true,
  },
  {
    name: 'Danas-塞尔维亚媒体',
    type: 'rss',
    url: 'https://www.danas.rs/feed/',
    category: 'news',
    kind: 'news',
    lang: 'sr',
    keywords: [], // 空=用 SR_TOPIC_KEYWORDS 过滤
    articleSelector: '.post-content', // RSS 摘要太短时抓详情页补全文
    maxItems: 25,
    enabled: true,
  },
  // ---- 新增：塞国头部媒体（2026-09-02 验证可用）----
  {
    name: 'RTS-塞尔维亚国家电视台',
    type: 'rss',
    url: 'https://www.rts.rs/page/stories/sr/rss.html',
    category: 'news',
    kind: 'news',
    lang: 'sr',
    keywords: [], // 空=用 SR_TOPIC_KEYWORDS 过滤
    maxItems: 20,
    enabled: true,
  },
  {
    name: 'Nova-塞尔维亚媒体',
    type: 'rss',
    url: 'https://nova.rs/feed/',
    category: 'news',
    kind: 'news',
    lang: 'sr',
    keywords: [], // 空=用 SR_TOPIC_KEYWORDS 过滤
    articleSelector: 'article', // RSS 摘要太短时抓详情页补全文
    maxItems: 25,
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

// 塞语源的收录过滤词（塞语源 keywords=[] 时用这张表，避免全量翻译浪费 token、堆审核积压）
// 覆盖：中塞关系 / 中国相关 / 经济 / 基建 / 民生实用（签证居留物价医疗等）/ 旅游
// 注意：塞尔维亚媒体双字母制——Politika/RTS 等用西里尔，B92/Danas/Nova 用拉丁，两张表都要有
export const SR_TOPIC_KEYWORDS = [
  // ===== 拉丁字母变体 =====
  // 中塞关系与中国（塞语"中国"=Kina，"中国的"=kineski/kineska/kinesko）
  'Kina', 'kinesk', 'Kineska', 'Kineski', 'Kineske', 'Srbija-Kina',
  'Xi Jinping', 'Huawei', 'ZTE', 'China', 'kineska kompanija', 'kineske kompanije',
  // 经济与企业
  'privreda', 'privredn', 'ekonomij', 'ekonomsk', 'investicij', 'investir', 'fabrika',
  'kompanij', 'preduzeće', 'banka', 'banke', 'finansij', 'kurs', 'inflacija', 'plate',
  'poresk', 'porez', 'budžet', 'budžetsk', 'trgovin', 'izvoz', 'uvoz', 'zaposlen', 'nezaposlenost',
  // 基建与重大项目
  'auto-put', 'autoput', 'železnic', 'brza pruga', 'pruga', 'most', 'aerodrom', 'luka',
  'gradilišt', 'infrastruktura', 'energetik', 'gasovod', 'naftovod', 'zelena energija',
  'vetropark', 'solarn', 'rudnik', 'lithium', 'litijum', 'Rio Tinto',
  // 欧盟与签证（注意：不直接用 'EU'——两字母小写会误命中 neutral/euro 等）
  'Evropska unija', 'evropska unija', 'evropsk', 'pristupn', 'integracij', 'viz', 'šengen',
  'Šengen', 'granic', 'putovnica', 'pasoš', 'boravak', 'radna dozvola', 'dozvola za rad',
  // 民生与生活
  'stan', 'stanova', 'nekretnin', 'kirija', 'cena', 'cene', 'stanarin', 'račun',
  'zdravstvo', 'zdravstven', 'bolnic', 'lekar', 'lekari', 'apotek', 'vakcin',
  'škola', 'školstv', 'fakultet', 'obrazovanj', 'vrtić', 'prevoz', 'javni prevoz',
  'gradski prevoz', 'metro', 'taksi', 'parking', 'saobraćaj', 'bezbednost', 'vremenska prognoza',
  // 旅游与文化
  'turizam', 'turističk', 'EXPO', 'EXPO 2027', 'manifestacij', 'festival', 'sajam',
  'hotel', 'restoran', 'muzej', 'beograd', 'Novi Sad', 'Niš', 'Kragujevac', 'Subotica',
  // ===== 西里尔字母变体（Politika/RTS 等）=====
  // 中塞关系与中国
  'Кина', 'кинеск', 'Кинеска', 'Кинески', 'Кинеске', 'кинеска компанија',
  'Си Ђинпинг', 'Хуавеј', 'Кина-Србија',
  // 经济与企业
  'привреда', 'привредн', 'економиј', 'економск', 'инвестициј', 'фабрика',
  'компаниј', 'предузеће', 'банка', 'банке', 'финансиј', 'инфлација', 'плате',
  'пореск', 'порез', 'буџет', 'буџетск', 'трговин', 'извоз', 'увоз', 'запослен', 'незапосленост',
  // 基建与重大项目
  'аутопут', 'железниц', 'брза пруга', 'пруга', 'мост', 'аеродром', 'лука',
  'градилишт', 'инфраструктура', 'енергетик', 'гасовод', 'нафтовод', 'зелена енергија',
  'ветропарк', 'соларн', 'рудник', 'литијум', 'Рио Тинто',
  // 欧盟与签证
  'Европска унија', 'европска унија', 'европск', 'приступн', 'интеграциј', 'виз', 'шенген',
  'границ', 'путовница', 'пасош', 'боравак', 'радна дозвола', 'дозвола за рад',
  // 民生与生活
  'стан', 'станова', 'некретнин', 'кирија', 'цена', 'цене', 'станарин', 'рачун',
  'здравство', 'здравствен', 'болниц', 'лекар', 'лекари', 'апотек', 'вакцин',
  'школа', 'школств', 'факултет', 'образовањ', 'вртић', 'превоз', 'јавни превоз',
  'градски превоз', 'метро', 'такси', 'паркинг', 'саобраћај', 'безбедност', 'временска прогноза',
  // 旅游与文化
  'туризам', 'туристичк', 'ЕКСПО', 'манифестациј', 'фестивал', 'сајам',
  'хотел', 'ресторан', 'музеј', 'београд', 'Нови Сад', 'Ниш', 'Крагујевац', 'Суботица',
];

// 需要人工审核的敏感词（命中则跳过，避免误发）
export const BLOCK_WORDS = [
  '性爱', '赌博', '毒品', '代孕', '色情', '博彩',
];
