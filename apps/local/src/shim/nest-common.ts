/*
 * '@nestjs/common' 대체품 — 구글 드라이브 트랙에서 서버 코드(apps/api)를 브라우저 안에서 그대로 돌리려고 쓴다.
 * 의존성 주입은 하지 않고(local/src/app.ts 가 손으로 잇는다), 데코레이터는 주소·인자 자리만 적어 둔다.
 * router.ts 가 이 기록을 읽어 서버와 똑같은 주소로 컨트롤러 메서드를 부른다. 그래서 서버 코드를 고치면 두 트랙이 함께 바뀐다.
 *
 * 서버 코드가 새 Nest 기능을 쓰면 여기에 더한다. 빠지면 빌드가 'export 가 없다'로 알려 준다.
 */

export type ParamKind = 'body' | 'param' | 'query' | 'req' | 'res' | 'file' | 'custom';
export interface ParamSpec {
  index: number;
  kind: ParamKind;
  name?: string;
  passthrough?: boolean;
  resolve?: (ctx: ExecutionContext) => unknown;
}
export interface RouteSpec {
  method: string;
  path: string;
  key: string;
}
export interface ControllerMeta {
  prefix: string;
  routes: RouteSpec[];
  params: Map<string, ParamSpec[]>;
  meta: Map<string, Record<string, unknown>>;
  classMeta: Record<string, unknown>;
}

const REGISTRY = new Map<Function, ControllerMeta>();

function metaOf(ctor: Function): ControllerMeta {
  let m = REGISTRY.get(ctor);
  if (!m) {
    m = { prefix: '', routes: [], params: new Map(), meta: new Map(), classMeta: {} };
    REGISTRY.set(ctor, m);
  }
  return m;
}

export function controllerMeta(ctor: Function): ControllerMeta | undefined {
  return REGISTRY.get(ctor);
}

export interface ExecutionContext {
  switchToHttp(): { getRequest<T = any>(): T; getResponse<T = any>(): T };
  getHandler(): Function;
  getClass(): Function;
}

// ── 클래스 ──
export const Injectable = (_opts?: unknown) => (_target: Function) => undefined;
export const Module = (_opts?: unknown) => (_target: Function) => undefined;
/** 생성자 인자 꾸밈(브라우저 판은 직접 new 하므로 하는 일 없음) */
export const Optional = () => (_target: object, _key: string | symbol | undefined, _index: number) => undefined;
export function Controller(prefix?: string | { path?: string }) {
  return (target: Function) => {
    const p = typeof prefix === 'string' ? prefix : (prefix?.path ?? '');
    metaOf(target).prefix = p;
  };
}

// ── 주소 ──
const route =
  (method: string) =>
  (path = '') =>
  (target: object, key: string | symbol, _desc?: PropertyDescriptor) => {
    metaOf(target.constructor).routes.push({ method, path, key: String(key) });
  };
export const Get = route('GET');
export const Post = route('POST');
export const Put = route('PUT');
export const Patch = route('PATCH');
export const Delete = route('DELETE');

export function SetMetadata(metaKey: string, value: unknown) {
  return (target: any, key?: string | symbol, _desc?: PropertyDescriptor) => {
    if (key === undefined) metaOf(target).classMeta[metaKey] = value;
    else {
      const m = metaOf(target.constructor);
      const k = String(key);
      m.meta.set(k, { ...(m.meta.get(k) ?? {}), [metaKey]: value });
    }
  };
}
export const HttpCode = (_code: number) => (_t: object, _k: string | symbol, _d?: PropertyDescriptor) => undefined;
export const UseInterceptors =
  (..._i: unknown[]) =>
  (_t: object, _k?: string | symbol, _d?: PropertyDescriptor) =>
    undefined;
export const UseGuards = UseInterceptors;

// ── 인자 ──
const param = (spec: Omit<ParamSpec, 'index'>) => (target: object, key: string | symbol | undefined, index: number) => {
  const m = metaOf(target.constructor);
  const k = String(key);
  m.params.set(k, [...(m.params.get(k) ?? []), { ...spec, index }]);
};
export const Body = (name?: string) => param({ kind: 'body', name });
export const Param = (name?: string) => param({ kind: 'param', name });
export const Query = (name?: string) => param({ kind: 'query', name });
export const Req = () => param({ kind: 'req' });
export const Request = Req;
export const Res = (opts?: { passthrough?: boolean }) => param({ kind: 'res', passthrough: opts?.passthrough });
export const Response = Res;
export const UploadedFile = () => param({ kind: 'file' });
export function createParamDecorator<D = unknown>(fn: (data: D, ctx: ExecutionContext) => unknown) {
  return (data?: D) => param({ kind: 'custom', resolve: (ctx) => fn(data as D, ctx) });
}

// ── 오류 — 서버와 같은 모양({ statusCode, message, error })으로 화면에 돌려준다 ──
export class HttpException extends Error {
  constructor(
    private readonly response: string | Record<string, any>,
    private readonly status: number,
  ) {
    super(typeof response === 'string' ? response : String(response?.message ?? 'Http Exception'));
  }
  getStatus(): number {
    return this.status;
  }
  getResponse(): string | Record<string, any> {
    return this.response;
  }
}
const named = (status: number, error: string) =>
  class extends HttpException {
    constructor(message?: string | Record<string, any>) {
      super(typeof message === 'object' && message ? message : { statusCode: status, message: message ?? error, error }, status);
    }
  };
export const BadRequestException = named(400, 'Bad Request');
export const UnauthorizedException = named(401, 'Unauthorized');
export const ForbiddenException = named(403, 'Forbidden');
export const NotFoundException = named(404, 'Not Found');
export const ConflictException = named(409, 'Conflict');
export const PayloadTooLargeException = named(413, 'Payload Too Large');
export const InternalServerErrorException = named(500, 'Internal Server Error');

export class Logger {
  constructor(private readonly context = '') {}
  log(...a: unknown[]) {
    console.info(`[${this.context}]`, ...a);
  }
  warn(...a: unknown[]) {
    console.warn(`[${this.context}]`, ...a);
  }
  error(...a: unknown[]) {
    console.error(`[${this.context}]`, ...a);
  }
  debug() {}
}

// 타입만 쓰이는 것들
export interface CanActivate {
  canActivate(ctx: ExecutionContext): boolean | Promise<boolean>;
}
export interface OnModuleInit {
  onModuleInit(): unknown;
}
export interface OnModuleDestroy {
  onModuleDestroy(): unknown;
}
