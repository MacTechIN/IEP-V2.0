-- 035 — 이미지 증적·참조 자료 (S7).
--
-- 조사 중 수사관이 붙인 이미지. **입력 이유가 필수** — 목적 없는 이미지는 증적이 아니다 (§0-3).
-- 원본은 R2 에 불변으로 두고, 입력 시 SHA-256 을 박아 위변조를 검증한다 (§0-4).
-- Vision 사실 설명은 원본과 **별도**로 담는다 — 분석이 원본을 덮지 않는다.
create table if not exists v2.meeting_images (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references v2.meetings(id) on delete cascade,
  r2_key        text not null,                 -- R2 원본 경로 (불변)
  sha256        text not null,                 -- 입력 시 해시 — 위변조 검증
  mime          text not null,
  bytes         integer not null,
  -- **입력 이유 — 필수.** 빈 문자열도 거부한다.
  reason        text not null,
  -- 특정 확인점(진술 finding)에 연결 (선택).
  linked_finding_id uuid references v2.findings(id) on delete set null,
  -- Vision 사실 설명 (분석 후 채워짐): {summary, ocr_text, objects[], caution}
  description   jsonb,
  analyzed_at   timestamptz,
  captured_by   uuid not null references v2.users(id),
  captured_at   timestamptz not null default now(),  -- 촬영/업로드 시각(증적 시간)
  created_at    timestamptz not null default now(),
  constraint meeting_images_reason_required check (length(btrim(reason)) > 0)
);
create index if not exists meeting_images_meeting_idx on v2.meeting_images(meeting_id, created_at);
