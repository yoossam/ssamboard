# PRD v3 요구사항별 구현 위치

상태: ✅ 구현 · ◐ 일부 구현 · — 넣지 않음. 경로는 저장소 기준입니다.

## 4.0 한 페이지 원칙과 AI 창

| ID | 상태 | 위치와 메모 |
|---|---|---|
| ONE-1 | ✅ | 화면은 `/` 하나. 설정·표·알림·휴지통은 모두 창으로 엽니다 — `apps/web/src/panels/` |
| ONE-2 | ✅ | `apps/web/src/board/Board.tsx`(입력줄, Ctrl/Cmd+K), `apps/web/src/ai/AiWindow.tsx`. PC 기본은 가운데 팝업, 옆 패널 전환 가능 |
| ONE-3 | ✅ | `apps/api/src/ai/tools.ts` — 읽기 6개, 쓰기 10개 |
| ONE-5 | ✅ | 쓰기 도구는 실행하지 않고 계획에 담음 — `ai.service.ts`, `commands.service.ts`. 삭제가 들어 있으면 승인 때 한 번 더 확인 |
| ONE-6, ONE-13 | ✅ | `commands.service.ts`의 `apply`·`undo`. 최근 명령만, 적용 뒤 직접 고친 항목은 건너뛰고 알려 줌 |
| ONE-7 | ✅ | 블록 머리줄을 누르거나 AI 입력에 `@제목` |
| ONE-8 | ✅ | SSE — `misc.controllers.ts`의 `AiController`, `apps/web/src/lib/api.ts`의 `streamAi` |
| ONE-9 | ✅ | 요청·자료·선택 블록을 태그로 나눠 보내고 시스템 프롬프트에서 데이터로만 다루게 함. 쓰기는 항상 사용자 승인을 거침 |
| ONE-10 | ✅ | 잠금·PIN·API 키·연결을 바꾸는 AI 도구가 없음. 설정에서 PIN 재입력 |
| ONE-12 | ✅ | `apps/web/src/components/SafeText.tsx`(글자로만 그림) + CSP `img-src 'self' data:` — `apps/api/src/main.ts`. AI 화면 블록의 틀만 예외로 자기 정책을 쓴다(`frame-src 'self'`, BRD-5a). 보드는 `Cross-Origin-Opener-Policy: same-origin` 으로 다른 사이트가 연 창과 이어지지 않는다 |
| ONE-11 | — | P2 |

## 4.1 인증과 잠금

| ID | 상태 | 위치와 메모 |
|---|---|---|
| AUTH-1 | ✅ | `auth/google.service.ts`, `auth/auth.controller.ts`, 허용 목록은 `allowed_emails` |
| AUTH-2 | ✅ | `auth.service.ts`의 `createSession` — HttpOnly·Secure·SameSite=Lax, 기본 30일 |
| AUTH-3 | ✅ | `POST /api/auth/pin/setup`, Argon2id |
| AUTH-4·5 | ✅ | 서버 판정 `auth.service.ts`의 `load`, 활동 신호 `apps/web/src/App.tsx`의 `useActivity` |
| AUTH-6 | ✅ | `auth/session.guard.ts`(423), 새 세션은 `locked = true` |
| AUTH-7 | ✅ | `auth.service.ts`의 `verifyPin` — 사용자 단위 누적, 5회째에 전체 로그아웃 + 15분 |
| AUTH-8·9 | ✅ | 세션별 잠금, 설정 → 기기 |
| AUTH-10 | ✅ | `apps/api/src/cli/jarvis.ts`의 `reset-pin` |
| AUTH-11·12 | — | P2 |

## 4.2 보드와 블록

