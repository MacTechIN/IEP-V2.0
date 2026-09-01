#!/usr/bin/env bash
# Deploy SEP v2 backend to maindev.
# Safe rsync (PROTECTS the on-host deploy/.env.production so --delete can't remove it),
# then build + up with the production compose. Secrets live only on the host.
set -euo pipefail

HOST="${1:-sam@192.168.0.131}"
DEST="/home/sam/sep-v2"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/"

echo "==> rsync $SRC -> $HOST:$DEST"
rsync -az --delete \
  --filter='P deploy/.env.production' \
  --filter='P deploy/uploads' \
  --filter='P deploy/web/certs' \
  --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
  --exclude 'frontend' --exclude 'mvp' \
  --exclude '.env' --exclude '.env.production' --exclude '.env.production.*' --exclude '*.log' \
  -e "ssh -o BatchMode=yes" \
  "$SRC" "$HOST:$DEST/"

echo "==> build + up on $HOST"
ssh -o BatchMode=yes "$HOST" '
  set -e
  cd ~/sep-v2/deploy
  if [ ! -f .env.production ]; then
    echo "ERROR: deploy/.env.production missing on host — create it before deploying." >&2
    exit 1
  fi
  docker compose -p sep-v2 -f docker-compose.prod.yml --env-file .env.production up -d --build
  for i in $(seq 1 25); do
    st=$(docker inspect -f "{{.State.Health.Status}}" sep-v2-backend 2>/dev/null || true)
    [ "$st" = "healthy" ] && { echo "backend healthy"; exit 0; }
    sleep 3
  done
  echo "WARN: backend not healthy within timeout" >&2
  exit 1
'
