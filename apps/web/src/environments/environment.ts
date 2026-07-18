export interface AppEnvironment {
  production: boolean;
  apiBaseUrl: string;
}

export const environment: AppEnvironment = {
  production: false,
  // Same-origin '/api' in dev too: the Angular dev-server proxies /api →
  // http://localhost:3012 (see apps/web/proxy.conf.json), mirroring the prod
  // nginx /api proxy. One scheme dev+prod, no hardcoded port, no CORS.
  apiBaseUrl: '/api',
};
