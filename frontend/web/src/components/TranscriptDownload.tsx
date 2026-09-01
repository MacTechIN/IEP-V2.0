// 화자별 대화 내려받기 버튼 (2026-08-18)
//
// **글자 버튼이 아니라 아이콘 하나다.** `MeetingDetailPage` 의 이 자리는 좌우 분할에서 칸이
// 절반이 되는 곳이고, 예전에 제목·요약·버튼을 한 줄에 몰아넣었다가 제목이 "화자별 / 대화" 로
// 접힌 적이 있다(그 파일의 주석 참고). 형식 선택은 메뉴로 펴서 폭을 40px 만 쓴다.
//
// **접힌 상태에서도 눌러야 한다.** 그래서 `Collapse` 안(검색·필터 줄)이 아니라 머리글 줄에 둔다 —
// 내려받으려고 먼저 펼치게 만들 이유가 없다.

import { useState, type ReactNode } from 'react';
import {
  Alert, CircularProgress, IconButton, ListItemIcon, ListItemText,
  Menu, MenuItem, Snackbar, Tooltip,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import DescriptionIcon from '@mui/icons-material/Description';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import {
  buildTranscriptDoc, buildDocx, printDoc, safeFileName, saveBlob, toPlainText, toPrintHtml,
  DOCX_MIME, TEXT_MIME,
  type ExportMeeting, type ExportSegment,
} from '../lib/transcriptExport';

type Format = 'txt' | 'docx' | 'pdf';

interface Props {
  meeting: ExportMeeting;
  /**
   * **원본 녹취 전체를 넘긴다.** 화면에 걸린 화자 필터·검색·"짧은 발화 접기" 결과를
   * 넘기면 안 된다 — 받은 파일이 화면 상태에 따라 달라지면 나중에 그 파일만 봤을 때
   * 전부인지 일부인지 알 수 없다.
   */
  segments: ExportSegment[];
}

const ITEMS: { fmt: Format; icon: ReactNode; label: string; hint: string }[] = [
  { fmt: 'txt', icon: <TextSnippetIcon fontSize="small" />, label: '텍스트', hint: '.txt' },
  { fmt: 'docx', icon: <DescriptionIcon fontSize="small" />, label: '워드', hint: '.docx' },
  // 인쇄창이 뜬다는 것을 **누르기 전에** 알려 준다. 저장 대화상자를 기대한 사람에게
  // 인쇄 미리보기가 뜨면 잘못 눌렀다고 생각하고 닫는다.
  { fmt: 'pdf', icon: <PictureAsPdfIcon fontSize="small" />, label: 'PDF', hint: '인쇄' },
];

export default function TranscriptDownload({ meeting, segments }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState('');

  if (!segments.length) return null;

  const run = async (fmt: Format) => {
    setAnchor(null);
    if (busy) return;
    setBusy(fmt);
    setError('');
    try {
      const doc = buildTranscriptDoc(meeting, segments);
      if (fmt === 'txt') {
        saveBlob(
          new Blob([toPlainText(doc)], { type: TEXT_MIME }),
          safeFileName(doc.title, doc.dateKey, 'txt'),
        );
      } else if (fmt === 'docx') {
        const blob = await buildDocx(doc);
        saveBlob(
          new Blob([blob], { type: DOCX_MIME }),
          safeFileName(doc.title, doc.dateKey, 'docx'),
        );
      } else {
        printDoc(toPrintHtml(doc));
      }
    } catch (e) {
      console.error('화자별 대화 내려받기 실패', e);
      setError(fmt === 'docx'
        ? '워드 파일을 만들지 못했습니다. 텍스트로 받아 보세요.'
        : '파일을 만들지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setBusy(null);
    }
  };

  return (
    // **여기서 클릭을 멈춘다.** 이 컴포넌트가 놓이는 자리는 통째로 접기/펼치기 클릭 영역이라,
    // 막지 않으면 내려받기를 누를 때마다 녹취가 접힌다.
    // 메뉴는 포털로 그려지지만 리액트 이벤트는 **리액트 트리**를 타고 올라오므로,
    // 메뉴 항목의 클릭도 여기서 함께 막힌다.
    <span onClick={(e) => e.stopPropagation()}>
      <Tooltip title="화자별 대화 전체 내려받기">
        <span>
          <IconButton
            size="small"
            disabled={!!busy}
            aria-label="화자별 대화 내려받기"
            onClick={(e) => setAnchor(e.currentTarget)}
            sx={{ flexShrink: 0 }}
          >
            {busy ? <CircularProgress size={18} /> : <DownloadIcon fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>

      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {ITEMS.map((it) => (
          <MenuItem key={it.fmt} disabled={!!busy} onClick={() => run(it.fmt)}>
            <ListItemIcon>{it.icon}</ListItemIcon>
            <ListItemText primary={it.label} secondary={it.hint} />
          </MenuItem>
        ))}
      </Menu>

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError('')}>{error}</Alert>
      </Snackbar>
    </span>
  );
}
