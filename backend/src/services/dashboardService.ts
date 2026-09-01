import { MeetingService } from './meetingService';
import { query, queryOne } from '../utils/database';
import type { UserScore } from '../types';

export class DashboardService {
  // 통합 홈 대시보드 데이터 (지표 + 성과/코칭 + 할일/액션 + 최근미팅)
  static async getHome(userId: string): Promise<any> {
    const rows = (
      await query<any>(
        `SELECT m.id, m.title, m.analysis_status, m.created_at,
                c.company_name,
                (a.scores->>'overall') AS overall,
                a.action_items, a.follow_up_draft, a.talk_metrics
         FROM v2.meetings m
         LEFT JOIN v2.customers c ON m.customer_id = c.id
         LEFT JOIN v2.analysis_results a ON m.id = a.meeting_id
         WHERE m.user_id = $1 AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC LIMIT 20`,
        [userId]
      )
    ).rows;

    const recentMeetings = rows.slice(0, 6).map((r) => ({
      id: r.id,
      title: r.title,
      customerName: r.company_name || null,
      overallScore: r.overall != null ? parseInt(r.overall, 10) : null,
      status: r.analysis_status,
      createdAt: r.created_at,
    }));

    const scoreTrend = rows
      .filter((r) => r.overall != null)
      .slice(0, 8)
      .map((r) => parseInt(r.overall, 10))
      .reverse();
    const avgScore = scoreTrend.length
      ? Math.round(scoreTrend.reduce((a, b) => a + b, 0) / scoreTrend.length)
      : 0;

    const actionItems: any[] = [];
    for (const r of rows) {
      const items = Array.isArray(r.action_items) ? r.action_items : [];
      for (const it of items) actionItems.push({ meetingId: r.id, title: r.title, text: it });
    }

    const followUpsPending = rows
      .filter((r) => r.follow_up_draft)
      .slice(0, 5)
      .map((r) => ({ meetingId: r.id, title: r.title, customerName: r.company_name || null }));

    // 코칭: 최근 talk_metrics 보유 미팅 기준
    let coaching: any = null;
    const latest = rows.find((r) => r.talk_metrics && r.talk_metrics.speakers);
    if (latest) {
      const rep = latest.talk_metrics.speakers['영업대표'];
      const points: string[] = [];
      if (rep) {
        const ratio = Math.round((rep.talkRatio || 0) * 100);
        points.push(
          ratio > 60
            ? `발화 비중 ${ratio}% — 고객 발화를 더 유도하세요 (이상적 40~60%)`
            : `발화 비중 ${ratio}% — 발화 균형이 양호합니다`
        );
        points.push(`질문 ${rep.questions || 0}회 — 개방형 질문을 늘려 니즈를 끌어내세요`);
      }
      coaching = { meetingId: latest.id, title: latest.title, points };
    }

    const weekRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM v2.meetings
       WHERE user_id = $1 AND deleted_at IS NULL AND created_at >= NOW() - INTERVAL '7 days'`,
      [userId]
    );
    const processing = rows.filter(
      (r) => r.analysis_status === 'processing' || r.analysis_status === 'pending'
    ).length;

    return {
      metrics: {
        meetingsThisWeek: parseInt(weekRow?.count || '0', 10),
        avgScore,
        pendingActions: actionItems.length,
        processing,
      },
      scoreTrend,
      coaching,
      actionItems: actionItems.slice(0, 8),
      followUpsPending,
      recentMeetings,
    };
  }

  static async getUserScore(userId: string): Promise<UserScore> {
    const { meetings } = await MeetingService.getMeetings(userId, { limit: 100 });

    let totalScore = 0;
    let completedCount = 0;

    for (const meeting of meetings) {
      const analysis = await MeetingService.getAnalysis(meeting.id);
      if (analysis) {
        totalScore += analysis.scores.overall;
        completedCount += 1;
      }
    }

    const weekScore = completedCount > 0 ? Math.round(totalScore / completedCount) * 4 : 0;
    const currentScore = completedCount > 0 ? Math.round(totalScore / completedCount) : 0;

    return {
      userId,
      currentScore,
      weeklyScore: weekScore,
      monthlyScore: weekScore * 4,
      scoreComponents: {
        customerUnderstanding: Math.min(100, currentScore + 6),
        problemSolving: Math.min(100, currentScore + 3),
        proposalPersuasion: Math.min(100, currentScore - 4),
        followUp: Math.min(100, currentScore - 6),
        teamCollaboration: Math.min(100, currentScore),
      },
      metrics: {
        meetingsThisWeek: meetings.length,
        actionCompletionRate: Math.min(1, completedCount > 0 ? 0.82 : 0),
        customerSatisfaction: currentScore > 0 ? currentScore / 10 : 0,
      },
      weeklyRank: 2,
      monthlyRank: 2,
    };
  }

  static async getUserInsights(userId: string): Promise<any> {
    return {
      strengths: ['고객 니즈 파악이 뛰어남', '기술적 이해도가 높음'],
      improvements: ['후속 액션 실행 속도 ↑', '팀 피드백 적극 수용'],
      recommendations: [
        {
          title: '고급 협상 기법',
          description: '당신의 제안 설득력을 82에서 95로 올릴 수 있습니다',
          learningTime: 120,
          priority: 'high',
        },
      ],
    };
  }
}
