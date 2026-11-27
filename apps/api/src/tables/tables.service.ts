import { Injectable } from '@nestjs/common';
import {
  buildColumns,
  COLUMN_TYPES,
  findColumn,
  MAX_COLUMNS,
  MAX_TABLE_ROWS,
  normalizeRows,
  normalizeValue,
  validateQuery,
  type CellValue,
  type Column,
  type ColumnType,
  type QueryResult,
  type RowDto,
  type RowPage,
  type TableDto,
  type TableSchema,
} from '@jarvis/shared';
import { bad, notFound } from '../common/http';
import { Db, json, type Queryable } from '../db/db.service';
import { buildQuerySql, toQueryResult } from './query-sql';

export interface NewTable {
  name: string;
  columns: { name: string; type: ColumnType }[];
  /** 원본 행(셀 배열). 서버가 컬럼 타입에 맞춰 정규화한다. */
  rawRows: unknown[][];
  /** columns[i]가 원본의 몇 번째 열인지(기본: 같은 순서). */
  sourceIndex?: number[];
  origin: TableDto['origin'];
  connector_id?: string | null;
  sheet_ref?: Record<string, unknown> | null;
}

export type SchemaOp =
  | { op: 'add'; name: string; type: ColumnType }
  | { op: 'rename'; col_id: string; name: string }
  | { op: 'delete'; col_id: string }
  | { op: 'retype'; col_id: string; type: ColumnType };

const TABLE_SELECT = `select t.id, t.name, t.schema, t.origin, t.llm_excluded, t.last_synced_at, t.last_error,
  (t.connector_id is not null and t.sheet_ref is not null) as linked,
  case when t.sheet_ref->>'kind' = 'form' then jsonb_build_object(
    'title', t.sheet_ref->>'title',
    'responder_uri', t.sheet_ref->>'responder_uri',
    'edit_uri', 'https://docs.google.com/forms/d/' || (t.sheet_ref->>'form_id') || '/edit',
    'public_link', coalesce((t.sheet_ref->>'public_link')::boolean, false)) end as form,
  (select count(*) from data_rows r where r.table_id = t.id and r.deleted_at is null)::int as row_count
  from data_tables t`;
const CAST: Partial<Record<ColumnType, string>> = { number: 'numeric', date: 'date', datetime: 'timestamptz', boolean: 'boolean' };
const CHUNK = 1000;

export function checkColumnDefs(defs: unknown): { name: string; type: ColumnType }[] {
  if (!Array.isArray(defs) || defs.length === 0) bad('컬럼이 하나 이상 필요합니다.');
  const list = defs as any[];
  if (list.length > MAX_COLUMNS) bad(`컬럼은 최대 ${MAX_COLUMNS}개입니다.`);
  return list.map((d, i) => {
    if (!d || !COLUMN_TYPES.includes(d.type)) bad(`${i + 1}번째 컬럼의 타입이 허용 목록에 없습니다.`);
    return { name: String(d.name ?? '').slice(0, 60), type: d.type as ColumnType };
  });
}

@Injectable()
export class TablesService {
  constructor(private readonly db: Db) {}

  list(userId: string, q: Queryable = this.db): Promise<TableDto[]> {
    return q.query<TableDto>(`${TABLE_SELECT} where t.user_id = $1 and t.deleted_at is null order by t.created_at desc`, [userId]);
  }

  get(userId: string, id: string, q: Queryable = this.db): Promise<TableDto | null> {
    return q.one<TableDto>(`${TABLE_SELECT} where t.id = $1 and t.user_id = $2 and t.deleted_at is null`, [id, userId]);
  }

  async require(userId: string, id: string, q: Queryable = this.db): Promise<TableDto> {
    return (await this.get(userId, id, q)) ?? notFound('표');
  }

