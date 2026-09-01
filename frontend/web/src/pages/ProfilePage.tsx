import { useEffect, useRef, useState } from 'react';
import {
  Container, Paper, Typography, Box, Button, Stack, Alert, LinearProgress, Chip,
  TextField, MenuItem, Divider,
} from '@mui/material';
import { apiClient } from '../services/api';

/**
 * 내 프로필 — 수사관 신원과 목소리 등록. 신원은 조서·수사보고의 작성자 표시에 쓴다.
 *
 * **본인 목소리만 등록한다.** v1 은 조사마다 참석자 전원을 등록하다가 두 가지로 실패했다.
 * 대상자 성문(생체인식 정보)을 보관하게 되는 것이 하나, 그리고 전원 등록이 아니면
 * **미등록자 발화가 등록된 다른 사람 이름으로 배정되는 것**이 둘이다.
 * 본인만 등록하면 둘 다 사라진다 — 내 발화에만 실명이 붙고 나머지는 화자 A·B 로 남는다.
 */

/**
 * 계급/직위 — 조서·수사보고의 작성자 표시에 쓴다. 비워 둘 수 있다.
 */
// 계급/직위 — 조서·수사보고의 작성자 표시에 쓴다.
const POSITIONS = ['순경', '경장', '경사', '경위', '경감', '경정', '수사관'];

/** 담당 분야 — 통계·분류에 쓸 자리. 지금은 프로필에만 담는다. */
const PRACTICE_AREAS = ['경제', '지능', '사이버', '강력', '여성·청소년', '교통', '마약', '기타'];

const MIN_MS = 2000;
const MAX_MS = 10000;
/** 이 길이에서 멈춘다. 최대치에 붙여 두면 반올림 때문에 거절당하기 쉽다. */
const TARGET_MS = 8000;

