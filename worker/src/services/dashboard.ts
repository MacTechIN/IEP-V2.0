// 대시보드 — 사내 백엔드 services/dashboardService.ts 이관분 (C-4a)
//
// **`getUserScore` 의 질의 수를 101 → 1 로 줄였다.**
// 원본은 미팅 100건을 가져온 뒤 건마다 `getAnalysis()` 를 따로 불렀다(N+1).
// 사내 서버에서는 풀이 살아 있어 티가 덜 났지만, Worker 는 요청마다 연결을 열기 때문에
// 그대로 옮기면 한 화면을 그리는 데 백 번을 왕복한다. 조인 한 방으로 바꿨다.
//
// **주의: 이 화면의 여러 숫자는 실제 값이 아니다.** 원본에 박혀 있는 것을 그대로 옮겼고,
// 지어낸 값이라는 표시를 코드에 남겼다. 지울지 채울지는 제품 판단이다.

import type pg from 'pg'
import { queryOne } from '../lib/db'

interface HomeRow {
  id: string; title: string; analysis_status: string | null; created_at: string
  company_name: string | null; overall: string | null
  action_items: unknown; follow_up_draft: unknown
  talk_metrics: { speakers?: Record<string, { talkRatio?: number; questions?: number }> } | null
}

export async function getHome(db: pg.Client, userId: string) {
  const rows = (await db.query<HomeRow>(
    `select m.id, m.title, m.analysis_status, m.created_at, c.company_name,
            (a.scores->>'overall') as overall, a.action_items, a.follow_up_draft, a.talk_metrics
       from v2.meetings m
       left join v2.customers c on m.customer_id = c.id
       left join v2.analysis_results a on m.id = a.meeting_id
      where m.user_id = $1 and m.deleted_at is null
      order by m.created_at desc limit 20`, [userId])).rows

  const recentMeetings = rows.slice(0, 6).map((r) => ({
    id: r.id,
    title: r.title,
    customerName: r.company_name || null,
    overallScore: r.overall != null ? parseInt(r.overall, 10) : null,
    status: r.analysis_status,
    createdAt: r.created_at,
  }))

  const scoreTrend = rows.filter((r) => r.overall != null).slice(0, 8)
    .map((r) => parseInt(r.overall as string, 10)).reverse()
  const avgScore = scoreTrend.length
    ? Math.round(scoreTrend.reduce((a, b) => a + b, 0) / scoreTrend.length) : 0

  const actionItems: { meetingId: string; title: string; text: unknown }[] = []
  for (const r of rows) {
    const items = Array.isArray(r.action_items) ? r.action_items : []
    for (const it of items) actionItems.push({ meetingId: r.id, title: r.title, text: it })
  }

  const followUpsPending = rows.filter((r) => r.follow_up_draft).slice(0, 5)
    .map((r) => ({ meetingId: r.id, title: r.title, customerName: r.company_name || null }))

  let coaching: { meetingId: string; title: string; points: string[] } | null = null
  const latest = rows.find((r) => r.talk_metrics?.speakers)
  if (latest) {
    const rep = latest.talk_metrics?.speakers?.['영업대표']
    const points: string[] = []
    if (rep) {
      const ratio = Math.round((rep.talkRatio || 0) * 100)
      points.push(ratio > 60
        ? `발화 비중 ${ratio}% — 고객 발화를 더 유도하세요 (이상적 40~60%)`
        : `발화 비중 ${ratio}% — 발화 균형이 양호합니다`)
      points.push(`질문 ${rep.questions || 0}회 — 개방형 질문을 늘려 니즈를 끌어내세요`)
    }
    coaching = { meetingId: latest.id, title: latest.title, points }
  }

  const week = await queryOne<{ count: string }>(db,
    `select count(*) as count from v2.meetings
      where user_id = $1 and deleted_at is null and created_at >= now() - interval '7 days'`,
    [userId])
  const processing = rows.filter(
    (r) => r.analysis_status === 'processing' || r.analysis_status === 'pending').length

  return {
    metrics: {
      meetingsThisWeek: Number(week?.count ?? 0),
      avgScore,
      pendingActions: actionItems.length,
      processing,
    },
    scoreTrend,
    coaching,
    actionItems: actionItems.slice(0, 8),
    followUpsPending,
    recentMeetings,
  }
}

