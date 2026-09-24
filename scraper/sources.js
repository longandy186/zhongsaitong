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
    // 使馆页面只有 logo，没有内容图、也没有 og:image（已实测），直接用品牌封面兜底
    ogImage: false,
    fallbackImage: '/images/covers/cover-embassy.jpg',
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
    ogImage: false,
    fallbackImage: '/images/covers/cover-embassy.jpg',
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
//
// ⚠️ 2026-09-25 重构：此前是纯子串匹配（t.includes(kw)），导致大量误命中：
//      luka（港口）→ Lukašenko（卢卡申科）/ Luka Dončić
//      Niš（尼什市） → uništena（被摧毁）
//      stan（公寓）  → stanovnica（女居民）/ stanici（警察局）
//      viz（签证）   → televizija（电视）/ revizija
//      kurs（汇率）  → konkurs（招标）
//    现改为「前边界严格 + 允许后缀」的匹配（见 matchKeyword），并清掉了
//    kurs/viz/most/luka/evropsk 等歧义词，换成无歧义写法（viza 家族 / Evropska unija 等）。
export const SR_TOPIC_KEYWORDS = [
  // ===== 拉丁字母变体 =====
  // 中塞关系与中国（塞语"中国"=Kina；变格 Kine/Kini/Kinu/Kinom 需逐个列，不能只留 Kin 词干——会误命中 kino/kinematograf）
  'Kina', 'Kine', 'Kini', 'Kinu', 'Kinom', 'kinesk', 'Srbija-Kina',
  'Xi Jinping', 'Si Đinping', 'Huawei', 'ZTE', 'China',
  // 经济与企业
  'privred', 'ekonomij', 'ekonomsk', 'investicij', 'investir', 'fabrika',
  'kompanij', 'preduzeć', 'bank', 'finansij', 'inflacij', 'plata', 'plate', 'platu', 'platama',
  'zarad', 'poresk', 'porez', 'budžet', 'trgovin', 'izvoz', 'uvoz', 'zaposlen', 'nezaposlenost',
  // 基建与重大项目
  'auto-put', 'autoput', 'železnic', 'brza pruga', 'pruga', 'aerodrom',
  'gradilišt', 'infrastruktura', 'energetik', 'gasovod', 'naftovod', 'zelena energija',
  'vetropark', 'solarn', 'rudnik', 'lithium', 'litijum', 'Rio Tinto',
  // 能源价格与供暖（在塞过冬的刚需，媒体常单独成文，不含上面那些词根）
  'struja', 'gorivo', 'dizel', 'benzin', 'naft', 'grejanj', 'grejanje',
  // 欧盟与签证（不直接用 'EU'——会误命中 neutral/euro；也不再用 'evropsk' 单字根——会命中欧洲排球赛等）
  'Evropska unija', 'evropska unija', 'pristupn', 'integracij',
  'šengen', 'granic', 'putovnica', 'pasoš', 'boravak', 'radna dozvola', 'dozvola za rad',
  'viza', 'vize', 'vizu', 'vizni',
  // 民生与生活（stan 变格与 cena 变格必须逐形列出，词干太短会误命中 stanovnik/stanica/scena）
  'stan', 'stana', 'stanu', 'stanom', 'stanovi', 'stanova', 'stanovima',
  'nekretnin', 'kirija', 'kirij', 'stanarin', 'cena', 'cene', 'cenu',
  'poskupljenj', 'račun',
  'zdravstv', 'bolnic', 'lekar', 'lekari', 'apotek', 'vakcin',
  'škola', 'školstv', 'fakultet', 'obrazovanj', 'vrtić', 'prevoz', 'javni prevoz',
  'gradski prevoz', 'metro', 'taksi', 'parking', 'saobraćaj', 'bezbednost', 'vremenska prognoza',
  // 旅游与文化
  'turizam', 'turističk', 'EXPO', 'manifestacij', 'festival', 'sajam',
  'hotel', 'restoran', 'muzej', 'beograd', 'Novi Sad', 'Niš', 'Kragujevac', 'Subotica',
  // ===== 西里尔字母变体（Politika/RTS 等）=====
  // 中塞关系与中国
  'Кина', 'Кине', 'Кини', 'Кину', 'Кином', 'кинеск', 'Кина-Србија',
  'Си Ђинпинг', 'Хуавеј',
  // 经济与企业
  'привред', 'економиј', 'економск', 'инвестициј', 'фабрика',
  'компаниј', 'предузећ', 'банк', 'финансиј', 'инфлациј', 'плата', 'плате', 'плату', 'платама',
  'зарад', 'пореск', 'порез', 'буџет', 'трговин', 'извоз', 'увоз', 'запослен', 'незапосленост',
  // 基建与重大项目
  'аутопут', 'железниц', 'брза пруга', 'пруга', 'аеродром',
  'градилишт', 'инфраструктура', 'енергетик', 'гасовод', 'нафтовод', 'зелена енергија',
  'ветропарк', 'соларн', 'рудник', 'литијум', 'Рио Тинто',
  // 能源价格与供暖
  'струја', 'гориво', 'дизел', 'бензин', 'нафт', 'грејањ', 'грејање',
  // 欧盟与签证
  'Европска унија', 'европска унија', 'приступн', 'интеграциј',
  'шенген', 'границ', 'путовница', 'пасош', 'боравак', 'радна дозвола', 'дозвола за рад',
  'виза', 'визе', 'визу', 'визни',
  // 民生与生活
  'стан', 'стана', 'стану', 'станом', 'станови', 'станова', 'становима',
  'некретнин', 'кирија', 'кириј', 'станарин', 'цена', 'цене', 'цену',
  'поскупљењ', 'рачун',
  'здравств', 'болниц', 'лекар', 'лекари', 'апотек', 'вакцин',
  'школа', 'школств', 'факултет', 'образовањ', 'вртић', 'превоз', 'јавни превоз',
  'градски превоз', 'метро', 'такси', 'паркинг', 'саобраћај', 'безбедност', 'временска прогноза',
  // 旅游与文化
  'туризам', 'туристичк', 'ЕКСПО', 'манифестациј', 'фестивал', 'сајам',
  'хотел', 'ресторан', 'музеј', 'београд', 'Нови Сад', 'Ниш', 'Крагујевац', 'Суботица',
];

