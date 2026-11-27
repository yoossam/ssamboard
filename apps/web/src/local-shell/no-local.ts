// 서버 트랙 빌드에서 '@jarvis/local' 자리에 끼우는 빈 대체품 — 구글 드라이브 트랙 묶음(서버 코드 사본·PGlite)이 서버 트랙 화면에 섞이지 않게.
const notHere = () => {
  throw new Error('서버 트랙 빌드에는 구글 드라이브 트랙이 없습니다.');
};
export const startLocal = notHere;
export const savedTrack = () => null;
export class NeedSignInError extends Error {}
export class AccountMismatchError extends Error {}
