-- 032: IEP — 대상자 역할
--
-- 조사에 참여한 대상자를 역할로 구분한다 (개발계획 §6-A·§6-D).
-- **호칭이 IEP 의 핵심**이라, 역할은 사람이 확정할 수 있어야 한다.
--
-- 화자(transcript_segments.speaker_label)는 「수사관/대상자」 2분류이고,
-- 이 표는 그 대상자가 **피의자인지 참고인인지 피해자인지 목격자인지**를 담는다.
-- 한 조사에 대상자가 여럿일 수 있으므로(피의자+참고인) 미팅당 여러 행.

begin;

create table if not exists v2.subject_parties (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references v2.meetings(id) on delete cascade,
  -- 역할. §6-A 의 대상자 넷 + 동석자(신뢰관계인·변호인 등).
  role text not null check (role in ('suspect', 'witness', 'victim', 'bystander', 'attendee')),
  -- 화면에 나오는 이름. **사람이 넣은 것만** 쓴다 — AI 는 실명을 추정하지 않는다.
  display_name text,
  -- 이 대상자가 붙은 화자 라벨(있으면). 사람이 지정한다.
  speaker_label text,
  -- 고지·동의 기록 (§6-C). 역할마다 고지 문구가 다르다.
  notified_at timestamptz,        -- 권리 고지 시각
  consented_at timestamptz,       -- 녹음 동의 시각
  note text,
  created_by uuid references v2.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subject_parties_meeting on v2.subject_parties (meeting_id);

comment on table v2.subject_parties is
  'IEP 대상자 역할: 피의자·참고인·피해자·목격자·동석자. 호칭은 사람이 확정한다 (032)';

commit;
