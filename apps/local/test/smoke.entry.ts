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
  // 내 메뉴(2026-11-28): 고른 추천으로 만들기 — 새 표는 같은 이름이면 한 번만, 틀에 안 맞는 것은 거부, 열쇠 없으면 추천 안내
  const draft = (o: Record<string, unknown>) => ({ label: '메뉴', icon: 'sparkle', description: '', action_type: 'ask_ai', prompt: null, url: null, panel: null, table_id: null, new_table: null, reason: '', ...o });
  const counsel = { name: '상담 기록', columns: [{ name: '날짜', type: 'date' }, { name: '학생', type: 'text' }, { name: '내용', type: 'text' }, { name: '날짜', type: 'text' }] };
  const menuRes = await call('POST', '/menus', {
    menus: [
      draft({ label: '오늘 할 일 정리', icon: 'tasks', action_type: 'ask_ai', prompt: '오늘 할 일을 급한 순서로 정리해 줘' }),
      draft({ label: '상담 기록 추가', icon: 'edit', action_type: 'add_row', new_table: counsel }),
      draft({ label: '상담 기록 보기', icon: 'table', action_type: 'open_table', new_table: counsel }),
      draft({ label: '나이스', icon: 'link', action_type: 'link', url: 'https://www.neis.go.kr' }),
      draft({ label: '알림', icon: 'nope', action_type: 'open_panel', panel: 'notifications' }),
    ],
  });
  out.menuCreate = menuRes.status;
  out.menus = menuRes.body.map((m: any) => [m.label, m.icon, m.action.type]);
  out.menuTables = (await call('GET', '/tables')).body.filter((t: any) => t.name === '상담 기록').map((t: any) => t.schema.columns.map((c: any) => c.name));
  out.menuSameTable = menuRes.body[1].action.table_id === menuRes.body[2].action.table_id;
  out.menuBadLink = (await call('POST', '/menus', { menus: [draft({ label: '나쁜', action_type: 'link', url: 'javascript:alert(1)' })] })).body.message;
  out.menuBadType = (await call('POST', '/menus', { menus: [draft({ label: '나쁜', action_type: 'run_code' })] })).body.message;
  out.menuNoKey = (await call('POST', '/menus/recommend', { text: '상담 기록과 출결을 관리하고 싶어' })).body.message;
  await call('PUT', '/menus/order', { ids: [menuRes.body[3].id, menuRes.body[0].id] });
  await call('DELETE', `/menus/${menuRes.body[4].id}`);
  await call('PATCH', `/menus/${menuRes.body[0].id}`, { label: '할 일 정리' });
  out.menusAfter = (await call('GET', '/menus')).body.map((m: any) => m.label);
  // 처음 접속 안내 표시
  out.onboardedBefore = (await call('GET', '/settings')).body.onboarded;
  await call('PUT', '/settings', { onboarded: true });
  out.onboardedAfter = (await call('GET', '/settings')).body.onboarded;
  // 메뉴는 내보내기에 담기고, 메뉴 표가 없던 예전 파일도 받아 준다
  const withMenus = (await call('GET', '/data/export')).body;
  out.exportMenus = withMenus.tables.menu_items.length;
  const old = JSON.parse(JSON.stringify(withMenus));
  delete old.tables.menu_items;
  out.importOld = (await call('POST', '/data/import', { pin: '000000', data: old })).status;
  out.menusAfterOld = (await call('GET', '/menus')).body.length;
  out.changes = changes;
  await db.close();
  return out;
}
