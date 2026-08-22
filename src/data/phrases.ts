// 中塞通 · 常用语速查数据（中文 → 塞尔维亚语 + 发音）
// 分组：问候 / 数字 / 购物 / 问路 / 点餐 / 应急
export interface Phrase {
  zh: string;
  sr: string;
  ph: string;
  grp: string;
}

export const PHRASES: Phrase[] = [
  // 问候
  { zh: '你好', sr: 'Zdravo', ph: '兹德拉沃', grp: '问候' },
  { zh: '谢谢', sr: 'Hvala', ph: '赫瓦拉', grp: '问候' },
  { zh: '再见', sr: 'Doviđenja', ph: '多维杰尼亚', grp: '问候' },
  { zh: '请', sr: 'Molim', ph: '莫利姆', grp: '问候' },
  { zh: '不客气', sr: 'Nema na čemu', ph: '内马 纳 切穆', grp: '问候' },
  { zh: '对不起', sr: 'Izvinite', ph: '伊兹维尼特', grp: '问候' },
  // 数字
  { zh: '一', sr: 'Jedan', ph: '耶丹', grp: '数字' },
  { zh: '二', sr: 'Dva', ph: '德瓦', grp: '数字' },
  { zh: '三', sr: 'Tri', ph: '特里', grp: '数字' },
  { zh: '四', sr: 'Četiri', ph: '切蒂里', grp: '数字' },
  { zh: '五', sr: 'Pet', ph: '佩特', grp: '数字' },
  { zh: '六', sr: 'Šest', ph: '舍斯特', grp: '数字' },
  { zh: '七', sr: 'Sedam', ph: '塞达姆', grp: '数字' },
  { zh: '八', sr: 'Osam', ph: '奥萨姆', grp: '数字' },
  { zh: '九', sr: 'Devet', ph: '德韦特', grp: '数字' },
  { zh: '十', sr: 'Deset', ph: '德塞特', grp: '数字' },
  // 购物
  { zh: '多少钱？', sr: 'Koliko košta?', ph: '科利科 科什塔？', grp: '购物' },
  { zh: '太贵了', sr: 'Preskupo', ph: '普雷斯库波', grp: '购物' },
  { zh: '便宜一点', sr: 'Jeftinije', ph: '耶夫蒂尼耶', grp: '购物' },
  { zh: '我要这个', sr: 'Ovo ću uzeti', ph: '奥沃 丘 乌泽蒂', grp: '购物' },
  { zh: '刷卡 / 现金', sr: 'Kartica / Gotovina', ph: '卡尔蒂察 / 戈托维纳', grp: '购物' },
  // 问路
  { zh: '厕所在哪？', sr: 'Gde je toalet?', ph: '格德 耶 托阿莱特？', grp: '问路' },
  { zh: '机场在哪？', sr: 'Gde je aerodrom?', ph: '格德 耶 阿埃罗德罗姆？', grp: '问路' },
  { zh: '地铁 / 公交站', sr: 'Metro / Autobuska stanica', ph: '梅特罗 / 奥托布斯卡 斯塔尼察', grp: '问路' },
  { zh: '左 / 右', sr: 'Levo / Desno', ph: '莱沃 / 德斯诺', grp: '问路' },
  { zh: '我迷路了', sr: 'Izgubio sam se', ph: '伊兹古比奥 萨姆 塞', grp: '问路' },
  // 点餐
  { zh: '菜单', sr: 'Jelovnik', ph: '耶洛夫尼克', grp: '点餐' },
  { zh: '一杯咖啡', sr: 'Jednu kafu', ph: '耶德努 卡富', grp: '点餐' },
  { zh: '水', sr: 'Voda', ph: '沃达', grp: '点餐' },
  { zh: '啤酒', sr: 'Pivo', ph: '皮沃', grp: '点餐' },
  { zh: '结账', sr: 'Račun, molim', ph: '拉春，莫利姆', grp: '点餐' },
  // 应急
  { zh: '救命！', sr: 'Upomoć!', ph: '乌波莫奇！', grp: '应急' },
  { zh: '叫医生', sr: 'Pozovite doktora', ph: '波佐维特 多克托拉', grp: '应急' },
  { zh: '叫警察', sr: 'Pozovite policiju', ph: '波佐维特 波利齐尤', grp: '应急' },
  { zh: '医院', sr: 'Bolnica', ph: '博尔尼察', grp: '应急' },
  { zh: '药店', sr: 'Apoteka', ph: '阿波泰卡', grp: '应急' },
];

export const PHRASE_GROUPS = ['问候', '数字', '购物', '问路', '点餐', '应急'];
