import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import type { ConversationDto, ConversationMessageDto, MemoryDto } from '@jarvis/shared';
import { Auth, type AuthCtx } from '../auth/auth.types';
import { uuid } from '../common/http';
import { MemoryService } from './memory.service';

/** 오래 가는 기억(설정 → 기억)과 지난 대화(AI 창에서 이어 열기) */
@Controller()
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  @Get('memories')
  list(@Auth() ctx: AuthCtx): Promise<MemoryDto[]> {
    return this.memory.list(ctx.user.id);
  }

  @Post('memories')
  add(@Auth() ctx: AuthCtx, @Body() body: any): Promise<MemoryDto> {
    return this.memory.add(ctx.user.id, body?.text);
  }

  @Patch('memories/:id')
  async update(@Auth() ctx: AuthCtx, @Param('id') id: string, @Body() body: any): Promise<{ ok: true }> {
    await this.memory.update(ctx.user.id, uuid(id), body?.text);
    return { ok: true };
  }

  @Delete('memories/:id')
  async remove(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ ok: true }> {
    await this.memory.remove(ctx.user.id, uuid(id));
    return { ok: true };
  }

  @Delete('memories')
  async clear(@Auth() ctx: AuthCtx): Promise<{ ok: true }> {
    await this.memory.clear(ctx.user.id);
    return { ok: true };
  }

  @Get('ai/conversations')
  conversations(@Auth() ctx: AuthCtx): Promise<ConversationDto[]> {
    return this.memory.conversations(ctx.user.id);
  }

  @Get('ai/conversations/:id/messages')
  messages(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<ConversationMessageDto[]> {
    return this.memory.messages(ctx.user.id, uuid(id));
  }

  @Delete('ai/conversations/:id')
  async remove2(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ ok: true }> {
    await this.memory.deleteConversation(ctx.user.id, uuid(id));
    return { ok: true };
  }
}
