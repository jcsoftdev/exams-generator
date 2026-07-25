// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// TODO: placeholder domain — swap for the real production domain once
// registered (also update robots.txt's Sitemap line and any hardcoded
// references), same "fix before publish" bucket as the brand/contact info
// fixed in Landing P0.
const SITE_URL = 'https://generaexamen.pe';

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  integrations: [sitemap()],
});
