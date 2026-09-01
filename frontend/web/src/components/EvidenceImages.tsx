// 이미지 증적·참조 자료 (S7)
//
// **입력 이유가 필수** — 이유 없는 이미지는 안 붙는다 (§0). 원본은 서버가 R2 에 불변으로 두고
// SHA-256 을 박는다. Vision 분석은 「보이는 사실」만 — 판정이 아니다.
import { useEffect, useRef, useState } from 'react';
import {
  Box, Paper, Typography, Button, TextField, Stack, Chip, CircularProgress, Alert,
} from '@mui/material';
import { apiClient } from '../services/api';

interface Img {
  id: string; sha256: string; mime: string; bytes: number; reason: string;
  linked_finding_id: string | null;
  description: { summary?: string; ocr_text?: string; objects?: string[]; caution?: string } | null;
  analyzed_at: string | null; captured_at: string; created_at: string;
}

function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true; let made: string | null = null;
    apiClient.imageObjectUrl(id).then((u) => { if (live) { setUrl(u); made = u; } });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id]);
  if (!url) return <Box sx={{ width: 96, height: 96, bgcolor: 'grey.100', borderRadius: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress size={16} /></Box>;
  return <Box component="a" href={url} target="_blank" rel="noopener">
    <Box component="img" src={url} alt="증적"
      sx={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }} />
  </Box>;
}

export default function EvidenceImages({ meetingId }: { meetingId: string }) {
  const [imgs, setImgs] = useState<Img[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    const r = await apiClient.listImages(meetingId).catch(() => null);
    if (r?.success) setImgs(r.data || []); else setImgs([]);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [meetingId]);

  const attach = async () => {
    setErr('');
    if (!file) { setErr('이미지를 고르거나 촬영하십시오.'); return; }
    if (!reason.trim()) { setErr('입력 이유를 적으십시오 — 왜 이 이미지를 넣는지.'); return; }
    setBusy(true);
    try {
      const r = await apiClient.attachImage(meetingId, file, reason.trim());
      if (!r.success) throw new Error(r.error?.message || '붙이지 못했습니다');
      setFile(null); setReason(''); if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e: any) { setErr(e?.error?.message || e?.message || '붙이지 못했습니다'); }
    finally { setBusy(false); }
  };

  const analyze = async (id: string) => {
    setAnalyzing(id);
    try { const r = await apiClient.analyzeImage(id); if (r.success) await load(); }
    finally { setAnalyzing(null); }
  };
  const remove = async (id: string) => {
    if (!window.confirm('이 이미지를 지웁니까? 되돌릴 수 없습니다.')) return;
    const r = await apiClient.deleteImage(id).catch(() => null);
    if (r?.success) await load();
  };

  return (
    <Paper sx={{ p: 3, mt: 3 }}>
      <Typography variant="subtitle2" fontWeight={700} mb={0.5}>🖼 증적·참조 자료</Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
        사진을 촬영·업로드하고 <b>왜 넣는지</b>를 적으십시오. 원본은 그대로 보관되고 변조 검증용 해시가 남습니다.
        <b> 이미지는 참조 자료입니다 — 판단은 수사관이 합니다.</b>
      </Typography>

      {/* 붙이기 */}
      <Stack spacing={1.2} sx={{ mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          <Button variant="outlined" size="small" component="label">
            📷 촬영 / 🖼 업로드
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Button>
          {file && <Typography variant="caption" color="text.secondary">{file.name} · {Math.round(file.size/1024)}KB</Typography>}
        </Stack>
        <TextField size="small" label="입력 이유 (필수)" value={reason} fullWidth
          onChange={(e) => setReason(e.target.value)}
          placeholder="예: 피의자가 언급한 계약서 사진" />
        <Box>
          <Button variant="contained" size="small" onClick={attach} disabled={busy}>
            {busy ? '붙이는 중…' : '붙이기'}
          </Button>
        </Box>
        {err && <Alert severity="warning" onClose={() => setErr('')}>{err}</Alert>}
      </Stack>

      {/* 목록 */}
      {imgs === null ? <CircularProgress size={18} /> : imgs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">아직 붙인 이미지가 없습니다.</Typography>
      ) : (
        <Stack spacing={1.5}>
          {imgs.map((im) => (
            <Box key={im.id} sx={{ display: 'flex', gap: 1.5, p: 1.5, border: '1px solid',
              borderColor: 'divider', borderRadius: 1 }}>
              <Thumb id={im.id} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600}>{im.reason}</Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  sha256 {im.sha256.slice(0, 8)}… · {Math.round(im.bytes/1024)}KB
                </Typography>
                {im.description ? (
                  <Box sx={{ mt: 0.75, pl: 1, borderLeft: '3px solid', borderColor: 'divider' }}>
                    <Typography variant="body2">{im.description.summary}</Typography>
                    {im.description.ocr_text && (
                      <Typography variant="caption" color="text.secondary" display="block"
                        sx={{ whiteSpace: 'pre-wrap' }}>글자: {im.description.ocr_text}</Typography>
                    )}
                    {!!im.description.objects?.length && (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                        {im.description.objects.map((o, i) => <Chip key={i} size="small" label={o} variant="outlined" />)}
                      </Stack>
                    )}
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                      {im.description.caution}
                    </Typography>
                  </Box>
                ) : (
                  <Button size="small" sx={{ mt: 0.5 }} disabled={analyzing === im.id}
                    onClick={() => analyze(im.id)}>
                    {analyzing === im.id ? '분석 중…' : '이미지 분석 (보이는 사실만)'}
                  </Button>
                )}
              </Box>
              <Button size="small" color="inherit" sx={{ color: 'text.secondary', alignSelf: 'flex-start' }}
                onClick={() => remove(im.id)}>지우기</Button>
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
