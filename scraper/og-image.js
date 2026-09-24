// 从详情页抽取 og:image / twitter:image
// 用途：部分源（如 RTS）的 RSS 完全不带 enclosure / media:content / 正文 <img>，
//       图片只存在于详情页的 <meta property="og:image">。extractImages() 抓不到时用它兜底。
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const IMG_META =
  '(?:og:image:secure_url|og:image:url|og:image|twitter:image:src|twitter:image)';

/** 从 HTML 字符串里抽图片地址；兼容 content 在前 / property 在后的写法。抽不到返回 ''。 */
export function extractOgImageFromHtml(html, baseUrl = '') {
  if (!html) return '';
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${IMG_META}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*(?:property|name)\\s*=\\s*["']${IMG_META}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    const raw = m[1].trim();
    if (!raw) continue;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^\/\//.test(raw)) return `https:${raw}`;
    if (baseUrl) {
      try {
        return new URL(raw, baseUrl).href;
      } catch {
        /* 忽略非法相对路径 */
      }
    }
  }
  return '';
}

/** 抓取详情页并返回 og:image；任何失败都静默返回 ''，不影响抓取主流程。 */
export async function fetchOgImage(url, { timeout = 9000 } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return '';
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'sr,en;q=0.8,zh;q=0.6' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    });
    if (!resp.ok) return '';
    const ct = resp.headers.get('content-type') ?? '';
    if (!/html|xml/i.test(ct)) return '';
    return extractOgImageFromHtml(await resp.text(), url);
  } catch {
    return '';
  }
}
