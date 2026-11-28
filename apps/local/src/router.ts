/*
 * 브라우저 안 작은 서버 — 화면이 부르는 '/api/…' 를 서버 판과 같은 컨트롤러 메서드로 이어 준다.
 * 주소·인자 자리는 컨트롤러의 데코레이터(shim/nest-common.ts 가 적어 둔 것)에서 읽으므로 따로 적지 않는다.
 * 결과는 진짜 fetch 처럼 Response 로 돌려준다 — 화면 코드(apps/web/src/lib/api.ts)는 두 트랙에서 똑같다.
 */
import { controllerMeta, HttpException, type ExecutionContext, type ParamSpec } from './shim/nest-common';

interface CompiledRoute {
  method: string;
  parts: string[];
  instance: any;
  key: string;
  params: ParamSpec[];
  usesRes: boolean;
}

export interface LocalRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
  file?: unknown;
  auth: unknown;
  ip: string;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  is(type: string): boolean;
}

const clean = (s: string) => s.split('/').filter(Boolean);

export class LocalRouter {
  private readonly routes: CompiledRoute[] = [];
  /** 끝나지 않은 쓰기 요청(긴 AI 응답 포함) — 로그아웃은 이것이 끝난 뒤에 자료를 저장·삭제한다. */
  private inFlight = new Set<Promise<unknown>>();

