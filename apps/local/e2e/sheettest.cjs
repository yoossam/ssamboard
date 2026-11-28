const pw = require(process.argv[2]); const S = process.argv[3];
const GIS = `window.google=window.google||{};window.google.accounts={oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>setTimeout(()=>c.callback({access_token:'tok-'+Date.now(),expires_in:3600,scope:c.scope}),50)}),revoke:(t,d)=>d&&d()}};`;
const GAPI = `window.gapi={load:(n,o)=>o.callback()};window.google=window.google||{};window.google.picker={ViewId:{SPREADSHEETS:'s'},Action:{PICKED:'picked',CANCEL:'cancel'},PickerBuilder:function(){var cb;var b={addView:()=>b,setOAuthToken:(t)=>{window.__pickerToken=t;return b},setDeveloperKey:()=>b,setAppId:()=>b,setLocale:()=>b,setCallback:(f)=>{cb=f;return b},build:()=>({setVisible:()=>setTimeout(()=>cb({action:'picked',docs:[{id:'1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd',name:'출석부'}]}),50)})};return b}};`;
const files = new Map(); let seq = 0; const calls = [];
async function google(route) {
  const req = route.request(); const url = new URL(req.url()); const m = req.method(); calls.push(m + ' ' + url.host + url.pathname);
  const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v), headers: { 'access-control-allow-origin': '*' } });
  if (url.host === 'sheets.googleapis.com') {
    if (!(req.headers()['authorization'] || '').startsWith('Bearer tok-')) return route.fulfill({ status: 401, headers: { 'access-control-allow-origin': '*' } });
    if (url.pathname.includes('/values/')) return json({ values: [['이름', '출석'], ['가나', 'O'], ['다라', 'X']] });
    return json({ properties: { title: '출석부' }, sheets: [{ properties: { title: '시트1', gridProperties: { rowCount: 3, columnCount: 2 } } }] });
  }
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
(async () => {
  const b = await pw.chromium.launch(); const out = {};
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: GIS }));
  await ctx.route('https://apis.google.com/js/api.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: GAPI }));
  await ctx.route('https://www.googleapis.com/**', google);
  await ctx.route('https://sheets.googleapis.com/**', google);
  const p = await ctx.newPage(); const errs = [];
  // 처음 접속 안내가 뜨면 건너뛴다(그 흐름은 menutest.cjs 가 본다)
  await p.addLocatorHandler(p.getByText('처음 시작하기 ·'), async () => { await p.getByRole('button', { name: '건너뛰기' }).click(); });
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 200)));
  await p.goto('http://127.0.0.1:4321/ssamboard/app/', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: '구글 계정으로 시작' }).click();
  await p.waitForSelector('.react-grid-item', { timeout: 60000 });
  const openSettings = async (tab) => { await p.locator('header button').first().click(); await p.getByText('설정', { exact: true }).first().click(); await p.getByRole('tab', { name: tab }).click(); };
  await openSettings('연결');
  await p.getByRole('button', { name: 'Google 시트 연결' }).click();
  await p.waitForTimeout(3000);
  await p.screenshot({ path: S + '/sheet-0.png' });
  console.log('AFTER', p.url(), JSON.stringify(errs));
  out.url = p.url();
  out.connectorCard = await p.getByText('Google 시트', { exact: false }).count();
  await p.getByRole('button', { name: '시트 가져오기' }).click();
  await p.waitForTimeout(300);
  await p.screenshot({ path: S + '/sheet-1.png' });
  const pick = p.getByRole('button', { name: /스프레드시트|고르기|시트 고르기/ }).first();
  await pick.click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: S + '/sheet-pick.png' });
  console.log('PICK', JSON.stringify(errs), JSON.stringify(calls.slice(-6)));
  await p.getByRole('button', { name: '미리보기' }).click();
  await p.waitForTimeout(1200);
  await p.screenshot({ path: S + '/sheet-2.png' });
  await p.getByRole('button', { name: /연결|가져오기|저장/ }).last().click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: S + '/sheet-3.png' });
  out.boardText = (await p.locator('.react-grid-item').allInnerTexts()).join(' | ').slice(0, 300);
  out.pickerToken = await p.evaluate(() => (window).__pickerToken?.slice(0, 4));
  out.calls = calls.filter((c) => c.includes('sheets')); out.errs = errs.slice(0, 6);
  console.log(JSON.stringify(out));
  await b.close();
})();
