// 'pg' 대체품. 구글 드라이브 트랙의 DB 는 PGlite(local/src/db.ts)라서 Pool 은 만들어지기만 하고 쓰이지 않는다.
export class Pool {
  constructor(_opts?: unknown) {}
  query(): never {
    throw new Error('구글 드라이브 트랙에서는 pg Pool 을 쓰지 않습니다(LocalDb 를 넘겨야 합니다).');
  }
  connect(): never {
    return this.query();
  }
  end(): Promise<void> {
    return Promise.resolve();
  }
}
export default { Pool };
