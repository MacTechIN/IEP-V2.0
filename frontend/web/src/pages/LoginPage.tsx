import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert, CircularProgress,
} from '@mui/material';
import { apiClient } from '../services/api';
import { loginSuccess } from '../store/slices/authSlice';

export default function LoginPage() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  /**
   * **비워 둔다.** 개발할 때 넣어 둔 기본값(`admin@company.com` / `password123`)이
   * 그대로 남아 있었다 — 처음 열어 본 사람에게 **남의 계정이 적혀 있는 화면**이 뜨고,
   * 그 계정이 실재하는지까지 알려 준다. 로그인 화면은 아무것도 말해 주지 않아야 한다.
   */
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiClient.login(email, password);
      if (res.success) {
        if (res.data) dispatch(loginSuccess(res.data));
        // **하드 이동.** SPA 의 navigate('/') 는 일부 모바일/인앱 브라우저에서
        // 라우트가 안 붙어 「로그인만 되고 화면이 안 바뀌는」 일이 있었다.
        // 토큰은 이미 localStorage 에 저장됐으므로, 새로 떠도 바로 홈으로 들어간다.
        window.location.assign('/');
      } else {
        setError('로그인에 실패했습니다. 아이디/비밀번호를 확인하세요.');
      }
    } catch (err: any) {
      setError(err?.error?.message || '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#F9FAFB',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 400, boxShadow: 3 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" fontWeight={700} textAlign="center" gutterBottom>
            IEP
          </Typography>
          <Typography variant="body2" color="text.secondary" textAlign="center" mb={3}>
            수사관을 위한 조사 분석 플랫폼
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <form onSubmit={handleSubmit}>
            <TextField
              label="아이디"
              type="text"
              fullWidth
              margin="normal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <TextField
              label="비밀번호"
              type="password"
              fullWidth
              margin="normal"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              disabled={loading}
              sx={{ mt: 3 }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : '로그인'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
