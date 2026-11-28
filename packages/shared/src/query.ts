import { findColumn, normalizeValue } from './columns';
import type { Column, ColumnType, TableSchema } from './types';

// 4.4 조회·집계 규격. LLM은 SQL을 쓰지 않고 이 JSON만 만든다. 컬럼은 고정 ID(col_id)로 가리킨다.

export const FILTER_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'between', 'is_null'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export const AGG_FNS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type AggFn = (typeof AGG_FNS)[number];
export const BUCKETS = ['day', 'week', 'month'] as const;
export type Bucket = (typeof BUCKETS)[number];

export interface QueryFilter {
  col_id: string;
  op: FilterOp;
  value?: unknown;
}
export interface QueryGroup {
  col_id: string;
  bucket?: Bucket;
}
export interface QueryAgg {
  col_id?: string;
  fn: AggFn;
}
export interface QuerySort {
  /** 정렬할 컬럼. 묶어서 집계할 때는 group_by에 든 컬럼만 가능하다. */
  col_id?: string;
  /** 집계 결과로 정렬할 때 agg 배열의 순번(0부터). */
  agg?: number;
  dir: 'asc' | 'desc';
}
export interface QuerySpec {
  table_id?: string;
  filter?: QueryFilter[];
  group_by?: QueryGroup[];
  agg?: QueryAgg[];
  sort?: QuerySort[];
  limit?: number;
}

export type QueryValidation = { ok: true; spec: QuerySpec } | { ok: false; error: string };

