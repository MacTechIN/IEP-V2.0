// 사건 정리 (030)
//
// ── 이 화면이 지키는 것 ──
//
// **자동으로 지우는 청소기를 만들지 않는다. 목록을 보여 주고 사람이 정한다.**
// 그래서 이 화면은 지우지 않는다 — 무엇이 있는지 보여 주고, 무엇이 사라지고
// 무엇이 남는지 알려 주고, 사건명을 손으로 적게 한 다음에야 지운다.
//
// **되돌릴 수 없는 삭제 전에는 사본을 남긴다.**
// 「내려받으세요」 라는 안내로는 안 된다 — 지우려는 사람은 이미 「필요 없다」 고
// 판단한 사람이다. 그래서 서버가 **지우는 응답에 사본을 담아 돌려주고**,
// 이 화면은 그것을 지운 뒤에도 그대로 들고 있는다. 실수해도 거기서 내려받으면 된다.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container, Typography, Paper, Stack, Box, Button, Chip, Alert, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, CircularProgress,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import { apiClient } from '../services/api';

type Matter = {
  id: string; title: string; status?: string | null; cause?: string | null;
  fileNo?: string | null; clientName?: string | null; closedOn?: string | null;
};
type Candidate = {
  matter_id: string; title: string; file_no: string | null; closed_on: string;
  retention_years: number; purge_on: string; days_over: string;
  meetings: string; deadlines: string; evidence: string;
};
type Preview = {
  title: string; status: string | null;
  destroys: { adverseParties: number; deadlines: number; elements: number;
              timeline: number; evidence: number; documents: number };
  detaches: { meetings: number; recordings: number };
};

