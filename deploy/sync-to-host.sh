#!/usr/bin/env bash
# 저장소 → 배포 호스트 동기화
#
# 손으로 rsync 를 치지 말 것. 2026-08-08 에 --delete 가 **nginx 자체서명 인증서를 지웠다.**
# 인증서는 호스트에서 생성한 것이라 저장소에 없고, 컨테이너가 계속 떠 있어서
# 그 순간에는 아무 일도 없어 보였다. 몇 시간 뒤 nginx 를 재시작하자 기동에 실패했다.
#
# 여기 모아 둔 제외 규칙이 그 사고의 결론이다.
set -euo pipefail

HOST="${HOST:-sam@192.168.0.131}"
DEST="${DEST:-/home/sam/sep-v2/}"
cd "$(dirname "$0")/.."

rsync -az --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude frontend \
  --exclude mvp \
  --exclude .env \
  --exclude .env.production \
  --exclude '.env.production.*' \
  --exclude '*.log' \
  --exclude 'deploy/web/certs' \
  -e 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new' \
  ./ "$HOST:$DEST"

echo "✓ 동기화 완료 → $HOST:$DEST"
echo "  제외: node_modules · dist · .git · frontend · mvp · .env* · *.log · deploy/web/certs"
echo
echo "인증서가 없어졌다면 (nginx 가 cert.pem 없다고 기동 실패하면) 다시 만든다:"
cat <<'REGEN'
  ssh sam@192.168.0.131 'cd ~/sep-v2/deploy/web && docker run --rm -v "$PWD/certs:/c" \
    alpine/openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout /c/key.pem -out /c/cert.pem -subj "/CN=sep-v2" \
    -addext "subjectAltName=IP:192.168.0.131,IP:100.100.1.100,IP:127.0.0.1,DNS:localhost"'
  ssh sam@192.168.0.131 'docker restart sep-v2-web'
REGEN
