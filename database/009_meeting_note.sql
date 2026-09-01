-- 리뷰용 미팅 노트 (클로바노트/다글로 형식)
--
-- 기존 `summary` 는 2~4문장 한 덩어리라 나중에 "가격 얘기 어디서 했지" 를 찾을 수 없다.
-- 주제별로 쪼갠 구조를 별도 필드로 둔다 — **`summary` 는 그대로 둔다.**
-- 목록·대시보드가 그걸 쓰고 있고, 새 구조가 실패해도 화면이 비지 않아야 한다.
--
-- {한줄, 주제[{제목, 요점[]}], 결정[], 미결[], 다음[], 언급[{종류, 값}]}
ALTER TABLE v2.analysis_results
  ADD COLUMN IF NOT EXISTS meeting_note JSONB;

COMMENT ON COLUMN v2.analysis_results.meeting_note IS
  '리뷰용 구조화 노트 {headline, topics[{title,points[]}], decisions[], open_items[], next_steps[], mentions[]}. '
  'summary 와 별개다 — summary 는 목록용 한 덩어리, 이쪽은 나중에 찾아보는 용도.';
