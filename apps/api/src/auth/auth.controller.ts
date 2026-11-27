import { Body, Controller, Delete, Get, HttpException, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { AuthStatus, SessionDto } from '@jarvis/shared';
import type { Request, Response } from 'express';
import { Audit } from '../common/audit.service';
import { randomToken } from '../common/crypto';
import { notFound, uuid } from '../common/http';
import { RateLimiter } from '../common/rate-limit';
import { config } from '../config';
import { AuthService } from './auth.service';
import { AllowLocked, Auth, OAUTH_COOKIE, Public, type AuthCtx } from './auth.types';
import { GoogleService } from './google.service';

const loginLimiter = new RateLimiter(20, 60_000);
const pinLimiter = new RateLimiter(20, 60_000);

/**
 * 세션 없이 받는 POST(처음 설치·로그인)는 JSON 본문만 받는다. 다른 사이트의 폼(urlencoded)이 로그인을 대신 보내지 못하게 —
 * 다른 사이트가 JSON 을 보내려면 브라우저가 먼저 허락(CORS)을 묻고, 이 서버는 허락하지 않는다(2026-11-27 검토).
 */
function jsonOnly(req: Request): void {
  if (!req.is('application/json')) throw new HttpException({ message: 'JSON 요청만 받습니다.' }, 415);
}

function limit(limiter: RateLimiter, key: string): void {
  if (!limiter.allow(key)) throw new HttpException({ message: '요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.' }, 429);
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleService,
    private readonly audit: Audit,
  ) {}

  /** 처음 설치: 설치 코드로 주인 계정을 만들고 바로 로그인한다(암호 방식). 새 세션은 잠긴 채 시작해 PIN 등록으로 이어진다. */
  @Public()
  @Post('setup')
  async setup(@Body() body: { code?: string; email?: string; name?: string; password?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    jsonOnly(req);
    limit(loginLimiter, req.ip ?? '');
    const userId = await this.auth.setupOwner(body ?? {});
    await this.auth.createSession(userId, req, res);
    await this.audit.log({ ip: req.ip ?? '', user: { id: userId } }, 'setup.owner');
    return { ok: true };
  }

  /** 이메일·암호 로그인(암호 방식). 맞으면 잠긴 세션을 만든다 — PIN을 넣어야 보드가 열린다. */
  @Public()
  @Post('login')
  async login(@Body() body: { email?: string; password?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    jsonOnly(req);
    limit(loginLimiter, req.ip ?? '');
    const userId = await this.auth.loginPassword(body?.email, body?.password);
    await this.auth.createSession(userId, req, res);
    await this.audit.log({ ip: req.ip ?? '', user: { id: userId } }, 'login');
    return { ok: true };
  }

  @Public()
  @Get('google')
  start(@Req() req: Request, @Res() res: Response): void {
    limit(loginLimiter, req.ip ?? '');
    if (config.loginMode !== 'google') return res.redirect('/?login=failed');
    const nonce = randomToken(16);
    res.cookie(OAUTH_COOKIE, nonce, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/', maxAge: 600_000 });
    res.redirect(this.google.loginUrl(this.google.state({ kind: 'login', nonce })));
  }

  @Public()
  @Get('google/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    limit(loginLimiter, req.ip ?? '');
    if (config.loginMode !== 'google') return res.redirect('/?login=failed');
    const parsed = this.google.readState(state);
    const nonce = req.cookies?.[OAUTH_COOKIE];
    res.clearCookie(OAUTH_COOKIE, { path: '/' });
    if (!code || !parsed || parsed.kind !== 'login' || !nonce || parsed.nonce !== nonce) return res.redirect('/?login=failed');
    const identity = await this.google.exchangeLogin(code).catch(() => null);
    const userId = identity ? await this.auth.findOrCreateUser(identity.email, identity.name) : null;
    if (!identity || !userId) {
      await this.audit.log({ ip: req.ip ?? '' }, 'login.denied', identity?.email ?? '');
      return res.redirect('/?login=denied');
    }
    await this.auth.createSession(userId, req, res);
    await this.audit.log({ ip: req.ip ?? '', user: { id: userId } }, 'login');
    res.redirect('/');
  }

  @Public()
  @Get('status')
  async status(@Auth() ctx: AuthCtx | undefined): Promise<AuthStatus> {
    return ctx ? this.auth.status(ctx) : this.auth.publicStatus();
  }

  @AllowLocked()
  @Post('pin/setup')
  async setupPin(@Auth() ctx: AuthCtx, @Body() body: { pin?: string }): Promise<{ ok: true }> {
    await this.auth.setupPin(ctx, body?.pin);
    return { ok: true };
  }

  @Post('activity')
  async activity(@Auth() ctx: AuthCtx, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    await this.auth.touch(ctx.session.id);
    await this.auth.renew(ctx, req, res);
    return { ok: true };
  }

  @Post('lock')
  async lock(@Auth() ctx: AuthCtx): Promise<{ ok: true }> {
    await this.auth.lock(ctx.session.id);
    return { ok: true };
  }

  @AllowLocked()
  @Post('unlock')
  async unlock(@Auth() ctx: AuthCtx, @Body() body: { pin?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    limit(pinLimiter, req.ip ?? '');
    try {
      await this.auth.unlock(ctx, body?.pin);
      await this.auth.renew(ctx, req, res);
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === 401) this.auth.clearCookies(res);
      throw e;
    }
    return { ok: true };
  }

  @AllowLocked()
  @Post('logout')
  async logout(@Auth() ctx: AuthCtx, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    await this.auth.revoke(ctx.user.id, ctx.session.id);
    this.auth.clearCookies(res);
    await this.audit.log(ctx, 'logout');
    return { ok: true };
  }
}

/** 기기 목록과 원격 로그아웃(AUTH-9). */
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: Audit,
  ) {}

  @Get()
  list(@Auth() ctx: AuthCtx): Promise<SessionDto[]> {
    return this.auth.listSessions(ctx);
  }

  @Delete(':id')
  async revoke(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ ok: true }> {
    if (!(await this.auth.revoke(ctx.user.id, uuid(id)))) notFound('기기');
    await this.audit.log(ctx, 'session.revoke', id);
    return { ok: true };
  }
}
