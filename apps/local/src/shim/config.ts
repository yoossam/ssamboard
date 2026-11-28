// apps/api/src/config.ts 대체품(구글 드라이브 트랙). 환경변수 대신 브라우저 안 고정값.
const env = (name: string): string => String((import.meta as unknown as { env?: Record<string, string> }).env?.[name] ?? '');
export const config = {
  port: 0,
  publicUrl: typeof location === 'undefined' ? 'http://localhost' : location.origin,
  databaseUrl: '',
  cookieSecure: true,
  sessionDays: 30,
  loginMode: 'google' as 'google' | 'password',
  setupCode: '',
  // 열쇠는 이 브라우저의 DB 에만 있고 드라이브로 올리지 않는다(drive.ts 의 SECRET_TABLES). 암호화는 common/crypto 대체품이 맡는다.
  masterKey: 'local',
  allowedEmails: [] as string[],
  // 시트 고르기 창(Google Picker)용 브라우저 API 키·프로젝트 번호 — 빌드 때 VITE_GOOGLE_PICKER_API_KEY·VITE_GOOGLE_APP_ID(공개돼도 되는 값, 리퍼러 제한 필수)
  google: { clientId: env('VITE_GOOGLE_CLIENT_ID'), clientSecret: '', pickerApiKey: env('VITE_GOOGLE_PICKER_API_KEY'), appId: env('VITE_GOOGLE_APP_ID') },
  uploadDir: 'mem/uploads',
  webDist: '',
  anthropicBaseUrl: 'https://api.anthropic.com',
  openaiBaseUrl: 'https://api.openai.com',
  /** 브라우저가 Claude 를 바로 부른다(anthropic-dangerous-direct-browser-access). */
  anthropicBrowserAccess: true,
  workerEnabled: false,
};
export const googleConfigured = (): boolean => false;
export const assertConfig = (): void => undefined;
