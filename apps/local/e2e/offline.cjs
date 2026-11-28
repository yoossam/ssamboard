const pw = require(process.argv[2]);
(async () => {
  const b = await pw.chromium.launch();
  const ctx = await b.newContext();
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:4321/ssamboard/app/', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: '이 기기에서 시작' }).click();
  await p.waitForSelector('.react-grid-item', { timeout: 60000 });
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload({ waitUntil: 'networkidle' }); // 서비스 워커가 받은 뒤 한 번 더 열어 캐시를 채운다
  await p.waitForSelector('.react-grid-item', { timeout: 60000 });
  const cached = await p.evaluate(async () => { const ks = await caches.keys(); let n = 0; for (const k of ks) n += (await (await caches.open(k)).keys()).length; return n; });
  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'load' });
  const ok = await p.waitForSelector('.react-grid-item', { timeout: 30000 }).then(() => true, () => false);
  console.log(JSON.stringify({ cached, offlineBoard: ok, errs: errs.slice(0, 4) }));
  await b.close();
})();
