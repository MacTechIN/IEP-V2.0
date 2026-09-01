import { useEffect, useState } from 'react';
import {
  Container, Typography, Box, Card, CardContent, Table, TableHead, TableRow, TableCell,
  TableBody, Button, Alert, CircularProgress, Stack,
} from '@mui/material';
import { apiClient } from '../services/api';
import { TRANSCRIBE_TEXT, degradedText, type TranscribeNotes } from '../lib/transcribeStatus';

/** 서버가 주는 미첨부 녹음(draft) 한 건. */
interface Draft {
  id: string;
  label?: string | null;
  durationSeconds?: number | null;
  transcription?: string | null;
  transcribeStatus?: string;
  transcribeNotes?: TranscribeNotes | null;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * **서버에는 올라와 있는데 어느 조사에도 붙지 않은 녹음(draft)** 을 보는 관리자 화면.
 *
 * 구간 녹음(2.10.0)의 안전망이 남긴 것들이다 — 회의 도중 화면이 죽어도 앞 구간들은
 * 서버에 남는다. 2.17 까지는 이 목록이 녹음 화면 맨 위에 그대로 떴는데, 테스트가
 * 쌓일수록 사용자에게는 소음이었다. 그래서 목록을 여기로 옮겼다 (2.18.0).
 *
 * 목록은 **로그인한 계정 것만** 보인다 — `/recordings/drafts` 가 원래 그렇다.
 * 다른 사용자 것을 보려면 그 계정으로 들어가야 한다.
 */
export default function AdminRecordingsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.getRecordingDrafts();
      if (res.success) setDrafts((res.data as Draft[]) || []);
      else setError('녹음 목록을 불러오지 못했습니다.');
    } catch (e: any) {
      setError(e?.error?.message || '녹음 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const remove = async (d: Draft) => {
    if (!window.confirm(`"${d.label || '녹음'}" 을 서버에서 지웁니다. 되돌릴 수 없습니다.`)) return;
    try {
      await apiClient.deleteRecording(d.id);
      setDrafts((prev) => prev.filter((x) => x.id !== d.id));
    } catch (e: any) {
      setError(e?.error?.message || '삭제에 실패했습니다.');
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography variant="h5" fontWeight={700}>녹음 관리 (관리자)</Typography>
        <Button size="small" onClick={load} disabled={loading}>새로 고침</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={3}>
        서버에는 올라와 있지만 아직 어느 조사에도 붙지 않은 녹음입니다.
        이 계정 것만 보입니다. 여기서는 확인과 삭제만 합니다 —
        조사에 붙이는 기능은 없습니다 (2.17 까지는 녹음 화면의 "이 조사에 넣기" 가 그 역할이었다).
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} mb={2}>
            미첨부 녹음 {!loading && `(${drafts.length}건)`}
          </Typography>
          {loading ? (
            <Box py={4} textAlign="center"><CircularProgress /></Box>
          ) : drafts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">미첨부 녹음이 없습니다.</Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 560 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>이름</TableCell>
                    <TableCell>길이</TableCell>
                    <TableCell>전사</TableCell>
                    <TableCell>내용 미리보기</TableCell>
                    <TableCell align="right">작업</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {drafts.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{d.label || '녹음'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmt(d.durationSeconds || 0)}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Typography variant="caption"
                          color={TRANSCRIBE_TEXT[d.transcribeStatus || '']?.color || 'text.secondary'}>
                          {TRANSCRIBE_TEXT[d.transcribeStatus || '']?.text || d.transcribeStatus || '—'}
                        </Typography>
                        {degradedText(d.transcribeNotes) && (
                          <Typography variant="caption" color="warning.main" display="block">
                            ⚠ {degradedText(d.transcribeNotes)}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 320 }}>
                        <Typography variant="caption" color="text.secondary" sx={{
                          display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {d.transcription ? String(d.transcription).slice(0, 120) : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Button size="small" color="error" onClick={() => void remove(d)}>지우기</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
