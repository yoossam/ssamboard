import { AGG_LABEL, BUCKET_LABEL, findColumn, type Column, type QueryResult, type QuerySpec, type TableSchema } from '@jarvis/shared';

// 검증을 마친 조회·집계 규격(4.4)을 파라미터 바인딩한 SQL로 바꾼다.
// 값과 컬럼 ID는 모두 파라미터로 넘기고, SQL 문자열에는 고정된 키워드만 들어간다. 숫자는 모두 DB가 계산한다.

export interface BuiltQuery {
  sql: string;
  params: unknown[];
  columns: QueryResult['columns'];
  /** 'rows': 조건에 맞는 행 그대로, 'agg': 묶거나 집계한 결과 */
  mode: 'rows' | 'agg';
}

const CAST: Partial<Record<Column['type'], string>> = { number: 'numeric', date: 'date', datetime: 'timestamptz', boolean: 'boolean' };
const BUCKET_FORMAT = { day: 'YYYY-MM-DD', week: 'YYYY-MM-DD', month: 'YYYY-MM' } as const;
const COMPARE = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

export function buildQuerySql(tableId: string, userId: string, spec: QuerySpec, schema: TableSchema, timezone = 'Asia/Seoul'): BuiltQuery {
  const params: unknown[] = [tableId, userId];
  const p = (v: unknown): string => {
    params.push(v);
    return `$${params.length}`;
  };
  const col = (id: string): Column => {
    const c = findColumn(schema, id);
    if (!c) throw new Error(`없는 컬럼입니다: ${id}`);
    return c;
  };
  const text = (c: Column) => `(r.data->>(${p(c.id)}::text))`;
  const typed = (c: Column) => (CAST[c.type] ? `${text(c)}::${CAST[c.type]}` : text(c));
  const lit = (c: Column, v: unknown) => (CAST[c.type] ? `${p(v)}::${CAST[c.type]}` : `${p(String(v))}::text`);

  const where = ['r.table_id = $1', 'r.user_id = $2', 'r.deleted_at is null'];
  for (const f of spec.filter ?? []) {
    const c = col(f.col_id);
    switch (f.op) {
      case 'eq':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        where.push(`${typed(c)} ${COMPARE[f.op]} ${lit(c, f.value)}`);
        break;
      case 'ne':
        where.push(`${typed(c)} is distinct from ${lit(c, f.value)}`);
        break;
      case 'contains':
        where.push(`${text(c)} ilike ${p(`%${escapeLike(String(f.value))}%`)}::text`);
        break;
      case 'in':
        where.push(`${typed(c)} in (${(f.value as unknown[]).map((v) => lit(c, v)).join(', ')})`);
        break;
      case 'between': {
        const [a, b] = f.value as unknown[];
        where.push(`${typed(c)} between ${lit(c, a)} and ${lit(c, b)}`);
        break;
      }
      case 'is_null':
        where.push(`${text(c)} is ${f.value === false ? 'not ' : ''}null`);
        break;
    }
  }

  const groups = (spec.group_by ?? []).map((g) => {
    const c = col(g.col_id);
    if (g.bucket) {
      const ts = c.type === 'datetime' ? `(${text(c)}::timestamptz at time zone ${p(timezone)}::text)` : `${text(c)}::date::timestamp`;
      const expr = `to_char(date_trunc('${g.bucket}', ${ts}), '${BUCKET_FORMAT[g.bucket]}')`;
      return { col_id: c.id, group: expr, select: expr, label: `${c.name} (${BUCKET_LABEL[g.bucket]})`, type: 'text' };
    }
    const expr = typed(c);
    const select = c.type === 'number' ? `(${expr})::float8` : c.type === 'date' || c.type === 'datetime' ? `(${expr})::text` : expr;
    return { col_id: c.id, group: expr, select, label: c.name, type: c.type as string };
  });

  const aggs = (spec.agg ?? []).map((a) => {
    if (!a.col_id) return { select: 'count(*)::int', label: AGG_LABEL.count, type: 'number' };
    const c = col(a.col_id);
    if (a.fn === 'count') return { select: `count(${text(c)})::int`, label: `${c.name} ${AGG_LABEL.count}`, type: 'number' };
    const expr = `${a.fn}(${typed(c)})`;
    return c.type === 'number'
      ? { select: `(${expr})::float8`, label: `${c.name} ${AGG_LABEL[a.fn]}`, type: 'number' }
      : { select: `(${expr})::text`, label: `${c.name} ${AGG_LABEL[a.fn]}`, type: c.type as string };
  });

  const limit = `limit ${Math.max(1, Math.min(1000, Math.trunc(spec.limit ?? 100)))}`;

  if (groups.length === 0 && aggs.length === 0) {
    const order = (spec.sort ?? []).filter((s) => s.col_id).map((s) => `${typed(col(s.col_id!))} ${s.dir === 'desc' ? 'desc' : 'asc'} nulls last`);
    order.push('r.position asc');
    return {
      sql: `select r.id, r.data from data_rows r where ${where.join(' and ')} order by ${order.join(', ')} ${limit}`,
      params,
      columns: schema.columns.map((c) => ({ key: c.id, label: c.name, type: c.type })),
      mode: 'rows',
    };
  }

  const order: string[] = [];
  for (const s of spec.sort ?? []) {
    const dir = s.dir === 'desc' ? 'desc' : 'asc';
    if (typeof s.agg === 'number') order.push(`a${s.agg} ${dir} nulls last`);
    else {
      const g = groups.find((x) => x.col_id === s.col_id);
      if (g) order.push(`${g.group} ${dir} nulls last`);
    }
  }
  if (order.length === 0) groups.forEach((g) => order.push(`${g.group} asc nulls last`));

  const select = [...groups.map((g, i) => `${g.select} as g${i}`), ...aggs.map((a, i) => `${a.select} as a${i}`)];
  const sql =
    `select ${select.join(', ')} from data_rows r where ${where.join(' and ')}` +
    (groups.length > 0 ? ` group by ${groups.map((g) => g.group).join(', ')}` : '') +
    (order.length > 0 ? ` order by ${order.join(', ')}` : '') +
    ` ${limit}`;
  return {
    sql,
    params,
    columns: [
      ...groups.map((g, i) => ({ key: `g${i}`, label: g.label, type: g.type })),
      ...aggs.map((a, i) => ({ key: `a${i}`, label: a.label, type: a.type })),
    ],
    mode: 'agg',
  };
}

/** DB에서 받은 행을 화면·LLM이 쓰는 결과 형식으로 바꾼다. */
export function toQueryResult(built: BuiltQuery, rows: Record<string, any>[]): QueryResult {
  if (built.mode === 'rows') {
    return { columns: built.columns, rows: rows.map((r) => built.columns.map((c) => r.data?.[c.key] ?? null)) };
  }
  return { columns: built.columns, rows: rows.map((r) => built.columns.map((c) => r[c.key] ?? null)) };
}
