import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
// 구글 드라이브 트랙 빌드 규칙: 서버 코드가 부르는 Node·Nest 모듈을 브라우저 대체품으로 바꾼다.
import { localTrackVite } from '../local/build/redirects.mjs';
// AI 화면 블록 준비 코드(서버 판과 같은 코드) — 구글 드라이브 트랙은 정적 파일로 내보낸다.
import { LOCAL_VIEW_SCRIPT, localViewBootstrap } from '../api/src/boards/view-frame';

/**
 * 구글 드라이브 트랙(서버 없음) 페이지의 보안 정책. 열쇠가 브라우저에 있으니 남의 스크립트가 끼지 못하게 좁게 둔다.
 * - 스크립트: 이 사이트 + 구글 로그인 도구, WebAssembly(PGlite) 허용
 * - 보낼 곳: Claude·구글 API 만
 */
const LOCAL_CSP = [
  "default-src 'self'",
  // 구글 로그인 도구, 시트 고르기 창(apis.google.com)
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client https://apis.google.com",
  // Claude, 구글 드라이브·시트·설문 API
  "connect-src 'self' https://api.anthropic.com https://www.googleapis.com https://sheets.googleapis.com https://forms.googleapis.com https://accounts.google.com",
  'frame-src https://accounts.google.com https://docs.google.com https://content.googleapis.com',
  "img-src 'self' data: blob: https://*.googleusercontent.com https://ssl.gstatic.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * 구글 드라이브 트랙 서비스 워커: 앱 껍데기(HTML·JS·CSS·PGlite 파일)만 캐시해 인터넷 없이도 열린다.
 * 보드 자료는 원래 브라우저 DB 에 있으므로 캐시하지 않는다. 구글·Claude 요청은 건드리지 않는다(다른 출처).
 * 화면 이동(HTML)은 인터넷 먼저 — 새 판이 올라오면 바로 받는다. 해시가 붙은 파일은 캐시 먼저.
 */
const LOCAL_SW = `const CACHE = 'ssamboard-local-__VERSION__';
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('ssamboard-local-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 인터넷 먼저: 성공한 응답만 이 판 캐시에 두고, 끊겼을 때만 캐시에서(오류 화면을 기억하지 않게 — 제미나이 검토)
function networkFirst(req, key) {
  return fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  }).catch(() => caches.open(CACHE).then((c) => c.match(key)).then((r) => r || Response.error()));
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, scope.href)); return; }
  // 이름에 해시가 붙은 묶음 파일(assets/)만 캐시 먼저 — 판이 바뀌면 이름도 바뀐다. 나머지(view-inner.js 등)는 인터넷 먼저.
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(req)).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(networkFirst(req, req));
});
`;

function localCsp(): Plugin {
  return {
    name: 'ssamboard-local-csp',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${LOCAL_CSP}" />`),
    // AI 화면 블록 틀이 부르는 준비 코드 파일, 인터넷 없이도 앱을 여는 서비스 워커
    generateBundle(_opts, bundle) {
      this.emitFile({ type: 'asset', fileName: LOCAL_VIEW_SCRIPT, source: localViewBootstrap() });
      const version = Object.keys(bundle).sort().join('|').length.toString(36) + '-' + Date.now().toString(36);
      this.emitFile({ type: 'asset', fileName: 'sw-local.js', source: LOCAL_SW.replace('__VERSION__', version) });
    },
    configureServer(server) {
      server.middlewares.use(`/${LOCAL_VIEW_SCRIPT}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.end(localViewBootstrap());
      });
    },
  };
}

// 화면과 서버가 같은 규칙(타입 변환·집계 검증·배치)을 쓰도록 shared 패키지의 소스를 직접 묶는다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const local = (process.env.VITE_EDITION ?? env.VITE_EDITION) === 'local';
  return {
    plugins: [...(local ? [localTrackVite(), localCsp()] : []), react(), tailwindcss()],
    // 구글 드라이브 트랙은 GitHub Pages 의 하위 주소(/ssamboard/)에서도 열리게 상대 경로로 묶는다.
    base: local ? './' : '/',
    resolve: {
      alias: {
        '@jarvis/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
        '@jarvis/local': fileURLToPath(new URL(local ? '../local/src/index.ts' : './src/local-shell/no-local.ts', import.meta.url)),
      },
    },
    // PGlite 는 미리 묶지 않는다(wasm·data 파일을 제 주소로 불러야 한다).
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    // 서버 코드(데코레이터)를 브라우저용으로 묶을 때 옛 방식 데코레이터로 읽는다.
    esbuild: local ? { tsconfigRaw: { compilerOptions: { experimentalDecorators: true } } } : undefined,
    server: {
      port: 5173,
      // 개발할 때는 API 서버(3000)로 넘긴다. 쿠키가 같은 출처로 붙도록 PUBLIC_URL을 http://localhost:5173 으로 둔다.
      proxy: local ? undefined : { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' },
    },
    build: { outDir: local ? 'dist-local' : 'dist', sourcemap: false, target: 'es2022' },
  };
});
