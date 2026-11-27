const pw = require(process.argv[2]); const S = process.argv[3];
// 가짜 구글: 로그인 도구 + 드라이브 앱 폴더 + 사용자 정보
const files = new Map(); let seq = 0; let calls = [];
// 가짜 열쇠(진짜 열쇠 모양 검사에 걸리지 않게 이어 붙인다)
const FAKE_KEY = 'sk-ant-' + 'test-' + 'x'.repeat(24);
const GIS = `window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>setTimeout(()=>c.callback({access_token:'tok-'+Date.now(),expires_in:3600,scope:'https://www.googleapis.com/auth/drive.appdata openid email profile'}),50)}),revoke:(t,d)=>d&&d()}}};`;
async function google(route) {
  const req = route.request(); const url = new URL(req.url()); const m = req.method();
  calls.push(m + ' ' + url.pathname);
  const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v), headers: { 'access-control-allow-origin': '*' } });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (url.pathname.endsWith('/userinfo')) return json({ email: 'teacher@example.com', name: '김선생' });
  const id = (url.pathname.match(/\/files\/([^/]+)/) || [])[1];
  const meta = (k) => ({ id: k, name: files.get(k).name, version: String(files.get(k).version), modifiedTime: 'x' });
  if (m === 'GET' && !id) { const q = url.searchParams.get('q') || ''; const eq = /name = '([^']+)'/.exec(q)?.[1]; const has = /name contains '([^']+)'/.exec(q)?.[1]; return json({ files: [...files.keys()].filter((k) => eq ? files.get(k).name === eq : has ? files.get(k).name.includes(has) : true).map(meta) }); }
  if (m === 'GET' && id) return route.fulfill({ status: 200, body: files.get(id).body, headers: { 'access-control-allow-origin': '*' } });
  if (m === 'POST' && url.pathname.endsWith('/copy')) { const n = 'f' + ++seq; files.set(n, { ...files.get(id), name: JSON.parse(req.postData()).name, version: 1 }); return json({ id: n }); }
  if (m === 'POST') { const body = req.postData(); const parts = body.split(/--ssamboard\w+/); const metaJ = JSON.parse(parts[1].split('\r\n\r\n')[1]); const content = parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''); const n = 'f' + ++seq; files.set(n, { name: metaJ.name, body: content, version: 1 }); return json(meta(n)); }
  if (m === 'PATCH') { const f = files.get(id); f.body = req.postData(); f.version++; return json(meta(id)); }
  if (m === 'DELETE') { files.delete(id); return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
  return route.fulfill({ status: 400 });
}
async function device(b, name) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 820 } });
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: GIS }));
  await ctx.route('https://www.googleapis.com/**', google);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(name + ' ' + e.message));
  p.on('console', (msg) => msg.type() === 'error' && errs.push(name + ' console ' + msg.text().slice(0, 160)));
  return { ctx, p, errs };
}
(async () => {
  const b = await pw.chromium.launch(); const out = {};
  // 기기 A
  const A = await device(b, 'A');
  await A.p.goto('http://127.0.0.1:4321/ssamboard/', { waitUntil: 'networkidle' });
  await A.p.getByRole('button', { name: '구글 계정으로 시작' }).click();
  await A.p.waitForSelector('.react-grid-item', { timeout: 60000 });
  // 할 일 추가: 할 일 블록의 '추가' → 입력
  const tasks = A.p.locator('.react-grid-item').nth(1);
  await A.p.waitForTimeout(1500);
  await A.p.screenshot({ path: S + '/dt-start.png' });
  console.log('START', JSON.stringify(calls), JSON.stringify(A.errs));
  await tasks.getByRole('button', { name: /추가/ }).click();
  await A.p.waitForTimeout(400);
  await A.p.keyboard.type('동의서 걷기');
  await A.p.getByRole('button', { name: '추가', exact: true }).last().click();
  await A.p.waitForTimeout(600);
  out.tasksA = await tasks.innerText();
  // 설정 → 드라이브 → 지금 저장
  await A.p.locator('header button').first().click();
  await A.p.waitForTimeout(300);
  await A.p.screenshot({ path: S + '/dt-menu.png' });
  await A.p.getByText('설정', { exact: true }).first().click();
  await A.p.getByRole('tab', { name: '드라이브' }).click().catch(async () => A.p.getByRole('button', { name: '드라이브' }).click());
  await A.p.waitForTimeout(300);
  await A.p.getByRole('button', { name: '지금 저장' }).click();
  await A.p.waitForTimeout(800);
  await A.p.screenshot({ path: S + '/dt-drivetab.png' });
  // 일반 탭: PIN 없이 열쇠 넣기
  await A.p.getByRole('tab', { name: '일반' }).click().catch(async () => A.p.getByRole('button', { name: '일반' }).click());
  await A.p.getByRole('button', { name: /API 키 등록/ }).click();
  await A.p.getByPlaceholder('sk-ant-…').fill(FAKE_KEY);
  await A.p.getByRole('button', { name: '키 저장' }).click();
  await A.p.waitForTimeout(600);
  out.keyTag = await A.p.getByText(/••••/).first().innerText().catch(() => 'none');
  await A.p.getByRole('tab', { name: '드라이브' }).click().catch(async () => A.p.getByRole('button', { name: '드라이브' }).click());
  await A.p.getByRole('button', { name: '지금 저장' }).click();
  await A.p.waitForTimeout(800);
  const data = JSON.parse([...files.values()].find((f) => f.name === 'ssamboard-data.json').body);
  out.driveTasks = data.tables.tasks.map((t) => t.title);
  out.keyInDrive = JSON.stringify(data).includes('sk-ant-test');
  await A.ctx.close();
  // 기기 B: 새 브라우저
  const B = await device(b, 'B');
  await B.p.goto('http://127.0.0.1:4321/ssamboard/', { waitUntil: 'networkidle' });
  await B.p.getByRole('button', { name: '구글 계정으로 시작' }).click();
  await B.p.waitForSelector('.react-grid-item', { timeout: 60000 });
  await B.p.waitForTimeout(800);
  out.tasksB = await B.p.locator('.react-grid-item').nth(1).innerText();
  await B.p.screenshot({ path: S + '/dt-deviceB.png' });
  // B 새로 고침해도 남는지(IndexedDB)
  await B.p.reload({ waitUntil: 'networkidle' });
  await B.p.waitForSelector('.react-grid-item', { timeout: 60000 });
  out.tasksBreload = await B.p.locator('.react-grid-item').nth(1).innerText();
  out.errsB = B.errs;
  // B: 할 일 넣고 바로 로그아웃 → 드라이브에 저장된 뒤 이 브라우저는 비고 처음 화면
  const tb = B.p.locator('.react-grid-item').nth(1);
  await tb.getByRole('button', { name: /추가/ }).click();
  await B.p.keyboard.type('B 에서 넣고 바로 로그아웃');
  await B.p.getByRole('button', { name: '추가', exact: true }).last().click();
  await B.p.waitForTimeout(300);
  await B.p.getByRole('button', { name: '더보기' }).click();
  await B.p.getByText('로그아웃', { exact: true }).click();
  await B.p.waitForSelector('text=이 기기에서만 써 보기', { timeout: 30000 });
  const data2 = JSON.parse([...files.values()].find((f) => f.name === 'ssamboard-data.json').body);
  out.driveAfterLogout = data2.tables.tasks.map((t) => t.title).sort();
  out.idbAfterLogout = await B.p.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  out.calls = calls.slice(0, 20); out.files = [...files.values()].map((f) => f.name);
  out.errs = A.errs;
  console.log(JSON.stringify(out));
  await b.close();
})();
