/*
 * 기능을 쓸 때 남기는 기록(2026-11-28 자주 쓰는 순 자동 메뉴). 서버가 하루 한 번 이 기록으로 메뉴 순서를 정하고 자주 쓰는 기능을 넣는다.
 * 기다리지 않고 보낸다(실패해도 화면은 그대로). 같은 열쇠를 3초 안에 또 보내지 않는다.
 */
import { USAGE_KEY_RE } from '@jarvis/shared';
import { api } from './api';

const last = new Map<string, number>();
export function trackUse(key: string): void {
  if (!USAGE_KEY_RE.test(key)) return;
  const now = Date.now();
  if (now - (last.get(key) ?? 0) < 3000) return;
  last.set(key, now);
  void api.post('/menus/usage', { key }).catch(() => undefined);
}
