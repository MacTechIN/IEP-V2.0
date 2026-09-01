// 사건 목록 + 새 사건 (016~022)
//
// **새 사건을 만들 때 이해충돌을 먼저 본다.** 사무장 업무의 첫 관문이고,
// 놓치면 수임 자체가 문제가 된다.
//
// 다만 **막지 않는다.** 동명이인일 수도 있고 이미 종결된 사건이라 문제가 없을 수도 있다.
// 우리가 할 일은 놓치지 않게 하는 것이지 결정하는 것이 아니다
// (`CLAUDE.md` — 목록을 보여 주고 사람이 정한다).

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container, Card, CardContent, Typography, Button, Stack, Box, Chip, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, MenuItem, Divider,
} from '@mui/material';
import { apiClient } from '../services/api';

const STATUS_UI: Record<string, { label: string; color: string }> = {
  open: { label: '진행', color: '#166534' },
  closed: { label: '종결', color: '#334155' },
  archived: { label: '보관', color: '#78716C' },
};

/** 018 이 시드로 넣은 셋. 사무소가 늘리면 표에서 읽어 오게 바꾼다. */
const CAUSES = ['채무불이행', '불법행위', '부당이득'];
const MATTER_TYPES = ['민사', '형사', '가사', '행정', '자문', '기타'];

