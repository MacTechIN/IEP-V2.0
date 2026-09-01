-- 023: 사용자 삭제
--
-- ── 왜 함수가 필요한가 ────────────────────────────────────────
--
-- `v2.users` 를 가리키는 외래키가 **열여섯 개**고, 삭제 규칙이 셋으로 갈린다.
-- 2026-08-26 에 세어 봤다:
--
--   CASCADE   matters · deadlines · coaching_events · element_templates
--   NO ACTION meetings · customers · meeting_recordings · sessions ·
--             notifications · user_scores · emails · learning_cases · action_items
--   SET NULL  access_log · deadlines.confirmed_by · transcript_segments.edited_by
--
-- **이 조합이 위험한 이유는 반쪽만 막기 때문이다.**
--
--   `delete from v2.users` 를 그냥 부르면 —
--     사건을 가진 사람은 **사건이 통째로 조용히 사라진다** (matters 가 CASCADE).
--     사건에 딸린 기한·요건·시계열·증거가 전부 같이 간다.
--     그런데 상담을 하나라도 가진 사람은 **외래키에 막혀 삭제가 실패한다.**
--
--   즉 **가장 값진 것(사건)이 아무 말 없이 지워지고, 덜 값진 것이 삭제를 막는다.**
--   "사용자를 지운다" 를 누른 사람이 기대하는 것은 그 반대다.
--
-- ── 그래서 DB 에서 막는다 ─────────────────────────────────────
--
-- 경로에도 검사를 두지만 **여기서도 막는다.** 경로는 새로 생기고 고쳐지지만
-- 이 함수는 한 곳이다. `psql` 로 직접 지우는 경우까지 여기서 걸린다.
--
-- 사건·상담·고객·녹음을 **하나라도** 가진 사람은 지워지지 않는다.
-- 예외를 던지고 무엇이 막았는지 말한다. 옮기든 파기하든 **사람이 먼저 정해야 한다**
-- (`CLAUDE.md` — 자동으로 지우는 청소기를 만들지 않는다).
--
-- ── 무엇이 함께 지워지는가 ───────────────────────────────────
--
-- 그 사람 것이면서 **그 사람 밖에서는 뜻이 없는 것들**만 지운다 —
-- 세션·알림·점수·학습기록·코칭판정·요건템플릿·로그인 실패 카운터.
--
-- `access_log` 는 **지우지 않는다.** `SET NULL` 로 남는다 —
-- 누가 무엇을 열었는지는 그 사람이 없어져도 남아야 한다 (`021`·`022` 와 같은 원칙).
--
-- **되돌리기**
--   drop function v2.delete_user(uuid);
--   drop function v2.user_delete_preview(uuid);

/**
 * 지우면 무슨 일이 벌어지는지 **미리** 보여 준다. 아무것도 지우지 않는다.
 *
 * `blockers` 가 비어 있지 않으면 `delete_user()` 는 실패한다.
 */
create or replace function v2.user_delete_preview(p_user uuid)
returns jsonb language plpgsql stable as $$
declare
  v_email text;
  v_blockers jsonb;
  v_removed  jsonb;
begin
  select email into v_email from v2.users where id = p_user;
  if v_email is null then
    return jsonb_build_object('found', false);
  end if;

  -- 삭제를 막는 것 — 사람이 먼저 정해야 하는 것들
  select jsonb_strip_nulls(jsonb_build_object(
    'matters',    nullif((select count(*) from v2.matters            where user_id = p_user), 0),
    'meetings',   nullif((select count(*) from v2.meetings           where user_id = p_user), 0),
    'customers',  nullif((select count(*) from v2.customers          where user_id = p_user), 0),
    'recordings', nullif((select count(*) from v2.meeting_recordings where user_id = p_user), 0),
    'emails',     nullif((select count(*) from v2.emails             where user_id = p_user), 0)
  )) into v_blockers;

  -- 함께 지워지는 것 — 그 사람 밖에서는 뜻이 없는 것들
  select jsonb_build_object(
    'sessions',          (select count(*) from v2.sessions          where user_id = p_user),
    'notifications',     (select count(*) from v2.notifications     where user_id = p_user),
    'user_scores',       (select count(*) from v2.user_scores       where user_id = p_user),
    'learning_cases',    (select count(*) from v2.learning_cases    where user_id = p_user),
    'coaching_events',   (select count(*) from v2.coaching_events   where user_id = p_user),
    'element_templates', (select count(*) from v2.element_templates where user_id = p_user)
  ) into v_removed;

  return jsonb_build_object(
    'found',    true,
    'email',    v_email,
    'blockers', coalesce(v_blockers, '{}'::jsonb),
    'removed',  v_removed,
    'kept',     jsonb_build_object(
      'access_log', (select count(*) from v2.access_log where user_id = p_user)),
    'note', 'access_log 는 남는다 — 누가 무엇을 열었는지는 그 사람이 없어져도 남아야 한다'
  );
end $$;

comment on function v2.user_delete_preview(uuid) is
  '사용자를 지우면 무슨 일이 벌어지는지 미리 본다 (023). 아무것도 지우지 않는다.';

/**
 * 사용자 하나를 **진짜로** 지운다.
 *
 * 사건·상담·고객·녹음·메일을 하나라도 가지고 있으면 **예외를 던지고 아무것도 하지 않는다.**
 * 그 데이터를 어떻게 할지는 사람이 정할 일이다.
 *
 * 자동으로 불리지 않는다. 예약도 트리거도 걸지 않았다.
 */
create or replace function v2.delete_user(p_user uuid)
returns jsonb language plpgsql as $$
declare
  v_email text;
  v_prev  jsonb;
  v_block jsonb;
begin
  select email into v_email from v2.users where id = p_user;
  if v_email is null then
    raise exception '사용자를 찾을 수 없습니다: %', p_user using errcode = 'no_data_found';
  end if;

  v_prev  := v2.user_delete_preview(p_user);
  v_block := v_prev -> 'blockers';

  -- **막는 것이 있으면 아무것도 하지 않는다.** 반쪽만 지워진 사용자가 제일 나쁘다.
  if v_block <> '{}'::jsonb then
    raise exception '이 사용자는 지울 수 없습니다 (%): 남아 있는 것 %',
      v_email, v_block::text
      using errcode = 'foreign_key_violation';
  end if;

  delete from v2.sessions          where user_id = p_user;
  delete from v2.notifications     where user_id = p_user;
  delete from v2.user_scores       where user_id = p_user;
  delete from v2.learning_cases    where user_id = p_user;
  delete from v2.coaching_events   where user_id = p_user;
  delete from v2.element_templates where user_id = p_user;
  -- 로그인 실패 카운터는 이메일로 걸려 있다 (`013` — `e:<email>`)
  delete from v2.login_throttle    where key = 'e:' || lower(v_email);

  -- deadlines 는 CASCADE 지만 여기까지 왔다면 사건이 없으므로 기한도 없다.
  delete from v2.users where id = p_user;

  return jsonb_build_object(
    'deleted', true,
    'user_id', p_user,
    'email',   v_email,
    'removed', v_prev -> 'removed',
    'kept',    v_prev -> 'kept',
    'note',    'access_log 는 남겼다 — user_id 만 null 이 된다'
  );
end $$;

comment on function v2.delete_user(uuid) is
  '사용자 하나를 진짜로 지운다 (023). 사건·상담·고객·녹음·메일이 있으면 예외를 던지고 아무것도 하지 않는다.';
