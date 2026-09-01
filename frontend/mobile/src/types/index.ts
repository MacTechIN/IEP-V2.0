// React Native 모바일 앱용 타입 정의 (웹과 동일)

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'sales_rep' | 'manager' | 'admin';
  department?: string;
  monthlyTargetKrw?: number;
  profileImageUrl?: string;
  createdAt?: string;
  updatedAt?: string;
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
  createdAt: string;
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
