-- 015 검증 — 코칭 판정 기록
--
-- 확인하는 것
--   1. `level` 과 `level_shown` 이 **따로** 남는다 (완충 규칙을 평가할 수 있어야 한다)
--   2. `session_id` 로 먼저 쌓고 나중에 미팅에 붙일 수 있다
--   3. **미팅을 지워도 판정은 남는다** (on delete set null) — 자료는 미팅과 별개로 값어치가 있다
--   4. `feedback` 은 'helpful' | 'missed' 만 받는다
--   5. 오탐률 질의가 성립한다
--
-- 실행: psql -f database/tests/015_coaching_events.sql

\set ON_ERROR_STOP on

do $$
declare
  uid uuid;
  cid uuid;
  mid uuid;
  sess text := 'r-test-015';
  n int;
  still int;
begin
  insert into v2.users (email, name, password_hash, role, is_verified)
  values ('t-015@t.test', '검증', 'x', 'user', true)
  on conflict (email) do update set name = excluded.name
  returning id into uid;

  insert into v2.customers (user_id, company_name) values (uid, '검증고객')
  returning id into cid;
  insert into v2.meetings (user_id, customer_id, title, start_time, end_time)
  values (uid, cid, '015 검증', now(), now())
  returning id into mid;

  -- 1) 모델은 위험이라 했지만 화면에는 주의가 떴다 — 첫 번째라서 낮춘 경우
  insert into v2.coaching_events
    (user_id, session_id, at_ms, level, level_shown, danger_streak, reason, transcript)
  values
    (uid, sess,  25000, 'danger', 'caution', 1, '가격 저항', '너무 비싸네요'),
    (uid, sess,  50000, 'danger', 'danger',  2, '이탈 위협', '다른 곳 보겠습니다'),
    (uid, sess,  75000, 'normal', 'normal',  0, '', '네 알겠습니다'),
    (uid, sess, 100000, 'opportunity', 'opportunity', 0, '구매 신호', '언제 시작 가능한가요');

  select count(*) into n from v2.coaching_events
   where user_id = uid and level = 'danger' and level_shown = 'caution';
  if n <> 1 then raise exception '015: 완충된 행(danger→caution)이 1개여야 하는데 %개다', n; end if;

  -- 2) session_id 로 먼저 쌓고 나중에 붙인다
  select count(*) into n from v2.coaching_events where session_id = sess and meeting_id is null;
  if n <> 4 then raise exception '015: 미첨부 행이 4개여야 하는데 %개다', n; end if;

  update v2.coaching_events set meeting_id = mid where session_id = sess and meeting_id is null;
  select count(*) into n from v2.coaching_events where meeting_id = mid;
  if n <> 4 then raise exception '015: 붙은 행이 4개여야 하는데 %개다', n; end if;

  -- 3) 피드백은 두 값만
  update v2.coaching_events set feedback = 'helpful', feedback_at = now()
   where meeting_id = mid and level_shown = 'danger';
  begin
    update v2.coaching_events set feedback = 'maybe' where meeting_id = mid and level_shown = 'normal';
    raise exception '015: feedback 이 임의 값을 받았다 — check 제약이 없다';
  exception when check_violation then null;   -- 기대한 결과다
  end;

  -- 4) 오탐률 질의 — 이것이 되려면 위 컬럼들이 다 있어야 한다
  select count(*) into n from v2.coaching_events
   where user_id = uid and level_shown <> 'normal' and feedback = 'missed';
  if n <> 0 then raise exception '015: 빗나감이 0이어야 하는데 %개다', n; end if;

  -- 5) **미팅을 지워도 판정은 남는다**
  delete from v2.meetings where id = mid;
  select count(*) into still from v2.coaching_events where session_id = sess;
  if still <> 4 then raise exception '015: 미팅 삭제 후 판정이 4개 남아야 하는데 %개다', still; end if;
  select count(*) into n from v2.coaching_events where session_id = sess and meeting_id is null;
  if n <> 4 then raise exception '015: 연결만 끊겨야 하는데 %개만 끊겼다', n; end if;

  -- 뒷정리
  delete from v2.coaching_events where user_id = uid;
  delete from v2.customers where user_id = uid;
  delete from v2.users where id = uid;

  raise notice '015 통과 — level/level_shown 분리 · session 선적재 · 미팅 삭제 후 잔존 · feedback 제약';
end $$;