// 必须「全词匹配」的关键词（小写）。这些词用「前边界 + 允许后缀」仍会误命中：
//   stan → stanovnik/stanica；cena → scena；plata → platforma；bank → banker/bankrot
// 其余关键词一律「前边界严格 + 允许后缀」，这样 uništena 不再命中 Niš。
export const SR_WHOLE_WORDS = new Set([
  // 拉丁
  'kina', 'kine', 'kini', 'kinu', 'kinom', 'china',
  'stan', 'stana', 'stanu', 'stanom', 'stanovi', 'stanova', 'stanovima',
  'cena', 'cene', 'cenu', 'plata', 'plate', 'platu', 'platama',
  'bank', 'sajam', 'sad', 'rad', 'dom', 'put', 'list', 'broj', 'sud', 'gora', 'kost',
  // 西里尔
  'кина', 'кине', 'кини', 'кину', 'кином',
  'стан', 'стана', 'стану', 'станом', 'станови', 'станова', 'становима',
  'цена', 'цене', 'цену', 'плата', 'плате', 'плату', 'платама',
  'банк', 'сајам',
]);

// 关键词匹配：前边界必须非字母（挡住 uništena→Niš）；后边界默认放开（吃掉塞语变格后缀）。
// SR_WHOLE_WORDS 里的词前后都要求边界。传入 text 会自行小写。
export function matchKeyword(text, kw) {
  const k = String(kw).toLowerCase();
  if (!k) return false;
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = SR_WHOLE_WORDS.has(k)
    ? `(?<![\\p{L}])${esc}(?![\\p{L}])`
    : `(?<![\\p{L}])${esc}[\\p{L}]*`;
  return new RegExp(pattern, 'iu').test(text);
}

/** 任一关键词命中即返回 true。 */
export function matchAnyKeyword(text, keywords) {
  const t = String(text).toLowerCase();
  return keywords.some((k) => matchKeyword(t, k));
}

// 需要人工审核的敏感词（命中则跳过，避免误发）
export const BLOCK_WORDS = [
  '性爱', '赌博', '毒品', '代孕', '色情', '博彩',
];
