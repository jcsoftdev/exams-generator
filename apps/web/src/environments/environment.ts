export interface AppEnvironment {
  production: boolean;
  apiBaseUrl: string;
}

export const environment: AppEnvironment = {
  production: false,
  apiBaseUrl: 'http://localhost:3012',
};
