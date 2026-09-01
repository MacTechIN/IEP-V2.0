import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import {
  AppBar, Toolbar, Box, Button, IconButton, Drawer, List, ListItemButton,
  ListItemText, Divider as MuiDivider, useMediaQuery, useTheme, Badge,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import HomePage from './pages/HomePage';
import MeetingListPage from './pages/MeetingListPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import MeetingDetailPage from './pages/MeetingDetailPage';
import LoginPage from './pages/LoginPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminRecordingsPage from './pages/AdminRecordingsPage';
import UploadPage from './pages/UploadPage';
import MatterListPage from './pages/MatterListPage';
import MatterDetailPage from './pages/MatterDetailPage';
import MatterPurgePage from './pages/MatterPurgePage';
import DeadlineDashboardPage from './pages/DeadlineDashboardPage';
import { apiClient } from './services/api';
import { loginSuccess } from './store/slices/authSlice';
import type { RootState } from './store';

function RequireAuth({ children }: { children: ReactNode }) {
  if (!apiClient.isAuthenticated()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * 관리자 화면 가드.
 *
 * **모르면 막는다.** 전에는 `user && user.role !== 'admin'` 이라
 * `user` 가 비어 있으면(내 정보 조회가 실패했거나 아직 안 왔으면) **그냥 통과했다** —
 * 관리자가 아닌 사람에게 관리자 화면이 떠 버린다.
 *
 * 화면을 막는 것은 **친절**이다. 진짜 방어는 서버의 `requireAdmin` 이고,
 * 관리자 경로는 전부 `403` 을 낸다(2026-08-26 실측). 그래도 화면이 뜨면 안 된다 —
 * 뜬 화면은 「내가 쓸 수 있는 기능」으로 읽힌다.
 */
function RequireAdmin({ children }: { children: ReactNode }) {
  const user = useSelector((s: RootState) => s.auth.user);
  if (!apiClient.isAuthenticated()) return <Navigate to="/login" replace />;
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function TopBar() {
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
  const theme = useTheme();
  /**
   * 서랍(햄버거)으로 바꾸는 폭.
   *
   * `sm`(600px)이었는데, 관리자 메뉴까지 하면 항목이 아홉이라
   * **태블릿 폭에서 상단 바가 넘쳤다.** `md`(900px)로 넓힌다 —
   * **항목도 순서도 그대로다.** 담는 그릇만 바뀐다.
   */
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [open, setOpen] = useState(false);

  /**
   * 지났거나 오늘·내일인 기한 개수. **대시보드를 열어야만 알 수 있으면 소용이 없다** —
   * 놓치는 것은 늘 안 열어 본 화면에서 나온다. 그래서 메뉴에 숫자를 붙인다.
   *
   * 10분마다 다시 본다. 더 자주 볼 이유가 없다 — 기한은 날짜 단위로 움직인다.
   */
  const [urgent, setUrgent] = useState(0);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        // 1 = 지났거나 오늘·내일. 대시보드의 위 두 묶음과 **같은 것을 센다** —
        // 숫자와 화면이 어긋나면 둘 다 못 믿게 된다.
        const res = await apiClient.getUpcomingDeadlines(1);
        if (alive && res.success) setUrgent((res.data || []).length);
      } catch { /* 실패해도 화면을 막지 않는다 */ }
    };
    void check();
    const t = setInterval(check, 10 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    navigate('/login');
  };
  const navItems = [
    { to: '/', label: '홈' },
    { to: '/matters', label: '사건' },
    { to: '/deadlines', label: '기한', badge: urgent },
    { to: '/meetings', label: '미팅' },
    { to: '/performance', label: '성과' },
    { to: '/profile', label: '내 프로필' },
    // **저장된 HTML 문서다** (`public/guide.html`) — SPA 라우트가 아니다.
    // 인쇄해서 나눠 줄 수 있어야 해서 문서로 두었다. `external` 이 그것을 표시한다.
    //
    // 주소에 `.html` 을 붙이지 않는다: Cloudflare Pages 가 `/guide.html` 을
    // `/guide` 로 **308 로 정규화**한다. 링크를 최종 주소로 두면 그 왕복이 없다.
    { to: '/guide', label: '사용자 가이드', external: true },
    ...(user?.role === 'admin'
      ? [{ to: '/admin', label: '사용자 관리' }, { to: '/admin/recordings', label: '녹음 관리' }]
      : []),
  ];
  const go = (to: string) => { setOpen(false); navigate(to); };
  const linkStyle = { color: 'white', marginRight: '1.5rem', textDecoration: 'none' };

  return (
    <AppBar position="sticky">
      {/* 좁아지면 밀려나는 대신 줄어든다 — 로고가 화면 밖으로 나가지 않게 */}
      <Toolbar sx={{ gap: 1, minWidth: 0 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Link to="/" style={{ color: 'white', textDecoration: 'none', fontSize: '1.25rem', fontWeight: 700 }}>
            LEP
          </Link>
        </Box>

        {isMobile ? (
          <>
            <IconButton color="inherit" edge="end" onClick={() => setOpen(true)} aria-label="menu">
              <MenuIcon />
            </IconButton>
            <Drawer anchor="right" open={open} onClose={() => setOpen(false)}>
              <Box sx={{ width: 230 }} role="presentation">
                <List>
                  {navItems.map((n) => (
                    <ListItemButton key={n.to}
                      onClick={() => n.external
                        ? (setOpen(false), window.open(n.to, '_blank', 'noopener'))
                        : go(n.to)}>
                      <ListItemText primary={n.label} />
                      {!!n.badge && (
                        <Badge badgeContent={n.badge} color="error" sx={{ mr: 1.5 }} />
                      )}
                    </ListItemButton>
                  ))}
                  <MuiDivider />
                  <ListItemButton onClick={() => { setOpen(false); handleLogout(); }}>
                    <ListItemText primary="로그아웃" primaryTypographyProps={{ color: 'error' }} />
                  </ListItemButton>
                </List>
              </Box>
            </Drawer>
          </>
        ) : (
          <>
            {navItems.map((n) => (
              n.external ? (
                <a key={n.to} href={n.to} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                  {n.label}
                </a>
              ) : (
              <Link key={n.to} to={n.to} style={linkStyle}>
                {n.badge ? (
                  <Badge badgeContent={n.badge} color="error"
                    sx={{ '& .MuiBadge-badge': { right: -12, top: 2 } }}>
                    {n.label}
                  </Badge>
                ) : n.label}
              </Link>
              )
            ))}
            <Button color="inherit" size="small" variant="outlined" onClick={handleLogout} sx={{ ml: 0.5 }}>
              로그아웃
            </Button>
          </>
        )}
      </Toolbar>
    </AppBar>
  );
}

function AuthedLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <TopBar />
      <Box sx={{ bgcolor: '#F9FAFB', minHeight: '100vh' }}>{children}</Box>
    </RequireAuth>
  );
}

export default function App() {
  const dispatch = useDispatch();
  const [ready, setReady] = useState(false);

  // On load, if a token exists, restore the current user into Redux
  // (so role-based nav + greeting survive a page refresh).
  useEffect(() => {
    (async () => {
      if (apiClient.isAuthenticated()) {
        try {
          const res = await apiClient.getMe();
          if (res.success && res.data) {
            dispatch(loginSuccess({
              user: res.data,
              accessToken: localStorage.getItem('accessToken') || '',
              refreshToken: localStorage.getItem('refreshToken') || '',
              expiresIn: 3600,
            } as any));
          }
        } catch {
          /* invalid/expired token — interceptor handles logout */
        }
      }
      setReady(true);
    })();
  }, [dispatch]);

  if (!ready) {
    return <Box sx={{ p: 5, color: 'text.secondary' }}>로딩 중…</Box>;
  }

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<AuthedLayout><HomePage /></AuthedLayout>} />
        <Route path="/matters" element={<AuthedLayout><MatterListPage /></AuthedLayout>} />
        {/* **`:id` 보다 먼저 둔다.** 뒤에 두면 `purge` 를 사건 id 로 읽어 404 가 난다 */}
        <Route path="/matters/purge" element={<AuthedLayout><MatterPurgePage /></AuthedLayout>} />
        <Route path="/matters/:id" element={<AuthedLayout><MatterDetailPage /></AuthedLayout>} />
        <Route path="/deadlines" element={<AuthedLayout><DeadlineDashboardPage /></AuthedLayout>} />
        <Route path="/meetings" element={<AuthedLayout><MeetingListPage /></AuthedLayout>} />
        <Route path="/upload" element={<AuthedLayout><UploadPage /></AuthedLayout>} />
        <Route path="/meetings/:id" element={<AuthedLayout><MeetingDetailPage /></AuthedLayout>} />
        <Route path="/performance" element={<AuthedLayout><DashboardPage /></AuthedLayout>} />
        <Route path="/profile" element={<AuthedLayout><ProfilePage /></AuthedLayout>} />
        <Route
          path="/admin"
          element={<AuthedLayout><RequireAdmin><AdminUsersPage /></RequireAdmin></AuthedLayout>}
        />
        <Route
          path="/admin/recordings"
          element={<AuthedLayout><RequireAdmin><AdminRecordingsPage /></RequireAdmin></AuthedLayout>}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
