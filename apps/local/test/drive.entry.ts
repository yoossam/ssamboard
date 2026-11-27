import { openLocalDb } from '../src/db';
import { createLocalApp, ensureLocalUser } from '../src/app';
import { DriveSync, exportData, importData, SYNC_TABLES, LOCAL_ONLY_TABLES } from '../src/drive';

/** 가짜 구글 드라이브: 앱 폴더 파일을 메모리에 둔다. */
function fakeDrive() {
  const files = new Map<string, { name: string; body: string; version: number; modifiedTime: string }>();
  let seq = 0;
  const meta = (id: string) => { const f = files.get(id)!; return { id, name: f.name, version: String(f.version), modifiedTime: f.modifiedTime }; };
  const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const fetchFn = async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    if (!String(init.headers?.Authorization ?? '').startsWith('Bearer ')) return new Response('', { status: 401 });
    const method = init.method ?? 'GET';
    const m = url.pathname.match(/\/files(?:\/([^/]+))?(?:\/(copy))?$/);
    const id = m?.[1]; const copy = m?.[2];
    if (method === 'GET' && !id) {
      const q = url.searchParams.get('q') ?? '';
      const eq = /name = '([^']+)'/.exec(q)?.[1]; const has = /name contains '([^']+)'/.exec(q)?.[1];
      return ok({ files: [...files.keys()].filter((k) => (eq ? files.get(k)!.name === eq : has ? files.get(k)!.name.includes(has) : true)).map(meta) });
    }
    if (method === 'GET' && id) return new Response(files.get(id)!.body, { status: 200 });
    if (method === 'POST' && copy) { const n = 'f' + ++seq; files.set(n, { ...files.get(id!)!, name: JSON.parse(init.body).name, version: 1 }); return ok({ id: n }); }
    if (method === 'POST') { const body = String(init.body); const parts = body.split(/--ssamboard\w+/); const metaJson = JSON.parse(parts[1].split('\r\n\r\n')[1]); const content = parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''); const n = 'f' + ++seq; files.set(n, { name: metaJson.name, body: content, version: 1, modifiedTime: new Date().toISOString() }); return ok(meta(n)); }
    if (method === 'PATCH') { const f = files.get(id!)!; f.body = String(init.body); f.version++; f.modifiedTime = new Date().toISOString(); return ok(meta(id!)); }
    if (method === 'DELETE') { files.delete(id!); return new Response(null, { status: 204 }); }
    return new Response('', { status: 400 });
  };
  return { files, fetch: fetchFn as typeof fetch };
}

