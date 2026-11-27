// 개발용 PostgreSQL 16을 띄운다. PostgreSQL·Docker를 설치하지 않은 PC에서 API를 돌려 보기 위한 것이다.
//   npm run dev:db:install   처음 한 번 (OS에 맞는 PostgreSQL 바이너리를 받는다)
//   npm run dev:db           띄우기. Ctrl+C로 끈다.
// 데이터는 tools/dev-db/data 에 남는다(.gitignore). 지우면 빈 DB로 다시 시작한다.
// 접속 주소: postgres://jarvis:jarvis@127.0.0.1:54329/jarvis  (.env의 DATABASE_URL)
// 운영에는 쓰지 않는다. 비밀번호가 고정이고 127.0.0.1에서만 받는다.

import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.DEV_DB_PORT ?? 54329);
const dir = join(dirname(fileURLToPath(import.meta.url)), 'data');

const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'jarvis', password: 'jarvis', port: PORT, persistent: true });

if (!existsSync(join(dir, 'PG_VERSION'))) {
  console.log('처음 실행입니다. DB 폴더를 만듭니다…');
  await pg.initialise();
}
await pg.start();
await pg.createDatabase('jarvis').catch(() => undefined); // 이미 있으면 그대로 쓴다.

console.log(`\n개발용 DB가 준비됐습니다: postgres://jarvis:jarvis@127.0.0.1:${PORT}/jarvis`);
console.log('끄려면 Ctrl+C. 표 구조는 API 서버가 시작할 때 맞춥니다.\n');

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await pg.stop().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => undefined, 1 << 30);
