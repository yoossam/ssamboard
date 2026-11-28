import { HttpException, Injectable } from '@nestjs/common';
import {
  BLOCK_LABEL,
  BLOCK_TYPES,
  DEFAULT_BLOCK_SIZE,
  GRID_COLS,
  GRID_MAX_H,
  placeBlock,
  STICKER_SIZE,
  linksSignature,
  type BlockDto,
  type BlockType,
  type BoardDto,
  type GridPos,
  type PlaceHint,
  type BoardKind,
  type BoardTheme,
} from '@jarvis/shared';
import { boardKind } from '../common/board-context';
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

const CLASS_BOARD_HELLO = [
  '수업 중에 아래 입력줄에 바로 시키세요.',
  '',
  '· "분수의 덧셈 퀴즈 5문제 만들어" → 문항·정답을 확인하고 [퀴즈 시작] → 크게 뜬 학생 주소로 학생이 답합니다(로그인 없이 번호·별명)',
  '· 응답이 들어오면 문항별 정답률이 막대로 보이고, 마감 뒤 [AI 정리]로 다시 설명할 점을 받습니다.',
  '',
  '이 메모는 지워도 됩니다. 위쪽 [업무 | 수업]으로 보드를 오갑니다(기기마다 따로).',
].join('\n');

export function checkLayout(v: any): GridPos {
  const ok = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
  if (!v || !ok(v.x, 0, GRID_COLS - 1) || !ok(v.y, 0, 10_000) || !ok(v.w, 1, GRID_COLS) || !ok(v.h, 1, GRID_MAX_H) || v.x + v.w > GRID_COLS) bad('블록 위치가 잘못됐습니다.');
  return { x: v.x, y: v.y, w: v.w, h: v.h };
}

@Injectable()
export class BoardsService {
  constructor(private readonly db: Db) {}

  /**
   * 지금 요청이 보는 보드(업무·수업 — common/board-context.ts). 없으면 만든다.
   * 업무 보드는 기본 블록(일정·할 일·알림·메모), 수업 보드는 쓰는 법을 적은 메모 하나로 시작한다.
   */
  async currentBoard(userId: string, q: Queryable = this.db, kind: BoardKind = boardKind()): Promise<{ id: string; name: string; kind: BoardKind; theme: BoardTheme }> {
    const sql = 'select id, name, kind, theme from boards where user_id = $1 and kind = $2';
    const existing = await q.one(sql, [userId, kind]);
    if (existing) return existing;
    // 처음 들어와 화면이 동시에 여러 요청을 보내도 보드는 하나만(사용자별 잠금 뒤 다시 본다 — 제미나이 검토)
    const make = async (t: Queryable) => {
      await t.query("select pg_advisory_xact_lock(hashtext('board:' || $1::text))", [userId]);
      const again = await t.one(sql, [userId, kind]);
      if (again) return again;
      const board = (await t.one('insert into boards(user_id, kind, name) values ($1, $2, $3) returning id, name, kind, theme', [userId, kind, kind === 'class' ? '수업 보드' : '내 보드']))!;
      if (kind === 'class') await this.createBlock(userId, { type: 'memo', title: '수업 보드 쓰는 법', config: { text: CLASS_BOARD_HELLO }, layout_lg: { x: 0, y: 0, w: 8, h: 6 } }, t, null, board.id);
      else for (const type of ['events', 'tasks', 'notifications', 'memo'] as BlockType[]) await this.createBlock(userId, { type }, t, null, board.id);
      return board;
    };
    return q === this.db ? this.db.tx(make) : make(q);
  }

  async listBlocks(userId: string, q: Queryable = this.db, kind: BoardKind = boardKind()): Promise<BlockDto[]> {
    const board = await this.currentBoard(userId, q, kind);
    return q.query<BlockDto>(`select ${BLOCK_COLUMNS} from blocks where board_id = $1 and user_id = $2 and deleted_at is null order by created_at`, [board.id, userId]);
  }

  async getBlock(userId: string, id: string, q: Queryable = this.db): Promise<BlockDto | null> {
    return q.one<BlockDto>(`select ${BLOCK_COLUMNS} from blocks where id = $1 and user_id = $2 and deleted_at is null`, [id, userId]);
  }

  /** 보드 꾸미기. 보낸 키만 바꾼다. */
  async setTheme(userId: string, theme: BoardTheme): Promise<BoardTheme> {
    const board = await this.currentBoard(userId);
    const row = await this.db.one<{ theme: BoardTheme }>('update boards set theme = theme || $2::jsonb where id = $1 and user_id = $3 returning theme', [board.id, JSON.stringify(theme), userId]);
    return row?.theme ?? {};
  }

