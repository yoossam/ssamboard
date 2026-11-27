import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// AES-256-GCM으로 API 키·커넥터 토큰을 암호화한다(USR-2a, CON-3). 형식: v1.<iv>.<tag>.<암호문> (base64url)

function key(masterKeyB64: string): Buffer {
  const k = Buffer.from(masterKeyB64, 'base64');
  if (k.length !== 32) throw new Error('마스터 키는 32바이트여야 합니다.');
  return k;
}

export function encrypt(plain: string, masterKeyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(masterKeyB64), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(token: string, masterKeyB64: string): string {
  const [version, iv, tag, ct] = token.split('.');
  if (version !== 'v1' || !iv || !tag || ct === undefined) throw new Error('암호문 형식이 잘못됐습니다.');
  const decipher = createDecipheriv('aes-256-gcm', key(masterKeyB64), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const hmac = (data: string | Buffer, secret: string): string => createHmac('sha256', secret).update(data).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** OAuth state처럼 잠깐 쓰는 값을 서명해 주고받는다. 만료(초)가 지나면 null. */
export function signState(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify({ ...payload, t: Date.now() })).toString('base64url');
  return `${body}.${hmac(body, secret)}`;
}

export function verifyState<T = Record<string, unknown>>(state: string, secret: string, maxAgeSec = 600): T | null {
  const [body, sig] = String(state ?? '').split('.');
  if (!body || !sig || !safeEqual(sig, hmac(body, secret))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof data.t !== 'number' || Date.now() - data.t > maxAgeSec * 1000) return null;
    return data as T;
  } catch {
    return null;
  }
}
