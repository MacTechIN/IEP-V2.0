// 사건 하나 (016~025)
//
// **한 화면에 모이는 것이 이 제품의 값이다** — 조사·기한·요건·시계열·증거가
// 흩어져 있으면 사건을 파악할 수 없다.
//
// ── 순서는 사건의 단계에 따라 바뀐다 (2026-08-26) ──
//
// 처음엔 「기한 → 요건 → 조사」 으로 고정해 뒀다. 기한이 맨 위인 이유는
// **놓치면 되돌릴 수 없기 때문**이고, 그건 지금도 맞다.
//
// 그런데 **아직 조사가 없는 사건**에서는 그 순서가 거짓말을 한다 —
// 기한은 비어 있고, 요건 넷은 전부 빨간 「없음」 으로 서 있다.
// 문제처럼 보이지만 문제가 아니라 **아직 시작을 안 한 것**이다.
//
// 실제 흐름은 이렇다:  **조사 녹음 → 분석이 요건을 채움 → 사람이 고치고 더함.**
// `legalPersist` 가 조사 분석 결과로 `legal_elements` 를 쓴다 — 조사가 요건의 상류다.
//
// 그래서 —
//   조사가 없으면:  **「사건 조사를 시작하십시오」 가 맨 위.** 무엇부터 할지 말해 준다
//   조사가 있으면:  기한 → 조사 → 요건 → 시계열 → 증거.
//                   기한이 다시 맨 위다. 그때부터는 놓치면 안 되는 것이 먼저다
//
// **기한을 조건 없이 내리지는 않았다.** 조사 전에 소멸시효를 먼저 넣어 두는 사건이 있다 —
// 그런 사건에서 기한이 아래로 밀리면 넣어 둔 의미가 없다.
//
// 조사를 요건 **위**로 올린 것도 같은 이유다: 요건은 조사에서 나온 결과이지 원인이 아니다.

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container, Paper, Typography, Stack, Box, Chip, Button, Alert, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
} from '@mui/material';
import { apiClient } from '../services/api';

const DEADLINE_KINDS: Record<string, string> = {
  prescription: '소멸시효', exclusion: '제척기간', appeal: '항소·상고',
  filing: '서면 제출', hearing: '기일', notice: '통지·최고', other: '기타',
};
const ELEMENT_UI: Record<string, { label: string; c: string }> = {
  SATISFIED: { label: '충족', c: '#166534' },
  PARTIAL: { label: '일부', c: '#92400E' },
  CONTESTED: { label: '다툼', c: '#1E40AF' },
  MISSING: { label: '없음', c: '#991B1B' },
};
const EVIDENCE_UI: Record<string, { label: string; c: string }> = {
  SECURED: { label: '확보', c: '#166534' },
  PROMISED: { label: '받기로', c: '#92400E' },
  UNCONFIRMED: { label: '미확인', c: '#334155' },
  NON_EXISTENT: { label: '없음', c: '#991B1B' },
};

