import { Controller, Get, Param } from '@nestjs/common';
import { Auth, type AuthCtx } from '../auth/auth.types';
import { uuid } from '../common/http';
import { FilesService } from './files.service';

/** AI 가 고친 파일 내려받기(두 트랙 모두 JSON 으로 — 화면이 받아 파일로 저장) */
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get(':id')
  download(@Auth() ctx: AuthCtx, @Param('id') id: string): Promise<{ name: string; mime: string; data: string }> {
    return this.files.download(ctx.user.id, uuid(id));
  }
}
