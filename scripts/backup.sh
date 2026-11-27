#!/usr/bin/env bash
# 매일 새벽 PostgreSQL 덤프(5장 백업). 덤프를 압축·암호화해 backups/ 에 두고 14일 지난 것은 지운다.
# 서버의 cron에 등록한다(매일 03:30):
#   30 3 * * *  cd /path/to/jarvis && ./scripts/backup.sh >> backups/backup.log 2>&1
# 주 1회는 backups/ 를 외부 저장소(Google Drive·NAS)로 복사한다. 예: rclone copy backups remote:jarvis-backups
# 암호(BACKUP_PASSPHRASE)와 마스터 키(MASTER_KEY)는 백업 파일과 다른 곳에 보관한다.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
OUT_DIR="${BACKUP_DIR:-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/jarvis-$STAMP.sql.gz.enc"
mkdir -p "$OUT_DIR"

# 실패하면 알림 센터로 알린다(설정 → 연결에서 만든 웹훅). 서명: 본문의 HMAC-SHA256.
notify_failure() {
  [ -n "${BACKUP_WEBHOOK_URL:-}" ] && [ -n "${BACKUP_WEBHOOK_SECRET:-}" ] || return 0
  local body sig
  body="{\"title\":\"백업 실패\",\"body\":\"$1\",\"priority\":\"urgent\",\"dedupe_key\":\"backup-failed\"}"
  sig="$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$BACKUP_WEBHOOK_SECRET" | awk '{print $NF}')"
  curl -fsS -m 20 -X POST "$BACKUP_WEBHOOK_URL" -H 'Content-Type: application/json' -H "X-Jarvis-Signature: sha256=$sig" --data "$body" >/dev/null || true
}
trap 'rm -f "$FILE.tmp"; notify_failure "$(date +%F) 덤프를 만들지 못했습니다. backups/backup.log를 확인하세요."' ERR

[ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "BACKUP_PASSPHRASE가 비어 있습니다." >&2; false; }

docker compose exec -T db pg_dump -U jarvis -d jarvis --no-owner \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$FILE.tmp"

# 덤프가 비정상적으로 작으면 실패로 본다.
[ "$(wc -c < "$FILE.tmp")" -gt 2048 ]
mv "$FILE.tmp" "$FILE"
find "$OUT_DIR" -name 'jarvis-*.sql.gz.enc' -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') 백업 완료: $FILE ($(wc -c < "$FILE") bytes)"
