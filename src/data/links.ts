// 中塞通 · 在塞常用电话与网址索引
// ⚠️ 紧急号码为塞尔维亚官方标准（112/192/193/194），可放心使用；
//    其余机构联系方式建议以官方最新公布为准，标注"以官方为准"。

export interface LinkItem {
  name: string;
  tel?: string; // 支持 tel: 直拨
  url?: string;
  note?: string; // 说明/提醒
}

export interface LinkGroup {
  title: string;
  icon: string;
  items: LinkItem[];
}

export const EMERGENCY_TELS: LinkItem[] = [
  { name: '急救 112', tel: '112', note: '欧洲通用紧急号码' },
  { name: '报警 192', tel: '192', note: '塞尔维亚警察' },
  { name: '火警 193', tel: '193', note: '塞尔维亚消防' },
  { name: '医疗急救 194', tel: '194', note: '塞尔维亚急救中心' },
];

export const LINK_GROUPS: LinkGroup[] = [
  {
    title: '应急',
    icon: '紧急',
    items: [
      { name: '急救（欧洲通用）', tel: '112', note: '在任何欧盟/巴尔干国家均可拨打' },
      { name: '报警', tel: '192' },
      { name: '火警', tel: '193' },
      { name: '医疗急救', tel: '194' },
      { name: '中国驻塞尔维亚使馆', url: 'https://belgrade.china-embassy.gov.cn', note: '领事保护与证件服务，以官网最新公布为准' },
    ],
  },
  {
    title: '交通',
    icon: '出行',
    items: [
      { name: '贝尔格莱德机场（尼古拉·特斯拉）', url: 'https://www.beg.aero', note: '航班、大巴、停车场' },
      { name: '贝尔格莱德公交', url: 'https://www.gsp.rs', note: '市内公交线路查询' },
      { name: '塞尔维亚铁路', url: 'https://www.srbvoz.rs', note: '城际列车' },
    ],
  },
  {
    title: '医疗',
    icon: '医院',
    items: [
      { name: '贝尔格莱德急救中心', tel: '194', note: '以官方为准' },
      { name: '公立医院', note: '急诊可直接前往就近医院，建议先致电咨询，联系方式以官方为准' },
    ],
  },
  {
    title: '生活',
    icon: '生活',
    items: [
      { name: '70号商城', note: '贝尔格莱德华人商贸区，中国商品/餐饮/超市集中，可在当地导航搜索' },
      { name: '中国超市/餐厅', note: '建议通过当地华人微信群获取最新推荐' },
    ],
  },
  {
    title: '商业',
    icon: '商务',
    items: [
      { name: '塞尔维亚商业注册局', url: 'https://www.apr.gov.rs', note: '公司注册、登记查询' },
      { name: '中资企业商会', note: '联系方式以当地商会公告为准' },
    ],
  },
  {
    title: '资讯',
    icon: '媒体',
    items: [
      { name: '中国驻塞尔维亚使馆', url: 'https://belgrade.china-embassy.gov.cn' },
      { name: '中塞通', url: 'https://zhongsaitong.com', note: '本站：每日要闻 / 汇率天气 / 常用工具' },
    ],
  },
];
