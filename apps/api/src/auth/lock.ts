import { PIN_LOCKOUT_MINUTES, PIN_MAX_FAILS } from '@jarvis/shared';

// 잠금 판정은 서버 기준이다(AUTH-5). 화면 타이머는 화면을 가리는 용도일 뿐이다.

/** 마지막 활동 뒤로 잠금 시간이 지났는가. lockMinutes가 0이면 자동 잠금을 끈 것이다. */
export function isIdleLocked(lastActiveAt: Date, lockMinutes: number, now: Date): boolean {
  if (lockMinutes <= 0) return false;
  return now.getTime() - lastActiveAt.getTime() >= lockMinutes * 60_000;
}

/** 자동 잠금까지 남은 초. 자동 잠금이 꺼져 있으면 null. */
export function secondsLeft(lastActiveAt: Date, lockMinutes: number, now: Date): number | null {
  if (lockMinutes <= 0) return null;
  return Math.max(0, Math.ceil((lastActiveAt.getTime() + lockMinutes * 60_000 - now.getTime()) / 1000));
}

export interface PinFailure {
  /** 저장할 실패 횟수(막히면 0으로 되돌린다). */
  failCount: number;
  lockedUntil: Date | null;
  /** true면 모든 세션을 끝낸다(AUTH-7). */
  revokeAll: boolean;
  attemptsLeft: number;
}

/** PIN을 한 번 더 틀렸을 때의 결과. countAfter는 이번 실패까지 더한 사용자 단위 누적 횟수다. */
export function pinFailure(countAfter: number, now: Date): PinFailure {
  if (countAfter >= PIN_MAX_FAILS) {
    return { failCount: 0, lockedUntil: new Date(now.getTime() + PIN_LOCKOUT_MINUTES * 60_000), revokeAll: true, attemptsLeft: 0 };
  }
  return { failCount: countAfter, lockedUntil: null, revokeAll: false, attemptsLeft: PIN_MAX_FAILS - countAfter };
}

/** 기기 목록에 보여 줄 이름을 User-Agent에서 뽑는다. */
export function deviceName(userAgent: string): string {
  const ua = userAgent || '';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : '알 수 없는 기기';
  const browser = /SamsungBrowser/.test(ua)
    ? 'Samsung Internet'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  return browser ? `${os} · ${browser}` : os;
}
