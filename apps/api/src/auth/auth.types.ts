import { PASSWORD_MIN_LENGTH } from '@jarvis/shared';
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  pin_hash: string | null;
  password_hash: string | null;
  password_fail_count: number;
  password_locked_until: Date | null;
  pin_fail_count: number;
  pin_locked_until: Date | null;
  lock_minutes: number;
  timezone: string;
  monthly_budget: string;
  llm_provider: string;
  llm_model: string;
  onboarded_at: string | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  device_name: string;
  locked: boolean;
  last_active_at: Date;
  created_at: Date;
}

export interface AuthCtx {
  user: UserRow;
  session: SessionRow;
  /** 저장된 잠금 또는 자동 잠금 시간이 지난 상태. */
  locked: boolean;
  ip: string;
}

export const SID_COOKIE = 'jv_sid';
export const CSRF_COOKIE = 'jv_csrf';
export const OAUTH_COOKIE = 'jv_oauth';
export const PIN_RE = /^\d{6}$/;
/** 암호 길이(글자 수). 길이만 보고 섞어 쓰기는 강제하지 않는다. */
export const PASSWORD_MIN = PASSWORD_MIN_LENGTH;
export const PASSWORD_MAX = 200;

/** 세션 없이 부를 수 있는 경로(로그인 시작·콜백, 상태, 헬스체크, 웹훅). */
export const Public = () => SetMetadata('public', true);
/** 잠긴 세션도 부를 수 있는 경로(AUTH-6: unlock·logout·status·pin/setup). */
export const AllowLocked = () => SetMetadata('allowLocked', true);

export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthCtx => ctx.switchToHttp().getRequest().auth);
