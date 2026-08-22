// 内容条目的 GEO 友好 URL
// 旧结构：/post/20260820-塞尔维亚媒体-22.md/
// 新结构：/{category}/20260820-塞尔维亚媒体-22/

export function itemSlug(id: string): string {
  return id.replace(/\.md$/, '');
}

export function itemUrl(item: { id: string; data: { category: string } }): string {
  return `/${item.data.category}/${itemSlug(item.id)}/`;
}
