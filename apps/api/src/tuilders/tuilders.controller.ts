import { Controller, Get, Query } from '@nestjs/common';
import type { TuildersApp } from '@jarvis/shared';
import { Auth, type AuthCtx } from '../auth/auth.types';
import { TuildersService } from './tuilders.service';

/** 수업 자료 블록의 [틸더스에서 찾기] — 수업 주제로 앱 추천(읽기만, 고른 것은 화면이 블록에 담는다) */
@Controller('tuilders')
export class TuildersController {
  constructor(private readonly tuilders: TuildersService) {}

  @Get('apps')
  apps(@Auth() ctx: AuthCtx, @Query() q: Record<string, string>): Promise<TuildersApp[]> {
    return this.tuilders.findApps(ctx.user.id, { topic: q.topic, grade: q.grade, subject: q.subject, level: q.level, limit: Number(q.limit) || undefined });
  }
}
