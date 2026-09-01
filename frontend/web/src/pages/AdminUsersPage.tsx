import { useEffect, useState } from 'react';
import {
  Container, Typography, Box, Card, CardContent, Table, TableHead, TableRow, TableCell,
  TableBody, Button, TextField, MenuItem, Alert, Chip, Stack, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Divider, Box as MuiBox,
} from '@mui/material';
import { apiClient } from '../services/api';
import type { User } from '../types';


/** 무엇이 막고 있는지 **한국어로** 말한다. `matters: 3` 은 관리자에게 아무 뜻이 없다. */
const BLOCKER_LABEL: Record<string, string> = {
  matters: '수사사건', meetings: '조사', customers: '대상자',
  recordings: '녹음', emails: '보낸 메일',
};
const REMOVED_LABEL: Record<string, string> = {
  sessions: '로그인 세션', notifications: '알림', user_scores: '점수',
  learning_cases: '학습 기록', coaching_events: '코칭 판정', element_templates: '요건 템플릿',
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // create form
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [submitting, setSubmitting] = useState(false);

  // 삭제 — **미리보기를 먼저 본다.** 무엇이 사라지는지 모르는 채 누르게 두지 않는다
  const [target, setTarget] = useState<User | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [working, setWorking] = useState(false);
  const [dlgError, setDlgError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.adminListUsers();
      if (res.success) setUsers(res.data as User[]);
      else setError('사용자 목록을 불러오지 못했습니다.');
    } catch (e: any) {
      setError(e?.error?.message || '사용자 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setMsg('');
    try {
      const res = await apiClient.adminCreateUser({ email, name, password, role });
      if (res.success) {
        setMsg(`사용자 생성 완료: ${email}`);
        setEmail(''); setName(''); setPassword(''); setRole('user');
        await load();
      } else {
        setError('사용자 생성에 실패했습니다.');
      }
    } catch (e: any) {
      setError(e?.error?.message || '사용자 생성에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const openDelete = async (u: User) => {
    setTarget(u); setPreview(null); setConfirmText(''); setTransferTo(''); setDlgError('');
    try {
      const res = await apiClient.adminUserDeletion(u.id);
      if (res.success) setPreview(res.data);
    } catch (e: any) {
      setDlgError(e?.error?.message || '미리보기를 불러오지 못했습니다.');
    }
  };

  const doTransfer = async () => {
    if (!target || !transferTo) return;
    setWorking(true); setDlgError('');
    try {
      const res = await apiClient.adminTransferMatters(target.id, transferTo);
      const d = res.data;
      const parts = [['수사사건', d.matters], ['기한', d.deadlines], ['대상자', d.customers],
                     ['조사', d.meetings], ['녹음', d.recordings], ['메일', d.emails]]
        .filter(([, n]) => Number(n) > 0).map(([k, n]) => `${k} ${n}건`);
      setMsg(`${parts.join(' · ') || '옮길 것 없음'} → ${d.to}`);
      await openDelete(target);   // 미리보기를 다시 본다 — 막는 것이 줄었을 것이다
    } catch (e: any) {
      setDlgError(e?.error?.message || '인계에 실패했습니다.');
    }
    setWorking(false);
  };

  const doDelete = async () => {
    if (!target) return;
    setWorking(true); setDlgError('');
    try {
      await apiClient.adminDeleteUser(target.id, confirmText.trim());
      setMsg(`${target.email} 계정을 지웠습니다. 열람 기록(access_log)은 남아 있습니다.`);
      setTarget(null);
      await load();
    } catch (e: any) {
      setDlgError(e?.error?.message || '지우지 못했습니다.');
    }
    setWorking(false);
  };

  const resetPassword = async (u: User) => {
    const next = window.prompt(`${u.email} 의 새 비밀번호를 입력하세요.\n(세션이 모두 끊깁니다)`);
    if (!next) return;
    try {
      await apiClient.adminResetPassword(u.id, next);
      setMsg(`${u.email} 의 비밀번호를 재설정했습니다. 세션은 모두 끊겼습니다.`);
    } catch (e: any) {
      setError(e?.error?.message || '재설정하지 못했습니다.');
    }
  };

  const toggleActive = async (u: User) => {
    try {
      await apiClient.adminSetUserActive(u.id, !(u.isActive ?? true));
      await load();
    } catch (e: any) {
      setError(e?.error?.message || '상태 변경에 실패했습니다.');
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>사용자 관리 (관리자)</Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        관리자가 사용자를 생성·관리합니다. (공개 회원가입 없음)
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2 }}>{msg}</Alert>}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} mb={2}>새 사용자 생성</Typography>
          <form onSubmit={handleCreate}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
              <TextField label="이메일" type="email" size="small" required value={email}
                onChange={(e) => setEmail(e.target.value)} sx={{ minWidth: { xs: '100%', sm: 220 } }} />
              <TextField label="이름" size="small" required value={name}
                onChange={(e) => setName(e.target.value)} />
              <TextField label="비밀번호" type="password" size="small" required value={password}
                onChange={(e) => setPassword(e.target.value)} />
              <TextField label="역할" size="small" select value={role}
                onChange={(e) => setRole(e.target.value)} sx={{ minWidth: 120 }}>
                <MenuItem value="user">사용자</MenuItem>
                <MenuItem value="admin">관리자</MenuItem>
              </TextField>
              <Button type="submit" variant="contained" disabled={submitting} sx={{ height: 40 }}>
                {submitting ? <CircularProgress size={20} color="inherit" /> : '생성'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} mb={2}>
            사용자 목록 {!loading && `(${users.length})`}
          </Typography>
          {loading ? (
            <Box py={4} textAlign="center"><CircularProgress /></Box>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 480 }}>
              <TableHead>
                <TableRow>
                  <TableCell>이메일</TableCell>
                  <TableCell>이름</TableCell>
                  <TableCell>역할</TableCell>
                  <TableCell>상태</TableCell>
                  <TableCell align="right">작업</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{u.name}</TableCell>
                    <TableCell>
                      <Chip size="small" label={u.role === 'admin' ? '관리자' : '사용자'}
                        color={u.role === 'admin' ? 'primary' : 'default'} />
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={(u.isActive ?? true) ? '활성' : '비활성'}
                        color={(u.isActive ?? true) ? 'success' : 'default'} />
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" color="inherit" onClick={() => resetPassword(u)}>
                        비번 재설정
                      </Button>
                      <Button size="small" color="error" onClick={() => openDelete(u)}>
                        삭제
                      </Button>
                      <Button size="small" onClick={() => toggleActive(u)}>
                        {(u.isActive ?? true) ? '비활성화' : '활성화'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* ── 삭제. **무엇이 사라지는지 보여 준 다음에만 지워진다** ── */}
      <Dialog open={!!target} onClose={() => !working && setTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ color: '#991B1B' }}>계정 삭제 — 되돌릴 수 없습니다</DialogTitle>
        <DialogContent>
          {!preview ? (
            <Typography variant="body2" color="text.secondary">확인하는 중…</Typography>
          ) : (() => {
            const blockers = Object.entries(preview.blockers || {}) as [string, number][];
            const removed = Object.entries(preview.removed || {})
              .filter(([, n]) => Number(n) > 0) as [string, number][];
            return (
              <Stack spacing={2.5} mt={0.5}>
                {dlgError && <Alert severity="error" onClose={() => setDlgError('')}>{dlgError}</Alert>}

                <Typography variant="body2">
                  <b>{target?.email}</b> ({target?.name})
                </Typography>

                {blockers.length > 0 ? (
                  <Alert severity="warning">
                    <Typography variant="body2" fontWeight={700}>
                      이 사람이 가진 것이 있어 지울 수 없습니다
                    </Typography>
                    <MuiBox component="ul" sx={{ pl: 2.5, my: 0.5 }}>
                      {blockers.map(([k, n]) => (
                        <Typography component="li" variant="body2" key={k}>
                          {BLOCKER_LABEL[k] || k} <b>{n}</b>건
                        </Typography>
                      ))}
                    </MuiBox>
                    <Typography variant="caption">
                      <b>수사사건은 담당자만 봅니다.</b> 지우거나 잠그기 전에 다른 수사관에게 넘기지 않으면
                      그 수사사건들을 <b>아무도 열 수 없게 됩니다.</b>
                    </Typography>
                  </Alert>
                ) : (
                  <Alert severity="info">
                    막는 것이 없습니다. 아래 함께 지워지는 것을 확인하십시오.
                  </Alert>
                )}

                {/* 인계 — 삭제가 막혔을 때의 유일한 길 */}
                {blockers.length > 0 && (
                  <MuiBox>
                    <Typography variant="subtitle2" fontWeight={700} mb={0.5}>인계</Typography>
                    <Stack direction="row" spacing={1}>
                      <TextField select size="small" fullWidth label="넘겨받을 사람"
                        value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                        {users.filter((u) => u.id !== target?.id && (u.isActive ?? true))
                          .map((u) => (
                            <MenuItem key={u.id} value={u.id}>{u.name} ({u.email})</MenuItem>
                          ))}
                      </TextField>
                      <Button variant="outlined" onClick={doTransfer} disabled={!transferTo || working}>
                        넘기기
                      </Button>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      수사사건·기한·대상자·조사·녹음·메일을 <b>전부</b> 넘깁니다.
                      넘긴 사실은 감사 기록에 남습니다.
                    </Typography>
                  </MuiBox>
                )}

                <Divider />

                <MuiBox>
                  <Typography variant="subtitle2" fontWeight={700} mb={0.5}>함께 지워지는 것</Typography>
                  {removed.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">없습니다.</Typography>
                  ) : (
                    <Typography variant="body2">
                      {removed.map(([k, n]) => `${REMOVED_LABEL[k] || k} ${n}건`).join(' · ')}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                    <b>열람 기록(감사 로그) {preview.kept?.access_log ?? 0}건은 남습니다</b> —
                    누가 무엇을 열었는지는 그 사람이 없어져도 남아야 합니다.
                  </Typography>
                </MuiBox>

                {blockers.length === 0 && (
                  <TextField size="small" fullWidth label="확인" value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={target?.email}
                    helperText={`지우려면 "${target?.email}" 을 그대로 입력하십시오`} />
                )}
              </Stack>
            );
          })()}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTarget(null)} disabled={working}>취소</Button>
          <Button color="error" variant="contained" onClick={doDelete}
            disabled={working || !preview
              || Object.keys(preview.blockers || {}).length > 0
              || confirmText.trim().toLowerCase() !== (target?.email || '').toLowerCase()}>
            {working ? '지우는 중…' : '지웁니다'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
