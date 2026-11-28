// 파일 고치기: AI 창에 엑셀을 붙이고(가짜 Claude 가 edit_file), 승인 → 내려받기 → 고친 내용 확인
const pw = require(process.argv[2]); const S = process.argv[3];
const ExcelJS = require(require('path').join(__dirname, '../../../node_modules/exceljs'));
const fs = require('fs');
const FAKE_KEY = 'sk-ant-' + 'test-' + 'x'.repeat(24);
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}`).join('\n\n') + '\n\n';
const toolTurn = (input) => sse([
  { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'e1', name: 'edit_file', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
]);
const textTurn = (t) => sse([
  { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
]);
(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('성적');
  ws.addRow(['이름', '국어', '수학', '합계']);
  ws.addRow(['가나', 80, 50, null]);
  const src = S + '/성적.xlsx';
  fs.writeFileSync(src, Buffer.from(await wb.xlsx.writeBuffer()));
  const b = await pw.chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addLocatorHandler(p.getByText('처음 시작하기 ·'), async () => { await p.getByRole('button', { name: '건너뛰기' }).click(); });
  let calls = 0;
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const body = route.request().postData() || '';
    calls++;
    const fid = /file_id=\\"([0-9a-f-]{36})\\"/.exec(body)?.[1];
    const out = calls === 1 && fid ? toolTurn({ file_id: fid, summary: '합계 수식', edits: [{ op: 'formula', cell: 'D2', formula: 'SUM(B2:C2)' }, { op: 'highlight', range: 'C2', color: 'red' }] }) : textTurn('파일 고치기를 계획에 담았습니다.');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*' }, body: out });
  });
  await p.goto('http://127.0.0.1:4321/ssamboard/app/', { waitUntil: 'networkidle' });
  await p.getByText('이 기기에서 시작').click();
  await p.getByText('할 일').first().waitFor({ timeout: 20000 });
  await p.getByRole('button', { name: '메뉴' }).first().click();
  await p.getByText('설정').last().click();
  await p.getByRole('button', { name: 'Claude API 키 등록' }).click();
  await p.getByPlaceholder('sk-ant-…').fill(FAKE_KEY);
  await p.getByRole('button', { name: '키 저장' }).click();
  await p.waitForTimeout(400);
  await p.keyboard.press('Escape');
  // 아래 입력줄에 파일을 붙이면 AI 창이 열리며 바로 보낸다
  await p.locator('input[type=file]').first().setInputFiles(src);
  await p.getByPlaceholder(/첨부로 무엇을 할까요/).fill('합계 칸에 수식 넣고 50점은 빨간색');
  await p.keyboard.press('Enter');
  await p.getByRole('button', { name: '승인' }).waitFor({ timeout: 15000 });
  await p.screenshot({ path: S + '/f1-plan.png' });
  await p.getByRole('button', { name: '승인' }).click();
  const dlBtn = p.getByRole('button', { name: /내려받기 ·/ });
  await dlBtn.waitFor({ timeout: 10000 });
  await p.screenshot({ path: S + '/f2-applied.png' });
  const [download] = await Promise.all([p.waitForEvent('download'), dlBtn.click()]);
  const saved = S + '/' + download.suggestedFilename();
  await download.saveAs(saved);
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(fs.readFileSync(saved));
  const sh = out.getWorksheet('성적');
  console.log(JSON.stringify({ name: download.suggestedFilename(), formula: sh.getCell('D2').value?.formula, fill: sh.getCell('C2').fill?.fgColor?.argb, calls, errs }));
  await b.close();
})();
