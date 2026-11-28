# 쌤보드 작업 규칙 (모든 에이전트 공통)

## 기능을 바꾸면 사용 안내도 같은 커밋에서

- 사용 안내는 `apps/web/public/guide.html` 하나다(두 트랙 공통, 앱 메뉴 → 사용 안내, 드라이브 트랙 첫 화면 아래 링크).
- 화면에 보이는 기능을 더하거나·바꾸거나·빼면 **그 커밋에서 안내도 고친다.** 트랙마다 다르면 `두 트랙의 차이` 표도 고친다.
- `npm test` 가 맨 먼저 `scripts/check-guide.mjs` 를 돌려 AI 도구(`apps/api/src/ai/tools.ts`)·블록 종류(`BLOCK_TYPES`)·설정 탭(`SettingsTab`)이
  안내의 `data-feature` 표시와 맞는지 본다. 새 것이 안내에 없거나 없어진 것이 남아 있으면 실패한다.
  검사가 못 보는 기능(버튼·흐름·저장 방식)도 안내를 고친다 — 검사는 빠뜨림을 막는 최소한이다.
- 개인정보를 다루는 방식이 바뀌면 `apps/web/local-public/privacy.html`(개인정보 처리방침)도 고친다(시행 7일 전 알림을 약속했다).

## 그 밖

- 새 기능은 `apps/api` 에 넣으면 두 트랙(서버·구글 드라이브)에 같이 들어간다. 설계는 `docs/TWO_EDITIONS_PLAN.md`.
- 공개 저장소에는 개인 주소·계정·비밀 값을 넣지 않는다(`scripts/make-public-copy.sh` 가 막는다).
