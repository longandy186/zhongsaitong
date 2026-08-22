// 清洗内容摘要：去除 markdown 原始标记（#、##、**、*、![]()、[]()、` `），
// 用于详情页摘要段、JSON-LD description、深度指南卡预览等。

export function cleanSummary(
  item: { data: { summary?: string }; body?: string | null },
  len = 120
): string {
  const raw = (item.data.summary && item.data.summary.trim()) || ((item.body ?? '').replace(/\s+/g, ' ').trim());
  return raw
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
    .slice(0, len);
}
