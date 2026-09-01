-- 본인 목소리 등록 (v1 0027 과 같은 설계)
--
-- **본인 한 명만 등록한다.** v1 은 처음에 미팅마다 참석자 전원을 등록했다가 두 가지로 실패했다.
--   1) 고객 성문은 생체인식 정보(민감정보)다. 보관하면 동의·보존·삭제 책임이 생긴다.
--   2) 전원 등록이 아니면 미등록자 발화가 "미상" 이 아니라 **등록된 다른 사람 이름**으로 배정된다.
--      고객이 한 말이 영업사원 이름으로 붙는다 (v1 스파이크 실측).
--
-- 본인만 등록하면 둘 다 사라진다. 분석은 "나" 만 실명으로 찾고 나머지는 화자 A·B·C 로 남긴다.
ALTER TABLE v2.users
  ADD COLUMN IF NOT EXISTS voice_ref JSONB;

COMMENT ON COLUMN v2.users.voice_ref IS
  '본인 목소리 등록 클립 {storage_path, duration_ms, mime, enrolled_at}. '
  'STT 의 known_speaker_references 로 전달되어 본인 발화에만 실명이 붙는다. '
  '성문은 민감정보이므로 본인만 등록·삭제할 수 있다.';
