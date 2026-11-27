import { Injectable } from '@nestjs/common';
import type { AuthCtx } from '../auth/auth.types';
import { Db } from '../db/db.service';

/** 감사 로그(5장 로그). 프롬프트 원문·API 키·토큰은 기록하지 않는다. */
@Injectable()
export class Audit {
  constructor(private readonly db: Db) {}

  async log(ctx: Pick<AuthCtx, 'ip'> & { user?: { id: string }; session?: { id: string } }, action: string, target = ''): Promise<void> {
    await this.db
      .query('insert into audit_logs(user_id, session_id, action, target, ip) values ($1, $2, $3, $4, $5)', [
        ctx.user?.id ?? null,
        ctx.session?.id ?? null,
        action,
        target.slice(0, 200),
        ctx.ip ?? '',
      ])
      .catch(() => undefined);
  }
}
