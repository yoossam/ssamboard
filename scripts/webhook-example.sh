#!/usr/bin/env bash
# 웹훅으로 알림 보내기 예시(CON-6). 설정 → 연결 → "웹훅 추가"에서 받은 주소와 서명 키를 넣는다.
#   WEBHOOK_URL=https://.../api/webhooks/<id>/<secret> WEBHOOK_SECRET=<서명 키> ./scripts/webhook-example.sh "제목" "내용"
set -euo pipefail
BODY="{\"title\":\"${1:-테스트 알림}\",\"body\":\"${2:-}\",\"priority\":\"normal\"}"
SIG="$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $NF}')"
curl -fsS -X POST "$WEBHOOK_URL" -H 'Content-Type: application/json' -H "X-Jarvis-Signature: sha256=$SIG" --data "$BODY"
echo
