import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { Auth, type AuthCtx } from '../auth/auth.types';
import { Audit } from '../common/audit.service';
import { bad } from '../common/http';
import { Db } from '../db/db.service';
import { exportSnapshot, importData, type SyncData } from './transfer';

/**
 * 보드 자료 내보내기·가져오기(두 트랙 공통 파일 — 구글 드라이브 트랙의 설정 → 드라이브와 같은 모양).
 * 가져오기는 보드를 통째로 바꾸므로 PIN 을 다시 넣어야 한다(ONE-10).
 */
@Controller('data')
export class DataController {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
    private readonly audit: Audit,
  ) {}

  @Get('export')
  async export(@Auth() ctx: AuthCtx): Promise<SyncData> {
    const data = await exportSnapshot(this.db, ctx.user.id);
    await this.audit.log(ctx, 'data.export');
    return data;
  }

  @Post('import')
  async import(@Auth() ctx: AuthCtx, @Body() body: any): Promise<{ ok: true }> {
    await this.auth.verifyPin(ctx, body?.pin);
    try {
      await this.db.tx((q) => importData(q, body?.data, ctx.user.id));
    } catch (e: any) {
      // 파일이 잘못됐거나 표끼리 맞지 않으면 트랜잭션째 되돌아가 지금 보드는 그대로다.
      bad(String(e?.message ?? '가져오지 못했습니다.').slice(0, 300));
    }
    await this.audit.log(ctx, 'data.import');
    return { ok: true };
  }
}
