// 녹취 한 줄 — 읽기 · 수정 · 복사 · 형광펜 (011)
//
// **한 줄만 다시 그린다.** 300줄짜리 녹취에서 한 글자 고칠 때마다 전체를 다시 그리면
// 커서가 튀고 스크롤이 흔들린다. 그래서 상태를 이 컴포넌트 안에 두고,
// 저장이 끝났을 때만 부모에게 알린다.
//
// 층을 나눈다 — **수정은 줄 전체(왼쪽 테두리), 형광펜은 글자 범위(배경색).**
// 둘 다 밑줄이나 배경으로 표시하면 무엇이 무엇인지 구분이 안 된다.

import { useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, IconButton, TextField, Tooltip, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import UndoIcon from '@mui/icons-material/Undo';
import BorderColorIcon from '@mui/icons-material/BorderColor';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

export interface Highlight { start: number; end: number }
export interface Segment {
  id: string;
  speakerLabel?: string;
  content?: string;
  contentOriginal?: string | null;
  editedAt?: string | null;
  highlights?: Highlight[];
  /** 012 — 이 줄이 나온 녹음과 그 파일 안에서의 시각. 둘 다 있어야 재생 위치가 된다. */
  recordingId?: string | null;
  startMs?: number | null;
}

/**
 * 드래그 범위를 어절 경계까지 넓힌다.
 *
 * 글자 중간에서 끝난 선택을 그대로 칠하면 "안녕하세" 처럼 잘려 보인다.
 * 한국어는 조사가 붙어 띄어쓰기가 단어 경계와 정확히 맞지는 않지만,
 * **어절까지만 맞춰도 잘려 보이는 어색함은 사라진다.** 형태소 분석은 하지 않는다 —
 * 라이브러리가 무겁고, 조사를 떼면 오히려 드래그한 것보다 적게 잡혀 예상과 어긋난다.
 */
export function snapToWord(text: string, start: number, end: number): Highlight {
  const isBoundary = (ch: string) => !ch || /[\s.,!?·…"'()\[\]{}]/.test(ch);
  let s = Math.max(0, Math.min(start, text.length));
  let e = Math.max(0, Math.min(end, text.length));
  if (s > e) [s, e] = [e, s];
  while (s > 0 && !isBoundary(text[s - 1])) s--;
  while (e < text.length && !isBoundary(text[e])) e++;
  return { start: s, end: e };
}

/** 겹치거나 맞닿은 범위를 합친다. 안 하면 같은 곳을 여러 번 칠할 때 조각이 쌓인다. */
export function mergeHighlights(list: Highlight[]): Highlight[] {
  const sorted = [...list].filter((h) => h.end > h.start).sort((a, b) => a.start - b.start);
  const out: Highlight[] = [];
  for (const h of sorted) {
    const last = out[out.length - 1];
    if (last && h.start <= last.end) last.end = Math.max(last.end, h.end);
    else out.push({ ...h });
  }
  return out;
}

interface Props {
  seg: Segment;
  /** 수정 지점 순회용 번호. 고친 줄에만 붙는다. */
  editNo?: number;
  onSave: (id: string, content: string) => Promise<void>;
  onRevert: (id: string) => Promise<void>;
  onHighlight: (id: string, highlights: Highlight[]) => Promise<void>;
  /** 그 대목을 재생한다. **옛 데이터는 출처를 몰라 넘기지 않는다** — 추측해 틀면 엉뚱한 것을 튼다. */
  onPlay?: (recordingId: string, ms: number) => void;
}

export default function TranscriptLine({ seg, editNo, onSave, onRevert, onHighlight, onPlay }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(seg.content || '');
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [sel, setSel] = useState<Highlight | null>(null);
  const bodyRef = useRef<HTMLSpanElement | null>(null);

  // 변호사 쪽 말풍선. **옛 라벨(영업대표)도 계속 맞아야 한다** —
  // 화자 역할을 바꾸기 전에 분석된 녹취가 이미 저장돼 있다.
  const label = seg.speakerLabel || '';
  const isRep = label.includes('변호사') || label.includes('영업');
  const edited = !!seg.editedAt;
  const text = seg.content || '';
  const marks = useMemo(() => mergeHighlights(seg.highlights || []), [seg.highlights]);

  /** 형광펜이 칠해진 곳을 나눠 그린다 */
  const parts = useMemo(() => {
    if (!marks.length) return [{ text, on: false }];
    const out: { text: string; on: boolean }[] = [];
    let i = 0;
    for (const m of marks) {
      if (m.start > i) out.push({ text: text.slice(i, m.start), on: false });
      out.push({ text: text.slice(m.start, m.end), on: true });
      i = m.end;
    }
    if (i < text.length) out.push({ text: text.slice(i), on: false });
    return out;
  }, [text, marks]);

  const save = async () => {
    const next = draft.trim();
    if (!next || next === text) { setEditing(false); setDraft(text); return; }
    setBusy(true);
    try { await onSave(seg.id, next); setEditing(false); } finally { setBusy(false); }
  };

  /**
   * 이 줄 안에서 선택이 끝났을 때. 어절로 넓힌 범위를 기억해 둔다.
   *
   * **마우스와 터치를 모두 받는다.** 모바일에서는 `mouseup` 이 오지 않거나 늦게 와서,
   * 손가락으로 글자를 짚어도 형광펜 버튼이 뜨지 않는다.
   */
  const readSelection = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !bodyRef.current) { setSel(null); return; }
    if (!bodyRef.current.contains(s.anchorNode) || !bodyRef.current.contains(s.focusNode)) return;
    // 이 줄의 시작부터 선택 시작까지의 글자 수 = 오프셋
    const range = s.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(bodyRef.current);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    setSel(snapToWord(text, start, start + range.toString().length));
  };

  const paint = async () => {
    if (!sel) return;
    setBusy(true);
    try { await onHighlight(seg.id, mergeHighlights([...marks, sel])); }
    finally { setBusy(false); setSel(null); window.getSelection()?.removeAllRanges(); }
  };
  const erase = async () => {
    setBusy(true);
    try { await onHighlight(seg.id, []); } finally { setBusy(false); }
  };

  return (
    <Box
      id={`seg-${seg.id}`}
      onMouseEnter={() => setHover(true)}
      // 터치 기기에는 mouseleave 가 없다. 선택은 다음 선택이나 형광펜 적용으로 정리된다.
      onMouseLeave={() => { setHover(false); setSel(null); }}
      sx={{
        display: 'flex', gap: 1.5, alignItems: 'flex-start',
        // 수정된 줄임을 **왼쪽 테두리**로 — 형광펜(배경색)과 층이 겹치지 않는다
        borderLeft: edited ? '3px solid' : '3px solid transparent',
        borderLeftColor: edited ? 'warning.main' : 'transparent',
        bgcolor: edited ? 'action.hover' : 'transparent',
        pl: 1, py: 0.5, borderRadius: 0.5,
      }}
    >
      <Chip
        size="small" label={seg.speakerLabel}
        color={isRep ? 'primary' : 'default'}
        sx={{ minWidth: 84, flexShrink: 0 }}
      />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <Box>
            <TextField
              value={draft} onChange={(e) => setDraft(e.target.value)}
              size="small" fullWidth multiline autoFocus disabled={busy}
              // **onBlur 로 저장하지 않는다.** 저장 버튼을 누르면 blur 가 먼저 일어나
              // 두 번 저장되고, 모바일에서는 키보드가 닫히거나 스크롤만 해도 blur 가 난다.
              // 저장도 취소도 사용자가 명시적으로 누른다 — 실수로 저장되지도, 잃지도 않는다.
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setEditing(false); setDraft(text); }
                // 있으면 편한 단축키일 뿐이다. 이것만으로 저장할 수 있어서는 안 된다.
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
              }}
            />
            {/* 버튼은 **항상 보인다.** 모바일 키보드에는 Ctrl 도 Esc 도 없다. */}
            <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
              <Button size="small" variant="contained" onClick={save} disabled={busy}>
                {busy ? '저장 중…' : '저장'}
              </Button>
              <Button
                size="small" disabled={busy}
                onClick={() => { setEditing(false); setDraft(text); }}
              >
                취소
              </Button>
              {/* 키보드가 있는 기기에서만 안내한다. 모바일에는 Ctrl 도 Esc 도 없어
                  적어 두면 "안 되는 방법" 을 알려주는 셈이 된다. */}
              <Typography
                variant="caption" color="text.secondary"
                sx={{ display: 'none', '@media (hover: hover)': { display: 'block' } }}
              >
                Ctrl+Enter 저장 · Esc 취소
              </Typography>
            </Box>
          </Box>
        ) : (
          <Typography
            variant="body2" component="div" ref={bodyRef as any}
            onMouseUp={readSelection}
            // 터치 기기용. 선택 핸들을 놓은 뒤 브라우저가 범위를 확정할 틈을 준다 —
            // 곧바로 읽으면 빈 선택이 잡힌다.
            onTouchEnd={() => setTimeout(readSelection, 120)}
            onDoubleClick={() => { setDraft(text); setEditing(true); }}
            sx={{ cursor: 'text', wordBreak: 'break-word' }}
          >
            {editNo != null && (
              <Box component="sup" sx={{ color: 'warning.dark', fontWeight: 700, mr: 0.5 }}>
                {editNo}
              </Box>
            )}
            {parts.map((p, i) => (
              <Box
                key={i} component="span"
                sx={p.on ? { bgcolor: 'rgba(255, 235, 59, 0.45)', borderRadius: '2px' } : undefined}
              >
                {p.text}
              </Box>
            ))}
          </Typography>
        )}
      </Box>

      {/* 도구.
          마우스가 있는 기기에서는 올렸을 때만 보인다 — 300줄이 아이콘으로 뒤덮이면 읽기 어렵다.
          **터치 기기에서는 항상 보인다.** hover 가 없으므로 숨기면 영영 닿을 수 없다 —
          `@media (hover: hover)` 는 화면 크기가 아니라 **가리키는 장치가 있는지**를 묻는다.
          폭으로 나누면 마우스 달린 좁은 창이나 터치 노트북에서 어긋난다. */}
      {!editing && (
        <Box
          sx={{
            display: 'flex', gap: 0.25, flexShrink: 0, transition: 'opacity .15s',
            opacity: 1,
            // 터치 목표는 최소 40px 이어야 손가락으로 누를 수 있다.
            // 마우스가 있으면 작게 — 300줄에 큰 버튼이 붙으면 녹취가 안 읽힌다.
            '& .MuiIconButton-root': { p: 1 },
            '@media (hover: hover)': {
              opacity: hover || sel ? 1 : 0,
              '& .MuiIconButton-root': { p: 0.5 },
            },
          }}
        >
          {sel && (
            <Tooltip title="형광펜">
              <IconButton size="small" onClick={paint} disabled={busy}>
                <BorderColorIcon sx={{ fontSize: 16, color: 'warning.dark' }} />
              </IconButton>
            </Tooltip>
          )}
          {!sel && marks.length > 0 && (
            <Tooltip title="형광펜 지우기">
              <IconButton size="small" onClick={erase} disabled={busy}>
                <BorderColorIcon sx={{ fontSize: 16, opacity: 0.4 }} />
              </IconButton>
            </Tooltip>
          )}
          {/* 재생 (012). **줄 본문이 아니라 여기 붙인다** —
              본문은 이미 더블클릭(수정)과 드래그(형광펜)가 쓰고 있다.
              `recordingId` 가 없는 옛 데이터는 버튼 자체가 없다. */}
          {onPlay && seg.recordingId && seg.startMs != null && (
            <Tooltip title="이 대목 듣기">
              <IconButton size="small" onClick={() => onPlay(seg.recordingId!, seg.startMs!)}>
                <PlayArrowIcon sx={{ fontSize: 18, color: 'primary.main' }} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="복사">
            <IconButton size="small" onClick={() => navigator.clipboard?.writeText(text)}>
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="수정">
            <IconButton size="small" onClick={() => { setDraft(text); setEditing(true); }}>
              <EditIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          {edited && (
            <Tooltip title={`원문: ${seg.contentOriginal || ''}`}>
              <IconButton size="small" onClick={() => onRevert(seg.id)} disabled={busy}>
                <UndoIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )}
    </Box>
  );
}
