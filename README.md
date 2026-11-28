# 쌤보드

선생님의 할 일·일정·표·메모·알림을 **한 화면**에 모아 두고, 아래 입력줄에 말로 시키면 **AI(Claude 또는 GPT)** 가 정리·수합·시각화까지 해 주는 개인용 업무 보드입니다.

> **쉽게 일하고, 쉽게 전달하고, 쉽게 수합하고, 모든 일은 AI 를 시키자.**

- 한 페이지 보드: 할 일 · 오늘 일정 · 표 · 붙임쪽지 메모 · 알림을 블록으로 놓고 크기·자리를 바꿉니다.
- 말로 시키기: "다음 주 상담 일정 표로 만들어 줘"처럼 말하면 AI 가 **계획을 먼저 보여 주고**, 승인해야 반영합니다. 되돌리기도 됩니다.
- 자료 수합: 파일·붙여 넣은 표를 정리해 표로 만들고, Google 시트를 가져오거나 Google 설문을 만들어 응답을 표로 모읍니다(선택).
- AI 화면 블록: 표·할 일·일정을 그래프나 현황판으로 그려 보드에 붙입니다.
- 첨부: 사진·PDF·한글(HWPX)·워드·엑셀·파워포인트 파일을 붙이거나, 공개된 구글 문서·시트 링크를 붙여 넣으면 AI 가 읽고 정리합니다.
- 꾸미기: 블록을 끌어 옮기고 크기를 바꾸며, 블록 바탕·제목 색과 보드 바탕색을 바꿉니다.
- 내 자료는 내 곳에: 사용자 한 명이 쓰는 보드입니다. 자료는 내 구글 드라이브나 내 서버에만 있고, AI 를 쓸 때만 필요한 부분이 내가 고른 AI(Claude·GPT)로 갑니다.

## 두 가지 쓰는 법 — 고르세요

| | 구글 드라이브 트랙 (설치 없음) | 서버 트랙 (내 서버) |
|---|---|---|
| 시작 | 주소를 열고 구글 로그인 → AI 열쇠(Claude 또는 GPT) 넣기 | Docker 가 있는 컴퓨터에 `./scripts/install.sh` |
| 자료가 있는 곳 | 내 브라우저 + 내 구글 드라이브의 숨은 앱 폴더(하루 백업 14개) | 내 서버의 데이터베이스 |
| 다른 기기 | 같은 구글 계정으로 열면 같은 보드 | 내 서버 주소로 접속 |
| 정해진 시각의 알림·시트 자동 맞춤 | 없음 — 시트는 "지금 동기화"로 | 늘(서버 일꾼) |
| 구글 시트 가져오기·설문 만들기, 파일로 표 만들기, AI 화면 블록 | 됨 | 됨 |
| 웹훅(바깥에서 알림 받기) | 없음(받아 줄 서버가 없다) | 됨 |
| 인터넷 없이 열기 | 됨(앱 껍데기를 기억, 저장은 다시 연결되면) | 서버에 닿아야 함 |
| 다른 트랙으로 옮기기 | 설정 → 드라이브 → 내보내기·가져오기 | 설정 → 자료 → 내보내기·가져오기 |
| 누가 내 자료를 볼 수 있나 | 나만(서버가 없다) | 서버 관리자 |

