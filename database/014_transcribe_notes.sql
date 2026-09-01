-- 014: 전사가 **어떻게** 끝났는지 남긴다
--
-- 왜 필요한가 (2026-08-20 조사 두 건)
--   지금 행에는 `done` 이냐 `failed` 냐만 남는다. 그런데 실제로 사고를 만든 것은
--   **`done` 인데 등급이 내려간 경우**였다.
--
--     · 파트3 은 `done` 인데 화자가 없었다 — diarize 가 거절돼 whisper 로 떨어진 것이다.
--       620초·4,485자가 세그먼트 **1개**로 저장됐고, 화자가 하나뿐이라
--       `mapSpeakerRoles` 의 1명 분기를 타 전부 '영업대표' 가 됐다.
--     · 등록한 목소리는 556개 발화 중 **5개·49자**에만 붙었다. 그런데
--       `toKnownSpeakers` 는 R2 에서 클립이 사라져도, base64 가 깨져도, 형식이 틀려도
--       `[]` 를 돌려주고 전사는 평범하게 성공한다.
--
--   둘 다 **화면에도 로그에도 "정상" 으로 보였다.** 사용자는 결과가 나빠진 것만 보고
--   왜인지 모른다. 원인을 좁히기 어려웠던 이유 자체가 이 침묵이다.
--
-- 왜 컬럼 하나인가
--   `transcribe_error` 를 쓰지 않는다. 그 이름은 "실패했다" 는 뜻이고, 여기 담을 것은
--   **성공했지만 알아야 할 것**이다. 두 뜻을 한 칸에 넣으면 다음 사람이 읽을 때 어긋난다.
--
--   jsonb 하나로 둔 것은 담을 항목이 더 늘 것이기 때문이다(구간 경계 화자 잇기가 대기 중).
--   컬럼을 그때마다 추가하면 마이그레이션만 늘고, 이 값은 **읽고 보여 줄 뿐 조인하지 않는다.**
--
-- 담는 모양
--   {
--     "engine": "diarize" | "whisper",   -- whisper 면 화자 정보가 없다
--     "enrolled": 1,                     -- 등록 목소리를 몇 개 넘겼나
--     "matched": 0,                      -- 그중 실제로 실명이 돌아온 화자 수
--     "attempts": 2,                     -- STT 를 몇 번 불렀나 (5xx 재시도 포함)
--     "retried_without_refs": false,     -- 4xx 로 거절돼 등록 없이 다시 불렀나
--     "collapsed": 0,                    -- 반복 루프를 몇 줄 접었나
--     "diarize_error": "500 ..."         -- whisper 로 떨어진 이유
--   }
--
-- **되돌리기**: `alter table v2.meeting_recordings drop column transcribe_notes;`
--   컬럼만 지우면 되고 다른 것은 건드리지 않는다. 읽는 쪽은 전부 `?? null` 로 받는다.

alter table v2.meeting_recordings
  add column if not exists transcribe_notes jsonb;

comment on column v2.meeting_recordings.transcribe_notes is
  '전사가 어떻게 끝났는지. status=done 이어도 등급이 내려간 경우를 여기서 안다 (014).';

-- 등급이 내려간 것만 빨리 찾기 위한 인덱스.
-- **전체가 아니라 부분 인덱스다** — 정상인 행이 대부분이라 그쪽은 색인할 값어치가 없다.
create index if not exists idx_recordings_degraded
  on v2.meeting_recordings ((transcribe_notes->>'engine'))
  where transcribe_notes->>'engine' = 'whisper';
