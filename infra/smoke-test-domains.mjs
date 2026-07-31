#!/usr/bin/env node
// Real-network smoke test for the creaexamen.com domain layout — landing on
// root, web on any tenant subdomain (wildcard), api on its own subdomain.
// Not part of `pnpm test` (that suite spins up an in-process Nest app against
// a test DB; this hits live DNS/TLS/Traefik, so it only makes sense post-deploy).
// Run: node infra/smoke-test-domains.mjs

const ROOT = "https://creaexamen.com";
const TENANT_SUBDOMAIN = "https://colegio-demo.creaexamen.com";
const API = "https://api.creaexamen.com";

const checks = [];

function check(name, fn) {
  checks.push({ name, fn });
}

check("landing serves on root domain", async () => {
  const res = await fetch(ROOT);
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const body = await res.text();
  if (!body.includes("<html")) throw new Error("response is not HTML");
});

check("web SPA serves on tenant subdomain (wildcard)", async () => {
  const res = await fetch(TENANT_SUBDOMAIN);
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const body = await res.text();
  if (!body.includes("<app-root")) throw new Error("response is not the Angular shell");
});

// --- SEO surface: landing is the only indexable host ---

check("landing robots.txt advertises the sitemap", async () => {
  const res = await fetch(`${ROOT}/robots.txt`);
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const body = await res.text();
  if (!body.includes(`Sitemap: ${ROOT}/sitemap-index.xml`)) {
    throw new Error("robots.txt is missing the Sitemap line");
  }
});

check("landing sitemap serves and omits noindexed pages", async () => {
  const index = await fetch(`${ROOT}/sitemap-index.xml`);
  if (index.status !== 200) throw new Error(`sitemap-index.xml: expected 200, got ${index.status}`);
  // @astrojs/sitemap always names the first (only) chunk sitemap-0.xml.
  const res = await fetch(`${ROOT}/sitemap-0.xml`);
  if (res.status !== 200) throw new Error(`sitemap-0.xml: expected 200, got ${res.status}`);
  const body = await res.text();
  if (!body.includes(`<loc>${ROOT}/</loc>`)) throw new Error("sitemap is missing the home page");
  if (body.includes("/login")) throw new Error("sitemap leaks /login (noindexed)");
  if (body.includes("/404")) throw new Error("sitemap leaks /404 (noindexed)");
});

check("landing login page carries noindex", async () => {
  const res = await fetch(`${ROOT}/login`);
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const body = await res.text();
  if (!body.includes('name="robots" content="noindex"')) {
    throw new Error("login page is missing the noindex meta");
  }
});

check("landing serves the branded 404 with a 404 status", async () => {
  const res = await fetch(`${ROOT}/definitely-not-a-page`);
  if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  const body = await res.text();
  if (!body.includes("Página no encontrada")) {
    throw new Error("got nginx's default 404 page, not the Astro one (error_page missing?)");
  }
});

check("tenant subdomain robots.txt disallows all crawling", async () => {
  const res = await fetch(`${TENANT_SUBDOMAIN}/robots.txt`);
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const body = await res.text();
  if (!/^Disallow: \/$/m.test(body)) throw new Error("robots.txt does not disallow all");
});

check("tenant subdomain shell carries noindex, nofollow", async () => {
  const res = await fetch(TENANT_SUBDOMAIN);
  const body = await res.text();
  if (!body.includes('name="robots" content="noindex, nofollow"')) {
    throw new Error("Angular shell is missing the noindex meta");
  }
});

check("api serves on its own subdomain", async () => {
  const res = await fetch(`${API}/health`);
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
});

check("api CORS allows the tenant subdomain origin", async () => {
  const res = await fetch(`${API}/health`, {
    headers: { Origin: TENANT_SUBDOMAIN },
  });
  const allowOrigin = res.headers.get("access-control-allow-origin");
  if (allowOrigin !== TENANT_SUBDOMAIN) {
    throw new Error(`expected Access-Control-Allow-Origin: ${TENANT_SUBDOMAIN}, got ${allowOrigin}`);
  }
});

check("api rejects an unrelated origin", async () => {
  const res = await fetch(`${API}/health`, {
    headers: { Origin: "https://evil.example.com" },
  });
  const allowOrigin = res.headers.get("access-control-allow-origin");
  if (allowOrigin) throw new Error(`expected no Access-Control-Allow-Origin, got ${allowOrigin}`);
});

let failures = 0;
for (const { name, fn } of checks) {
  try {
    await fn();
    console.log(`ok — ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL — ${name}: ${err.message}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${checks.length} checks failed`);
  process.exit(1);
}
console.log(`\nall ${checks.length} checks passed`);
