import { openLocalDb } from '../src/db';
import { createLocalApp } from '../src/app';
import { config } from '../src/shim/config';
import { SharesService } from '../../api/src/shares/shares.service';
import { ItemsService } from '../../api/src/items/items.service';
import { TablesService } from '../../api/src/tables/tables.service';
import { CommandsService } from '../../api/src/ai/commands.service';
import { BoardsService } from '../../api/src/boards/boards.service';
import { NotificationsService } from '../../api/src/notifications/notifications.service';
import { MenusService } from '../../api/src/menus/menus.service';
import { MemoryService } from '../../api/src/memory/memory.service';
import { AiService } from '../../api/src/ai/ai.service';
import { FilesService } from '../../api/src/files/files.service';
import { QuizzesService } from '../../api/src/quizzes/quizzes.service';
import { TuildersService } from '../../api/src/tuilders/tuilders.service';
import { runWithBoard } from '../src/shim/board-context';

export async function run() {
  const db = await openLocalDb();
  let changes = 0;
  const app = await createLocalApp(db, { email: 'Teacher@Example.com', name: '선생님' }, { onChange: () => changes++ });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.fetch('/api' + path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const out: Record<string, unknown> = {};
  out.routes = app.list().length;
  out.status = (await call('GET', '/auth/status')).body;
  const board = await call('GET', '/boards/current');
  out.board = {
    status: board.status,
    blocks: board.body.blocks.map((b: any) => b.type),
  };
  out.createTask = (await call('POST', '/tasks', { title: '동의서 걷기', due_at: null })).status;
  out.tasks = (await call('GET', '/tasks')).body.map((t: any) => t.title);
  out.badTask = await call('POST', '/tasks', { title: '' });
  const memo = board.body.blocks.find((b: any) => b.type === 'memo');
  out.patchBlock = (
    await call('PATCH', `/blocks/${memo.id}`, {
      config: { color: 'pink', text: '메모' },
    })
  ).status;
  out.deleteBlock = (await call('DELETE', `/blocks/${memo.id}`)).status;
  out.trash = (await call('GET', '/trash')).body.map((t: any) => t.kind);
  out.settings = Object.keys((await call('GET', '/settings')).body);
  out.theme = (await call('PATCH', '/boards/current/theme', { bg: 'mint' })).body;
  out.notFound = (await call('GET', '/no-such-route')).status;
  // AI: 열쇠가 없으면 오류 이벤트가 흘러나와야 한다
  const ai = await app.fetch('/api/ai/messages', {
    method: 'POST',
    body: JSON.stringify({ text: '안녕' }),
  });
  out.ai = {
    status: ai.status,
    type: ai.headers.get('content-type'),
    text: (await ai.text()).slice(0, 160),
  };
  // 파일로 표 만들기(메모리 디스크·Buffer·한글 파일 이름)
  const fd = new FormData();
  fd.set(
    'file',
    new File(['이름,점수\n가나,1\n다라,2\n'], '성적표.csv', {
      type: 'text/csv',
    }),
  );
  const up = await app.fetch('/api/uploads', { method: 'POST', body: fd });
  const u = await up.json();
  out.upload = {
    status: up.status,
    filename: u.filename,
    header: u.header,
    total: u.total,
  };
  const made = await call('POST', '/tables', {
    name: '성적',
    upload_id: u.upload_id,
    columns: u.header.map((h: string, i: number) => ({
      name: h,
      type: u.guess[i],
      source: i,
    })),
  });
  out.tableStatus = made.status;
  out.rows = (await call('GET', `/tables/${made.body.table.id}/rows?page=1&size=10`)).body.rows?.length;
  // 서버 트랙과 같은 내보내기·가져오기 주소(같은 코드)
  const exported = (await call('GET', '/data/export')).body;
  out.exportTables = Object.keys(exported.tables).length;
  await call('POST', '/tasks', {
    title: '가져오면 사라질 할 일',
    due_at: null,
  });
  const imp = await call('POST', '/data/import', {
    pin: '000000',
    data: exported,
  });
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
  evil.tables.blocks = [
    {
      ...exported.tables.blocks[0],
      id: crypto.randomUUID(),
      board_id: otherBoard.id,
    },
  ];
  out.importForeign = (await call('POST', '/data/import', { pin: '000000', data: evil })).body.message;
  out.tasksAfterForeign = (await call('GET', '/tasks')).body.map((t: any) => t.title);
  // 되돌리기 기록의 표 이름은 허용 목록만(코덱스 검토)
  const me = await db.one('select id from users where email = $1', ['teacher@example.com']);
  const cmd = await db.one("insert into ai_commands(user_id, status, applied_at, changes) values ($1, 'applied', now(), $2::jsonb) returning id", [
    me.id,
    JSON.stringify([
      {
        kind: 'created',
        entity: 'tasks where true --',
        id: crypto.randomUUID(),
        label: 'x',
      },
    ]),
  ]);
  out.undoBad = (await call('POST', `/ai/commands/${cmd.id}/undo`)).body.message;
  // 시트·설문 연결: 구글 로그인 없이(이 기기에만) 연결하려 하면 안내, 목록은 서버 판 코드로 빈 목록
  out.connectors = (await call('GET', '/connectors')).body;
  out.connectNoGoogle = (await call('POST', '/connectors', { type: 'google_sheets', pin: '000000' })).body.message;
  out.webhook = (
    await call('POST', '/connectors', {
      type: 'webhook',
      pin: '000000',
      name: 'x',
    })
  ).body.message;
  // 내 메뉴(2026-11-28): 고른 추천으로 만들기 — 새 표는 같은 이름이면 한 번만, 틀에 안 맞는 것은 거부, 열쇠 없으면 추천 안내
  const draft = (o: Record<string, unknown>) => ({
    label: '메뉴',
    icon: 'sparkle',
    description: '',
    action_type: 'ask_ai',
    prompt: null,
    url: null,
    panel: null,
    table_id: null,
    new_table: null,
    reason: '',
    ...o,
  });
  const counsel = {
    name: '상담 기록',
    columns: [
      { name: '날짜', type: 'date' },
      { name: '학생', type: 'text' },
      { name: '내용', type: 'text' },
      { name: '날짜', type: 'text' },
    ],
  };
  const menuRes = await call('POST', '/menus', {
    menus: [
      draft({
        label: '오늘 할 일 정리',
        icon: 'tasks',
        action_type: 'ask_ai',
        prompt: '오늘 할 일을 급한 순서로 정리해 줘',
      }),
      draft({
        label: '상담 기록 추가',
        icon: 'edit',
        action_type: 'add_row',
        new_table: counsel,
      }),
      draft({
        label: '상담 기록 보기',
        icon: 'table',
        action_type: 'open_table',
        new_table: counsel,
      }),
      draft({
        label: '나이스',
        icon: 'link',
        action_type: 'link',
        url: 'https://www.neis.go.kr',
      }),
      draft({
        label: '알림',
        icon: 'nope',
        action_type: 'open_panel',
        panel: 'notifications',
      }),
    ],
  });
  out.menuCreate = menuRes.status;
  out.menus = menuRes.body.map((m: any) => [m.label, m.icon, m.action.type]);
  out.menuTables = (await call('GET', '/tables')).body.filter((t: any) => t.name === '상담 기록').map((t: any) => t.schema.columns.map((c: any) => c.name));
  out.menuSameTable = menuRes.body[1].action.table_id === menuRes.body[2].action.table_id;
  out.menuBadLink = (
    await call('POST', '/menus', {
      menus: [
        draft({
          label: '나쁜',
          action_type: 'link',
          url: 'javascript:alert(1)',
        }),
      ],
    })
  ).body.message;
  out.menuBadType = (
    await call('POST', '/menus', {
      menus: [draft({ label: '나쁜', action_type: 'run_code' })],
    })
  ).body.message;
  out.menuNoKey = (
    await call('POST', '/menus/recommend', {
      text: '상담 기록과 출결을 관리하고 싶어',
    })
  ).body.message;
  await call('PUT', '/menus/order', {
    ids: [menuRes.body[3].id, menuRes.body[0].id],
  });
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
  // 공유 링크(2026-11-28): 서버 트랙 방식(/s/<열쇠>) — 같은 서비스 코드를 직접 부른다
  const meRow = await db.one('select * from users where email = $1', ['teacher@example.com']);
  await call('POST', '/tasks', {
    title: '<script>alert(1)</script> 동의서 900101-1234567',
    due_at: null,
  });
  const blocksNow = (await call('GET', '/boards/current')).body.blocks;
  const tasksBlock = blocksNow.find((b: any) => b.type === 'tasks');
  const notiBlock = blocksNow.find((b: any) => b.type === 'notifications');
  const tbl = (
    await call('POST', '/tables', {
      name: '제출 현황',
      columns: [
        { name: '이름', type: 'text' },
        { name: '전화', type: 'text' },
        { name: '제출', type: 'boolean' },
      ],
      rows: [['가나', '010-1111-2222', 'true']],
    })
  ).body;
  const tableId = tbl.table?.id ?? tbl.id;
  const tblBlock = (
    await call('POST', '/blocks', {
      type: 'table',
      title: '제출 현황',
      source_table_id: tableId,
    })
  ).body;
  const phoneCol = (await call('GET', '/tables')).body.find((t: any) => t.id === tableId).schema.columns.find((c: any) => c.name === '전화').id;
  const drive: { calls: string[] } = { calls: [] };
  const fakeConnectors = { driveToken: async () => 'drive-tok' } as any;
  const svc = new SharesService(db as any, new ItemsService(db as any), new TablesService(db as any), fakeConnectors);
  config.shareMode = 'server';
  const s1 = await svc.create(meRow, { block_id: tasksBlock.id, days: 30 });
  out.shareUrl = s1.url.replace(/[0-9a-f]{48}$/, '<열쇠>');
  const token = s1.url.slice(-48);
  const page1 = (await svc.publicPage(token)) ?? '';
  out.sharePage = {
    hasTask: page1.includes('동의서'),
    scriptEscaped: !page1.includes('<script>') && page1.includes('&lt;script&gt;'),
    rrnMasked: page1.includes('900101-*******') && !page1.includes('1234567'),
    noindex: page1.includes('noindex'),
  };
  const s2 = await svc.create(meRow, {
    block_id: tblBlock.id ?? tblBlock.block?.id,
    days: 7,
    options: { hide_columns: [phoneCol] },
  });
  const page2 = (await svc.publicPage(s2.url.slice(-48))) ?? '';
  out.shareTable = {
    name: page2.includes('가나'),
    phoneHidden: !page2.includes('010-1111-2222') && !page2.includes('>전화<'),
    yes: page2.includes('예'),
  };
  // 공유한 뒤 더한 칸은 보이지 않는다, 숫자 칸의 카드번호 모양도 가린다(코덱스 검토)
  await call('PATCH', `/tables/${tableId}/schema`, {
    ops: [
      { op: 'add', name: '주소', type: 'text' },
      { op: 'add', name: '카드', type: 'number' },
    ],
  }).catch(() => undefined);
  const cols2 = (await call('GET', '/tables')).body.find((t: any) => t.id === tableId).schema.columns;
  const rowId = (await call('GET', `/tables/${tableId}/rows?page=1&size=5`)).body.rows[0].id;
  const addrCol = cols2.find((c: any) => c.name === '주소');
  const cardCol = cols2.find((c: any) => c.name === '카드');
  if (addrCol && cardCol)
    await call('PATCH', `/tables/${tableId}/rows/${rowId}`, {
      values: { [addrCol.id]: '비밀 주소', [cardCol.id]: 4111111111111111 },
    });
  const page2b = (await svc.publicPage(s2.url.slice(-48))) ?? '';
  out.shareNewCol = {
    added: Boolean(addrCol && cardCol),
    addrHidden: !page2b.includes('비밀 주소') && !page2b.includes('>주소<'),
  };
  const s3 = await svc.create(meRow, {
    block_id: tblBlock.id ?? tblBlock.block?.id,
    days: 7,
  });
  const page3 = (await svc.publicPage(s3.url.slice(-48))) ?? '';
  out.shareCardMasked = page3.includes('****-****-****-1111') && !page3.includes('4,111,111');
  out.sharePreview = (await svc.preview(meRow, { block_id: tasksBlock.id })).html.includes('미리 보기');
  out.shareNoti = await svc.create(meRow, { block_id: notiBlock.id }).then(
    () => 'ok',
    (e: any) => e.message,
  );
  out.shareBadDays = await svc.create(meRow, { block_id: tasksBlock.id, days: 5 }).then(
    () => 'ok',
    (e: any) => e.message,
  );
  out.shareViews = (await svc.list(meRow.id, tasksBlock.id))[0].view_count;
  await svc.revoke(meRow, s1.id);
  out.shareAfterRevoke = await svc.publicPage(token);
  await db.query("update shares set expires_at = now() - interval '1 minute' where id = $1", [s2.id]);
  out.shareAfterExpire = await svc.publicPage(s2.url.slice(-48));
  out.shareBadToken = await svc.publicPage('../../etc');
  // 구글 드라이브 트랙: 비공개 문서 → 기록 → 공개 권한, 끄기는 권한을 지운 뒤 휴지통(코덱스 검토)
  config.shareMode = 'drive';
  const realFetch = globalThis.fetch;
  let failPerm = false;
  let failRevoke = false;
  let revokeDuring = false;
  globalThis.fetch = (async (url: string, init: any = {}) => {
    const m = init.method ?? 'GET';
    const path = String(url).replace('https://www.googleapis.com', '').split('?')[0];
    drive.calls.push(`${m} ${path}`);
    if (path.includes('/permissions') && m === 'POST' && revokeDuring) await db.query('update shares set revoked_at = now() where external_url is null and revoked_at is null');
    if (path.includes('/permissions') && m === 'POST') return failPerm ? new Response('{"error":{"message":"x"}}', { status: 500 }) : new Response('{"id":"anyoneWithLink"}', { status: 200 });
    if (path.includes('/permissions') && m === 'DELETE') return new Response(null, { status: failRevoke ? 500 : 204 });
    if (m === 'POST')
      return new Response(
        JSON.stringify({
          id: 'doc1',
          webViewLink: 'https://docs.google.com/document/d/doc1/view',
        }),
        { status: 200 },
      );
    return new Response('{}', { status: 200 });
  }) as any;
  try {
    const d1 = await svc.create(meRow, { block_id: tasksBlock.id, days: 30 });
    out.driveShare = { url: d1.url, mode: d1.mode, expires: d1.expires_at };
    await svc.refresh(meRow, d1.id);
    failRevoke = true;
    out.driveRevokeFail = await svc.revoke(meRow, d1.id).then(
      () => 'ok',
      (e: any) => e.message,
    );
    out.driveStillOn = (await svc.list(meRow.id, tasksBlock.id)).find((x) => x.id === d1.id)?.revoked_at === null;
    failRevoke = false;
    await svc.revoke(meRow, d1.id);
    out.driveOff = (await svc.list(meRow.id, tasksBlock.id)).find((x) => x.id === d1.id)?.revoked_at !== null;
    const before = (await svc.list(meRow.id)).length;
    failPerm = true;
    drive.calls.push('--- 권한 실패');
    out.drivePermFail = await svc.create(meRow, { block_id: tasksBlock.id }).then(
      () => 'ok',
      (e: any) => e.message,
    );
    out.drivePermFailNoRow = (await svc.list(meRow.id)).length === before;
    failPerm = false;
    revokeDuring = true;
    drive.calls.push('--- 만드는 중 끄기');
    out.driveRevokedDuring = await svc.create(meRow, { block_id: tasksBlock.id }).then(
      () => 'ok',
      (e: any) => e.message,
    );
    revokeDuring = false;
  } finally {
    globalThis.fetch = realFetch;
    config.shareMode = 'drive';
  }
  out.driveCalls = drive.calls;
  // 말로 관리(AI 도구) — 계획 → 승인 → 되돌리기
  config.shareMode = 'server';
  const tablesSvc = new TablesService(db as any);
  const cmds = new CommandsService(
    db as any,
    new BoardsService(db as any),
    new ItemsService(db as any),
    tablesSvc,
    new NotificationsService(db as any),
    fakeConnectors,
    new MenusService(db as any, {} as any, tablesSvc),
    svc,
    new MemoryService(db as any),
    new FilesService(db as any),
    new QuizzesService(db as any),
  );
  const runPlan = async (tool: string, input: Record<string, any>) => {
    const prep = await cmds.prepare(meRow, tool, input);
    if (!prep.ok) return { error: prep.error };
    const plan = await cmds.propose(meRow.id, null, [prep.step]);
    await cmds.apply(meRow, plan.id);
    return { id: plan.id, detail: prep.step.detail };
  };
  // 수업 보드·즉석 퀴즈(2026-11-28): 수업 보드에서 계획 → 업무 보드에서 승인해도 수업 보드에 놓임, 학생 응답·집계·마감·되돌리기
  const quizPlan = await runWithBoard('class', async () => {
    const prep = await cmds.prepare(meRow, 'create_quiz', {
      title: '분수 퀴즈',
      questions: [
        { type: 'choice', text: '1/2 + 1/2 = ?', options: ['1', '2/4'], answer: 0 },
        { type: 'ox', text: '1/3 은 1/2 보다 크다', answer: 'X' },
        { type: 'short', text: '오늘 배운 점' },
      ],
    });
    if (!prep.ok) throw new Error(prep.error);
    return cmds.propose(meRow.id, null, [prep.step]);
  });
  const badQuiz = await cmds.prepare(meRow, 'create_quiz', { title: 'x', questions: [{ type: 'choice', text: 'a', options: ['1'], answer: 0 }] });
  const quizApplied = await cmds.apply(meRow, quizPlan.id);
  const quizId = quizApplied.touched?.find((t: any) => t.entity === 'quizzes')?.id as string;
  const quizSvc = new QuizzesService(db as any);
  const qtok = (await db.query<{ token: string }>('select token from quizzes where id = $1', [quizId]))[0]!.token;
  const qs1 = await quizSvc.submit(qtok, '1.1.1.1', { name: '12번', q1: '0', q2: 'X', q3: '통분' });
  const qs2 = await quizSvc.submit(qtok, '1.1.1.1', { name: '13번', q1: '1', q2: 'X', q9: 'zz' });
  const sNoName = await quizSvc.submit(qtok, '1.1.1.1', { name: ' ', q1: '0' });
  const sBot = await quizSvc.submit(qtok, '1.1.1.1', { name: 'bot', homepage: 'spam', q1: '0' });
  const sBadOpt = await quizSvc.submit(qtok, '1.1.1.1', { name: '14번', q1: '7' });
  const st = await quizSvc.stats(meRow.id, quizId);
  const boardTypes = async (kind: string) =>
    (await db.query<{ type: string }>('select b.type from blocks b join boards o on o.id = b.board_id where o.kind = $1 and b.deleted_at is null', [kind])).map((r) => r.type).sort();
  const classTypes = await boardTypes('class');
  const workTypes = await boardTypes('work');
  await quizSvc.setStatus(meRow.id, quizId, 'closed');
  const sClosed = await quizSvc.submit(qtok, '1.1.1.1', { name: '15번', q1: '0' });
  const quizUndo = await cmds.undo(meRow, quizPlan.id);
  out.quiz = {
    badQuiz: badQuiz.ok ? '' : badQuiz.error,
    detail: quizApplied.steps[0]?.detail,
    submits: [qs1.ok, qs2.ok],
    noName: sNoName.ok ? '' : sNoName.message,
    badOpt: sBadOpt.ok ? '' : sBadOpt.message,
    botOk: sBot.ok,
    total: st.total,
    avg: st.avg_score,
    graded: st.graded,
    q1: st.questions[0]!.counts,
    q2correct: st.questions[1]!.correct,
    short: st.questions[2]!.top,
    classTypes,
    workHasQuiz: workTypes.includes('quiz'),
    closed: sClosed.ok ? 'ok' : (sClosed as any).status,
    undoSkipped: quizUndo.skipped,
    quizKept: (await db.query('select 1 from quizzes where id = $1 and deleted_at is null', [quizId])).length,
    blockKept: (await boardTypes('class')).includes('quiz'),
    boardAfter: (await call('GET', '/boards/current')).body.kind,
  };
  // 구글 설문 퀴즈(가짜 Forms): 만들기 → 응답 읽기(같은 응답 두 번 읽어도 한 번만) → 숨김 유지 → 마감 때 응답 받기 끄기 실패 알림
  const gq = new QuizzesService(db as any, { formsToken: async () => 'tok' } as any);
  const gForms: any[] = [
    {
      responseId: 'r1',
      lastSubmittedTime: '2026-11-28T01:00:00Z',
      answers: { N: { textAnswers: { answers: [{ value: '3번' }] } }, Q1: { textAnswers: { answers: [{ value: '1' }] } }, Q2: { textAnswers: { answers: [{ value: 'X' }] } } },
    },
    {
      responseId: 'r2',
      lastSubmittedTime: '2026-11-28T01:01:00Z',
      answers: { N: { textAnswers: { answers: [{ value: '4번' }] } }, Q1: { textAnswers: { answers: [{ value: '2/4' }] } }, Q2: { textAnswers: { answers: [{ value: 'X' }] } } },
    },
  ];
  const gFetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.endsWith('/v1/forms')) return new Response(JSON.stringify({ formId: 'GF1', responderUri: 'https://docs.google.com/forms/d/e/R1/viewform' }));
    if (url.includes(':batchUpdate')) {
      const ids = ['N', 'Q1', 'Q2'];
      return new Response(
        JSON.stringify({
          form: {
            responderUri: 'https://docs.google.com/forms/d/e/R1/viewform',
            items: body.requests
              .filter((r: any) => r.createItem)
              .map((r: any, i: number) => ({ title: r.createItem.item.title, questionItem: { question: { questionId: ids[i], ...r.createItem.item.questionItem.question } } })),
          },
        }),
      );
    }
    if (url.includes('/responses')) return new Response(JSON.stringify({ responses: gForms }));
    if (url.includes(':setPublishSettings')) return new Response(JSON.stringify({ error: { message: 'legacy' } }), { status: 400 });
    return new Response('{}');
  }) as unknown as typeof fetch;
  const gSpec = {
    title: '구글 분수',
    questions: [
      { id: 'q1', type: 'choice' as const, text: 'a', options: ['1', '2/4'], answer: 0 },
      { id: 'q2', type: 'ox' as const, text: 'b', answer: 'X' as const },
    ],
  };
  const gQuiz = await gq.create(meRow.id, gSpec, db as any, null, 120, 'google', gFetch);
  const gs1 = await gq.sync(meRow.id, gQuiz.id, gFetch);
  const gs2 = await gq.sync(meRow.id, gQuiz.id, gFetch);
  const gStats = await gq.stats(meRow.id, gQuiz.id);
  await gq.hideResponse(meRow.id, gQuiz.id, gStats.responses[1]!.id, true);
  await gq.sync(meRow.id, gQuiz.id, gFetch);
  const gClosed = await gq.setStatus(meRow.id, gQuiz.id, 'closed', gFetch);
  const gAfter = await gq.stats(meRow.id, gQuiz.id);
  // 고쳐 낸 응답은 바뀐 답으로(3번이 2/4 로 고침), 쌤보드 사본을 지우면 다시 읽어도 돌아오지 않음
  gForms[0] = { ...gForms[0], lastSubmittedTime: '2026-11-28T02:00:00Z', answers: { ...gForms[0].answers, Q1: { textAnswers: { answers: [{ value: '2/4' }] } } } };
  await gq.sync(meRow.id, gQuiz.id, gFetch);
  const gEdited = (await gq.stats(meRow.id, gQuiz.id)).questions[0]!.counts;
  const gCleared = await gq.clearResponses(meRow.id, gQuiz.id);
  const gResync = await gq.sync(meRow.id, gQuiz.id, gFetch);
  const gAfterClear = (await gq.stats(meRow.id, gQuiz.id)).total;
  const gRotate = await gq.rotate(meRow.id, gQuiz.id).then(
    () => 'ok',
    (e: any) => String(e.message),
  );
  const gPage = await gq.byToken((await db.query<{ token: string }>('select token from quizzes where id = $1', [gQuiz.id]))[0]!.token);
  out.gquiz = {
    url: gQuiz.url,
    source: gQuiz.source,
    closesAt: gQuiz.closes_at,
    added: [gs1.added, gs2.added],
    names: gStats.responses.map((r) => r.name),
    q1: gStats.questions[0]!.counts,
    avg: gStats.avg_score,
    totalAfterHide: gAfter.total,
    closedStatus: gClosed.status,
    note: gClosed.note ?? '',
    rotate: gRotate,
    studentPage: gPage === null,
    edited: gEdited,
    cleared: gCleared,
    resyncAdded: gResync.added,
    afterClear: gAfterClear,
  };
  // 보드마다 내 메뉴: 수업 보드에서 AI 로 만든 메뉴는 수업 보드에만, 업무 보드 메뉴는 그대로
  const workMenusBefore = await call('GET', '/menus').then((r: any) => r.body.length);
  const mPlan = await runWithBoard('class', async () => {
    const prep = await cmds.prepare(meRow, 'create_menu', { label: '퀴즈 결과', icon: 'chart', action_type: 'ask_ai', prompt: '방금 퀴즈 결과 정리해 줘' });
    if (!prep.ok) throw new Error(prep.error);
    return cmds.propose(meRow.id, null, [prep.step]);
  });
  await cmds.apply(meRow, mPlan.id);
  const menuKinds = await db.query<{ board_kind: string; label: string }>("select board_kind, label from menu_items where label = '퀴즈 결과'");
  out.boardMenus = {
    kinds: menuKinds.map((m) => m.board_kind),
    workSame: (await call('GET', '/menus').then((r: any) => r.body.length)) === workMenusBefore,
  };
  // 수업 자료(add_links): 새 블록 → 같은 블록에 더하기 → 되돌리면 앞 상태로
  const lk1 = await runWithBoard('class', async () => {
    const prep = await cmds.prepare(meRow, 'add_links', { title: '분수 자료', items: [{ url: 'https://docs.google.com/presentation/d/1AbC/edit', title: '도입', student: true }] });
    if (!prep.ok) throw new Error(prep.error);
    return cmds.propose(meRow.id, null, [prep.step]);
  });
  const lk1a = await cmds.apply(meRow, lk1.id);
  const linkBlockId = lk1a.touched?.find((t: any) => t.entity === 'blocks')?.id as string;
  const lkBad = await cmds.prepare(meRow, 'add_links', { items: [{ url: 'javascript:alert(1)' }] });
  const lkDup = await cmds.prepare(meRow, 'add_links', { block_id: linkBlockId, items: [{ url: 'https://docs.google.com/presentation/d/1AbC/edit' }] });
  const lk2prep = await cmds.prepare(meRow, 'add_links', { block_id: linkBlockId, items: [{ url: 'https://youtu.be/xyz' }] });
  if (!lk2prep.ok) throw new Error(lk2prep.error);
  const lk2 = await cmds.propose(meRow.id, null, [lk2prep.step]);
  await cmds.apply(meRow, lk2.id);
  const linkItems = async () =>
    ((await db.query<{ config: any }>('select config from blocks where id = $1', [linkBlockId]))[0]?.config.items ?? []).map((i: any) => `${i.kind}:${i.title}:${i.student}`);
  const linksAfterAdd = await linkItems();
  await cmds.undo(meRow, lk2.id);
  out.links = {
    bad: lkBad.ok ? '' : lkBad.error,
    dup: lkDup.ok ? '' : lkDup.error,
    conflict: await call('PATCH', `/blocks/${linkBlockId}`, { config: { items: [] }, items_base: 'old' }).then((r: any) => r.status),
    board: (await db.query<{ kind: string }>('select o.kind from blocks b join boards o on o.id = b.board_id where b.id = $1', [linkBlockId]))[0]?.kind,
    afterAdd: linksAfterAdd,
    afterUndo: await linkItems(),
  };
  const menuLabels = async () => (await call('GET', '/menus')).body.map((m: any) => m.label);
  await db.query('delete from menu_items');
  const c1 = await runPlan('create_menu', {
    label: '결석계 접수',
    icon: 'edit',
    action_type: 'add_row',
    new_table: {
      name: '결석계',
      columns: [
        { name: '날짜', type: 'date' },
        { name: '학생', type: 'text' },
        { name: '사유', type: 'text' },
      ],
    },
  });
  out.aiMenuCreate = {
    detail: c1.detail,
    menus: await menuLabels(),
    table: (await call('GET', '/tables')).body.some((t: any) => t.name === '결석계'),
  };
  const c2 = await runPlan('create_menu', {
    label: '나이스',
    icon: 'link',
    action_type: 'link',
    url: 'https://www.neis.go.kr',
  });
  const ids = (await call('GET', '/menus')).body.map((m: any) => m.id);
  const c3 = await runPlan('update_menu', {
    id: ids[1],
    label: '나이스 열기',
    index: 0,
  });
  out.aiMenuUpdate = await menuLabels();
  await cmds.undo(meRow, c3.id!);
  out.aiMenuUpdateUndo = await menuLabels();
  const c4 = await runPlan('delete_menu', { id: ids[0] });
  out.aiMenuDelete = await menuLabels();
  await cmds.undo(meRow, c4.id!);
  out.aiMenuDeleteUndo = await menuLabels();
  await cmds.undo(meRow, c2.id!);
  await cmds.undo(meRow, c1.id!);
  out.aiMenuCreateUndo = {
    menus: await menuLabels(),
    table: (await call('GET', '/tables')).body.some((t: any) => t.name === '결석계'),
  };
  out.aiMenuBadLink = (await cmds.prepare(meRow, 'create_menu', {
    label: 'x',
    icon: 'link',
    action_type: 'link',
    url: 'http://a.b',
  })) as any;
  const evBlock = (await call('GET', '/boards/current')).body.blocks.find((b: any) => b.type === 'events');
  const c5 = await runPlan('update_block', { id: evBlock.id, event_days: 7 });
  out.aiBlockView = {
    detail: c5.detail,
    days: (await call('GET', '/boards/current')).body.blocks.find((b: any) => b.id === evBlock.id).config.event_days,
  };
  out.aiBlockWrongType = (
    (await cmds.prepare(meRow, 'update_block', {
      id: evBlock.id,
      task_filter: 'open',
    })) as any
  ).error;
  await cmds.undo(meRow, c5.id!);
  out.aiBlockViewUndo = (await call('GET', '/boards/current')).body.blocks.find((b: any) => b.id === evBlock.id).config.event_days ?? null;
  const c6 = await runPlan('create_share', {
    block_id: tblBlock.id ?? tblBlock.block?.id,
    hide_columns: ['전화'],
    days: 7,
  });
  const aiShare = (await svc.list(meRow.id)).find((x) => x.revoked_at === null && x.title === '제출 현황' && x.options.show_columns && !x.options.show_columns.includes(phoneCol));
  out.aiShare = {
    detail: c6.detail,
    made: Boolean(aiShare),
    page: ((await svc.publicPage(aiShare!.url.slice(-48))) ?? '').includes('가나'),
  };
  await cmds.undo(meRow, c6.id!);
  out.aiShareUndo = await svc.publicPage(aiShare!.url.slice(-48));
  // 기억: remember·forget 계획 → 승인 → 되돌리기, 대화 이어 가기·앞부분 요약, 안내문에 기억·요약이 함께
  const memSvc = new MemoryService(db as any);
  const m1 = await runPlan('remember', {
    text: '5학년 3반 담임, 학부모 문자는 존댓말로 세 줄 이내',
  });
  out.memAfterRemember = (await call('GET', '/memories')).body.map((m: any) => m.text);
  const memId = (await call('GET', '/memories')).body[0].id;
  const m2 = await runPlan('forget', { id: memId });
  out.memAfterForget = (await call('GET', '/memories')).body.length;
  await cmds.undo(meRow, m2.id!);
  out.memAfterUndoForget = (await call('GET', '/memories')).body.length;
  out.memRememberRrn = (
    (await cmds.prepare(meRow, 'remember', {
      text: '학생 900101-1234567',
    })) as any
  ).step?.detail;
  const seen: any[] = [];
  const fakeAdapter = {
    provider: 'anthropic',
    stream: async (req: any) => {
      seen.push(req);
      return {
        content: [{ type: 'text', text: '네' }],
        text: '네',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
    json: async (req: any) => {
      seen.push({ json: req });
      return {
        data: { summary: '앞에서 체험학습 일정을 정했다.' },
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
    toolResults: () => ({ role: 'user', content: [] }),
  };
  const fakeLlm = {
    context: async () => ({ adapter: fakeAdapter, apiKey: 'k', model: 'm' }),
    record: async () => undefined,
    assertBudget: async () => undefined,
  } as any;
  const aiSvc = new AiService(
    db as any,
    fakeLlm,
    cmds,
    new BoardsService(db as any),
    new ItemsService(db as any),
    tablesSvc,
    new NotificationsService(db as any),
    new MenusService(db as any, fakeLlm, tablesSvc),
    svc,
    memSvc,
    new FilesService(db as any),
    new QuizzesService(db as any),
    new TuildersService(),
  );
  let convId: string | undefined;
  for (let n = 1; n <= 11; n++) await aiSvc.run(meRow, { text: `${n}번째 말`, conversation_id: convId }, (e: any) => e.type === 'done' && (convId = e.conversation_id));
  const last = seen.filter((x) => !x.json).at(-1);
  out.memConv = {
    convs: (await call('GET', '/ai/conversations')).body.map((c: any) => [c.title, c.summarized]),
    messages: (await call('GET', `/ai/conversations/${convId}/messages`)).body.length,
    summaryAsked: seen.some((x) => x.json && /이어 가기 위한 요약/.test(x.json.system)),
    lastHasSummary: JSON.stringify(last.messages).includes('<conversation_summary>') && JSON.stringify(last.messages).includes('체험학습 일정을 정했다'),
    lastHistory: last.messages.length,
    systemHasMemory: last.system.includes('학부모 문자는 존댓말로'),
    tailHasNow: /지금은 .*입니다/.test(last.systemTail ?? '') && !last.system.includes('UTC+'),
  };
  // 파일 고치기: 엑셀을 붙이면 file_id 와 칸 주소로 보이고, edit_file 계획 → 승인 → 고친 파일 내려받기
  const ExcelJS = (await import('exceljs')).default;
  const wbIn = new ExcelJS.Workbook();
  const wsIn = wbIn.addWorksheet('성적');
  wsIn.addRow(['이름', '점수']);
  wsIn.addRow(['가나', 55]);
  const xlsxB64 = Buffer.from(await wbIn.xlsx.writeBuffer()).toString('base64');
  let planId = '';
  const fileSeen: string[] = [];
  const editAdapter = {
    ...fakeAdapter,
    stream: async (req: any) => {
      const all = JSON.stringify(req.messages);
      fileSeen.push(all);
      const fid = /file_id=\\"([0-9a-f-]{36})\\"/.exec(all)?.[1];
      if (fid && fileSeen.length === 1) {
        return {
          content: [{ type: 'tool_use', id: 'e1', name: 'edit_file', input: {} }],
          text: '',
          toolCalls: [
            {
              id: 'e1',
              name: 'edit_file',
              input: {
                file_id: fid,
                summary: '60점 미만 빨간색',
                edits: [
                  { op: 'highlight', range: 'A2:B2', color: 'red' },
                  { op: 'set', cell: 'C1', value: '확인' },
                ],
              },
            },
          ],
          stopReason: 'tool_use',
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      }
      return {
        content: [{ type: 'text', text: '계획에 담았습니다' }],
        text: '계획에 담았습니다',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
  };
  const editLlm = {
    context: async () => ({ adapter: editAdapter, apiKey: 'k', model: 'm' }),
    record: async () => undefined,
    assertBudget: async () => undefined,
  } as any;
  const filesSvc = new FilesService(db as any);
  const cmds2 = new CommandsService(
    db as any,
    new BoardsService(db as any),
    new ItemsService(db as any),
    tablesSvc,
    new NotificationsService(db as any),
    fakeConnectors,
    new MenusService(db as any, {} as any, tablesSvc),
    svc,
    memSvc,
    filesSvc,
    new QuizzesService(db as any),
  );
  const aiEdit = new AiService(
    db as any,
    editLlm,
    cmds2,
    new BoardsService(db as any),
    new ItemsService(db as any),
    tablesSvc,
    new NotificationsService(db as any),
    new MenusService(db as any, editLlm, tablesSvc),
    svc,
    memSvc,
    filesSvc,
    new QuizzesService(db as any),
    new TuildersService(),
  );
  await aiEdit.run(
    meRow,
    {
      text: '60점 미만 빨간색으로',
      files: [{ name: '성적.xlsx', data: xlsxB64 }],
    },
    (e: any) => e.type === 'plan' && (planId = e.command.id),
  );
  const proposed = await cmds2.get(meRow.id, planId);
  const applied = await cmds2.apply(meRow, planId);
  const dl = await filesSvc.download(meRow.id, applied.files![0].id);
  const wbOut = new ExcelJS.Workbook();
  await wbOut.xlsx.load(Buffer.from(dl.data, 'base64') as any);
  out.fileEdit = {
    sawGrid: fileSeen[0].includes('행\\tA\\tB') && fileSeen[0].includes('editable=\\"xlsx\\"'),
    detail: proposed.steps[0].detail,
    files: applied.files!.map((f) => f.name),
    red: (wbOut.getWorksheet('성적')!.getCell('A2').fill as any)?.fgColor?.argb,
    c1: wbOut.getWorksheet('성적')!.getCell('C1').value,
    badFile: (
      (await cmds2.prepare(meRow, 'edit_file', {
        file_id: applied.files![0].id,
        edits: [],
      })) as any
    ).error,
  };
  // 처리 결과함(2026-11-28 UX 토론 A): 완료한 것은 파일·만료·되돌리기 가능이 보이고, 되돌린 뒤에는 되돌림·되돌리기 불가
  const listed = (await cmds2.list(meRow.id)).find((c) => c.id === planId)!;
  out.results = {
    status: listed.status,
    file: listed.files?.[0]?.name,
    expires: typeof listed.files?.[0]?.expires_at === 'string' && !listed.files?.[0]?.gone,
    undoable: listed.undoable,
    hasWhen: !!listed.applied_at,
  };
  await cmds2.undo(meRow, planId);
  const after = (await cmds2.list(meRow.id)).find((c) => c.id === planId)!;
  out.resultsAfterUndo = { status: after.status, undoable: after.undoable, files: after.files ?? [] };
  out.fileEditUndo = await filesSvc.download(meRow.id, applied.files![0].id).then(
    () => 'still',
    (e: any) => e.message,
  );
  config.shareMode = 'drive';
  out.changes = changes;
  await db.close();
  return out;
}
