import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Paper,
  Typography,
  Stack,
  Button,
  Chip,
  Grid,
  LinearProgress,
  Card,
  CardContent,
  Divider,
  Collapse,
  TextField,
  Tabs,
  Tab,
  Checkbox,
  Alert,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { apiClient } from '../services/api';
import TranscriptLine, { type Highlight } from '../components/TranscriptLine';
import TranscriptDownload from '../components/TranscriptDownload';
import DocumentBuilder from '../components/DocumentBuilder';
import AudioPlayer, { type AudioPlayerHandle, type Recording } from '../components/AudioPlayer';
import type { Meeting, AnalysisResult } from '../types';

/**
 * 키워드 종류별 색.
 *
 * 종류를 글자로 적으면(`사람 · 김규종`) 칩이 길어져 한 줄에 서너 개밖에 안 들어간다.
 * 색으로 나누면 값만 적어도 무엇인지 알 수 있고, 열 개가 넘어도 한눈에 읽힌다.
 */
const MENTION_COLORS: Record<string, { bg: string; fg: string }> = {
  사람: { bg: '#EFF6FF', fg: '#1E40AF' },
  회사: { bg: '#F5F3FF', fg: '#5B21B6' },
  일정: { bg: '#ECFDF5', fg: '#065F46' },
  금액: { bg: '#FEF2F2', fg: '#991B1B' },
  기타: { bg: '#F8FAFC', fg: '#475569' },
};

