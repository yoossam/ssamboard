import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { ShareDto } from '@jarvis/shared';
import type { Response } from 'express';
import { Auth, Public, type AuthCtx } from '../auth/auth.types';
import { Audit } from '../common/audit.service';
import { uuid } from '../common/http';
import { SharesService } from './shares.service';

/** 공유 링크 만들기·보기·다시 올리기·끄기(로그인한 사용자) */
@Controller('shares')
export class SharesController {
  constructor(
    private readonly shares: SharesService,
    private readonly audit: Audit,
  ) {}

  @Get()
  list(@Auth() ctx: AuthCtx, @Query('block_id') blockId?: string): Promise<ShareDto[]> {
    return this.shares.list(ctx.user.id, blockId ? uuid(blockId, 'block_id') : undefined);
  }

  /** 받는 사람이 볼 페이지를 만들기 전에 그대로 보여 준다(저장하지 않음) */
  @Post('preview')
  preview(@Auth() ctx: AuthCtx, @Body() body: any): Promise<{ html: string }> {
    return this.shares.preview(ctx.user, body);
  }

  @Post()
  async create(@Auth() ctx: AuthCtx, @Body() body: any): Promise<ShareDto> {
    const share = await this.shares.create(ctx.user, body);
    await this.audit.log(ctx, 'share.create', share.id);
    return share;
  }

  @Post(':id/refresh')
  refresh(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<ShareDto> {
    return this.shares.refresh(ctx.user, uuid(id));
  }

  @Delete(':id')
  async revoke(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ ok: true; warning?: string }> {
    const r = await this.shares.revoke(ctx.user, uuid(id));
    await this.audit.log(ctx, 'share.revoke', id);
    return r;
  }
}

/**
 * 로그인 없이 보는 공유 페이지(서버 트랙): GET /s/<열쇠>. /api 밖(main.ts 의 접두사 예외).
 * 스크립트 없는 HTML 이고, 이 응답만 더 좁은 보안 정책을 건다(외부 요청·틀 넣기·검색 노출 없음).
 */
@Controller('s')
export class PublicShareController {
  constructor(private readonly shares: SharesService) {}

  @Public()
  @Get(':token')
  async page(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const html = await this.shares.publicPage(token);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.status(html ? 200 : 404).type('html').send(html ?? this.shares.gonePage());
  }
}
