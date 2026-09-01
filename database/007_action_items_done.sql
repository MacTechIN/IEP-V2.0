-- 액션 아이템 완료 체크
--
-- v1 에는 `reports.action_items_done` 이 있어 체크가 저장된다. v2 에는 목록만 있고
-- 체크할 곳이 없어서, 화면에서 눌러도 새로고침하면 사라진다.
--
-- 인덱스 배열로 둔다(원본 v1 과 같은 모양). 항목 텍스트가 아니라 순번이라,
-- 재분석으로 목록이 바뀌면 어긋날 수 있다 — 재분석 시 비운다.
ALTER TABLE v2.analysis_results
  ADD COLUMN IF NOT EXISTS action_items_done JSONB DEFAULT '[]'::jsonb;
