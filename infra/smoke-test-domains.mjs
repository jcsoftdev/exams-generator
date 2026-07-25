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
