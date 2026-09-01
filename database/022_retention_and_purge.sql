-- 022: 보관 기간과 파기
--
-- ── 왜 함수가 필요한가 ────────────────────────────────────────
--
-- 2026-08-26 에 시험 데이터를 지우다 **외래키 다섯에 연달아 막혔다.**
-- 상속받은 SEP 표들(`analysis_results`·`action_items`·`emails`·
-- `transcript_segments`·`meeting_recordings`)이 전부 `NO ACTION` 이다.
--
-- SEP 에서는 드러날 일이 없었다 — 앱의 미팅 삭제가 **소프트 삭제**(`deleted_at`)라
-- 하드 삭제 경로를 지나간 적이 없기 때문이다.
--
-- **파기는 진짜로 지우는 일이다.** 순서를 매번 손으로 맞추면 언젠가 틀리고,
-- 틀리면 절반만 지워진 사건이 남는다. 그래서 함수 하나로 묶는다.
--
-- ── 자동으로 지우지 않는다 ────────────────────────────────────
--
-- `CLAUDE.md` — "자동으로 지우는 청소기를 만들지 않는다. 목록을 보여 주고 사람이 정한다."
--
-- 그래서 **뷰와 함수를 나눈다.**
--   `purge_candidates` 는 대상을 **보여 주기만** 한다. 아무것도 지우지 않는다.
--   `purge_matter()` 는 **불러야만** 지운다. 예약도, 트리거도, 배치도 걸지 않는다.
--
-- ── 보관 기간은 우리가 정하지 않는다 ──────────────────────────
--
-- **법정 보존기간을 숫자로 박아 넣지 않았다.** 사건 유형·사무소 내규·의뢰인과의
-- 약정에 따라 다르고, 그것은 변호사가 정할 일이지 우리가 정할 일이 아니다.
--
-- `retention_years` 가 **null 이면 파기 대상에 아예 오르지 않는다.**
-- 모르면 지우지 않는 쪽이 안전하다 — 지운 것은 되돌릴 수 없다.
--
-- **되돌리기**
--   drop view v2.purge_candidates;
--   drop function v2.purge_matter(uuid);
--   alter table v2.matters drop column retention_years;

alter table v2.matters
  add column if not exists retention_years integer
  check (retention_years is null or retention_years between 1 and 100);

comment on column v2.matters.retention_years is
  '사건 종결 후 보관 연수 (022). **null 이면 파기 대상에 오르지 않는다** — 모르면 지우지 않는다.';

/**
 * 파기해도 되는 사건. **보여 주기만 한다.**
 *
 * 조건 셋이 모두 맞아야 오른다 —
 *   종결됐고(`closed_on`), 보관 연수가 정해져 있고(`retention_years`), 그 기간이 지났다.
 * 하나라도 비면 오르지 않는다.
 */
create or replace view v2.purge_candidates as
select
  m.id            as matter_id,
  m.user_id,
  m.title,
  m.file_no,
  m.closed_on,
  m.retention_years,
  (m.closed_on + make_interval(years => m.retention_years))         as purge_on,
  (current_date - (m.closed_on + make_interval(years => m.retention_years))) as days_over,
  (select count(*) from v2.meetings  x where x.matter_id = m.id)    as meetings,
  (select count(*) from v2.deadlines x where x.matter_id = m.id)    as deadlines,
  (select count(*) from v2.evidence  x where x.matter_id = m.id)    as evidence
from v2.matters m
where m.status in ('closed', 'archived')
  and m.closed_on is not null
  and m.retention_years is not null
  and current_date >= (m.closed_on + make_interval(years => m.retention_years));

comment on view v2.purge_candidates is
  '파기해도 되는 사건 (022). **보여 주기만 한다** — 지우는 것은 사람이 purge_matter() 를 부를 때뿐이다.';

/**
 * 사건 하나를 **진짜로** 지운다.
 *
 * 외래키 순서를 여기 한 곳에 담는다 — 매번 손으로 맞추면 언젠가 틀리고,
 * 틀리면 절반만 지워진 사건이 남는다.
 *
 * **자동으로 불리지 않는다.** 예약도 트리거도 걸지 않았다.
 * 부르기 전에 `purge_candidates` 로 무엇이 지워지는지 보고, 사본을 남기는 것은
 * 부르는 쪽의 몫이다 (`CLAUDE.md` — 되돌릴 수 없는 삭제 전에는 목록과 사본을 남긴다).
 *
 * `access_log` 는 **지우지 않는다.** 파기했다는 사실 자체가 남아야 한다.
 */
create or replace function v2.purge_matter(p_matter uuid)
returns jsonb language plpgsql as $$
declare
  m_ids uuid[];
  n_meetings int; n_segments int; n_recordings int; n_deadlines int;
begin
  select array_agg(id) into m_ids from v2.meetings where matter_id = p_matter;
  m_ids := coalesce(m_ids, '{}');

  -- NO ACTION 인 것부터 (상속받은 SEP 표들)
  delete from v2.analysis_results    where meeting_id = any(m_ids);
  delete from v2.action_items        where meeting_id = any(m_ids);
  delete from v2.emails              where meeting_id = any(m_ids);
  delete from v2.transcript_segments where meeting_id = any(m_ids);
  get diagnostics n_segments = row_count;
  delete from v2.meeting_recordings  where meeting_id = any(m_ids);
  get diagnostics n_recordings = row_count;

  -- pii_masks·findings·legal_analyses 는 미팅에 cascade 로 딸려 간다
  delete from v2.meetings where matter_id = p_matter;
  get diagnostics n_meetings = row_count;

  select count(*) into n_deadlines from v2.deadlines where matter_id = p_matter;

  -- 사건에 딸린 것(요건·타임라인·증거·상대방·기한)은 cascade 로 함께 간다
  delete from v2.matters where id = p_matter;

  return jsonb_build_object(
    'matter_id', p_matter,
    'meetings', n_meetings,
    'segments', n_segments,
    'recordings', n_recordings,
    'deadlines', n_deadlines,
    'note', 'access_log 는 지우지 않았다 — 파기했다는 사실이 남아야 한다'
  );
end $$;

comment on function v2.purge_matter(uuid) is
  '사건 하나를 진짜로 지운다 (022). 자동으로 불리지 않는다. access_log 는 남긴다.';