두 트랙은 **같은 코드**입니다. 서버 코드를 브라우저 안 PostgreSQL([PGlite](https://pglite.dev))에서 그대로 돌리는 방식이라, 기능을 고치면 두 트랙에 함께 들어갑니다(설계: `docs/TWO_EDITIONS_PLAN.md`).

## 구글 드라이브 트랙

이 저장소의 GitHub Pages 주소를 열면 두 판을 고르는 첫 화면이 나오고, **간편판 시작하기**(주소 `/app/`)로 바로 씁니다. "구글 계정으로 시작"을 누르고 드라이브 앱 폴더 권한에 동의하면 됩니다. 구글 없이 "이 기기에서만 써 보기"도 됩니다(나중에 설정 → 드라이브에서 옮기기).

- 권한은 드라이브 **앱 폴더**(`drive.appdata`) 하나 — 쌤보드가 만든 숨은 파일만 읽고 쓰며, 내 드라이브의 다른 파일은 볼 수 없습니다.
  시트·설문을 쓸 때만 설정 → 연결에서 `drive.file`(내가 고른 파일과 쌤보드가 만든 파일만)을 더 받습니다.
- AI 열쇠(Claude·GPT)는 그 브라우저에만 두고 드라이브에도 올리지 않습니다. AI 요청은 브라우저가 고른 AI 회사에 바로 보냅니다.
- 공용 컴퓨터에서는 다 쓰고 **더보기 → 로그아웃**: 드라이브에 저장한 뒤 그 브라우저의 자료를 지웁니다.

### 내 주소로 따로 띄우기(선택)

1. 이 저장소를 포크하고 Settings → Pages → Source 를 **GitHub Actions** 로 둡니다.
2. [Google Cloud 콘솔](https://console.cloud.google.com/)에서 프로젝트를 만들고 **Google Drive API** 를 켭니다.
3. OAuth 동의 화면: 범위에 `.../auth/drive.appdata`, `openid`, `email`, `profile` 을 넣고 **프로덕션으로 게시**합니다(테스트 상태면 등록한 계정만 쓸 수 있습니다).
4. 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션) → 승인된 JavaScript 원본에 `https://<내 아이디>.github.io` 를 넣습니다.
5. 저장소 Settings → Secrets and variables → Actions → **Variables** 에 `VITE_GOOGLE_CLIENT_ID` 로 그 클라이언트 ID 를 넣고, Actions 에서 "구글 드라이브 트랙(GitHub Pages)"을 한 번 돌립니다.
6. (시트 가져오기를 쓰려면) **Google Sheets API**·**Google Picker API**·**Google Forms API** 를 켜고, HTTP 리퍼러를 내 Pages 주소로 제한한 API 키를 `VITE_GOOGLE_PICKER_API_KEY`, 프로젝트 번호를 `VITE_GOOGLE_APP_ID` 변수로 넣습니다. 동의 화면 범위에 `.../auth/drive.file` 도 더합니다.

내 컴퓨터에서 시험할 때: `npm ci && VITE_GOOGLE_CLIENT_ID=... npm run build:pages` → `apps/web/dist-pages` 를 정적 서버로 엽니다(첫 화면, 앱은 `app/`).

## 서버 트랙

### 설치 (10분)

> 처음이면 공개 주소의 **서버 설치판 간편 설명서**(`install.html`)를 보세요 — Claude·ChatGPT 에 붙여 넣으면 한 단계씩 설치를 도와주는 글이 있습니다.

**필요한 것**: [Docker](https://docs.docker.com/get-docker/) 가 깔린 컴퓨터 한 대(맥·리눅스·윈도우 WSL), AI 를 쓰려면 [Claude API 키](https://console.anthropic.com/) 또는 [OpenAI API 키](https://platform.openai.com/).

```bash
git clone <이 저장소 주소> ssamboard
cd ssamboard
./scripts/install.sh
```

스크립트가 세 가지 중 하나를 묻습니다.

| 고르는 것 | 언제 | 주소 |
|---|---|---|
| 1) 이 컴퓨터에서만 | 처음 써 볼 때, 학교 PC 한 대에서 쓸 때 | `http://localhost:3000` |
| 2) Cloudflare 터널 | 도메인이 Cloudflare 에 있고, 포트를 열지 않고 바깥(휴대폰 등)에서도 쓸 때 | `https://내도메인` |
| 3) 내 도메인 + 자동 인증서 | 서버의 80·443 포트가 바깥에 열려 있을 때 | `https://내도메인` |

끝나면 주소와 **설치 코드**가 나옵니다.

1. 주소를 열면 "쌤보드 시작하기" 화면이 뜹니다. 설치 코드와 이름·이메일·암호를 넣습니다(메일은 보내지 않습니다).
2. 보드를 여는 **PIN 6자리**를 정합니다. 새 기기에서 로그인할 때와 잠시 자리를 비워 잠겼을 때 PIN 을 넣습니다.
3. 메뉴 → 설정 → 일반에서 **AI 모델**(Claude·GPT)을 고르고 그 회사의 **API 키**를 넣습니다. 키는 암호화해 서버에만 둡니다. 한 달 사용 한도도 여기서 정합니다.

다시 띄우거나 고친 코드를 반영할 때도 `./scripts/install.sh` 를 다시 돌리면 됩니다(설정은 그대로 둡니다).

### 자주 쓰는 명령

```bash
docker compose logs -f app                              # 서버 기록 보기
docker compose exec app jarvis set-password 이메일      # 암호를 잊었을 때
docker compose exec app jarvis reset-pin 이메일         # PIN 을 잊었을 때
./scripts/backup.sh                                     # DB 백업(암호화), 되살리기는 scripts/restore.sh
docker compose down                                     # 끄기(자료는 남음)
```

## Google 시트·설문 연결 (선택)

