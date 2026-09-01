// 서면 만들기 (029)
//
// 리포트 탭 맨 아래에 붙는다. **서식을 모른다** — 서버가 준 목록을 그대로 그린다.
// 새 서식이 늘어도 이 파일은 안 바뀐다.
//
// ── 세 가지를 지킨다 ──
//
// 1. **재료가 없으면 버튼을 열지 않는다.** 무엇이 없는지 그 자리에 적는다 —
//    「왜 못 만드나」 에 답이 되어야 한다.
// 2. **보낼 자료를 먼저 보여 준다.** 변호사가 읽고 「이건 틀렸다」 를 알아야 보탤 수 있다.
// 3. **변호사가 보탠 것이 자료를 이긴다.** 그렇게 서버에 적혀 있고, 화면도 그렇게 말한다.

import { useEffect, useState } from 'react';
import {
  Paper, Typography, Box, Button, Stack, Alert, TextField, MenuItem,
  Chip, Divider, Collapse, FormControlLabel, Switch, CircularProgress,
} from '@mui/material';
import { apiClient } from '../services/api';

type Param = {
  name: string; label: string; type: string;
  options?: string[]; required?: boolean; hint?: string;
};
type Miss = { msg: string; fix?: 'client' | 'adverseParty' | 'cause' | null };
type Form = {
  kind: string; label: string; description: string;
  params: Param[]; missing: Miss[]; needsInput?: { msg: string; param?: string }[];
};

/** 만든 시각. 같은 날 여러 번 만드므로 **분까지** 보여야 구별된다. */
function fmtWhen(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 16);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 한 줄로 **무엇이 다른지** 적는다.
 *
 * 제목은 `사건명 — 소장` 고정이라 여러 번 만들면 똑같은 줄이 쌓인다.
 * 2026-08-26 에 일곱 줄이 전부 같은 글자로 보였다 — 실제로는 소가도 법원도 달랐다.
 */
function summarize(p: any): string {
  if (!p || typeof p !== 'object') return '소장';
  const bits: string[] = [];
  const amt = Number(p.claimAmount);
  if (amt > 0) {
    bits.push(amt >= 100_000_000 ? `소가 ${(amt / 100_000_000).toLocaleString()}억`
      : amt >= 10_000 ? `소가 ${(amt / 10_000).toLocaleString()}만원`
      : `소가 ${amt.toLocaleString()}원`);
  }
  if (p.court) bits.push(String(p.court));
  if (p.adverseHandling) bits.push(String(p.adverseHandling));
  if (p.scale) bits.push(String(p.scale));
  return bits.length ? bits.join(' · ') : '소장';
}

