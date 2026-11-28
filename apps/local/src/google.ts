/*
 * 구글 로그인(구글 드라이브 트랙) — Google Identity Services 토큰 방식. 서버 없이 브라우저가 접근 토큰을 받는다.
 * 권한은 드라이브 '앱 폴더'(drive.appdata)와 이름·이메일뿐. 내 드라이브의 다른 파일은 볼 수 없다.
 * 토큰은 1시간짜리라 이 탭의 sessionStorage 에만 두고, 만료되면 화면의 '구글 다시 연결'(누름이 있어야 창이 뜬다)로 새로 받는다.
 */
const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.appdata', 'openid', 'email', 'profile'];
const STORE_KEY = 'ssamboard.google.token';
/** 기본 권한 말고 더 받은 권한(시트·설문 연결의 drive.file) — 다음 로그인 때도 함께 청한다. */
const EXTRA_KEY = 'ssamboard.google.extraScopes';
function savedExtra(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(EXTRA_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string }) => void }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

let loading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    // 응답 없이 멈추면 영영 기다리지 않게 20초에서 끊는다(제미나이 검토)
    const timer = setTimeout(() => s.onerror?.(new Event('timeout')), 20_000);
    s.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(timer);
      loading = null;
      s.remove();
      reject(new Error('구글 로그인 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export class GoogleAccountMismatch extends Error {
  constructor(
    readonly expected: string,
    readonly got: string,
  ) {
    super(`이 보드는 ${expected} 계정의 것입니다. 고른 계정은 ${got} 입니다.`);
  }
}

async function userinfo(token: string): Promise<{ email: string; name: string }> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('구글 계정 정보를 읽지 못했습니다.');
  const p = (await res.json()) as { email?: string; name?: string };
  if (!p.email) throw new Error('구글 계정 이메일을 받지 못했습니다.');
  return { email: p.email, name: p.name ?? '' };
}

function revoke(token: string): void {
  try {
    window.google?.accounts?.oauth2?.revoke(token);
  } catch {
    /* 무시 */
  }
}

export class TokenExpiredError extends Error {
  constructor() {
    super('구글 연결이 끝났습니다. "구글 다시 연결"을 눌러 주세요.');
  }
}

export class GoogleSession {
  /** 토큰은 계정(email)을 확인한 뒤에만 여기에 둔다 — 확인 전 토큰이 드라이브 맞춤에 쓰이지 않게(코덱스 재확인). */
  private token: {
    value: string;
    expiresAt: number;
    scope?: string;
    email?: string;
    name?: string;
  } | null = null;

  constructor(private readonly clientId: string) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? 'null');
      if (saved && typeof saved.value === 'string' && typeof saved.email === 'string' && saved.expiresAt > Date.now() + 60_000) this.token = saved;
    } catch {
      /* 저장소를 못 쓰면 매번 로그인 */
    }
  }

  get connected(): boolean {
    return Boolean(this.token && this.token.expiresAt > Date.now() + 60_000);
  }

  /** 지금 토큰에 그 권한이 있는지 */
  hasScope(scope: string): boolean {
    return (
      this.connected &&
      String(this.token?.scope ?? '')
        .split(' ')
        .includes(scope)
    );
  }

  /** 확인한 계정(토큰과 함께 저장) */
  get email(): string {
    return this.connected ? (this.token?.email ?? '') : '';
  }

  /**
   * 누름(클릭) 안에서 불러야 구글 창이 막히지 않는다. extraScopes 는 더 청할 권한(한 번 받으면 다음에도 함께 청한다).
   * expected 가 있으면 그 계정일 때만 토큰을 받아들인다 — 다르거나 확인하지 못하면 새 토큰을 버리고 오류(지금 토큰은 그대로).
   */
  async signIn(hint?: string, extraScopes: string[] = [], expected: string | null = null): Promise<{ email: string; name: string }> {
    await loadGis();
    const extra = [...new Set([...savedExtra(), ...extraScopes])];
    const r = await new Promise<TokenResponse>((resolve, reject) => {
      const client = window.google!.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: [...GOOGLE_SCOPES, ...extra].join(' '),
        callback: resolve,
        error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? '구글 창을 닫았습니다.' : '구글 로그인 창을 열지 못했습니다(팝업 차단을 확인하세요).')),
      });
      client.requestAccessToken({
        prompt: this.token || hint ? '' : 'consent',
        login_hint: hint,
      });
    });
    if (r.error || !r.access_token) throw new Error(r.error_description || '구글 로그인을 마치지 못했습니다.');
    if (!String(r.scope ?? '').includes('drive.appdata')) throw new Error('드라이브 앱 폴더 권한에 동의해야 자료를 저장할 수 있습니다.');
    // 받은 토큰으로 계정부터 확인한다(아직 this.token 에 두지 않는다).
    let me: { email: string; name: string };
    try {
      me = await userinfo(r.access_token);
    } catch (e) {
      revoke(r.access_token);
      throw new Error('구글 계정을 확인하지 못해 연결을 멈췄습니다. 인터넷 연결을 확인하고 다시 해 주세요.', { cause: e });
    }
    if (expected && me.email.toLowerCase() !== expected.toLowerCase()) {
      revoke(r.access_token);
      throw new GoogleAccountMismatch(expected, me.email);
    }
    this.token = {
      value: r.access_token,
      expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
      scope: r.scope ?? '',
      email: me.email.toLowerCase(),
      name: me.name,
    };
    const granted = String(r.scope ?? '').split(' ');
    try {
      localStorage.setItem(EXTRA_KEY, JSON.stringify(extra.filter((x) => granted.includes(x))));
    } catch {
      /* 무시 */
    }
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(this.token));
    } catch {
      /* 무시 */
    }
    return me;
  }

  /** 드라이브 맞춤이 부른다. 만료됐으면 창을 띄우지 않고 알린다(화면이 다시 연결 단추를 보인다). */
  async accessToken(): Promise<string> {
    if (!this.connected) throw new TokenExpiredError();
    return this.token!.value;
  }

  /** 확인해 둔 계정(망을 쓰지 않는다) */
  profile(): { email: string; name: string } {
    return { email: this.token?.email ?? '', name: this.token?.name ?? '' };
  }

  /** 이 탭에 저장된 토큰만 지운다(구글 쪽 권한은 그대로) — 다른 계정의 토큰이 남아 있을 때 */
  forget(): void {
    this.token = null;
    try {
      sessionStorage.removeItem(STORE_KEY);
    } catch {
      /* 무시 */
    }
  }

  async signOut(): Promise<void> {
    const t = this.token?.value;
    this.token = null;
    try {
      sessionStorage.removeItem(STORE_KEY);
      localStorage.removeItem(EXTRA_KEY);
    } catch {
      /* 무시 */
    }
    if (t && window.google?.accounts?.oauth2) await new Promise<void>((r) => window.google!.accounts.oauth2.revoke(t, r));
  }
}
