// 'node:crypto' 대체품 — 서버 코드 중 브라우저 트랙에 묶이는 곳은 randomBytes 로 일회용 값(nonce)만 만든다.
const b64 = (a: Uint8Array) => btoa(String.fromCharCode(...a));
export function randomBytes(n: number) {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return {
    length: n,
    toString(enc: 'base64' | 'base64url' | 'hex' = 'hex') {
      if (enc === 'hex') return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
      const s = b64(a);
      return enc === 'base64url' ? s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : s;
    },
  };
}
export const randomUUID = () => crypto.randomUUID();
const none = (name: string) => () => {
  throw new Error(`${name} 는 구글 드라이브 트랙에서 쓰지 않습니다.`);
};
export const createHash = none('createHash');
export const createHmac = none('createHmac');
export const createCipheriv = none('createCipheriv');
export const createDecipheriv = none('createDecipheriv');
export const timingSafeEqual = none('timingSafeEqual');
export default { randomBytes, randomUUID };
