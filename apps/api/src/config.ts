import { join } from 'node:path';

const env = process.env;
const publicUrl = (env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export const config = {
  port: Number(env.PORT ?? 3000),
  /** 브라우저가 접속하는 주소. OAuth 리디렉션 주소와 쿠키 Secure 여부가 여기서 정해진다. */
  publicUrl,
  databaseUrl: env.DATABASE_URL ?? 'postgres://jarvis:jarvis@localhost:5432/jarvis',
  cookieSecure: (env.COOKIE_SECURE ?? String(publicUrl.startsWith('https://'))) === 'true',
  sessionDays: Number(env.SESSION_DAYS ?? 30),
  /**
   * 로그인 방식(2026-11-27). 'password': 처음 설치 때 정한 이메일·암호(배포판 기본), 'google': 허용 목록의 Google 계정.
   * LOGIN_MODE 를 적지 않으면 GOOGLE_CLIENT_ID 가 있을 때 google(옛 설정 그대로), 없으면 password.
   * 어느 쪽이든 로그인한 뒤에는 PIN을 넣어야 보드가 열린다.
   */
  loginMode: ((env.LOGIN_MODE ?? (env.GOOGLE_CLIENT_ID ? 'google' : 'password')).trim().toLowerCase() === 'google' ? 'google' : 'password') as
    | 'google'
    | 'password',
  /** 암호 방식에서 처음 주인 계정을 만들 때 넣는 설치 코드(install.sh 가 만든다). 주인이 생긴 뒤에는 쓰이지 않는다. */
  setupCode: (env.SETUP_CODE ?? '').trim(),
  /** API 키·커넥터 토큰을 암호화하는 마스터 키(base64 32바이트). DB가 아닌 환경변수에 둔다. */
  masterKey: env.MASTER_KEY ?? '',
  /** 처음 실행할 때 허용 목록에 넣을 이메일(쉼표로 구분). MVP는 본인 1개. */
  allowedEmails: (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
    /** Google Picker용 브라우저 API 키와 프로젝트 번호(시트 연결에만 필요). */
    pickerApiKey: env.GOOGLE_PICKER_API_KEY ?? '',
    appId: env.GOOGLE_APP_ID ?? '',
  },
  uploadDir: env.UPLOAD_DIR ?? join(process.cwd(), 'data', 'uploads'),
  webDist: env.WEB_DIST ?? join(__dirname, '..', '..', 'web', 'dist'),
  anthropicBaseUrl: (env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, ''),
  openaiBaseUrl: (env.OPENAI_BASE_URL ?? 'https://api.openai.com').replace(/\/$/, ''),
  /** 브라우저가 Claude 를 바로 부르는지(구글 드라이브 트랙만 참 — apps/local/src/shim/config.ts). 서버는 늘 거짓. */
  anthropicBrowserAccess: false,
  /** 워커(알림·시트 동기화·휴지통 정리)를 이 프로세스에서 돌릴지 여부. */
  workerEnabled: (env.WORKER_ENABLED ?? 'true') === 'true',
};

/** Google 시트·설문 연결을 쓸 수 있는지(OAuth 클라이언트가 있어야 한다). 암호 로그인에서는 선택이다. */
export function googleConfigured(): boolean {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

export function assertConfig(): void {
  const problems: string[] = [];
  if (Buffer.from(config.masterKey, 'base64').length !== 32) problems.push('MASTER_KEY는 base64로 인코딩한 32바이트여야 합니다 (openssl rand -base64 32).');
  const rawMode = (env.LOGIN_MODE ?? '').trim().toLowerCase();
  if (rawMode && rawMode !== 'google' && rawMode !== 'password') problems.push(`LOGIN_MODE 는 password 또는 google 입니다(지금: ${env.LOGIN_MODE}).`);
  if (config.loginMode === 'google' && (!config.google.clientId || !config.google.clientSecret)) {
    problems.push('LOGIN_MODE=google 이면 GOOGLE_CLIENT_ID와 GOOGLE_CLIENT_SECRET이 필요합니다(암호로 로그인하려면 LOGIN_MODE=password).');
  }
  if (problems.length > 0) throw new Error(`설정 오류:\n- ${problems.join('\n- ')}`);
}
