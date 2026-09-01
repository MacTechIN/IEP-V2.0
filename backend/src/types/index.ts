// 공통 타입 정의 (백엔드)

export type UserRole = 'admin' | 'user' | 'manager' | 'sales_rep';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  department?: string;
  monthlyTargetKrw?: number;
  profileImageUrl?: string;
  isActive?: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
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
  primaryContactTitle?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
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
  audioUrl?: string;
  transcription?: string;
  notes?: string;
  customerName?: string;
  overallScore?: number;
  createdAt: string;
  updatedAt?: string;
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
  actionItemsExtracted?: ActionItem[];
  overallConfidence?: number;
  // V1식 리포트 (A안)
  summary?: string;
  interests?: string[];
  concerns?: string[];
  actionItems?: string[];
  followUpDraft?: string;
  talkMetrics?: any;
  speakerRoles?: Record<string, string>;
  psychInsights?: any;
  coaching?: any;
  scorecard?: any;
  createdAt: string;
  updatedAt?: string;
}

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  speakerLabel: string;
  speakerId: string;
  content: string;
  startMs: number;
  endMs: number;
  sortOrder: number;
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
  updatedAt?: string;
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
  createdAt?: string;
  updatedAt?: string;
}

// API 응답 포맷
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

// 인증 관련
export interface AuthCredentials {
  email: string;
  password: string;
  deviceId?: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
  expiresIn: number;
}

export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: string;
  iat: number;
  exp: number;
}

// 요청 바디 타입
export interface CreateMeetingRequest {
  customerId: string;
  title: string;
  startTime: string;
  endTime: string;
  attendees?: string[];
  notes?: string;
  audioFile?: Buffer;
}

export interface UpdateMeetingRequest {
  title?: string;
  notes?: string;
  actionItems?: Partial<ActionItem>[];
}

export interface CreateCustomerRequest {
  companyName: string;
  industry?: string;
  companySize?: string;
  budgetMin?: number;
  budgetMax?: number;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactTitle?: string;
}

// 알림
export interface Notification {
  id: string;
  userId: string;
  type: 'analysis_complete' | 'important_signal' | 'improvement_suggestion';
  title: string;
  message: string;
  isRead: boolean;
  relatedEntityType?: string;
  relatedEntityId?: string;
  createdAt: string;
}
