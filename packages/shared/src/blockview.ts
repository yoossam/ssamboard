/*
 * 할 일·일정·알림 블록의 '보여 줄 내용'(2026-11-28 선생님 "고정하지 말고 수정할 수 있게"). block.config 에 둔다.
 * 값이 없으면 예전과 같게 보인다(할 일 전부, 일정 2주, 알림 전부).
 */
export const TASK_FILTERS = ['all', 'open', 'today', 'week', 'dated', 'undated'] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];
export const TASK_FILTER_LABEL: Record<TaskFilter, string> = {
  all: '전부(끝낸 것 포함)',
  open: '안 끝난 것만',
  today: '오늘까지 마감',
  week: '이번 주까지 마감',
  dated: '마감 있는 것만',
  undated: '마감 없는 것만(담당 사업 등)',
};

export const EVENT_DAYS = [1, 3, 7, 14, 30] as const;
export const EVENT_DAYS_LABEL: Record<number, string> = { 1: '오늘', 3: '3일', 7: '1주', 14: '2주', 30: '한 달' };
export const DEFAULT_EVENT_DAYS = 14;

export const NOTI_SHOWS = ['all', 'unread'] as const;
export type NotiShow = (typeof NOTI_SHOWS)[number];
export const NOTI_SHOW_LABEL: Record<NotiShow, string> = { all: '전부', unread: '안 읽은 것만' };

/**
 * 블록의 '보여 줄 할 일'로 거른다 — 보드·휴대폰·공유 페이지가 같이 쓴다. dayStart 는 사용자 시간대의 오늘 0시(ms).
 * 끝낸 것은 'all' 에만 보인다. 'dated'·'undated'(2026-11-28): 마감 있는 일과 연중 담당 사업(마감 없음)을 다른 블록에 나눠 둔다.
 */
export function pickTasks<T extends { status: string; due_at: string | null }>(tasks: T[], f: TaskFilter, dayStart: number): T[] {
  if (f === 'all') return tasks;
  const open = tasks.filter((t) => t.status === 'open');
  if (f === 'open') return open;
  if (f === 'dated') return open.filter((t) => !!t.due_at);
  if (f === 'undated') return open.filter((t) => !t.due_at);
  const limit = dayStart + (f === 'today' ? 1 : 7) * 86_400_000;
  return open.filter((t) => t.due_at && new Date(t.due_at).getTime() < limit);
}

export const taskFilterOf = (config: Record<string, unknown> | undefined): TaskFilter =>
  (TASK_FILTERS as readonly unknown[]).includes(config?.task_filter) ? (config!.task_filter as TaskFilter) : 'all';
export const eventDaysOf = (config: Record<string, unknown> | undefined): number => ((EVENT_DAYS as readonly unknown[]).includes(config?.event_days) ? Number(config!.event_days) : DEFAULT_EVENT_DAYS);
export const notiShowOf = (config: Record<string, unknown> | undefined): NotiShow => ((NOTI_SHOWS as readonly unknown[]).includes(config?.noti_show) ? (config!.noti_show as NotiShow) : 'all');
