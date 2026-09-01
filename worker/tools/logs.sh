#!/usr/bin/env bash
# Worker 로그를 본다. **읽기만 한다 — 서비스에 영향이 없다.**
#
#   ./tools/logs.sh live            실시간으로 흘려본다
#   ./tools/logs.sh live upload     'upload' 이 들어간 줄만
#   ./tools/logs.sh errors          오류만
#
# 한 요청의 줄들은 `rid=` 로 묶인다. 업로드 하나를 따라가려면 그 값으로 grep 한다.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  TOKEN_FILE=/home/jnh/workspace/SEP/mvp/web/.env
  if [ -f "$TOKEN_FILE" ]; then
    export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' "$TOKEN_FILE" | cut -d= -f2-)
  fi
fi

MODE="${1:-live}"
FILTER="${2:-}"

case "$MODE" in
  live)
    echo "실시간 로그 (Ctrl+C 로 종료)"
    [ -n "$FILTER" ] && echo "  필터: $FILTER"
    if [ -n "$FILTER" ]; then
      npx wrangler tail --format pretty | grep --line-buffered -i "$FILTER"
    else
      npx wrangler tail --format pretty
    fi
    ;;
  errors)
    echo "오류만 (Ctrl+C 로 종료)"
    npx wrangler tail --format pretty --status error
    ;;
  *)
    echo "사용법: $0 {live|errors} [필터]" >&2
    exit 1
    ;;
esac
