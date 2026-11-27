import { Body, Controller, Delete, Get, HttpCode, HttpException, Param, Post, Query, Req, Res } from '@nestjs/common';
import { PRIORITY_LABEL, type ConnectorDto, type Priority, type TableDto } from '@jarvis/shared';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { AllowLocked, Auth, OAUTH_COOKIE, Public, type AuthCtx } from '../auth/auth.types';
import { DRIVE_FILE_SCOPE, GoogleService } from '../auth/google.service';
import { Audit } from '../common/audit.service';
import { hmac, randomToken, safeEqual, sha256 } from '../common/crypto';
import { bad, notFound, oneOf, str, uuid } from '../common/http';
import { RateLimiter } from '../common/rate-limit';
import { config, googleConfigured } from '../config';
import { NotificationsService } from '../notifications/notifications.service';
import { checkColumnDefs } from '../tables/tables.service';
import { ConnectorsService } from './connectors.service';

@Controller('connectors')
export class ConnectorsController {
  constructor(
    private readonly connectors: ConnectorsService,
    private readonly google: GoogleService,
    private readonly auth: AuthService,
    private readonly audit: Audit,
  ) {}

  @Get()
  list(@Auth() ctx: AuthCtx): Promise<ConnectorDto[]> {
    return this.connectors.list(ctx.user.id);
  }

