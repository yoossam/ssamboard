const pw = require(process.argv[2]); const S = process.argv[3];
(async () => {
  const b = await pw.chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 820 } });
  const p = await ctx.newPage(); const logs = []; const reqs = [];
  p.on('pageerror', (e) => logs.push('ERR ' + e.message)); p.on('console', (m) => m.type() !== 'log' && logs.push(m.type() + ' ' + m.text().slice(0, 160)));
  const reached = [];
  await ctx.route('https://www.googleapis.com/**', (r) => { reached.push(r.request().url()); r.fulfill({ status: 200, body: 'ok', headers: { 'access-control-allow-origin': '*' } }); });
  await ctx.route('https://evil.example/**', (r) => { reached.push(r.request().url()); r.fulfill({ status: 200, body: 'ok', headers: { 'access-control-allow-origin': '*' } }); });
  ctx.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1')) reqs.push(r.url()); });
  await p.goto('http://127.0.0.1:4321/ssamboard/', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: '이 기기에서 시작' }).click();
  await p.waitForSelector('.react-grid-item', { timeout: 60000 });
  await p.locator('header button').first().click();
  await p.getByText('설정', { exact: true }).first().click();
  await p.getByRole('tab', { name: '드라이브' }).click().catch(async () => p.getByRole('button', { name: '드라이브' }).click());
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: '가져오기' }).click()]);
  await chooser.setFiles(__dirname + '/view-block.json');
  await p.getByRole('button', { name: '바꾸기' }).click();
  await p.waitForTimeout(3000);
  await p.screenshot({ path: S + '/view-after-import.png' });
  console.log('LOGS', JSON.stringify(logs));
  await p.waitForSelector('.react-grid-item', { timeout: 60000 });
  await p.waitForTimeout(2500);
  const f = p.frameLocator('iframe.view-frame');
  const out = {
    tz: await f.locator('#tz').innerText({ timeout: 10000 }).catch((e) => 'none ' + e.message.slice(0, 80)),
    leak: await f.locator('#leak').innerText({ timeout: 3000 }).catch(() => 'none'),
    links: await f.locator('a').count().catch(() => -1),
    imgs: await f.locator('img').count().catch(() => -1),
    svg: await f.locator('svg rect').count().catch(() => -1),
    sandbox: await p.locator('iframe.view-frame').getAttribute('sandbox'),
    externalRequests: reqs, reachedNetwork: reached, logs: logs.slice(0, 8),
  };
  await p.screenshot({ path: S + '/view-local.png' });
  console.log(JSON.stringify(out));
  await b.close();
})();
