#!/usr/bin/env bash
# 쌤보드 설치 — Docker 가 있는 컴퓨터(맥·리눅스·윈도우 WSL)에서 저장소 폴더 안에서 한 번 돌립니다.
#
#   ./scripts/install.sh
#
# 하는 일: 접속 방법을 묻고 → 비밀 값(암호화 키·DB 암호·설치 코드)을 만들어 .env 에 적고 →
#          docker compose 로 DB 와 앱을 띄우고 → 열릴 때까지 기다렸다가 주소와 설치 코드를 보여 줍니다.
# 다시 돌려도 됩니다. .env 가 이미 있으면 그 값을 그대로 쓰고 다시 띄우기만 합니다(비밀 값을 새로 만들지 않음).
#
# 묻지 않고 돌리기(자동화):  SSB_MODE=local|tunnel|caddy  SSB_PORT=3000  SSB_DOMAIN=board.example.com
#                            SSB_TUNNEL_TOKEN=...  ./scripts/install.sh --yes
set -euo pipefail

cd "$(dirname "$0")/.."
YES=0
[[ "${1:-}" == "--yes" ]] && YES=1

say() { printf '%s\n' "$*"; }
die() { printf '\n[멈춤] %s\n' "$*" >&2; exit 1; }
ask() { # ask "질문" 기본값 → 답(엔터면 기본값)
  local reply
  if [[ $YES -eq 1 ]]; then printf '%s' "$2"; return; fi
  read -r -p "$1 [$2]: " reply </dev/tty || true
  printf '%s' "${reply:-$2}"
}
rand_b64() { openssl rand -base64 32 | tr -d '\n'; }
rand_hex() { openssl rand -hex "$1"; }

say '──────────────────────────────────────────────'
say ' 쌤보드 설치'
say '──────────────────────────────────────────────'

command -v docker >/dev/null || die 'Docker 가 없습니다. https://docs.docker.com/get-docker/ 에서 설치한 뒤 다시 돌려 주세요.'
docker compose version >/dev/null 2>&1 || die 'docker compose 가 없습니다. Docker Desktop 또는 compose 플러그인을 설치해 주세요.'
docker info >/dev/null 2>&1 || die 'Docker 가 켜져 있지 않습니다. Docker 를 실행한 뒤 다시 돌려 주세요.'
command -v openssl >/dev/null || die 'openssl 이 없습니다(비밀 값을 만들 때 씁니다).'

get_env() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }

if [[ -f .env ]]; then
  say ''
  say '이미 .env 가 있습니다. 그 설정 그대로 다시 띄웁니다(처음부터 다시 하려면 .env 를 지우고 돌리세요).'
  MODE="$(get_env SSB_INSTALL_MODE)"; MODE="${MODE:-local}"
  [[ -L .env ]] && die '.env 가 링크입니다. 실제 파일로 바꿔 주세요.'
  for key in POSTGRES_PASSWORD MASTER_KEY PUBLIC_URL; do [[ -n "$(get_env $key)" ]] || die ".env 에 $key 가 비어 있습니다. .env 를 지우고 다시 돌리거나 값을 채워 주세요."; done
  chmod 600 .env
