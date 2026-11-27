import { validateQuery, type QuerySpec } from './query';
import type { TableSchema } from './types';

// AI 화면 블록(type: view). AI가 쓴 그리기 코드(code)와 꾸밈(css)을 격리된 틀 안에서 돌리고, 자료는 브라우저에서 넣어 준다.
// 코드에는 자료를 적어 넣지 않는다. 그래서 자료가 바뀌면 화면도 따라 바뀌고, 자료가 AI를 거쳐 가지도 않는다.
// 틀이 어떻게 가두는지는 apps/api/src/boards/view-frame.ts 에 있다.

/** 그리기 코드 길이 한도(글자 수). */
export const VIEW_CODE_MAX = 60_000;
/** 꾸밈(CSS) 길이 한도(글자 수). */
export const VIEW_CSS_MAX = 20_000;
/** 일정 자료를 받을 때 오늘 앞뒤로 볼 수 있는 가장 긴 날 수. */
export const VIEW_EVENT_DAYS_MAX = 400;

/** 화면이 받을 자료. 없으면(none) 화면 코드만으로 그린다. */
export type ViewData =
  | { kind: 'none' }
  | { kind: 'table'; table_id: string; query: QuerySpec }
  | { kind: 'tasks' }
  | { kind: 'events'; days_before: number; days_after: number };

export const VIEW_DATA_LABEL: Record<ViewData['kind'], string> = { none: '자료 없음', table: '표', tasks: '할 일', events: '일정' };

const days = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(VIEW_EVENT_DAYS_MAX, Math.max(0, Math.trunc(v))) : fallback);

/**
 * AI나 화면이 준 자료 정의를 확인한다. 표 자료는 그 표의 스키마로 query까지 검증한다.
 * 표를 찾는 일은 부르는 쪽이 한다(schemaOf가 null을 돌려주면 없는 표다).
 */
export function checkViewData(input: unknown, schemaOf: (tableId: string) => TableSchema | null): { ok: true; data: ViewData } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, data: { kind: 'none' } };
  if (typeof input !== 'object') return { ok: false, error: 'data는 객체여야 합니다.' };
  const v = input as Record<string, unknown>;
  switch (v.kind) {
    case 'none':
      return { ok: true, data: { kind: 'none' } };
    case 'tasks':
      return { ok: true, data: { kind: 'tasks' } };
    case 'events':
      return { ok: true, data: { kind: 'events', days_before: days(v.days_before, 0), days_after: days(v.days_after, 30) } };
    case 'table': {
      if (typeof v.table_id !== 'string') return { ok: false, error: 'data.table_id가 필요합니다. list_tables로 확인하세요.' };
      const schema = schemaOf(v.table_id);
      if (!schema) return { ok: false, error: '그런 표가 없습니다. list_tables로 다시 확인하세요.' };
      const checked = validateQuery(v.query ?? {}, schema);
      if (!checked.ok) return { ok: false, error: `data.query가 맞지 않습니다: ${checked.error}` };
      return { ok: true, data: { kind: 'table', table_id: v.table_id, query: checked.spec } };
    }
    default:
      return { ok: false, error: 'data.kind는 none, table, tasks, events 중 하나입니다.' };
  }
}

/** 저장된 값을 화면에서 읽을 때 쓴다. 모르는 모양이면 자료 없음으로 본다. */
export function readViewData(v: unknown): ViewData {
  if (!v || typeof v !== 'object') return { kind: 'none' };
  const d = v as Record<string, any>;
  if (d.kind === 'tasks') return { kind: 'tasks' };
  if (d.kind === 'events') return { kind: 'events', days_before: days(d.days_before, 0), days_after: days(d.days_after, 30) };
  if (d.kind === 'table' && typeof d.table_id === 'string' && d.query && typeof d.query === 'object') return { kind: 'table', table_id: d.table_id, query: d.query as QuerySpec };
  return { kind: 'none' };
}
