import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 화면과 서버가 같은 규칙(타입 변환·집계 검증·배치)을 쓰도록 shared 패키지의 소스를 직접 묶는다.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@jarvis/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  server: {
    port: 5173,
    // 개발할 때는 API 서버(3000)로 넘긴다. 쿠키가 같은 출처로 붙도록 PUBLIC_URL을 http://localhost:5173 으로 둔다.
    proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' },
  },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
});
