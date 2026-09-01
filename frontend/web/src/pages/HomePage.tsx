import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  Container, Grid, Card, CardContent, Typography, Box, Button, Chip, Stack,
  Divider, LinearProgress, Skeleton,
} from '@mui/material';
import { apiClient } from '../services/api';
import type { RootState } from '../store';

interface HomeData {
  metrics: { meetingsThisWeek: number; avgScore: number; pendingActions: number; processing: number };
  scoreTrend: number[];
  coaching: { meetingId: string; title: string; points: string[] } | null;
  actionItems: { meetingId: string; title: string; text: string }[];
  followUpsPending: { meetingId: string; title: string; customerName: string | null }[];
  recentMeetings: {
    id: string; title: string; customerName: string | null; overallScore: number | null;
    status: string; createdAt: string;
  }[];
}

const statusLabel = (s: string) =>
  s === 'completed' ? '완료' : s === 'processing' || s === 'pending' ? '분석중' : s === 'failed' ? '실패' : s;
const statusColor = (s: string): any =>
  s === 'completed' ? 'success' : s === 'failed' ? 'error' : 'warning';

function MetricCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ py: 2 }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, color: '#0066CC', lineHeight: 1.2 }}>{value}</Typography>
        {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.getHome();
        if (res.success) setData(res.data as HomeData);
      } catch (e) {
        console.error('Failed to load home', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  const maxTrend = Math.max(100, ...(data?.scoreTrend || [0]));

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" sx={{ fontWeight: 700 }}>
        안녕하세요, {user?.name || ''}님!
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>{today}</Typography>

      {loading ? (
        <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 2, mb: 3 }} />
      ) : (
        <>
          {/* 지표 요약 */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={6} md={3}><MetricCard label="이번주 미팅" value={data?.metrics.meetingsThisWeek ?? 0} sub="건" /></Grid>
            <Grid item xs={6} md={3}><MetricCard label="평균 점수" value={data?.metrics.avgScore ?? 0} sub="/ 100" /></Grid>
            <Grid item xs={6} md={3}><MetricCard label="처리할 액션" value={data?.metrics.pendingActions ?? 0} sub="건" /></Grid>
            <Grid item xs={6} md={3}><MetricCard label="분석 대기/진행" value={data?.metrics.processing ?? 0} sub="건" /></Grid>
          </Grid>

          {/* 핵심 CTA */}
          <Button
            fullWidth variant="contained" size="large"
            onClick={() => navigate('/upload')}
            sx={{ mb: 3, py: 1.8, fontSize: '1.05rem', fontWeight: 700 }}
          >
            ＋ 새 미팅 녹음 / 오디오 업로드
          </Button>

          <Grid container spacing={3}>
            {/* 좌: 성과 + 코칭 */}
            <Grid item xs={12} md={6}>
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="h6" fontWeight={700} mb={1}>📈 내 성과</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 2 }}>
                    <Typography variant="h3" sx={{ fontWeight: 700, color: '#0066CC' }}>{data?.metrics.avgScore ?? 0}</Typography>
                    <Typography variant="body2" color="text.secondary">평균 점수</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">최근 점수 추이</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.75, height: 60, mt: 1 }}>
                    {(data?.scoreTrend || []).length === 0 && (
                      <Typography variant="body2" color="text.secondary">아직 데이터가 없습니다</Typography>
                    )}
                    {(data?.scoreTrend || []).map((s, i) => (
                      <Box key={i} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <Box sx={{ width: '70%', height: `${(s / maxTrend) * 100}%`, bgcolor: '#0066CC', borderRadius: 1, minHeight: 4 }} />
                        <Typography variant="caption" sx={{ fontSize: 10, mt: 0.5 }}>{s}</Typography>
                      </Box>
                    ))}
                  </Box>
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <Typography variant="h6" fontWeight={700} mb={1}>🎯 코칭 요약</Typography>
                  {data?.coaching?.points?.length ? (
                    <Stack spacing={1.2}>
                      {data.coaching.points.map((p, i) => (
                        <Box key={i} sx={{ display: 'flex', gap: 1 }}>
                          <Typography sx={{ color: '#F59E0B' }}>•</Typography>
                          <Typography variant="body2">{p}</Typography>
                        </Box>
                      ))}
                      <Button size="small" sx={{ alignSelf: 'flex-start', mt: 1 }}
                        onClick={() => data.coaching && navigate(`/meetings/${data.coaching.meetingId}`)}>
                        해당 미팅 보기 →
                      </Button>
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      녹음을 업로드하면 발화 비율·질문 기반 코칭이 표시됩니다.
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* 우: 할 일 + 팔로업 */}
            <Grid item xs={12} md={6}>
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="h6" fontWeight={700} mb={1}>✅ 오늘 할 일</Typography>
                  {data?.actionItems?.length ? (
                    <Stack spacing={1}>
                      {data.actionItems.map((a, i) => (
                        <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', pb: 1,
                          borderBottom: i < data.actionItems.length - 1 ? '1px solid #F0F0F0' : 'none' }}>
                          <input type="checkbox" style={{ marginTop: 4 }} />
                          <Box>
                            <Typography variant="body2">{a.text}</Typography>
                            <Typography variant="caption" color="text.secondary"
                              sx={{ cursor: 'pointer' }} onClick={() => navigate(`/meetings/${a.meetingId}`)}>
                              {a.title} →
                            </Typography>
                          </Box>
                        </Box>
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">처리할 액션 아이템이 없습니다.</Typography>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <Typography variant="h6" fontWeight={700} mb={1}>✉️ 팔로업 이메일 대기</Typography>
                  {data?.followUpsPending?.length ? (
                    <Stack spacing={1}>
                      {data.followUpsPending.map((f, i) => (
                        <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Box>
                            <Typography variant="body2" fontWeight={500}>{f.customerName || f.title}</Typography>
                            <Typography variant="caption" color="text.secondary">{f.title}</Typography>
                          </Box>
                          <Button size="small" onClick={() => navigate(`/meetings/${f.meetingId}`)}>초안 보기</Button>
                        </Box>
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">대기 중인 팔로업 이메일이 없습니다.</Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* 최근 미팅 */}
          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6" fontWeight={700}>🕑 최근 미팅</Typography>
                <Button size="small" onClick={() => navigate('/meetings')}>전체 보기 →</Button>
              </Box>
              <Divider sx={{ mb: 1 }} />
              {data?.recentMeetings?.length ? (
                <Stack divider={<Divider />}>
                  {data.recentMeetings.map((m) => (
                    <Box key={m.id} onClick={() => navigate(`/meetings/${m.id}`)}
                      sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.2, cursor: 'pointer',
                        '&:hover': { bgcolor: '#F9FAFB' } }}>
                      <Typography variant="body2" sx={{ flex: 1, fontWeight: 500 }}>{m.title}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ width: { xs: 90, sm: 120 }, flexShrink: 0 }}>
                        {m.customerName || '-'}
                      </Typography>
                      <Typography variant="body2" sx={{ width: 48, fontWeight: 700, color: '#0066CC' }}>
                        {m.overallScore ?? '-'}
                      </Typography>
                      <Chip size="small" label={statusLabel(m.status)} color={statusColor(m.status)} variant="outlined" />
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                  아직 미팅이 없습니다. 위 버튼으로 첫 미팅을 만들어 보세요.
                </Typography>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </Container>
  );
}
