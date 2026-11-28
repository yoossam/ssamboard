import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { QueryResult, RowDto, RowPage, TableDto } from '@jarvis/shared';
import { Auth, type AuthCtx } from '../auth/auth.types';
import { bad, int, notFound, obj, optStr, str, uuid } from '../common/http';
import { UploadsService } from '../uploads/uploads.service';
import { checkColumnDefs, TablesService, type SchemaOp } from './tables.service';

@Controller('tables')
export class TablesController {
  constructor(
    private readonly tables: TablesService,
    private readonly uploads: UploadsService,
  ) {}

  @Get()
  list(@Auth() ctx: AuthCtx): Promise<TableDto[]> {
    return this.tables.list(ctx.user.id);
  }

  /**
   * 표를 만든다. upload_id가 있으면 올린 파일을 서버가 다시 파싱해 모든 행을 넣는다(LLM-3).
   * columns[i].source는 그 컬럼이 원본의 몇 번째 열인지다(없으면 같은 순서).
   */
  @Post()
  async create(@Auth() ctx: AuthCtx, @Body() body: any): Promise<{ table: TableDto; failures: Record<string, number> }> {
    const name = str(body?.name, '표 이름', { max: 80 });
    const columns = checkColumnDefs(body.columns);
    if (body.upload_id) {
      const parsed = await this.uploads.read(ctx.user.id, uuid(body.upload_id, 'upload_id'));
      const sourceIndex = (body.columns as any[]).map((c, i) => (Number.isInteger(c?.source) ? c.source : i));
      if (sourceIndex.some((s) => s < 0 || s >= parsed.header.length)) bad('컬럼의 원본 열 번호가 잘못됐습니다.');
      const result = await this.tables.create(ctx.user.id, {
        name,
        columns,
        rawRows: parsed.body,
        sourceIndex,
        origin: 'upload',
      });
      await this.uploads.attach(ctx.user.id, body.upload_id, result.table.id);
      return result;
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.some((r: unknown) => !Array.isArray(r))) bad('rows의 각 행은 배열이어야 합니다.');
    return this.tables.create(ctx.user.id, {
      name,
      columns,
      rawRows: rows,
      origin: 'manual',
    });
  }

  @Get(':id')
  get(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<TableDto> {
    return this.tables.require(ctx.user.id, uuid(id));
  }

  @Patch(':id')
  async update(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<TableDto> {
    const table = await this.tables.update(ctx.user.id, uuid(id), {
      name: optStr(body?.name, '표 이름', { max: 80 }),
      llm_excluded: typeof body?.llm_excluded === 'boolean' ? body.llm_excluded : undefined,
    });
    return table ?? notFound('표');
  }

  @Delete(':id')
  async remove(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ ok: true }> {
    if (!(await this.tables.remove(ctx.user.id, uuid(id)))) notFound('표');
    return { ok: true };
  }

  /** 컬럼 추가·이름 변경·타입 변경·삭제(LLM-13). */
  @Patch(':id/schema')
  schema(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<TableDto> {
    if (!Array.isArray(body?.ops) || body.ops.length === 0 || body.ops.length > 20) bad('ops가 잘못됐습니다.');
    return this.tables.patchSchema(ctx.user.id, uuid(id), body.ops as SchemaOp[]);
  }

  @Get(':id/rows')
  rows(@Auth() ctx: AuthCtx, @Param('id') id: string, @Query() query: any): Promise<RowPage> {
    return this.tables.rows(ctx.user.id, uuid(id), {
      page: query.page === undefined ? 1 : int(query.page, 'page', { min: 1, max: 100_000 }),
      size: query.size === undefined ? 5 : int(query.size, 'size', { min: 1, max: 200 }),
      sort: typeof query.sort === 'string' ? query.sort : undefined,
      dir: query.dir === 'desc' ? 'desc' : 'asc',
    });
  }

  @Post(':id/rows')
  async addRow(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<{ added: number }> {
    const rows = Array.isArray(body?.rows) ? body.rows : [obj(body?.values, 'values')];
    if (rows.length === 0 || rows.length > 1000) bad('한 번에 1~1,000행까지 넣을 수 있습니다.');
    return {
      added: await this.tables.addRows(
        ctx.user.id,
        uuid(id),
        rows.map((r: unknown) => obj(r, '행')),
      ),
    };
  }

  @Patch(':id/rows/:rowId')
  async updateRow(@Auth() ctx: AuthCtx, @Param('id') id: string, @Param('rowId') rowId: string, @Body() body: any): Promise<RowDto> {
    return (await this.tables.updateRow(ctx.user.id, uuid(id), uuid(rowId, 'rowId'), obj(body?.values, 'values'))) ?? notFound('행');
  }

  @Delete(':id/rows/:rowId')
  async deleteRow(@Auth() ctx: AuthCtx, @Param('id') id: string, @Param('rowId') rowId: string): Promise<{ ok: true }> {
    if (!(await this.tables.deleteRow(ctx.user.id, uuid(id), uuid(rowId, 'rowId')))) notFound('행');
    return { ok: true };
  }

  /** 4.4 조회·집계 규격 실행. */
  @Post(':id/query')
  query(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: unknown): Promise<QueryResult> {
    return this.tables.query(ctx.user.id, uuid(id), body, ctx.user.timezone);
  }

  /** 올린 파일의 행을 기존 표에 더한다(LLM-4의 append). 머리글 이름이 같은 컬럼끼리 맞춘다. */
  @Post(':id/append')
  async append(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<{ added: number; unmatched: string[] }> {
    const table = await this.tables.require(ctx.user.id, uuid(id));
    const parsed = await this.uploads.read(ctx.user.id, uuid(body?.upload_id, 'upload_id'));
    const pairs = table.schema.columns
      .map((c) => ({
        col: c,
        source: parsed.header.findIndex((h) => h.trim() === c.name),
      }))
      .filter((p) => p.source >= 0);
    if (pairs.length === 0) bad('머리글 이름이 같은 컬럼이 하나도 없습니다.');
    const rows = parsed.body.map((cells) => Object.fromEntries(pairs.map((p) => [p.col.id, cells[p.source]])));
    // 한 트랜잭션으로 — 중간에 실패하면 앞 조각만 들어가는 일이 없게(제미나이 검토)
    const added = await this.tables.addRowsAll(ctx.user.id, table.id, rows);
    return {
      added,
      unmatched: parsed.header.filter((h) => !pairs.some((p) => p.col.name === h.trim())),
    };
  }
}
