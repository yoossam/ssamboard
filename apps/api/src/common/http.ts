import { BadRequestException, NotFoundException } from '@nestjs/common';

// 요청 값 검증 도우미. 잘못된 값은 400으로 돌려준다.

export function bad(message: string): never {
  throw new BadRequestException(message);
}

export function notFound(what = '항목'): never {
  throw new NotFoundException(`${what}을(를) 찾을 수 없습니다.`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(v: unknown, name = 'id'): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) bad(`${name} 형식이 잘못됐습니다.`);
  return v as string;
}
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export function str(v: unknown, name: string, opts: { min?: number; max?: number } = {}): string {
  if (typeof v !== 'string') bad(`${name}이(가) 필요합니다.`);
  const s = (v as string).trim();
  if (s.length < (opts.min ?? 1)) bad(`${name}이(가) 비어 있습니다.`);
  if (s.length > (opts.max ?? 500)) bad(`${name}이(가) 너무 깁니다(최대 ${opts.max ?? 500}자).`);
  return s;
}

export function optStr(v: unknown, name: string, opts: { max?: number } = {}): string | undefined {
  if (v === undefined || v === null) return undefined;
  return str(v, name, { min: 0, max: opts.max });
}

export function int(v: unknown, name: string, opts: { min?: number; max?: number } = {}): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) bad(`${name}은(는) 정수여야 합니다.`);
  const x = n as number;
  if (opts.min !== undefined && x < opts.min) bad(`${name}은(는) ${opts.min} 이상이어야 합니다.`);
  if (opts.max !== undefined && x > opts.max) bad(`${name}은(는) ${opts.max} 이하여야 합니다.`);
  return x;
}

export function oneOf<T extends string>(v: unknown, name: string, list: readonly T[]): T {
  if (typeof v !== 'string' || !list.includes(v as T)) bad(`${name}은(는) ${list.join(', ')} 중 하나여야 합니다.`);
  return v as T;
}

/** ISO 8601 시각. 없으면 null. */
export function isoOrNull(v: unknown, name: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) bad(`${name}은(는) ISO 8601 시각이어야 합니다.`);
  return new Date(v as string).toISOString();
}

export function obj(v: unknown, name: string): Record<string, any> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(`${name}이(가) 잘못됐습니다.`);
  return v as Record<string, any>;
}
