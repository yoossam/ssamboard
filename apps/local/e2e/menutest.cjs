// 처음 안내 → AI 열쇠 → 고치는 법 → 메뉴 추천(가짜 Claude) → 고른 메뉴 만들기 → 위쪽 줄 메뉴 누르기
const pw = require(process.argv[2]); const S = process.argv[3];
const FAKE_KEY = 'sk-ant-' + 'test-' + 'x'.repeat(24);
const REC = {
  summary: '상담 기록과 가정통신문 일정, 체험학습 신청 현황을 관리하고 싶어 하십니다.',
  menus: [
    { label: '상담 기록 추가', icon: 'edit', description: '상담한 내용을 한 줄 적습니다', action_type: 'add_row', prompt: null, url: null, panel: null, table_id: null, new_table: { name: '상담 기록', columns: [{ name: '날짜', type: 'date' }, { name: '학생', type: 'text' }, { name: '내용', type: 'text' }] }, reason: '상담을 날짜별로 남기고 싶다고 하셔서' },
    { label: '통신문 → 일정', icon: 'calendar', description: '가정통신문을 붙이면 일정으로 넣습니다', action_type: 'ask_ai', prompt: '붙여 넣은 가정통신문에서 날짜가 있는 일을 일정으로 넣어 줘', url: null, panel: null, table_id: null, new_table: null, reason: '통신문 일정 넣기' },
    { label: '체험학습 현황', icon: 'table', description: '신청서 제출 현황표', action_type: 'open_table', prompt: null, url: null, panel: null, table_id: null, new_table: { name: '체험학습 신청', columns: [{ name: '학생', type: 'text' }, { name: '제출', type: 'boolean' }] }, reason: '제출 현황' },
    { label: '이상한 것', icon: 'sparkle', description: '', action_type: 'link', prompt: null, url: 'javascript:alert(1)', panel: null, table_id: null, new_table: null, reason: '' },
  ],
};
(async () => {
  const b = await pw.chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  const errs = []; const asked = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    asked.push({ system: (body.system || '').slice(0, 60), hasSchema: !!body.output_config, key: route.request().headers()['x-api-key'] === FAKE_KEY });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(REC) }], usage: { input_tokens: 900, output_tokens: 400 } }) });
  });
  await p.goto('http://127.0.0.1:4321/ssamboard/app/', { waitUntil: 'networkidle' });
  await p.getByText('이 기기에서 시작').click();
  await p.getByText('처음 시작하기 · 1 / 3').waitFor({ timeout: 20000 });
  await p.screenshot({ path: S + '/m1-key.png' });
  await p.getByPlaceholder('sk-ant-…').fill(FAKE_KEY);
  await p.getByRole('button', { name: '저장하고 다음' }).click();
  await p.getByText('처음 시작하기 · 2 / 3').waitFor();
  await p.screenshot({ path: S + '/m2-how.png' });
  await p.getByRole('button', { name: '다음' }).click();
  await p.getByText('처음 시작하기 · 3 / 3').waitFor();
  await p.getByText('+ 상담 기록').click();
  await p.getByRole('dialog').locator('textarea').fill('학생 상담 기록을 날짜별로 남기고, 가정통신문 일정 넣기, 체험학습 신청서 제출 현황');
  await p.getByRole('button', { name: 'AI 에게 메뉴 추천받기' }).click();
  await p.getByText('고른 3개 만들기').waitFor();
  await p.screenshot({ path: S + '/m3-rec.png' });
  const recCards = await p.locator('label:has(input[type=checkbox])').count();
  await p.getByRole('button', { name: '고른 3개 만들기' }).click();
  await p.getByRole('dialog', { name: '내 메뉴 만들기' }).waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
  await p.waitForTimeout(800);
  const bar = await p.locator('header button[title]').allInnerTexts();
  await p.screenshot({ path: S + '/m4-bar.png' });
  await p.getByRole('button', { name: '상담 기록 추가' }).click();
  await p.waitForTimeout(800);
  const rowForm = await p.getByText('날짜 · 날짜').count();
  await p.screenshot({ path: S + '/m5-addrow.png' });
  // 새로 고쳐도 안내가 다시 뜨지 않는다
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
  const tutorialAgain = await p.getByText('처음 시작하기').count();
  console.log(JSON.stringify({ recCards, bar, rowForm, tutorialAgain, asked, errs }));
  await b.close();
})();