else
  say ''
  say '어디서 쓰실 건가요?'
  say '  1) 이 컴퓨터에서만        — http://localhost 로 바로 씁니다(가장 쉬움).'
  say '  2) Cloudflare 터널         — 도메인이 Cloudflare 에 있으면, 포트를 열지 않고 https 로 씁니다.'
  say '  3) 내 도메인 + 자동 인증서 — 이 서버의 80·443 포트가 바깥에 열려 있을 때(Caddy).'
  case "${SSB_MODE:-$(ask '번호' 1)}" in
    2|tunnel) MODE=tunnel ;;
    3|caddy) MODE=caddy ;;
    *) MODE=local ;;
  esac

  PORT="${SSB_PORT:-$(ask '이 컴퓨터에서 쓸 포트' 3000)}"
  [[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1 && PORT <= 65535 )) || die "포트는 1~65535 사이 숫자여야 합니다: $PORT"
  TUNNEL_TOKEN=''
  DOMAIN=''
  if [[ $MODE == local ]]; then
    URL="http://localhost:$PORT"
  else
    DOMAIN="${SSB_DOMAIN:-$(ask '쓸 주소(도메인만, 예: board.example.com)' '')}"
    DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%%/*}"
    [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]] || die "도메인 모양이 아닙니다: '$DOMAIN' (예: board.example.com, 한글 도메인은 영문으로 바꾼 퓨니코드 표기로)"
    URL="https://$DOMAIN"
    if [[ $MODE == tunnel ]]; then
      say ''
      say 'Cloudflare 대시보드 → Zero Trust → Networks → Tunnels 에서 터널을 만들고,'
      say "Public Hostname 을 $DOMAIN → http://app:3000 으로 정한 뒤 토큰을 붙여 넣으세요."
      TUNNEL_TOKEN="${SSB_TUNNEL_TOKEN:-$(ask '터널 토큰' '')}"
      [[ "$TUNNEL_TOKEN" =~ ^[A-Za-z0-9._=+/-]+$ ]] || die '터널 토큰이 비었거나 모양이 이상합니다(띄어쓰기·줄바꿈 없이 한 줄로 붙여 넣으세요).'
    fi
  fi

  # 비밀 값은 먼저 만들어 확인한 뒤 임시 파일에 쓰고 한 번에 옮긴다 — 중간에 멈춰도 반쯤 쓴 .env 가 남지 않게.
  SETUP_CODE="$(rand_hex 3 | tr 'a-f' 'A-F')-$(rand_hex 3 | tr 'a-f' 'A-F')"
  PG_PASS="$(rand_hex 24)"; MASTER="$(rand_b64)"; BACKUP_PASS="$(rand_b64)"
  for v in "$SETUP_CODE" "$PG_PASS" "$MASTER" "$BACKUP_PASS"; do [[ ${#v} -ge 13 ]] || die '비밀 값을 만들지 못했습니다(openssl 확인).'; done
  umask 077
  TMP_ENV="$(mktemp .env.XXXXXX)"
  trap 'rm -f "$TMP_ENV"' EXIT
  cat > "$TMP_ENV" <<EOF
# scripts/install.sh 가 $(date '+%Y-%m-%d %H:%M') 에 만든 설정. 비밀 값이 들어 있으니 남에게 보내지 마세요.
# 항목 설명은 .env.example 에 있습니다.
SSB_INSTALL_MODE=$MODE
PUBLIC_URL=$URL
PORT=3000
APP_PORT=$PORT
POSTGRES_PASSWORD=$PG_PASS
MASTER_KEY=$MASTER
LOGIN_MODE=password
SETUP_CODE=$SETUP_CODE
SESSION_DAYS=30
WORKER_ENABLED=true
TUNNEL_TOKEN=$TUNNEL_TOKEN
CADDY_DOMAIN=$DOMAIN
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_PICKER_API_KEY=
GOOGLE_APP_ID=
ALLOWED_EMAILS=
BACKUP_PASSPHRASE=$BACKUP_PASS
EOF
  mv "$TMP_ENV" .env
  trap - EXIT
  say ''
  say '.env 를 만들었습니다. 이 파일의 MASTER_KEY 를 잃으면 저장한 API 키를 다시 넣어야 하니 따로 보관해 두세요.'
fi

PROFILE=()
case "$MODE" in
  tunnel) PROFILE=(--profile tunnel) ;;
  caddy) PROFILE=(--profile caddy) ;;
esac

say ''
say '앱을 만들고 띄웁니다. 처음에는 몇 분 걸립니다…'
docker compose ${PROFILE[@]+"${PROFILE[@]}"} up -d --build

PORT="$(get_env APP_PORT)"; PORT="${PORT:-3000}"
say ''
printf '열릴 때까지 기다리는 중'
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    printf ' 완료\n'
    URL="$(get_env PUBLIC_URL)"
    SETUP_CODE="$(get_env SETUP_CODE)"
    say ''
    say '──────────────────────────────────────────────'
    say " 쌤보드가 열렸습니다:  $URL"
    [[ "$MODE" != local ]] && say " (이 서버에서는 http://localhost:$PORT 로도 열립니다)"
    say ''
    say " 처음 접속하면 '설치 코드'를 묻습니다:  $SETUP_CODE"
    say ' 그 화면에서 이름·이메일·암호를 정하고, 이어서 보드를 여는 PIN 6자리를 정합니다.'
    say ' AI 를 쓰려면 보드의 메뉴 → 설정 → 일반에서 AI 모델(Claude·GPT)을 고르고 그 회사의 API 키를 넣으세요.'
    say '──────────────────────────────────────────────'
    exit 0
  fi
  printf '.'
  sleep 2
done
printf '\n'
die "3분이 지나도 열리지 않았습니다. 'docker compose logs app' 으로 까닭을 확인해 주세요."
