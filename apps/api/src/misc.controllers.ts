import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LOCK_MINUTE_OPTIONS, TRASH_DAYS, type CommandDto, type NotificationDto, type SettingsDto, type TrashItem } from '@jarvis/shared';
import type { Response } from 'express';
import { AiService } from './ai/ai.service';
import { CommandsService } from './ai/commands.service';
import { AuthService } from './auth/auth.service';
import { Auth, Public, type AuthCtx } from './auth/auth.types';
import { Audit } from './common/audit.service';
import { bad, notFound, obj, oneOf, str, uuid } from './common/http';
import { Db } from './db/db.service';
import { LlmService } from './llm/llm.service';
import { MODELS, PROVIDERS } from './llm/pricing';
import { NotificationsService } from './notifications/notifications.service';
import { UploadsService, type UploadPreview, type UploadSuggestion } from './uploads/uploads.service';

@Controller()
export class HealthController {
  constructor(private readonly db: Db) {}

  /** 헬스체크(5장 가용성). DB까지 닿는지 확인한다. */
  @Public()
  @Get('health')
  async health(): Promise<{ ok: true }> {
    await this.db.query('select 1');
    return { ok: true };
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Auth() ctx: AuthCtx, @Query('status') status?: string): Promise<NotificationDto[]> {
    return this.notifications.list(ctx.user.id, status === undefined ? undefined : oneOf(status, 'status', ['unread', 'read', 'archived'] as const));
  }

  @Post('read-all')
  async readAll(@Auth() ctx: AuthCtx): Promise<{ ok: true }> {
    await this.notifications.markAllRead(ctx.user.id);
    return { ok: true };
  }

  @Patch(':id')
  async update(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<{ ok: true }> {
    const changed = await this.notifications.setStatus(ctx.user.id, [uuid(id)], oneOf(body?.status, 'status', ['unread', 'read', 'archived'] as const));
    if (changed === 0) notFound('알림');
    return { ok: true };
  }
}

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
    private readonly llm: LlmService,
    private readonly audit: Audit,
  ) {}

  @Get()
  async get(@Auth() ctx: AuthCtx): Promise<SettingsDto> {
    const u = ctx.user;
    return {
      timezone: u.timezone,
      monthly_budget: Number(u.monthly_budget),
      llm_provider: u.llm_provider,
      llm_model: u.llm_model,
      lock_minutes: u.lock_minutes,
      models: MODELS.map(({ id, provider, label, input, output }) => ({
        id,
        provider,
        label,
        input,
        output,
      })),
      providers: PROVIDERS,
      api_keys: await this.llm.keys(u.id),
      month_cost: await this.llm.monthCost(u),
      usage: await this.llm.usage(u),
      onboarded: Boolean(u.onboarded_at),
    };
  }

  /** 일반 설정: 시간대·비용 한도·모델(USR-6). */
  @Put()
  async update(@Auth() ctx: AuthCtx, @Body() body: any): Promise<{ ok: true }> {
    const patch: {
      timezone?: string;
      monthly_budget?: number;
      llm_model?: string;
      llm_provider?: string;
    } = {};
    if (body?.timezone !== undefined) {
      const tz = str(body.timezone, '시간대', { max: 60 });
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
      } catch {
        bad('알 수 없는 시간대입니다.');
      }
      patch.timezone = tz;
    }
    if (body?.monthly_budget !== undefined) {
      const n = Number(body.monthly_budget);
      if (!Number.isFinite(n) || n < 0 || n > 10_000) bad('비용 한도는 0~10,000달러 사이여야 합니다.');
      patch.monthly_budget = Math.round(n * 100) / 100;
    }
    // 처음 접속 안내: true 면 마침(다시 뜨지 않음), false 면 다시 보기
    if (body?.onboarded !== undefined) {
      await this.db.query('update users set onboarded_at = case when $2 then coalesce(onboarded_at, now()) else null end where id = $1', [ctx.user.id, body.onboarded === true]);
    }
    if (body?.llm_model !== undefined) {
      // 모델을 고르면 제공자(Claude·GPT)도 그 모델 것으로 바뀐다.
      const m = MODELS.find((x) => x.id === body.llm_model);
      if (!m) bad('고를 수 없는 모델입니다.');
      patch.llm_model = m!.id;
      patch.llm_provider = m!.provider;
    }
    await this.db.query(
      'update users set timezone = coalesce($2, timezone), monthly_budget = coalesce($3, monthly_budget), llm_model = coalesce($4, llm_model), llm_provider = coalesce($5, llm_provider) where id = $1',
      [ctx.user.id, patch.timezone ?? null, patch.monthly_budget ?? null, patch.llm_model ?? null, patch.llm_provider ?? null],
    );
    return { ok: true };
  }

  /** 보안 설정: 잠금 시간·잠금 끄기·PIN. PIN을 다시 입력해야 바꿀 수 있다(ONE-10, USR-6). */
  @Put('security')
  async security(@Auth() ctx: AuthCtx, @Body() body: any): Promise<{ ok: true }> {
    await this.auth.verifyPin(ctx, body?.pin);
    if (body?.lock_minutes !== undefined) {
      if (!LOCK_MINUTE_OPTIONS.includes(body.lock_minutes)) bad(`잠금 시간은 ${LOCK_MINUTE_OPTIONS.join(', ')}분 중 하나입니다(0은 끄기).`);
      await this.db.query('update users set lock_minutes = $2 where id = $1', [ctx.user.id, body.lock_minutes]);
      await this.audit.log(ctx, 'settings.lock_minutes', String(body.lock_minutes));
    }
    if (body?.new_pin !== undefined) {
      await this.db.query('update users set pin_hash = $2, pin_fail_count = 0, pin_locked_until = null where id = $1', [ctx.user.id, await this.auth.hashPin(body.new_pin)]);
      await this.auth.revokeAll(ctx.user.id, ctx.session.id);
      await this.audit.log(ctx, 'pin.change');
    }
    return { ok: true };
  }

  /** API 키 등록·변경. PIN 재입력이 필요하고, 키는 암호화해 서버에만 둔다(USR-2a). */
  @Put('api-keys/:provider')
  async apiKey(@Auth() ctx: AuthCtx, @Param('provider') provider: string, @Body() body: any): Promise<{ ok: true }> {
    await this.auth.verifyPin(ctx, body?.pin);
    await this.llm.saveKey(ctx.user.id, provider, str(body?.key, 'API 키', { max: 300 }));
    await this.audit.log(ctx, 'api_key.change', provider);
    return { ok: true };
  }
}

