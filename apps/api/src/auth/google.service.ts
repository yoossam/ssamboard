import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { signState, verifyState } from '../common/crypto';
import { config } from '../config';

export const LOGIN_SCOPES = ['openid', 'email', 'profile'];
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface OAuthState {
  kind: 'login' | 'connector';
  nonce: string;
  user_id?: string;
}

/**
 * Google OAuth. 로그인과 도구 권한은 분리한다(CON-2):
 * 로그인은 openid·email·profile만 쓰고, 커넥터를 추가할 때 필요한 권한만 따로 동의받는다.
 */
@Injectable()
export class GoogleService {
  readonly loginRedirect = `${config.publicUrl}/api/auth/google/callback`;
  readonly connectorRedirect = `${config.publicUrl}/api/connectors/google/callback`;

  private client(redirectUri: string): OAuth2Client {
    return new OAuth2Client(config.google.clientId, config.google.clientSecret, redirectUri);
  }

  state(payload: OAuthState): string {
    return signState({ ...payload }, config.masterKey);
  }

  readState(state: unknown): OAuthState | null {
    return verifyState<OAuthState>(String(state ?? ''), config.masterKey);
  }

  loginUrl(state: string): string {
    return this.client(this.loginRedirect).generateAuthUrl({ scope: LOGIN_SCOPES, state, prompt: 'select_account' });
  }

  /** 인증 코드를 ID 토큰으로 바꾸고 서명을 검증한 뒤 이메일을 돌려준다. */
  async exchangeLogin(code: string): Promise<{ email: string; name: string } | null> {
    const client = this.client(this.loginRedirect);
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) return null;
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
    const payload = ticket.getPayload();
    if (!payload?.email || payload.email_verified === false) return null;
    return { email: payload.email, name: payload.name ?? '' };
  }

  connectorUrl(state: string, scopes: string[]): string {
    return this.client(this.connectorRedirect).generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: scopes,
      state,
    });
  }

  async exchangeConnector(code: string): Promise<{ refreshToken: string; scopes: string[] } | null> {
    const { tokens } = await this.client(this.connectorRedirect).getToken(code);
    if (!tokens.refresh_token) return null;
    return { refreshToken: tokens.refresh_token, scopes: (tokens.scope ?? '').split(' ').filter(Boolean) };
  }

  /** 리프레시 토큰으로 짧게 쓰는 액세스 토큰을 받는다. 리프레시 토큰은 서버 밖으로 나가지 않는다. */
  async accessToken(refreshToken: string): Promise<string> {
    const client = this.client(this.connectorRedirect);
    client.setCredentials({ refresh_token: refreshToken });
    const { token } = await client.getAccessToken();
    if (!token) throw new Error('Google 액세스 토큰을 받지 못했습니다. 다시 연결해야 할 수 있습니다.');
    return token;
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.client(this.connectorRedirect).revokeToken(refreshToken);
  }
}