  /** 표를 만들고 행을 넣는다. 변환에 실패한 셀 수를 컬럼별로 돌려준다(LLM-12). */
  async create(userId: string, input: NewTable, q: Queryable = this.db, commandId: string | null = null): Promise<{ table: TableDto; failures: Record<string, number> }> {
    const defs = checkColumnDefs(input.columns);
    if (input.rawRows.length > MAX_TABLE_ROWS) bad(`표 하나에 넣을 수 있는 행은 최대 ${MAX_TABLE_ROWS.toLocaleString()}행입니다.`);
    const columns = buildColumns(defs);
    const name = input.name.trim().slice(0, 80) || '새 표';
    const row = (await q.one<{ id: string }>(
      `insert into data_tables(user_id, name, schema, origin, connector_id, sheet_ref, last_synced_at, command_id)
       values ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7, $8) returning id`,
      [userId, name, json({ columns }), input.origin, input.connector_id ?? null, json(input.sheet_ref ?? null), input.sheet_ref ? new Date() : null, commandId],
    ))!;
    const failures = await this.insertRows(q, userId, row.id, columns, input.rawRows, input.sourceIndex, commandId);
    return { table: (await this.get(userId, row.id, q))!, failures };
  }

  async insertRows(
    q: Queryable,
    userId: string,
    tableId: string,
    columns: Column[],
    rawRows: unknown[][],
    sourceIndex?: number[],
    commandId: string | null = null,
  ): Promise<Record<string, number>> {
    const failures: Record<string, number> = {};
    for (let i = 0; i < rawRows.length; i += CHUNK) {
      const result = normalizeRows(columns, rawRows.slice(i, i + CHUNK), sourceIndex);
      for (const [k, n] of Object.entries(result.failures)) failures[k] = (failures[k] ?? 0) + n;
      await q.query(
        `insert into data_rows(user_id, table_id, data, raw, command_id)
         select $1::uuid, $2::uuid, x.item->'v', nullif(x.item->'r', 'null'::jsonb), $4::uuid
           from jsonb_array_elements($3::jsonb) with ordinality as x(item, ord) order by x.ord`,
        [userId, tableId, json(result.rows.map((r) => ({ v: r.values, r: r.raw }))), commandId],
      );
    }
    return failures;
  }

  /** 연결된 시트를 다시 읽을 때 쓴다. 기존 행을 지우고 새로 넣는다. */
  async replaceRows(q: Queryable, userId: string, tableId: string, columns: Column[], rawRows: unknown[][]): Promise<void> {
    await q.query('delete from data_rows where table_id = $1 and user_id = $2', [tableId, userId]);
    await this.insertRows(q, userId, tableId, columns, rawRows);
  }

  async rows(userId: string, tableId: string, opts: { page: number; size: number; sort?: string; dir?: 'asc' | 'desc' }): Promise<RowPage> {
    const table = await this.require(userId, tableId);
    const params: unknown[] = [tableId, userId, opts.size, (opts.page - 1) * opts.size];
    let order = 'r.position asc';
    const sortCol = opts.sort ? findColumn(table.schema, opts.sort) : undefined;
    if (sortCol) {
      params.push(sortCol.id);
      const expr = `(r.data->>($5::text))${CAST[sortCol.type] ? `::${CAST[sortCol.type]}` : ''}`;
      order = `${expr} ${opts.dir === 'desc' ? 'desc' : 'asc'} nulls last, r.position asc`;
    }
    const rows = await this.db.query<RowDto & { data: RowDto['values'] }>(
      `select r.id, r.data, r.raw from data_rows r where r.table_id = $1 and r.user_id = $2 and r.deleted_at is null order by ${order} limit $3 offset $4`,
      params,
    );
    return { rows: rows.map((r) => ({ id: r.id, values: r.data, raw: r.raw })), total: table.row_count, page: opts.page, size: opts.size };
  }

