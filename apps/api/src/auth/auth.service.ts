import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { PIN_MAX_FAILS, type AuthStatus, type SessionDto } from '@jarvis/shared';
import * as argon2 from 'argon2';
import type { Request, Response } from 'express';
import { Audit } from '../common/audit.service';
import { randomToken, safeEqual, sha256 } from '../common/crypto';
import { config } from '../config';
import { Db } from '../db/db.service';
import { CSRF_COOKIE, PASSWORD_MAX, PASSWORD_MIN, PIN_RE, SID_COOKIE, type AuthCtx, type UserRow } from './auth.types';
import { deviceName, isIdleLocked, pinFailure, secondsLeft } from './lock';

/** 암호를 5번 틀리면 15분 막는다(PIN과 같은 값, 따로 센다). */
const PASSWORD_MAX_FAILS = 5;
const PASSWORD_LOCK_MS = 15 * 60_000;
const BAD_LOGIN = '이메일 또는 암호가 맞지 않습니다. 여러 번 틀렸다면 15분 뒤에 다시 해 주세요.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly audit: Audit,
  ) {}

  /** 쿠키로 세션을 찾고 잠금 상태를 서버 기준으로 판정한다(AUTH-5). */
  async load(req: Request): Promise<AuthCtx | null> {
    const token = req.cookies?.[SID_COOKIE];
    if (typeof token !== 'string' || token.length < 20) return null;
    const row = await this.db.one(
      `select s.id as session_id, s.locked, s.last_active_at, s.device_name, s.created_at as session_created_at, u.*
         from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`,
      [sha256(token)],
    );
    if (!row) return null;
    let locked: boolean = row.locked;
    if (!locked && isIdleLocked(row.last_active_at, row.lock_minutes, new Date())) {
      await this.db.query('update sessions set locked = true where id = $1', [row.session_id]);
      locked = true;
    }
    return {
      user: row as UserRow,
      session: {
        id: row.session_id,
        user_id: row.id,
        device_name: row.device_name,
        locked,
        last_active_at: row.last_active_at,
        created_at: row.session_created_at,
      },
      locked,
      ip: req.ip ?? '',
    };
  }

  /** 새 세션은 잠긴 상태로 시작한다. 로그아웃 후 Google 재로그인만으로는 들어올 수 없다(AUTH-6). */
  async createSession(userId: string, req: Request, res: Response): Promise<void> {
    const token = randomToken(32);
    const ua = String(req.headers['user-agent'] ?? '').slice(0, 300);
    await this.db.query(
      `insert into sessions(token_hash, user_id, device_name, user_agent, locked, expires_at)
       values ($1, $2, $3, $4, true, now() + make_interval(days => $5))`,
      [sha256(token), userId, deviceName(ua), ua, config.sessionDays],
    );
    const maxAge = config.sessionDays * 86_400_000;
    res.cookie(SID_COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/', maxAge });
    res.cookie(CSRF_COOKIE, randomToken(18), { httpOnly: false, secure: config.cookieSecure, sameSite: 'lax', path: '/', maxAge });
  }

  /**
   * 쓰는 동안 로그인을 이어 간다(자동 로그인). 활동이나 잠금 해제가 있을 때마다 세션과 쿠키의 만료를
   * "지금부터 SESSION_DAYS일(기본 30일)"로 다시 늘린다. 활동 신호는 화면이 30초에 한 번 이내로만 보낸다.
   * 그래서 마지막으로 쓴 날부터 SESSION_DAYS일이 지나야 구글 로그인을 다시 묻는다. 화면 잠금(PIN)은 그대로다.
   */
  async renew(ctx: AuthCtx, req: Request, res: Response): Promise<void> {
    const renewed = await this.db.one(
      `update sessions set expires_at = now() + make_interval(days => $2)
        where id = $1 and revoked_at is null and expires_at > now()
        returning id`,
      [ctx.session.id, config.sessionDays],
    );
    const token = req.cookies?.[SID_COOKIE];
    if (!renewed || typeof token !== 'string') return;
    const maxAge = config.sessionDays * 86_400_000;
    res.cookie(SID_COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/', maxAge });
    // 화면이 들고 있는 CSRF 값은 그대로 두고 만료만 늘린다.
    const csrf = req.cookies?.[CSRF_COOKIE];
    if (typeof csrf === 'string') res.cookie(CSRF_COOKIE, csrf, { httpOnly: false, secure: config.cookieSecure, sameSite: 'lax', path: '/', maxAge });
  }

  clearCookies(res: Response): void {
    res.clearCookie(SID_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
  }

  status(ctx: AuthCtx): AuthStatus {
    const u = ctx.user;
    return {
      authenticated: true,
      locked: ctx.locked,
      pin_set: u.pin_hash !== null,
      lock_minutes: u.lock_minutes,
      seconds_left: ctx.locked ? 0 : secondsLeft(ctx.session.last_active_at, u.lock_minutes, new Date()),
      attempts_left: PIN_MAX_FAILS - u.pin_fail_count,
      pin_locked_until: u.pin_locked_until && u.pin_locked_until > new Date() ? u.pin_locked_until.toISOString() : null,
      user: { email: u.email, name: u.name, timezone: u.timezone },
    };
  }

  async hashPin(pin: unknown): Promise<string> {
    if (typeof pin !== 'string' || !PIN_RE.test(pin)) throw new BadRequestException('PIN은 숫자 6자리입니다.');
    return argon2.hash(pin, { type: argon2.argon2id });
  }

  /** 최초 PIN 등록(AUTH-3). PIN이 없는 사용자만 부를 수 있고, 등록하면 이 세션의 잠금을 푼다. */
  async setupPin(ctx: AuthCtx, pin: unknown): Promise<void> {
    if (ctx.user.pin_hash) throw new BadRequestException('PIN이 이미 있습니다. 설정에서 변경하세요.');
    const hash = await this.hashPin(pin);
    const updated = await this.db.query('update users set pin_hash = $2 where id = $1 and pin_hash is null returning id', [ctx.user.id, hash]);
    if (updated.length === 0) throw new BadRequestException('PIN이 이미 있습니다.');
    await this.db.query('update sessions set locked = false, last_active_at = now() where id = $1', [ctx.session.id]);
    await this.audit.log(ctx, 'pin.setup');
  }

  /**
   * PIN 확인. 실패는 사용자 단위로 누적하고, 5회 연속 실패하면 모든 세션을 끝내고 15분 동안 막는다(AUTH-7).
   * 잠금 해제와 보안 설정 변경의 PIN 재입력(ONE-10, USR-6)에 함께 쓴다.
   */
  async verifyPin(ctx: AuthCtx, pin: unknown): Promise<void> {
    const user = await this.db.one<UserRow>('select * from users where id = $1', [ctx.user.id]);
    if (!user?.pin_hash) throw new BadRequestException('PIN이 아직 없습니다.');
    if (user.pin_locked_until && user.pin_locked_until > new Date()) {
      throw new HttpException({ message: 'PIN을 여러 번 틀려 잠시 막혔습니다.', pin_locked_until: user.pin_locked_until.toISOString() }, 429);
    }
    const ok = typeof pin === 'string' && PIN_RE.test(pin) && (await argon2.verify(user.pin_hash, pin));
    if (ok) {
      if (user.pin_fail_count > 0) await this.db.query('update users set pin_fail_count = 0, pin_locked_until = null where id = $1', [user.id]);
      return;
    }
    const counted = await this.db.one<{ pin_fail_count: number }>(
      'update users set pin_fail_count = pin_fail_count + 1 where id = $1 returning pin_fail_count',
      [user.id],
    );
    const outcome = pinFailure(counted?.pin_fail_count ?? PIN_MAX_FAILS, new Date());
    await this.audit.log(ctx, 'pin.fail');
    if (outcome.revokeAll) {
      await this.db.query('update users set pin_fail_count = 0, pin_locked_until = $2 where id = $1', [user.id, outcome.lockedUntil]);
      await this.revokeAll(user.id);
      throw new HttpException({ message: 'PIN을 5번 틀려 모든 기기에서 로그아웃했습니다. 15분 뒤에 다시 시도하세요.', revoked: true }, 401);
    }
    throw new HttpException({ message: 'PIN이 맞지 않습니다.', attempts_left: outcome.attemptsLeft }, 403);
  }

  async unlock(ctx: AuthCtx, pin: unknown): Promise<void> {
    await this.verifyPin(ctx, pin);
    await this.db.query('update sessions set locked = false, last_active_at = now() where id = $1', [ctx.session.id]);
  }

  async lock(sessionId: string): Promise<void> {
    await this.db.query('update sessions set locked = true where id = $1', [sessionId]);
  }

  /** 활동 신호(AUTH-5). 입력이 있었을 때만 화면이 보내며, last_active_at은 여기서만 갱신한다. */
  async touch(sessionId: string): Promise<void> {
    await this.db.query('update sessions set last_active_at = now() where id = $1 and locked = false', [sessionId]);
  }

  async revoke(userId: string, sessionId: string): Promise<boolean> {
    const rows = await this.db.query('update sessions set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null returning id', [
      sessionId,
      userId,
    ]);
    return rows.length > 0;
  }

  async revokeAll(userId: string, exceptSessionId?: string): Promise<void> {
    await this.db.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null and id is distinct from $2', [
      userId,
      exceptSessionId ?? null,
    ]);
  }

  async listSessions(ctx: AuthCtx): Promise<SessionDto[]> {
    const rows = await this.db.query(
      `select id, device_name, last_active_at, created_at, locked from sessions
        where user_id = $1 and revoked_at is null and expires_at > now() order by last_active_at desc`,
      [ctx.user.id],
    );
    return rows.map((r) => ({ ...r, current: r.id === ctx.session.id }));
  }

  /** 허용 목록에 있는 이메일만 통과시키고(AUTH-1), 처음이면 사용자를 만든다. */
  async findOrCreateUser(email: string, name: string): Promise<string | null> {
    const lower = email.toLowerCase();
    const allowed = await this.db.one('select 1 from allowed_emails where email = $1', [lower]);
    if (!allowed) return null;
    const user = await this.db.one<{ id: string }>(
      `insert into users(email, name) values ($1, $2)
       on conflict (email) do update set name = case when users.name = '' then excluded.name else users.name end
       returning id`,
      [lower, name],
    );
    return user!.id;
  }

  // ── 암호 로그인(2026-11-27, 배포판) ─────────────────────────────────────────────

  /** 로그인 전 화면에 알려 줄 것: 로그인 방식과, 암호 방식이면 아직 주인 계정이 없는지. */
  async publicStatus(): Promise<AuthStatus> {
    if (config.loginMode === 'google') return { authenticated: false, login_mode: 'google' };
    return { authenticated: false, login_mode: 'password', setup_needed: !(await this.hasPasswordOwner()) };
  }

  private async hasPasswordOwner(): Promise<boolean> {
    return Boolean(await this.db.one('select 1 from users where password_hash is not null limit 1'));
  }

  private checkPassword(password: unknown): string {
    if (typeof password !== 'string' || [...password].length < PASSWORD_MIN || [...password].length > PASSWORD_MAX) {
      throw new BadRequestException(`암호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자로 정해 주세요.`);
    }
    return password;
  }

  /**
   * 처음 설치: 설치 코드(SETUP_CODE)가 맞으면 주인 계정을 만든다. **계정이 하나라도 있으면 더는 못 한다**(설치 하나 = 사용자 한 명).
   * Google 로그인으로 쓰던 서버를 암호 방식으로 바꿨다면 웹이 아니라 콘솔 `jarvis set-password <email>` 로 암호를 붙인다
   * (설치 코드만으로 남의 계정에 암호를 붙이지 못하게, 2026-11-27 검토). 동시에 두 번 불려도 하나만 되게 잠그고 다시 본다.
   */
  async setupOwner(input: { code?: unknown; email?: unknown; name?: unknown; password?: unknown }): Promise<string> {
    if (config.loginMode !== 'password') throw new BadRequestException('이 서버는 Google 로그인을 씁니다.');
    if (!config.setupCode) throw new BadRequestException('서버에 SETUP_CODE가 없습니다. .env 에 적고 다시 띄우거나, 콘솔에서 jarvis set-password 로 만드세요.');
    if (typeof input.code !== 'string' || !safeEqual(input.code.trim().toUpperCase(), config.setupCode.toUpperCase())) {
      throw new HttpException({ message: '설치 코드가 맞지 않습니다.' }, 403);
    }
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 200) throw new BadRequestException('이메일을 확인해 주세요.');
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 40) : '';
    const hash = await argon2.hash(this.checkPassword(input.password), { type: argon2.argon2id });
    const id = await this.db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock(hashtext($1))', ['ssamboard:setup-owner']);
      const taken = await q.query('select 1 from users limit 1');
      if (taken.length > 0) return null;
      const rows = await q.query<{ id: string }>('insert into users(email, name, password_hash) values ($1, $2, $3) returning id', [email, name, hash]);
      return rows[0]?.id ?? null;
    });
    if (!id) throw new BadRequestException('이미 계정이 있습니다. 로그인하거나, 서버 콘솔에서 jarvis set-password 로 암호를 정해 주세요.');
    return id;
  }

  /**
   * 이메일·암호 확인. 맞으면 사용자 id. 틀린 까닭(없는 이메일·틀린 암호·막힘)을 응답으로 구별하지 않고, 없는 이메일도
   * 같은 시간이 걸리게 가짜 해시를 견준다. 같은 사용자의 시도는 행을 잠가 한 줄로 세운다 — 동시에 보내 5번 제한을 넘지 못하게.
   */
  async loginPassword(emailInput: unknown, password: unknown): Promise<string> {
    if (config.loginMode !== 'password') throw new BadRequestException('이 서버는 Google 로그인을 씁니다.');
    const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase().slice(0, 200) : '';
    const pw = typeof password === 'string' && [...password].length <= PASSWORD_MAX ? password : '';
    const result = await this.db.tx(async (q) => {
      const [user] = email ? await q.query<UserRow>('select * from users where email = $1 for update', [email]) : [];
      const locked = Boolean(user?.password_locked_until && user.password_locked_until > new Date());
      if (!user?.password_hash || locked || !pw) {
        await argon2.verify(await dummyHash(), pw || 'x').catch(() => false);
        return { ok: false as const, userId: user?.id };
      }
      if (await argon2.verify(user.password_hash, pw).catch(() => false)) {
        if (user.password_fail_count > 0) await q.query('update users set password_fail_count = 0, password_locked_until = null where id = $1', [user.id]);
        return { ok: true as const, userId: user.id };
      }
      const fails = user.password_fail_count + 1;
      await q.query(
        'update users set password_fail_count = $2, password_locked_until = $3 where id = $1',
        fails >= PASSWORD_MAX_FAILS ? [user.id, 0, new Date(Date.now() + PASSWORD_LOCK_MS)] : [user.id, fails, null],
      );
      return { ok: false as const, userId: user.id };
    });
    if (result.ok) return result.userId;
    await this.audit.log({ ip: '', ...(result.userId ? { user: { id: result.userId } } : {}) }, 'login.fail');
    throw new HttpException({ message: BAD_LOGIN }, 401);
  }
}

let dummy: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummy ??= argon2.hash('ssamboard-timing-dummy', { type: argon2.argon2id });
  return dummy;
}
