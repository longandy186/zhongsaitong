import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://zhongsaitong.pages.dev',
  output: 'static',
  build: {
    assets: '_assets',
  },
  integrations: [
    sitemap({
      // 旧 /post/ 兼容路由不进 sitemap，AI 只抓 GEO 友好 URL
      filter: (page) => !page.includes('/post/'),
    }),
  ],
});