/** 사본을 파일로 내려받는다. 브라우저가 하는 일이라 서버가 필요 없다. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = (s: string) => s.replace(/[^\w가-힣]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export default function MatterPurgePage() {
  const navigate = useNavigate();
  const [matters, setMatters] = useState<Matter[] | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [target, setTarget] = useState<Matter | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ title: string; snapshot: any; preview: Preview } | null>(null);

  const load = async () => {
    const [m, c] = await Promise.all([
      apiClient.getMatters().catch(() => null),
      apiClient.matterPurgeCandidates().catch(() => null),
    ]);
    setMatters(m?.success ? m.data : []);
    setCands(c?.success ? c.data : []);
  };
  useEffect(() => { void load(); }, []);

  const open = async (m: Matter) => {
    setTarget(m); setPreview(null); setSnapshot(null); setTyped(''); setError('');
    try {
      const [p, e] = await Promise.all([
        apiClient.matterDeletePreview(m.id),
        apiClient.matterExport(m.id),
      ]);
      if (p.success) setPreview(p.data);
      if (e.success) setSnapshot(e.data);
    } catch { setError('내용을 불러오지 못했습니다.'); }
  };

  const remove = async () => {
    if (!target) return;
    setBusy(true); setError('');
    try {
      const r = await apiClient.deleteMatter(target.id, typed);
      if (r.success) {
        // **사본을 들고 있는다.** 지운 뒤에도 여기서 내려받을 수 있다.
        setDone({ title: target.title, snapshot: r.data.snapshot, preview: r.data.deleted });
        setTarget(null); void load();
      }
    } catch (e: any) {
      setError(e?.error?.message || '지우지 못했습니다.');
    }
    setBusy(false);
  };

  const overdue = new Set(cands.map((c) => c.matter_id));

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1} flexWrap="wrap">
        <Typography variant="h5" fontWeight={700}>사건 정리</Typography>
        <Button size="small" onClick={() => navigate('/matters')}>사건 목록으로</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={3}>
        지우기 전에 <b>무엇이 사라지고 무엇이 남는지</b> 보여 드립니다.
        <b> 조사와 녹음은 지워지지 않습니다</b> — 사건에서 떨어져 나올 뿐입니다.
        지우면 <b>사본이 화면에 남고</b> 거기서 내려받을 수 있습니다.
      </Typography>

      {/* 지운 뒤 — **사본을 여기 둔다** */}
      {done && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setDone(null)}>
          <Typography variant="body2" fontWeight={700}>
            「{done.title}」 를 지웠습니다.
          </Typography>
          <Typography variant="body2">
            서면 {done.preview.destroys.documents}건 · 기한 {done.preview.destroys.deadlines}건 ·
            요건 {done.preview.destroys.elements}건이 함께 사라졌고,
            조사 {done.preview.detaches.meetings}건(녹음 {done.preview.detaches.recordings}개)은
            <b> 그대로 남아 있습니다.</b>
          </Typography>
          <Button size="small" variant="outlined" sx={{ mt: 1 }}
            onClick={() => download(`사건사본-${stamp(done.title)}.json`,
                                    JSON.stringify(done.snapshot, null, 2))}>
            사본 내려받기
          </Button>
        </Alert>
      )}

      {/* 보존기간이 지난 것 — 이 화면이 원래 있어야 했던 이유 */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" fontWeight={600} mb={0.5}>보존기간이 지난 사건</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={2}>
          종결일 + 보존연수가 지난 것입니다. <b>지워야 한다는 뜻은 아닙니다</b> —
          더 둘 이유가 없는지 보시라는 목록입니다.
        </Typography>
        {cands.length === 0 ? (
          <Typography variant="body2" color="text.secondary">지금은 없습니다.</Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>사건</TableCell><TableCell>종결</TableCell>
                  <TableCell>보존</TableCell><TableCell align="right">딸린 것</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {cands.map((c) => (
                  <TableRow key={c.matter_id}>
                    <TableCell>{c.title}</TableCell>
                    <TableCell>{String(c.closed_on).slice(0, 10)}</TableCell>
                    <TableCell>{c.retention_years}년</TableCell>
                    <TableCell align="right">
                      조사 {c.meetings} · 기한 {c.deadlines} · 증거 {c.evidence}
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" color="error"
                        onClick={() => open({ id: c.matter_id, title: c.title })}>정리</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>

      {/* 전체 — 잘못 만든 사건을 치울 곳이 없었다 */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={600} mb={0.5}>모든 사건</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={2}>
          잘못 만든 사건이나 시험용으로 만든 것을 여기서 치웁니다.
          <b> 진행 중인 사건은 지우지 마십시오</b> — 되돌릴 수 없습니다.
        </Typography>
        {matters === null ? <CircularProgress size={20} /> : matters.length === 0 ? (
          <Typography variant="body2" color="text.secondary">사건이 없습니다.</Typography>
        ) : (
          <Stack divider={<Divider />}>
            {matters.map((m) => (
              <Stack key={m.id} direction="row" alignItems="center" spacing={1}
                sx={{ py: 1.25 }} flexWrap="wrap">
                <Typography variant="body2" sx={{ flex: 1, minWidth: 150 }}>{m.title}</Typography>
                {m.cause && <Chip size="small" variant="outlined" label={m.cause} />}
                {overdue.has(m.id) && <Chip size="small" color="warning" label="보존기간 지남" />}
                <Button size="small" onClick={() => navigate(`/matters/${m.id}`)}>열기</Button>
                <Button size="small" color="error" onClick={() => open(m)}>정리</Button>
              </Stack>
            ))}
          </Stack>
        )}
      </Paper>

      {/* 지우기 전 — **무엇이 사라지는지 보여 주고 손으로 적게 한다** */}
      <Dialog open={!!target} onClose={() => !busy && setTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>「{target?.title}」 를 지웁니다</DialogTitle>
        <DialogContent>
          {!preview ? <CircularProgress size={22} /> : (
            <Stack spacing={2}>
              <Alert severity="error">
                <Typography variant="body2" fontWeight={700}>함께 사라집니다 — 되돌릴 수 없습니다</Typography>
                <Box component="ul" sx={{ pl: 2.5, my: 0.5 }}>
                  <Typography component="li" variant="body2">서면 {preview.destroys.documents}건</Typography>
                  <Typography component="li" variant="body2">기한 {preview.destroys.deadlines}건</Typography>
                  <Typography component="li" variant="body2">요건사실 {preview.destroys.elements}건</Typography>
                  <Typography component="li" variant="body2">시계열 {preview.destroys.timeline}건 · 증거 {preview.destroys.evidence}건</Typography>
                  <Typography component="li" variant="body2">상대방 {preview.destroys.adverseParties}건</Typography>
                </Box>
              </Alert>

              <Alert severity="info">
                <Typography variant="body2" fontWeight={700}>남습니다</Typography>
                <Typography variant="body2">
                  조사 {preview.detaches.meetings}건 · <b>녹음 {preview.detaches.recordings}개</b> —
                  사건에서 떨어져 나올 뿐 지워지지 않습니다.
                  나중에 다른 사건에 다시 붙일 수 있습니다.
                </Typography>
              </Alert>

              <Box>
                <Button size="small" variant="outlined" disabled={!snapshot}
                  onClick={() => snapshot && download(
                    `사건사본-${stamp(target?.title || '사건')}.json`,
                    JSON.stringify(snapshot, null, 2))}>
                  먼저 사본 내려받기
                </Button>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  안 받으셔도 됩니다 — <b>지운 뒤에도 사본이 화면에 남습니다.</b>
                </Typography>
              </Box>

              <TextField size="small" fullWidth autoFocus
                label="확인 — 사건명을 그대로 적으십시오"
                placeholder={target?.title}
                value={typed} onChange={(e) => setTyped(e.target.value)}
                helperText="목록에서 한 줄 잘못 누르는 것을 막습니다" />

              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTarget(null)} disabled={busy}>그만두기</Button>
          <Button color="error" variant="contained" onClick={remove}
            disabled={busy || !preview || typed.trim() !== (target?.title || '').trim()}>
            {busy ? '지우는 중…' : '지웁니다'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
