import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Container, Card, CardContent, Typography, TextField, Button, Box, Stack,
  Autocomplete, Alert, LinearProgress, Checkbox, IconButton, Divider, Collapse,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Switch, FormControlLabel, MenuItem,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { apiClient } from '../services/api';
import { prepareRecordings } from '../lib/audioChunks';
import {
  backupChunk, clearSession, inspectBackup, listPending, newSessionId, pruneOlderThan,
  saveSession, toFile,
  type PendingSession,
} from '../lib/recordingBackup';
import { LiveTranscript, type TranscriptLine } from '../lib/liveTranscript';
import { TRANSCRIBE_TEXT, degradedText, type TranscribeNotes } from '../lib/transcribeStatus';

/** 비어 있으면 실시간 자막 기능 자체를 감춘다 — 켤 수 없는 스위치를 보여줄 이유가 없다. */
// 실시간 자막 서버. 빈 값이면 자막 기능이 **조용히 꺼진다** —
// 그래서 여기도 배포 빌드의 기본값을 둔다 (api.ts 와 같은 이유).
const STREAM_URL = (import.meta.env.VITE_STREAM_URL as string | undefined)
  // IEP 실시간 자막 서버는 아직 없다(S5 에서 구축). 그때까지 빈 값 → 자막 기능 자동 비활성.
  || '';

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmt(sec: number): string {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const RISK_UI: Record<string, { label: string; bg: string; border: string; emoji: string; color: string }> = {
  normal: { label: '정상', bg: '#F0FDF4', border: '#86EFAC', emoji: '🟢', color: '#166534' },
  caution: { label: '주의', bg: '#FFFBEB', border: '#FCD34D', emoji: '🟡', color: '#92400E' },
  danger: { label: '위험', bg: '#FEF2F2', border: '#FCA5A5', emoji: '🔴', color: '#991B1B' },
  opportunity: { label: '기회', bg: '#EFF6FF', border: '#93C5FD', emoji: '🔵', color: '#1E40AF' },
};

type RecState = 'idle' | 'recording' | 'paused';

/**
 * 조사 종류 — **분석 방식을 정한다** (마이그레이션 016).
 *
 * 모든 조사가 수사사건 조사는 아니다. 수사관도 수임 전 조사·자문 문의·내부 회의·거래처 조사를 한다.
 * **일반 조사에 법률 분석을 걸면 요건사실이 전부 `MISSING` 으로 나온다** —
 * 아무 문제 없는 대화에 대고 "빠진 것 투성이" 라고 외치는 셈이고, 그러면 다음부터 아무도 안 본다.
 *
 * **녹음을 누르기 전에 정해져야 한다.** 실시간 코칭이 종류에 따라 다른 것을 말하기 때문이다.
 * 기본은 `general` — 잘못 걸었을 때 덜 나쁜 쪽이다. 나중에 다시 분석할 수 있다.
 */
type MeetingKind = 'legal' | 'business' | 'general';

const MEETING_KINDS: { kind: MeetingKind; label: string; hint: string }[] = [
  { kind: 'legal',    label: '상담 (법률)',
    hint: '사실·주장·법적 요건을 나누고, 빠진 것과 어긋나는 것을 찾습니다' },
  { kind: 'business', label: '수임 상담',
    hint: '수임을 따내는 자리 — 상대의 관심과 우려를 분석합니다' },
  { kind: 'general',  label: '일반',
    hint: '요약과 후속 조치만. 법적 분해도 점수도 하지 않습니다' },
];
const KIND_PREF_KEY = 'lep.meetingKind';
interface RecItem {
  key: string;
  id?: string;
  label: string;
  durationSeconds: number;
  blobUrl?: string;
  transcriptPreview?: string;
  selected: boolean;
  uploading: boolean;
  error?: boolean;
  errorReason?: string;
  expanded?: boolean;
  /** pending | processing | done | failed — 업로드와 별개로 서버에서 도는 전사의 상태 */
  transcribeStatus?: string;
  /** 전사가 **어떻게** 끝났는지 (014). `done` 이어도 등급이 내려갔을 수 있다. */
  transcribeNotes?: TranscribeNotes | null;
}



export default function UploadPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const segNoRef = useRef(0);               // 지금 몇 번째 구간인가
  const segStartRef = useRef(0);            // 이 구간이 시작된 경과초
  const stoppingRef = useRef(false);        // '완료' 로 멈추는 중인가 (교체가 아니라)
  const timerRef = useRef<any>(null);
  const elapsedRef = useRef(0);
  const keySeq = useRef(0);
  const recsRef = useRef<RecItem[]>([]);   // 제출 시 최신 목록 참조(경합 방지)
  const pendingRef = useRef(0);             // 진행 중 업로드 수

  /**
   * 마지막에 고른 종류를 기억한다. **다만 `legal` 은 기억하지 않는다** —
   * 법률 상담을 한 번 하고 나면 그다음 일반 조사까지 법률로 분석되는 것이
   * 그 반대보다 나쁘다. 위험한 쪽은 매번 고르게 한다.
   */
  const [meetingKind, setMeetingKind] = useState<MeetingKind>(() => {
    try {
      const v = localStorage.getItem(KIND_PREF_KEY);
      return v === 'business' ? 'business' : 'general';
    } catch { return 'general'; }
  });
  useEffect(() => {
    meetingKindRef.current = meetingKind;
    try {
      localStorage.setItem(KIND_PREF_KEY, meetingKind === 'legal' ? 'general' : meetingKind);
    } catch { /* 사생활 모드 */ }
  }, [meetingKind]);

  const [title, setTitle] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerOptions, setCustomerOptions] = useState<{ id: string; companyName: string }[]>([]);
  const [when, setWhen] = useState(nowLocal());
  // 이 조사가 어느 수사사건의 것인가 (016). **비워 둘 수 있다** —
  // 조사가 늘 수사사건이 되지는 않는다. 첫 조사는 수사사건이 없는 채로 시작한다.
  const [matterId, setMatterId] = useState('');
  const [matters, setMatters] = useState<{ id: string; title: string; fileNo?: string | null }[]>([]);
  const [notes, setNotes] = useState('');

  // 수사사건 화면에서 「새 조사」 으로 넘어오면 그 수사사건이 이미 골라져 있다.
  const [sp] = useSearchParams();
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.getMatters('open');
        if (res.success) {
          const rows = res.data || [];
          setMatters(rows);
          const want = sp.get('matter');
          if (want && rows.some((m: any) => m.id === want)) setMatterId(want);
        }
      } catch { /* 수사사건이 없어도 녹음은 되어야 한다 */ }
    })();
  }, [sp]);

  const [recState, setRecState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [recError, setRecError] = useState('');
  const [recs, setRecs] = useState<RecItem[]>([]);
  const [preparing, setPreparing] = useState(false);

  // 실시간 위험·기회 레이더
  const [consented, setConsented] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [liveRisk, setLiveRisk] = useState<
    { level: string; reason: string; script: string; action: string; eventId?: string | null } | null>(null);
  /** 이 카드에 이미 응답했는가. 한 카드에 한 번만 받는다. */
  const [riskFeedback, setRiskFeedback] = useState<'helpful' | 'missed' | null>(null);
  const riskActiveRef = useRef(false);
  const riskGenRef = useRef(0);      // 루프 세대. 껐다 켤 때 옛 주기가 살아 돌아오는 것을 막는다
  const dangerStreakRef = useRef(0);
  const lastRiskTextRef = useRef('');
  // 25초 루프는 클로저 안에서 돈다 — state 를 그대로 읽으면 녹음 시작 시점 값에 묶인다.
  const meetingKindRef = useRef<MeetingKind>('general');

  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'form' | 'creating' | 'analyzing'>('form');
  const [progress, setProgress] = useState(0);

  // 녹음 백업 · 세션 만료
  const sessionIdRef = useRef<string>('');
  const chunkSeqRef = useRef(0);
  const [sessionLost, setSessionLost] = useState(false);
  const [recovered, setRecovered] = useState<PendingSession[]>([]);
  // 보관함 상태. **"보관된 것이 없다" 와 "열지 못했다" 를 화면에서 구분하기 위한 것이다** —
  // 모바일에는 콘솔이 없어 이게 없으면 원격으로 진단할 방법이 없다 (2026-08-20).
  const [backupInfo, setBackupInfo] =
    useState<{ ok: boolean; sessions: number; chunks: number; error?: string } | null>(null);
  /**
   * **이번 녹음이 실제로 기기에 저장되고 있는가.**
   *
   * 2026-08-20 에 83분 녹음을 잃고 보관함을 열어 보니 조각이 **0개**였다.
   * 15초마다 쌓였어야 할 것이 하나도 없었다는 뜻이다 — 안전망이 있다고 믿었을 뿐
   * 그 기기(아이폰 사파리)에서는 한 번도 돌지 않았다.
   * iOS 는 `MediaRecorder.start(timeslice)` 의 인자를 무시하고 `stop()` 때 한 번만
   * `dataavailable` 을 주는 것으로 알려져 있는데, 그러면 중간 저장이 생길 수가 없다.
   *
   * 그래서 **믿지 않고 센다.** 실제로 저장된 조각 수를 녹음 중에 그대로 보여 준다.
   * 0 이면 안전망이 없는 것이고, 그건 녹음하는 사람이 그 자리에서 알아야 하는 사실이다.
   */
  const [backedUp, setBackedUp] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.getCustomers();
        if (res.success && Array.isArray(res.data)) setCustomerOptions(res.data);
      } catch { /* ignore */ }
    })();
    // 지난번에 올라가지 못한 녹음이 있으면 알린다
    (async () => {
      await pruneOlderThan(7);
      setRecovered(await listPending());
      setBackupInfo(await inspectBackup());
    })();
    return () => clearInterval(timerRef.current);
  }, []);
  useEffect(() => { recsRef.current = recs; }, [recs]);

  const recordingActive = recState !== 'idle';

  /**
   * 녹음 중에는 **세션이 끊겨도 화면을 옮기지 않는다.**
   * 기본 동작은 `/login` 하드 이동인데, 그러면 녹음이 통째로 사라진다
   * (2026-08-10 저녁에 실제로 그렇게 잃었다). 알리기만 하고 녹음은 계속 굴린다.
   */
  useEffect(() => {
    if (!recordingActive) { apiClient.setSessionExpiredHandler(null); return; }
    apiClient.setSessionExpiredHandler(() => setSessionLost(true));
    return () => apiClient.setSessionExpiredHandler(null);
  }, [recordingActive]);

  // 녹음 중 실수로 탭을 닫아 유실되지 않도록 경고
  useEffect(() => {
    if (!recordingActive) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [recordingActive]);

  /**
   * 전사 진행 상태를 따라간다 (2026-08-11).
   *
   * 업로드 응답은 이제 저장까지만 확인해 준다 — 전사는 서버에서 따로 돈다.
   * 그래서 화면이 직접 물어보지 않으면 "전사 대기 중" 에서 영원히 멈춘 것처럼 보인다.
   * 끝나지 않은 것이 하나도 없으면 **아무것도 하지 않는다** — 다 끝난 뒤 계속 도는 폴링은
   * 서버에도 배터리에도 낭비다.
   */
  const pendingTranscribe = recs.some(
    (r) => r.id && (r.transcribeStatus === 'pending' || r.transcribeStatus === 'processing'),
  );
  useEffect(() => {
    if (!pendingTranscribe) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await apiClient.getRecordingDrafts();
        if (!alive) return;
        const byId = new Map<string, any>((res?.data || []).map((d: any) => [d.id, d]));
        setRecs((prev) => prev.map((r) => {
          const d = r.id ? byId.get(r.id) : undefined;
          return d ? { ...r, transcribeStatus: d.transcribeStatus, transcribeNotes: d.transcribeNotes ?? null } : r;
        }));
      } catch { /* 다음 차례에 다시 본다 */ }
    };
    const h = setInterval(tick, 4000);
    tick();
    return () => { alive = false; clearInterval(h); };
  }, [pendingTranscribe]);

  const startTimer = () => {
    timerRef.current = setInterval(() => setElapsed((s) => { elapsedRef.current = s + 1; return s + 1; }), 1000);
  };
  const stopTimer = () => clearInterval(timerRef.current);

  // ── 실시간 자막 ──
  //
  // 게이트웨이(Cloud Run)에 마이크 오디오를 흘려보내고 전사를 받아 그 자리에서 보여 준다.
  // **녹음과는 별개다.** 같은 스트림을 읽기만 하므로, 자막이 끊겨도 녹음은 그대로 돌아간다.
  // 최종 전사는 여전히 업로드 뒤 서버가 하는 것을 쓴다 — 이건 보는 용도다.
  //
  // 실시간 코칭과 마찬가지로 켜져 있을 때만 돈다(스트리밍 STT 도 분당 과금이다).
  // 기본은 **켬**이다 (2026-08-24).
  const CAPTION_PREF_KEY = 'sep.liveCaption';
  // **기본은 켜짐** (2026-08-24, 사용자 결정). 그전에는 꺼짐이었는데,
  // 스위치를 켜는 것을 잊고 녹음을 시작하면 자막이 안 나오고 — 실제로 그렇게 한 번 겪었다.
  // `=== 'on'` 이 아니라 `!== 'off'` 인 것이 요점이다: **일부러 끈 사람은 꺼진 채로 둔다.**
  // 저장된 값이 없다는 것은 "끄기로 정한 적이 없다" 는 뜻이지 "꺼 달라" 가 아니다.
  const [liveCaption, setLiveCaption] = useState<boolean>(() => {
    try { return !!STREAM_URL && localStorage.getItem(CAPTION_PREF_KEY) !== 'off'; } catch { return false; }
  });
  const liveCaptionRef = useRef(liveCaption);
  const captionRef = useRef<LiveTranscript | null>(null);
  const [captionLines, setCaptionLines] = useState<TranscriptLine[]>([]);
  const [captionState, setCaptionState] =
    useState<{ state: string; engine?: string; degraded?: boolean; message?: string; retry?: number }>({ state: 'closed' });

  const startCaption = () => {
    if (!STREAM_URL || captionRef.current) return;
    const stream = streamRef.current;
    const token = apiClient.getAccessToken();
    if (!stream || !token) return;
    const lt = new LiveTranscript({ onLine: setCaptionLines, onStatus: setCaptionState });
    captionRef.current = lt;
    void lt.start(stream, STREAM_URL, token);
  };
  const stopCaption = () => {
    captionRef.current?.stop();
    captionRef.current = null;
  };

  useEffect(() => {
    liveCaptionRef.current = liveCaption;
    try { localStorage.setItem(CAPTION_PREF_KEY, liveCaption ? 'on' : 'off'); } catch { /* 사생활 모드 */ }
    if (recState !== 'recording') return;
    if (liveCaption) startCaption();
    else { stopCaption(); setCaptionLines([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCaption]);

  // 화면을 떠날 때 소켓과 오디오 그래프를 반드시 닫는다. 남겨 두면 마이크가 계속 열려 있다.
  useEffect(() => () => { stopCaption(); clearSegTimers(); }, []);

  // 새 줄이 오면 끝으로 따라간다. 다만 위로 올려 지난 대목을 읽고 있으면 건드리지 않는다 —
  // 읽는 중에 화면이 튀는 것이 자막이 안 따라오는 것보다 나쁘다.
  const captionBoxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = captionBoxRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [captionLines]);

  // ── 실시간 위험·기회 레이더 (녹음 스트림에서 ~25초 클립 반복 판정) ──
  //
  // **켤 때만 돈다.** 25초마다 클립 하나를 STT(whisper-1) 에 보내고 그 결과로 판정(gpt-4o-mini)까지
  // 하므로, 한 시간 녹음이면 호출이 144번이다. 그런데 대부분의 주기는 'normal' 이라
  // 화면에 아무것도 뜨지 않는다 — 쓰지 않는 사람에게는 보이지도 않는 비용이다.
  //
  // 기본값은 **켬**이다(2026-08-24 로 뒤집혔다 — 아래 주석). 필요 없으면 한 번 끄면 기억한다.
  // 녹음 도중에도 끄고 켤 수 있다 — 껐다고 녹음이 끊기지는 않는다.
  const RISK_INTERVAL_MS = 25000;
  const RISK_PREF_KEY = 'sep.liveCoaching';
  // **기본은 켜짐** (2026-08-24, 사용자 결정). 위 주석의 "그래서 기본값을 끔으로 둔다" 를 뒤집는다.
  //
  // **비용은 그대로다** — 한 시간 녹음이면 25초마다 STT+판정이 144번 나간다.
  // 바뀐 것은 그 값을 어떻게 볼 것인가다: 켜는 것을 잊으면 그 회의는 코칭이 없고,
  // 회의는 다시 할 수 없다. 꺼 두어 아끼는 것보다 놓치는 쪽이 비싸다고 봤다.
  // 필요 없는 사람은 한 번 끄면 그대로 기억된다.
  const [liveCoaching, setLiveCoaching] = useState<boolean>(() => {
    try { return localStorage.getItem(RISK_PREF_KEY) !== 'off'; } catch { return false; }
  });
  const liveCoachingRef = useRef(liveCoaching);
  useEffect(() => {
    liveCoachingRef.current = liveCoaching;
    try { localStorage.setItem(RISK_PREF_KEY, liveCoaching ? 'on' : 'off'); } catch { /* 사생활 모드 */ }
    // 녹음 중에 끄면 즉시 멈추고, 켜면 그 자리에서 시작한다.
    // **끄면 지난 판정을 지운다 — 녹음 상태와 무관하게.**
    // 일시정지 중에 끄면 아래 줄에서 걸려 이 정리가 안 돌았다.
    // 그러면 다시 켰을 때 **몇 분 전 판정이 지금 것처럼 되살아난다.**
    if (!liveCoaching) setLiveRisk(null);
    if (recState !== 'recording') return;
    if (liveCoaching) startRiskLoop();
    else stopRiskLoop();
    // recState 는 의도적으로 뺐다 — 이 효과는 **스위치를 만졌을 때만** 돌아야 한다.
    // 넣으면 일시정지·재개 때마다 루프를 한 번 더 띄운다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCoaching]);
  const applyRisk = (data: any) => {
    if (data.transcript) lastRiskTextRef.current = data.transcript;
    // **완충은 서버가 적용한다** (015). `level` 은 이미 완충된 값이고,
    // 누적 횟수도 서버가 세어 돌려준다 — 화면은 규칙을 모른다.
    // 그전에는 여기서 위험 2연속을 셌는데, 그러면 기록되는 `level_shown` 을 서버가 알 수 없고
    // 화면이 여러 개가 되면 각자 다르게 구현된다.
    dangerStreakRef.current = Number(data.dangerStreak) || 0;
    setLiveRisk({
      level: data.level, reason: data.reason, script: data.script, action: data.action,
      eventId: data.eventId ?? null,
    });
    setRiskFeedback(null);
  };

  /**
   * 한 주기를 잡고, 끝나면 스스로 다음 주기를 건다.
   *
   * `gen` 은 **이 루프가 몇 번째로 시작된 것인지**다. 껐다 켜면 이전 주기의 `onstop` 이
   * 나중에 깨어나는데, 그때 플래그만 보면 다시 켜진 상태라 그 녀석도 다음 주기를 건다 —
   * 루프가 둘이 되고 25초마다 호출이 두 번 나간다. 일시정지·재개에도 같은 일이 일어났다.
   * 자기 세대가 아니면 조용히 끝낸다.
   */
  const captureRiskClip = (gen: number) => {
    const stream = streamRef.current;
    // 스위치를 껐으면 여기서 끝난다 — 두 번째 MediaRecorder 를 아예 만들지 않는다.
    // 만들어 두고 결과만 버리면 기기 자원은 그대로 쓰고 STT 요금도 그대로 나간다.
    if (!stream || !riskActiveRef.current || !liveCoachingRef.current) return;
    if (gen !== riskGenRef.current) return;
    let mr: MediaRecorder;
    try { mr = new MediaRecorder(stream); } catch { return; }
    const chunks: Blob[] = [];
    const alive = () => riskActiveRef.current && liveCoachingRef.current && gen === riskGenRef.current;
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mr.onstop = async () => {
      if (alive() && chunks.length > 0) {
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        try {
          const res = await apiClient.riskCheck(new File([blob], 'clip.webm', { type: blob.type }), {
            // 종류에 따라 서버가 다른 것을 묻는다 — 일반 조사에 법률 코칭을 걸지 않는다.
            kind: meetingKindRef.current,
            context: lastRiskTextRef.current,
            sessionId: sessionIdRef.current,
            atMs: elapsedRef.current * 1000,
            dangerStreak: dangerStreakRef.current,
          });
          // 응답을 기다리는 사이에 껐을 수 있다. 꺼진 뒤에 패널이 뜨면 안 된다.
          if (res.success && alive()) applyRisk(res.data);
        } catch { /* ignore */ }
      }
      if (alive()) captureRiskClip(gen);
    };
    mr.start();
    setTimeout(() => { try { mr.stop(); } catch { /* ignore */ } }, RISK_INTERVAL_MS);
  };
  /**
   * 이 판정이 도움이 됐는지 한 번 받는다. **유일한 정답표다** (015).
   *
   * 두 개뿐인 이유: 회의 중이다. 선택지가 셋 이상이면 아무도 안 누른다.
   * 실패해도 조용히 넘긴다 — 코칭을 보는 일을 방해할 이유가 없다.
   */
  const sendRiskFeedback = (v: 'helpful' | 'missed') => {
    const id = liveRisk?.eventId;
    setRiskFeedback(v);                       // 누른 것은 즉시 보여 준다
    if (!id) return;
    apiClient.coachingFeedback(id, v).catch(() => {});
  };

  const startRiskLoop = () => {
    riskActiveRef.current = true;
    dangerStreakRef.current = 0;
    riskGenRef.current += 1;          // 이전 세대는 여기서 무효가 된다
    captureRiskClip(riskGenRef.current);
  };
  const stopRiskLoop = () => { riskActiveRef.current = false; };

  // 한 조각을 목록에 추가 + 업로드/전사 (완료까지 await 가능)
  /**
   * 실패 이유를 사람이 읽을 말로 바꾼다.
   *
   * 예전에는 무엇이 잘못됐든 화면에 "전사 실패" 하나만 떴다. 실제로 흔한 것은 **시간 초과**인데,
   * 그렇게 보이면 파일이나 음질을 의심하게 된다 — 원인은 서버가 아직 응답 중이라는 것뿐이다.
   */
  const failureReason = (e: unknown): string => {
    const err = e as { code?: string; message?: string; error?: { code?: number; message?: string } };
    if (err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) return '시간 초과';
    if (err?.error?.code === 413 || /too large|payload/i.test(err?.message || '')) return '파일이 너무 큼';
    if (err?.error?.code === 401) return '로그인 만료';
    if (err?.error?.message) return err.error.message;
    if (err?.message) return '업로드 실패';
    return '실패';
  };

  /**
   * 업로드는 **한 번에 하나씩** 보낸다.
   *
   * 예전에는 조각을 한꺼번에 올렸다. 서버가 업로드 요청 안에서 전사까지 끝내는 구조라,
   * 10분짜리 하나에 실측 188초가 걸린다. 넷을 동시에 던지면 서로 밀려 전부 제한 시간을 넘겼고 —
   * 그때 서버는 이미 R2 에 파일을 써 둔 뒤라 **DB 기록 없는 고아 파일**만 남았다.
   * 파일을 여러 번 나눠 추가해도 겹치지 않도록 큐는 화면 전체에서 하나다.
   */
  const uploadQueue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = uploadQueue.current.then(fn, fn);
    uploadQueue.current = run.catch(() => undefined);
    return run;
  };

  const uploadPart = async (file: File, label: string, durationSeconds: number): Promise<boolean> => {
    const key = `k${keySeq.current++}`;
    const blobUrl = URL.createObjectURL(file);
    setRecs((prev) => [...prev, { key, label, durationSeconds, blobUrl, selected: true, uploading: true }]);
    pendingRef.current += 1;
    try {
      const res = await enqueue(() => apiClient.uploadRecording(file, label, durationSeconds));
      const d = res.data;
      setRecs((prev) => prev.map((r) => r.key === key
        ? { ...r, id: d.id, label: d.label || label, transcriptPreview: d.transcriptPreview,
            durationSeconds: d.durationSeconds || durationSeconds, uploading: false,
            transcribeStatus: d.transcribeStatus || 'pending',
            transcribeNotes: d.transcribeNotes ?? null }
        : r));
      return true;
    } catch (e) {
      const reason = failureReason(e);
      setRecs((prev) => prev.map((r) => r.key === key
        ? { ...r, uploading: false, error: true, errorReason: reason } : r));
      return false;
    } finally {
      pendingRef.current -= 1;
    }
  };

  // 녹음/파일을 목록에 추가: 한도 이하는 원본 그대로(품질 보존), 아주 긴 경우만 청크
  const addRecordingFile = async (srcFile: File, fallbackDuration: number, sessionId?: string) => {
    setPreparing(true);
    let parts;
    try {
      parts = await prepareRecordings(srcFile);
    } catch {
      parts = [{ file: srcFile, durationSeconds: fallbackDuration }];
    }
    setPreparing(false);
    const multi = parts.length > 1;
    const results = await Promise.allSettled(parts.map((p, i) =>
      uploadPart(p.file, multi ? `파트 ${i + 1}/${parts.length}` : '녹음', p.durationSeconds || fallbackDuration)
    ));
    // **전부 올라간 것을 확인한 뒤에만** 백업을 지운다. 하나라도 실패하면 남겨서 복구할 수 있게 한다.
    if (sessionId && results.every((r) => r.status === 'fulfilled' && r.value)) {
      await clearSession(sessionId);
      setRecovered(await listPending());
    }
  };

  /** 복구 대상 녹음을 다시 올린다. 성공하면 백업에서 사라진다. */
  const recoverSession = async (s: PendingSession) => {
    setRecovered((prev) => prev.filter((x) => x.session_id !== s.session_id));
    await addRecordingFile(toFile(s), 0, s.session_id);
    setRecovered(await listPending());
  };
  /**
   * 보관된 녹음을 디스크로 뺀다. **올리기와 다른 경로다** — 변환(`prepareRecordings`)을 타지 않는다.
   *
   * 2026-08-20 에 83분 녹음이 통째로 사라진 자리가 그 변환이었다. 긴 녹음일수록
   * 올리기가 위험한데, 하필 긴 녹음일수록 잃으면 곤란하다. 그래서 **먼저 꺼내 두는 길**을 둔다.
   */
  // 큰 파일은 조각을 이어 붙이는 데 몇 초 걸린다. 그 사이 아무 반응이 없으면
  // 눌리지 않은 줄 알고 또 누른다 — 그러면 같은 일을 두 번 한다.
  const [savingId, setSavingId] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const saveSessionToDisk = async (s: PendingSession) => {
    setSavingId(s.session_id);
    setSavedMsg('');
    try {
      const how = await saveSession(s);
      if (how === 'shared') setSavedMsg('내보냈습니다. "파일에 저장" 을 골랐다면 파일 앱에 있습니다.');
      else if (how === 'downloaded') setSavedMsg('내려받았습니다 — 다운로드 폴더를 확인하세요.');
    } catch {
      setRecError('파일을 꺼내지 못했습니다. 브라우저의 다운로드·공유 차단 설정을 확인해 주세요.');
    } finally {
      setSavingId('');
    }
  };

  // 버리면 되돌릴 수 없다. 서버에도 없는 유일본이므로 한 번 더 묻는다.
  const [discardTarget, setDiscardTarget] = useState<PendingSession | null>(null);
  const discardSession = async (s: PendingSession) => {
    setDiscardTarget(null);
    await clearSession(s.session_id);
    setRecovered(await listPending());
  };

  // 녹음 시작 (동의 게이트)
  const startRecording = () => {
    setRecError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecError('이 환경에서는 녹음을 사용할 수 없습니다. HTTPS(보안 연결)가 필요합니다. "파일 추가"를 이용하세요.');
      return;
    }
    if (!consented) { setConsentOpen(true); return; }
    doStartRecording();
  };
  // 조각이 이 간격으로 떨어져 나오고, 그때마다 IndexedDB 에 쌓인다.
  // **iOS 는 이 인자를 무시한다** — 2026-08-20 에 83분을 잃고 확인했다(보관함 조각 0개).
  // 그래서 이것만 믿지 않고 아래의 구간 녹음으로 실제 보관을 서버에 맡긴다.
  const BACKUP_SLICE_MS = 15000;

  /**
   * **구간 녹음 (2026-08-20).**
   *
   * 예전에는 회의 내내 MediaRecorder 하나로 받아 두고, `완료` 를 누른 뒤에야
   * 통째로 변환(`prepareRecordings`)해서 올렸다. 그 구조가 83분짜리를 통째로 잃었다.
   *
   *   · 변환이 파일 전체를 `decodeAudioData` 로 편다 → 83분이면 약 1.9GB → 탭이 죽는다
   *   · 죽으면 그때까지의 회의가 **전부** 사라진다. 서버에는 아무것도 없다
   *   · 안전망이라 믿었던 IndexedDB 백업은 iOS 에서 애초에 돌지 않았다
   *
   * 이제 **10분마다 갈아탄다.** 각 구간은 그 자체로 완결된 파일이라 변환 없이 그대로 올라간다.
   *   · 큰 디코딩이 없다 — 메모리가 길이에 비례하지 않는다
   *   · 회의 **도중에** 서버에 쌓인다. 최악의 경우 잃는 것은 마지막 구간뿐이다
   *   · 10분은 임의값이 아니다. 기존 분할과 같은 값이고 STT 입력 한도(1400초)의 절반 이하다
   *
   * 같은 스트림에 MediaRecorder 를 반복해서 새로 만드는 것이 아이폰에서 되는지는
   * **이미 확인됐다** — 실시간 코칭이 25초마다 정확히 그 일을 하고 그날 83분 동안 돌았다.
   */
  const SEGMENT_MS = 10 * 60 * 1000;

  /**
   * **구간을 겹쳐 녹음한다** (2026-08-25).
   *
   * 구간마다 STT 가 화자 A·B·C 를 새로 매기므로 파트1 의 A 와 파트5 의 A 는 아무 관계가 없다.
   * 겹치게 두면 **같은 발화가 앞 구간 끝과 뒤 구간 앞에 함께 나오고**, 글자가 그대로
   * 일치하므로 서버가 `P1:B → P2:A` 를 **추론이 아니라 대조로** 정할 수 있다.
   *
   * 대안이던 앵커 클립은 오디오를 잘라야 하는데 구간이 mp4·webm 이라 Worker 에 디코더가 없다.
   * 겹침은 형식과 무관하고, 구간이 올라가는 대로 병렬 전사하는 성질도 그대로 둔다.
   *
   * 대가는 경계마다 15초가 두 번 올라가는 것(약 2.5%)이고, 그 중복은 **서버가 지운다** —
   * 클라이언트가 지우면 무엇을 지웠는지 서버가 알 수 없다.
   *
   * 겹치는 동안 레코더가 **둘** 돈다. 같은 스트림에 동시에 두는 것은
   * 실시간 코칭이 이미 하던 일이고(25초마다 두 번째 레코더), 아이폰에서 83분 돌았다.
   */
  const OVERLAP_MS = 15 * 1000;

  /** 지금 살아 있는 레코더들. 겹치는 동안 둘이 된다 — 멈추고 재개할 때 전부 다뤄야 한다. */
  const liveRecordersRef = useRef<Set<MediaRecorder>>(new Set());
  /** 구간마다 걸어 둔 타이머. 끝낼 때 전부 걷는다. */
  const segTimersRef = useRef<Set<any>>(new Set());

  const clearSegTimers = () => {
    for (const t of segTimersRef.current) clearTimeout(t);
    segTimersRef.current.clear();
  };
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => { segTimersRef.current.delete(t); fn(); }, ms);
    segTimersRef.current.add(t);
    return t;
  };

  /** 구간 하나를 올린다. **변환을 거치지 않는다** — 10분 이하라 자를 필요가 없다. */
  const uploadSegment = async (file: File, segNo: number, dur: number, sessionId: string) => {
    const ok = await uploadPart(file, `구간 ${segNo}`, dur);
    // 올라간 것을 확인한 뒤에만 그 구간의 백업을 지운다.
    if (ok) await clearSession(sessionId);
    setRecovered(await listPending());
  };

  const startSegment = (stream: MediaStream) => {
    const segNo = ++segNoRef.current;
    const startedAt = elapsedRef.current;
    const sessionId = `${sessionIdRef.current}-s${segNo}`;
    const parts: Blob[] = [];
    let seq = 0;

    const mr = new MediaRecorder(stream);
    liveRecordersRef.current.add(mr);

    mr.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      parts.push(e.data);
      // 업로드 **전에** 남긴다. 여기서 실패해도 녹음은 계속된다.
      void backupChunk(sessionId, seq++, e.data, mr.mimeType || 'audio/webm')
        .then((okd) => { if (okd) setBackedUp((n) => n + 1); });
    };
    mr.onstop = () => {
      liveRecordersRef.current.delete(mr);
      const type = mr.mimeType || 'audio/webm';
      const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'mp4' : 'webm';
      const dur = Math.max(1, elapsedRef.current - startedAt);
      if (parts.length) {
        void uploadSegment(new File(parts, `seg-${segNo}.${ext}`, { type }), segNo, dur, sessionId);
      }
      // **마지막 레코더가 멈췄을 때만** 녹음이 끝난 것이다. 겹치는 동안은 둘이 살아 있다.
      if (stoppingRef.current && liveRecordersRef.current.size === 0) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        setRecState('idle');
        setElapsed(0);
      }
    };

    mediaRef.current = mr;          // 화면이 보는 "지금 구간" 은 항상 가장 새 것
    mr.start(BACKUP_SLICE_MS);

    // ① 겹침이 시작되는 시점에 **다음 구간을 연다.** 이 레코더는 아직 돌고 있다.
    const openNext = () => {
      if (stoppingRef.current) return;
      // 일시정지 중이면 겹침을 시작하지 않는다 — 멈춰 있어야 할 자리에서 새 구간이 녹음한다.
      if (mr.state === 'paused') { later(openNext, 5000); return; }
      if (mr.state === 'inactive') return;      // 이미 끝났으면 다음은 없다
      startSegment(stream);
    };
    later(openNext, Math.max(1000, SEGMENT_MS - OVERLAP_MS));

    // ② 자기 시간이 다 차면 **스스로** 멈춘다. 다음 구간은 이미 15초째 돌고 있다.
    const closeSelf = () => {
      if (mr.state === 'inactive') return;
      if (mr.state === 'paused') { later(closeSelf, 5000); return; }
      try { mr.stop(); } catch { /* 이미 멈췄다 */ }
    };
    later(closeSelf, SEGMENT_MS);
  };

  const doStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      sessionIdRef.current = newSessionId();
      chunkSeqRef.current = 0;
      segNoRef.current = 0;
      stoppingRef.current = false;
      liveRecordersRef.current.clear();
      clearSegTimers();
      elapsedRef.current = 0;
      setBackedUp(0);
      setElapsed(0);
      setRecState('recording');
      startTimer();
      startSegment(stream);
      if (liveCoachingRef.current) startRiskLoop();   // 켠 사람에게만 돈다
      if (liveCaptionRef.current) startCaption();
    } catch (err: any) {
      setRecError('마이크 접근이 거부되었거나 사용할 수 없습니다: ' + (err?.message || ''));
    }
  };
  const pauseRecording = () => {
    // **살아 있는 레코더를 전부 멈춘다.** 겹치는 동안은 둘이다.
    for (const r of liveRecordersRef.current) { try { r.pause(); } catch { /* ignore */ } }
    stopTimer(); stopRiskLoop();
    // 자막도 함께 멈춘다 — 일시정지 중에도 소켓을 열어 두면 침묵에 요금이 나간다.
    stopCaption();
    setRecState('paused');
  };
  const resumeRecording = () => {
    for (const r of liveRecordersRef.current) { try { r.resume(); } catch { /* ignore */ } }
    startTimer();
    if (liveCoachingRef.current) startRiskLoop();
    if (liveCaptionRef.current) startCaption();
    setRecState('recording');
  };
  const finishRecording = () => {
    stoppingRef.current = true;            // 이 stop 은 교체가 아니라 끝이다
    clearSegTimers();
    stopTimer(); stopRiskLoop(); setLiveRisk(null);
    stopCaption();
    // 겹치는 중이면 둘 다 멈춰야 한다. 하나만 멈추면 나머지가 계속 녹음한다.
    for (const r of [...liveRecordersRef.current]) { try { r.stop(); } catch { /* 이미 멈췄다 */ } }
  };

  const toggleSelect = (key: string) => {
    setRecs((prev) => prev.map((r) => r.key === key ? { ...r, selected: !r.selected } : r));
    const rec = recs.find((r) => r.key === key);
    if (rec?.id) apiClient.updateRecording(rec.id, { selected: !rec.selected }).catch(() => {});
  };
  const editLabel = (key: string, label: string) => {
    setRecs((prev) => prev.map((r) => r.key === key ? { ...r, label } : r));
  };
  const saveLabel = (key: string) => {
    const rec = recs.find((r) => r.key === key);
    if (rec?.id) apiClient.updateRecording(rec.id, { label: rec.label }).catch(() => {});
  };
  const removeRec = (key: string) => {
    const rec = recs.find((r) => r.key === key);
    setRecs((prev) => prev.filter((r) => r.key !== key));
    if (rec?.id) apiClient.deleteRecording(rec.id).catch(() => {});
  };
  const toggleExpand = (key: string) => {
    setRecs((prev) => prev.map((r) => r.key === key ? { ...r, expanded: !r.expanded } : r));
  };

  const resolveCustomerId = async (): Promise<string> => {
    const existing = customerOptions.find(
      (c) => c.companyName.trim().toLowerCase() === customerName.trim().toLowerCase());
    if (existing) return existing.id;
    const res = await apiClient.createCustomer({ companyName: customerName.trim() });
    return res.data.id;
  };

  const pollAnalysis = async (meetingId: string) => {
    setPhase('analyzing');
    for (let i = 0; i < 60; i++) {
      try {
        const res = await apiClient.getAnalysis(meetingId);
        const p = res?.data?.progress;
        if (typeof p === 'number') setProgress(Math.round(p));
        if (res?.data?.scores || res?.data?.summary) { navigate(`/meetings/${meetingId}`); return; }
      } catch { /* keep polling */ }
      await new Promise((r) => setTimeout(r, 3000));
    }
    navigate(`/meetings/${meetingId}`);
  };

  const handleSubmit = async () => {
    setError('');
    try {
      setPhase('creating');
      // 진행 중 업로드가 끝날 때까지 대기(녹음 미첨부 방지)
      let guard = 0;
      while (pendingRef.current > 0 && guard < 300) { await new Promise((r) => setTimeout(r, 200)); guard++; }

      // 최신 목록(ref)에서 선택된 녹음 ID 수집
      const list = recsRef.current;
      const selectedIds = list.filter((r) => r.selected && r.id).map((r) => r.id!) as string[];
      /*
       * 붙일 녹음이 하나도 없으면 **중단한다.**
       *
       * 예전 조건은 `list.length > 0 && selectedIds.length === 0` 이었다 —
       * 목록이 **비어 있으면 그냥 통과했다.** 2026-08-20 에 83분 녹음이 브라우저에서
       * 사라진 뒤 그 상태로 제출됐고, 서버는 제목·메모만으로 분석해
       * `overall 70` 을 찍고 `analysis_status=completed` 로 남겼다.
       * 실패로 보이지 않고 **정상 기록처럼 보이는 것**이 가장 나빴다.
       */
      if (selectedIds.length === 0) {
        // 무엇이 왜 막혔는지 숫자로 말한다. "완료되지 않았습니다" 만으로는 기다릴지 다시 할지 알 수 없다.
        const failed = list.filter((r) => r.error).length;
        const busyCount = list.filter((r) => r.uploading).length;
        setError(
          failed > 0
            ? `녹음 ${failed}개가 올라가지 못했습니다. 실패한 항목을 지우고 다시 추가해 주세요. `
              + '긴 파일은 한 번에 하나씩 올라가므로 시간이 걸립니다.'
            : busyCount > 0
              ? `녹음 ${busyCount}개가 아직 처리 중입니다. 끝나면 버튼이 활성화됩니다.`
              : '분석할 녹음이 없습니다. 녹음을 추가하거나 파일을 올린 뒤에 만들어 주세요 — '
                + '녹음 없이 만들면 제목만 보고 분석해 근거 없는 점수가 남습니다.',
        );
        setPhase('form');
        return;
      }

      const customerId = await resolveCustomerId();
      const startTime = new Date(when).toISOString();
      const meetingRes = await apiClient.createMeeting({
        customerId, title: title.trim(), startTime, endTime: startTime,
        notes: notes.trim() || undefined, autoAnalyze: false,
        // 분석이 무엇을 할지 정하는 값이다 (016).
        kind: meetingKind,
        // 붙여 두면 요건·시계열·증거가 이 수사사건에 쌓인다 (018). 비면 조사 단위로만 남는다.
        matterId: matterId || undefined,
      });
      const meetingId = meetingRes.data.id;
      // 녹음 중에 쌓인 코칭 판정을 이 조사에 붙인다 (015).
      await apiClient.analyzeMeeting(meetingId, selectedIds, sessionIdRef.current);
      await pollAnalysis(meetingId);
    } catch (err: any) {
      setError(err?.error?.message || '생성/분석에 실패했습니다.');
      setPhase('form');
    }
  };

  // 서버에 실제로 들어간 구간 수. **이것이 진짜 안전망이다** — 기기 백업은 iOS 에서 돌지 않는다.
  const savedSegments = recs.filter((r) => r.id && !r.error).length;
  const busy = phase !== 'form';
  const anyUploading = recs.some((r) => r.uploading);
  const selectedCount = recs.filter((r) => r.selected).length;
  const canSubmit = !busy && !recordingActive && !anyUploading && !preparing && !!title.trim() && !!customerName.trim();
  const phaseText = phase === 'creating' ? '조사 생성 중…' : phase === 'analyzing' ? `분석 중… ${progress}%` : '';

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>새 조사</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        녹음을 여러 번 추가할 수 있고, 분석에 사용할 녹음을 선택합니다. 녹음하면서 아래 정보도 입력하세요.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* 녹음 중에 세션이 끊겼다. 화면을 옮기면 녹음이 사라지므로 알리기만 한다. */}
      {sessionLost && (
        <Alert severity="warning" sx={{ mb: 2 }}
          action={!recordingActive && (
            <Button color="inherit" size="small" onClick={() => apiClient.logout()}>다시 로그인</Button>
          )}>
          <strong>로그인이 풀렸습니다.</strong>{' '}
          {recordingActive
            ? '녹음은 계속되고 있고 이 기기에 저장되고 있습니다. 녹음을 끝낸 뒤 다시 로그인하면 그대로 올릴 수 있습니다.'
            : '다시 로그인한 뒤 아래 녹음을 올려주세요.'}
        </Alert>
      )}

      {/*
        보관된 것이 없을 때도 **한 줄은 말한다.**
        아무것도 그리지 않으면 "없다" 와 "확인이 아직 안 됐다" 와 "열지 못했다" 가 똑같아 보인다.
        아이폰 사파리에서 배너가 안 보인다는 신고를 받고도 그중 무엇인지 알 수 없었다 (2026-08-20).
      */}
      {recovered.length === 0 && backupInfo && (
        <Alert severity={backupInfo.ok ? 'success' : 'warning'} sx={{ mb: 2 }}>
          <Typography variant="caption">
            {backupInfo.ok
              ? `이 기기의 녹음 보관함: 올라가지 못한 녹음 없음 (조각 ${backupInfo.chunks}개)`
              : `이 기기의 녹음 보관함을 열지 못했습니다 — ${backupInfo.error}`}
          </Typography>
        </Alert>
      )}

      {/*
        서버에는 있는데 조사에 안 붙은 녹음(draft)은 여기서 보여 주지 않는다 (2.18.0) —
        사용자 화면에는 소음이라 관리자 화면(/admin/recordings)으로 옮겼다.
        아래 복구 배너(IndexedDB)는 다른 것이다: 저쪽은 **서버에 못 올라간 것**이다.
      */}

      {/* 지난번에 올라가지 못한 녹음 */}
      {recovered.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={700} gutterBottom>
            올라가지 못한 녹음이 {recovered.length}건 있습니다
          </Typography>
          {/*
            이 녹음은 **이 브라우저에만** 있다. 서버에도 다른 기기에도 사본이 없고,
            사이트 데이터를 지우면 함께 사라진다. 그래서 올리기보다 내려받기를 먼저 권한다 —
            올리기는 변환 단계를 거치는데 긴 녹음은 거기서 죽는다 (2026-08-20).
          */}
          <Typography variant="caption" color="text.secondary">
            이 녹음은 이 브라우저에만 있습니다. 긴 녹음이라면 <strong>먼저 파일로 꺼내</strong> 두세요.
          </Typography>
          {savedMsg && (
            <Typography variant="caption" color="success.main" display="block" mt={0.5}>
              {savedMsg}
            </Typography>
          )}
          <Stack spacing={1} mt={1}>
            {recovered.map((s) => (
              <Stack key={s.session_id} direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Typography variant="body2" sx={{ flex: 1, minWidth: { xs: 0, sm: 160 } }}>
                  {new Date(s.started_at).toLocaleString()} · {(s.bytes / 1024 / 1024).toFixed(1)}MB
                </Typography>
                <Button size="small" variant="contained" disabled={!!savingId}
                  onClick={() => void saveSessionToDisk(s)}>
                  {savingId === s.session_id ? '꺼내는 중…' : '파일로 꺼내기'}
                </Button>
                <Button size="small" variant="outlined" onClick={() => recoverSession(s)} disabled={busy || preparing}>
                  올리기
                </Button>
                <Button size="small" color="inherit" onClick={() => setDiscardTarget(s)} disabled={busy || preparing}>
                  버리기
                </Button>
              </Stack>
            ))}
          </Stack>
        </Alert>
      )}

      {/* 1) 녹음 — 최상단 */}
      <Card sx={{ mb: 3, border: '2px solid', borderColor: recState === 'recording' ? 'error.main' : 'primary.light' }}>
        <CardContent sx={{ py: 3 }}>
          <Typography variant="subtitle1" fontWeight={700} textAlign="center" mb={2}>🎙️ 조사 녹음</Typography>

          {/*
            **녹음을 누르기 전에 종류가 정해져야 한다** — 실시간 코칭이 종류에 따라
            다른 것을 말하기 때문이다. 녹음 중에는 바꾸지 못하게 잠근다:
            중간에 바꾸면 앞뒤 코칭이 다른 기준으로 나와 기록이 섞인다.
          */}
          <Box sx={{ mb: 2.5 }}>
            <Typography variant="caption" color="text.secondary" display="block" mb={0.75}>
              이 조사은 어떤 자리입니까
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {MEETING_KINDS.map((k) => (
                <Button key={k.kind} size="small"
                  variant={meetingKind === k.kind ? 'contained' : 'outlined'}
                  color={k.kind === 'legal' ? 'secondary' : 'primary'}
                  disabled={recordingActive || busy}
                  onClick={() => setMeetingKind(k.kind)}>
                  {k.label}
                </Button>
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" mt={0.75}>
              {MEETING_KINDS.find((k) => k.kind === meetingKind)?.hint}
              {recordingActive && ' · 녹음 중에는 바꿀 수 없습니다'}
            </Typography>
          </Box>

          <input ref={fileRef} type="file" accept="audio/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) addRecordingFile(f, 0); e.currentTarget.value=''; }} />

          <Box textAlign="center">
            {recState === 'idle' && (
              <Stack spacing={1} alignItems="center">
                <Stack direction="row" spacing={1.5}>
                  <Button variant="contained" color="error" size="large" onClick={startRecording} disabled={busy}
                    sx={{ borderRadius: 8, px: 4, py: 1.3 }}>● 녹음 추가</Button>
                  <Button variant="outlined" onClick={() => fileRef.current?.click()} disabled={busy}>📁 파일 추가</Button>
                </Stack>
                {/* 녹음을 시작하기 **전에** 보여야 고를 수 있다. 시작한 뒤에 알려주면 이미 돌고 있다. */}
                <Stack alignItems="flex-start">
                  <FormControlLabel
                    control={<Switch size="small" checked={liveCoaching}
                      onChange={(e) => setLiveCoaching(e.target.checked)} disabled={busy} />}
                    label={
                      <Typography variant="caption" color="text.secondary">
                        실시간 코칭 — 녹음 중 위험·기회를 25초마다 짚어 줍니다
                      </Typography>
                    }
                    sx={{ mr: 0 }}
                  />
                  {STREAM_URL && (
                    <FormControlLabel
                      control={<Switch size="small" checked={liveCaption}
                        onChange={(e) => setLiveCaption(e.target.checked)} disabled={busy} />}
                      label={
                        <Typography variant="caption" color="text.secondary">
                          실시간 자막 — 말하는 대로 화면에 옮겨 줍니다
                        </Typography>
                      }
                      sx={{ mr: 0 }}
                    />
                  )}
                </Stack>
              </Stack>
            )}
            {(recState === 'recording' || recState === 'paused') && (
              <Stack spacing={1.5} alignItems="center">
                <Typography variant="h3" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  color: recState === 'recording' ? 'error.main' : 'text.secondary' }}>
                  {recState === 'recording' ? '● ' : '❚❚ '}{fmt(elapsed)}
                </Typography>
                <Stack direction="row" spacing={1.5}>
                  {recState === 'recording'
                    ? <Button variant="outlined" onClick={pauseRecording}>❚❚ 일시정지</Button>
                    : <Button variant="contained" color="error" onClick={resumeRecording}>● 이어서</Button>}
                  <Button variant="contained" onClick={finishRecording}>■ 완료</Button>
                </Stack>
                {/*
                  안전망이 실제로 도는지 그 자리에서 보여 준다. 45초가 지나도 0 이면
                  이 기기에서는 중간 저장이 일어나지 않는 것이고, **그건 녹음이 끝날 때까지
                  화면을 벗어나면 통째로 잃는다는 뜻이다.** 끝나고 알면 늦다 (2026-08-20).
                */}
                {savedSegments > 0 ? (
                  <Typography variant="caption" color="success.main" textAlign="center">
                    서버에 {savedSegments}구간 저장됨 — 여기까지는 안전합니다
                    <br />다음 구간 저장까지 {fmt(600 - (elapsed % 600))}
                  </Typography>
                ) : backedUp > 0 ? (
                  <Typography variant="caption" color="text.secondary" textAlign="center">
                    이 기기에 {backedUp}조각 저장됨 · 첫 구간은 10:00 에 서버로 올라갑니다
                  </Typography>
                ) : elapsed >= 45 ? (
                  <Alert severity="warning" sx={{ py: 0.25 }}>
                    <Typography variant="caption">
                      <strong>아직 서버에 저장된 것이 없습니다.</strong> 첫 구간은 10분에 올라갑니다.
                      그때까지는 이 화면을 벗어나거나 다른 앱으로 넘어가지 마세요.
                    </Typography>
                  </Alert>
                ) : null}
                {/* 녹음 도중에도 끌 수 있다 — 길어지는 조사에서 중간에 그만두고 싶을 때가 있다 */}
                <Stack alignItems="flex-start">
                  <FormControlLabel
                    control={<Switch size="small" checked={liveCoaching}
                      onChange={(e) => setLiveCoaching(e.target.checked)} />}
                    label={
                      <Typography variant="caption" color="text.secondary">
                        {liveCoaching
                          ? '실시간 코칭 켜짐 — 25초마다 대화 일부를 전사·판정합니다'
                          : '실시간 코칭 꺼짐 — 녹음만 합니다'}
                      </Typography>
                    }
                    sx={{ mr: 0 }}
                  />
                  {STREAM_URL && (
                    <FormControlLabel
                      control={<Switch size="small" checked={liveCaption}
                        onChange={(e) => setLiveCaption(e.target.checked)} />}
                      label={
                        <Typography variant="caption" color="text.secondary">
                          실시간 자막 {liveCaption ? '켜짐' : '꺼짐'}
                        </Typography>
                      }
                      sx={{ mr: 0 }}
                    />
                  )}
                </Stack>
                <Typography variant="caption" color="text.secondary">일시정지하고 정보를 입력해도 됩니다</Typography>
              </Stack>
            )}
          </Box>

          {/*
            ── 녹음 버튼 **바로 아래** ── (2026-08-26 배치 변경)

            전에는 이 둘이 녹음 카드 **밖**, 녹음 목록 다음에 있었다.
            녹음 목록은 **10분마다 한 줄씩 늘어난다** — 한 시간짜리 조사이면 여섯 줄이다.
            그만큼 코칭과 자막이 아래로 밀려 **정작 조사 중에 화면 밖으로 나갔다.**

            버튼 바로 아래로 올리면 목록이 아무리 길어져도 이 둘의 자리는 그대로다.
            순서는 **코칭 → 자막**: 코칭은 몇 줄로 끝나고, 자막은 계속 흐르므로 아래가 맞다.
          */}
          {/* 실시간 위험·기회 레이더 (녹음 중 · **코칭을 켠 경우에만**)
              `liveCoaching` 조건이 빠져 있어서 **스위치를 꺼도 카드가 떴다** (2026-08-26).
              꺼진 기능의 화면이 남아 있으면 사용자는 그것이 도는 줄 안다 —
              실제로는 판정이 갱신되지 않으므로 **첫 화면에서 멈춘 채 거짓을 보여 준다.**
              바로 아래 자막은 `liveCaption &&` 이 걸려 있어 제대로 사라졌다. 같은 모양으로 맞춘다. */}
          {liveCoaching && (recState === 'recording' || recState === 'paused') && (() => {
            const ui = RISK_UI[liveRisk?.level || 'normal'];
            const active = liveRisk && liveRisk.level !== 'normal';
            // 코칭도 근거 문장이 붙으면 길어진다. 자막과 같은 이유로 안에서만 스크롤한다.
            return (
              <Card sx={{
                mb: 2, bgcolor: ui.bg, border: `2px solid ${ui.border}`,
                maxHeight: { xs: 'min(38dvh, 260px)', sm: 340 }, overflowY: 'auto',
                overscrollBehavior: 'contain',
              }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: active ? 1 : 0 }}>
                    <Typography sx={{ fontWeight: 700, color: ui.color }}>{ui.emoji} {ui.label}</Typography>
                    <Typography variant="caption" color="text.secondary">· 실시간 코칭 (약 25초마다 갱신)</Typography>
                  </Box>
                  {active ? (
                    <Stack spacing={0.8}>
                      {liveRisk!.reason && <Typography variant="body2" sx={{ color: ui.color }}>{liveRisk!.reason}</Typography>}
                      {liveRisk!.script && (
                        <Box sx={{ bgcolor: '#fff', border: '1px solid #E5E7EB', borderRadius: 1, p: 1 }}>
                          <Typography variant="body2"><b>💬 이렇게 말해보세요:</b> {liveRisk!.script}</Typography>
                        </Box>
                      )}
                      {liveRisk!.action && <Typography variant="body2">👉 {liveRisk!.action}</Typography>}
                      {/*
                        이 판정이 맞았는지 **사람만 알 수 있다.** 이것이 없으면 임계값 보정도
                        개인화도 영원히 불가능하다 — 무엇이 맞았는지 알 방법이 없으니 (015).
                        두 개뿐인 이유: 회의 중이라 선택지가 셋 이상이면 아무도 안 누른다.
                      */}
                      {liveRisk!.eventId && (
                        <Stack direction="row" spacing={1} alignItems="center" pt={0.5}>
                          {riskFeedback ? (
                            <Typography variant="caption" color="text.secondary">
                              {riskFeedback === 'helpful' ? '도움됐다고 표시했습니다' : '빗나갔다고 표시했습니다'}
                              {' '}— 코칭을 다듬는 데 씁니다
                            </Typography>
                          ) : (
                            <>
                              <Button size="small" variant="outlined" sx={{ minWidth: 0 }}
                                onClick={() => sendRiskFeedback('helpful')}>도움됐어요</Button>
                              <Button size="small" color="inherit" sx={{ minWidth: 0 }}
                                onClick={() => sendRiskFeedback('missed')}>빗나갔어요</Button>
                            </>
                          )}
                        </Stack>
                      )}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">대화를 듣고 있어요… 특이 신호가 감지되면 알려드립니다.</Typography>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* 실시간 자막 (녹음 중, 켠 경우)
              제일 아래 줄이 지금 말하는 것이라 **새 줄이 오면 끝으로 스크롤**한다.
              위로 올려 지난 대목을 보고 있으면 방해하지 않는다. */}
          {liveCaption && (recState === 'recording' || recState === 'paused') && (
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent sx={{ py: 1.5 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>실시간 자막</Typography>
                  <Typography variant="caption" color={captionState.state === 'error' ? 'error' : 'text.secondary'}>
                    {captionState.state === 'connecting'
                  ? (captionState.retry
                      // **다시 붙는 중이라고 말한다.** 「연결 중…」 만 뜨면 처음 붙는 것과
                      // 끊겼다 붙는 것이 구별되지 않아, 사용자는 자막이 멀쩡한 줄 안다.
                      ? `연결이 끊겨 다시 붙는 중… (${captionState.retry}/6) · 녹음은 계속됩니다`
                      : '연결 중…')
                      : captionState.state === 'live'
                        ? `연결됨${captionState.degraded ? ' (백업 엔진)' : ''}`
                        : captionState.state === 'error' ? (captionState.message || '오류')
                          : '끊김'}
                  </Typography>
                </Stack>
                {/*
                  **자기 안에서만 스크롤한다.** 자막은 말하는 동안 끝없이 늘어나므로,
                  높이를 묶어 두지 않으면 아래 있는 조사 정보·제출 버튼이 화면 밖으로 밀린다 —
                  조사 중에 「업로드 및 분석 시작」 을 찾으러 한참 스크롤해야 한다.

                  폰에서는 더 낮게 잡는다. 화면이 짧아 180px 도 화면의 3분의 1을 먹는다.
                  `dvh` 를 쓰는 이유는 **주소창이 접혔다 펴져도** 비율이 유지되게 하려는 것이다.
                */}
                <Box ref={captionBoxRef} sx={{
                  maxHeight: { xs: 'min(30dvh, 132px)', sm: 180 },
                  overflowY: 'auto', overscrollBehavior: 'contain',
                  bgcolor: 'grey.50', borderRadius: 1, px: 1.5, py: 1,
                }}>
                  {captionLines.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {captionState.state === 'live' ? '말씀하시면 여기에 나타납니다.' : '연결을 기다리는 중입니다.'}
                    </Typography>
                  ) : captionLines.map((l) => (
                    <Typography key={l.id} variant="body2"
                      sx={{ opacity: l.interim ? 0.55 : 1, fontStyle: l.interim ? 'italic' : 'normal', mb: 0.3 }}>
                      {l.speaker != null && (
                        <Box component="span" sx={{ color: 'primary.main', fontWeight: 700, mr: 0.7 }}>
                          화자 {l.speaker + 1}
                        </Box>
                      )}
                      {l.text}
                    </Typography>
                  ))}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  보기용입니다. 저장되는 전사는 녹음이 끝난 뒤 서버가 다시 만듭니다.
                </Typography>
              </CardContent>
            </Card>
          )}

          {recError && <Alert severity="warning" sx={{ mt: 2 }}>{recError}</Alert>}
          {preparing && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">오디오 처리 중(변환·분할)…</Typography>
              <LinearProgress sx={{ mt: 0.5 }} />
            </Box>
          )}

          {/* 녹음 목록 */}
          {recs.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Divider sx={{ mb: 1 }} />
              <Typography variant="caption" color="text.secondary">
                {/* 회의 중에는 이 목록이 곧 진행 상황이다 — 구간이 하나씩 올라가고 그 자리에서 전사된다 */}
                {recordingActive
                  ? `회의 중 저장·전사 · ${savedSegments}구간 완료 (전사는 구간별로 바로 시작합니다)`
                  : `녹음 목록 · 선택 ${selectedCount}/${recs.length} (선택된 녹음만 분석)`}
              </Typography>
              <Stack sx={{ mt: 1 }} divider={<Divider />}>
                {recs.map((r) => (
                  <Box key={r.key} sx={{ py: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Checkbox size="small" checked={r.selected} onChange={() => toggleSelect(r.key)} sx={{ p: 0.5 }} />
                      <TextField variant="standard" value={r.label} onChange={(e) => editLabel(r.key, e.target.value)}
                        onBlur={() => saveLabel(r.key)} sx={{ flex: 1 }} InputProps={{ disableUnderline: false }} />
                      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                        {r.durationSeconds ? fmt(r.durationSeconds) : ''}
                      </Typography>
                      <IconButton size="small" onClick={() => removeRec(r.key)}><DeleteIcon fontSize="small" /></IconButton>
                    </Box>
                    <Box sx={{ pl: 4 }}>
                      {r.blobUrl && <audio controls src={r.blobUrl} style={{ height: 32, width: '100%' }} />}
                      {r.uploading && <Typography variant="caption" color="text.secondary">올리는 중…</Typography>}
                      {!r.uploading && !r.error && r.transcribeStatus && (
                        <Typography variant="caption"
                          color={TRANSCRIBE_TEXT[r.transcribeStatus]?.color || 'text.secondary'}>
                          {TRANSCRIBE_TEXT[r.transcribeStatus]?.text || r.transcribeStatus}
                        </Typography>
                      )}
                      {/* 완료라고만 적으면 등급이 내려간 것이 정상으로 보인다 (2026-08-20) */}
                      {!r.uploading && !r.error && degradedText(r.transcribeNotes) && (
                        <Typography variant="caption" color="warning.main" display="block">
                          ⚠ {degradedText(r.transcribeNotes)}
                        </Typography>
                      )}
                      {r.error && (
                        <Typography variant="caption" color="error">
                          {r.errorReason === '시간 초과'
                            ? '시간 초과 — 파일이 길어 처리 중 끊겼습니다. 다시 시도해 주세요.'
                            : `실패 — ${r.errorReason || '원인 불명'}`}
                        </Typography>
                      )}
                      {r.transcriptPreview && (
                        <Box>
                          <Typography variant="caption" color="primary" sx={{ cursor: 'pointer' }}
                            onClick={() => toggleExpand(r.key)}>
                            {r.expanded ? '전사 접기 ▲' : '전사 미리보기 ▼'}
                          </Typography>
                          <Collapse in={r.expanded}>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                              {r.transcriptPreview}…
                            </Typography>
                          </Collapse>
                        </Box>
                      )}
                    </Box>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2, textAlign: 'center' }}>
            녹음은 HTTPS에서만 가능. 녹음 없이 파일만, 또는 여러 개 추가 가능. 최대 100MB.
          </Typography>
        </CardContent>
      </Card>

      {/* 2) 조사 정보 */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} mb={2}>조사 정보</Typography>
          <Stack spacing={2.5}>
            <TextField label="조사 제목" required fullWidth value={title}
              onChange={(e) => setTitle(e.target.value)} disabled={busy} placeholder="예: 삼성 클라우드 도입 협의" />
            <Autocomplete freeSolo options={customerOptions.map((c) => c.companyName)}
              inputValue={customerName} onInputChange={(_, v) => setCustomerName(v)} disabled={busy}
              renderInput={(params) => <TextField {...params} label="대상자" required placeholder="이름 또는 회사명 (기존 대상자 자동완성)" />} />
            <TextField label="조사 일시" type="datetime-local" fullWidth value={when}
              onChange={(e) => setWhen(e.target.value)} disabled={busy} InputLabelProps={{ shrink: true }} />
            {/*
              **수사사건에 붙이면 요건·시계열·증거가 그 수사사건에 쌓인다** (018).
              비워 두어도 된다 — 첫 조사는 아직 수사사건이 아니다.
            */}
            <TextField select label="수사사건 (선택)" fullWidth value={matterId}
              onChange={(e) => setMatterId(e.target.value)} disabled={busy}
              helperText={matterId
                ? '요건·시계열·증거가 이 수사사건에 쌓입니다'
                : '비워 두면 이 조사 안에만 남습니다'}>
              <MenuItem value="">수사사건 없음</MenuItem>
              {matters.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.title}{m.fileNo ? ` (#${m.fileNo})` : ''}
                </MenuItem>
              ))}
            </TextField>
            <TextField label="사전 메모 (선택)" fullWidth multiline minRows={2} value={notes}
              onChange={(e) => setNotes(e.target.value)} disabled={busy}
              placeholder="조사 배경/목표 등 — 분석 리포트에 반영됩니다" />
          </Stack>
        </CardContent>
      </Card>

      {/* 3) 제출 */}
      {busy && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>{phaseText}</Typography>
          <LinearProgress variant={phase === 'analyzing' ? 'determinate' : 'indeterminate'} value={progress} />
        </Box>
      )}
      <Button onClick={handleSubmit} variant="contained" size="large" fullWidth disabled={!canSubmit}
        sx={{ py: 1.6, fontSize: '1.05rem', fontWeight: 700 }}>
        업로드 및 분석 시작
      </Button>

      {/* 오류를 **버튼 바로 아래**에도 보여준다.
          맨 위 Alert 하나뿐이었는데, 목록이 길면 그건 화면 밖이다 —
          누른 사람에게는 버튼이 아무 반응도 하지 않는 것으로 보인다. */}
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {/* 전사가 아직인 채로 눌러도 된다 — 분석이 서버에서 기다린다.
          기다린다는 것을 말해 주지 않으면 "전사 중" 을 보고 손을 놓게 된다. */}
      {pendingTranscribe && !busy && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>
          전사가 진행 중입니다. 지금 눌러도 되며, 분석은 전사가 끝난 뒤 시작됩니다.
        </Typography>
      )}
      {!canSubmit && !busy && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>
          {/* `preparing` 이 빠져 있어서, 긴 파일을 변환하는 동안 이미 입력한 정보를
              "입력하면 활성화됩니다" 라고 안내했다. 20분 파일에서 43초, 40분이면 그 이상이다.
              사용자는 시킨 대로 다 했는데 아무 일도 일어나지 않는 화면을 본다. */}
          {recordingActive ? '녹음을 완료(■)한 뒤 진행하세요.'
            : preparing ? '긴 오디오를 변환·분할하는 중입니다. 길이에 따라 1분 이상 걸릴 수 있습니다.'
            : anyUploading ? '녹음을 올리는 중입니다. 끝나면 활성화됩니다.'
            : '조사 제목과 대상자를 입력하면 활성화됩니다.'}
        </Typography>
      )}

      {/*
        녹음·분석 동의 (2026-08-24 개편)

        **켜져 있는 것만 적는다.** 코칭이 꺼져 있으면 주기적 전사는 일어나지 않는데,
        그 문장을 그대로 두면 받아 둔 동의의 근거가 사실과 어긋난다.

        그리고 **보관하는 것과 전송만 하는 것을 나눈다.** 그전 문구는 이 구분을 아예 하지 않아,
        읽는 사람이 "무엇이 남는가" 를 알 수 없었다 — 동의에서 가장 알아야 할 것이 그것이다.

        위탁처를 이름으로 적는다. "전사 서비스" 라고만 하면 데이터가 어디로 나가는지
        대상자가 판단할 수가 없다.

        **한 가지는 앞서 적는다** — 코칭 전사문 보관은 마이그레이션 015 가 들어가야 실제로 시작된다.
        그런데 동의를 먼저 받아 두는 것이 순서상 맞다. 실제보다 **더 알리는 쪽**은 안전하고
        덜 알리는 쪽은 안전하지 않다. 015 가 들어가면 이 주석을 지운다.
      */}
      <Dialog open={consentOpen} onClose={() => setConsentOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>녹음·분석 동의</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            <Typography variant="body2" mb={2}>
              이 조사은 녹음되고 AI가 분석합니다. 아래 내용을 참석자에게 알리고 동의를 받아야 합니다.
            </Typography>

            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
              보관하는 것
            </Typography>
            <Box component="ul" sx={{ pl: 2.5, my: 0.5 }}>
              <Typography component="li" variant="body2">
                녹음 파일 · 녹취(전사문) · 분석 결과 — 이 계정에 남습니다
              </Typography>
              {liveCoaching && (
                <Typography component="li" variant="body2">
                  실시간 코칭이 25초마다 만드는 <b>전사문과 판정</b> — 코칭 품질을 개선하는 데 씁니다.
                  {' '}오디오 조각은 보관하지 않습니다
                </Typography>
              )}
            </Box>

            {liveCaption && (
              <>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
                  보관하지 않는 것
                </Typography>
                <Box component="ul" sx={{ pl: 2.5, my: 0.5 }}>
                  <Typography component="li" variant="body2">
                    실시간 자막 — 녹음 중 음성이 전사 서비스로 계속 전송되지만,
                    자막은 화면에만 쓰고 남기지 않습니다
                  </Typography>
                </Box>
              </>
            )}

            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
              처리를 맡기는 곳
            </Typography>
            <Box component="ul" sx={{ pl: 2.5, my: 0.5 }}>
              <Typography component="li" variant="body2">
                OpenAI — 전사와 분석{liveCoaching && ', 실시간 코칭 판정'}
              </Typography>
              {liveCaption && (
                <Typography component="li" variant="body2">Deepgram · Google — 실시간 자막</Typography>
              )}
            </Box>

            <Typography variant="body2" sx={{ mt: 2, fontWeight: 600, color: 'text.primary' }}>
              참석자(대상자)에게 위 내용을 알리고 동의를 받으셨나요?
            </Typography>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConsentOpen(false)}>취소</Button>
          <Button variant="contained" onClick={() => { setConsented(true); setConsentOpen(false); doStartRecording(); }}>
            동의하고 녹음 시작
          </Button>
        </DialogActions>
      </Dialog>

      {/* 버리면 끝이다. 이 브라우저 밖에는 사본이 없다. */}
      <Dialog open={!!discardTarget} onClose={() => setDiscardTarget(null)}>
        <DialogTitle>이 녹음을 버립니다</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {discardTarget && (
              <>
                {new Date(discardTarget.started_at).toLocaleString()} ·{' '}
                {(discardTarget.bytes / 1024 / 1024).toFixed(1)}MB
                <br />
              </>
            )}
            <strong>되돌릴 수 없습니다.</strong> 이 녹음은 이 브라우저에만 있고 서버에는 없습니다.
            남겨 둘 생각이 조금이라도 있으면 먼저 파일로 내려받으세요.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => discardTarget && void saveSessionToDisk(discardTarget)}>파일로 꺼내기</Button>
          <Button onClick={() => setDiscardTarget(null)}>그만두기</Button>
          <Button color="error" onClick={() => discardTarget && discardSession(discardTarget)}>버린다</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
