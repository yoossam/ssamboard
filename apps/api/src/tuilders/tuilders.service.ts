import { Injectable } from '@nestjs/common';
import { cleanUrl, type TuildersApp } from '@jarvis/shared';
import { bad } from '../common/http';
import { RateLimiter } from '../common/rate-limit';
import { config } from '../config';

/*
 * 틸더스(tuilders.com, 교사가 만든 수업 앱 모음) — 수업 주제로 앱을 추천받는다(2026-11-28 수업 보드 2단계).
 * find_apps_for_lesson 은 로그인 없이 부를 수 있는 공개 도구라 열쇠를 쓰지 않는다(MCP 를 HTTP JSON-RPC 로).
 * 브라우저에서 바로 부르는 것은 막혀 있어(교차 출처 허용 없음) 서버 판에서만 된다.
 * 받은 제목·설명은 바깥 글이다 — AI 에 넘길 때는 자료로만 다룬다(ai.service 규칙 1), 화면에는 글로만 그린다.
 * 실패해도 수업이 멈추지 않게 8초에서 끊고, 붙여 넣기로 직접 담을 수 있다고 알린다.
 */

const ENDPOINT = 'https://tuilders.com/mcp';
const TIMEOUT_MS = 8_000;
const perUser = new RateLimiter(20, 60_000);

export type Fetch = typeof fetch;

export interface FindAppsInput {
  topic?: string;
  grade?: string;
  subject?: string;
  level?: string;
  limit?: number;
}

const text = (v: unknown, max: number): string =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, max)
    : '';

export const tuildersAvailable = (): boolean => config.shareMode === 'server';

/** 틸더스 응답(JSON-RPC result.content[].text 안의 JSON)에서 앱 목록을 꺼내 아는 모양으로 거른다. */
export function parseFindApps(body: any): TuildersApp[] {
  const parts: unknown[] = Array.isArray(body?.result?.content) ? body.result.content : [];
  let data: any = null;
  for (const p of parts) {
    const t = (p as { type?: string; text?: string })?.text;
    if (typeof t !== 'string' || !t.trim().startsWith('{')) continue;
    try {
      data = JSON.parse(t);
      break;
    } catch {
      /* 다음 조각 */
    }
  }
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  const out: TuildersApp[] = [];
  for (const it of items.slice(0, 20)) {
    const url = cleanUrl(it?.url);
    const title = text(it?.title, 80);
    if (!url || !title) continue;
    out.push({
      slug: text(it?.slug, 80),
      title,
      tagline: text(it?.tagline, 160),
      url,
      reasons: (Array.isArray(it?.reasons) ? it.reasons : [])
        .map((r: unknown) => text(r, 80))
        .filter(Boolean)
        .slice(0, 4),
      score: typeof it?.score === 'number' ? Math.round(it.score) : 0,
      down: it?.health_status === 'down',
    });
  }
  return out;
}

@Injectable()
export class TuildersService {
  async findApps(userId: string, input: FindAppsInput, f: Fetch = fetch): Promise<TuildersApp[]> {
    if (!tuildersAvailable()) bad('틸더스 앱 찾기는 서버 판에서만 됩니다. 틸더스(tuilders.com)에서 앱 주소를 복사해 붙여 넣으세요.');
    if (!perUser.allow(userId)) bad('틸더스에 너무 자주 물었습니다. 잠시 뒤 다시 해 보세요.');
    const args: Record<string, unknown> = { limit: Math.min(10, Math.max(1, Math.trunc(Number(input.limit) || 6))) };
    for (const k of ['topic', 'grade', 'subject', 'level'] as const) {
      const v = text(input[k], k === 'topic' ? 200 : 40);
      if (v) args[k] = v;
    }
    if (!args.topic && !args.subject) bad('주제나 교과를 적어 주세요.');
    let res: Response;
    try {
      res = await f(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find_apps_for_lesson', arguments: args } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      bad('틸더스에 연결하지 못했습니다(시간 초과). 틸더스에서 앱 주소를 복사해 붙여 넣어도 됩니다.');
    }
    if (!res!.ok) bad(`틸더스가 응답하지 않습니다(${res!.status}). 잠시 뒤 다시 해 보세요.`);
    if (Number(res!.headers.get('content-length') ?? 0) > 1_000_000) bad('틸더스 응답이 너무 큽니다. 잠시 뒤 다시 해 보세요.');
    const raw = await res!.text();
    if (raw.length > 1_000_000) bad('틸더스 응답이 너무 큽니다. 잠시 뒤 다시 해 보세요.');
    // 보통은 JSON, 흘려보내기(SSE)로 오면 data: 줄들 가운데 result·error 가 있는 것을 읽는다
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      for (const line of raw.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        try {
          const v = JSON.parse(line.slice(5));
          if (v && (v.result || v.error)) {
            body = v;
            break;
          }
        } catch {
          /* 다음 줄 */
        }
      }
    }
    if ((body as any)?.error) bad('틸더스가 요청을 받지 못했습니다. 주제를 바꿔 다시 해 보세요.');
    return parseFindApps(body);
  }
}
