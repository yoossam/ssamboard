// '@nestjs/core' 대체품(구글 드라이브 트랙). 세션 가드·앱 시작은 브라우저 틀(local/src/app.ts)이 대신해서 거의 비어 있다.
export class Reflector {
  get<T = unknown>(_key: string, _target: unknown): T | undefined {
    return undefined;
  }
  getAllAndOverride<T = unknown>(_key: string, _targets: unknown[]): T | undefined {
    return undefined;
  }
}
export const APP_GUARD = 'APP_GUARD';
export const NestFactory = {
  create() {
    throw new Error('구글 드라이브 트랙에서는 Nest 앱을 만들지 않습니다.');
  },
};
