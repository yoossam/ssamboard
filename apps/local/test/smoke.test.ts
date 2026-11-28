import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { localTrackEsbuild } from '../build/redirects.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

async function bundle(name: string) {
  const out = here + `.${name}.bundle.mjs`;
  await build({
    entryPoints: [here + `${name}.entry.ts`], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
    plugins: [localTrackEsbuild()], external: ['@electric-sql/pglite'],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    alias: { '@jarvis/shared': fileURLToPath(new URL('../../../packages/shared/src/index.ts', import.meta.url)) },
  });
  return import(out);
}

test('서버 코드가 브라우저 틀(PGlite)에서 그대로 돈다', async () => {
  const r = await (await bundle('smoke')).run();
  console.log(JSON.stringify(r, null, 1));
  assert.equal(r.status.authenticated, true);
  assert.deepEqual(r.board.blocks.sort(), ['events', 'memo', 'notifications', 'tasks']);
  assert.equal(r.createTask, 201);
  assert.deepEqual(r.tasks, ['동의서 걷기']);
  assert.equal(r.badTask.status, 400);
  assert.equal(r.patchBlock, 200);
  assert.ok(r.trash.includes('blocks'));
  assert.equal(r.notFound, 404);
  assert.match(r.ai.type ?? '', /event-stream/);
  assert.match(r.ai.text, /"type":"error"/);
  assert.equal(r.upload.status, 201);
  assert.equal(r.upload.filename, '성적표.csv');
  assert.deepEqual(r.upload.header, ['이름', '점수']);
  assert.equal(r.tableStatus, 201);
  assert.equal(r.rows, 2);
  assert.equal(r.exportTables, 13);
  assert.deepEqual(r.connectors, []);
  assert.match(r.connectNoGoogle, /구글로 로그인해야/);
  assert.match(r.webhook, /웹훅을 쓸 수 없습니다/);
  assert.equal(r.importOk, 201);
  assert.deepEqual(r.tasksAfterImport, ['동의서 걷기']);
  assert.match(r.importBad, /자료 파일이 아닙니다/);
  assert.deepEqual(r.exportUserKeys, ['llm_model', 'llm_provider', 'monthly_budget', 'name', 'onboarded_at', 'timezone']);
  assert.match(r.importForeign, /없는 항목을 가리킵니다/);
  assert.deepEqual(r.tasksAfterForeign, ['동의서 걷기']);
  assert.match(r.undoBad, /되돌리기 기록이 잘못됐습니다/);
  // 내 메뉴
  assert.equal(r.menuCreate, 201);
  assert.deepEqual(r.menus, [
    ['오늘 할 일 정리', 'tasks', 'ask_ai'],
    ['상담 기록 추가', 'edit', 'add_row'],
    ['상담 기록 보기', 'table', 'open_table'],
    ['나이스', 'link', 'link'],
    ['알림', 'sparkle', 'open_panel'],
  ]);
  assert.deepEqual(r.menuTables, [['날짜', '학생', '내용']]);
  assert.equal(r.menuSameTable, true);
  assert.match(r.menuBadLink, /https 주소만/);
  assert.match(r.menuBadType, /알 수 없는 동작/);
  assert.match(r.menuNoKey, /API 키를 먼저 등록/);
  assert.deepEqual(r.menusAfter, ['나이스', '할 일 정리', '상담 기록 추가', '상담 기록 보기']);
  assert.equal(r.onboardedBefore, false);
  assert.equal(r.onboardedAfter, true);
  assert.equal(r.exportMenus, 4);
  assert.equal(r.importOld, 201);
  assert.equal(r.menusAfterOld, 0);
});

test('구글 드라이브 맞춤: 올리기·다른 기기 받기·충돌·열쇠 안 올림·백업', async () => {
  const r = await (await bundle('drive')).run();
  console.log(JSON.stringify(r, null, 1));
  assert.equal(r.openA, 'uploaded');
  assert.deepEqual(r.uploadedTasks, ['A 에서 만든 할 일']);
  assert.equal(r.secretLeak, false);
  assert.deepEqual(r.backups, ['backup-2026-11-27.json']);
  // 드라이브가 version 을 저절로 올려도(복사·서버 쪽 일) 같은 기기의 다음 저장은 충돌이 아니다(2026-11-28 실제 드라이브)
  assert.equal(r.stateAfterServerBump, 'saved');
  assert.equal(r.openB, 'downloaded');
  assert.deepEqual(r.tasksB, ['A 에서 만든 할 일']);
  assert.equal(r.boardB, 200);
  assert.equal(r.stateA, 'conflict');
  assert.deepEqual(r.tasksAafterRemote, ['A 에서 만든 할 일', 'B 에서 만든 할 일']);
  assert.equal(r.keyStillOnA, 1);
  assert.deepEqual(r.unclassified, []);
  assert.equal(r.openNewDevice, 'downloaded');
  assert.ok(r.newDeviceTasks.length >= 2);
  assert.equal(r.openFresh, 'empty');
  assert.equal(r.freshUploadedUsers, 1);
  assert.match(r.badImport, /blocks 표가 없습니다/);
  assert.equal(r.tasksAfterBadImport, 2);
  assert.equal(r.mixedNotes[0][0], '메모 있음');
  assert.equal(r.mixedNotes[1][1], 'open');
  assert.equal(r.dirtyDuringUpload, true);
  assert.equal(r.dirtyAfterChangeDuringUpload, true);
  assert.equal(r.dirtyAfterSettle, false);
});