  /** 컬럼 ID → 입력값 묶음을 타입에 맞춰 바꾼다. 맞지 않는 값이 있으면 400. */
  private normalizeRecord(schema: TableSchema, input: Record<string, unknown>, partial: boolean): Record<string, CellValue> {
    const values: Record<string, CellValue> = {};
    for (const [key, raw] of Object.entries(input)) {
      const col = findColumn(schema, key);
      if (!col) bad(`없는 컬럼입니다: ${key}`);
      const n = normalizeValue(raw, col!.type);
      if (!n.ok) bad(`${col!.name} 값이 ${col!.type} 타입에 맞지 않습니다: ${String(raw).slice(0, 40)}`);
      values[col!.id] = n.value;
    }
    if (!partial) for (const c of schema.columns) if (!(c.id in values)) values[c.id] = null;
    return values;
  }

  private writable(table: TableDto): void {
    if (table.linked) bad('연결된 표는 읽기 전용입니다. 원본 시트에서 고친 뒤 새로고침하세요.');
  }

  async addRows(userId: string, tableId: string, inputs: Record<string, unknown>[], q: Queryable = this.db, commandId: string | null = null): Promise<number> {
    const table = await this.require(userId, tableId, q);
    this.writable(table);
    if (table.row_count + inputs.length > MAX_TABLE_ROWS) bad(`표 하나에 넣을 수 있는 행은 최대 ${MAX_TABLE_ROWS.toLocaleString()}행입니다.`);
    const records = inputs.map((input) => this.normalizeRecord(table.schema, input, false));
    for (let i = 0; i < records.length; i += CHUNK) {
      await q.query(
        `insert into data_rows(user_id, table_id, data, command_id)
         select $1::uuid, $2::uuid, x.item, $4::uuid from jsonb_array_elements($3::jsonb) with ordinality as x(item, ord) order by x.ord`,
        [userId, tableId, json(records.slice(i, i + CHUNK)), commandId],
      );
    }
    return records.length;
  }

  async updateRow(userId: string, tableId: string, rowId: string, input: Record<string, unknown>): Promise<RowDto | null> {
    const table = await this.require(userId, tableId);
    this.writable(table);
    const values = this.normalizeRecord(table.schema, input, true);
    const keys = Object.keys(values);
    const row = await this.db.one<{ id: string; data: RowDto['values']; raw: RowDto['raw'] }>(
      `update data_rows set data = data || $4::jsonb, raw = nullif(coalesce(raw, '{}'::jsonb) - $5::text[], '{}'::jsonb), updated_at = now()
        where id = $1 and table_id = $2 and user_id = $3 and deleted_at is null returning id, data, raw`,
      [rowId, tableId, userId, json(values), keys],
    );
    return row ? { id: row.id, values: row.data, raw: row.raw } : null;
  }

  async deleteRow(userId: string, tableId: string, rowId: string): Promise<boolean> {
    this.writable(await this.require(userId, tableId));
    const rows = await this.db.query(
      'update data_rows set deleted_at = now(), updated_at = now() where id = $1 and table_id = $2 and user_id = $3 and deleted_at is null returning id',
      [rowId, tableId, userId],
    );
    return rows.length > 0;
  }

  async update(userId: string, id: string, patch: { name?: string; llm_excluded?: boolean }): Promise<TableDto | null> {
    const rows = await this.db.query(
      `update data_tables set name = coalesce($3, name), llm_excluded = coalesce($4, llm_excluded), updated_at = now()
        where id = $1 and user_id = $2 and deleted_at is null returning id`,
      [id, userId, patch.name === undefined ? null : patch.name.trim().slice(0, 80), patch.llm_excluded ?? null],
    );
    return rows.length > 0 ? this.get(userId, id) : null;
  }

  async remove(userId: string, id: string, q: Queryable = this.db): Promise<boolean> {
    const rows = await q.query('update data_tables set deleted_at = now(), updated_at = now() where id = $1 and user_id = $2 and deleted_at is null returning id', [id, userId]);
    return rows.length > 0;
  }

