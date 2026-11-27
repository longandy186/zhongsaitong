import type { CollectionEntry } from 'astro:content';

type Item = CollectionEntry<'items'>;

/**
 * 条目是否应该出现在站点上。
 *
 * 规则：status 必须是 active；设了 expireAt 的，过期日之后不再展示（过期当天仍算可见）。
 *
 * 背景：2026-11-28 取消了「草稿 + 人工审核」那条线，抓取即发布（写入就是 active），
 * 所以 expireAt 成了唯一的下线机制 —— 新闻 7 天、交易类 30 天、指南 365 天，
 * 由 scraper/run.js 写入。列表页和详情页都必须走这个判断，否则过期条目会继续占着 URL。
 */
export function isVisible(item: Item, now: Date = new Date()): boolean {
  if (item.data.status !== 'active') return false;

  const exp = item.data.expireAt as Date | undefined;
  if (!exp) return true;

  const dayStart = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  return dayStart(exp) >= dayStart(now);
}
