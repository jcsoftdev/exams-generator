// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const SITE_URL = 'https://creaexamen.com';

// Pages carrying the Layout `noindex` flag must not be advertised in the
// sitemap either. Only /login needs listing: @astrojs/sitemap already strips
// 404/500 status pages by itself before the filter runs.
const NOINDEXED = ['/login'];

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  integrations: [
    sitemap({
      filter: (page) =>
        !NOINDEXED.some((path) => new URL(page).pathname.startsWith(path)),
    }),
  ],
});
