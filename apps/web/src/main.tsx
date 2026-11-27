import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/500.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './styles.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LOCAL_TRACK } from './lib/edition';
import { LocalBoot } from './local-shell/LocalBoot';
import { queryClient } from './lib/data';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {LOCAL_TRACK ? (
        <LocalBoot>
          <App />
        </LocalBoot>
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>,
);

// PWA(MOB-3): 앱 껍데기만 캐시하는 서비스 워커. 보드 데이터는 캐시하지 않는다.
// 구글 드라이브 트랙: 하위 주소(GitHub Pages)에서도 되게 상대 경로의 서비스 워커 — 인터넷 없이도 앱이 열린다.
if ('serviceWorker' in navigator && import.meta.env.PROD && LOCAL_TRACK) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw-local.js').catch(() => undefined));
}
if ('serviceWorker' in navigator && import.meta.env.PROD && !LOCAL_TRACK) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
