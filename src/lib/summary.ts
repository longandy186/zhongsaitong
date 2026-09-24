// 清洗内容摘要：去除 markdown 原始标记（#、##、**、*、![]()、[]()、` `），
// 用于详情页摘要段、JSON-LD description、深度指南卡预览等。

/** 在标点/词边界处截断，避免出现「…官方门户 welcometo」这种半截词。
 *  1) 优先在句末标点断开（保留标点，不加省略号）
 *  2) 次选分句标点（去掉标点，补省略号）
 *  3) 再退到词边界（补省略号）
 *  4) 都不行才硬切 */
function truncateAtBoundary(s: string, len: number): string {
  if (s.length <= len) return s;
  const head = s.slice(0, len);
  const minKeep = Math.floor(len * 0.6); // 断点太靠前就放弃，宁可退到词边界
  // 优先级从高到低：句末 → 分句 → 逗号顿号
  const groups: { marks: string[]; keepMark: boolean }[] = [
    { marks: ['。', '！', '？', '. ', '! ', '? '], keepMark: true },
    { marks: ['；', '; '], keepMark: false },
    { marks: ['，', '、', ', '], keepMark: false },
  ];
  for (const { marks, keepMark } of groups) {
    let best = -1;
    let bestMarkLen = 0;
    for (const m of marks) {
      const i = head.lastIndexOf(m); // 取该组里最靠后的一个断点
      if (i + m.length > best) {
        best = i + m.length;
        bestMarkLen = m.length;
      }
    }
    if (best >= minKeep && best > 0) {
      const cut = keepMark ? head.slice(0, best) : head.slice(0, best - bestMarkLen);
      return keepMark ? cut.trim() : `${cut.trim().replace(/[，、；,;\s]+$/, '')}…`;
    }
  }
  const sp = head.lastIndexOf(' ');
  if (sp >= minKeep) return `${head.slice(0, sp).trim()}…`;
  return `${head.trim()}…`;
}

export function cleanSummary(
  item: { data: { summary?: string }; body?: string | null },
  len = 120
): string {
  const raw = (item.data.summary && item.data.summary.trim()) || ((item.body ?? '').replace(/\s+/g, ' ').trim());
  const cleaned = raw
    .replace(/^#{1,6}\s+/gm, '')           // 去 # ## ### 标题前缀
    .replace(/^>\s+/gm, '')                // 去 > 引用
    .replace(/^[-*+]\s+/gm, '')            // 去无序列表前缀
    .replace(/^\d+\.\s+/gm, '')            // 去有序列表前缀
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // 图片 → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // 链接 → 文字
    .replace(/\*\*(.*?)\*\*/g, '$1')        // 加粗
    .replace(/\*(.*?)\*/g, '$1')            // 斜体
    .replace(/`([^`]+)`/g, '$1')            // inline code
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, len * 2) // 先宽切，给边界断点留出余量
    .trim();
  return truncateAtBoundary(cleaned, len);
}
