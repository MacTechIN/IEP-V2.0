// 기한 대시보드 (017)
//
// **아침에 이 화면 하나만 보면 되어야 한다.** 사건을 하나씩 열어 봐야 알 수 있으면
// 그건 기한 관리가 아니다 — 놓치는 것은 늘 안 열어 본 사건에서 나온다.
//
// 그래서 사건을 가로질러 모으고, **급한 것 순서로 세워 둔다.**
// 지난 기한을 감추지 않는다: 사라지면 놓쳤다는 사실까지 사라진다.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container, Paper, Typography, Stack, Box, Chip, Button, Alert, Divider,
} from '@mui/material';
import { apiClient } from '../services/api';

const KINDS: Record<string, string> = {
  prescription: '소멸시효', exclusion: '제척기간', appeal: '항소·상고',
  filing: '서면 제출', hearing: '기일', notice: '통지·최고', other: '기타',
};

type Row = {
  id: string; kind: string; title: string; due_on: string;
  is_estimated: boolean; status: string; basis: string | null; note: string | null;
  confirmed_by_email: string | null; confirmed_at: string | null;
  days_left: number; matter_id: string; matter_title: string; matter_file_no: string | null;
};

/**
 * 급한 정도로 묶는다. **숫자가 아니라 「무엇을 지금 해야 하나」로 나눈다** —
 * `D-9` 와 `D-11` 사이에는 아무 의미가 없지만, 「이번 주」와 「이번 달」 사이에는 있다.
 */
const BANDS = [
  { key: 'over',  label: '지난 기한',   hint: '되돌릴 수 없는 것이 있는지 먼저 본다', test: (d: number) => d < 0 },
  { key: 'today', label: '오늘·내일',   hint: '',  test: (d: number) => d >= 0 && d <= 1 },
  { key: 'week',  label: '이번 주 (7일)', hint: '', test: (d: number) => d > 1 && d <= 7 },
  { key: 'month', label: '30일 안',     hint: '',  test: (d: number) => d > 7 && d <= 30 },
  { key: 'later', label: '그 뒤',       hint: '',  test: (d: number) => d > 30 },
];

const RANGES = [30, 60, 90, 365];

/** 지남·임박은 빨강, 이번 주는 주황, 나머지는 먹색. **색을 셋으로 제한한다** — 넷이 되면 아무 뜻이 없어진다. */
function urgencyColor(days: number): string {
  if (days <= 1) return '#991B1B';
  if (days <= 7) return '#92400E';
  return '#334155';
}

function dayLabel(days: number): string {
  if (days < 0) return `${-days}일 지남`;
  if (days === 0) return '오늘';
  if (days === 1) return '내일';
  return `D-${days}`;
}

