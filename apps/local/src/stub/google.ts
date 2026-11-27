/*
 * apps/api/src/auth/google.service.ts 대체품(구글 드라이브 트랙).
 * 서버 판은 저장한 refresh 토큰으로 접근 토큰을 받지만, 이 트랙은 브라우저 구글 로그인(GoogleSession)의 토큰을 그대로 쓴다.
 * 그래서 서버 판 연결 코드(connectors.service.ts — 시트 읽기·설문 만들기)가 고치지 않고 돈다.
 */
import { BadRequestException } from '../shim/nest-common';

export const LOGIN_SCOPES = ['openid', 'email', 'profile'];
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface LocalGoogle {
  /** 그 권한이 있는 지금 토큰. 없으면(만료·권한 없음) 오류 */
  token(scope: string): Promise<string>;
  /** 권한을 더 받는다(누름 안에서) */
  connect(scopes: string[]): Promise<void>;
}

let provider: LocalGoogle | null = null;
export function setLocalGoogle(p: LocalGoogle | null): void {
  provider = p;
}
export function localGoogle(): LocalGoogle {
  if (!provider) throw new BadRequestException('구글 드라이브 트랙에서 구글로 로그인해야 시트·설문을 쓸 수 있습니다.');
  return provider;
}

export class GoogleService {
  constructor(..._deps: unknown[]) {}
  /** 서버 판: refresh 토큰 → 접근 토큰. 이 트랙: 브라우저 로그인 토큰(drive.file 권한) */
  async accessToken(_refreshToken: string): Promise<string> {
    return localGoogle().token(DRIVE_FILE_SCOPE);
  }
  async revoke(_refreshToken: string): Promise<void> {}
  connectorUrl(): never {
    throw new BadRequestException('구글 드라이브 트랙에서는 쓰지 않습니다.');
  }
  state(): string {
    return '';
  }
  readState(): null {
    return null;
  }
  async exchangeConnector(): Promise<null> {
    return null;
  }
}