export default function ProfilePage() {
  const [enrolled, setEnrolled] = useState<{ durationMs: number; enrolledAt: string } | null>(null);
  const [me, setMe] = useState<any | null>(null);
  // 수사관 신원. **저장을 누를 때까지 서버에 안 보낸다** — 타이핑마다 보내면
  // 절반쯤 적힌 값이 그 사이 문서에 찍힌다.
  const [form, setForm] = useState({
    name: '', barNo: '', firmName: '', position: '', barAssociation: '',
    phone: '', officePhone: '', officeAddress: '',
  });
  const [areas, setAreas] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const recRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopAtRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    try {
      const res = await apiClient.getMe();
      if (res.success) { setMe(res.data); setEnrolled(res.data?.voiceRef ?? null);
        const u: any = res.data || {};
        setForm({
          name: u.name || '', barNo: u.barNo || '', firmName: u.firmName || '',
          position: u.position || '', barAssociation: u.barAssociation || '',
          phone: u.phone || '', officePhone: u.officePhone || '',
          officeAddress: u.officeAddress || '',
        });
        setAreas(Array.isArray(u.practiceAreas) ? u.practiceAreas : []); }
    } catch { /* ignore */ } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // 화면을 떠날 때 마이크를 놓아준다 — 녹음 표시등이 켜진 채 남으면 사용자가 불안해한다
  useEffect(() => () => {
    recRef.current?.stream.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    if (stopAtRef.current) clearTimeout(stopAtRef.current);
  }, []);

  const start = async () => {
    setError(''); setDone('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('이 브라우저에서는 녹음할 수 없습니다. HTTPS 연결이 필요합니다.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        setRecording(false);
        const durationMs = Date.now() - startedAt;
        if (durationMs < MIN_MS) {
          setError(`${MIN_MS / 1000}초 이상 말해 주세요. (${(durationMs / 1000).toFixed(1)}초 녹음됨)`);
          return;
        }
        const type = mr.mimeType || 'audio/webm';
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([new Blob(chunks, { type })], `voice.${ext}`, { type });
        setBusy(true);
        try {
          const res = await apiClient.enrollVoice(file, Math.min(durationMs, MAX_MS));
          if (res.success) { setDone('등록했습니다. 다음 분석부터 내 발화에 이름이 붙습니다.'); await load(); }
          else setError('등록에 실패했습니다.');
        } catch (e: any) {
          setError(e?.error?.message || '등록에 실패했습니다.');
        } finally { setBusy(false); }
      };
      recRef.current = mr;
      mr.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((v) => v + 100), 100);
      // 최대 길이에서 자동으로 멈춘다. 넘기면 API 가 거절한다.
      stopAtRef.current = setTimeout(() => { try { mr.stop(); } catch { /* ignore */ } }, TARGET_MS);
    } catch (e: any) {
      setError('마이크를 사용할 수 없습니다: ' + (e?.message || ''));
    }
  };

  const stop = () => { try { recRef.current?.stop(); } catch { /* ignore */ } };

  const remove = async () => {
    setBusy(true); setError(''); setDone('');
    try {
      await apiClient.deleteVoice();
      setDone('등록을 해제했습니다.');
      await load();
    } catch { setError('해제에 실패했습니다.'); } finally { setBusy(false); }
  };

  const saveProfile = async () => {
    setSaving(true); setError(''); setSaved('');
    try {
      const res = await apiClient.updateProfile({ ...form, practiceAreas: areas });
      if (res.success) { setMe(res.data); setSaved('저장했습니다.'); }
    } catch (e: any) {
      setError(e?.error?.message || '저장하지 못했습니다.');
    }
    setSaving(false);
  };

  const toggleArea = (a: string) =>
    setAreas((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);

  if (loading) return <Container maxWidth="sm" sx={{ py: 4 }}><Typography>로딩 중...</Typography></Container>;

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>내 프로필</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        {me?.name || me?.email}
      </Typography>

      {/* ── 수사관 신원 ──
          **꾸미기 위한 칸이 아니다.** 소속·계급·성명은 조서·수사보고의
          작성자 표시에 쓰인다 — 비어 있으면 그 자리가 빈 채로 나간다. */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" fontWeight={600} mb={0.5}>수사관 정보</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={2.5}>
          여기 적은 것이 <b>조서·수사보고의 작성자 표시</b>에 쓰입니다.
        </Typography>

        {saved && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved('')}>{saved}</Alert>}

        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="이름" fullWidth value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField select label="계급/직위" fullWidth value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}>
              <MenuItem value="">선택 안 함</MenuItem>
              {POSITIONS.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
          </Stack>

          <TextField label="소속 (관서·부서)" fullWidth value={form.firmName}
            onChange={(e) => setForm({ ...form, firmName: e.target.value })}
            placeholder="예: ○○경찰서 수사과 경제팀" />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="사무실 전화" fullWidth value={form.officePhone}
              onChange={(e) => setForm({ ...form, officePhone: e.target.value })}
              placeholder="02-000-0000"
              helperText="조서·수사보고에 붙습니다" />
            <TextField label="휴대폰" fullWidth value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="010-0000-0000"
              helperText="문서에 붙지 않습니다" />
          </Stack>

          <TextField label="관서 주소" fullWidth value={form.officeAddress}
            onChange={(e) => setForm({ ...form, officeAddress: e.target.value })} />

          <Box>
            <Typography variant="body2" fontWeight={600} mb={0.5}>담당 분야</Typography>
            <Typography variant="caption" color="text.secondary" display="block" mb={1}>
              통계·분류에 쓸 예정입니다.
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {PRACTICE_AREAS.map((a) => (
                <Chip key={a} label={a} size="small"
                  color={areas.includes(a) ? 'primary' : 'default'}
                  variant={areas.includes(a) ? 'filled' : 'outlined'}
                  onClick={() => toggleArea(a)} />
              ))}
            </Stack>
          </Box>

          <Divider />
          <Box>
            <Button variant="contained" onClick={saveProfile} disabled={saving}>
              {saving ? '저장 중…' : '저장'}
            </Button>
            <Typography variant="caption" color="text.secondary" display="block" mt={1}>
              이메일과 권한은 여기서 바꿀 수 없습니다 — 관리자에게 요청하십시오.
            </Typography>
          </Box>
        </Stack>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Typography variant="h6" fontWeight={600} sx={{ flex: 1 }}>🎤 내 목소리 등록</Typography>
          {enrolled
            ? <Chip size="small" color="success" label="등록됨" />
            : <Chip size="small" label="미등록" variant="outlined" />}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          한 번 등록해 두면 이후 모든 조사에서 <strong>내 발화에만 이름이 붙습니다.</strong>
          다른 참석자는 화자 A·B로 남습니다 — 남의 목소리는 저장하지 않습니다.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {done && <Alert severity="success" sx={{ mb: 2 }}>{done}</Alert>}

        {enrolled && !recording && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {(enrolled.durationMs / 1000).toFixed(1)}초 클립이 등록돼 있습니다
            {' · '}{new Date(enrolled.enrolledAt).toLocaleDateString('ko-KR')}
          </Alert>
        )}

        {recording && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="h4" fontWeight={700} textAlign="center" color="error.main"
              sx={{ fontVariantNumeric: 'tabular-nums' }}>
              ● {(elapsed / 1000).toFixed(1)}초
            </Typography>
            <LinearProgress variant="determinate"
              value={Math.min(100, (elapsed / TARGET_MS) * 100)} sx={{ mt: 1 }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              평소 말투로 자기소개를 해 주세요. {TARGET_MS / 1000}초에서 자동으로 멈춥니다.
            </Typography>
          </Box>
        )}

        <Stack direction="row" spacing={1.5}>
          {!recording ? (
            <Button variant="contained" color="error" onClick={start} disabled={busy}>
              ● {enrolled ? '다시 등록' : '녹음 시작'}
            </Button>
          ) : (
            <Button variant="outlined" onClick={stop}>■ 완료</Button>
          )}
          {enrolled && !recording && (
            <Button color="inherit" onClick={remove} disabled={busy}>등록 해제</Button>
          )}
        </Stack>

        {busy && <LinearProgress sx={{ mt: 2 }} />}
      </Paper>
    </Container>
  );
}
