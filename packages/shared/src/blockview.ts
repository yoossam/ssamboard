/*
 * 할 일·일정·알림 블록의 '보여 줄 내용'(2026-11-28 선생님 "고정하지 말고 수정할 수 있게"). block.config 에 둔다.
 * 값이 없으면 예전과 같게 보인다(할 일 전부, 일정 2주, 알림 전부).
 */
export const TASK_FILTERS = ['all', 'open', 'today', 'week'] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];
export const TASK_FILTER_LABEL: Record<TaskFilter, string> = { all: '전부(끝낸 것 포함)', open: '안 끝난 것만', today: '오늘까지 마감', week: '이번 주까지 마감' };

export const EVENT_DAYS = [1, 3, 7, 14, 30] as const;
export const EVENT_DAYS_LABEL: Record<number, string> = { 1: '오늘', 3: '3일', 7: '1주', 14: '2주', 30: '한 달' };
export const DEFAULT_EVENT_DAYS = 14;

export const NOTI_SHOWS = ['all', 'unread'] as const;
export type NotiShow = (typeof NOTI_SHOWS)[number];
export const NOTI_SHOW_LABEL: Record<NotiShow, string> = { all: '전부', unread: '안 읽은 것만' };

export const taskFilterOf = (config: Record<string, unknown> | undefined): TaskFilter => ((TASK_FILTERS as readonly unknown[]).includes(config?.task_filter) ? (config!.task_filter as TaskFilter) : 'all');
export const eventDaysOf = (config: Record<string, unknown> | undefined): number => ((EVENT_DAYS as readonly unknown[]).includes(config?.event_days) ? Number(config!.event_days) : DEFAULT_EVENT_DAYS);
export const notiShowOf = (config: Record<string, unknown> | undefined): NotiShow => ((NOTI_SHOWS as readonly unknown[]).includes(config?.noti_show) ? (config!.noti_show as NotiShow) : 'all');
