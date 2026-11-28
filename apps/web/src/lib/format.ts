import type { CellValue, ColumnType } from '@jarvis/shared';

// 날짜·숫자 표시. 저장은 UTC, 표시는 사용자 시간대다(BRD-8).

let zone = 'Asia/Seoul';
export function setTimezone(tz: string | undefined): void {
  if (tz) zone = tz;
}
export const timezone = () => zone;

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ko-KR', { timeZone: zone, ...opts });

/** "11월 25일 (수)" */
export function dateLabel(d: Date | string): string {
  return fmt({ month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(d));
}
/** "15:00" */
export function timeLabel(d: Date | string): string {
  return fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
}
/** "11.25 15:00" — 좁은 칸에 넣는 짧은 꼴 */
export function shortWhen(d: Date | string): string {
  const parts = fmt({
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(d));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}
/** 그 시각이 사용자 시간대로 며칠인지 "2026-11-25" */
export function dayKey(d: Date | string): string {
  const parts = fmt({
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(d));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
/** 할 일 마감 표시: 오늘이면 시각, 아니면 날짜. */
export function dueLabel(iso: string): string {
  return dayKey(iso) === dayKey(new Date()) ? `오늘 ${timeLabel(iso)}` : shortWhen(iso);
}
/** "3분 전", "어제" 같은 상대 시각 */
export function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}일 전` : shortWhen(iso).split(' ')[0];
}

/** 사용자 시간대의 UTC 오프셋 "+09:00". 입력한 날짜·시각을 ISO로 바꿀 때 쓴다. */
export function zoneOffset(at = new Date()): string {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  }).format(at);
  return name.split('GMT')[1] || '+00:00';
}
/** <input type="datetime-local"> 값 → ISO(UTC) */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const base = value.length === 16 ? `${value}:00` : value;
  // 서머타임 바뀌는 날도 맞게: 한 번 맞춘 시각의 오프셋으로 다시 맞춘다(제미나이 검토)
  const first = new Date(`${base}${zoneOffset(new Date(`${base}Z`))}`);
  if (Number.isNaN(first.getTime())) return null;
  const d = new Date(`${base}${zoneOffset(first)}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** ISO → <input type="datetime-local"> 값(사용자 시간대) */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return `${dayKey(iso)}T${timeLabel(iso)}`;
}

const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });

/** 표의 칸에 보여 줄 글자. */
export function cellText(value: CellValue | undefined, type: ColumnType | string): string {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'number' && typeof value === 'number') return number.format(value);
  if (type === 'boolean') return value === true ? '예' : value === false ? '아니오' : String(value);
  if (type === 'datetime' && typeof value === 'string') return shortWhen(value);
  return String(value);
}

export const usd = (n: number) => `$${n.toFixed(2)}`;
export const count = (n: number) => number.format(n);