  /** 저장한 뒤의 스키마 변경(LLM-13). 컬럼 ID는 바뀌지 않아 저장된 집계가 깨지지 않는다. */
  async patchSchema(userId: string, id: string, ops: SchemaOp[]): Promise<TableDto> {
    return this.db.tx(async (q) => {
      const table = await this.require(userId, id, q);
      this.writable(table);
      const columns = [...table.schema.columns];
      const at = (colId: string) => {
        const i = columns.findIndex((c) => c.id === colId);
        if (i < 0) bad(`없는 컬럼입니다: ${colId}`);
        return i;
      };
      for (const op of ops) {
        if (op.op === 'add') {
          if (columns.length >= MAX_COLUMNS) bad(`컬럼은 최대 ${MAX_COLUMNS}개입니다.`);
          columns.push(...buildColumns(checkColumnDefs([op]), columns));
        } else if (op.op === 'rename') {
          const name = String(op.name ?? '').trim().slice(0, 60);
          if (!name) bad('컬럼 이름이 비어 있습니다.');
          if (columns.some((c) => c.name === name && c.id !== op.col_id)) bad(`같은 이름의 컬럼이 있습니다: ${name}`);
          columns[at(op.col_id)] = { ...columns[at(op.col_id)], name };
        } else if (op.op === 'delete') {
          if (columns.length <= 1) bad('컬럼은 하나 이상 남아야 합니다.');
          columns.splice(at(op.col_id), 1);
          await q.query(
            `update data_rows set data = data - $3::text, raw = nullif(coalesce(raw, '{}'::jsonb) - $3::text, '{}'::jsonb), updated_at = now() where table_id = $1 and user_id = $2`,
            [id, userId, op.col_id],
          );
        } else if (op.op === 'retype') {
          if (!COLUMN_TYPES.includes(op.type)) bad('타입이 허용 목록에 없습니다.');
          const i = at(op.col_id);
          columns[i] = { ...columns[i], type: op.type };
          await this.retype(q, userId, id, op.col_id, op.type);
        } else {
          bad('알 수 없는 스키마 변경입니다.');
        }
      }
      await q.query('update data_tables set schema = $3::jsonb, updated_at = now() where id = $1 and user_id = $2', [id, userId, json({ columns })]);
      return (await this.get(userId, id, q))!;
    });
  }

  /** 타입을 바꾸면 기존 값(실패했던 셀은 원문)을 새 타입으로 다시 변환한다. */
  private async retype(q: Queryable, userId: string, tableId: string, colId: string, type: ColumnType): Promise<void> {
    for (let after = 0; ; ) {
      const batch = await q.query<{ id: string; position: string; value: string | null; raw: string | null }>(
        `select id, position, data->>($3::text) as value, raw->>($3::text) as raw from data_rows
          where table_id = $1 and user_id = $2 and position > $4 order by position limit ${CHUNK}`,
        [tableId, userId, colId, after],
      );
      if (batch.length === 0) return;
      after = Number(batch[batch.length - 1].position);
      const payload = batch.map((r) => {
        const source = r.raw ?? r.value;
        const n = normalizeValue(source, type);
        return { id: r.id, v: n.value, r: n.ok ? null : String(source) };
      });
      await q.query(
        `update data_rows d set
           data = jsonb_set(d.data, array[$2::text], coalesce(x.item->'v', 'null'::jsonb)),
           raw = nullif(
             (coalesce(d.raw, '{}'::jsonb) - $2::text) ||
             case when x.item->>'r' is null then '{}'::jsonb else jsonb_build_object($2::text, x.item->>'r') end,
             '{}'::jsonb),
           updated_at = now()
          from jsonb_array_elements($1::jsonb) as x(item)
         where d.id = (x.item->>'id')::uuid`,
        [json(payload), colId],
      );
    }
  }

  /** 조회·집계 규격(4.4)을 검증한 뒤 실행한다. 맞지 않으면 실행하지 않고 400을 돌려준다(QRY-2). */
  async query(userId: string, tableId: string, spec: unknown, timezone: string, q: Queryable = this.db): Promise<QueryResult> {
    const table = await this.require(userId, tableId, q);
    const checked = validateQuery(spec, table.schema);
    if (!checked.ok) bad(checked.error);
    const built = buildQuerySql(tableId, userId, (checked as { spec: any }).spec, table.schema, timezone);
    return toQueryResult(built, await q.query(built.sql, built.params));
  }
}
