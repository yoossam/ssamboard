#!/usr/bin/env bash
# 백업 복구. 분기마다 한 번은 시험용 DB에 복구해 본다(5장 백업).
#   ./scripts/restore.sh backups/jarvis-20261125-033000.sql.gz.enc            시험용 DB(jarvis_restore)에 복구
#   ./scripts/restore.sh backups/jarvis-20261125-033000.sql.gz.enc jarvis     실제 DB에 복구(앱을 먼저 멈춘다)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
FILE="${1:?복구할 백업 파일을 지정하세요}"
TARGET="${2:-jarvis_restore}"

if [ "$TARGET" = "jarvis" ]; then
  read -r -p "실제 DB(jarvis)를 지우고 이 백업으로 되돌립니다. 계속하려면 yes 를 입력하세요: " answer
  [ "$answer" = "yes" ] || exit 1
  docker compose stop app
fi
docker compose exec -T db psql -U jarvis -d postgres -c "drop database if exists \"$TARGET\"" -c "create database \"$TARGET\" owner jarvis"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" | gunzip \
  | docker compose exec -T db psql -U jarvis -d "$TARGET" -v ON_ERROR_STOP=1 -q
docker compose exec -T db psql -U jarvis -d "$TARGET" -At -c "select 'users ' || count(*) from users union all select 'tables ' || count(*) from data_tables union all select 'rows ' || count(*) from data_rows"
[ "$TARGET" = "jarvis" ] && docker compose start app
echo "복구 완료: $TARGET"
