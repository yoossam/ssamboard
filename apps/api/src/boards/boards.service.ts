import { Injectable } from '@nestjs/common';
import { BLOCK_LABEL, BLOCK_TYPES, DEFAULT_BLOCK_SIZE, GRID_COLS, GRID_MAX_H, placeBlock, type BlockDto, type BlockType, type BoardDto, type GridPos, type PlaceHint } from '@jarvis/shared';
import { bad } from '../common/http';
import { Db, json, type Queryable } from '../db/db.service';

const BLOCK_COLUMNS = 'id, type, title, layout_lg, layout_sm, pinned, config, source_table_id';

export interface NewBlock {
  type: BlockType;
  title?: string;
  config?: Record<string, any>;
  source_table_id?: string | null;
  layout_lg?: GridPos;
  hint?: PlaceHint | null;
}

export function checkLayout(v: any): GridPos {
  const ok = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
  if (!v || !ok(v.x, 0, GRID_COLS - 1) || !ok(v.y, 0, 10_000) || !ok(v.w, 1, GRID_COLS) || !ok(v.h, 1, GRID_MAX_H) || v.x + v.w > GRID_COLS) bad('블록 위치가 잘못됐습니다.');
  return { x: v.x, y: v.y, w: v.w, h: v.h };
}

@Injectable()
export class BoardsService {
  constructor(private readonly db: Db) {}

  /** MVP는 보드 1개. 처음 들어오면 기본 블록(일정·할 일·알림·메모)이 놓인 보드를 만든다. */
  async currentBoard(userId: string, q: Queryable = this.db): Promise<{ id: string; name: string }> {
    const existing = await q.one('select id, name from boards where user_id = $1 order by created_at limit 1', [userId]);
    if (existing) return existing;
    const board = (await q.one('insert into boards(user_id) values ($1) returning id, name', [userId]))!;
    for (const type of ['events', 'tasks', 'notifications', 'memo'] as BlockType[]) {
      await this.createBlock(userId, { type }, q, null, board.id);
    }
    return board;
  }

  async listBlocks(userId: string, q: Queryable = this.db): Promise<BlockDto[]> {
    const board = await this.currentBoard(userId, q);
    return q.query<BlockDto>(`select ${BLOCK_COLUMNS} from blocks where board_id = $1 and user_id = $2 and deleted_at is null order by created_at`, [board.id, userId]);
  }

  async getBlock(userId: string, id: string, q: Queryable = this.db): Promise<BlockDto | null> {
    return q.one<BlockDto>(`select ${BLOCK_COLUMNS} from blocks where id = $1 and user_id = $2 and deleted_at is null`, [id, userId]);
  }

  async getBoard(userId: string): Promise<BoardDto> {
    const board = await this.currentBoard(userId);
    return { ...board, blocks: await this.listBlocks(userId) };
  }

  async createBlock(userId: string, input: NewBlock, q: Queryable = this.db, commandId: string | null = null, boardId?: string): Promise<BlockDto> {
    if (!BLOCK_TYPES.includes(input.type)) bad('블록 종류가 잘못됐습니다.');
    const board = boardId ?? (await this.currentBoard(userId, q)).id;
    const existing = await q.query<{ layout_lg: GridPos }>('select layout_lg from blocks where board_id = $1 and deleted_at is null', [board]);
    const layout = input.layout_lg ? checkLayout(input.layout_lg) : placeBlock(existing.map((b) => b.layout_lg), DEFAULT_BLOCK_SIZE[input.type], input.hint);
    const title = (input.title ?? '').trim().slice(0, 60) || BLOCK_LABEL[input.type];
    return (await q.one<BlockDto>(
      `insert into blocks(user_id, board_id, type, title, layout_lg, config, source_table_id, command_id)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8) returning ${BLOCK_COLUMNS}`,
      [userId, board, input.type, title, json(layout), json(input.config ?? {}), input.source_table_id ?? null, commandId],
    ))!;
  }

  /** config 는 보낸 키만 바꾼다(얕은 병합). 메모의 글과 색처럼 따로 저장되는 값이 서로를 덮어쓰지 않게 하려는 것이다. */
  async updateBlock(
    userId: string,
    id: string,
    patch: { title?: string; config?: Record<string, any>; pinned?: boolean; layout_lg?: GridPos },
    q: Queryable = this.db,
  ): Promise<BlockDto | null> {
    return q.one<BlockDto>(
      `update blocks set
         title = coalesce($3, title),
         config = case when $4::jsonb is null then config else config || $4::jsonb end,
         pinned = coalesce($5, pinned),
         layout_lg = coalesce($6::jsonb, layout_lg),
         updated_at = now()
       where id = $1 and user_id = $2 and deleted_at is null returning ${BLOCK_COLUMNS}`,
      [
        id,
        userId,
        patch.title === undefined ? null : patch.title.trim().slice(0, 60),
        patch.config === undefined ? null : json(patch.config),
        patch.pinned ?? null,
        patch.layout_lg === undefined ? null : json(checkLayout(patch.layout_lg)),
      ],
    );
  }

  /** 삭제는 휴지통으로 보낸다(30일 보관). */
  async deleteBlock(userId: string, id: string, q: Queryable = this.db): Promise<boolean> {
    const rows = await q.query('update blocks set deleted_at = now(), updated_at = now() where id = $1 and user_id = $2 and deleted_at is null returning id', [id, userId]);
    return rows.length > 0;
  }

  /** 블록 위치·크기·고정·휴대폰 순서를 한 번에 저장한다(BRD-4, MOB-1). */
  async saveLayout(userId: string, items: { id: string; layout_lg?: GridPos; layout_sm?: { order: number } | null; pinned?: boolean }[]): Promise<void> {
    await this.db.tx(async (q) => {
      for (const item of items) {
        await q.query(
          `update blocks set
             layout_lg = coalesce($3::jsonb, layout_lg),
             layout_sm = case when $4::boolean then $5::jsonb else layout_sm end,
             pinned = coalesce($6, pinned),
             updated_at = now()
           where id = $1 and user_id = $2 and deleted_at is null`,
          [
            item.id,
            userId,
            item.layout_lg ? json(checkLayout(item.layout_lg)) : null,
            item.layout_sm !== undefined,
            item.layout_sm ? json({ order: Math.trunc(Number(item.layout_sm.order) || 0) }) : null,
            item.pinned ?? null,
          ],
        );
      }
    });
  }
}
