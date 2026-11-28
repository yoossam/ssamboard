# 구글 드라이브 트랙 브라우저 시험

가짜 구글(로그인 도구·드라이브·시트·시트 고르기 창)을 Playwright 로 끼워 실제 브라우저에서 흐름을 본다. 진짜 구글·Claude 에는 닿지 않는다.

```bash
VITE_GOOGLE_CLIENT_ID=test-client.apps.googleusercontent.com VITE_GOOGLE_PICKER_API_KEY=test-key VITE_GOOGLE_APP_ID=123 npm run build:pages
mkdir -p /tmp/ssb-pages && rm -rf /tmp/ssb-pages/ssamboard && cp -R apps/web/dist-pages /tmp/ssb-pages/ssamboard   # 첫 화면 /ssamboard/, 앱 /ssamboard/app/
(cd /tmp/ssb-pages && python3 -m http.server 4321 --bind 127.0.0.1 &)   # GitHub Pages 처럼 하위 주소 /ssamboard/
PW=<@playwright/test 설치 경로>; OUT=/tmp/ssb-shots; mkdir -p $OUT
node apps/local/e2e/drivetrack.cjs $PW $OUT   # 로그인→할 일→열쇠(PIN 없음)→드라이브 저장(열쇠 안 올림)→다른 기기 받기→바로 로그아웃
node apps/local/e2e/sheettest.cjs $PW $OUT    # 시트 연결(drive.file 더 받기)→시트 고르기→미리보기→표 블록
node apps/local/e2e/viewtest.cjs $PW $OUT     # 가져오기로 AI 화면 블록 → 그려짐·링크/그림 걸러짐·바깥 요청이 망에 안 나감
node apps/local/e2e/offline.cjs $PW           # 인터넷 끊고 새로 고쳐도 보드가 열림
node apps/local/e2e/menutest.cjs $PW $OUT     # 처음 안내(열쇠→고치는 법→메뉴 추천, 가짜 Claude)→고른 메뉴 만들기→위쪽 줄에서 누르기
```
