import { CanActivate, ExecutionContext, ForbiddenException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { safeEqual } from '../common/crypto';
import { AuthService } from './auth.service';
import { CSRF_COOKIE } from './auth.types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 모든 요청이 거치는 문지기. 세션을 확인하고, CSRF 토큰을 검사하고,
 * 잠긴 세션이면 허용된 경로를 빼고 모두 423으로 막는다(AUTH-6).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const req = context.switchToHttp().getRequest<Request & { auth?: unknown }>();
    const isPublic = this.reflector.getAllAndOverride<boolean>('public', targets);

    const ctx = await this.auth.load(req);
    req.auth = ctx ?? undefined;
    if (isPublic) return true;
    if (!ctx) throw new UnauthorizedException('로그인이 필요합니다.');

    if (!SAFE_METHODS.has(String(req.method))) {
      const header = String(req.headers['x-csrf-token'] ?? '');
      const cookie = String(req.cookies?.[CSRF_COOKIE] ?? '');
      if (!header || !cookie || !safeEqual(header, cookie)) throw new ForbiddenException('요청을 확인할 수 없습니다(CSRF). 새로고침 후 다시 시도하세요.');
    }

    if (ctx.locked && !this.reflector.getAllAndOverride<boolean>('allowLocked', targets)) {
      throw new HttpException({ message: '잠금 상태입니다.', locked: true }, 423);
    }
    return true;
  }
}
