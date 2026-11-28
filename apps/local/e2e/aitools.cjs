// 말로 관리: 가짜 Claude 가 open_screen(표 목록 열기)·create_menu(계획 → 승인)를 부르면 화면이 따라 바뀌는지
const pw = require(process.argv[2]); const S = process.argv[3];
const FAKE_KEY = 'sk-ant-' + 'test-' + 'x'.repeat(24);
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}`).join('\n\n') + '\n\n';
const toolTurn = (id, name, input) => sse([
  { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } },
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
  const b = await pw.chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addLocatorHandler(p.getByText('처음 시작하기 ·'), async () => { await p.getByRole('button', { name: '건너뛰기' }).click(); });
  // 대본: 요청마다 다음 응답
  const script = [];
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const body = script.shift() ?? textTurn('끝');
    await route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await p.goto('http://127.0.0.1:4321/ssamboard/app/', { waitUntil: 'networkidle' });
  await p.getByText('이 기기에서 시작').click();
  await p.getByText('할 일').first().waitFor({ timeout: 20000 });
  // 열쇠 넣기(설정 → 일반)
  await p.getByRole('button', { name: '메뉴' }).first().click();
  await p.getByText('설정').last().click();
  await p.getByRole('button', { name: 'Claude API 키 등록' }).click();
  await p.getByPlaceholder('sk-ant-…').fill(FAKE_KEY);
  await p.getByRole('button', { name: '키 저장' }).click();
  await p.waitForTimeout(500);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const ask = async (text) => {
    await p.getByPlaceholder('무엇을 도와드릴까요?').click();
    await p.keyboard.type(text);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1500);
  };
  // 1) 화면 열기 — 승인 없이 표 목록이 열린다
  script.push(toolTurn('t1', 'open_screen', { target: 'tables' }), textTurn('표 목록을 열었습니다.'));
  await ask('표 목록 열어 줘');
  const tablesOpen = await p.getByText('표', { exact: true }).count() > 0 && (await p.locator('[role=dialog]').count()) > 0;
  await p.screenshot({ path: S + '/ai1-open.png' });
  await p.keyboard.press('Escape');
  // 2) 메뉴 만들기 — 계획 → 승인 → 위쪽 줄에 생김
  script.push(toolTurn('t2', 'create_menu', { label: '결석계 접수', icon: 'edit', action_type: 'add_row', new_table: { name: '결석계', columns: [{ name: '날짜', type: 'date' }, { name: '학생', type: 'text' }] } }), textTurn('메뉴 만들기를 계획에 담았습니다.'));
  await ask('위에 결석계 접수 메뉴 넣어 줘');
  await p.screenshot({ path: S + '/ai2-plan.png' });
  const planText = await p.getByText('메뉴 만들기').count();
  await p.getByRole('button', { name: /승인|반영/ }).first().click();
  await p.waitForTimeout(1200);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const chip = await p.getByRole('button', { name: '결석계 접수' }).count();
  await p.screenshot({ path: S + '/ai3-chip.png' });
  console.log(JSON.stringify({ tablesOpen, planText, chip, errs }));
  await b.close();
})();
