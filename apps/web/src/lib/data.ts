import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query';
import type { BoardDto, ConnectorDto, EventDto, NotificationDto, QueryResult, RowPage, SessionDto, SettingsDto, TableDto, TaskDto, TrashItem } from '@jarvis/shared';
import { api, ApiError } from './api';
import { dayKey, zoneOffset } from './format';

// 서버 데이터 읽기. 자동 새로고침은 활동 신호가 아니므로 잠금 시간을 늘리지 않는다(AUTH-5).

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // 잠겼거나(423) 로그아웃된(401) 뒤에는 다시 시도하지 않는다.
      retry: (count, error) => !(error instanceof ApiError && [401, 403, 404, 423].includes(error.status)) && count < 2,
    },
  },
});

export const keys = {
  board: ['board'] as const,
  tasks: ['tasks'] as const,
  events: ['events'] as const,
  notifications: ['notifications'] as const,
  tables: ['tables'] as const,
  settings: ['settings'] as const,
  sessions: ['sessions'] as const,
  connectors: ['connectors'] as const,
  trash: ['trash'] as const,
};

/** 바뀐 것을 다시 읽는다. 이름을 주지 않으면 전부. */
export function refresh(...names: (keyof typeof keys | 'rows' | 'query')[]): Promise<unknown> {
  if (names.length === 0) return queryClient.invalidateQueries();
  return Promise.all(names.map((n) => queryClient.invalidateQueries({ queryKey: n === 'rows' || n === 'query' ? [n] : keys[n] })));
}

export const useBoard = () => useQuery({ queryKey: keys.board, queryFn: () => api.get<BoardDto>('/boards/current') });
export const useTasks = () => useQuery({ queryKey: keys.tasks, queryFn: () => api.get<TaskDto[]>('/tasks') });

/** 오늘부터 2주 동안의 일정. */
export const useEvents = () =>
  useQuery({
    queryKey: keys.events,
    queryFn: () => {
      const from = new Date(`${dayKey(new Date())}T00:00:00${zoneOffset()}`);
      const to = new Date(from.getTime() + 14 * 86_400_000);
      return api.get<EventDto[]>(`/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    },
    refetchInterval: 5 * 60_000,
  });

export const useNotifications = () => useQuery({ queryKey: keys.notifications, queryFn: () => api.get<NotificationDto[]>('/notifications'), refetchInterval: 60_000 });
export const useTables = () => useQuery({ queryKey: keys.tables, queryFn: () => api.get<TableDto[]>('/tables') });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api.get<SettingsDto>('/settings') });
export const useSessions = () => useQuery({ queryKey: keys.sessions, queryFn: () => api.get<SessionDto[]>('/sessions') });
export const useConnectors = () => useQuery({ queryKey: keys.connectors, queryFn: () => api.get<ConnectorDto[]>('/connectors') });
export const useTrash = () => useQuery({ queryKey: keys.trash, queryFn: () => api.get<TrashItem[]>('/trash') });

/** 표 하나. 표 목록에서 찾는다(목록이 스키마까지 담고 있다). */
export function useTable(id: string | null | undefined): { table: TableDto | undefined; isLoading: boolean } {
  const { data, isLoading } = useTables();
  return { table: id ? data?.find((t) => t.id === id) : undefined, isLoading };
}

/** 표의 한 쪽. 큰 표는 쪽 단위로만 불러온다(5장 데이터 규모). */
export function useRows(tableId: string | null | undefined, page: number, size: number, sort?: string, dir: 'asc' | 'desc' = 'asc') {
  return useQuery({
    queryKey: ['rows', tableId, page, size, sort ?? '', dir],
    queryFn: () => api.get<RowPage>(`/tables/${tableId}/rows?page=${page}&size=${size}${sort ? `&sort=${encodeURIComponent(sort)}&dir=${dir}` : ''}`),
    enabled: !!tableId && size > 0,
    placeholderData: keepPreviousData,
  });
}

/** 저장해 둔 집계 정의를 서버에서 다시 계산한다(QRY-3). 숫자는 모두 서버가 계산한다. */
export function useQueryResult(tableId: string | null | undefined, spec: unknown) {
  return useQuery({
    queryKey: ['query', tableId, JSON.stringify(spec ?? null)],
    queryFn: () => api.post<QueryResult>(`/tables/${tableId}/query`, spec),
    enabled: !!tableId && !!spec,
    placeholderData: keepPreviousData,
  });
}