  /** 진행 중인 쓰기 요청이 모두 끝날 때까지 */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }
  private track<T>(p: Promise<T>): Promise<T> {
    this.inFlight.add(p);
    void p.finally(() => this.inFlight.delete(p)).catch(() => undefined);
    return p;
  }

  constructor(
    controllers: object[],
    private readonly auth: () => Promise<unknown>,
    /** 쓰기 요청(GET 이 아닌 것)이 성공해 끝난 뒤 — 흘려보내기는 다 쓴 뒤에 부른다(드라이브 맞춤이 듣는다). */
    private readonly afterWrite?: () => void,
  ) {
    for (const instance of controllers) {
      const meta = controllerMeta(instance.constructor);
      if (!meta) throw new Error(`${instance.constructor.name} 에 @Controller 가 없습니다.`);
      for (const r of meta.routes) {
        const params = [...(meta.params.get(r.key) ?? [])].sort((a, b) => a.index - b.index);
        this.routes.push({
          method: r.method,
          parts: [...clean(meta.prefix), ...clean(r.path)],
          instance,
          key: r.key,
          params,
          usesRes: params.some((p) => p.kind === 'res' && !p.passthrough),
        });
      }
    }
    // 고정 글자가 많은 주소를 먼저 본다(commands/:id/apply 가 commands/:id 보다 먼저).
    this.routes.sort((a, b) => b.parts.filter((p) => !p.startsWith(':')).length - a.parts.filter((p) => !p.startsWith(':')).length);
  }

  /** 등록된 주소 목록(시험·진단용). */
  list(): string[] {
    return this.routes.map((r) => `${r.method} /${r.parts.join('/')}`);
  }

  private match(method: string, path: string): { route: CompiledRoute; params: Record<string, string> } | null {
    let segs: string[];
    try {
      segs = clean(path).map(decodeURIComponent);
    } catch {
      return null; // 잘못된 % 표기 → 없는 길(코덱스·제미나이 검토)
    }
    for (const route of this.routes) {
      if (route.method !== method || route.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = route.parts[i];
        if (p.startsWith(':')) params[p.slice(1)] = segs[i];
        else if (p !== segs[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  /** fetch 와 같은 모양. url 은 '/api/…' 로 시작한다. */
  async fetch(input: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    const url = new URL(input, 'http://local');
    const path = url.pathname.replace(/^\/api(?=\/|$)/, '');
    const found = this.match(method, path);
    if (!found)
      return json(
        {
          statusCode: 404,
          message: '구글 드라이브 트랙에서는 아직 쓸 수 없는 기능입니다.',
          error: 'Not Found',
        },
        404,
      );

    let body: any = undefined;
    let file: unknown = undefined;
    if (init.body instanceof FormData) {
      const f = init.body.get('file');
      // multer 가 주는 모양으로: 이름은 UTF-8 바이트를 latin1 글자로(서버 코드가 되돌린다), 내용은 Buffer.
      if (f instanceof Blob) {
        const name = (f as File).name ?? 'file';
        // 크기는 읽기 전에 본다(큰 파일을 통째로 메모리에 올리지 않게)
        if (f.size > 10 * 1024 * 1024) return json({ statusCode: 413, message: '파일은 10MB 까지입니다.' }, 413);
        const latin1 = String.fromCharCode(...new TextEncoder().encode(name));
        const buffer = (globalThis as any).Buffer.from(await f.arrayBuffer());
        if (buffer.length > 10 * 1024 * 1024) return json({ statusCode: 413, message: '파일은 10MB 까지입니다.' }, 413);
        file = {
          originalname: latin1,
          buffer,
          size: buffer.length,
          mimetype: f.type,
        };
      }
      body = Object.fromEntries([...init.body.entries()].filter(([, v]) => typeof v === 'string'));
    } else if (typeof init.body === 'string' && init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        return json({ statusCode: 400, message: '요청 본문이 JSON 이 아닙니다.' }, 400);
      }
    }

    const req: LocalRequest = {
      method,
      path,
      params: found.params,
      query: Object.fromEntries(url.searchParams),
      body,
      file,
      auth: await this.auth(),
      ip: 'local',
      headers: { 'content-type': 'application/json' },
      cookies: {},
      is: (type) => type === 'application/json' || type === 'json',
    };
    const res = new LocalResponse(init.signal ?? undefined);
    const ctx: ExecutionContext = {
      switchToHttp: () => ({
        getRequest: <T>() => req as T,
        getResponse: <T>() => res as T,
      }),
      getHandler: () => found.route.instance[found.route.key],
      getClass: () => found.route.instance.constructor,
    };
    const args = found.route.params.map((p) => {
      switch (p.kind) {
        case 'body':
          return p.name ? body?.[p.name] : body;
        case 'param':
          return p.name ? req.params[p.name] : req.params;
        case 'query':
          return p.name ? req.query[p.name] : req.query;
        case 'req':
          return req;
        case 'res':
          return res;
        case 'file':
          return file;
        case 'custom':
          return p.resolve?.(ctx);
      }
    });

    const run = async () => found.route.instance[found.route.key](...args);
    if (found.route.usesRes) {
      // 메서드가 응답을 직접 쓴다(AI 창의 흘려보내기, 틀 문서). 머리글이 정해지는 순간 Response 를 넘긴다.
      const done = run()
        .then(() => method !== 'GET' && this.afterWrite?.())
        .catch((e) => res.fail(e))
        .finally(() => res.end());
      if (method !== 'GET') void this.track(done);
      return res.response;
    }
    try {
      const out = await (method === 'GET' ? run() : this.track(run()));
      if (method !== 'GET') this.afterWrite?.();
      if (out === undefined) return new Response(null, { status: 204 });
      // 네트워크를 건넌 것과 같게(Date → 글자 등) JSON 으로 한 번 바꾼다.
      return json(out, method === 'POST' ? 201 : 200);
    } catch (e) {
      return errorResponse(e);
    }
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(e: unknown): Response {
  if (e instanceof HttpException) {
    const r = e.getResponse();
    return json(typeof r === 'string' ? { statusCode: e.getStatus(), message: r } : { statusCode: e.getStatus(), ...r }, e.getStatus());
  }
  console.error('[쌤보드 로컬]', e);
  return json(
    {
      statusCode: 500,
      message: '처리하지 못했습니다. 잠시 뒤 다시 시도하세요.',
    },
    500,
  );
}

/** express Response 의 쓰이는 부분만. 흘려보내기(write)는 ReadableStream 으로 이어 준다. */
class LocalResponse {
  statusCode = 200;
  writableEnded = false;
  private readonly headers = new Headers();
  private readonly closeHandlers: (() => void)[] = [];
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private readonly stream: ReadableStream<Uint8Array>;
  private started = false;
  private resolveResponse!: (r: Response) => void;
  readonly response: Promise<Response>;
  private readonly enc = new TextEncoder();

  constructor(signal?: AbortSignal) {
    this.stream = new ReadableStream({
      start: (c) => {
        this.controller = c;
      },
      cancel: () => this.closeHandlers.forEach((f) => f()),
    });
    this.response = new Promise((resolve) => {
      this.resolveResponse = resolve;
    });
    signal?.addEventListener('abort', () => this.closeHandlers.forEach((f) => f()));
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.resolveResponse(
      new Response(this.stream, {
        status: this.statusCode,
        headers: this.headers,
      }),
    );
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  set(h: Record<string, string>): this {
    for (const [k, v] of Object.entries(h)) this.headers.set(k, v);
    return this;
  }
  setHeader(k: string, v: string): this {
    this.headers.set(k, v);
    return this;
  }
  type(t: string): this {
    this.headers.set('Content-Type', t === 'html' ? 'text/html; charset=utf-8' : t);
    return this;
  }
  flushHeaders(): void {
    this.start();
  }
  on(event: string, fn: () => void): this {
    if (event === 'close') this.closeHandlers.push(fn);
    return this;
  }
  write(chunk: string | Uint8Array): boolean {
    if (this.writableEnded) return false;
    this.start();
    this.controller.enqueue(typeof chunk === 'string' ? this.enc.encode(chunk) : chunk);
    return true;
  }
  send(body: string): this {
    this.write(body);
    this.end();
    return this;
  }
  json(v: unknown): this {
    this.headers.set('Content-Type', 'application/json');
    return this.send(JSON.stringify(v));
  }
  end(): void {
    if (this.writableEnded) return;
    this.start();
    this.writableEnded = true;
    this.controller.close();
  }
  /** 머리글을 보내기 전에 오류가 나면 서버와 같은 오류 응답으로. */
  fail(e: unknown): void {
    if (this.started) {
      this.end();
      return;
    }
    this.started = true;
    this.writableEnded = true;
    this.resolveResponse(errorResponse(e));
  }
}