@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly commands: CommandsService,
    private readonly audit: Audit,
  ) {}

  /** AI 창 입력. 응답은 SSE로 흘려보낸다(ONE-8): text · tool · plan · error · done 이벤트. */
  @Post('messages')
  async messages(@Auth() ctx: AuthCtx, @Body() body: any, @Res() res: Response): Promise<void> {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    const emit = (event: unknown) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      await this.ai.run(ctx.user, obj(body, '요청'), emit, abort.signal);
    } catch (e: any) {
      if (!abort.signal.aborted)
        emit({
          type: 'error',
          message: String(e?.response?.message ?? e?.message ?? '요청을 처리하지 못했습니다.').slice(0, 300),
        });
    } finally {
      res.end();
    }
  }

  /** 처리 결과함 */
  @Get('commands')
  commandList(@Auth() ctx: AuthCtx): Promise<CommandDto[]> {
    return this.commands.list(ctx.user.id);
  }

  @Get('commands/:id')
  command(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<CommandDto> {
    return this.commands.get(ctx.user.id, uuid(id));
  }

  /** 계획 승인·적용(ONE-5). edits로 표 미리보기에서 고친 이름·컬럼을 넘길 수 있다. */
  @Post('commands/:id/apply')
  async apply(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<CommandDto> {
    const result = await this.commands.apply(ctx.user, uuid(id), body?.edits && typeof body.edits === 'object' ? body.edits : {});
    await this.audit.log(ctx, 'ai.apply', id);
    return result;
  }

  @Post('commands/:id/undo')
  async undo(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<CommandDto> {
    const result = await this.commands.undo(ctx.user, uuid(id));
    await this.audit.log(ctx, 'ai.undo', id);
    return result;
  }

  @Post('commands/:id/cancel')
  cancel(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<CommandDto> {
    return this.commands.cancel(ctx.user.id, uuid(id));
  }
}

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** CSV·XLSX 업로드(최대 10MB). 서버가 파싱해 미리보기를 돌려준다. 저장은 아직 하지 않는다. */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  upload(@Auth() ctx: AuthCtx, @UploadedFile() file: Express.Multer.File | undefined): Promise<UploadPreview> {
    if (!file) bad('파일이 없습니다.');
    return this.uploads.save(ctx.user.id, file!);
  }

  @Post(':id/suggest')
  suggest(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<UploadSuggestion> {
    return this.uploads.suggest(ctx.user, uuid(id));
  }
}

const TRASH_TABLES = ['blocks', 'data_tables', 'data_rows', 'tasks', 'events'] as const;

/** 휴지통(5장). 삭제한 블록·표·행·할 일·일정을 30일 동안 두었다가 워커가 완전히 지운다. */
@Controller('trash')
export class TrashController {
  constructor(private readonly db: Db) {}

  @Get()
  list(@Auth() ctx: AuthCtx): Promise<TrashItem[]> {
    return this.db.query<TrashItem>(
      `select kind, id, title, deleted_at from (
         select 'blocks' as kind, id, title, deleted_at, user_id from blocks
         union all select 'data_tables', id, name, deleted_at, user_id from data_tables
         union all select 'data_rows', r.id, t.name || ' · 행 1개', r.deleted_at, r.user_id
                     from data_rows r join data_tables t on t.id = r.table_id where r.deleted_at is not null and t.deleted_at is null
         union all select 'tasks', id, title, deleted_at, user_id from tasks
         union all select 'events', id, title, deleted_at, user_id from events
       ) t where user_id = $1 and deleted_at is not null and deleted_at > now() - make_interval(days => $2)
       order by deleted_at desc limit 200`,
      [ctx.user.id, TRASH_DAYS],
    );
  }

  /** 복구. id는 UUID라 종류를 따로 받지 않고 다섯 테이블에서 찾는다. */
  @Post(':id/restore')
  async restore(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ ok: true; kind: string }> {
    for (const table of TRASH_TABLES) {
      // 지운 표에 든 줄만 따로 되살리지 않는다(표를 먼저 되살린다 — 제미나이 검토)
      const parentOk = table === 'data_rows' ? ' and exists (select 1 from data_tables t where t.id = data_rows.table_id and t.deleted_at is null)' : '';
      const rows = await this.db.query(`update ${table} set deleted_at = null, updated_at = now() where id = $1 and user_id = $2 and deleted_at is not null${parentOk} returning id`, [
        uuid(id),
        ctx.user.id,
      ]);
      if (rows.length > 0) return { ok: true, kind: table };
    }
    return notFound('휴지통 항목');
  }

  /** 지금 완전히 지운다. */
  @Delete(':id')
  async purge(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ ok: true }> {
    for (const table of TRASH_TABLES) {
      const rows = await this.db.query(`delete from ${table} where id = $1 and user_id = $2 and deleted_at is not null returning id`, [uuid(id), ctx.user.id]);
      if (rows.length > 0) return { ok: true };
    }
    return notFound('휴지통 항목');
  }
}