export default function DocumentBuilder({ matterId, meetingId, onChanged }: {
  matterId: string | null; meetingId: string; onChanged?: () => void;
}) {
  const [forms, setForms] = useState<Form[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [brief, setBrief] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState<Miss[]>([]);
  const [made, setMade] = useState<{ id: string; title: string; body: string } | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [shownBody, setShownBody] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  // 사건에 없는 것을 **그 자리에서** 채운다
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [pickClient, setPickClient] = useState('');
  const [newClient, setNewClient] = useState('');
  const [fixing, setFixing] = useState(false);
  const [fixMsg, setFixMsg] = useState('');
  // 사건에 붙이기 (030)
  const [matters, setMatters] = useState<{ id: string; title: string; cause?: string | null }[]>([]);
  const [pick, setPick] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [attachMsg, setAttachMsg] = useState<{ ok: boolean; text: string; notes: string[] } | null>(null);

  const load = async () => {
    if (!matterId) return;
    try {
      const [a, d] = await Promise.all([
        apiClient.documentsAvailable(matterId, meetingId),
        apiClient.matterDocuments(matterId),
      ]);
      if (a.success) setForms(a.data);
      if (d.success) setDocs(d.data || []);
    } catch { setForms([]); }
  };
  // 원고로 고를 수 있는 사람들. 서면 칸이 열릴 때만 부른다.
  useEffect(() => {
    if (!matterId) return;
    apiClient.getCustomers()
      .then((r) => {
        const rows = r.success ? (r.data?.customers ?? r.data ?? []) : [];
        setClients((Array.isArray(rows) ? rows : []).map((c: any) => ({
          id: c.id, name: c.companyName ?? c.company_name ?? c.name ?? '(이름 없음)',
        })));
      })
      .catch(() => setClients([]));
  }, [matterId]);

  /**
   * 사건에 원고를 붙인다.
   *
   * **서버는 처음부터 `clientId` 를 받고 있었다** — 화면에 칸이 없었을 뿐이다.
   * 막힌 자리에서 풀 수 있어야 한다.
   */
  const setClient = async () => {
    setFixing(true); setFixMsg('');
    try {
      let id = pickClient;
      if (!id && newClient.trim()) {
        const c = await apiClient.createCustomer({ companyName: newClient.trim() });
        if (!c.success) throw new Error('의뢰인을 만들지 못했습니다');
        id = c.data.id;
      }
      if (!id) { setFixMsg('의뢰인을 고르거나 이름을 적으십시오.'); setFixing(false); return; }
      const r = await apiClient.updateMatter(matterId!, { clientId: id });
      if (r.success) { setNewClient(''); setPickClient(''); void load(); onChanged?.(); }
      else setFixMsg('연결하지 못했습니다.');
    } catch (e: any) {
      setFixMsg(e?.error?.message || e?.message || '연결하지 못했습니다.');
    }
    setFixing(false);
  };

  /**
   * 없는 것 한 줄. **어디서 채우는지까지 적는다.**
   *
   * 같은 문구가 두 자리에 나온다 — 버튼을 누르기 전(available)과 누른 뒤(422).
   * 예전에는 앞쪽에만 채울 칸이 붙어 있었다. 누른 사람이 오히려 막혔다.
   */
  const MissingRow = ({ m }: { m: Miss }) => (
    <Box>
      <Typography variant="body2">· {m.msg}</Typography>
      {m.fix === 'client' && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}
          alignItems={{ sm: 'center' }} sx={{ mt: 1, ml: 1.5 }}>
          <TextField select size="small" label="의뢰인 고르기" sx={{ minWidth: 190 }}
            value={pickClient}
            onChange={(e) => { setPickClient(e.target.value); setNewClient(''); }}>
            {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          <Typography variant="caption" color="text.secondary">또는</Typography>
          <TextField size="small" label="새 의뢰인 이름" sx={{ minWidth: 170 }}
            value={newClient}
            onChange={(e) => { setNewClient(e.target.value); setPickClient(''); }} />
          <Button size="small" variant="contained" disabled={fixing}
            onClick={setClient} sx={{ whiteSpace: 'nowrap' }}>
            {fixing ? '연결하는 중…' : '원고로 연결'}
          </Button>
        </Stack>
      )}
      {m.fix === 'adverseParty' && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
          <b>사건</b> 화면 → 그 사건 → <b>상대방</b> 에서 추가하십시오.
          이해충돌 검사의 재료이기도 합니다.
        </Typography>
      )}
      {m.fix === 'cause' && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
          <b>사건</b> 화면에서 청구원인을 정하면 요건사실 목록이 함께 깔립니다.
        </Typography>
      )}
    </Box>
  );

  const openDoc = async (id: string) => {
    if (shown === id) { setShown(null); setShownBody(null); return; }
    setShown(id); setShownBody(null);
    try {
      const r = await apiClient.getDocument(id);
      if (r.success) setShownBody(r.data.body || '(본문이 비어 있습니다)');
    } catch { setShownBody('(불러오지 못했습니다)'); }
  };

  // **지우는 것은 사람이 정한다.** 자동으로 정리하지 않는다 —
  // 어느 것이 쓸모 있는 초안인지는 화면이 알 수 없다.
  const removeDoc = async (id: string) => {
    setConfirmDel(null);
    try {
      await apiClient.deleteDocument(id);
      if (shown === id) { setShown(null); setShownBody(null); }
      void load();
    } catch { /* 목록을 다시 읽으면 드러난다 */ }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [matterId, meetingId]);

  // 붙일 사건 목록. **붙어 있지 않을 때만** 부른다 — 붙은 화면에는 쓸 데가 없다.
  useEffect(() => {
    if (matterId) return;
    apiClient.getMatters()
      .then((r) => { if (r.success) setMatters(r.data || []); })
      .catch(() => setMatters([]));
  }, [matterId]);

  const attach = async () => {
    if (!pick) return;
    setAttaching(true); setAttachMsg(null);
    try {
      const r = await apiClient.attachMeetingToMatter(meetingId, pick);
      if (r.success) {
        const d = r.data;
        setAttachMsg({
          ok: true,
          text: d.rebuilt
            ? `「${d.matterTitle}」 에 연결하고 사건 자료를 채웠습니다 — `
              + `시계열 ${d.timeline} · 증거 ${d.evidence} · 요건사실 ${d.elementsTouched}`
            : `「${d.matterTitle}」 에 연결했습니다.`,
          notes: d.notes || [],
        });
        onChanged?.();
      }
    } catch (e: any) {
      setAttachMsg({ ok: false, text: e?.error?.message || '연결하지 못했습니다.', notes: [] });
    }
    setAttaching(false);
  };

  const detach = async () => {
    setAttaching(true); setAttachMsg(null);
    try {
      const r = await apiClient.detachMeetingFromMatter(meetingId);
      if (r.success) { setAttachMsg({ ok: true, text: '사건에서 뗐습니다.', notes: r.data.notes || [] }); onChanged?.(); }
    } catch (e: any) {
      setAttachMsg({ ok: false, text: e?.error?.message || '떼지 못했습니다.', notes: [] });
    }
    setAttaching(false);
  };

  // **사건에 붙지 않은 상담에서는 서면을 만들 수 없다** — 서면은 사건의 것이다.
  //
  // 예전에는 여기서 「먼저 사건에 연결해야 합니다」 라고만 했다. **연결하는 길이
  // 어디에도 없었다** — 사건은 상담을 만들 때만 고를 수 있었고, 끝난 상담은 방법이 없었다.
  // 막힌 자리에서 바로 풀 수 있어야 한다.
  if (!matterId) {
    return (
      <Paper sx={{ p: 3, mt: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>📄 서면 만들기</Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          이 상담이 <b>사건에 붙어 있지 않습니다.</b> 서면은 사건 자료(시계열·증거·요건사실)로
          만들기 때문에 먼저 사건에 연결해야 합니다.
          연결하면 <b>이미 끝난 분석 결과로 사건 자료를 채웁니다</b> — 다시 분석하지 않습니다.
        </Typography>

        {attachMsg && (
          <Alert severity={attachMsg.ok ? 'success' : 'error'} sx={{ mb: 2 }}
            onClose={() => setAttachMsg(null)}>
            {attachMsg.text}
            {attachMsg.notes.length > 0 && (
              <Box component="ul" sx={{ pl: 2.5, my: 0.5 }}>
                {attachMsg.notes.map((n, i) => (
                  <Typography component="li" variant="body2" key={i}>{n}</Typography>
                ))}
              </Box>
            )}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
          <TextField select size="small" fullWidth label="사건 고르기"
            value={pick} onChange={(e) => setPick(e.target.value)}
            helperText={matters.length === 0 ? '아직 사건이 없습니다 — 사건 화면에서 먼저 만드십시오.' : ' '}>
            {matters.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                {m.title}{m.cause ? ` · ${m.cause}` : ''}
              </MenuItem>
            ))}
          </TextField>
          <Button variant="contained" disabled={!pick || attaching}
            onClick={attach} sx={{ whiteSpace: 'nowrap' }}>
            {attaching ? '연결하는 중…' : '이 사건에 연결'}
          </Button>
        </Stack>
      </Paper>
    );
  }

  const showBrief = async (kind: string) => {
    setBrief(null);
    try {
      const r = await apiClient.documentBrief(matterId, kind, meetingId);
      if (r.success) setBrief(r.data.brief);
    } catch { setBrief('(자료를 불러오지 못했습니다)'); }
  };

  const make = async (kind: string) => {
    setBusy(true); setError(''); setMissing([]); setMade(null);
    try {
      const r = await apiClient.createDocument(matterId, {
        kind, meetingId, params: values,
      });
      if (r.success) { setMade(r.data); void load(); }
    } catch (e: any) {
      // 422 는 **재료가 없다**는 뜻이다. 오류가 아니라 안내로 보여 준다.
      const m = e?.missing || e?.response?.data?.missing;
      // 서버가 {msg, fix} 로 준다. 옛 판(문자열)도 받아 준다.
      if (Array.isArray(m) && m.length) {
        setMissing(m.map((x: any) => typeof x === 'string' ? { msg: x } : x));
      }
      else setError(e?.error?.message || '만들지 못했습니다.');
    }
    setBusy(false);
  };

  return (
    <Paper sx={{ p: 3, mt: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 600 }}>📄 서면 만들기</Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
        이 사건의 요건사실·시계열·증거로 초안을 만듭니다.
        <b> 초안입니다 — 제출 전에 반드시 검토하십시오.</b>
      </Typography>

      {/* **어느 사건에 붙어 있는지 보여 준다.** 잘못 붙였으면 여기서 뗀다 (030) */}
      <Stack direction="row" spacing={1} alignItems="center" mb={2} flexWrap="wrap">
        <Chip size="small" variant="outlined" label="사건에 연결됨" />
        <Button size="small" color="inherit" disabled={attaching} onClick={detach}
          sx={{ color: 'text.secondary' }}>
          {attaching ? '떼는 중…' : '사건에서 떼기'}
        </Button>
      </Stack>

      {attachMsg && (
        <Alert severity={attachMsg.ok ? 'success' : 'error'} sx={{ mb: 2 }}
          onClose={() => setAttachMsg(null)}>
          {attachMsg.text}
          {attachMsg.notes.length > 0 && (
            <Box component="ul" sx={{ pl: 2.5, my: 0.5 }}>
              {attachMsg.notes.map((n, i) => (
                <Typography component="li" variant="body2" key={i}>{n}</Typography>
              ))}
            </Box>
          )}
        </Alert>
      )}

      {forms === null && <CircularProgress size={20} />}

      {docs.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={600} mb={0.5}>
            이미 만든 서면 <Typography component="span" variant="caption" color="text.secondary">
              · {docs.length}건 — <b>다시 만들어도 앞의 것을 덮지 않습니다</b>
            </Typography>
          </Typography>
          <Stack spacing={0.5}>
            {docs.map((d, i) => (
              <Box key={d.id} sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Chip size="small"
                    label={d.status === 'draft' ? '초안' : d.status === 'final' ? '확정' : '제출'} />
                  {i === 0 && <Chip size="small" color="primary" variant="outlined" label="가장 최근" />}
                  {/* **제목은 사건명 고정이라 구별이 안 된다.** 실제로 갈리는 값을 보여 준다. */}
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 180 }}>
                    {summarize(d.params)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {fmtWhen(d.created_at)} · {d.body_chars}자
                  </Typography>
                  <Button size="small" onClick={() => openDoc(d.id)}>
                    {shown === d.id ? '접기' : '보기'}
                  </Button>
                  {confirmDel === d.id ? (
                    <>
                      <Typography variant="caption" color="error">지웁니까?</Typography>
                      <Button size="small" color="error" onClick={() => removeDoc(d.id)}>지움</Button>
                      <Button size="small" color="inherit" onClick={() => setConfirmDel(null)}>취소</Button>
                    </>
                  ) : (
                    <Button size="small" color="inherit" sx={{ color: 'text.secondary' }}
                      onClick={() => setConfirmDel(d.id)}>지우기</Button>
                  )}
                </Stack>
                <Collapse in={shown === d.id}>
                  <Box sx={{ mt: 1, p: 1.5, bgcolor: 'grey.50', border: '1px solid',
                             borderColor: 'divider', borderRadius: 1,
                             maxHeight: 420, overflowY: 'auto' }}>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap',
                                fontFamily: 'monospace', fontSize: '.78rem' }}>
                      {shownBody ?? '불러오는 중…'}
                    </Typography>
                  </Box>
                  {shownBody && (
                    <Button size="small" sx={{ mt: 0.5 }}
                      onClick={() => navigator.clipboard?.writeText(shownBody)}>본문 복사</Button>
                  )}
                </Collapse>
              </Box>
            ))}
          </Stack>
          <Divider sx={{ mt: 1.5 }} />
        </Box>
      )}

      <Stack spacing={1.5}>
        {(forms || []).map((f) => {
          const blocked = f.missing.length > 0;
          const isOpen = open === f.kind;
          return (
            <Box key={f.kind} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                <Typography variant="body1" fontWeight={600}>{f.label}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  {f.description}
                </Typography>
                <Button size="small" variant={isOpen ? 'outlined' : 'contained'}
                  disabled={blocked}
                  onClick={() => { setOpen(isOpen ? null : f.kind); setMade(null); setMissing([]); }}>
                  {isOpen ? '닫기' : blocked ? '만들 수 없음' : '만들기'}
                </Button>
              </Stack>

              {/* **왜 못 만드는지 그 자리에 적는다.** */}
              {blocked && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  <Typography variant="body2" fontWeight={700}>먼저 채워야 합니다</Typography>
                  <Stack spacing={1} sx={{ mt: 0.5 }}>
                    {f.missing.map((m, i) => <MissingRow key={i} m={m} />)}
                  </Stack>
                  {fixMsg && (
                    <Typography variant="caption" color="error" display="block" sx={{ mt: 1 }}>
                      {fixMsg}
                    </Typography>
                  )}
                </Alert>
              )}

              <Collapse in={isOpen}>
                <Stack spacing={2} sx={{ mt: 2 }}>
                  {f.params.map((p) => (
                    p.type === 'boolean' ? (
                      <FormControlLabel key={p.name} sx={{ ml: 0 }}
                        control={<Switch size="small" checked={!!values[p.name]}
                          onChange={(e) => setValues({ ...values, [p.name]: e.target.checked })} />}
                        label={<Typography variant="body2">{p.label}
                          {p.hint && <Typography variant="caption" color="text.secondary"> — {p.hint}</Typography>}
                        </Typography>} />
                    ) : (
                      <TextField key={p.name} size="small" fullWidth
                        select={p.type === 'select'}
                        type={p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text'}
                        multiline={p.name === 'supplement'} minRows={p.name === 'supplement' ? 3 : undefined}
                        label={p.label + (p.required ? ' *' : '')}
                        helperText={p.hint}
                        value={values[p.name] ?? ''}
                        InputLabelProps={p.type === 'date' ? { shrink: true } : undefined}
                        onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}>
                        {(p.options || []).map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                      </TextField>
                    )
                  ))}

                  <Box>
                    <Button size="small" onClick={() => brief === null ? showBrief(f.kind) : setBrief(null)}>
                      {brief === null ? '보낼 자료 보기' : '자료 접기'}
                    </Button>
                    <Typography variant="caption" color="text.secondary" display="block">
                      무엇을 근거로 쓰는지 먼저 보십시오. 틀렸거나 빠진 것은 위
                      <b> 「변호사가 보태는 것」</b>에 적으면 <b>자료보다 우선합니다.</b>
                    </Typography>
                    <Collapse in={brief !== null}>
                      <Box sx={{ mt: 1, p: 1.5, bgcolor: 'grey.50', borderRadius: 1,
                                 maxHeight: 260, overflowY: 'auto' }}>
                        <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                          {brief}
                        </Typography>
                      </Box>
                    </Collapse>
                  </Box>

                  {/* **여기서 채우면 되는 것**은 버튼을 막지 않는다 — 안내로만 둔다 (030) */}
                  {/* **채운 것은 지운다.** 이 목록은 화면이 열릴 때 한 번 받아 온 것이라,
                      법원을 적어 넣은 뒤에도 「관할 법원을 입력하십시오」 가 남아 있었다. */}
                  {(() => {
                    const todo = (f.needsInput ?? []).filter(
                      (m) => !m.param || !String(values[m.param] ?? '').trim());
                    return todo.length > 0 ? (
                      <Alert severity="info">
                        <Typography variant="body2" fontWeight={700}>여기서 채워야 합니다</Typography>
                        <Box component="ul" sx={{ pl: 2.5, my: 0.5 }}>
                          {todo.map((m, i) => (
                            <Typography component="li" variant="body2" key={i}>{m.msg}</Typography>
                          ))}
                        </Box>
                      </Alert>
                    ) : null;
                  })()}

                  {/* **누른 뒤에 나오는 목록도 고칠 수 있어야 한다.**
                      같은 문구인데 한쪽에만 칸이 붙어 있으면, 누른 사람은 막다른 길에 선다. */}
                  {missing.length > 0 && (
                    <Alert severity="warning">
                      <Typography variant="body2" fontWeight={700}>아직 만들 수 없습니다</Typography>
                      <Stack spacing={1} sx={{ mt: 0.5 }}>
                        {missing.map((m, i) => <MissingRow key={i} m={m} />)}
                      </Stack>
                      {fixMsg && (
                        <Typography variant="caption" color="error" display="block" sx={{ mt: 1 }}>
                          {fixMsg}
                        </Typography>
                      )}
                    </Alert>
                  )}
                  {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

                  <Button variant="contained" onClick={() => make(f.kind)} disabled={busy}>
                    {busy ? '만드는 중…' : `${f.label} 초안 만들기`}
                  </Button>
                </Stack>
              </Collapse>
            </Box>
          );
        })}
      </Stack>

      {made && (
        <Box sx={{ mt: 2.5 }}>
          <Alert severity="success" sx={{ mb: 1 }}>
            <b>{made.title}</b> 초안을 만들었습니다. <b>제출 전에 반드시 검토하십시오.</b>
          </Alert>
          <Box sx={{ p: 2, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider',
                     borderRadius: 1, maxHeight: 480, overflowY: 'auto' }}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '.8rem' }}>
              {made.body}
            </Typography>
          </Box>
          <Button size="small" sx={{ mt: 1 }}
            onClick={() => navigator.clipboard?.writeText(made.body)}>
            본문 복사
          </Button>
        </Box>
      )}
    </Paper>
  );
}
