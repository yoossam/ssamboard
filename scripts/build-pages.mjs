#!/usr/bin/env node
/*
 * 공개 주소(GitHub Pages) 묶기 — `npm run build:local` 다음에 돈다(npm run build:pages).
 *   apps/web/dist-pages/            ← 두 트랙 고르는 첫 화면(apps/web/landing/index.html)·서버 설치판 간편 설명서(install.html)
 *   apps/web/dist-pages/app/        ← 구글 드라이브 간편판 앱(dist-local 그대로)
 *   apps/web/dist-pages/guide.html, privacy.html ← 앱 안의 것과 같은 파일(구글 동의 화면에 적은 주소는 맨 위 privacy.html)
 * 저장소 주소는 코드에 적지 않고 VITE_SERVER_TRACK_URL(Pages 빌드가 github.repository 로 만든다)에서 뗀다.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../apps/web/', import.meta.url));
const local = web + 'dist-local';
const out = web + 'dist-pages';
if (!existsSync(local + '/index.html')) {
  console.error('[pages] apps/web/dist-local 이 없습니다. 먼저 npm run build:local 을 돌리세요.');
  process.exit(1);
}
const repo = (process.env.VITE_SERVER_TRACK_URL ?? '').split('#')[0].replace(/\/$/, '') || 'https://github.com';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(local, out + '/app', { recursive: true });
for (const page of ['index.html', 'install.html']) writeFileSync(`${out}/${page}`, readFileSync(`${web}landing/${page}`, 'utf8').replaceAll('__REPO_URL__', repo));
for (const f of ['guide.html', 'privacy.html', 'icon.svg']) cpSync(`${local}/${f}`, `${out}/${f}`);
// GitHub Pages 가 _ 로 시작하는 파일을 숨기지 않게
writeFileSync(out + '/.nojekyll', '');
console.log(`[pages] ${out} — 첫 화면 + app/ + 안내·개인정보 처리방침 (저장소 ${repo})`);
