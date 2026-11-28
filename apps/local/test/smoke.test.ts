import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { localTrackEsbuild } from '../build/redirects.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

async function bundle(name: string) {
  const out = here + `.${name}.bundle.mjs`;
  await build({
    entryPoints: [here + `${name}.entry.ts`],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    logLevel: 'error',
    plugins: [localTrackEsbuild()],
    external: ['@electric-sql/pglite'],
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    alias: {
      '@jarvis/shared': fileURLToPath(new URL('../../../packages/shared/src/index.ts', import.meta.url)),
    },
  });
  return import(out);
}

test('서버 코드가 브라우저 틀(PGlite)에서 그대로 돈다', async () => {
  const r = await (await bundle('smoke')).run();
  console.log(JSON.stringify(r, null, 1));
  assert.equal(r.status.authenticated, true);
  assert.deepEqual(r.board.blocks.sort(), ['events', 'memo', 'menu', 'notifications', 'tasks']);
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
  assert.equal(r.exportTables, 17); // 구글 문서 공유 링크(shares)도 옮긴다
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
  // 구글 설문 퀴즈
  assert.equal(r.gquiz.url, 'https://docs.google.com/forms/d/e/R1/viewform');
  assert.equal(r.gquiz.source, 'google');
  assert.equal(r.gquiz.closesAt, null);
  assert.deepEqual(r.gquiz.added, [2, 0]);
  assert.deepEqual(r.gquiz.names, ['3번', '4번']);
  assert.deepEqual(r.gquiz.q1, [1, 1]);
  assert.equal(r.gquiz.avg, 1.5);
  assert.equal(r.gquiz.totalAfterHide, 1); // 숨긴 응답은 다시 읽어도 숨김
  assert.equal(r.gquiz.closedStatus, 'closed');
  assert.match(r.gquiz.note, /응답 받기를 끄지 못했습니다/);
  assert.match(r.gquiz.rotate, /링크를 바꿀 수 없습니다/);
  assert.equal(r.gquiz.studentPage, true); // 쌤보드 학생 페이지로는 안 열림
  assert.deepEqual(r.gquiz.edited, [0, 1]); // 3번이 고쳐 낸 답(숨긴 4번은 빠짐)
  assert.equal(r.gquiz.cleared, 2);
  assert.equal(r.gquiz.resyncAdded, 0);
  assert.equal(r.gquiz.afterClear, 0);
  // 보드마다 내 메뉴
  assert.deepEqual(r.boardMenus.kinds, ['class']);
  assert.equal(r.boardMenus.workSame, true);
  // 수업 자료
  assert.match(r.links.bad, /1번 주소가 잘못됐습니다/);
  assert.equal(r.links.board, 'class');
  assert.match(r.links.dup, /이미 담긴 주소/);
  assert.equal(r.links.conflict, 409);
  assert.deepEqual(r.links.afterAdd, ['slides:도입:true', 'youtube:유튜브 자료:false']);
  assert.deepEqual(r.links.afterUndo, ['slides:도입:true']);
  // 수업 보드·즉석 퀴즈
  assert.match(r.quiz.badQuiz, /보기는 2~6개/);
  assert.match(r.quiz.detail, /정답 1번 1/);
  assert.deepEqual(r.quiz.submits, [true, true]);
  assert.match(r.quiz.noName, /번호나 별명/);
  assert.match(r.quiz.badOpt, /답을 하나 이상/);
  assert.equal(r.quiz.botOk, true); // 봇은 받은 척만
  assert.equal(r.quiz.total, 2);
  assert.equal(r.quiz.graded, 2);
  assert.equal(r.quiz.avg, 1.5);
  assert.deepEqual(r.quiz.q1, [1, 1]);
  assert.equal(r.quiz.q2correct, 2);
  assert.deepEqual(r.quiz.short, [{ text: '통분', n: 1 }]);
  assert.deepEqual(r.quiz.classTypes, ['memo', 'quiz']);
  assert.equal(r.quiz.workHasQuiz, false);
  assert.equal(r.quiz.closed, 410);
  assert.match(r.quiz.undoSkipped.join(' '), /학생 응답 2개/);
  assert.equal(r.quiz.quizKept, 1);
  assert.equal(r.quiz.blockKept, true);
  assert.equal(r.quiz.boardAfter, 'work');
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
  // 공유 링크
  assert.match(r.shareUrl, /\/s\/<열쇠>$/);
  assert.deepEqual(r.sharePage, {
    hasTask: true,
    scriptEscaped: true,
    rrnMasked: true,
    noindex: true,
  });
  assert.deepEqual(r.shareTable, { name: true, phoneHidden: true, yes: true });
  assert.match(r.shareNoti, /공유할 수 없습니다/);
  assert.match(r.shareBadDays, /기간은/);
  assert.equal(r.shareViews, 1);
  assert.equal(r.shareAfterRevoke, null);
  assert.equal(r.shareAfterExpire, null);
  assert.equal(r.shareBadToken, null);
  assert.deepEqual(r.shareNewCol, { added: true, addrHidden: true });
  assert.equal(r.shareCardMasked, true);
  assert.equal(r.sharePreview, true);
  // 드라이브 트랙: 기간은 늘 없음, 끄기 실패면 켜진 채로, 권한 실패면 문서·기록을 치움
  assert.deepEqual(r.driveShare, {
    url: 'https://docs.google.com/document/d/doc1/view',
    mode: 'drive',
    expires: null,
  });
  assert.match(r.driveRevokeFail, /공개를 끄지 못했습니다/);
  assert.equal(r.driveStillOn, true);
  assert.equal(r.driveOff, true);
  assert.match(r.drivePermFail, /링크를 열하지 못했습니다|링크를 열/);
  assert.equal(r.drivePermFailNoRow, true);
  assert.deepEqual(r.driveCalls, [
    'POST /upload/drive/v3/files',
    'POST /drive/v3/files/doc1/permissions',
    'PATCH /upload/drive/v3/files/doc1',
    'DELETE /drive/v3/files/doc1/permissions/anyoneWithLink',
    'DELETE /drive/v3/files/doc1/permissions/anyoneWithLink',
    'PATCH /drive/v3/files/doc1',
    '--- 권한 실패',
    'POST /upload/drive/v3/files',
    'POST /drive/v3/files/doc1/permissions',
    'DELETE /drive/v3/files/doc1',
    '--- 만드는 중 끄기',
    'POST /upload/drive/v3/files',
    'POST /drive/v3/files/doc1/permissions',
    'DELETE /drive/v3/files/doc1',
  ]);
  assert.match(r.driveRevokedDuring, /만드는 사이 링크를 껐습니다/);
  // 말로 관리(AI 도구)
  assert.match(r.aiMenuCreate.detail, /결석계 접수 · 표에 한 줄 넣기 — 새 표 "결석계"/);
  assert.deepEqual(r.aiMenuCreate.menus, ['결석계 접수']);
  assert.equal(r.aiMenuCreate.table, true);
  assert.deepEqual(r.aiMenuUpdate, ['나이스 열기', '결석계 접수']);
  assert.deepEqual(r.aiMenuUpdateUndo, ['결석계 접수', '나이스']);
  assert.deepEqual(r.aiMenuDelete, ['나이스']);
  assert.deepEqual(r.aiMenuDeleteUndo, ['결석계 접수', '나이스']);
  assert.deepEqual(r.aiMenuCreateUndo, { menus: [], table: false });
  assert.match(r.aiMenuBadLink.error, /https/);
  assert.match(r.aiBlockView.detail, /보여 줄 기간 → 1주/);
  assert.equal(r.aiBlockView.days, 7);
  assert.match(r.aiBlockWrongType, /할 일 블록에만/);
  assert.equal(r.aiBlockViewUndo, null);
  assert.match(r.aiShare.detail, /숨김: 전화/);
  assert.equal(r.aiShare.made, true);
  assert.equal(r.aiShare.page, true);
  assert.equal(r.aiShareUndo, null);
  // 기억
  assert.deepEqual(r.memAfterRemember, ['5학년 3반 담임, 학부모 문자는 존댓말로 세 줄 이내']);
  assert.equal(r.memAfterForget, 0);
  assert.equal(r.memAfterUndoForget, 1);
  assert.equal(r.memRememberRrn, '학생 900101-*******');
  assert.deepEqual(r.memConv.convs, [['1번째 말', true]]);
  assert.equal(r.memConv.messages, 22);
  assert.equal(r.memConv.summaryAsked, true);
  assert.equal(r.memConv.lastHasSummary, true);
  assert.ok(r.memConv.lastHistory <= 11, `history ${r.memConv.lastHistory}`);
  assert.equal(r.memConv.systemHasMemory, true);
  assert.equal(r.memConv.tailHasNow, true);
  // 파일 고치기
  assert.equal(r.fileEdit.sawGrid, true);
  assert.equal(r.fileEdit.detail, ['성적.xlsx → 성적 (고침).xlsx · 바뀌는 곳 2곳', '· A2:B2: 바탕 빨강', '· C1: (빈칸) → 확인', '(AI 설명: 60점 미만 빨간색)'].join('\n'));
  assert.deepEqual(r.fileEdit.files, ['성적 (고침).xlsx']);
  assert.equal(r.fileEdit.red, 'FFF8CBAD');
  assert.equal(r.fileEdit.c1, '확인');
  assert.match(r.fileEdit.badFile, /찾을 수 없습니다|붙인 파일/);
  assert.match(r.fileEditUndo, /찾을 수 없습니다/);
  assert.deepEqual(r.results, { status: 'applied', file: '성적 (고침).xlsx', expires: true, undoable: true, hasWhen: true });
  assert.deepEqual(r.resultsAfterUndo, { status: 'undone', undoable: false, files: [] });
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
