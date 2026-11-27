/*
 * apps/api/src/auth/auth.service.ts 대체품(구글 드라이브 트랙).
 * 이 트랙의 문은 구글 로그인(드라이브 권한)과 휴대폰·컴퓨터 자체 잠금이다. 서버 판의 PIN 재확인은 하지 않는다.
 */
export class AuthService {
  constructor(..._deps: unknown[]) {}
  async verifyPin(_ctx: unknown, _pin: unknown): Promise<void> {}
  async hashPin(_pin: unknown): Promise<string> {
    return 'local';
  }
  async revokeAll(_userId: string, _keep?: string): Promise<void> {}
}