  /**
   * 커넥터 추가(CON-1). 권한 범위가 바뀌는 일이라 PIN을 다시 받는다(ONE-10).
   * google_sheets는 Google 동의 화면 주소를 돌려주고, webhook은 비밀 URL과 서명 키를 한 번만 돌려준다.
   */
  @Post()
  async create(@Auth() ctx: AuthCtx, @Body() body: any, @Res({ passthrough: true }) res: Response): Promise<Record<string, unknown>> {
    const type = oneOf(body?.type, '종류', ['google_sheets', 'webhook'] as const);
    await this.auth.verifyPin(ctx, body?.pin);
    if (type === 'webhook') {
      const created = await this.connectors.createWebhook(ctx.user.id, str(body.name, '이름', { max: 40 }));
      await this.audit.log(ctx, 'connector.add', `webhook:${created.connector.id}`);
      return created;
    }
    if (!googleConfigured()) bad('이 서버에는 Google 연결이 설정돼 있지 않습니다. .env 에 GOOGLE_CLIENT_ID·GOOGLE_CLIENT_SECRET을 넣고 다시 띄워 주세요(README의 "Google 시트 연결").');
    const nonce = randomToken(16);
    res.cookie(OAUTH_COOKIE, nonce, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/', maxAge: 600_000 });
    return { url: this.google.connectorUrl(this.google.state({ kind: 'connector', nonce, user_id: ctx.user.id }), [DRIVE_FILE_SCOPE]) };
  }

  /**
   * Google 동의 뒤 돌아오는 주소. 세션·state·쿠키의 nonce가 모두 맞아야 토큰을 저장한다.
   * 동의하는 사이에 화면이 잠겼어도 받는다(시작할 때 이미 PIN을 확인했다). 돌아가면 잠금 화면이 먼저 뜬다.
   */
  @AllowLocked()
  @Get('google/callback')
  async callback(@Auth() ctx: AuthCtx, @Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const parsed = this.google.readState(state);
    const nonce = req.cookies?.[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, { path: '/' });
    if (!code || !parsed || parsed.kind !== 'connector' || parsed.user_id !== ctx.user.id || !nonce || parsed.nonce !== nonce) return res.redirect('/?connect=failed');
    const tokens = await this.google.exchangeConnector(code).catch(() => null);
    if (!tokens) return res.redirect('/?connect=failed');
    try {
      const id = await this.connectors.saveGoogle(ctx.user.id, tokens.refreshToken, tokens.scopes);
      await this.audit.log(ctx, 'connector.add', `google_sheets:${id}`);
      res.redirect('/?connect=ok');
    } catch {
      res.redirect('/?connect=denied');
    }
  }

  @Delete(':id')
  async remove(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<{ ok: true }> {
    await this.auth.verifyPin(ctx, body?.pin);
    if (!(await this.connectors.remove(ctx.user.id, uuid(id)))) notFound('커넥터');
    await this.audit.log(ctx, 'connector.remove', id);
    return { ok: true };
  }

  /** 수동 동기화(GSH-3). */
  @Post(':id/sync')
  sync(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ synced: number; failed: number; structure_changed: number }> {
    return this.connectors.syncConnector(ctx.user.id, uuid(id));
  }

  /** Google Picker를 띄우는 데 필요한 값(짧게 쓰는 액세스 토큰 포함). */
  @Post(':id/picker')
  picker(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ access_token: string; api_key: string; app_id: string }> {
    return this.connectors.pickerConfig(ctx.user.id, uuid(id));
  }

  @Get(':id/sheets/:spreadsheetId')
  tabs(@Auth() ctx: AuthCtx, @Param('id') id: string, @Param('spreadsheetId') spreadsheetId: string): Promise<{ name: string; tabs: { title: string; rows: number; cols: number }[] }> {
    return this.connectors.tabs(ctx.user.id, uuid(id), spreadsheetId);
  }

  @Post('google-sheets/preview')
  preview(@Auth() ctx: AuthCtx, @Body() body: any) {
    return this.connectors.preview(ctx.user.id, { connector_id: uuid(body?.connector_id, 'connector_id'), spreadsheet_id: body.spreadsheet_id, tab: body.tab, range: body.range });
  }

  /** 고른 시트·탭·범위를 가져오기(copy) 또는 연결된 표(linked)로 등록한다. */
  @Post('google-sheets/link')
  link(@Auth() ctx: AuthCtx, @Body() body: any): Promise<{ table: TableDto; failures: Record<string, number> }> {
    return this.connectors.link(ctx.user.id, {
      connector_id: uuid(body?.connector_id, 'connector_id'),
      spreadsheet_id: body.spreadsheet_id,
      tab: body.tab,
      range: body.range,
      mode: oneOf(body.mode, 'mode', ['copy', 'linked'] as const),
      name: typeof body.name === 'string' ? body.name.slice(0, 80) : undefined,
      sync_minutes: body.sync_minutes,
      columns: body.columns === undefined ? undefined : checkColumnDefs(body.columns),
    });
  }

  /** 연결된 표 하나를 지금 새로고침한다. accept_structure가 true면 변경된 시트 구조를 받아들인다(GSH-4). */
  @Post('google-sheets/tables/:tableId/sync')
  syncTable(@Auth() ctx: AuthCtx, @Param('tableId') tableId: string, @Body() body: any) {
    return this.connectors.syncTable(ctx.user.id, uuid(tableId, 'tableId'), body?.accept_structure === true);
  }
}

const webhookLimiter = new RateLimiter(120, 60_000);
const PRIORITIES = Object.keys(PRIORITY_LABEL) as Priority[];

/**
 * 웹훅 수신(CON-6). 세션 없이 들어오므로 두 가지를 모두 확인한다.
 *  1) 주소의 비밀값  2) 본문 서명: X-Jarvis-Signature: sha256=<HMAC-SHA256(원문 본문, 서명 키)의 16진수>
 * 본문(JSON): { "title": "...", "body": "...", "priority": "urgent|normal|info", "dedupe_key": "..." }
 * 본문 내용은 데이터로만 다룬다(CON-4).
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly connectors: ConnectorsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Public()
  @Post(':connectorId/:secret')
  @HttpCode(202)
  async receive(@Param('connectorId') connectorId: string, @Param('secret') secret: string, @Req() req: Request & { rawBody?: Buffer }): Promise<{ ok: true }> {
    if (!webhookLimiter.allow(connectorId)) throw new HttpException({ message: '요청이 너무 많습니다.' }, 429);
    const found = await this.connectors.webhookSecrets(uuid(connectorId, 'connector_id'));
    if (!found || !safeEqual(sha256(secret), found.path_hash)) notFound('웹훅');
    const signature = String(req.headers['x-jarvis-signature'] ?? '').replace(/^sha256=/i, '').toLowerCase();
    const raw = req.rawBody ?? Buffer.alloc(0);
    if (!signature || !safeEqual(signature, hmac(raw, found!.signing_secret))) throw new HttpException({ message: '서명이 맞지 않습니다.' }, 401);

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.title !== 'string' || !body.title.trim()) bad('title이 필요합니다.');
    await this.notifications.notify(found!.user_id, {
      source: 'webhook',
      connector_id: connectorId,
      title: `${found!.name}: ${(body.title as string).trim()}`,
      body: typeof body.body === 'string' ? body.body : '',
      priority: PRIORITIES.includes(body.priority as Priority) ? (body.priority as Priority) : 'normal',
      dedupe_key: typeof body.dedupe_key === 'string' && body.dedupe_key ? `webhook:${connectorId}:${body.dedupe_key.slice(0, 100)}` : null,
    });
    await this.connectors.touch(connectorId);
    return { ok: true };
  }
}
