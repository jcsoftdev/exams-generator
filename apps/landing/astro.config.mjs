// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Dominio de producción real, no placeholder. Verificado 2026-08-14 contra las
// tres fuentes que lo definen: zona Cloudflare `creaexamen.com` (activa, A de
// raíz/`api`/`*` → 45.8.132.213, proxied) y el compose `exams-stack` de Dokploy
// (`creaexamen.com` → servicio `landing`, `api.creaexamen.com` → `api`).
const SITE_URL = 'https://creaexamen.com';

// Pages carrying the Layout `noindex` flag must not be advertised in the
// sitemap either. @astrojs/sitemap already strips 404/500 status pages by
// itself before the filter runs, so only real pages need listing here.
//
// /privacidad and /terminos are temporary entries (audit 2026-08-14, P0): both
// still open with a "TODO antes de publicar: razón social, RUC" banner, and
// they were unlinked from the footer for that reason — indexing them would put
// that internal note back in front of visitors through search instead. Drop
// them from this list together with the banner.
const NOINDEXED = ['/login', '/privacidad', '/terminos'];

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
