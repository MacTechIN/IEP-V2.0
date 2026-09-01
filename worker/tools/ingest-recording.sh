#!/usr/bin/env bash
# 되찾은 녹음 파일 하나를 **서버 쪽에서** 조각내 올리고, 지정한 미팅에 붙여 다시 분석한다.
#
#   ./tools/ingest-recording.sh <오디오파일> <미팅ID> [이메일] [비밀번호]
#
# 왜 브라우저를 쓰지 않는가 (2026-08-20)
#   화면의 업로드 경로(`prepareRecordings`)는 파일 전체를 `decodeAudioData` 로 편다.
#   83분 opus 는 48kHz 스테레오 float32 로 약 1.9GB 가 되고 탭이 죽는다 —
#   그날 83분 회의가 통째로 사라진 자리가 정확히 거기다.
#   ffmpeg 은 스트리밍으로 자르므로 길이와 무관하다.
#
# 조각 길이 720초는 임의값이 아니다. `gpt-4o-transcribe-diarize` 의 입력 한도가
# 1400초이고, 16kHz 모노 16bit(32,000 B/s)로 720초면 23.0MB 라 25MB 한도에도 여유가 있다.
set -euo pipefail

FILE="${1:?오디오 파일 경로}"
MEETING="${2:?미팅 ID}"
EMAIL="${3:-admin@company.com}"
PASSWORD="${4:-}"
API="${API:-https://sep-v2-api.wooriszhome.workers.dev/api/v2}"
CHUNK_SEC=600
MAX_SEC=720

command -v ffmpeg >/dev/null || { echo "ffmpeg 이 없습니다: sudo apt install -y ffmpeg" >&2; exit 1; }
[ -f "$FILE" ] || { echo "파일이 없습니다: $FILE" >&2; exit 1; }

if [ -z "$PASSWORD" ]; then
  read -rs -p "비밀번호($EMAIL): " PASSWORD; echo
fi

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$FILE" | cut -d. -f1)
echo "원본 ${DUR}초 ($(du -h "$FILE" | cut -f1))"

# 16kHz 모노 WAV 로 바꾸면서 자른다. 한 번에 훑으므로 길이에 비례해 시간만 늘고 메모리는 일정하다.
ffmpeg -v error -i "$FILE" -ac 1 -ar 16000 -c:a pcm_s16le \
  -f segment -segment_time "$CHUNK_SEC" "$WORK/part-%03d.wav"
mapfile -t PARTS < <(ls "$WORK"/part-*.wav | sort)
N=${#PARTS[@]}
echo "조각 ${N}개"

for p in "${PARTS[@]}"; do
  s=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$p" | cut -d. -f1)
  if [ "$s" -gt "$MAX_SEC" ]; then
    echo "조각 $p 가 ${s}초로 상한(${MAX_SEC}초)을 넘습니다 — 전사가 거절됩니다" >&2
    exit 1
  fi
done

TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$EMAIL" "$PASSWORD")" \
  | python3 -c 'import sys,json;print((json.load(sys.stdin).get("data") or {}).get("accessToken",""))')
[ -n "$TOKEN" ] || { echo "로그인 실패" >&2; exit 1; }

# **한 번에 하나씩 올린다.** 동시에 던지면 서로 밀려 전부 제한 시간을 넘긴다(2026-08-11 실측).
IDS=()
i=0
for p in "${PARTS[@]}"; do
  i=$((i+1))
  s=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$p" | cut -d. -f1)
  echo -n "  [$i/$N] $(basename "$p") ${s}초 … "
  id=$(curl -s -X POST "$API/recordings" -H "Authorization: Bearer $TOKEN" \
    -F "audio=@$p;type=audio/wav" -F "label=파트 $i/$N" -F "durationSeconds=$s" \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print((d.get("data") or {}).get("id",""))')
  [ -n "$id" ] || { echo "실패"; exit 1; }
  IDS+=("$id"); echo "$id"
done

echo "전사를 기다립니다 (조각당 수십 초)"
for _ in $(seq 1 120); do
  left=$(curl -s "$API/recordings/drafts" -H "Authorization: Bearer $TOKEN" \
    | python3 -c "
import sys,json
want=set('''${IDS[*]}'''.split())
rows=[r for r in (json.load(sys.stdin).get('data') or []) if r['id'] in want]
print(sum(1 for r in rows if r.get('transcribeStatus') not in ('done','failed')))")
  [ "$left" = "0" ] && break
  echo "  남은 $left"; sleep 15
done

echo "미팅 $MEETING 에 붙이고 다시 분석합니다"
curl -s -X POST "$API/meetings/$MEETING/analyze" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"recordingIds":sys.argv[1:]}))' "${IDS[@]}")" \
  | head -c 300
echo
echo "진행은 GET $API/analysis/meeting/$MEETING 으로 본다"
