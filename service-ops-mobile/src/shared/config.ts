export const API_BASE_URLS = {
  developmentEmulator: 'http://10.0.2.2:5137',
  integrationDeviceLan: 'http://192.168.1.50:5137',
  staging: 'https://staging.example.com',
} as const;

export type ApiStage = keyof typeof API_BASE_URLS;

export const API_STAGE: ApiStage = 'developmentEmulator';

export const API_BASE_URL = API_BASE_URLS[API_STAGE];
