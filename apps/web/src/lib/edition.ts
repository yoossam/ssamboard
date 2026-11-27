/*
 * 지금 어느 트랙으로 빌드됐는지(docs/TWO_EDITIONS_PLAN.md).
 *   서버 트랙(기본)       — VITE_EDITION 없음 또는 server
 *   구글 드라이브 트랙   — VITE_EDITION=local (npm run build:local)
 */
import type { LocalHandle } from '../local-shell/contract';

export const LOCAL_TRACK = import.meta.env.VITE_EDITION === 'local';

let handle: LocalHandle | null = null;
export function setLocalHandle(h: LocalHandle): void {
  handle = h;
}
/** 구글 드라이브 트랙에서만 있다. */
export function localHandle(): LocalHandle | null {
  return handle;
}