/** 스코어카드 축 id → 화면 이름. 서버는 영어 id 로 준다. */
const AXIS_NAMES: Record<string, string> = {
  question_skill: '질문 역량',
  listening_balance: '경청 균형',
  closing_next_steps: '클로징·다음 단계',
  objection_handling: '이견 대응',
  value_articulation: '가치 전달',
};

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  // 대화 지표에서 자잘한 화자를 펼칠지 (2026-08-27)
  const [showAllSpeakers, setShowAllSpeakers] = useState(false);
  /** 내보낸 문서의 작성자 표시에 쓴다 (026). 실패해도 화면을 막지 않는다. */
  const [me, setMe] = useState<any | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [segments, setSegments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stalled, setStalled] = useState(false);
  // 녹취는 참고 자료다 — 기본은 접어 둔다
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptQuery, setTranscriptQuery] = useState('');
  // 미팅노트가 첫 탭이다 — 나중에 미팅을 되짚을 때 가장 먼저 보는 것이 정리된 노트이고,
  // 녹취는 그 근거를 확인할 때 옆에서 본다. 그래서 둘을 한 탭에 나란히 둔다.
  const [tab, setTab] = useState<'note' | 'report' | 'metrics' | 'legal'>('note');
  /**
   * 법률 분해 (018). **`kind === 'legal'` 일 때만 부른다** —
   * 일반 미팅에서 빈 탭을 띄우면 "왜 비어 있지" 를 매번 묻게 된다.
   */
  const [legal, setLegal] = useState<any | null>(null);
  const [doneSet, setDoneSet] = useState<Set<number>>(new Set());
  const [savingDone, setSavingDone] = useState(false);
  /** 비어 있으면 전체. 화자 이름을 담으면 그 화자만 본다. */
  const [speakerFilter, setSpeakerFilter] = useState<Set<string>>(new Set());
  const [showShort, setShowShort] = useState(false);
  // 녹취 수정 → 재요약 (011). 낡음 판정은 서버가 주는 두 시각으로 한다.
  const [renoting, setRenoting] = useState(false);
  const [renoteError, setRenoteError] = useState('');
  const [editCursor, setEditCursor] = useState(0);
  /**
   * 녹취를 스크롤하면 미팅노트가 그 대목으로 따라간다 (2차-d).
   *
   * **보조 기능이다.** 노트를 직접 스크롤하는 중에는 따라오지 않는다 —
   * 읽던 자리를 빼앗기는 것이 안 따라오는 것보다 나쁘다.
   */
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null);
  const noteBoxRef = useRef<HTMLDivElement | null>(null);
  const noteTouchedAt = useRef(0);
  const lastPart = useRef(-1);
  // 녹음 재생 (012). 전사가 맞는지 확인하려면 원본을 들어야 한다.
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const playerRef = useRef<AudioPlayerHandle | null>(null);

  /**
   * 분석이 끝날 때까지 다시 읽는다.
   *
   * **예전에는 한 번만 읽었다.** 업로드 화면이 분석 도중에 이 페이지로 넘겨주므로,
   * 사용자가 보는 것은 진입 순간의 상태에서 **영원히 얼어붙은 화면**이었다.
   * 2026-08-11 "95%에서 멈춤" 이 그것이다 — 서버는 이미 100%로 끝나 있었다.
   * 새로고침해야만 결과가 보였고, 사용자는 그걸 알 방법이 없었다.
   */
  // 사건에 붙이거나 떼면 상담을 다시 읽는다 (030) — matter_id 가 바뀌면
  // 서면 칸이 통째로 달라지는데, 그때 새로고침을 시키면 사용자는 붙은 줄 모른다.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;

    const load = async (): Promise<void> => {
      try {
        apiClient.getMe().then((r) => { if (r.success) setMe(r.data); }).catch(() => {});
        const meetingResponse = await apiClient.getMeetingById(id);
        if (!alive) return;
        if (meetingResponse.success && meetingResponse.data) {
          const m = meetingResponse.data as Meeting;
          setMeeting(m);

          const [analysisResponse, transcriptResponse, recordingsResponse, legalResponse] = await Promise.all([
            apiClient.getAnalysis(id).catch(() => null),
            apiClient.getTranscript(id).catch(() => null),
            apiClient.getMeetingRecordings(id).catch(() => null),
            // 법률 상담일 때만 부른다 — 일반 미팅에는 담긴 것이 없다.
            m.kind === 'legal' ? apiClient.getLegalAnalysis(id).catch(() => null) : Promise.resolve(null),
          ]);
          if (legalResponse?.success) setLegal(legalResponse.data);
          if (!alive) return;
          // 아직 분석 중이면 서버는 202 로 `{status, progress, message}` 만 준다.
          // 그것도 `success: true` 라서, 예전에는 그대로 결과로 넣었고 —
          // 리포트 렌더가 `analysis.customerNeeds.primary` 를 읽다 **흰 화면**이 됐다.
          // 결과의 모양을 갖췄을 때만 결과로 취급한다.
          const a = analysisResponse?.success ? (analysisResponse.data as AnalysisResult | null) : null;
          const isResult = !!a && ('summary' in a || 'customerNeeds' in a || 'scores' in a);
          setAnalysis(isResult ? a : null);
          if (isResult && Array.isArray(a?.actionItemsDone)) setDoneSet(new Set(a.actionItemsDone));
          if (transcriptResponse?.success && Array.isArray(transcriptResponse.data)) {
            setSegments(transcriptResponse.data);
          }
          if (recordingsResponse?.success && Array.isArray(recordingsResponse.data)) {
            setRecordings(recordingsResponse.data);
          }

          // 끝났거나 실패했으면 멈춘다. 그 외에는 계속 본다.
          // **한 번도 시작하지 않은 것도 멈춘다** — `pending` 인데 `analysisStartedAt` 이 없으면
          // 돌고 있는 게 아니라 아직 안 돌린 것이다. 그전에는 이 경우에도 3초마다 20분을
          // 두드리고 "끝나지 않았습니다" 를 띄웠다 (2026-08-20).
          const notStarted = m.analysisStatus === 'pending' && !m.analysisStartedAt;
          const settled = m.analysisStatus === 'completed' || m.analysisStatus === 'failed' || notStarted;
          if (!settled) {
            tries += 1;
            // 20분(3초 × 400)이 넘도록 안 끝나면 무언가 잘못된 것이다.
            // 조용히 계속 도는 대신 사용자에게 알린다 — 화면이 멈춘 것처럼 보이는 게 최악이다.
            if (tries >= 400) setStalled(true);
            else timer = setTimeout(load, 3000);
          }
        }
      } catch (error) {
        console.error('Failed to fetch meeting details:', error);
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [id, reload]);

  /**
   * 액션 아이템 체크. **낙관적으로 먼저 반영하고** 실패하면 되돌린다 —
   * 체크 하나에 왕복을 기다리게 하면 목록을 훑으며 누르는 흐름이 끊긴다.
   */
  const toggleActionItem = async (index: number) => {
    if (!id) return;
    const next = new Set(doneSet);
    if (next.has(index)) next.delete(index); else next.add(index);
    const before = doneSet;
    setDoneSet(next);
    setSavingDone(true);
    try {
      const res = await apiClient.setActionItemsDone(id, [...next]);
      if (res.success && Array.isArray(res.data?.actionItemsDone)) {
        setDoneSet(new Set(res.data.actionItemsDone));
      }
    } catch {
      setDoneSet(before);
    } finally {
      setSavingDone(false);
    }
  };

  // 화자별 발화 수. 역할 매핑이 두 명만 되고 나머지는 '화자 A' 로 남는 경우가 실제로 있어,
  // 목록을 고정하지 않고 데이터에 있는 대로 만든다.
  const speakerCounts = segments.reduce((acc: Record<string, number>, s: any) => {
    const k = s.speakerLabel || '알 수 없음';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const speakerNames = Object.keys(speakerCounts);

  const q = transcriptQuery.trim().toLowerCase();
  const bySpeaker = speakerFilter.size === 0
    ? segments
    : segments.filter((s: any) => speakerFilter.has(s.speakerLabel || '알 수 없음'));
  const byQuery = q
    ? bySpeaker.filter((s: any) =>
        (s.content || '').toLowerCase().includes(q) || (s.speakerLabel || '').toLowerCase().includes(q))
    : bySpeaker;
  // 실측: 40분 미팅 404개 중 10자 이하가 139개(34%)였고 전부 "뭐", "어!", "괜찮아" 같은 맞장구다.
  // 숨겨도 잃는 내용이 없고, 남는 265개는 실제로 읽을 만한 것들이다. 지우지 않고 접기만 한다.
  // 고친 줄의 순서 목록. 번호(①②③)와 "다음 수정 지점으로" 이동에 쓴다.
  const editedIds = segments.filter((s: any) => s.editedAt).map((s: any) => s.id);
  // 요약이 낡았는가 — 서버가 준 두 시각으로 판정한다. 판정 규칙은 DB 함수와 같다:
  // 고친 적이 있고, (요약을 만든 적이 없거나 || 수정이 더 나중이면) 낡았다.
  const noteStale = !!meeting?.transcriptEditedAt
    && (!meeting?.noteGeneratedAt
        || new Date(meeting.transcriptEditedAt) > new Date(meeting.noteGeneratedAt));

  /** 수정·되돌리기·형광펜은 전부 갱신된 녹취 전체를 돌려받는다 — 다시 읽지 않는다. */
  const applySegments = (res: any) => {
    if (res?.success && Array.isArray(res.data)) setSegments(res.data);
  };
  const saveSegment = async (segId: string, content: string) => {
    if (!id) return;
    applySegments(await apiClient.editSegment(id, segId, { content }));
    // 낡음 배너를 즉시 띄우기 위해 미팅 쪽 시각도 새로 읽는다
    const m = await apiClient.getMeetingById(id).catch(() => null);
    if (m?.success && m.data) setMeeting(m.data as Meeting);
  };
  const revertSegment = async (segId: string) => {
    if (!id) return;
    applySegments(await apiClient.revertSegment(id, segId).catch(() => null));
    const m = await apiClient.getMeetingById(id).catch(() => null);
    if (m?.success && m.data) setMeeting(m.data as Meeting);
  };
  const saveHighlights = async (segId: string, highlights: Highlight[]) => {
    if (!id) return;
    applySegments(await apiClient.editSegment(id, segId, { highlights }));
  };

  /**
   * 미팅노트와 AI요약만 다시 만든다.
   * **버튼을 눌러야 돈다** — 한 줄 고칠 때마다 자동으로 돌면 열 줄 고칠 때 열 번 부른다.
   */
  const runRenote = async () => {
    if (!id || renoting) return;
    setRenoting(true); setRenoteError('');
    try {
      const r = await apiClient.renote(id);
      if (r?.success) {
        const [a, m] = await Promise.all([
          apiClient.getAnalysis(id).catch(() => null),
          apiClient.getMeetingById(id).catch(() => null),
        ]);
        if (a?.success && a.data) setAnalysis(a.data as AnalysisResult);
        if (m?.success && m.data) setMeeting(m.data as Meeting);
      }
    } catch (e: any) {
      setRenoteError(e?.error?.message || '요약 갱신에 실패했습니다. 기존 요약은 그대로입니다.');
    } finally {
      setRenoting(false);
    }
  };

  /** ①→②→③ 순으로 수정 지점을 돌며 스크롤한다 */
  const gotoNextEdit = () => {
    if (!editedIds.length) return;
    const i = editCursor % editedIds.length;
    document.getElementById(`seg-${editedIds[i]}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setEditCursor(i + 1);
  };

  /**
   * 지금 녹취의 어느 지점을 보고 있는지 → 미팅노트의 어느 주제인지.
   *
   * **스크롤 비율이 아니라 '맨 위에 보이는 발화의 순번' 을 쓴다.**
   * 화자 필터나 검색으로 목록이 걸러지면 스크롤 비율은 전체 녹취의 위치와 무관해진다.
   * 발화 순번은 걸러도 그 발화가 원래 몇 번째였는지를 그대로 말해 준다.
   */
  const syncNoteToTranscript = () => {
    const box = transcriptBoxRef.current;
    const note = noteBoxRef.current;
    if (!box || !note) return;
    // 노트를 직접 만진 직후에는 비켜 준다 — 읽던 자리를 빼앗지 않는다
    if (Date.now() - noteTouchedAt.current < 2500) return;

    const noteRange = note.scrollHeight - note.clientHeight;
    const boxRange = box.scrollHeight - box.clientHeight;
    if (noteRange < 40 || boxRange < 40) return;   // 스크롤할 것이 없다

    /**
     * **비율로 맞춘다.** 처음에는 주제(topic)에 붙였는데 두 가지가 어긋났다.
     *
     *  1. 주제가 넷뿐인데 발화는 297개다. 스크롤을 한참 내려도 같은 주제라
     *     아무 일도 안 일어나다가, 경계를 넘는 순간 확 튄다.
     *  2. 노트에는 주제 아래로 **결정된 것 · 미결 · 다음 일정 · 키워드**가 더 있다.
     *     주제에만 붙이면 녹취를 끝까지 내려도 그 아래는 영영 안 보인다.
     *
     * 정확한 대응이 목적이 아니다 — "지금 읽는 대목이 노트의 대략 어디쯤인지" 면 된다.
     * 비율은 늘 정의되고, 부드럽고, 노트 전체를 덮는다.
     */
    let frac = box.scrollTop / boxRange;

    /**
     * `part` 가 있으면 그것으로 **보정한다**(대체가 아니다).
     * 구간 경계에서는 그 구간의 첫 주제에 맞추고, 구간 안에서는 비율을 그대로 쓴다.
     * 이렇게 하면 계단식으로 튀지 않으면서 구간 정보도 살린다.
     */
    const note0 = analysis?.meetingNote as any;
    const topics = (note0?.topics || []) as any[];
    const partCount = note0?.partCount || 0;
    if (partCount > 1 && topics.some((t) => typeof t.part === 'number')) {
      const part = Math.min(partCount - 1, Math.floor(frac * partCount));
      const first = topics.findIndex((t) => t.part === part);
      const el = first >= 0 ? document.getElementById(`note-topic-${first}`) : null;
      if (el) {
        // 이 구간 안에서의 진행도(0~1)
        const within = frac * partCount - part;
        const anchor = (el.offsetTop - note.offsetTop) / noteRange;
        // 구간 시작점에서 다음 구간까지를 within 만큼 나아간다
        const nextIdx = topics.findIndex((t) => t.part === part + 1);
        const nextEl = nextIdx >= 0 ? document.getElementById(`note-topic-${nextIdx}`) : null;
        const nextAnchor = nextEl ? (nextEl.offsetTop - note.offsetTop) / noteRange : 1;
        frac = anchor + (nextAnchor - anchor) * within;
      }
    }

    const target = Math.max(0, Math.min(noteRange, frac * noteRange));
    // 이미 그 근처면 두지 않는다 — 매 프레임 scrollTo 를 부르면 사용자 스크롤과 싸운다
    if (Math.abs(note.scrollTop - target) < 24) return;
    note.scrollTo({ top: target, behavior: 'smooth' });
  };

  /**
   * 스크롤 이벤트는 초당 수십 번 온다. 그때마다 발화 위치를 재면 스크롤이 무거워진다.
   * 프레임에 한 번으로 묶는다 — 사람 눈에는 차이가 없고 계산은 1/n 이 된다.
   */
  const syncQueued = useRef(false);
  const onTranscriptScroll = () => {
    if (syncQueued.current) return;
    syncQueued.current = true;
    requestAnimationFrame(() => { syncQueued.current = false; syncNoteToTranscript(); });
  };

  const SHORT_CHARS = 10;
  const shortCount = byQuery.filter((s: any) => (s.content || '').trim().length <= SHORT_CHARS).length;
  const shownSegments = showShort
    ? byQuery
    : byQuery.filter((s: any) => (s.content || '').trim().length > SHORT_CHARS);

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Typography>로딩 중...</Typography>
      </Container>
    );
  }

  if (!meeting) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/meetings')}>
          돌아가기
        </Button>
        <Typography sx={{ mt: 2 }}>미팅을 찾을 수 없습니다.</Typography>
      </Container>
    );
  }

  /** 법률 상담인가. 「고객」·「영업자」 라는 말을 쓰지 않는 자리들이 이 값을 본다 (016). */
  const legalKind = meeting.kind === 'legal';

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/meetings')} sx={{ mb: 3 }}>
        돌아가기
      </Button>

      {/*
        비닉권 표시 (021). **화면 맨 위다** — 이 기록이 무엇인지 보는 사람이 먼저 알아야 한다.
        DB 에만 두면 아무 소용이 없다.
      */}
      {meeting.privileged && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: '#FEF2F2', border: '1.5px solid #FCA5A5' }}>
          <Typography variant="body2" sx={{ color: '#991B1B', fontWeight: 700 }}>
            비밀유지 · 비닉권 대상
          </Typography>
          <Typography variant="caption" sx={{ color: '#991B1B', display: 'block', mt: 0.25 }}>
            변호사와 의뢰인 사이의 상담 기록입니다. 내보내는 문서에도 같은 고지가 함께 박힙니다.
          </Typography>
        </Paper>
      )}

      {/* 미팅 정보 */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', mb: 2 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
              {meeting.title}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {new Date(meeting.startTime).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Typography>
          </Box>
          <Chip
            label={
              meeting.analysisStatus === 'completed'
                ? '분석완료'
                : meeting.analysisStatus === 'processing'
                  ? '분석중'
                  : meeting.analysisStartedAt ? '대기중' : '분석 전'
            }
            color={
              meeting.analysisStatus === 'completed'
                ? 'success'
                : meeting.analysisStatus === 'processing'
                  ? 'warning'
                  : 'default'
            }
            variant="outlined"
          />
        </Box>
        <Divider sx={{ my: 2 }} />
        {meeting.notes && (
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              메모
            </Typography>
            <Typography variant="body2">{meeting.notes}</Typography>
          </Box>
        )}
      </Paper>

      {/*
        **분석이 덜 된 것을 「완료」로 넘기지 않는다** (028).

        2026-08-26 실측: 녹음이 안 붙은 법률 상담이 `completed 100%` 인데 사실관계가
        전부 비어 있었다. 그대로 두면 변호사는 **「상담에서 건질 것이 없었다」로 읽는다.**
        탭을 열기 **전에** 보여야 하므로 탭 바로 위에 둔다.
      */}
      {meeting.analysisNote && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={700} sx={{ mb: .25 }}>
            분석이 온전히 끝나지 않았습니다
          </Typography>
          <Typography variant="body2">{meeting.analysisNote}</Typography>
        </Alert>
      )}

      {/* 미팅노트 / 리포트 / 지표.
          한 페이지에 전부 쌓으면 정작 읽어야 할 요약·코칭이 저 아래로 밀린다.
          녹취는 별도 탭이 아니라 미팅노트 옆에 둔다 — 노트를 읽다 근거를 확인하는 흐름이라
          탭을 오가면 읽던 자리를 잃는다. */}
      <Tabs
        value={tab}
        onChange={(_, v) => { setTab(v); if (v === 'note') setTranscriptOpen(true); }}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label={`미팅노트 (${segments.length})`} value="note" />
        {/* **법률 상담일 때만 보인다.** 일반 미팅에 빈 탭을 띄우지 않는다 (016) */}
        {meeting.kind === 'legal' && (
          <Tab label={`사실관계${legal?.findings?.length ? ` · 확인 ${legal.findings.length}` : ''}`} value="legal" />
        )}
        <Tab label="리포트" value="report" />
        {/* **법률 상담에는 지표 탭을 띄우지 않는다.**
            딜 강도·미팅 점수·스코어카드는 전부 영업 척도다. 법률 상담에 붙이면
            변호사가 자기 상담을 「딜」로 채점당한다 — 이 제품이 하려는 일이 아니다. */}
        {meeting.kind !== 'legal' && <Tab label="지표" value="metrics" />}
      </Tabs>

      {/* ── 사실관계 탭 (법률 상담 전용, 018) ──
          **순서가 중요하다.** 확인할 것 → 요건 → 시계열 → 증거.
          변호사가 상담 직후 가장 먼저 알아야 하는 것은 "무엇이 빠졌나" 이지
          "무슨 말이 오갔나" 가 아니다. 오간 말은 녹취 탭에 있다. */}
      {tab === 'legal' && (
        <Stack spacing={3}>
          {!legal?.analysis && (
            <Paper sx={{ p: 3, bgcolor: '#F1F5F9', border: '1px solid #CBD5E1' }}>
              <Typography variant="body2" fontWeight={600}>법률 분해 결과가 없습니다</Typography>
              <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                분석이 아직 끝나지 않았거나, 이 상담에서 분해할 내용을 찾지 못했습니다.
              </Typography>
            </Paper>
          )}

          {/* 1) 확인할 것 — **비어 있으면 비어 있다고만 적는다.** 억지로 채우면 거짓 경보다 */}
          <Paper sx={{ p: 3 }}>
            <Typography variant="subtitle2" fontWeight={700} mb={0.5}>확인할 것</Typography>
            <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
              빠진 것 · 앞뒤가 어긋나는 것 · 의뢰인에게 불리한 정황
            </Typography>
            {legal?.findings?.length ? (
              <Stack spacing={1.5}>
                {legal.findings.map((f: any) => {
                  const ui: Record<string, { label: string; bg: string; bd: string; c: string }> = {
                    GAP:          { label: '빠짐',   bg: '#FFFBEB', bd: '#FCD34D', c: '#92400E' },
                    INCONSISTENCY:{ label: '모순',   bg: '#FEF2F2', bd: '#FCA5A5', c: '#991B1B' },
                    ADVERSE_FACT: { label: '불리',   bg: '#FEF2F2', bd: '#FCA5A5', c: '#991B1B' },
                    ASSUMPTION:   { label: '가정',   bg: '#F1F5F9', bd: '#CBD5E1', c: '#334155' },
                  };
                  const u = ui[f.kind] || ui.ASSUMPTION;
                  return (
                    <Box key={f.id} sx={{ bgcolor: u.bg, border: `1px solid ${u.bd}`, borderRadius: 1, p: 1.5 }}>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 0.5 }}>
                        <Chip size="small" label={u.label} sx={{ bgcolor: u.c, color: '#fff', height: 20 }} />
                        <Typography variant="caption" sx={{ color: u.c, fontWeight: 700 }}>
                          {f.severity === 'HIGH' ? '높음' : f.severity === 'MEDIUM' ? '보통' : '낮음'}
                        </Typography>
                      </Box>
                      <Typography variant="body2">{f.detail}</Typography>
                      {f.question && (
                        <Typography variant="body2" sx={{ mt: 0.75, color: u.c }}>
                          다음에 물을 것 — {f.question}
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                이 상담에서는 확인할 것이 나오지 않았습니다.
              </Typography>
            )}
          </Paper>

          {/* 2) 요건 — **사건 전체의 상태다.** 이 상담만의 것이 아니다 */}
          {legal?.elements?.length > 0 && (
            <Paper sx={{ p: 3 }}>
              <Typography variant="subtitle2" fontWeight={700} mb={0.5}>요건사실</Typography>
              <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
                이 사건 전체 기준입니다 — 다른 상담에서 채워진 것도 함께 보입니다
              </Typography>
              <Stack spacing={1}>
                {legal.elements.map((e: any, i: number) => {
                  const ui: Record<string, { label: string; c: string }> = {
                    SATISFIED: { label: '충족',   c: '#166534' },
                    PARTIAL:   { label: '일부',   c: '#92400E' },
                    CONTESTED: { label: '다툼',   c: '#1E40AF' },
                    MISSING:   { label: '없음',   c: '#991B1B' },
                  };
                  const u = ui[e.status] || ui.MISSING;
                  return (
                    <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                      <Chip size="small" label={u.label}
                        sx={{ bgcolor: u.c, color: '#fff', height: 20, minWidth: 44 }} />
                      <Box>
                        <Typography variant="body2" fontWeight={500}>{e.element}</Typography>
                        {e.note && (
                          <Typography variant="caption" color="text.secondary">{e.note}</Typography>
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            </Paper>
          )}

          {/* 3) 시계열 — **날짜가 불명확한 것을 불명확하다고 그린다** (017·018 과 같은 원칙) */}
          {legal?.timeline?.length > 0 && (
            <Paper sx={{ p: 3 }}>
              <Typography variant="subtitle2" fontWeight={700} mb={1.5}>시계열</Typography>
              <Stack spacing={1.5}>
                {legal.timeline.map((t: any) => (
                  <Box key={t.id} sx={{ display: 'flex', gap: 2 }}>
                    {/* 폰에서만 좁힌다 — sm 이상은 110 그대로다 */}
                    <Box sx={{ minWidth: { xs: 78, sm: 110 } }}>
                      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {t.occurred_on ? String(t.occurred_on).slice(0, 10) : '날짜 불명'}
                      </Typography>
                      {t.precision && t.precision !== 'EXACT' && (
                        <Typography variant="caption" color="warning.main">
                          {t.precision === 'MONTH' ? '월까지만' : t.precision === 'YEAR' ? '연도만' : '확인 필요'}
                        </Typography>
                      )}
                    </Box>
                    <Box>
                      <Typography variant="body2">{t.what}</Typography>
                      {t.legal_meaning && (
                        <Typography variant="caption" color="primary.main">{t.legal_meaning}</Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Stack>
            </Paper>
          )}

          {/* 4) 증거 — **"있다" 와 "가져올 수 있다" 를 가른다** */}
          {legal?.evidence?.length > 0 && (
            <Paper sx={{ p: 3 }}>
              <Typography variant="subtitle2" fontWeight={700} mb={1.5}>증거</Typography>
              <Stack spacing={1.25}>
                {legal.evidence.map((e: any) => {
                  const ui: Record<string, { label: string; c: string }> = {
                    SECURED:      { label: '확보',     c: '#166534' },
                    PROMISED:     { label: '받기로',   c: '#92400E' },
                    UNCONFIRMED:  { label: '미확인',   c: '#334155' },
                    NON_EXISTENT: { label: '없음',     c: '#991B1B' },
                  };
                  const u = ui[e.status] || ui.UNCONFIRMED;
                  return (
                    <Box key={e.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                      <Chip size="small" label={u.label}
                        sx={{ bgcolor: u.c, color: '#fff', height: 20, minWidth: 52 }} />
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight={500}>{e.kind}</Typography>
                        <Typography variant="caption" color="text.secondary" display="block">
                          {e.what}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {e.holder ? `보유 ${e.holder}` : ''}
                          {e.difficulty ? ` · 확보 난이도 ${e.difficulty}/5` : ''}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            </Paper>
          )}
        </Stack>
      )}

      {/* ── 미팅노트 탭 ── 왼쪽 녹취, 오른쪽 미팅노트.
          **마크업은 미팅노트가 먼저다.** 모바일에서 위로 와야 하기 때문이다 —
          정리된 노트를 먼저 보고, 근거가 필요할 때 아래 녹취를 본다.
          데스크톱에서만 row-reverse 로 좌우를 뒤집는다(녹취가 왼쪽). */}
      {tab === 'note' && (
        <Box
          sx={{
            display: 'flex', gap: 2, alignItems: 'flex-start',
            flexDirection: { xs: 'column', md: 'row-reverse' },
          }}
        >
          {/* 오른쪽(모바일에서는 위) — 미팅노트 */}
          <Box
            ref={noteBoxRef}
            // 사용자가 노트를 직접 스크롤하면 2.5초간 자동 이동을 멈춘다.
            // 읽던 자리를 빼앗기는 것이 안 따라오는 것보다 나쁘다.
            onWheel={() => { noteTouchedAt.current = Date.now(); }}
            onTouchMove={() => { noteTouchedAt.current = Date.now(); }}
            sx={{
              flex: 1, minWidth: 0, width: '100%',
              // 데스크톱에서만 자체 스크롤. 모바일은 위아래로 쌓이므로 페이지 스크롤이 자연스럽다.
              maxHeight: { xs: 'none', md: '78vh' },
              overflowY: { xs: 'visible', md: 'auto' },
            }}
          >
            {/* 녹취를 고치면 뜬다. **자동으로 갱신하지 않는다** — 한 줄 고칠 때마다 돌면
                열 줄 고칠 때 열 번 부르고, 그때마다 화면이 바뀌어 읽던 자리를 잃는다.
                여러 곳을 고치고 한 번에 누르는 것이 실제 흐름이다. */}
            {noteStale && (
              <Paper
                sx={{ p: 2, mb: 2, bgcolor: 'warning.light', display: 'flex',
                      alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}
              >
                <Typography variant="body2" sx={{ flex: 1, minWidth: { xs: 0, sm: 200 } }}>
                  녹취가 수정되었습니다. 아래 요약은 <b>수정 전</b> 내용을 근거로 만들어졌습니다.
                </Typography>
                <Button
                  size="small" variant="contained" disabled={renoting}
                  onClick={runRenote}
                >
                  {renoting ? '갱신 중…' : '미팅노트·AI요약 갱신'}
                </Button>
              </Paper>
            )}
            {renoteError && (
              <Paper sx={{ p: 2, mb: 2, bgcolor: 'error.light' }}>
                <Typography variant="body2">{renoteError}</Typography>
              </Paper>
            )}
            {renoting && <LinearProgress sx={{ mb: 2 }} />}
            {analysis && (
              <>
                {/* 리뷰용 미팅 노트 — 나중에 이것만 보고 미팅을 되짚을 수 있어야 한다.
                    녹취 404개를 다시 읽지 않으려면 주제별로 찾아갈 수 있어야 한다. */}
                {analysis.meetingNote && (analysis.meetingNote.topics?.length || analysis.meetingNote.headline) && (
                  <Paper sx={{ p: 3, mb: 3 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600, mb: 1.5 }}>🗒️ 미팅 노트</Typography>

                    {analysis.meetingNote.headline && (
                      <Typography variant="body1" sx={{ fontWeight: 600, mb: 2.5 }}>
                        {analysis.meetingNote.headline}
                      </Typography>
                    )}

                    {/* 핵심 키워드 — **맨 아래에 있던 것을 위로 올렸다.**
                        미팅을 되짚을 때 가장 먼저 찾는 것이 사람·회사·금액·일정이고,
                        주제 여섯 개를 지나야 나오면 그 역할을 못 한다.
                        누르면 녹취에서 그 말을 찾아 준다 — 이미 있는 검색을 재사용한다. */}
                    {analysis.meetingNote.mentions && analysis.meetingNote.mentions.length > 0 && (
                      <Box sx={{ mb: 2.5 }}>
                        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                          {analysis.meetingNote.mentions.map((m, i) => {
                            const c = MENTION_COLORS[m.kind] || MENTION_COLORS.기타;
                            const on = transcriptQuery === m.value;
                            return (
                              <Chip
                                key={i} size="small"
                                label={m.value}
                                title={`${m.kind} · 누르면 녹취에서 찾습니다`}
                                onClick={() => {
                                  // 같은 것을 다시 누르면 해제 — 눌러서 켰으면 눌러서 꺼야 한다
                                  setTranscriptQuery(on ? '' : m.value);
                                  setTranscriptOpen(true);
                                }}
                                sx={{
                                  cursor: 'pointer', fontWeight: 500,
                                  bgcolor: on ? c.fg : c.bg,
                                  color: on ? '#fff' : c.fg,
                                  border: '1px solid', borderColor: c.fg,
                                  '&:hover': { bgcolor: on ? c.fg : c.bg, opacity: 0.85 },
                                }}
                              />
                            );
                          })}
                        </Stack>
                      </Box>
                    )}

                    {(analysis.meetingNote.topics || []).map((t, i) => (
                      <Box key={i} id={`note-topic-${i}`} sx={{ mb: 2, scrollMarginTop: 8 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          {i + 1}. {t.title}
                        </Typography>
                        <Stack spacing={0.4} sx={{ mt: 0.5, pl: 2 }}>
                          {(t.points || []).map((pt, j) => (
                            <Box key={j} sx={{ display: 'flex', gap: 1 }}>
                              <Typography variant="body2" color="text.secondary">·</Typography>
                              <Typography variant="body2">{pt}</Typography>
                            </Box>
                          ))}
                        </Stack>
                      </Box>
                    ))}

                    {[
                      { title: '결정된 것', items: analysis.meetingNote.decisions, color: '#065F46', bg: '#ECFDF5' },
                      { title: '미결·확인 필요', items: analysis.meetingNote.open_items, color: '#92400E', bg: '#FFFBEB' },
                      { title: '다음 일정', items: analysis.meetingNote.next_steps, color: '#1E40AF', bg: '#EFF6FF' },
                    ].filter((g) => g.items && g.items.length > 0).map((g) => (
                      <Box key={g.title} sx={{ mt: 2, p: 1.5, bgcolor: g.bg, borderRadius: 1 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: g.color, mb: 0.5 }}>
                          {g.title}
                        </Typography>
                        <Stack spacing={0.4}>
                          {(g.items || []).map((it, j) => (
                            <Typography key={j} variant="body2">· {it}</Typography>
                          ))}
                        </Stack>
                      </Box>
                    ))}

                  </Paper>
                )}

              </>
            )}
          </Box>

          {/* 왼쪽(모바일에서는 아래) — 녹취 */}
          <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
            {/* 화자별 대화 — **기본은 접혀 있다.**
                녹취는 리포트를 읽다가 근거를 확인할 때 보는 참고 자료인데, 펼쳐 두면 발화 수백 개가
                화면을 통째로 차지해 정작 읽어야 할 요약·코칭이 저 아래로 밀린다.
                펼쳐도 높이를 고정해 스크롤시킨다 — 페이지 전체가 다시 길어지면 접은 의미가 없다. */}
            {segments.length > 0 && (
              <Paper sx={{ p: 3 }}>
                {/* 제목은 **자기 줄을 가진다.**
                    한 줄에 제목·요약·버튼을 몰아넣었더니, 좌우 분할로 칸이 절반이 되면서
                    셋 중 제목이 먼저 줄어들어 "화자별 / 대화" 로 접혔다.
                    폭에 따라 접히고 말고가 갈리는 배치는 어느 폭에서든 다시 깨진다. */}
                <Box
                  onClick={() => setTranscriptOpen((v) => !v)}
                  sx={{ cursor: 'pointer', userSelect: 'none', '&:hover': { opacity: 0.75 } }}
                >
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>💬 화자별 대화</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    {/* 접힌 상태에서도 규모는 알 수 있어야 한다 — 열어 볼지 판단할 근거다.
                        화자 이름을 나열하면 세 명만 돼도 줄이 넘치므로 수만 적는다. */}
                    <Typography variant="body2" color="textSecondary" sx={{ flex: 1, minWidth: 0 }}>
                      발화 {segments.length}개
                      {speakerNames.length ? ` · 화자 ${speakerNames.length}명` : ''}
                    </Typography>
                    {/* 내려받기는 **접힌 상태에서도** 눌러야 한다 — 그래서 Collapse 밖이다.
                        `segments` 를 그대로 넘긴다: 화자 필터·검색·짧은 발화 접기가 걸려 있어도
                        파일에는 녹취 전부가 들어간다. 받은 파일이 화면 상태에 따라 달라지면
                        나중에 그 파일만 봤을 때 전부인지 일부인지 알 수 없다. */}
                    <TranscriptDownload
                      meeting={{
                        title: meeting.title,
                        startTime: meeting.startTime,
                        customerName: meeting.customerName,
                        // **이걸 빠뜨리면 화면에만 표시가 뜨고 파일에는 안 박힌다** (021).
                        // 파일은 사무소 밖으로 나가는 쪽이라 오히려 더 중요하다.
                        privileged: meeting.privileged,
                        // 작성자 표시 (026). 프로필이 비어 있으면 그 줄이 아예 안 들어간다.
                        author: me ? {
                          name: me.name, barNo: me.barNo, firmName: me.firmName,
                          position: me.position, officePhone: me.officePhone,
                        } : null,
                      }}
                      segments={segments}
                    />
                    <Button size="small" sx={{ flexShrink: 0 }}>
                      {transcriptOpen ? '접기' : '펼치기'}
                    </Button>
                  </Box>
                </Box>

                <Collapse in={transcriptOpen}>
                  <Box sx={{ mt: 2 }}>
                    <TextField
                      size="small" fullWidth placeholder="대화 내용 검색"
                      value={transcriptQuery}
                      onChange={(e) => setTranscriptQuery(e.target.value)}
                      sx={{ mb: 1.5 }}
                    />
                    {/* 화자 필터 — 변호사 말만, 또는 의뢰인 말만 보고 싶을 때가 있다 */}
                    <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                      <Chip
                        size="small" label={`전체 ${segments.length}`}
                        color={speakerFilter.size === 0 ? 'primary' : 'default'}
                        variant={speakerFilter.size === 0 ? 'filled' : 'outlined'}
                        onClick={() => setSpeakerFilter(new Set())}
                      />
                      {speakerNames.map((name) => (
                        <Chip
                          key={name} size="small" label={`${name} ${speakerCounts[name]}`}
                          color={speakerFilter.has(name) ? 'primary' : 'default'}
                          variant={speakerFilter.has(name) ? 'filled' : 'outlined'}
                          onClick={() => setSpeakerFilter((prev) => {
                            const next = new Set(prev);
                            if (next.has(name)) next.delete(name); else next.add(name);
                            return next;
                          })}
                        />
                      ))}
                    </Stack>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Typography variant="caption" color="textSecondary" sx={{ flex: 1, minWidth: 0 }}>
                        {shownSegments.length}개 표시
                        {transcriptQuery ? ` · "${transcriptQuery}" 검색` : ''}
                      </Typography>
                      {/* 키워드 칩으로 켠 검색은 입력창을 지워야 풀리는데, 칩을 누른 사람은
                          입력창을 본 적이 없다. 여기서 바로 풀 수 있어야 한다. */}
                      {transcriptQuery && (
                        <Button size="small" onClick={() => setTranscriptQuery('')}>
                          검색 해제
                        </Button>
                      )}
                      {editedIds.length > 0 && (
                        <Button size="small" color="warning" onClick={gotoNextEdit}>
                          수정한 곳 {editedIds.length}
                        </Button>
                      )}
                      {shortCount > 0 && (
                        <Button size="small" onClick={() => setShowShort((v) => !v)}>
                          {showShort
                            ? `짧은 발화 ${shortCount}개 접기`
                            : `짧은 발화 ${shortCount}개 보기`}
                        </Button>
                      )}
                    </Box>
                    {/* 높이를 고정하고 안에서만 스크롤한다 */}
                    {/* 재생기는 녹취 목록 **위**에 둔다. 아래 두면 긴 녹취에서 스크롤해야 닿는다. */}
                    <AudioPlayer ref={playerRef} recordings={recordings} />

                    <Box
                      ref={transcriptBoxRef}
                      onScroll={onTranscriptScroll}
                      // 노트 칸(78vh)과 **높이를 맞춘다.** 한쪽이 짧으면 그쪽이 먼저 끝나
                      // 다른 쪽은 절반도 못 내려간 채로 남는다 — 비율로 맞추는 의미가 없어진다.
                      // 헤더·검색·필터·재생기가 위에 있으므로 그만큼 뺀다.
                      sx={{ maxHeight: { xs: 420, md: 'calc(78vh - 320px)' }, minHeight: 240,
                            overflowY: 'auto', pr: 1 }}
                    >
                      <Stack spacing={1.5}>
                        {shownSegments.map((seg) => (
                          <TranscriptLine
                            key={seg.id}
                            seg={seg}
                            editNo={editedIds.indexOf(seg.id) >= 0 ? editedIds.indexOf(seg.id) + 1 : undefined}
                            onSave={saveSegment}
                            onRevert={revertSegment}
                            onHighlight={saveHighlights}
                            onPlay={(recId, ms) => playerRef.current?.playAt(recId, ms)}
                          />
                        ))}
                        {shownSegments.length === 0 && (
                          <Typography variant="body2" color="textSecondary">
                            {shortCount > 0
                              ? '조건에 맞는 발화가 없습니다. 짧은 발화를 켜 보세요.'
                              : '조건에 맞는 발화가 없습니다.'}
                          </Typography>
                        )}
                      </Stack>
                    </Box>
                  </Box>
                </Collapse>
              </Paper>
            )}
          </Box>
        </Box>
      )}

      {analysis && tab === 'report' && (
        <>
          {/* AI 요약 (V1식) */}
          {analysis.summary && (
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>📝 AI 요약</Typography>
              <Typography variant="body1">{analysis.summary}</Typography>
            </Paper>
          )}

          {/* 관심사 / 우려 (V1식) */}
          {((analysis.interests && analysis.interests?.length > 0) ||
            (analysis.concerns && analysis.concerns?.length > 0)) && (
            <Grid container spacing={3} sx={{ mb: 3 }}>
              <Grid item xs={12} md={6}>
                <Paper sx={{ p: 3, height: '100%' }}>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>👍 고객 관심사</Typography>
                  <Stack spacing={1}>
                    {(analysis.interests || []).map((it, i) => (
                      <Box key={i} sx={{ display: 'flex', gap: 1 }}>
                        <Typography sx={{ color: '#10B981' }}>•</Typography>
                        <Typography variant="body2">{it}</Typography>
                      </Box>
                    ))}
                    {(!analysis.interests || analysis.interests?.length === 0) && (
                      <Typography variant="body2" color="textSecondary">-</Typography>
                    )}
                  </Stack>
                </Paper>
              </Grid>
              <Grid item xs={12} md={6}>
                <Paper sx={{ p: 3, height: '100%' }}>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>⚠️ 고객 우려사항</Typography>
                  <Stack spacing={1}>
                    {(analysis.concerns || []).map((c, i) => (
                      <Box key={i} sx={{ display: 'flex', gap: 1 }}>
                        <Typography sx={{ color: '#F59E0B' }}>•</Typography>
                        <Typography variant="body2">{c}</Typography>
                      </Box>
                    ))}
                    {(!analysis.concerns || analysis.concerns?.length === 0) && (
                      <Typography variant="body2" color="textSecondary">-</Typography>
                    )}
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          )}
          {/* 코칭 — 서버는 계속 만들어 왔는데 화면이 그리지 않던 것이다 */}
          {analysis.coaching && (
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>🎓 코칭</Typography>
              {analysis.coaching.direction && (
                <Typography variant="body1" sx={{ mb: 2 }}>{analysis.coaching.direction}</Typography>
              )}
              <Grid container spacing={2}>
                {[
                  { title: '다음 미팅 준비', items: analysis.coaching.preparation },
                  { title: '체크리스트', items: analysis.coaching.checklist },
                ].filter((g) => g.items && g.items.length > 0).map((g) => (
                  <Grid item xs={12} sm={6} key={g.title}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{g.title}</Typography>
                    <Stack spacing={0.75}>
                      {(g.items || []).map((it, i) => (
                        <Box key={i} sx={{ display: 'flex', gap: 1 }}>
                          <Typography sx={{ color: '#6366F1' }}>•</Typography>
                          <Typography variant="body2">{it}</Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Grid>
                ))}
              </Grid>
              {analysis.coaching.next_appointment && (
                <Box sx={{ mt: 2, p: 1.5, bgcolor: '#EEF2FF', borderRadius: 1 }}>
                  <Typography variant="body2">
                    <strong>다음 약속 제안</strong> · {analysis.coaching.next_appointment}
                  </Typography>
                </Box>
              )}
            </Paper>
          )}

          {/* 심리 인사이트 */}
          {analysis.psychInsights && (
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>🧠 심리 인사이트</Typography>
              <Grid container spacing={2}>
                {[
                  // 법률 상담에서는 「고객」·「영업자」가 아니다
                  { k: legalKind ? '의뢰인 상태' : '고객 상태', v: analysis.psychInsights.customer_state },
                  { k: legalKind ? '변호사 자신감' : '영업자 자신감', v: analysis.psychInsights.rep_confidence },
                  { k: '답변 품질', v: analysis.psychInsights.answer_quality },
                  { k: legalKind ? '의뢰인 반응성' : '고객 반응성', v: analysis.psychInsights.responsiveness },
                ].filter((x) => x.v).map((x) => (
                  <Grid item xs={12} sm={6} key={x.k}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography color="textSecondary" sx={{ mb: 1 }}>{x.k}</Typography>
                        <Typography variant="body2">{x.v}</Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
              {analysis.psychInsights.notes && analysis.psychInsights.notes.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>관찰 근거</Typography>
                  <Stack spacing={0.75}>
                    {analysis.psychInsights.notes.map((n, i) => (
                      <Typography key={i} variant="body2" color="textSecondary">· {n}</Typography>
                    ))}
                  </Stack>
                </Box>
              )}
            </Paper>
          )}

          {/* 액션 아이템 — 체크하면 저장된다 (v1 과 같은 동작) */}
          {analysis.actionItems && analysis.actionItems.length > 0 && (
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                ✅ 액션 아이템 ({doneSet.size}/{analysis.actionItems.length})
              </Typography>
              <Stack spacing={0.5}>
                {analysis.actionItems.map((item, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <Checkbox
                      size="small" checked={doneSet.has(i)} disabled={savingDone}
                      onChange={() => toggleActionItem(i)} sx={{ pt: 0.25 }}
                    />
                    <Typography
                      variant="body2"
                      sx={{
                        pt: 0.75,
                        textDecoration: doneSet.has(i) ? 'line-through' : 'none',
                        color: doneSet.has(i) ? 'text.disabled' : 'text.primary',
                      }}
                    >
                      {item}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Paper>
          )}

            {/* 고객 니즈 — **영업 분석기의 결과다.**
                법률 상담에서는 그것을 아예 만들지 않으므로(2.16.0) 칸도 띄우지 않는다.
                빈 상자를 「분석했는데 아무것도 없었다」 로 읽으면 안 된다.
                일반·수임 상담이라도 값이 비면 감춘다 — 제목만 있는 상자는 신뢰를 깎는다. */}
            {!legalKind && analysis.customerNeeds?.primary && (
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
              📋 고객 니즈 분석
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="textSecondary" sx={{ mb: 1 }}>
                      주요 니즈
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {analysis.customerNeeds?.primary}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="textSecondary" sx={{ mb: 1 }}>
                      예산
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {analysis.customerNeeds?.budget}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="textSecondary" sx={{ mb: 1 }}>
                      타임라인
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {analysis.customerNeeds?.timeline}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="textSecondary" sx={{ mb: 1 }}>
                      의사결정자
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {analysis.customerNeeds?.decisionMakers}명
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Paper>
            )}
          {/* 주요 포인트 */}
          {analysis.keyPoints && analysis.keyPoints?.length > 0 && (
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                💡 주요 포인트
              </Typography>
              <Stack spacing={1}>
                {analysis.keyPoints?.map((point, index) => (
                  <Box key={index} sx={{ display: 'flex', gap: 2 }}>
                    <Typography sx={{ fontWeight: 600, color: '#0066CC' }}>•</Typography>
                    <Typography variant="body2">{point}</Typography>
                  </Box>
                ))}
              </Stack>
            </Paper>
          )}
          {/* 팔로업 이메일 초안 (V1식) */}
          {analysis.followUpDraft && (
            <Paper sx={{ p: 3, mt: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>✉️ 팔로업 이메일 초안</Typography>
              <Box sx={{ bgcolor: '#F9FAFB', p: 2, borderRadius: 1, border: '1px solid #E5E7EB' }}>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {analysis.followUpDraft}
                </Typography>
              </Box>
            </Paper>
          )}

          {/* 서면 만들기 (029) — **팔로업 이메일 다음, 리포트 탭 맨 끝.**
              상담을 다 읽은 자리에 두어야 「이제 무엇을 쓸까」 로 이어진다. */}
          <DocumentBuilder matterId={meeting.matterId ?? null} meetingId={meeting.id}
            onChanged={() => setReload((n) => n + 1)} />
        </>
      )}

      {analysis && tab === 'metrics' && meeting.kind !== 'legal' && (
        <>
          {/* 스코어카드 — 축마다 점수·근거·조언. 저장돼 있었지만 화면에 없던 것이다 */}
          {analysis.scorecard?.axes && Object.keys(analysis.scorecard.axes).length > 0 && (
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                📊 스코어카드{analysis.scorecard.total != null ? ` · 총점 ${analysis.scorecard.total}` : ''}
              </Typography>
              {analysis.scorecard.headline && (
                <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                  {analysis.scorecard.headline}
                </Typography>
              )}
              <Stack spacing={2}>
                {Object.entries(analysis.scorecard.axes).map(([key, ax]) => (
                  <Box key={key}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
                        {AXIS_NAMES[key] || key}
                      </Typography>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{ax.score ?? '-'}</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, ax.score ?? 0))} />
                    {ax.evidence && (
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.75 }}>
                        근거 · {ax.evidence}
                      </Typography>
                    )}
                    {ax.advice && (
                      <Typography variant="caption" sx={{ display: 'block', mt: 0.25, color: '#4F46E5' }}>
                        💡 {ax.advice}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Stack>
            </Paper>
          )}

          {/* 점수 */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
              ⭐ 미팅 점수
            </Typography>
            <Grid container spacing={2}>
              {Object.entries(analysis.scores)
                .filter(([key]) => key !== 'overall')
                .map(([key, value]) => (
                  <Grid item xs={12} sm={6} key={key}>
                    <Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {key === 'customerUnderstanding'
                            ? '고객 이해도'
                            : key === 'problemSolving'
                              ? '문제 해결력'
                              : key === 'proposalPersuasion'
                                ? '제안 설득력'
                                : key === 'followUp'
                                  ? '후속 액션'
                                  : '팀 협업'}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {value}
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={value}
                        sx={{
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: '#E5E7EB',
                          '& .MuiLinearProgress-bar': {
                            borderRadius: 3,
                            backgroundColor: '#0066CC',
                          },
                        }}
                      />
                    </Box>
                  </Grid>
                ))}
            </Grid>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                종합 점수
              </Typography>
              <Typography variant="h3" sx={{ color: '#0066CC', fontWeight: 700 }}>
                {analysis.scores?.overall}
              </Typography>
            </Box>
          </Paper>
          {/* 대화 지표 (V1식, 코드 계산) */}
          {analysis.talkMetrics && analysis.talkMetrics?.speakers && (() => {
            /**
             * **말수 순으로 세우고, 자잘한 것은 접는다** (2026-08-27).
             *
             * 예전에는 나온 화자를 전부 카드로 그렸다. 실제로 두 명인 미팅에
             * 45장이 떴고, 그 중 절반이 1~5단어짜리였다 — 구간을 넘어 같은 사람을
             * 잇지 못하면 화자가 그만큼 갈라지기 때문이다.
             * **카드 45장은 지표가 아니라 소음이다.**
             *
             * 접는 기준은 「전체 말수의 2%」 다. 사람 수로 자르지 않는다 —
             * 진짜로 여덟 명이 말한 회의에서 여덟 번째를 숨기면 안 된다.
             */
            const all = Object.entries(analysis.talkMetrics.speakers as Record<string, any>)
              .sort((a, b) => (b[1].words || 0) - (a[1].words || 0));
            const total = all.reduce((n, [, m]) => n + (m.words || 0), 0) || 1;
            const main = all.filter(([, m]) => (m.words || 0) / total >= 0.02);
            const minor = all.filter(([, m]) => (m.words || 0) / total < 0.02);
            const show = showAllSpeakers ? all : main;
            // 역할별. `미상` 은 맨 뒤로 — 값이 아니라 「못 정한 것」 이다.
            const roleRows = Object.entries((analysis.talkMetrics as any).roles || {})
              .sort((a: any, b: any) => (b[1].words || 0) - (a[1].words || 0))
              .sort((a) => (a[0] === '미상' ? 1 : -1)) as [string, any][];
            return (
              <Paper sx={{ p: 3, mt: 3 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={2} flexWrap="wrap">
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>🗣️ 대화 지표</Typography>
                  <Typography variant="caption" color="text.secondary">
                    화자 {all.length}명 · 말수 순
                  </Typography>
                </Stack>

                {/* **역할이 있으면 그것을 먼저 보여 준다** (2026-08-27).
                    구간이 갈리면 화자별 수치는 부서져서 아무것도 알려 주지 않는다.
                    다만 역할은 **말한 내용으로 추정한 것**이라 근거가 아니다 —
                    그래서 화자별을 지우지 않고 아래에 그대로 둔다. */}
                {roleRows.length > 0 && (
                  <Box sx={{ mb: 3 }}>
                    <Stack direction="row" alignItems="baseline" spacing={1} mb={1} flexWrap="wrap">
                      <Typography variant="subtitle2" fontWeight={700}>역할별</Typography>
                      <Typography variant="caption" color="text.secondary">
                        말한 내용으로 <b>추정</b>한 것입니다 — 아래 화자별과 견주어 보십시오
                      </Typography>
                    </Stack>
                    <Grid container spacing={2}>
                      {roleRows.map(([role, m]: [string, any]) => (
                        <Grid item xs={12} sm={6} key={role}>
                          <Card variant="outlined" sx={{ borderColor: role === '미상' ? 'divider' : 'primary.light' }}>
                            <CardContent>
                              <Typography sx={{ fontWeight: 700, mb: 1 }}>{role}</Typography>
                              <Typography variant="body2">발화 비율: {Math.round((m.talkRatio || 0) * 100)}%</Typography>
                              <Typography variant="body2">발화 수: {m.words}단어 · {m.turns}턴</Typography>
                              <Typography variant="body2">
                                질문: {m.questions}회
                                {(m.words || 0) >= 20 ? ` · 속도: ${m.wpm} WPM` : ''}
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                )}

                {/* **화자가 많으면 그것부터 말한다.** 숫자만 보여 주면 사람 수로 읽힌다. */}
                {all.length > 8 && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    <Typography variant="body2">
                      화자가 <b>{all.length}명</b>으로 잡혔습니다. 녹음이 여러 구간으로 나뉘어 있고
                      구간 사이에 겹치는 부분이 없으면, <b>같은 사람이 구간마다 다른 화자로 갈립니다</b> —
                      실제 인원이 아닙니다.
                    </Typography>
                  </Alert>
                )}

                <Typography variant="subtitle2" fontWeight={700} mb={1}>
                  화자별 <Typography component="span" variant="caption" color="text.secondary">
                    — 구간마다 갈릴 수 있습니다
                  </Typography>
                </Typography>
                <Grid container spacing={2}>
                  {show.map(([label, m]: [string, any]) => (
                    <Grid item xs={12} sm={6} key={label}>
                      <Card variant="outlined">
                        <CardContent>
                          <Typography sx={{ fontWeight: 700, mb: 1 }}>{label}</Typography>
                          <Typography variant="body2">발화 비율: {Math.round((m.talkRatio || 0) * 100)}%</Typography>
                          <Typography variant="body2">발화 수: {m.words}단어 · {m.turns}턴</Typography>
                          <Typography variant="body2">
                            질문: {m.questions}회
                            {/* **말이 너무 짧으면 속도를 내지 않는다.** 1단어 0.15초는 400 WPM 이
                                되는데, 그건 말 빠르기가 아니라 토막이다. */}
                            {(m.words || 0) >= 20 ? ` · 속도: ${m.wpm} WPM` : ''}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>

                {minor.length > 0 && (
                  <Button size="small" sx={{ mt: 1.5 }}
                    onClick={() => setShowAllSpeakers((v) => !v)}>
                    {showAllSpeakers
                      ? '자잘한 화자 접기'
                      : `말수가 아주 적은 화자 ${minor.length}명 더 보기`}
                  </Button>
                )}
              </Paper>
            );
          })()}
          {/* 딜 신호 */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
              🎯 딜 신호
            </Typography>
            <Stack spacing={2}>
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    딜 강도
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {analysis.dealSignals?.strength}/10
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={analysis.dealSignals?.strength * 10}
                  sx={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: '#E5E7EB',
                    '& .MuiLinearProgress-bar': {
                      borderRadius: 4,
                      backgroundColor:
                        analysis.dealSignals?.signal === 'positive'
                          ? '#10B981'
                          : analysis.dealSignals?.signal === 'negative'
                            ? '#DC2626'
                            : '#F59E0B',
                    },
                  }}
                />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="textSecondary">
                  성약 확률
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, color: '#0066CC' }}>
                  {Math.round(analysis.dealSignals?.closingProbability * 100)}%
                </Typography>
              </Box>
              {analysis.dealSignals?.nextSteps && (
                <Box>
                  <Typography variant="body2" color="textSecondary">
                    다음 단계
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {analysis.dealSignals?.nextSteps}
                  </Typography>
                </Box>
              )}
            </Stack>
          </Paper>
        </>
      )}



      {/* 실패를 실패로 보여준다.
          예전에는 'completed 가 아니면' 전부 진행 중으로 표시해서, 실패한 분석이
          영원히 진행 바를 돌렸다. 이제 원인과 중단 지점이 DB 에 남으므로 그것을 띄운다. */}
      {meeting.analysisStatus === 'failed' && (
        <Paper sx={{ p: 3, bgcolor: '#FEE2E2', border: '1px solid #FCA5A5' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            분석에 실패했습니다
          </Typography>
          {meeting.analysisError && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              원인: {meeting.analysisError}
            </Typography>
          )}
          {meeting.analysisStage && (
            <Typography variant="caption" sx={{ mt: 0.5, display: 'block', color: 'text.secondary' }}>
              중단 지점: {meeting.analysisStage}
            </Typography>
          )}
        </Paper>
      )}

      {/*
        아직 한 번도 돌리지 않은 미팅. **진행바를 보여 주면 안 된다** — 기다리면 끝날 것처럼
        보이지만 아무것도 돌고 있지 않다. 무엇을 하면 되는지만 적는다.
      */}
      {meeting.analysisStatus === 'pending' && !meeting.analysisStartedAt && (
        <Paper sx={{ p: 3, bgcolor: '#F1F5F9', border: '1px solid #CBD5E1' }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>아직 분석하지 않은 미팅입니다</Typography>
          <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary' }}>
            제목과 메모는 그대로 남아 있습니다. 녹음을 붙여 분석하면 요약과 점수가 여기에 들어갑니다.
          </Typography>
        </Paper>
      )}

      {meeting.analysisStatus !== 'completed' && meeting.analysisStatus !== 'failed'
        && !(meeting.analysisStatus === 'pending' && !meeting.analysisStartedAt) && (
        <Paper sx={{ p: 3, bgcolor: '#FEF3C7', border: '1px solid #FCD34D' }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            ⏳ {meeting.analysisStage || '분석이 진행 중입니다'} ({Math.round(meeting.analysisProgress)}%)
          </Typography>
          <LinearProgress
            variant="determinate"
            value={meeting.analysisProgress}
            sx={{ mt: 1 }}
          />
          {stalled ? (
            <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
              20분이 넘도록 끝나지 않았습니다. 새로고침해도 그대로면 알려주세요.
            </Typography>
          ) : (
            <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.secondary' }}>
              진행 상황이 자동으로 갱신됩니다. 이 화면을 떠나도 분석은 계속됩니다.
            </Typography>
          )}
        </Paper>
      )}
    </Container>
  );
}
