-- 030 검증 — 분석 결과의 이전 판
--
-- 확인하는 것
--   1. 열을 골라 담지 않는다 — **행 전체**가 들어간다. 열이 늘어도 따라온다
--   2. 미팅이 지워지면 이력도 함께 간다 (CASCADE)
--   3. `keep_analysis_history` 는 **그 미팅 것만** 정리한다.
--      다른 미팅 이력을 건드리면 「무엇이 지워졌는지 알 수 없는」 상태가 된다
--   4. 최근 것을 남기고 **오래된 것부터** 지운다
--   5. keep 이 0이나 음수여도 **적어도 하나는 남긴다** — 전부 지우는 길을 만들지 않는다
--   6. 남길 개수보다 적으면 아무것도 안 지운다
--
-- 실행: psql -f database/tests/030_analysis_history.sql

\set ON_ERROR_STOP on

do $$
declare
  uid uuid; m1 uuid; m2 uuid; n int; got jsonb; cnt int;
begin
  insert into v2.users (email, name, password_hash, role)
  values ('t030@example.invalid', '검증030', 'x', 'user') returning id into uid;
  insert into v2.meetings (user_id, title, start_time, end_time) values (uid, '030-1', now(), now()) returning id into m1;
  insert into v2.meetings (user_id, title, start_time, end_time) values (uid, '030-2', now(), now()) returning id into m2;

  -- ── 1. 행 전체가 담기는가 ──
  insert into v2.analysis_results (meeting_id, summary, key_points)
  values (m1, '옛 요약', array['가','나']);
  insert into v2.analysis_history (meeting_id, result, segment_count)
  select m1, to_jsonb(a), 1027 from v2.analysis_results a where a.meeting_id = m1;

  select result into got from v2.analysis_history where meeting_id = m1;
  if got->>'summary' <> '옛 요약' then raise exception '1 실패: 요약이 안 담겼다'; end if;
  if got->'key_points' is null then raise exception '1 실패: 배열 열이 안 담겼다'; end if;
  -- **열을 골라 담지 않았다는 증거**: 우리가 안 적은 열도 들어 있어야 한다
  if not (got ? 'customer_needs') then raise exception '1 실패: 안 적은 열이 빠졌다 (열을 골라 담고 있다)'; end if;
  raise notice '  ✓ 1. 행 전체가 담긴다 (안 적은 열까지)';

  -- ── 3·4. 그 미팅 것만 · 오래된 것부터 ──
  delete from v2.analysis_history where meeting_id = m1;
  for i in 1..8 loop
    insert into v2.analysis_history (meeting_id, result, segment_count, replaced_at)
    values (m1, jsonb_build_object('n', i), i, now() - (10 - i) * interval '1 minute');
  end loop;
  for i in 1..3 loop
    insert into v2.analysis_history (meeting_id, result, segment_count)
    values (m2, jsonb_build_object('other', i), i);
  end loop;

  n := v2.keep_analysis_history(m1, 5);
  if n <> 3 then raise exception '4 실패: 3개를 지웠어야 하는데 %개', n; end if;
  select count(*) into cnt from v2.analysis_history where meeting_id = m1;
  if cnt <> 5 then raise exception '4 실패: 5개가 남았어야 하는데 %개', cnt; end if;
  -- 남은 것이 **최근 다섯**인가 (4~8번)
  select min((result->>'n')::int) into n from v2.analysis_history where meeting_id = m1;
  if n <> 4 then raise exception '4 실패: 오래된 것부터 안 지웠다 (가장 오래된 것이 %번)', n; end if;
  select count(*) into cnt from v2.analysis_history where meeting_id = m2;
  if cnt <> 3 then raise exception '3 실패: **다른 미팅 이력을 건드렸다** (%개 남음)', cnt; end if;
  raise notice '  ✓ 3. 그 미팅 것만 정리한다';
  raise notice '  ✓ 4. 오래된 것부터 지운다 (최근 5개가 남았다)';

  -- ── 6. 남길 개수보다 적으면 안 지운다 ──
  n := v2.keep_analysis_history(m2, 5);
  if n <> 0 then raise exception '6 실패: 3개뿐인데 %개를 지웠다', n; end if;
  raise notice '  ✓ 6. 남길 개수보다 적으면 안 지운다';

  -- ── 5. keep 0·음수여도 하나는 남긴다 ──
  n := v2.keep_analysis_history(m1, 0);
  select count(*) into cnt from v2.analysis_history where meeting_id = m1;
  if cnt <> 1 then raise exception '5 실패: keep=0 에 %개 남음 (하나는 남아야 한다)', cnt; end if;
  n := v2.keep_analysis_history(m2, -3);
  select count(*) into cnt from v2.analysis_history where meeting_id = m2;
  if cnt <> 1 then raise exception '5 실패: keep=-3 에 %개 남음', cnt; end if;
  raise notice '  ✓ 5. keep 이 0·음수여도 하나는 남긴다 (전부 지우는 길이 없다)';

  -- ── 2. 미팅이 지워지면 함께 간다 ──
  delete from v2.analysis_results where meeting_id in (m1, m2);
  delete from v2.meetings where id = m1;
  select count(*) into cnt from v2.analysis_history where meeting_id = m1;
  if cnt <> 0 then raise exception '2 실패: 미팅을 지웠는데 이력이 %개 남았다', cnt; end if;
  raise notice '  ✓ 2. 미팅이 지워지면 이력도 함께 간다';

  delete from v2.meetings where id = m2;
  delete from v2.users where id = uid;
  raise notice '✓ 030 통과 — 행 전체를 남기고, 그 미팅 것만 정리하고, 전부 지우지 않는다';
end $$;