  async getBoard(userId: string): Promise<BoardDto> {
    const board = await this.currentBoard(userId);
    let blocks = await this.listBlocks(userId, this.db, board.kind);
    // 내 메뉴 블록이 없으면 스티커로 하나 놓는다(보드마다 늘 하나 — 지울 수 없음)
    if (!blocks.some((b) => b.type === 'menu')) {
      await this.db.tx(async (q) => {
        await q.query("select pg_advisory_xact_lock(hashtext('menu-block:' || $1::text))", [board.id]);
        if (await q.one("select 1 as hit from blocks where board_id = $1 and type = 'menu' and deleted_at is null", [board.id])) return;
        const placed = placeBlock(
          blocks.map((b) => b.layout_lg),
          STICKER_SIZE,
          null,
        );
        await this.createBlock(userId, { type: 'menu', config: { collapsed: true, expanded_layout: { ...placed, ...DEFAULT_BLOCK_SIZE.menu } }, layout_lg: placed }, q, null, board.id);
      });
      blocks = await this.listBlocks(userId, this.db, board.kind);
    }
    return { ...board, blocks };
  }

  async createBlock(userId: string, input: NewBlock, q: Queryable = this.db, commandId: string | null = null, boardId?: string): Promise<BlockDto> {
    if (!BLOCK_TYPES.includes(input.type)) bad('블록 종류가 잘못됐습니다.');
    // 원본 표는 이 사용자 것만(제미나이 검토)
    if (input.source_table_id && !(await q.one('select 1 as hit from data_tables where id = $1 and user_id = $2 and deleted_at is null', [input.source_table_id, userId]))) bad('원본 표가 없습니다.');
    const board = boardId ?? (await this.currentBoard(userId, q)).id;
    const existing = await q.query<{ layout_lg: GridPos }>('select layout_lg from blocks where board_id = $1 and deleted_at is null', [board]);
    const layout = input.layout_lg
      ? checkLayout(input.layout_lg)
      : placeBlock(
          existing.map((b) => b.layout_lg),
          DEFAULT_BLOCK_SIZE[input.type],
          input.hint,
        );
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
    patch: {
      title?: string;
      config?: Record<string, any>;
      pinned?: boolean;
      layout_lg?: GridPos;
    },
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

  /** 수업 자료 목록 저장 — 화면이 읽었던 목록(base)과 지금이 다르면 409(다른 기기가 먼저 고침) */
  async updateLinks(userId: string, id: string, items: unknown[], base: string): Promise<BlockDto | null> {
    return this.db.tx(async (q) => {
      const cur = await q.one<{ config: Record<string, any> }>("select config from blocks where id = $1 and user_id = $2 and deleted_at is null and type = 'links' for update", [id, userId]);
      if (!cur) return null;
      if (linksSignature(cur.config.items ?? []) !== base) throw new HttpException('다른 곳에서 이 자료 목록을 먼저 고쳤습니다. 새로 읽은 뒤 다시 해 주세요.', 409);
      return this.updateBlock(userId, id, { config: { items } }, q);
    });
  }

  /** 삭제는 휴지통으로 보낸다(30일 보관). */
  async deleteBlock(userId: string, id: string, q: Queryable = this.db): Promise<boolean> {
    // 내 메뉴 블록은 보드마다 하나, 지우지 않는다(자주 쓰는 순 자동 메뉴가 사는 곳 — 2026-11-28). 접어 둘 수는 있다.
    if ((await q.one<{ type: string }>('select type from blocks where id = $1 and user_id = $2 and deleted_at is null', [id, userId]))?.type === 'menu')
      bad('내 메뉴 블록은 지울 수 없어요. ⋯ → 스티커로 접어 두세요.');
    const rows = await q.query('update blocks set deleted_at = now(), updated_at = now() where id = $1 and user_id = $2 and deleted_at is null returning id', [id, userId]);
    return rows.length > 0;
  }

  /** 블록 위치·크기·고정·휴대폰 순서를 한 번에 저장한다(BRD-4, MOB-1). */
  async saveLayout(
    userId: string,
    items: {
      id: string;
      layout_lg?: GridPos;
      layout_sm?: { order: number } | null;
      pinned?: boolean;
    }[],
  ): Promise<void> {
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
