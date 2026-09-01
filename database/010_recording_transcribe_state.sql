-- ===================================================================
-- 010: 녹음의 전사 상태
--
-- 무엇이 문제였나
--   `POST /recordings` 가 업로드 요청 **안에서** STT 를 기다렸다. 10분짜리 하나에 실측 188초다.
--   그 사이 순서는 R2 저장 → STT → 화자 판정 → DB insert 였으므로,
--   **R2 에 쓴 뒤 DB 에 넣기 전까지** 끊기면 파일만 남고 행이 없었다. 그 188초의 대부분이 이 구간이다.
--   2026-08-11 에 회수한 고아 객체 4개(40분 15초)가 정확히 그 구간에서 생긴 것이다.
--
--   요청 안에서 기다리는 한 이 구간은 없앨 수 없다. 전사를 Workflow 로 빼면
--   업로드는 R2 저장과 insert 만 남고, 그 사이가 count 한 번과 insert 한 번으로 줄어든다.
--
-- 왜 상태 컬럼이 필요한가
--   전사가 요청 밖에서 돌면 "아직 전사가 없다" 와 "전사가 실패했다" 를 구분할 수 없다.
--   지금은 둘 다 `transcription is null` 이라 화면이 무엇을 보여줄지 정할 수 없고,
--   분석이 시작될 때 기다려야 할지 그냥 진행할지도 판단할 수 없다.
--
--   그리고 이 컬럼은 **중복 STT 를 막는 잠금**이기도 하다. 전사 Workflow 와
--   분석 Workflow 의 보정 경로가 같은 녹음을 동시에 집으면 STT 비용을 두 번 낸다.
--   'processing' 으로 바꾸는 조건부 update 를 이긴 쪽만 전사한다 (v1 의 claimAnalysis 와 같은 방식).
-- ===================================================================

alter table v2.meeting_recordings
  add column if not exists transcribe_status text not null default 'pending',
  add column if not exists transcribe_error  text,
  add column if not exists transcribed_at    timestamp with time zone,
  -- 실패한 전사를 다시 시도할 때 무한히 돌지 않도록 센다.
  add column if not exists transcribe_tries  integer not null default 0,
  -- **잠금을 잡은 시각.** 이게 없으면 'processing' 인 채로 죽은 행을 아무도 다시 집지 못한다 —
  -- 잠금은 풀리지 않고, 분석의 보정 경로는 영원히 'busy' 만 받는다.
  -- 오래된 'processing' 은 죽은 것으로 보고 회수한다 (v1 ANALYSIS_STALE_MS 와 같은 방식).
  add column if not exists transcribe_started_at timestamp with time zone;

comment on column v2.meeting_recordings.transcribe_status is
  'pending: 아직 · processing: 진행 중(잠금) · done: 완료 · failed: 실패. 조건부 update 로 중복 STT 를 막는다.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'meeting_recordings_transcribe_status_chk'
  ) then
    alter table v2.meeting_recordings
      add constraint meeting_recordings_transcribe_status_chk
      check (transcribe_status in ('pending', 'processing', 'done', 'failed'));
  end if;
end $$;

-- 기존 행 보정: 전사문이 있으면 완료된 것이다. 없는 것은 옛 경로에서 실패한 것이라
-- 'pending' 이 아니라 'failed' 로 둔다 — pending 으로 두면 아래 회수 쿼리가 전부 다시 전사한다.
update v2.meeting_recordings
   set transcribe_status = case
         when transcription is not null and transcription <> '' then 'done'
         else 'failed'
       end,
       transcribed_at = case
         when transcription is not null and transcription <> '' then created_at
         else null
       end
 where transcribe_status = 'pending';

-- 밀린 전사를 찾는 쿼리가 매번 전체를 훑지 않도록. 끝난 행은 대부분이므로 부분 인덱스로 둔다.
create index if not exists idx_meeting_recordings_transcribe_pending
  on v2.meeting_recordings (transcribe_status, created_at)
  where transcribe_status in ('pending', 'processing');
