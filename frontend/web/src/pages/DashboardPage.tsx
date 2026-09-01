import React, { useEffect, useState } from 'react';
import {
  Box,
  Container,
  Grid,
  Paper,
  Typography,
  Stack,
  LinearProgress,
  Card,
  CardContent,
  Chip,
} from '@mui/material';
import { apiClient } from '../services/api';
import type { UserScore } from '../types';

export default function DashboardPage() {
  const [score, setScore] = useState<UserScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScore = async () => {
      try {
        const response = await apiClient.getDashboard();
        if (response.success && response.data) {
          setScore(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchScore();
  }, []);

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Typography>로딩 중...</Typography>
      </Container>
    );
  }

  if (!score) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Typography>대시보드를 불러올 수 없습니다.</Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" sx={{ mb: 4, fontWeight: 700 }}>
        나의 성과
      </Typography>

      {/* 점수 카드 */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="textSecondary" sx={{ mb: 1 }}>
              현재 점수
            </Typography>
            <Typography variant="h3" sx={{ color: '#0066CC', fontWeight: 700 }}>
              {score.currentScore}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              / 100
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="textSecondary" sx={{ mb: 1 }}>
              주간 점수
            </Typography>
            <Typography variant="h3" sx={{ color: '#10B981', fontWeight: 700 }}>
              {score.weeklyScore}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              이번주
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="textSecondary" sx={{ mb: 1 }}>
              월간 점수
            </Typography>
            <Typography variant="h3" sx={{ color: '#F59E0B', fontWeight: 700 }}>
              {score.monthlyScore}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              이번달
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="textSecondary" sx={{ mb: 1 }}>
              미팅 횟수
            </Typography>
            <Typography variant="h3" sx={{ color: '#8B5CF6', fontWeight: 700 }}>
              {score.metrics.meetingsThisWeek}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              이번주
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* 역량 분석 */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
          역량 분석
        </Typography>
        <Stack spacing={2}>
          {Object.entries(score.scoreComponents).map(([key, value]) => (
            <Box key={key}>
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
                <Typography variant="body2" sx={{ color: '#0066CC', fontWeight: 600 }}>
                  {value}점
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={value}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: '#E5E7EB',
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 4,
                    backgroundColor: '#0066CC',
                  },
                }}
              />
            </Box>
          ))}
        </Stack>
      </Paper>

      {/* 랭킹 및 통계 */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
              팀 내 순위
            </Typography>
            <Box sx={{ textAlign: 'center', mb: 3 }}>
              <Typography variant="h2" sx={{ color: '#0066CC', fontWeight: 700 }}>
                {score.weeklyRank}위
              </Typography>
              <Typography variant="body2" color="textSecondary">
                전체 팀원 중
              </Typography>
            </Box>
            <Chip
              label={`주간 평균 점수: ${Math.round(score.weeklyScore / 4)}점`}
              sx={{ width: '100%', height: 'auto', py: 1 }}
            />
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 3, fontWeight: 600 }}>
              활동 통계
            </Typography>
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="textSecondary">
                  액션 완료율
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, color: '#10B981' }}>
                  {Math.round(score.metrics.actionCompletionRate * 100)}%
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="textSecondary">
                  고객 만족도
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, color: '#0066CC' }}>
                  {score.metrics.customerSatisfaction.toFixed(1)}/10
                </Typography>
              </Box>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
}