시트 가져오기와 설문으로 자료 모으기를 쓰려면 Google OAuth 클라이언트가 필요합니다. 쓰지 않으면 건너뛰어도 됩니다.

1. [Google Cloud 콘솔](https://console.cloud.google.com/) → 새 프로젝트 → API 및 서비스 → 라이브러리에서 **Google Sheets API**, **Google Picker API**, **Google Forms API**, **Google Drive API** 를 켭니다.
2. OAuth 동의 화면을 만들고 **프로덕션 게시**로 둡니다(테스트 상태면 연결이 7일마다 끊깁니다).
3. 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션) → 승인된 리디렉션 URI 에 `https://내주소/api/connectors/google/callback` 을 넣습니다.
4. API 키를 하나 만들어 HTTP 리퍼러를 내 주소로 제한합니다.
5. `.env` 의 `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`·`GOOGLE_PICKER_API_KEY`·`GOOGLE_APP_ID`(프로젝트 번호)를 채우고 `./scripts/install.sh` 를 다시 돌립니다.
6. 보드의 설정 → 연결에서 Google 을 연결합니다. 권한은 `drive.file`(내가 고르거나 쌤보드가 만든 파일만)입니다.

로그인까지 Google 계정으로 하고 싶으면 `.env` 에 `LOGIN_MODE=google` 과 `ALLOWED_EMAILS=내계정@gmail.com` 을 넣고, 리디렉션 URI 에 `https://내주소/api/auth/google/callback` 도 더합니다.

## 고쳐 쓰기

```
packages/shared   화면과 서버가 같이 쓰는 규칙(타입·표 형식·집계 검증·개인정보 가림)
apps/api          NestJS 서버 + 워커 + 서버 콘솔 명령(jarvis), PostgreSQL 16 — 기능은 여기에 넣으면 두 트랙에 함께 들어갑니다
apps/local        구글 드라이브 트랙: 서버 코드를 브라우저에서 돌리는 대체품·라우터, PGlite, 드라이브 맞춤, 구글 로그인
apps/web          React + Vite + Tailwind 화면(PC 격자 보드, 휴대폰 2열 타일, PWA). VITE_EDITION=local 이면 구글 드라이브 트랙
deploy, scripts   Caddy 설정, 설치·백업·복구 스크립트
```

개발할 때는 Node 22 와 함께:

```bash
npm ci
npm run dev:db:install && npm run dev:db     # 개발용 DB(다른 창에 띄워 둠)
cp .env.example .env                          # DATABASE_URL 을 개발용 DB 로, MASTER_KEY 를 채움
npm run dev:shared & npm run dev:api & npm run dev:web
npm run typecheck && npm test                 # 고친 뒤 검사
```

- 글자 크기·색: `apps/web/src/styles.css` 의 `@theme`.
- 글꼴: 에이투지체(A2Z, SIL OFL 1.1) 보통·중간 두 굵기. 그림이 없는 한글 글자는 연결을 빼 두어 다음 글꼴이 그립니다.
- AI 가 쓰는 도구: `apps/api/src/ai/tools.ts`. 쓰기 도구는 실행하지 않고 계획에 담아 사용자 승인을 받습니다.
- AI 화면 블록은 AI 가 쓴 코드를 격리된 틀과 일꾼(Worker) 안에서만 돌립니다. 이 가두는 구조를 풀지 마세요(까닭은 `apps/api/src/boards/view-frame.ts` 맨 위).

## 보안 메모

- 바깥에서 쓰려면 반드시 https(터널 또는 Caddy)로 엽니다. 앱 포트는 이 컴퓨터(127.0.0.1)에만 열립니다.
- 로그인(암호) 뒤에도 PIN 을 넣어야 보드가 열리고, 정한 시간 동안 입력이 없으면 화면이 잠깁니다. 암호·PIN 은 5번 틀리면 15분 막힙니다.
- `.env` 의 `MASTER_KEY` 를 잃으면 저장한 API 키·Google 연결을 다시 등록해야 합니다. 백업과 다른 곳에 따로 보관하세요.
- AI 로 보낼 때는 표의 앞 200행만 보내고 주민번호·카드번호처럼 보이는 값은 가립니다. 표마다 "AI 에 보내지 않음"을 켤 수 있습니다.

## 라이선스

MIT — 자유롭게 고쳐 쓰고 다시 배포할 수 있습니다. 글꼴(에이투지체)은 SIL OFL 1.1, 브라우저 안 데이터베이스 PGlite 는 Apache 2.0 을 따릅니다.
