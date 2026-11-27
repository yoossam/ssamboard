import { openLocalDb } from '../src/db';
import { createLocalApp } from '../src/app';

export async function run() {
  const db = await openLocalDb();
  let changes = 0;
  const app = await createLocalApp(db, { email: 'Teacher@Example.com', name: '선생님' }, { onChange: () => changes++ });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.fetch('/api' + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const out: Record<string, unknown> = {};
  out.routes = app.list().length;
  out.status = (await call('GET', '/auth/status')).body;
  const board = await call('GET', '/boards/current');
  out.board = { status: board.status, blocks: board.body.blocks.map((b: any) => b.type) };
  out.createTask = (await call('POST', '/tasks', { title: '동의서 걷기', due_at: null })).status;
  out.tasks = (await call('GET', '/tasks')).body.map((t: any) => t.title);
  out.badTask = await call('POST', '/tasks', { title: '' });
  const memo = board.body.blocks.find((b: any) => b.type === 'memo');
  out.patchBlock = (await call('PATCH', `/blocks/${memo.id}`, { config: { color: 'pink', text: '메모' } })).status;
  out.deleteBlock = (await call('DELETE', `/blocks/${memo.id}`)).status;
  out.trash = (await call('GET', '/trash')).body.map((t: any) => t.kind);
  out.settings = Object.keys((await call('GET', '/settings')).body);
  out.theme = (await call('PATCH', '/boards/current/theme', { bg: 'mint' })).body;
  out.notFound = (await call('GET', '/no-such-route')).status;
  // AI: 열쇠가 없으면 오류 이벤트가 흘러나와야 한다
  const ai = await app.fetch('/api/ai/messages', { method: 'POST', body: JSON.stringify({ text: '안녕' }) });
  out.ai = { status: ai.status, type: ai.headers.get('content-type'), text: (await ai.text()).slice(0, 160) };
  // 파일로 표 만들기(메모리 디스크·Buffer·한글 파일 이름)
  const fd = new FormData();
  fd.set('file', new File(['이름,점수\n가나,1\n다라,2\n'], '성적표.csv', { type: 'text/csv' }));
  const up = await app.fetch('/api/uploads', { method: 'POST', body: fd });
  const u = await up.json();
  out.upload = { status: up.status, filename: u.filename, header: u.header, total: u.total };
  const made = await call('POST', '/tables', { name: '성적', upload_id: u.upload_id, columns: u.header.map((h: string, i: number) => ({ name: h, type: u.guess[i], source: i })) });
  out.tableStatus = made.status;
  out.rows = (await call('GET', `/tables/${made.body.table.id}/rows?page=1&size=10`)).body.rows?.length;
  // 서버 트랙과 같은 내보내기·가져오기 주소(같은 코드)
  const exported = (await call('GET', '/data/export')).body;
  out.exportTables = Object.keys(exported.tables).length;
  await call('POST', '/tasks', { title: '가져오면 사라질 할 일', due_at: null });
  const imp = await call('POST', '/data/import', { pin: '000000', data: exported });
  out.importOk = imp.status;
  out.importMsg = imp.body?.message;
  out.tasksAfterImport = (await call('GET', '/tasks')).body.map((t: any) => t.title);
  out.importBad = (await call('POST', '/data/import', { pin: '000000', data: { format: 'x' } })).body.message;
  // 내보낸 파일에 PIN·암호 해시가 없다(코덱스 검토)
  out.exportUserKeys = Object.keys(exported.tables.users[0]).sort();
  // 남의 보드를 가리키는 줄은 거부(제미나이 검토): 다른 사용자와 보드를 만들고, 그 보드를 가리키는 블록을 넣은 파일
  const other = await db.one("insert into users(email, name) values ('other@example.com', '남') returning id");
  const otherBoard = await db.one('insert into boards(user_id) values ($1) returning id', [other.id]);
  const evil = JSON.parse(JSON.stringify(exported));
  evil.tables.blocks = [{ ...exported.tables.blocks[0], id: crypto.randomUUID(), board_id: otherBoard.id }];
  out.importForeign = (await call('POST', '/data/import', { pin: '000000', data: evil })).body.message;
  out.tasksAfterForeign = (await call('GET', '/tasks')).body.map((t: any) => t.title);
  // 되돌리기 기록의 표 이름은 허용 목록만(코덱스 검토)
  const me = await db.one('select id from users where email = $1', ['teacher@example.com']);
  const cmd = await db.one(
    "insert into ai_commands(user_id, status, applied_at, changes) values ($1, 'applied', now(), $2::jsonb) returning id",
    [me.id, JSON.stringify([{ kind: 'created', entity: 'tasks where true --', id: crypto.randomUUID(), label: 'x' }])],
  );
  out.undoBad = (await call('POST', `/ai/commands/${cmd.id}/undo`)).body.message;
  // 시트·설문 연결: 구글 로그인 없이(이 기기에만) 연결하려 하면 안내, 목록은 서버 판 코드로 빈 목록
  out.connectors = (await call('GET', '/connectors')).body;
  out.connectNoGoogle = (await call('POST', '/connectors', { type: 'google_sheets', pin: '000000' })).body.message;
  out.webhook = (await call('POST', '/connectors', { type: 'webhook', pin: '000000', name: 'x' })).body.message;
  out.changes = changes;
  await db.close();
  return out;
}