| ID | 상태 | 위치와 메모 |
|---|---|---|
| BRD-1~4 | ✅ | `Board.tsx`의 `DesktopBoard`(react-grid-layout 24칸·화면 높이 16줄, 고정 = static, 변경 1초 뒤 저장). 12칸이던 것을 2026-11-26 에 절반 칸 단위로 나눴다(마이그레이션 `003_finer_grid`가 놓인 자리를 두 배로 옮긴다) |
| BRD-5 | ✅ | `apps/web/src/board/blocks.tsx` — 7종. 메모는 붙임쪽지처럼 쓴다: 종이 색 7가지(`config.color`, 이름은 shared `MEMO_COLORS`·색 값은 `styles.css`), 배치 편집 없이 머리띠로 옮기고 모서리로 크기 조절(최소 2×2칸), AI 도구 `create_block`·`update_block`의 `color` — `apps/web/src/board/memo.tsx`, `Board.tsx`의 `MemoCard` |
| BRD-5a | ✅ | **AI 화면 블록(view)** — AI가 쓴 그리기 코드(`code`: `render(data, size)`가 HTML·SVG 글자를 돌려줌)와 꾸밈(`css`)을 격리해 돌린다. 보드 → 바깥 틀(스크립트 없음) → 안쪽 틀(CSP sandbox, nonce 스크립트 하나) → 일꾼(Worker, AI 코드). 돌려준 글자는 허용 목록으로 걸러 붙이고, 자료는 브라우저가 넣어 준다(표 집계·할 일·일정). 가두는 방법과 이유는 `apps/api/src/boards/view-frame.ts` 맨 위, 화면은 `apps/web/src/board/view.tsx`, AI 안내는 `ai.service.ts`의 `VIEW_GUIDE`, 도구는 `create_block`·`update_block`의 `code`·`css`·`data` |
| BRD-6 | ✅ | 더보기 → 배치 편집 |
| BRD-7 | ◐ | 제목 변경, 메모의 종이 색. 블록 `config`는 보낸 키만 바뀐다(얕은 병합) — `boards.service.ts`의 `updateBlock` |
| BRD-8 | ✅ | UTC 저장, 사용자 시간대 표시 — `apps/web/src/lib/format.ts` |
| BRD-9 | — | P2 |

## 4.3 데이터 입력과 표

| ID | 상태 | 위치와 메모 |
|---|---|---|
| LLM-2 | ✅ | AI 창의 "자료", 파일 올리기, Google 시트. **이미지 첨부**(2026-11-27): AI 창·아래 입력줄의 이미지 단추·붙여넣기·끌어 놓기, 한 번에 4장, 화면에서 긴 변 1568px JPEG 로 줄여 보냄(`apps/web/src/lib/images.ts`), 서버 검사 `ai.service.ts` 의 `imageBlocks`(형식·크기), 저장하지 않고 이번 요청에만 Claude 로 보냄(대화 기록에는 '이미지 N장 첨부'만), 이미지 속 글도 데이터로만 다룸 |
| LLM-3 | ✅ | 표 형식은 서버 파싱 + 앞 200행으로 제안(`uploads/uploads.service.ts`), 비정형은 `create_table` 도구(최대 200행) |
| LLM-4 | ✅ | 미리보기에서 이름·타입 수정, 기존 표에 추가 — `PreviewEditor`, `POST /api/tables/:id/append` |
| LLM-5 | ✅ | 표 상세 → 설정 → 보드에 배치 |
| LLM-8 | ✅ | 표 상세 → 행 |
| LLM-9 | ✅ | 설정 → 일반 → 이번 달 사용량 |
| LLM-10 | ✅ | `llm/adapter.ts`(인터페이스), `llm/anthropic.adapter.ts` |
| LLM-11·12 | ✅ | `packages/shared/src/columns.ts`, 실패 칸 강조와 20% 넘으면 글자 제안은 `PreviewEditor` |
| LLM-13 | ✅ | 표 상세 → 컬럼, `tables.service.ts`의 `patchSchema` |
| LLM-14 | — | Phase 1.5 |

## 4.4 조회·집계

