-- 027: 무엇이 적용됐는지 DB 가 알게 한다
--
-- ── 무엇이 없었나 ────────────────────────────────────────────
--
-- 2026-08-26 베타 전 점검에서 나왔다. `db-migrate.js` 는 파일을 적용만 하고
-- **기록을 남기지 않았다.** 그래서 이런 질문에 답할 수가 없었다 —
--
--   · `023` 이 적용됐나?           → 표가 있는지 눈으로 본다
--   · 같은 파일을 두 번 돌렸나?     → 알 수 없다
--   · 하나를 건너뛰었나?           → 알 수 없다
--   · 적용한 뒤에 파일이 바뀌었나?  → **알 수 없다. 이게 가장 위험하다**
--
-- 마지막 것이 위험한 이유: 파일을 고치고 다시 돌리면 `if not exists` 때문에
-- 조용히 아무것도 안 하고 성공한다. **DB 는 옛 모양인데 저장소는 새 모양**이 되고,
-- 다음 사람은 파일을 보고 DB 가 그렇게 생겼다고 믿는다.
--
-- `CLAUDE.md` 는 "코드 태그로는 DB 가 되돌아가지 않는다" 고 적어 두었다.
-- **그 원칙은 무엇이 적용됐는지 아는 것에서 시작한다.**
--
-- ── 001–026 은 어떻게 채우나 ─────────────────────────────────
--
-- 이미 적용돼 있지만 **언제 누가 돌렸는지는 남아 있지 않다.**
-- 그것을 지어내지 않는다 — `applied_at` 을 이 마이그레이션 시각으로 두고
-- `note` 에 **추정으로 채운 것**임을 적는다. 체크섬도 비워 둔다:
-- 지금 파일의 체크섬을 넣으면 "적용 당시와 같다" 는 거짓말이 된다.
--
-- **되돌리기**
--   drop table v2.schema_migrations;

create table if not exists v2.schema_migrations (
  name        text primary key,
  -- 적용한 파일 내용의 sha256. **null 이면 「모른다」** 는 뜻이다 (아래 소급분).
  checksum    text,
  applied_at  timestamptz not null default now(),
  applied_by  text,
  -- 몇 초 걸렸나. 느려지는 마이그레이션을 찾는 데 쓴다.
  duration_ms integer,
  note        text
);

comment on table v2.schema_migrations is
  '적용된 마이그레이션 (027). db-migrate.js 가 적용과 같은 트랜잭션에서 쓴다 — 둘이 어긋날 수 없다.';
comment on column v2.schema_migrations.checksum is
  '적용한 파일의 sha256. **null 은 「모른다」** — 027 이전에 적용된 것들이 그렇다. 값이 있는데 파일과 다르면 적용 후 파일이 바뀐 것이다.';

-- ── 001–026 소급 등록 ──
-- 이 파일들이 적용돼 있다는 것은 스키마로 확인했다 (v2 표 27개·함수 9개, 2026-08-26).
-- 다만 **언제 돌렸는지는 모른다.** 그래서 checksum 을 비우고 note 에 적어 둔다.
insert into v2.schema_migrations (name, checksum, applied_by, note)
select x, null, 'backfill-027',
       '027 이전에 적용됨. 실제 적용 시각·체크섬은 기록이 없어 모른다 (2026-08-26 스키마 대조로 확인).'
  from unnest(array[
    '001','002','003','004','005','006','007','008','009','010',
    '011','012','013','014','015','016','017','018',
    '021','022','023','024','025','026'
  ]) as x
on conflict (name) do nothing;

-- 019·020 은 없다. **빠뜨린 것이 아니라 018 에 합쳐졌다** — 그 사실을 여기 남긴다.
-- 안 남기면 다음 사람이 "빠진 마이그레이션" 을 찾느라 시간을 쓴다.
insert into v2.schema_migrations (name, checksum, applied_by, note)
values
  ('019', null, 'backfill-027', '파일 없음 — findings 표는 018 에 합쳐졌다 (설계 문서 §3.2).'),
  ('020', null, 'backfill-027', '파일 없음 — timeline_events·evidence 는 018 에 합쳐졌다 (설계 문서 §3.3).')
on conflict (name) do nothing;
