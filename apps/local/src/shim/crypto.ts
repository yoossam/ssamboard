/*
 * apps/api/src/common/crypto.ts 대체품(구글 드라이브 트랙).
 * 서버는 API 키를 마스터 키로 암호화해 DB 에 두지만, 이 트랙에서 키는 이 브라우저의 DB 에만 있고(드라이브로 올리지 않음)
 * 마스터 키를 따로 둘 곳이 없다. 그래서 표시만 붙여 그대로 둔다 — 보호는 브라우저 저장소의 출처 격리와 CSP 가 맡는다.
 */
const PREFIX = 'local:';
export function encrypt(plain: string, _key: string): string {
  return PREFIX + plain;
}
export function decrypt(token: string, _key: string): string {
  if (!token.startsWith(PREFIX)) throw new Error('이 브라우저에서 저장한 열쇠가 아닙니다.');
  return token.slice(PREFIX.length);
}
export const randomToken = (bytes = 32): string => {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unsupported = (name: string) => () => {
  throw new Error(`${name} 는 구글 드라이브 트랙에서 쓰지 않습니다.`);
};
export const sha256 = unsupported('sha256');
export const hmac = unsupported('hmac');
export const safeEqual = (a: string, b: string): boolean => a === b;
export const signState = unsupported('signState');
export const verifyState = unsupported('verifyState');