const ORDERED: ColumnType[] = ['number', 'date', 'datetime'];
const TEXTUAL: ColumnType[] = ['text', 'select', 'url'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const QUERY_MAX_LIMIT = 1000;
export const QUERY_DEFAULT_LIMIT = 100;

/**
 * 규격을 테이블 스키마로 검증한다(QRY-2). 맞지 않으면 실행하지 않고 오류를 돌려준다.
 * 필터 값은 컬럼 타입에 맞춰 정규화한다("1,200원" → 1200). 조건은 모두 AND이고 조인·OR은 없다(QRY-4).
 */
export function validateQuery(input: unknown, schema: TableSchema): QueryValidation {
  if (!isObj(input)) return { ok: false, error: '규격은 객체여야 합니다.' };
  const col = (id: unknown): Column | string => {
    if (typeof id !== 'string') return 'col_id가 없습니다.';
    return findColumn(schema, id) ?? `없는 컬럼입니다: ${id}`;
  };
  const value = (c: Column, v: unknown): { ok: true; v: unknown } | { ok: false } => {
    const n = normalizeValue(v, c.type);
    return n.ok && n.value !== null ? { ok: true, v: n.value } : { ok: false };
  };

  const filter: QueryFilter[] = [];
  for (const f of Array.isArray(input.filter) ? input.filter : []) {
    if (!isObj(f)) return { ok: false, error: 'filter 항목이 잘못됐습니다.' };
    const c = col(f.col_id);
    if (typeof c === 'string') return { ok: false, error: c };
    const op = f.op as FilterOp;
    if (!FILTER_OPS.includes(op))
      return {
        ok: false,
        error: `허용하지 않는 연산자입니다: ${String(f.op)}`,
      };
    if (['gt', 'gte', 'lt', 'lte', 'between'].includes(op) && !ORDERED.includes(c.type))
      return {
        ok: false,
        error: `${c.name} 컬럼(${c.type})에는 ${op}를 쓸 수 없습니다.`,
      };
    if (op === 'contains' && !TEXTUAL.includes(c.type))
      return {
        ok: false,
        error: `${c.name} 컬럼에는 contains를 쓸 수 없습니다.`,
      };
    if (op === 'is_null') {
      filter.push({ col_id: c.id, op, value: f.value !== false });
    } else if (op === 'contains') {
      if (typeof f.value !== 'string' || f.value === '') return { ok: false, error: 'contains에는 글자가 필요합니다.' };
      filter.push({ col_id: c.id, op, value: f.value });
    } else if (op === 'in' || op === 'between') {
      if (!Array.isArray(f.value) || f.value.length === 0 || (op === 'between' && f.value.length !== 2))
        return {
          ok: false,
          error: `${op}에는 ${op === 'between' ? '값 두 개' : '값 목록'}가 필요합니다.`,
        };
      const vs = f.value.map((v) => value(c, v));
      if (vs.some((v) => !v.ok))
        return {
          ok: false,
          error: `${c.name} 컬럼 타입(${c.type})에 맞지 않는 값입니다.`,
        };
      filter.push({
        col_id: c.id,
        op,
        value: vs.map((v) => (v as { v: unknown }).v),
      });
    } else {
      const v = value(c, f.value);
      if (!v.ok)
        return {
          ok: false,
          error: `${c.name} 컬럼 타입(${c.type})에 맞지 않는 값입니다.`,
        };
      filter.push({ col_id: c.id, op, value: v.v });
    }
  }

  const group_by: QueryGroup[] = [];
  for (const g of Array.isArray(input.group_by) ? input.group_by : []) {
    const item = typeof g === 'string' ? { col_id: g } : g;
    if (!isObj(item)) return { ok: false, error: 'group_by 항목이 잘못됐습니다.' };
    const c = col(item.col_id);
    if (typeof c === 'string') return { ok: false, error: c };
    if (item.bucket !== undefined && item.bucket !== null) {
      if (!BUCKETS.includes(item.bucket as Bucket)) return { ok: false, error: `bucket은 day·week·month 중 하나입니다.` };
      if (c.type !== 'date' && c.type !== 'datetime')
        return {
          ok: false,
          error: `${c.name} 컬럼은 날짜가 아니라 bucket을 쓸 수 없습니다.`,
        };
      group_by.push({ col_id: c.id, bucket: item.bucket as Bucket });
    } else {
      group_by.push({ col_id: c.id });
    }
  }

  const agg: QueryAgg[] = [];
  for (const a of Array.isArray(input.agg) ? input.agg : []) {
    if (!isObj(a) || !AGG_FNS.includes(a.fn as AggFn))
      return {
        ok: false,
        error: '집계 함수는 count·sum·avg·min·max 중 하나입니다.',
      };
    const fn = a.fn as AggFn;
    if (fn === 'count' && (a.col_id === undefined || a.col_id === null)) {
      agg.push({ fn });
      continue;
    }
    const c = col(a.col_id);
    if (typeof c === 'string') return { ok: false, error: c };
    if ((fn === 'sum' || fn === 'avg') && c.type !== 'number')
      return {
        ok: false,
        error: `${c.name} 컬럼은 숫자가 아니라 ${fn}을 쓸 수 없습니다.`,
      };
    if ((fn === 'min' || fn === 'max') && !ORDERED.includes(c.type)) return { ok: false, error: `${c.name} 컬럼에는 ${fn}을 쓸 수 없습니다.` };
    agg.push({ col_id: c.id, fn });
  }
  if (group_by.length > 0 && agg.length === 0) agg.push({ fn: 'count' });

  const grouped = group_by.length > 0 || agg.length > 0;
  const sort: QuerySort[] = [];
  for (const s of Array.isArray(input.sort) ? input.sort : []) {
    if (!isObj(s)) return { ok: false, error: 'sort 항목이 잘못됐습니다.' };
    if (s.dir !== undefined && s.dir !== 'asc' && s.dir !== 'desc') return { ok: false, error: "sort.dir 은 'asc' 나 'desc' 만 됩니다." };
    const dir = s.dir === 'desc' ? 'desc' : 'asc';
    if (typeof s.agg === 'number') {
      if (!Number.isInteger(s.agg) || s.agg < 0 || s.agg >= agg.length) return { ok: false, error: 'sort.agg가 agg 범위를 벗어났습니다.' };
      sort.push({ agg: s.agg, dir });
      continue;
    }
    const c = col(s.col_id);
    if (typeof c === 'string') return { ok: false, error: c };
    if (grouped && !group_by.some((g) => g.col_id === c.id))
      return {
        ok: false,
        error: `집계할 때는 group_by에 든 컬럼으로만 정렬할 수 있습니다: ${c.name}`,
      };
    sort.push({ col_id: c.id, dir });
  }

  let limit = QUERY_DEFAULT_LIMIT;
  if (input.limit !== undefined && input.limit !== null) {
    if (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1) return { ok: false, error: 'limit은 1 이상의 정수입니다.' };
    limit = Math.min(input.limit, QUERY_MAX_LIMIT);
  }
  return { ok: true, spec: { filter, group_by, agg, sort, limit } };
}

export const AGG_LABEL: Record<AggFn, string> = {
  count: '건수',
  sum: '합계',
  avg: '평균',
  min: '최소',
  max: '최대',
};
export const BUCKET_LABEL: Record<Bucket, string> = {
  day: '일',
  week: '주',
  month: '월',
};
