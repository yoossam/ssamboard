// 'node:path' 대체품 — 서버 코드는 글꼴·업로드 폴더 경로를 만들 때만 쓴다. 브라우저에서는 주소처럼 이어 붙인다.
export const join = (...parts: string[]): string => parts.filter(Boolean).join('/').replace(/\/+/g, '/');
export const resolve = join;
export const extname = (p: string): string => (/\.[^./]*$/.exec(p)?.[0] ?? '');
export const basename = (p: string): string => p.split('/').pop() ?? p;
export default { join, resolve, extname, basename };