export default function MatterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [m, setM] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [dlOpen, setDlOpen] = useState(false);
  const [dl, setDl] = useState({ kind: 'filing', title: '', dueOn: '', basis: '' });
  const [dlError, setDlError] = useState('');
  // **불러오기 실패와 행동 실패를 갈라 둔다.** 하나로 두면 「완료」 한 번 실패에
  // 사건 화면 전체가 사라진다 — 이미 보고 있던 것까지 잃는다.
  const [actionError, setActionError] = useState('');
  const [elOpen, setElOpen] = useState(false);
  const [el, setEl] = useState({ element: '', note: '' });
  const [elError, setElError] = useState('');

  const load = async () => {
    if (!id) return;
    try {
      const res = await apiClient.getMatter(id);
      if (res.success) setM(res.data);
      else setError('사건을 찾을 수 없습니다.');
    } catch { setError('사건을 찾을 수 없습니다. 담당자만 열 수 있습니다.'); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [id]);

  /**
   * **실패를 삼키지 않는다.** 처음엔 `.catch(() => {})` 였는데, 서버가 500 을 내던
   * 동안 화면은 조용히 창만 닫고 기한은 생기지 않았다 — 누른 사람에게는
   * 버튼이 고장난 것으로도 보이지 않는다 (2026-08-26).
   */
  const addDeadline = async () => {
    if (!id || !dl.title.trim() || !dl.dueOn) return;
    try {
      // 사람이 직접 넣은 것은 확정이다. AI 가 뽑은 것만 추정으로 남는다 (017).
      await apiClient.addDeadline(id, { ...dl, isEstimated: false });
      setDlOpen(false); setDl({ kind: 'filing', title: '', dueOn: '', basis: '' });
      void load();
    } catch (e: any) {
      setDlError(e?.error?.message || '기한을 추가하지 못했습니다.');
    }
  };

  /** 상태를 바꾸면 **사람이 정한 것**이 된다 (025) — 그 뒤로 AI 분석이 덮지 않는다. */
  const setElementStatus = async (eid: string, status: string) => {
    try { await apiClient.updateElement(eid, { status }); void load(); }
    catch (e: any) { setActionError(e?.error?.message || '요건 상태를 바꾸지 못했습니다.'); }
  };
  /** 다시 AI 에 맡긴다. 되돌리는 것도 사람만 할 수 있다. */
  const releaseElement = async (eid: string) => {
    try { await apiClient.updateElement(eid, { setBy: 'ai' }); void load(); }
    catch (e: any) { setActionError(e?.error?.message || '되돌리지 못했습니다.'); }
  };
  const removeElement = async (eid: string, name: string) => {
    // **되돌릴 수 없다.** 한 번 묻는다
    if (!window.confirm(`요건 「${name}」 을 뺍니다. 되돌릴 수 없습니다.`)) return;
    try { await apiClient.deleteElement(eid); void load(); }
    catch (e: any) { setActionError(e?.error?.message || '빼지 못했습니다.'); }
  };
  const addElement = async () => {
    if (!id || !el.element.trim()) return;
    try {
      await apiClient.addElement(id, { element: el.element.trim(), note: el.note || undefined });
      setElOpen(false); setEl({ element: '', note: '' });
      void load();
    } catch (e: any) {
      setElError(e?.error?.message || '요건을 더하지 못했습니다.');
    }
  };

  const confirmDeadline = async (did: string) => {
    try { await apiClient.confirmDeadline(did); void load(); }
    catch (e: any) { setActionError(e?.error?.message || '확정하지 못했습니다.'); }
  };
  const doneDeadline = async (did: string) => {
    try { await apiClient.updateDeadline(did, { status: 'done' }); void load(); }
    catch (e: any) { setActionError(e?.error?.message || '완료로 바꾸지 못했습니다.'); }
  };

  if (error) return <Container maxWidth="md" sx={{ py: 4 }}><Alert severity="error">{error}</Alert></Container>;
  if (!m) return <Container maxWidth="md" sx={{ py: 4 }}><Typography>불러오는 중…</Typography></Container>;

  const openDeadlines = (m.deadlines || []).filter((d: any) => d.status === 'open');
  // **조사가 하나라도 있으면 조사가 시작된 사건이다.** 화면의 순서가 여기서 갈린다.
  const hasMeetings = (m.meetings || []).length > 0;
  /**
   * 아직 조사가 시작되지 않은 사건인가.
   *
   * **기한이 있으면 기한이 먼저다.** 조사 전에 소멸시효를 먼저 넣어 두는 사건이 있고,
   * 그런 사건에서 기한이 아래로 밀리면 넣어 둔 의미가 없다 —
   * 지난 기한 여섯 건을 깔고 앉은 채 「시작하십시오」 라고 말하면 안 된다.
   */
  const startsHere = !hasMeetings;
  const missing = (m.elements || []).filter((e: any) => e.status === 'MISSING' || e.status === 'PARTIAL');

  const startCard = (
        <Paper sx={{ p: 3, mb: 3, border: '1.5px solid', borderColor: 'primary.main' }}>
          <Typography variant="subtitle2" fontWeight={700} mb={0.5}>
            사건 조사를 시작하십시오
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            조사를 녹음하면 그 내용에서 <b>요건사실·시계열·증거</b>가 채워집니다.
            채워진 것을 보고 고치거나 더하는 것이 다음 순서입니다.
          </Typography>
          <Button variant="contained" onClick={() => navigate(`/upload?matter=${m.id}`)}>
            새 조사 녹음
          </Button>
          <Typography variant="caption" color="text.secondary" display="block" mt={1.5}>
            이 사건이 이미 골라진 채로 녹음 화면이 열립니다.
            {openDeadlines.length > 0
              ? ' 기한은 위에 이미 들어와 있습니다.'
              : ' 기한처럼 이미 아는 것이 있다면 아래에서 먼저 넣어 두셔도 됩니다.'}
          </Typography>
        </Paper>
  );

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      {/* 비닉권 (021). 사건은 기본이 대상이다 */}
      {m.privileged && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: '#FEF2F2', border: '1.5px solid #FCA5A5' }}>
          <Typography variant="body2" sx={{ color: '#991B1B', fontWeight: 700 }}>
            비밀유지 · 비닉권 대상
          </Typography>
        </Paper>
      )}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" mb={1}>
          <Typography variant="h5" fontWeight={700}>{m.title}</Typography>
          {m.fileNo && <Chip size="small" label={`#${m.fileNo}`} />}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {[m.clientName, m.matterType, m.cause, m.court].filter(Boolean).join(' · ') || '—'}
        </Typography>
        {(m.adverseParties || []).length > 0 && (
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            상대방 — {m.adverseParties.map((a: any) => a.name).join(', ')}
          </Typography>
        )}
        {m.notes && <Typography variant="body2" mt={1.5}>{m.notes}</Typography>}
      </Paper>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError('')}>{actionError}</Alert>
      )}


      {/*
        ── 사건 조사의 시작 ──

        **조사가 요건의 상류다.** `legalPersist` 가 조사 분석 결과로 `legal_elements` 를
        채운다 — 즉 녹음이 없으면 요건은 영원히 「없음」 이다.

        그런데 조사가 아직 없는 사건에서 요건 넷이 전부 빨간 「없음」 으로 서 있으면
        **문제처럼 읽힌다.** 문제가 아니라 아직 시작을 안 한 것이다.
        그래서 조사가 하나도 없을 때는 **무엇부터 해야 하는지**를 맨 위에 둔다.

        조사가 생기면 이 블록은 사라지고 기한이 맨 위로 돌아간다 —
        그때부터는 「놓치면 되돌릴 수 없는 것」 이 먼저다.
      */}
      {/* 기한이 없을 때만 맨 위다 — 있으면 기한이 먼저고 이 블록은 그 아래로 간다 */}
      {startsHere && openDeadlines.length === 0 && startCard}

      {/* ── 기한 ──
          조사가 시작된 사건에서는 **이것이 맨 위다 — 놓치면 되돌릴 수 없다.**
          아직 조사가 없는 사건에서만 위의 「시작」 블록에 자리를 내준다. */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
          <Typography variant="subtitle2" fontWeight={700}>기한</Typography>
          <Button size="small" variant="outlined" onClick={() => setDlOpen(true)}>기한 추가</Button>
        </Stack>
        {openDeadlines.length === 0 ? (
          <Typography variant="body2" color="text.secondary">열려 있는 기한이 없습니다.</Typography>
        ) : (
          <Stack spacing={1.25}>
            {openDeadlines.map((d: any) => {
              const over = d.days_left < 0;
              const near = d.days_left >= 0 && d.days_left <= 7;
              const c = over ? '#991B1B' : near ? '#92400E' : '#334155';
              return (
                <Box key={d.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                  <Box sx={{ minWidth: 76 }}>
                    <Typography variant="body2" sx={{ color: c, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {over ? `${-d.days_left}일 지남` : `D-${d.days_left}`}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {String(d.due_on).slice(0, 10)}
                    </Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                      <Chip size="small" label={DEADLINE_KINDS[d.kind] || d.kind} sx={{ height: 20 }} />
                      <Typography variant="body2" fontWeight={500}>{d.title}</Typography>
                      {/* **추정을 확정처럼 보여 주지 않는다** (017) */}
                      {d.is_estimated && (
                        <Chip size="small" label="추정 — 확인 필요"
                          sx={{ height: 20, bgcolor: '#FFFBEB', color: '#92400E',
                                border: '1px solid #FCD34D' }} />
                      )}
                    </Stack>
                    {d.basis && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        근거 — {d.basis}
                      </Typography>
                    )}
                    {/* 계정이 지워져도 남는다 (024) */}
                    {!d.is_estimated && d.confirmed_by_email && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        확정 — {d.confirmed_by_email}
                      </Typography>
                    )}
                  </Box>
                  <Stack direction="row" spacing={0.5}>
                    {d.is_estimated && (
                      <Button size="small" onClick={() => confirmDeadline(d.id)}>확정</Button>
                    )}
                    <Button size="small" color="inherit" onClick={() => doneDeadline(d.id)}>완료</Button>
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        )}
      </Paper>

      {/* 기한이 있는 사건에서는 기한을 먼저 보여 주고 여기서 시작을 안내한다 */}
      {startsHere && openDeadlines.length > 0 && startCard}

      {/* ── 조사 ── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
          <Typography variant="subtitle2" fontWeight={700}>
            조사 ({(m.meetings || []).length})
          </Typography>
          {/* 이 사건이 이미 골라진 채로 녹음 화면이 열린다 — 고르는 것을 잊지 않게 */}
          <Button size="small" variant="outlined" onClick={() => navigate(`/upload?matter=${m.id}`)}>
            새 조사 녹음
          </Button>
        </Stack>
        {(m.meetings || []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            아직 조사가 없습니다. 위 「새 조사 녹음」으로 시작하면 여기 모입니다.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {m.meetings.map((mt: any) => (
              <Box key={mt.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'center', cursor: 'pointer' }}
                onClick={() => navigate(`/meetings/${mt.id}`)}>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 92 }}>
                  {String(mt.start_time).slice(0, 10)}
                </Typography>
                <Typography variant="body2" sx={{ flex: 1 }}>{mt.title}</Typography>
                <Chip size="small" label={mt.analysis_status === 'completed' ? '분석완료' : '대기'}
                  sx={{ height: 20 }} />
              </Box>
            ))}
          </Stack>
        )}
      </Paper>


      {/* ── 요건 ──
          템플릿(`element_templates`)은 **민법 조문에서 뽑은 뼈대**일 뿐이다.
          사건마다 다투는 자리가 다르므로 **고칠 수 있어야 한다** — 못 고치면 곧 안 보게 된다. */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={0.5}>
          <Typography variant="subtitle2" fontWeight={700}>요건사실</Typography>
          <Button size="small" variant="outlined" onClick={() => setElOpen(true)}>요건 추가</Button>
        </Stack>
        {/* **조사가 없을 때 「없음」 은 문제가 아니다.** 아직 시작을 안 한 것이다 —
            그렇게 말해 주지 않으면 빨간 칩 넷이 경보로 읽힌다. */}
        <Typography variant="caption" color="text.secondary" display="block" mb={1.5}>
          {m.cause || '청구원인 미정'}
          {!hasMeetings
            ? ' · 조사를 녹음하면 여기가 채워집니다. 지금 직접 정해 두셔도 됩니다'
            : ` · 아직 채워지지 않은 것 ${missing.length}개`}
          {m.cause ? '' : ' · 사건 정보에서 청구원인을 정하면 표준 요건이 깔립니다'}
        </Typography>

        {(m.elements || []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            요건이 없습니다. 청구원인을 정하거나 직접 추가하십시오.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {m.elements.map((e: any) => {
              const u = ELEMENT_UI[e.status] || ELEMENT_UI.MISSING;
              const mine = e.set_by === 'human';
              return (
                <Box key={e.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                  {/* 상태를 눌러 바꾼다. **누르는 순간 사람이 정한 것이 된다** (025) */}
                  <TextField select size="small" variant="standard" value={e.status}
                    onChange={(ev) => setElementStatus(e.id, ev.target.value)}
                    sx={{ minWidth: 78 }}
                    InputProps={{ disableUnderline: true }}
                    SelectProps={{ renderValue: () => (
                      <Chip size="small" label={u.label}
                        sx={{ bgcolor: u.c, color: '#fff', height: 20, minWidth: 44 }} />
                    ) }}>
                    {Object.entries(ELEMENT_UI).map(([k, v]) => (
                      <MenuItem key={k} value={k}>{v.label}</MenuItem>
                    ))}
                  </TextField>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" fontWeight={500}>{e.element}</Typography>
                      {/* **누가 정했는지 보여 준다.** 사람이 정한 것은 AI 가 덮지 않는다 */}
                      {mine && (
                        <Chip size="small" label="직접 정함"
                          sx={{ height: 18, fontSize: '0.68rem', bgcolor: '#EEF2FF', color: '#3730A3' }} />
                      )}
                    </Stack>
                    {e.note && <Typography variant="caption" color="text.secondary">{e.note}</Typography>}
                    {mine && e.set_by_email && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {e.set_by_email} · AI 분석이 덮지 않습니다
                        {' · '}
                        <Box component="span" sx={{ color: 'primary.main', cursor: 'pointer' }}
                          onClick={() => releaseElement(e.id)}>AI 에 맡기기</Box>
                      </Typography>
                    )}
                  </Box>
                  <Button size="small" color="inherit" onClick={() => removeElement(e.id, e.element)}>
                    빼기
                  </Button>
                </Box>
              );
            })}
          </Stack>
        )}
      </Paper>
      {/* ── 시계열 ── */}
      {(m.timeline || []).length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="subtitle2" fontWeight={700} mb={1.5}>시계열</Typography>
          <Stack spacing={1.5}>
            {m.timeline.map((t: any) => (
              <Box key={t.id} sx={{ display: 'flex', gap: 2 }}>
                {/* 폰에서만 좁힌다 — sm 이상은 110 그대로다 (PC 배치 불변) */}
                <Box sx={{ minWidth: { xs: 78, sm: 110 } }}>
                  <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {t.occurred_on ? String(t.occurred_on).slice(0, 10) : '날짜 불명'}
                  </Typography>
                  {t.precision && t.precision !== 'EXACT' && (
                    <Typography variant="caption" color="warning.main">
                      {t.precision === 'MONTH' ? '월까지만' : t.precision === 'YEAR' ? '연도만' : '확인 필요'}
                    </Typography>
                  )}
                </Box>
                <Box>
                  <Typography variant="body2">{t.what}</Typography>
                  {t.legal_meaning && (
                    <Typography variant="caption" color="primary.main">{t.legal_meaning}</Typography>
                  )}
                </Box>
              </Box>
            ))}
          </Stack>
        </Paper>
      )}

      {/* ── 증거 ── */}
      {(m.evidence || []).length > 0 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="subtitle2" fontWeight={700} mb={1.5}>증거</Typography>
          <Stack spacing={1.25}>
            {m.evidence.map((e: any) => {
              const u = EVIDENCE_UI[e.status] || EVIDENCE_UI.UNCONFIRMED;
              return (
                <Box key={e.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                  <Chip size="small" label={u.label}
                    sx={{ bgcolor: u.c, color: '#fff', height: 20, minWidth: 52 }} />
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" fontWeight={500}>{e.kind}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block">{e.what}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {e.holder ? `보유 ${e.holder}` : ''}
                      {e.difficulty ? ` · 확보 난이도 ${e.difficulty}/5` : ''}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Stack>
        </Paper>
      )}

      {/* ── 요건 추가 ── */}
      <Dialog open={elOpen} onClose={() => { setElOpen(false); setElError(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>요건 추가</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} mt={0.5}>
            {elError && <Alert severity="error" onClose={() => setElError('')}>{elError}</Alert>}
            <TextField label="요건" required fullWidth value={el.element}
              onChange={(e) => setEl({ ...el, element: e.target.value })}
              placeholder="예: 악의의 수익자" />
            <TextField label="확인할 것 (선택)" fullWidth multiline minRows={2} value={el.note}
              onChange={(e) => setEl({ ...el, note: e.target.value })}
              placeholder="이 요건을 무엇으로 판단하는지" />
            <Typography variant="caption" color="text.secondary">
              직접 더한 요건은 <b>사람이 정한 것</b>으로 저장되어 AI 분석이 덮지 않습니다.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setElOpen(false); setElError(''); }}>취소</Button>
          <Button variant="contained" onClick={addElement} disabled={!el.element.trim()}>추가</Button>
        </DialogActions>
      </Dialog>

      {/* ── 기한 추가 ── */}
      <Dialog open={dlOpen} onClose={() => { setDlOpen(false); setDlError(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>기한 추가</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} mt={0.5}>
            {dlError && <Alert severity="error" onClose={() => setDlError('')}>{dlError}</Alert>}
            <TextField select label="종류" fullWidth value={dl.kind}
              onChange={(e) => setDl({ ...dl, kind: e.target.value })}>
              {Object.entries(DEADLINE_KINDS).map(([k, v]) => (
                <MenuItem key={k} value={k}>{v}</MenuItem>
              ))}
            </TextField>
            <TextField label="제목" required fullWidth value={dl.title}
              onChange={(e) => setDl({ ...dl, title: e.target.value })}
              placeholder="예: 항소이유서 제출" />
            <TextField label="기한" type="date" required fullWidth value={dl.dueOn}
              onChange={(e) => setDl({ ...dl, dueOn: e.target.value })}
              InputLabelProps={{ shrink: true }} />
            <TextField label="근거 (선택)" fullWidth value={dl.basis}
              onChange={(e) => setDl({ ...dl, basis: e.target.value })}
              placeholder="예: 판결정본 2026-08-20 송달"
              helperText="근거를 적어 두면 나중에 다시 확인할 수 있습니다" />
            <Divider />
            <Typography variant="caption" color="text.secondary">
              직접 넣은 기한은 <b>확정</b>으로 저장됩니다. AI 가 조사에서 뽑은 기한만 추정으로 남습니다.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDlOpen(false); setDlError(''); }}>취소</Button>
          <Button variant="contained" onClick={addDeadline}
            disabled={!dl.title.trim() || !dl.dueOn}>추가</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