export async function run() {
  const out: Record<string, unknown> = {};
  const drive = fakeDrive();
  const token = async () => 'tok';
  // 기기 A: 처음 — 할 일 하나 만들고 올림
  const dbA = await openLocalDb();
  const appA = await createLocalApp(dbA, { email: 't@example.com', name: '선생님' });
  const syncA = new DriveSync(dbA, { token, fetch: drive.fetch, quietMs: 10, now: () => new Date('2026-11-27T09:00:00Z') });
  out.openA = await syncA.open();
  await appA.fetch('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'A 에서 만든 할 일', due_at: null }) });
  await dbA.query("insert into api_keys(user_id, provider, key_encrypted, last4) select id, 'anthropic', 'local:secret-key', '-key' from users limit 1").catch((e) => (out.apiKeyInsert = String(e.message)));
  syncA.markDirty();
  await syncA.flush();
  const saved = JSON.parse([...drive.files.values()].find((f) => f.name === 'ssamboard-data.json')!.body);
  out.uploadedTasks = saved.tables.tasks.map((t: any) => t.title);
  out.secretLeak = JSON.stringify(saved).includes('secret-key');
  out.backups = [...drive.files.values()].filter((f) => f.name.startsWith('backup-')).map((f) => f.name);

  // 기기 B: 새 브라우저 — 열면 A 의 자료를 받는다
  const dbB = await openLocalDb();
  await createLocalApp(dbB, { email: 't@example.com', name: '선생님' });
  const syncB = new DriveSync(dbB, { token, fetch: drive.fetch, quietMs: 10 });
  out.openB = await syncB.open();
  const appB = await createLocalApp(dbB, { email: 't@example.com', name: '선생님' });
  out.tasksB = (await (await appB.fetch('/api/tasks')).json()).map((t: any) => t.title);
  out.boardB = (await appB.fetch('/api/boards/current')).status;

  // B 에서 고치고 올림 → A 는 안 올린 변경이 있으면 충돌
  await appB.fetch('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'B 에서 만든 할 일', due_at: null }) });
  syncB.markDirty(); await syncB.flush();
  await appA.fetch('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'A 두 번째', due_at: null }) });
  syncA.markDirty();
  await syncA.flush().catch(() => undefined);
  out.stateA = syncA.state;
  await syncA.keepRemote();
  const appA2 = await createLocalApp(dbA, { email: 't@example.com', name: '선생님' });
  out.tasksAafterRemote = (await (await appA2.fetch('/api/tasks')).json()).map((t: any) => t.title).sort();
  out.keyStillOnA = (await dbA.one("select count(*)::int n from api_keys a join users u on u.id = a.user_id")).n;

  // 표가 빠진 파일은 거부하고 지금 보드는 그대로(검토: 코덱스)
  const bad = JSON.parse(JSON.stringify(await exportData(dbA)));
  delete bad.tables.blocks;
  out.badImport = await importData(dbA, bad).then(() => 'ok', (e) => e.message);
  out.tasksAfterBadImport = (await dbA.one('select count(*)::int n from tasks')).n;

  // 칸 구성이 다른 줄: 한 줄은 note 를 빼고(기본값), 다른 줄은 note 를 가진 채로 — 둘 다 제 값이어야 한다(코덱스 재확인)
  const mixed = JSON.parse(JSON.stringify(await exportData(dbA)));
  mixed.tables.tasks[0].note = '메모 있음';
  delete mixed.tables.tasks[1].note;
  delete mixed.tables.tasks[1].status;
  await importData(dbA, mixed);
  out.mixedNotes = (await dbA.query('select note, status from tasks order by created_at')).map((r: any) => [r.note, r.status]);

  // 올리는 동안 또 바뀌면 바뀜 표시가 남는다(검토: 저장 중 로그아웃·긴 AI 응답)
  let release!: () => void;
  let started!: () => void;
  const patchStarted = new Promise<void>((r) => (started = r));
  const slow = (async (input: any, init: any = {}) => {
    if ((init.method ?? 'GET') === 'PATCH') {
      started();
      await new Promise<void>((r) => (release = r));
    }
    return drive.fetch(input, init);
  }) as typeof fetch;
  const syncS = new DriveSync(dbA, { token, fetch: slow, quietMs: 1_000_000 });
  syncS.markDirty();
  const pending = syncS.flush();
  await patchStarted;
  // 올리는 도중(아직 끝나지 않음)에도 '안 올린 변경'으로 보여야 로그아웃이 기다린다 — 옛 코드는 여기서 false 였다
  out.dirtyDuringUpload = await syncS.hasUnsaved();
  syncS.markDirty();
  release();
  await pending;
  out.dirtyAfterChangeDuringUpload = await syncS.hasUnsaved();
  // settle 은 남은 것까지 올린다
  const p2 = syncS.settle();
  await new Promise((r) => setTimeout(r, 20));
  release?.();
  await p2;
  out.dirtyAfterSettle = await syncS.hasUnsaved();

  // 브라우저처럼: 자료가 있는 드라이브에 새 기기 — 사용자 줄만 만든 뒤 열면 받아 온다(시작 순서, 2026-11-27 브라우저 시험에서 잡힘)
  const dbD = await openLocalDb();
  await ensureLocalUser(dbD, { email: 't@example.com', name: '선생님' });
  const syncD = new DriveSync(dbD, { token, fetch: drive.fetch, quietMs: 10 });
  out.openNewDevice = await syncD.open();
  out.newDeviceTasks = (await dbD.query('select title from tasks order by title')).map((r: any) => r.title);

  // 브라우저처럼: 빈 드라이브에 처음 — 보드를 만들기 전에 열면 'empty', 만든 뒤 올린다(2026-11-27 브라우저 시험에서 잡힘)
  const driveC = fakeDrive();
  const dbC = await openLocalDb();
  const syncC = new DriveSync(dbC, { token, fetch: driveC.fetch, quietMs: 10 });
  out.openFresh = await syncC.open();
  await createLocalApp(dbC, { email: 'c@example.com', name: 'C' });
  syncC.markDirty();
  await syncC.flush();
  out.freshUploadedUsers = JSON.parse([...driveC.files.values()].find((f) => f.name === 'ssamboard-data.json')!.body).tables.users.length;

  // 모든 표가 올림/안 올림 중 하나에 들어 있는지
  const all = (await dbA.query("select table_name from information_schema.tables where table_schema = 'public'")).map((r: any) => r.table_name).sort();
  out.unclassified = all.filter((t: string) => !(SYNC_TABLES as readonly string[]).includes(t) && !(LOCAL_ONLY_TABLES as readonly string[]).includes(t));
  out.exportSize = JSON.stringify(await exportData(dbA)).length;
  return out;
}
