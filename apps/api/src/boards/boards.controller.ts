import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import {
  BLOCK_TYPES,
  readViewData,
  VIEW_CODE_MAX,
  VIEW_CSS_MAX,
  type BlockDto,
  type BoardDto,
  type EventDto,
  type TaskDto,
  MEMO_COLORS,
  TITLE_COLORS,
  BOARD_BGS,
  type BoardTheme,
  EVENT_DAYS,
  NOTI_SHOWS,
  TASK_FILTERS,
  checkLinkItems,
  isHexColor,
} from '@jarvis/shared';
import type { Response } from 'express';
import { Auth, type AuthCtx } from '../auth/auth.types';
import { bad, isoOrNull, notFound, obj, oneOf, optStr, str, uuid } from '../common/http';
import { config } from '../config';
import { ItemsService } from '../items/items.service';
import { BoardsService, checkLayout } from './boards.service';
import { join } from 'node:path';
import { embeddedFontCss, frameCsp, frameDocument, newNonce, VIEW_EXTRA_HEADERS, viewCsp, viewDocument } from './view-frame';

/** 틀 문서는 전역 보안 헤더(틀 금지·보드용 정책) 대신 자기 정책으로 내보내고, 브라우저가 저장해 두지 않게 한다. */
function sendHtml(res: Response, html: string, csp: string, extra: Record<string, string> = {}): void {
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(extra)) res.setHeader(name, value);
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.type('html').send(html);
}

/**
 * 블록 config 에 화면 블록의 값이 들어 있으면 모양을 확인한다: 그리기 코드와 꾸밈은 글자이고 한도 안, 자료 정의는 아는 모양만 남긴다.
 * (표 자료의 query 는 조회할 때 서버가 다시 검증한다. AI 도구 길은 commands.service.ts 가 표의 스키마로 미리 검증한다.)
 */
function checkConfig(config: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!config) return config;
  // 꾸미기 값은 정해 둔 이름만(화면이 그 이름으로 색을 고른다 — 아무 글자나 받으면 CSS 로 새지 않게).
  // 정해 둔 이름 또는 고른 색(#rrggbb — 2026-11-28 "자유자재로")만
  if (config.bg !== undefined && !(MEMO_COLORS as readonly unknown[]).includes(config.bg) && !isHexColor(config.bg)) bad('바탕색이 잘못됐습니다.');
  if (config.title_color !== undefined && !(TITLE_COLORS as readonly unknown[]).includes(config.title_color) && !isHexColor(config.title_color)) bad('제목 색이 잘못됐습니다.');
  if (config.color !== undefined && !(MEMO_COLORS as readonly unknown[]).includes(config.color) && !isHexColor(config.color)) bad('종이 색이 잘못됐습니다.');
  if (config.text !== undefined && (typeof config.text !== 'string' || config.text.length > 20_000)) bad('글은 20,000자까지입니다.');
  // 할 일·일정·알림 블록의 보여 줄 내용(@jarvis/shared blockview.ts)
  if (config.task_filter !== undefined && !(TASK_FILTERS as readonly unknown[]).includes(config.task_filter)) bad('할 일 보기 방식이 잘못됐습니다.');
  if (config.event_days !== undefined && !(EVENT_DAYS as readonly unknown[]).includes(config.event_days)) bad('일정 기간이 잘못됐습니다.');
  if (config.noti_show !== undefined && !(NOTI_SHOWS as readonly unknown[]).includes(config.noti_show)) bad('알림 보기 방식이 잘못됐습니다.');
  if (config.code !== undefined && (typeof config.code !== 'string' || config.code.length > VIEW_CODE_MAX)) bad(`그리기 코드는 ${VIEW_CODE_MAX.toLocaleString()}자까지입니다.`);
  if (config.css !== undefined && (typeof config.css !== 'string' || config.css.length > VIEW_CSS_MAX)) bad(`꾸밈(CSS)은 ${VIEW_CSS_MAX.toLocaleString()}자까지입니다.`);
  // 스티커로 접기: 접힘 여부와 펼칠 때 돌아갈 크기
  if (config.collapsed !== undefined && typeof config.collapsed !== 'boolean') bad('접기 값이 잘못됐습니다.');
  if (config.expanded_layout !== undefined) config = { ...config, expanded_layout: checkLayout(config.expanded_layout) };
  // 수업 자료 블록의 링크(https 만, 30개까지 — @jarvis/shared links.ts)
  if (config.items !== undefined) {
    const checked = checkLinkItems(config.items);
    if (!checked.ok) bad(checked.error);
    config = { ...config, items: checked.items };
  }
  return config.data === undefined ? config : { ...config, data: readViewData(config.data) };
}