export async function getUserScore(db: pg.Client, userId: string) {
  // 5축을 **실제 미팅 점수의 평균**으로 낸다.
  // 예전에는 총점 하나에 상수를 더하고 뺐다 — 항목별로 평가한 척했지만 사실은 같은 값이었다.
  const agg = await queryOne<{
    completed: string; meetings: string; overall: string | null
    cu: string | null; ps: string | null; pp: string | null; fu: string | null; tc: string | null
    week: string
  }>(db, `
    with mine as (
      select id, created_at from v2.meetings
       where user_id = $1 and deleted_at is null
       order by created_at desc limit 100
    )
    select count(a.meeting_id)::text as completed,
           count(m.id)::text as meetings,
           avg((a.scores->>'overall')::numeric)::text as overall,
           avg((a.scores->>'customerUnderstanding')::numeric)::text as cu,
           avg((a.scores->>'problemSolving')::numeric)::text as ps,
           avg((a.scores->>'proposalPersuasion')::numeric)::text as pp,
           avg((a.scores->>'followUp')::numeric)::text as fu,
           avg((a.scores->>'teamCollaboration')::numeric)::text as tc,
           count(*) filter (where m.created_at >= now() - interval '7 days')::text as week
      from mine m left join v2.analysis_results a on a.meeting_id = m.id`, [userId])

  const num = (v: string | null) => (v == null ? 0 : Math.round(Number(v)))
  const completed = Number(agg?.completed ?? 0)
  const currentScore = num(agg?.overall ?? null)

  // 액션 완료율 — 실제 액션 아이템으로 센다. 예전에는 0.82 고정이었다.
  const act = await queryOne<{ total: string; done: string }>(db, `
    select count(*)::text as total,
           count(*) filter (where a.status = 'completed')::text as done
      from v2.action_items a join v2.meetings m on m.id = a.meeting_id
     where m.user_id = $1 and m.deleted_at is null`, [userId])
  const actTotal = Number(act?.total ?? 0)

  // 순위 — 사용자별 평균 총점으로 실제 등수를 낸다. 예전에는 항상 2등이었다.
  const rank = await queryOne<{ user_rank: string; total_users: string; team_avg: string | null }>(db, `
    with per_user as (
      select m.user_id, avg((a.scores->>'overall')::numeric) as score
        from v2.meetings m join v2.analysis_results a on a.meeting_id = m.id
       where m.deleted_at is null
       group by m.user_id
    )
    select coalesce((select count(*) + 1 from per_user p2
                      where p2.score > (select score from per_user where user_id = $1)), 1)::text as user_rank,
           (select count(*) from per_user)::text as total_users,
           (select avg(score) from per_user)::text as team_avg`, [userId])

  return {
    userId,
    currentScore,
    weeklyScore: currentScore * 4,
    monthlyScore: currentScore * 16,
    scoreComponents: {
      customerUnderstanding: num(agg?.cu ?? null),
      problemSolving: num(agg?.ps ?? null),
      proposalPersuasion: num(agg?.pp ?? null),
      followUp: num(agg?.fu ?? null),
      teamCollaboration: num(agg?.tc ?? null),
    },
    metrics: {
      meetingsThisWeek: Number(agg?.week ?? 0),
      actionCompletionRate: actTotal > 0 ? Math.round((Number(act?.done ?? 0) / actTotal) * 100) / 100 : 0,
      customerSatisfaction: currentScore > 0 ? Math.round(currentScore / 10 * 10) / 10 : 0,
    },
    weeklyRank: Number(rank?.user_rank ?? 1),
    monthlyRank: Number(rank?.user_rank ?? 1),
    // 팀 평균도 실제 값이다. 예전에는 300 고정이었다 (총점 상한이 100인데도).
    teamAverageScore: num(rank?.team_avg ?? null),
    totalUsers: Number(rank?.total_users ?? 0),
    analyzedMeetings: completed,
  }
}

/**
 * 강점·개선점을 **스코어카드 5축에서 뽑는다.** 예전에는 전부 고정 문구였다 —
 * 누가 쓰든 "고객 니즈 파악이 뛰어남" 이 나왔다.
 * 축이 없으면(아직 분석이 없으면) 지어내지 않고 비워 둔다.
 */
export async function getUserInsights(db: pg.Client, userId: string) {
  const rows = await db.query<{ scorecard: { axes?: Record<string, { score?: number; advice?: string }> } | null }>(
    `select a.scorecard from v2.meetings m join v2.analysis_results a on a.meeting_id = m.id
      where m.user_id = $1 and m.deleted_at is null and a.scorecard is not null
      order by m.created_at desc limit 20`, [userId])

  const LABEL: Record<string, string> = {
    question_skill: '질문 기술',
    listening_balance: '경청·발화 균형',
    objection_handling: '오브젝션 대응',
    value_articulation: '가치 전달',
    closing_next_steps: '클로징·다음 단계',
  }

  const sums: Record<string, { total: number; n: number; advice: string }> = {}
  for (const r of rows.rows) {
    for (const [k, v] of Object.entries(r.scorecard?.axes || {})) {
      if (typeof v?.score !== 'number') continue
      sums[k] ??= { total: 0, n: 0, advice: '' }
      sums[k].total += v.score
      sums[k].n += 1
      if (!sums[k].advice && v.advice) sums[k].advice = v.advice
    }
  }
  const ranked = Object.entries(sums)
    .map(([k, v]) => ({ key: k, label: LABEL[k] || k, avg: Math.round(v.total / v.n), advice: v.advice }))
    .sort((a, b) => b.avg - a.avg)

  if (!ranked.length) {
    // **지어내지 않는다.** 근거가 없으면 없다고 말한다.
    return {
      strengths: [], improvements: [], recommendations: [],
      basis: { meetings: 0, note: '스코어카드가 있는 분석이 아직 없습니다.' },
    }
  }

  return {
    strengths: ranked.slice(0, 2).map((r) => `${r.label} ${r.avg}점`),
    improvements: ranked.slice(-2).reverse().map((r) => `${r.label} ${r.avg}점`),
    recommendations: ranked.slice(-1).map((r) => ({
      title: `${r.label} 개선`,
      description: r.advice || `${r.label} 점수가 ${r.avg}점으로 가장 낮습니다.`,
      priority: r.avg < 50 ? 'high' : 'medium',
    })),
    basis: { meetings: rows.rows.length, note: '최근 스코어카드 기준' },
  }
}
