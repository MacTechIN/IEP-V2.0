// 공통 타입 정의

export type UserRole = 'admin' | 'user' | 'manager' | 'sales_rep';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** 계급/직위 (수사관 프로필). 인사말·조서 작성자 표시에 쓴다. */
  position?: string | null;
  department?: string;
  monthlyTargetKrw?: number;
  profileImageUrl?: string;
  isActive?: boolean;
  lastLoginAt?: string;
  createdAt?: string;
}

export interface Customer {
  id: string;
  userId: string;
  companyName: string;
  industry?: string;
  companySize?: string;
  budgetMinKrw?: number;
  budgetMaxKrw?: number;
  dealStatus: 'new' | 'in_progress' | 'won' | 'lost';
  primaryContactName?: string;
  primaryContactEmail?: string;
  createdAt: string;
}

export interface Meeting {
  id: string;
  userId: string;
  customerId: string;
  title: string;
  startTime: string;
  endTime: string;
  durationMinutes?: number;
  analysisStatus: 'pending' | 'processing' | 'completed' | 'failed';
  analysisProgress: number;
  /** 지금 어느 단계인지. 실패 시 어디서 멈췄는지를 알려준다 (마이그레이션 006) */
  analysisStage?: string | null;
  /** 실패 원인. 예전에는 아무 데도 남지 않아 "실패" 세 글자가 전부였다 */
  analysisError?: string | null;
  /** 실패는 아니지만 덜 된 것 (028). **비어 있으면 온전히 끝난 것이다** */
  analysisNote?: string | null;
  /** 한 번이라도 분석을 시작했는가. null 이면 아직 돌린 적이 없다는 뜻이다. */
  analysisStartedAt?: string | null;
  /** 조사 종류 (016·031). interrogation·witness·victim·interview·meeting */
  kind?: 'interrogation' | 'witness' | 'victim' | 'interview' | 'meeting';
  /** 수사사건. **없어도 정상이다** — 모든 조사가 수사사건 조사는 아니다 */
  matterId?: string | null;
  /** 비닉권 대상 (021). 참이면 화면과 내보내기에 고지가 박힌다 */
  privileged?: boolean;
  notes?: string;
  customerName?: string;
  overallScore?: number;
  createdAt: string;
  /** 011 — 녹취를 마지막으로 고친 시각. noteGeneratedAt 과 비교해 요약이 낡았는지 본다. */
  transcriptEditedAt?: string | null;
  noteGeneratedAt?: string | null;
}

export interface AnalysisResult {
  meetingId: string;
  customerNeeds: {
    primary: string;
    secondary: string[];
    budget: string;
    timeline: string;
    decisionMakers: number;
    confidence: number;
  };
  dealSignals: {
    signal: 'positive' | 'neutral' | 'negative';
    strength: number;
    closingProbability: number;
    competition?: string;
    nextSteps?: string;
  };
  scores: {
    customerUnderstanding: number;
    problemSolving: number;
    proposalPersuasion: number;
    followUp: number;
    teamCollaboration: number;
    overall: number;
  };
  sentiment?: 'positive' | 'neutral' | 'negative';
  keyPoints?: string[];
  // V1식 리포트 (A안)
  summary?: string;
  interests?: string[];
  concerns?: string[];
  actionItems?: string[];
  followUpDraft?: string;
  talkMetrics?: {
    durationMs?: number;
    speakers?: Record<string, { words: number; turns: number; questions: number; talkMs: number; talkRatio: number; wpm: number }>;
  };
  speakerRoles?: Record<string, string>;
  /** 심리 인사이트 — 서버는 계속 만들어 왔는데 화면이 그리지 않고 있었다 */
  psychInsights?: {
    customer_state?: string;
    rep_confidence?: string;
    answer_quality?: string;
    responsiveness?: string;
    notes?: string[];
  };
  coaching?: {
    direction?: string;
    preparation?: string[];
    checklist?: string[];
    next_appointment?: string;
  };
  /** 축별 점수 + 근거 + 조언. axes 는 축 id 를 키로 하는 객체다(배열이 아니다). */
  scorecard?: {
    axes?: Record<string, { score?: number; evidence?: string; advice?: string }>;
    total?: number;
    headline?: string;
  };
  /** 완료 체크한 액션 아이템의 순번 */
  actionItemsDone?: number[];
  /** 리뷰용 구조화 노트. summary 와 별개다 */
  meetingNote?: {
    headline?: string;
    topics?: { title: string; points: string[] }[];
    decisions?: string[];
    open_items?: string[];
    next_steps?: string[];
    mentions?: { kind: string; value: string }[];
  };
  createdAt: string;
}

export interface ActionItem {
  id: string;
  meetingId: string;
  actionText: string;
  priority: 'high' | 'medium' | 'low';
  dueDate: string;
  status: 'pending' | 'in_progress' | 'completed';
  assignedToUserId?: string;
  createdAt: string;
}

export interface UserScore {
  userId: string;
  currentScore: number;
  weeklyScore: number;
  monthlyScore: number;
  scoreComponents: {
    customerUnderstanding: number;
    problemSolving: number;
    proposalPersuasion: number;
    followUp: number;
    teamCollaboration: number;
  };
  metrics: {
    meetingsThisWeek: number;
    actionCompletionRate: number;
    customerSatisfaction: number;
  };
  weeklyRank?: number;
  monthlyRank?: number;
}

export interface DashboardData {
  user: User;
  currentMeeting?: Meeting;
  analysis?: AnalysisResult;
  actionItems?: ActionItem[];
  score?: UserScore;
  recentMeetings?: Meeting[];
}

// API Response 공통 구조
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string | number;
    message: string;
    details?: Record<string, any>;
  };
  meta?: {
    timestamp?: string;
    requestId?: string;
  };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    timestamp?: string;
    requestId?: string;
  };
}

// 인증
export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
  expiresIn: number;
}

// 알림
export interface Notification {
  id: string;
  type: 'analysis_complete' | 'important_signal' | 'improvement_suggestion';
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}
