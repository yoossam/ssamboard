import type { AiStreamEvent } from '@jarvis/shared';
import { useApp } from './store';

// 서버와 주고받는 한 곳. 브라우저는 API 키·토큰·DB에 직접 닿지 않고 모두 이 경로를 거친다(6장).
//
// 두 트랙(docs/TWO_EDITIONS_PLAN.md): 화면은 `api`·`streamAi` 로만 부르고, 그 뒤에서 보내는 fetch 만 트랙마다 다르다.
//   서버 트랙          — 브라우저 fetch 로 이 사이트의 /api 에 보낸다(아래 기본값).
//   구글 드라이브 트랙 — 브라우저 안 작은 서버(apps/local, 서버 코드 그대로 + PGlite)의 fetch 를 setFetcher() 로 끼운다.
// 화면 코드에 fetch('/api…')를 새로 쓰지 않는다. 지금 남은 예외 둘: AI 화면 틀 주소(board/view.tsx), 구글 로그인 넘기기(screens/Gate.tsx).

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
let send: Fetcher = (input, init) => fetch(input, init);
/** 트랙에 맞는 fetch 를 끼운다. 앱이 시작할 때 한 번만 부른다. */
export function setFetcher(next: Fetcher): void {
  send = next;
}

export type AiMessageBody = { text: string; data?: string; context_block_ids?: string[]; conversation_id?: string; images?: { media_type: string; data: string }[]; files?: { name: string; data: string }[]; links?: string[] };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, any> = {},
  ) {
    super(message);
  }
}

function csrfToken(): string {
  const found = document.cookie.split('; ').find((c) => c.startsWith('jv_csrf='));
  return found ? decodeURIComponent(found.slice('jv_csrf='.length)) : '';
}

async function failure(res: Response): Promise<ApiError> {
  let data: Record<string, any> = {};
  try {
    data = await res.json();
  } catch {
    /* 본문이 JSON이 아니면 상태 코드만 쓴다. */
  }
  const raw = Array.isArray(data.message) ? data.message.join(' ') : data.message;
  const message = typeof raw === 'string' && raw ? raw : res.status >= 500 ? '서버에서 문제가 생겼습니다. 잠시 뒤 다시 시도하세요.' : `요청을 처리하지 못했습니다(${res.status}).`;
  // 서버가 잠겼다고 하면 화면도 바로 잠근다(AUTH-5·6). 세션이 끝났으면 로그인 화면으로 보낸다.
  if (res.status === 423) useApp.getState().markLocked();
  if (res.status === 401) useApp.getState().markSignedOut();
  return new ApiError(message, res.status, data);
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken();
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await send(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin', signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError('서버에 연결할 수 없습니다. 네트워크를 확인하세요.', 0);
  }
  if (!res.ok) throw await failure(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body ?? {}),
};

export function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : '요청을 처리하지 못했습니다.';
}

/** AI 창 입력. 응답은 SSE로 조금씩 온다(ONE-8). */
export async function streamAi(body: AiMessageBody, onEvent: (event: AiStreamEvent) => void, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await send('/api/ai/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken(), Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError('서버에 연결할 수 없습니다. 네트워크를 확인하세요.', 0);
  }
  if (!res.ok || !res.body) throw await failure(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = (chunk: string) => {
    const data = chunk
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    try {
      onEvent(JSON.parse(data) as AiStreamEvent);
    } catch {
      /* 잘린 조각은 버린다. */
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf('\n\n');
    while (cut >= 0) {
      flush(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf('\n\n');
    }
  }
  if (buffer.trim()) flush(buffer);
}