export default function MatterListPage() {
  const navigate = useNavigate();
  const [matters, setMatters] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', cause: '', matterType: '', fileNo: '', notes: '' });
  const [adverseName, setAdverseName] = useState('');
  // **의뢰인(원고).** 서버는 처음부터 `clientId` 를 받고 있었는데 이 폼이 안 보냈다 —
  // 그래서 소장을 만들 때 「원고가 연결되어 있지 않습니다」 로 막히고, 붙일 칸도 없었다.
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [clientId, setClientId] = useState('');
  const [newClient, setNewClient] = useState('');
  const [conflict, setConflict] = useState<any | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.getMatters(filter || undefined);
      if (res.success) setMatters(res.data || []);
    } catch { setError('사건을 불러오지 못했습니다.'); }
    setLoading(false);
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [filter]);

  /**
   * 이해충돌 검사. **입력할 때마다 부르지 않는다** — 이름을 다 적고 누를 때 본다.
   * 타이핑마다 부르면 절반쯤 적힌 이름으로 조회하게 되고, 그 결과는 아무 뜻이 없다.
   */
  const runConflictCheck = async () => {
    const name = adverseName.trim() || form.title.trim();
    if (!name) return;
    setChecking(true);
    try {
      const res = await apiClient.checkConflict(name);
      if (res.success) setConflict({ name, ...res.data });
    } catch { /* 검사 실패가 사건 생성을 막지는 않는다 */ }
    setChecking(false);
  };

  useEffect(() => {
    if (!open) return;
    apiClient.getCustomers()
      .then((r) => {
        const rows = r.success ? (r.data?.customers ?? r.data ?? []) : [];
        setClients((Array.isArray(rows) ? rows : []).map((c: any) => ({
          id: c.id, name: c.companyName ?? c.company_name ?? c.name ?? '(이름 없음)',
        })));
      })
      .catch(() => setClients([]));
  }, [open]);

  const create = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      // 새 이름을 적었으면 의뢰인을 먼저 만든다.
      let cid = clientId;
      if (!cid && newClient.trim()) {
        const c = await apiClient.createCustomer({ companyName: newClient.trim() }).catch(() => null);
        if (c?.success) cid = c.data.id;
      }
      const res = await apiClient.createMatter({
        title: form.title.trim(), cause: form.cause || undefined,
        clientId: cid || undefined,
        matterType: form.matterType || undefined, fileNo: form.fileNo || undefined,
        notes: form.notes || undefined,
        openedOn: new Date().toISOString().slice(0, 10),
      });
      if (res.success) {
        const id = res.data.id;
        // 상대방을 적어 뒀으면 함께 넣는다 — 다음 이해충돌 검사의 재료가 된다.
        if (adverseName.trim()) {
          await apiClient.addAdverseParty(id, { name: adverseName.trim(), role: '상대방' })
            .catch(() => {});
        }
        setOpen(false);
        setForm({ title: '', cause: '', matterType: '', fileNo: '', notes: '' });
        setAdverseName(''); setConflict(null);
        setClientId(''); setNewClient('');
        navigate(`/matters/${id}`);
      }
    } catch (e: any) {
      setError(e?.error?.message || '사건을 만들지 못했습니다.');
    }
    setSaving(false);
  };

  const hit = conflict && (conflict.asAdverse?.length || conflict.asClient?.length);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography variant="h5" fontWeight={700}>사건</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          {/* 지우는 일은 눈에 띄게 두지 않는다 — 찾으면 있고, 실수로 누를 자리는 아니다 */}
          <Button size="small" color="inherit" sx={{ color: 'text.secondary' }}
            onClick={() => navigate('/matters/purge')}>정리</Button>
          <Button variant="contained" onClick={() => setOpen(true)}>새 사건</Button>
        </Stack>
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={3}>
        상담·기한·요건·증거가 사건 하나로 모입니다.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Stack direction="row" spacing={1} mb={2}>
        {[['open', '진행'], ['closed', '종결'], ['', '전체']].map(([v, label]) => (
          <Button key={label} size="small" variant={filter === v ? 'contained' : 'outlined'}
            onClick={() => setFilter(v)}>{label}</Button>
        ))}
      </Stack>

      {loading ? (
        <Typography variant="body2" color="text.secondary">불러오는 중…</Typography>
      ) : matters.length === 0 ? (
        <Card><CardContent>
          <Typography variant="body2" color="text.secondary">
            {filter === 'open' ? '진행 중인 사건이 없습니다.' : '사건이 없습니다.'}
          </Typography>
        </CardContent></Card>
      ) : (
        <Stack spacing={1.5}>
          {matters.map((m) => {
            const st = STATUS_UI[m.status] || STATUS_UI.open;
            return (
              <Card key={m.id} sx={{ cursor: 'pointer' }} onClick={() => navigate(`/matters/${m.id}`)}>
                <CardContent sx={{ py: 2 }}>
                  <Stack direction="row" alignItems="center" spacing={1} mb={0.5} flexWrap="wrap">
                    <Chip size="small" label={st.label}
                      sx={{ bgcolor: st.color, color: '#fff', height: 20 }} />
                    <Typography variant="subtitle1" fontWeight={600}>{m.title}</Typography>
                    {m.fileNo && (
                      <Typography variant="caption" color="text.secondary">#{m.fileNo}</Typography>
                    )}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {[m.clientName, m.matterType, m.cause].filter(Boolean).join(' · ') || '—'}
                  </Typography>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}

      {/* ── 새 사건 ── */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>새 사건</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} mt={0.5}>
            <TextField label="사건명" required fullWidth value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="예: 대여금 반환 청구" />
            <Stack direction="row" spacing={2}>
              <TextField select label="사건 유형" fullWidth value={form.matterType}
                onChange={(e) => setForm({ ...form, matterType: e.target.value })}>
                <MenuItem value="">선택 안 함</MenuItem>
                {MATTER_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <TextField select label="청구원인" fullWidth value={form.cause}
                onChange={(e) => setForm({ ...form, cause: e.target.value })}
                helperText="정하면 요건 체크리스트가 깔립니다">
                <MenuItem value="">나중에</MenuItem>
                {CAUSES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
            </Stack>
            <TextField label="사무소 사건번호 (선택)" fullWidth value={form.fileNo}
              onChange={(e) => setForm({ ...form, fileNo: e.target.value })} />

            <Divider />

            {/* **이해충돌은 사건을 만들기 전에 본다.** 만든 뒤에 알면 늦다. */}
            <Box>
              <Typography variant="subtitle2" fontWeight={700} mb={0.5}>이해충돌 확인</Typography>
              <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                상대방 이름을 적고 확인하세요. 표기가 달라도 찾습니다 (㈜·주식회사·괄호).
              </Typography>
              <Stack direction="row" spacing={1}>
                <TextField select size="small" sx={{ minWidth: 170 }} label="의뢰인(원고)"
                  value={clientId}
                  onChange={(e) => { setClientId(e.target.value); setNewClient(''); }}
                  helperText="소장의 원고가 됩니다">
                  {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                </TextField>
                <TextField size="small" sx={{ minWidth: 150 }} label="새 의뢰인 이름"
                  value={newClient}
                  onChange={(e) => { setNewClient(e.target.value); setClientId(''); }}
                  helperText="목록에 없으면 여기에" />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
                <TextField size="small" fullWidth label="상대방" value={adverseName}
                  onChange={(e) => { setAdverseName(e.target.value); setConflict(null); }}
                  placeholder="예: 주식회사 다라" />
                <Button variant="outlined" onClick={runConflictCheck}
                  disabled={checking || !(adverseName.trim() || form.title.trim())}>
                  {checking ? '확인 중' : '확인'}
                </Button>
              </Stack>

              {conflict && (
                hit ? (
                  <Alert severity="warning" sx={{ mt: 1.5 }}>
                    <Typography variant="body2" fontWeight={700}>
                      같은 이름이 이미 있습니다 — 확인하고 진행하세요
                    </Typography>
                    <Box component="ul" sx={{ pl: 2.5, my: 0.5 }}>
                      {conflict.asAdverse?.map((a: any, i: number) => (
                        <Typography component="li" variant="body2" key={`a${i}`}>
                          <b>{a.name}</b> — 사건 「{a.title}」의 {a.role || '상대방'} ({a.status})
                        </Typography>
                      ))}
                      {conflict.asClient?.map((c: any, i: number) => (
                        <Typography component="li" variant="body2" key={`c${i}`}>
                          <b>{c.name}</b> — <b>기존 의뢰인</b>입니다
                        </Typography>
                      ))}
                    </Box>
                    <Typography variant="caption">
                      동명이인이거나 종결된 사건일 수 있습니다. <b>판단은 직접 하십시오.</b>
                    </Typography>
                  </Alert>
                ) : (
                  <Alert severity="success" sx={{ mt: 1.5 }}>
                    <Typography variant="body2">
                      「{conflict.name}」과 겹치는 기록이 없습니다.
                    </Typography>
                  </Alert>
                )
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>취소</Button>
          <Button variant="contained" onClick={create} disabled={saving || !form.title.trim()}>
            {saving ? '만드는 중…' : '사건 만들기'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
