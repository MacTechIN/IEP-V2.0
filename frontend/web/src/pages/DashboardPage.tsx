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
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>통계</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        IEP 는 수사관을 <b>점수로 평가하지 않습니다</b> — 아래는 활동 요약입니다.
      </Typography>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="body2" color="text.secondary">이번주 조사</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                {score.metrics?.meetingsThisWeek ?? 0}
                <Typography component="span" variant="body2" color="text.secondary"> 건</Typography>
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="body2" color="text.secondary">확인 항목 처리율</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                {Math.round((score.metrics?.actionCompletionRate ?? 0) * 100)}
                <Typography component="span" variant="body2" color="text.secondary"> %</Typography>
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2.5, mt: 3, bgcolor: '#F8FAFC' }}>
        <Typography variant="body2" color="text.secondary">
          조사 종류별 분포·진술 분석 확인 항목 통계는 다음 단계에서 추가됩니다.
        </Typography>
      </Paper>
    </Container>
  );
}
