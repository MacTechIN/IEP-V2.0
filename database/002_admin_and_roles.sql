-- ===================================================================
-- 002: 관리자 계정 시드 + 역할 일반화(사용자)
-- ===================================================================
-- 관리자 계정.
--
-- **비밀번호가 없다.** 아래 해시는 아무도 모르는 난수를 해시한 값이라 어떤 입력으로도 통과하지 못한다.
-- 예전에는 여기에 `admin1234` 해시가 박혀 있었고 "운영 배포 시 반드시 변경" 이라는 주석이 붙어 있었는데,
-- 2026-08-10 확인해 보니 **변경되지 않은 채 공개 인터넷에서 관리자로 로그인됐다.**
-- 지켜지지 않는 주석 대신, 애초에 쓸 수 있는 비밀번호를 두지 않는다.
--
-- 쓰려면 배포 후 비밀번호를 직접 설정해야 한다 (관리자가 계정을 만들거나 재설정 경로를 쓴다).
INSERT INTO v2.users (email, name, password_hash, role, is_verified)
VALUES (
  'admin@company.com',
  '관리자',
  '$2b$10$KbtsEd3yeegmY3zGb8mtduZfGAdBYaZzbUEM7PeQ/DMS8t.mYsLzu',
  'admin',
  true
) ON CONFLICT (email) DO NOTHING;

-- 기존 시드 사용자 역할을 일반 'user' 로 정규화 (영업사원 → 사용자)
UPDATE v2.users SET role = 'user' WHERE role = 'sales_rep';

COMMIT;