export default function DeadlineDashboardPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [days, setDays] = useState(60);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = async (d = days) => {
    setLoading(true);
    try {
      const res = await apiClient.getUpcomingDeadlines(d);
      if (res.success) setRows(res.data || []);
    } catch (e: any) {
      setError(e?.error?.message || '기한을 불러오지 못했습니다.');
    }
    setLoading(false);
  };
  useEffect(() => { void load(days); /* eslint-disable-next-line */ }, [days]);

  const confirm = async (id: string) => {
    setBusyId(id);
    try { await apiClient.confirmDeadline(id); await load(); }
    catch (e: any) { setError(e?.error?.message || '확정하지 못했습니다.'); }
    setBusyId('');
  };
  const done = async (id: string) => {
    setBusyId(id);
    try { await apiClient.updateDeadline(id, { status: 'done' }); await load(); }
    catch (e: any) { setError(e?.error?.message || '완료로 바꾸지 못했습니다.'); }
    setBusyId('');
  };

  const over = rows.filter((r) => r.days_left < 0).length;
  const soon = rows.filter((r) => r.days_left >= 0 && r.days_left <= 7).length;
  const estimated = rows.filter((r) => r.is_estimated).length;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={700} mb={0.5}>기한</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        사건을 가로질러 모았습니다. 끝난 기한은 빠집니다.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* 요약. **숫자 셋만 둔다** — 늘리면 아무것도 눈에 안 들어온다 */}
      <Paper sx={{ p: 2.5, mb: 3 }}>
        <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap>
          {[
            { n: over, label: '지남', c: '#991B1B' },
            { n: soon, label: '7일 안', c: '#92400E' },
            { n: estimated, label: '확인 필요', c: '#1E40AF' },
          ].map((x) => (
            <Box key={x.label}>
              <Typography sx={{ fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.1,
                                color: x.n ? x.c : 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
                {x.n}
              </Typography>
              <Typography variant="caption" color="text.secondary">{x.label}</Typography>
            </Box>
          ))}
        </Stack>
        {estimated > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary">
              <b>확인 필요</b>는 상담에서 <b>AI 가 뽑은 추정 날짜</b>입니다.
              근거를 보고 확정하기 전까지는 <b>날짜로 믿지 마십시오.</b>
            </Typography>
          </>
        )}
      </Paper>

      <Stack direction="row" spacing={1} mb={2} alignItems="center">
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>범위</Typography>
        {RANGES.map((d) => (
          <Button key={d} size="small" variant={days === d ? 'contained' : 'outlined'}
            onClick={() => setDays(d)}>{d === 365 ? '1년' : `${d}일`}</Button>
        ))}
      </Stack>

      {loading ? (
        <Typography variant="body2" color="text.secondary">불러오는 중…</Typography>
      ) : rows.length === 0 ? (
        <Paper sx={{ p: 3 }}>
          {/* **없다는 것을 「잘하고 있다」로 바꾸지 않는다.** 안 넣은 기한은 여기 안 뜬다 */}
          <Typography variant="body2" color="text.secondary">
            {days === 365 ? '1년' : `${days}일`} 안에 열려 있는 기한이 없습니다.
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
            아직 넣지 않은 기한은 여기 뜨지 않습니다. 사건 화면에서 추가하십시오.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={3}>
          {BANDS.map((band) => {
            const list = rows.filter((r) => band.test(r.days_left));
            if (!list.length) return null;
            return (
              <Box key={band.key}>
                <Stack direction="row" alignItems="baseline" spacing={1} mb={1}>
                  <Typography variant="subtitle2" fontWeight={700}
                    sx={{ color: band.key === 'over' ? '#991B1B' : 'text.primary' }}>
                    {band.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {list.length}건{band.hint ? ` · ${band.hint}` : ''}
                  </Typography>
                </Stack>

                <Paper sx={{ overflow: 'hidden' }}>
                  {list.map((r, i) => (
                    <Box key={r.id} sx={{
                      p: 2, display: 'flex', gap: 2, alignItems: 'flex-start',
                      borderTop: i ? '1px solid' : 'none', borderColor: 'divider',
                    }}>
                      {/* 남은 날. **왼쪽 끝 고정폭** — 세로로 훑으면 급한 순서가 그대로 읽힌다 */}
                      {/* 남은 날은 폰에서도 고정폭을 지킨다 — 세로로 훑어 급한 순서를 읽는 칸이다 */}
                      <Box sx={{ minWidth: { xs: 66, sm: 78 } }}>
                        <Typography variant="body2" sx={{
                          color: urgencyColor(r.days_left), fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {dayLabel(r.days_left)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {String(r.due_on).slice(0, 10)}
                        </Typography>
                      </Box>

                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Chip size="small" label={KINDS[r.kind] || r.kind} sx={{ height: 20 }} />
                          <Typography variant="body2" fontWeight={600}>{r.title}</Typography>
                          {r.is_estimated && (
                            <Chip size="small" label="추정 — 확인 필요"
                              sx={{ height: 20, bgcolor: '#FFFBEB', color: '#92400E',
                                    border: '1px solid #FCD34D' }} />
                          )}
                        </Stack>

                        {/* 어느 사건인지가 없으면 이 목록은 쓸 수 없다 */}
                        <Typography variant="caption" sx={{ color: 'primary.main', cursor: 'pointer' }}
                          onClick={() => navigate(`/matters/${r.matter_id}`)}>
                          {r.matter_title}{r.matter_file_no ? ` (#${r.matter_file_no})` : ''}
                        </Typography>

                        {r.basis && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            근거 — {r.basis}
                          </Typography>
                        )}
                        {/* **누가 이 날짜에 책임을 졌는가** (024). 계정이 지워져도 남는다 */}
                        {!r.is_estimated && r.confirmed_by_email && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            확정 — {r.confirmed_by_email}
                          </Typography>
                        )}
                      </Box>

                      <Stack spacing={0.5} sx={{ flexShrink: 0 }}>
                        {r.is_estimated && (
                          <Button size="small" variant="outlined" disabled={busyId === r.id}
                            onClick={() => confirm(r.id)}>확정</Button>
                        )}
                        <Button size="small" color="inherit" disabled={busyId === r.id}
                          onClick={() => done(r.id)}>완료</Button>
                      </Stack>
                    </Box>
                  ))}
                </Paper>
              </Box>
            );
          })}
        </Stack>
      )}
    </Container>
  );
}
