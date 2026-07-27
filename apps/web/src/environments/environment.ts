export interface AppEnvironment {
  production: boolean;
  apiBaseUrl: string;
  landingUrl: string;
}

export const environment: AppEnvironment = {
  production: false,
  // Same-origin '/api' in dev too: the Angular dev-server proxies /api →
  // http://localhost:3012 (see apps/web/proxy.conf.json), mirroring the prod
  // nginx /api proxy. One scheme dev+prod, no hardcoded port, no CORS.
  apiBaseUrl: '/api',
  // Unused in practice: the tenant-lookup check only redirects when the
  // hostname ends in `.creaexamen.com`, which never happens in dev.
  landingUrl: '/',
};
