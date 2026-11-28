import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import type { MenuInfoDto, MenuItemDto, MenuRecommendation } from '@jarvis/shared';
import { Auth, type AuthCtx } from '../auth/auth.types';
import { uuid } from '../common/http';
import { MenusService } from './menus.service';

/** 내 메뉴(위쪽 바로가기 줄). 추천은 사용자의 AI 열쇠로, 만들기는 서버가 틀을 검사한 뒤. */
@Controller('menus')
export class MenusController {
  constructor(private readonly menus: MenusService) {}

  /** 지금 보드의 메뉴 — 자주 쓰는 순(하루 한 번 다시 정리) */
  @Get()
  list(@Auth() ctx: AuthCtx): Promise<MenuItemDto[]> {
    return this.menus.listArranged(ctx.user.id);
  }

  /** 자동 정리 상태(마지막 정리 때·자동 메뉴 수) */
  @Get('info')
  info(@Auth() ctx: AuthCtx): Promise<MenuInfoDto> {
    return this.menus.info(ctx.user.id);
  }

  /** [지금 다시 정리] */
  @Post('arrange')
  arrange(@Auth() ctx: AuthCtx): Promise<MenuItemDto[]> {
    return this.menus.listArranged(ctx.user.id, true);
  }

  /** 기능을 쓸 때 화면이 남기는 기록(자주 쓰는 순 정리에 쓴다) */
  @Post('usage')
  async usage(@Auth() ctx: AuthCtx, @Body() body: any): Promise<{ ok: true }> {
    await this.menus.track(ctx.user.id, body?.key);
    return { ok: true };
  }

  /** 관리하고 싶은 것을 적으면 AI 가 정리해 메뉴를 추천한다(저장하지 않음). */
  @Post('recommend')
  recommend(@Auth() ctx: AuthCtx, @Body() body: any): Promise<MenuRecommendation> {
    return this.menus.recommend(ctx.user, body?.text);
  }

  /** 고른 추천으로 메뉴(와 필요한 새 표)를 만든다. */
  @Post()
  create(@Auth() ctx: AuthCtx, @Body() body: any): Promise<MenuItemDto[]> {
    return this.menus.create(ctx.user.id, body?.menus);
  }

  @Put('order')
  async reorder(@Auth() ctx: AuthCtx, @Body() body: any): Promise<{ ok: true }> {
    await this.menus.reorder(ctx.user.id, body?.ids);
    return { ok: true };
  }

  @Patch(':id')
  async update(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<{ ok: true }> {
    await this.menus.update(ctx.user.id, uuid(id), body);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ ok: true }> {
    await this.menus.remove(ctx.user.id, uuid(id));
    return { ok: true };
  }
}
