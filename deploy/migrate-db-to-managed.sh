#!/usr/bin/env bash
# C-0: 사무실 Postgres → 관리형 Postgres 데이터 이전
#
# 왜 이 순서인가
#   DB 만 먼저 옮기고 나머지는 그대로 둔다. 그러면 **Worker 를 한 줄도 쓰기 전에**
#   새 DB 가 멀쩡한지 지금 화면으로 확인할 수 있다.
#   문제가 있으면 .env.production 의 DB 주소를 되돌리면 끝이다.
#
# 원본은 지우지 않는다. 사무실 Postgres 컨테이너와 볼륨은 그대로 남는다.
#
# 사용법 (사무실 호스트에서 실행):
#   bash deploy/migrate-db-to-managed.sh 'postgresql://user:pass@host/db?sslmode=require'
#
# psql 을 설치하지 않는다 — 이미 있는 postgres:15-alpine 이미지를 빌려 쓴다.
set -euo pipefail

TARGET_URL="${1:-}"
SRC_CONTAINER="${SRC_CONTAINER:-sep-v2-postgres}"
SRC_DB="${SRC_DB:-sep_v2_prod}"
SRC_USER="${SRC_USER:-postgres}"
PG_IMAGE="${PG_IMAGE:-postgres:15-alpine}"
# 대상이 공개 주소면 비워 둔다. 리허설처럼 대상이 도커 네트워크 안에 있을 때만 쓴다.
PG_NETWORK="${PG_NETWORK:-}"
NETARG=(); [ -n "$PG_NETWORK" ] && NETARG=(--network "$PG_NETWORK")
WORK="$(mktemp -d)"
DUMP="$WORK/sep_v2.sql"

die() { echo "✘ $*" >&2; exit 1; }
ok()  { echo "  ✓ $*"; }

[ -n "$TARGET_URL" ] || die "대상 연결 문자열을 인자로 주세요.
  예: bash $0 'postgresql://user:pass@host/db?sslmode=require'"
case "$TARGET_URL" in postgres://*|postgresql://*) ;; *) die "postgresql:// 로 시작해야 합니다." ;; esac

# 대상이 실수로 원본을 가리키는 것을 막는다. 자기 자신에게 복원하면 데이터가 뒤섞인다.
case "$TARGET_URL" in *@localhost*|*@127.0.0.1*|*@postgres:*) die "대상이 로컬/사내 DB 를 가리킵니다. 관리형 주소인지 확인하세요." ;; esac

echo "1) 원본 확인 — $SRC_CONTAINER/$SRC_DB"
docker exec "$SRC_CONTAINER" pg_isready -U "$SRC_USER" >/dev/null || die "원본 Postgres 에 닿지 못했습니다."
SRC_VER=$(docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -tAc "show server_version;")
ok "원본 Postgres $SRC_VER"

# 이전 전후로 대조할 기준값. 행 수가 맞는지가 유일한 판정 근거다.
counts() {  # $1: psql 실행 함수명
  $1 "select schemaname||'.'||relname||'='||n_live_tup from pg_stat_user_tables order by 1;"
}
src_psql() { docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d "$SRC_DB" -tAc "$1"; }
dst_psql() { docker run --rm -i "${NETARG[@]}" "$PG_IMAGE" psql "$TARGET_URL" -tAc "$1"; }

echo "2) 대상 연결 확인"
DST_VER=$(dst_psql "show server_version;" | tr -d '[:space:]') || die "대상에 연결하지 못했습니다. 연결 문자열과 sslmode 를 확인하세요."
ok "대상 Postgres $DST_VER"
case "$DST_VER" in 1[5-9]*|2[0-9]*) ;; *) echo "  ⚠ 대상이 Postgres 15 미만입니다 ($DST_VER). 스키마가 안 맞을 수 있습니다." ;; esac

DST_TABLES=$(dst_psql "select count(*) from information_schema.tables where table_schema in ('v2','public') and table_type='BASE TABLE';" | tr -d '[:space:]')
[ "$DST_TABLES" = "0" ] || die "대상에 이미 테이블이 $DST_TABLES 개 있습니다. 빈 DB 에만 복원합니다."
ok "대상이 비어 있음"

echo "3) 덤프"
# --no-owner/--no-acl: 관리형은 소유자·롤이 다르다. 그대로 넣으면 복원이 롤 없음으로 실패한다.
docker exec "$SRC_CONTAINER" pg_dump -U "$SRC_USER" -d "$SRC_DB" \
  --no-owner --no-acl > "$DUMP"
ok "$(wc -c < "$DUMP" | awk '{printf "%.1f KB", $1/1024}') → $DUMP"
grep -q "CREATE SCHEMA v2" "$DUMP" || echo "  ⚠ 덤프에 v2 스키마 생성문이 없습니다. 확인이 필요합니다."

echo "4) 복원"
docker run --rm -i "${NETARG[@]}" "$PG_IMAGE" psql "$TARGET_URL" -v ON_ERROR_STOP=1 -q < "$DUMP" \
  || die "복원이 실패했습니다. 대상은 부분 복원 상태일 수 있으니 새 DB 에 다시 시도하세요."
ok "복원 완료"

echo "5) 행 수 대조 — 이게 유일한 판정 기준이다"
SRC_COUNTS=$(counts src_psql | sed 's/[[:space:]]*$//' | sort)
DST_COUNTS=$(counts dst_psql | sed 's/[[:space:]]*$//' | sort)
if [ "$SRC_COUNTS" = "$DST_COUNTS" ]; then
  echo "$DST_COUNTS" | sed 's/^/     /'
  ok "전 테이블 행 수 일치"
else
  echo "  원본:"; echo "$SRC_COUNTS" | sed 's/^/     /'
  echo "  대상:"; echo "$DST_COUNTS" | sed 's/^/     /'
  die "행 수가 다릅니다. 대상 DB 를 버리고 다시 시도하세요."
fi

# 이걸 안 옮기면 새 DB 에서 마이그레이션이 처음부터 다시 돌아 충돌한다
MIG=$(dst_psql "select count(*) from public.schema_migrations;" | tr -d '[:space:]')
[ "$MIG" -gt 0 ] || die "schema_migrations 가 비어 있습니다. 마이그레이션이 다시 실행될 수 있습니다."
ok "schema_migrations $MIG 건 이전됨"

rm -rf "$WORK"
cat <<'NEXT'

✅ 이전 완료. 원본은 그대로 남아 있습니다.

다음 (사무실 백엔드를 새 DB 로 전환):
  1) deploy/.env.production 에 DATABASE_URL 을 넣는다 (있으면 DB_HOST 등을 무시하고 이것을 쓴다)
       DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
     되돌릴 때는 이 한 줄만 지우면 사내 DB 로 돌아간다
  2) docker compose -p sep-v2 -f docker-compose.prod.yml --env-file .env.production up -d backend
  3) 화면에서 미팅 목록·상세가 그대로 보이는지 확인
  4) 문제가 있으면 .env.production 을 되돌리고 같은 명령을 다시 — 원본이 남아 있어 즉시 복구된다

원본 삭제는 며칠 운영해 본 뒤에 결정하세요. 서두를 이유가 없습니다.
NEXT