/** 보드와 블록. MVP는 보드가 1개다. */
@Controller()
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  /** id 자리에는 보드 ID 또는 current를 쓴다. */
  private async check(userId: string, id: string): Promise<void> {
    if (id !== 'current' && uuid(id) !== (await this.boards.currentBoard(userId)).id) notFound('보드');
  }

  @Get('boards/:id')
  async board(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<BoardDto> {
    await this.check(ctx.user.id, id);
    return this.boards.getBoard(ctx.user.id);
  }

  /** 보드 꾸미기(바탕색). */
  @Patch('boards/:id/theme')
  async theme(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<BoardTheme> {
    await this.check(ctx.user.id, id);
    return this.boards.setTheme(ctx.user.id, {
      bg: oneOf(body?.bg, '바탕색', BOARD_BGS),
    });
  }

  /** 블록 위치·크기·고정을 한 번에 저장한다. 화면은 변경 1초 뒤에 부른다(BRD-4). */
  @Put('boards/:id/layout')
  async layout(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<{ ok: true }> {
    await this.check(ctx.user.id, id);
    if (!Array.isArray(body?.blocks) || body.blocks.length > 200) bad('blocks가 잘못됐습니다.');
    await this.boards.saveLayout(
      ctx.user.id,
      body.blocks.map((b: any) => ({
        id: uuid(b?.id),
        layout_lg: b.layout_lg,
        layout_sm: b.layout_sm,
        pinned: typeof b.pinned === 'boolean' ? b.pinned : undefined,
      })),
    );
    return { ok: true };
  }

  @Post('blocks')
  create(@Auth() ctx: AuthCtx, @Body() body: any): Promise<BlockDto> {
    return this.boards.createBlock(ctx.user.id, {
      type: oneOf(body?.type, '블록 종류', BLOCK_TYPES),
      title: optStr(body?.title, '제목', { max: 60 }),
      config: body?.config === undefined ? undefined : checkConfig(obj(body.config, 'config')),
      source_table_id: body?.source_table_id ? uuid(body.source_table_id, 'source_table_id') : null,
      layout_lg: body?.layout_lg,
    });
  }

  @Patch('blocks/:id')
  async update(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<BlockDto> {
    // 수업 자료 목록은 읽었던 목록(items_base)과 견주어 저장한다
    if (typeof body?.items_base === 'string' && body?.title === undefined && body?.config && typeof body.config === 'object' && Object.keys(body.config).join() === 'items') {
      const cfg = checkConfig(obj(body.config, 'config'))!;
      return (await this.boards.updateLinks(ctx.user.id, uuid(id), cfg.items, body.items_base)) ?? notFound('블록');
    }
    const block = await this.boards.updateBlock(ctx.user.id, uuid(id), {
      title: optStr(body?.title, '제목', { max: 60 }),
      config: body?.config === undefined ? undefined : checkConfig(obj(body.config, 'config')),
      pinned: typeof body?.pinned === 'boolean' ? body.pinned : undefined,
      layout_lg: body?.layout_lg,
    });
    return block ?? notFound('블록');
  }

  /** AI 화면 블록의 바깥 틀(스크립트 없는 빈 문서). 보드가 이 주소를 iframe 으로 품는다. */
  @Get('blocks/:id/frame')
  async frame(@Auth() ctx: AuthCtx, @Param('id') id: string, @Query('rev') rev: string | undefined, @Res() res: Response): Promise<void> {
    const block = await this.boards.getBlock(ctx.user.id, uuid(id));
    if (!block || block.type !== 'view') notFound('블록');
    sendHtml(res, frameDocument(block!.id, rev), frameCsp(new URL(config.publicUrl).origin));
  }

  /** AI 화면 블록의 안쪽 틀. AI가 쓴 그리기 코드를 격리된 문서 안의 일꾼에서 돌린다(가두는 방법은 view-frame.ts). */
  @Get('blocks/:id/view')
  async view(@Auth() ctx: AuthCtx, @Param('id') id: string, @Res() res: Response): Promise<void> {
    const block = await this.boards.getBlock(ctx.user.id, uuid(id));
    if (!block || block.type !== 'view') notFound('블록');
    const origin = new URL(config.publicUrl).origin;
    const nonce = newNonce();
    const source = {
      code: typeof block!.config.code === 'string' ? block!.config.code : '',
      css: typeof block!.config.css === 'string' ? block!.config.css : '',
    };
    // 문서에는 그리기 코드와 글꼴만 들어 있고 자료는 없다. 주소의 rev 가 코드마다 달라서, 이 브라우저 안에서는 한동안 다시 받지 않게 한다
    // (글꼴을 문서 안에 넣어 문서가 크다).
    sendHtml(res, viewDocument(source, nonce, embeddedFontCss(join(config.webDist, 'fonts'))), viewCsp(origin, nonce), { ...VIEW_EXTRA_HEADERS, 'Cache-Control': 'private, max-age=3600' });
  }

  @Delete('blocks/:id')
  async remove(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ ok: true }> {
    if (!(await this.boards.deleteBlock(ctx.user.id, uuid(id)))) notFound('블록');
    return { ok: true };
  }
}

@Controller()
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get('tasks')
  tasks(@Auth() ctx: AuthCtx): Promise<TaskDto[]> {
    return this.items.listTasks(ctx.user.id);
  }

  @Post('tasks')
  createTask(@Auth() ctx: AuthCtx, @Body() body: any): Promise<TaskDto> {
    return this.items.createTask(ctx.user.id, {
      title: str(body?.title, '제목', { max: 200 }),
      due_at: isoOrNull(body.due_at, '마감'),
    });
  }

  @Patch('tasks/:id')
  async updateTask(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<TaskDto> {
    const task = await this.items.updateTask(ctx.user.id, uuid(id), {
      title: body?.title === undefined ? undefined : str(body.title, '제목', { max: 200 }),
      due_at: body?.due_at === undefined ? undefined : isoOrNull(body.due_at, '마감'),
      status: body?.status === undefined ? undefined : oneOf(body.status, '상태', ['open', 'done'] as const),
      note: optStr(body?.note, '메모', { max: 20000 }),
    });
    return task ?? notFound('할 일');
  }

  @Delete('tasks/:id')
  async deleteTask(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ ok: true }> {
    if (!(await this.items.deleteTask(ctx.user.id, uuid(id)))) notFound('할 일');
    return { ok: true };
  }

  /** 기간(from·to)을 주지 않으면 오늘 일정. */
  @Get('events')
  events(@Auth() ctx: AuthCtx, @Query('from') from?: string, @Query('to') to?: string): Promise<EventDto[]> {
    return this.items.listEvents(ctx.user.id, ctx.user.timezone, isoOrNull(from, 'from'), isoOrNull(to, 'to'));
  }

  @Post('events')
  createEvent(@Auth() ctx: AuthCtx, @Body() body: any): Promise<EventDto> {
    const start = isoOrNull(body?.start_at, '시작');
    if (!start) bad('시작 시각이 필요합니다.');
    return this.items.createEvent(ctx.user.id, {
      title: str(body?.title, '제목', { max: 200 }),
      start_at: start!,
      end_at: isoOrNull(body?.end_at, '끝'),
    });
  }

  @Patch('events/:id')
  async updateEvent(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<EventDto> {
    const event = await this.items.updateEvent(ctx.user.id, uuid(id), {
      title: body?.title === undefined ? undefined : str(body.title, '제목', { max: 200 }),
      start_at: body?.start_at === undefined ? undefined : (isoOrNull(body.start_at, '시작') ?? bad('시작 시각이 필요합니다.')),
      end_at: body?.end_at === undefined ? undefined : isoOrNull(body.end_at, '끝'),
    });
    return event ?? notFound('일정');
  }

  @Delete('events/:id')
  async deleteEvent(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ ok: true }> {
    if (!(await this.items.deleteEvent(ctx.user.id, uuid(id)))) notFound('일정');
    return { ok: true };
  }
}