| ID | 상태 | 위치와 메모 |
|---|---|---|
| QRY-1·2·4 | ✅ | 검증 `packages/shared/src/query.ts`, 실행 `apps/api/src/tables/query-sql.ts`(값과 컬럼 ID 모두 파라미터 바인딩) |
| QRY-3 | ✅ | AI 결과 블록이 쿼리 정의를 저장하고 열 때마다 서버에서 다시 계산 |

## 4.5 알림

| ID | 상태 | 위치와 메모 |
|---|---|---|
| NTF-1 | ✅ | 마감·일정 10분 전·시트 동기화·웹훅·비용 80% — `worker/worker.service.ts`, `llm/llm.service.ts`. 백업 실패는 `scripts/backup.sh`가 웹훅으로 보냄 |
| NTF-2 | ✅ | 알림 센터 창 + 알림 블록, 안 읽음·읽음·보관 |
| NTF-3 | ◐ | "AI 요약" 단추만. 자동 중요도 분류는 없음 |
| NTF-4 | ◐ | 알림에서 할 일로 만들기 |
| NTF-6 | ✅ | `notifications.service.ts` — 부분 유니크 인덱스에 upsert |
| NTF-5 | — | P2 |

## 4.6 커넥터

| ID | 상태 | 위치와 메모 |
|---|---|---|
| CON-1~4 | ✅ | `connectors/connectors.service.ts`, 설정 → 연결 |
| CON-8 | — | 코드가 아니라 Google Cloud 콘솔에서 할 일(README) |
| GSH-1~4 | ✅ | Picker(`apps/web/src/panels/Tables.tsx`), 가져오기·연결·동기화·구조 변경 알림 |
| (추가) Google 설문 | ✅ | AI 도구 `create_form` → Google 설문지 만들기 + 응답을 모으는 연결된 표(`origin: form`, `sheet_ref.kind = 'form'`), 시트와 같은 주기 동기화. 권한은 그대로 `drive.file`. `connectors/google-forms.ts`(Google 호출·응답 → 행), `connectors.service.ts`의 `createForm`·`syncForm`, 질문 모양은 shared `form.ts`, 화면은 표 상세 → 설정. 실제 Google 호출은 가짜 응답으로만 시험했다(Forms API 를 켜고 연결한 뒤 첫 사용 때 확인 필요) |
| CON-6 | ✅ | `WebhooksController` — 비밀 주소 + HMAC 서명 |
| CON-5, CON-7, GSH-5 | — | P1·P2 |

## 4.7 모바일

| ID | 상태 | 위치와 메모 |
|---|---|---|
| MOB-1·2 | ◐ | 1열이 아니라 2열 타일(시안). 순서는 PC 배치를 따르다가 길게 눌러 끌면 `layout_sm`에 따로 저장 |
| MOB-3 | ✅ | `apps/web/public/manifest.webmanifest`, `sw.js`(껍데기만 캐시) |
| MOB-4 | ◐ | 카드 뷰 대신 열 넘김 |
| MOB-5 | — | P2 |

## 4.8 설정, 5장

| ID | 상태 | 위치와 메모 |
|---|---|---|
| USR-2a | ✅ | AES-256-GCM(`common/crypto.ts`), 끝 4자리만 표시, PIN 재입력 |
| USR-5 | ✅ | `llm.service.ts`의 `assertBudget`·`record` |
| USR-6 | ✅ | `PUT /api/settings`, `PUT /api/settings/security` |
| 보안 | ✅ | CSRF(이중 제출), CSP, 로그인·PIN 속도 제한 |
| 외부 LLM 전송 기준 | ✅ | 앞 200행, 주민번호·카드번호 가림(`packages/shared/src/mask.ts`), 표별 "LLM에 보내지 않음" |
| 휴지통 | ✅ | 30일 뒤 워커가 삭제 |
| 로그 | ✅ | `audit_logs` — 프롬프트·키·토큰은 기록하지 않음 |
| 백업 | ✅ | `scripts/backup.sh`, `scripts/restore.sh` (cron 등록과 외부 복사는 직접) |
