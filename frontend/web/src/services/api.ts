import axios, { AxiosInstance, AxiosError } from 'axios';
import type { ApiResponse } from '../types';

/**
 * API 주소.
 *
 * **기본값이 빌드 모드에 따라 다르다.** 예전에는 언제나 `localhost:3000` 이었고,
 * `VITE_API_URL` 없이 `vite build` 를 하면 **아무것도 못 부르는 번들**이 나왔다.
 * 타입 검사도 빌드도 배포도 전부 성공하고 사이트만 죽는다 —
 * 2026-08-26 에 `npm run build` 로 배포해서 실제로 그렇게 됐다.
 * (배포는 `npm run deploy` 를 쓴다. 그것이 `build:prod` 로 주소를 넣는다.)
 */
const API_BASE_URL = import.meta.env.VITE_API_URL
  || (import.meta.env.DEV
        ? 'http://localhost:3000/api/v2'
        : 'https://iep-api.wooriszhome.workers.dev/api/v2');

/**
 * 업로드 제한 시간.
 *
 * 서버는 업로드 요청 **안에서** 전사를 끝낸다. 10분짜리 파일 하나에 실측 188초가 걸렸고,
 * 예전 값 300초로는 조금만 밀려도 클라이언트가 먼저 끊었다 — 그때 서버는 이미 R2 에
 * 파일을 써 둔 뒤라 **DB 기록 없는 고아 파일**이 남는다. 2026-08-11 에 그렇게 4개가 생겼다.
 * 근본 해결은 전사를 Workflow 로 빼는 것이고, 그때까지의 여유값이다.
 */
export const UPLOAD_TIMEOUT_MS = 900000;

/**
 * 세션이 끊겼을 때 화면이 무엇을 할지 정한다.
 *
 * 기본값(핸들러 미등록)은 `/login` 으로의 하드 이동이다. 그런데 **녹음 중에 그 이동이 일어나면
 * 녹음이 통째로 사라진다** — 2026-08-10 저녁에 실제로 그렇게 잃었다.
 * 그래서 녹음 화면은 이동하지 않는 핸들러를 걸어 두고, 녹음이 끝난 뒤에 로그인으로 보낸다.
 */
export type SessionExpiredHandler = () => void;

class APIClient {
  private client: AxiosInstance;
  /** refresh 전용. **인터셉터를 붙이지 않는다** — 붙이면 자기 자신을 무한 재귀한다. */
  private authClient: AxiosInstance;
  private accessToken: string | null = null;
  /** 동시에 여러 요청이 401 을 맞아도 refresh 는 한 번만 나간다. */
  private refreshing: Promise<string | null> | null = null;
  private onSessionExpired: SessionExpiredHandler | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    this.authClient = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Request 인터셉터
    this.client.interceptors.request.use(
      (config) => {
        if (this.accessToken) {
          config.headers.Authorization = `Bearer ${this.accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error),
    );

    // Response 인터셉터
    this.client.interceptors.response.use(
      (response) => response.data,
      async (error: AxiosError) => {
        const config = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
        // 재시도한 요청이 또 401 이면 여기서 끝낸다. 없으면 401 → refresh → 401 → … 로 돈다.
        if (error.response?.status === 401 && config && !config._retried) {
          config._retried = true;
          const token = await this.refreshOnce();
          if (token) return this.client.request(config);
          this.expireSession();
        }
        return Promise.reject(error.response?.data || error);
      },
    );

    // localStorage에서 토큰 복원
    this.restoreToken();
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
    localStorage.setItem('accessToken', token);
  }

  private restoreToken(): void {
    const token = localStorage.getItem('accessToken');
    if (token) {
      this.accessToken = token;
    }
  }

  isAuthenticated(): boolean {
    return !!(this.accessToken || localStorage.getItem('accessToken'));
  }

  /**
   * 실시간 자막용. WebSocket 은 헤더를 붙일 수 없어 토큰을 쿼리로 보내야 한다 —
   * 인터셉터가 대신 넣어 줄 수 없으므로 값 자체가 필요하다. 다른 용도로 쓰지 말 것.
   */
  getAccessToken(): string | null {
    return this.accessToken || localStorage.getItem('accessToken');
  }

  /** 화면이 세션 만료를 어떻게 처리할지 등록한다. 해제하려면 null 을 넘긴다. */
  setSessionExpiredHandler(fn: SessionExpiredHandler | null): void {
    this.onSessionExpired = fn;
  }

  private clearSession(): void {
    this.accessToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }

  /**
   * refresh 를 한 번만 시도하고 결과를 공유한다. 실패하면 null.
   * **인터셉터가 없는 authClient 로 부른다** — 이게 무한 재귀를 끊는 지점이다.
   */
  private refreshOnce(): Promise<string | null> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) return null;
      try {
        const res = await this.authClient.post('/auth/refresh', { refreshToken });
        const token = (res.data as ApiResponse)?.data?.accessToken;
        if (!token) return null;
        this.setAccessToken(token);
        return token as string;
      } catch {
        return null;
      }
    })();
    // 다음 401 때 다시 시도할 수 있도록 놓아준다 (성공/실패 모두)
    this.refreshing.finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  /** 세션이 되살아나지 못했다. 토큰을 버리고 화면에 알린다. */
  private expireSession(): void {
    this.clearSession();
    if (this.onSessionExpired) this.onSessionExpired();
    else window.location.href = '/login';
  }

  logout(): void {
    this.clearSession();
    window.location.href = '/login';
  }

  // 인증 API
  async login(email: string, password: string): Promise<ApiResponse> {
    const response = await this.client.post('/auth/login', { email, password }) as ApiResponse;
    if (response.success && response.data?.accessToken) {
      this.setAccessToken(response.data.accessToken);
      if (response.data.refreshToken) {
        localStorage.setItem('refreshToken', response.data.refreshToken);
      }
    }
    return response;
  }

  // 조사 오디오 업로드 (STT + AI 분석 트리거) — 단일 파일 레거시 경로
  async uploadAudio(meetingId: string, file: File): Promise<ApiResponse> {
    const form = new FormData();
    form.append('audio', file);
    return this.client.post(`/meetings/${meetingId}/audio`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_TIMEOUT_MS,
    });
  }

  // 녹음 업로드 (draft). **전사는 기다리지 않는다** — 서버가 저장만 하고 응답한 뒤
  // 전사는 Workflow 가 따로 돌린다(2026-08-11). 그래도 큰 파일의 전송 자체가 오래 걸릴 수
  // 있으므로 타임아웃은 넉넉히 둔다.
  async uploadRecording(file: File, label?: string, durationSeconds?: number): Promise<ApiResponse> {
    const form = new FormData();
    form.append('audio', file);
    if (label) form.append('label', label);
    if (durationSeconds != null) form.append('durationSeconds', String(durationSeconds));
    return this.client.post('/recordings', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_TIMEOUT_MS,
    });
  }
  // 아직 조사에 붙지 않은 녹음들. 전사 진행 상태를 확인하는 데 쓴다.
  async getRecordingDrafts(): Promise<ApiResponse> {
    return this.client.get('/recordings/drafts');
  }

  // ── 녹취 수정 (011). 셋 다 갱신된 녹취 전체를 돌려주므로 다시 읽을 필요가 없다.
  async editSegment(
    meetingId: string, segmentId: string,
    patch: { content?: string; highlights?: { start: number; end: number }[] },
  ): Promise<ApiResponse> {
    return this.client.patch(`/analysis/meeting/${meetingId}/segments/${segmentId}`, patch);
  }
  async revertSegment(meetingId: string, segmentId: string): Promise<ApiResponse> {
    return this.client.post(`/analysis/meeting/${meetingId}/segments/${segmentId}/revert`);
  }
  // ── 녹음 재생 (012)
  async getMeetingRecordings(meetingId: string): Promise<ApiResponse> {
    return this.client.get(`/meetings/${meetingId}/recordings`);
  }
  /**
   * 재생 티켓. `<audio src>` 는 헤더를 못 붙여 토큰이 URL 에 실려야 하는데,
   * 액세스 토큰은 계정 전체 권한이라 위험하다. 이 티켓은 **그 녹음 하나만 10분** 연다.
   */
  async getAudioTicket(recordingId: string): Promise<ApiResponse> {
    return this.client.post(`/recordings/${recordingId}/audio-ticket`);
  }

  /** 조사노트와 AI요약만 다시 만든다. 리포트·지표·코칭은 그대로 둔다. */
  async renote(meetingId: string): Promise<ApiResponse> {
    return this.client.post(`/analysis/meeting/${meetingId}/renote`, {}, { timeout: 120000 });
  }
  async updateRecording(id: string, data: { label?: string; selected?: boolean }): Promise<ApiResponse> {
    return this.client.patch(`/recordings/${id}`, data);
  }
  async deleteRecording(id: string): Promise<ApiResponse> {
    return this.client.delete(`/recordings/${id}`);
  }
  // 선택 녹음들을 합쳐 분석
  async analyzeMeeting(
    meetingId: string, recordingIds: string[], coachingSessionId?: string,
  ): Promise<ApiResponse> {
    // 코칭 판정은 조사보다 먼저 쌓이므로 여기서 붙여 준다 (015).
    return this.client.post(`/meetings/${meetingId}/analyze`, { recordingIds, coachingSessionId });
  }

  // 실시간 위험·기회 레이더 (대화 조각 판정)
  /**
   * 25초 클립을 보내 판정을 받는다.
   *
   * `sessionId`·`atMs`·`dangerStreak` 은 **판정을 기록하기 위한 것**이다 (015).
   * 완충(위험 2연속)은 서버가 적용하고 응답의 `level` 이 이미 완충된 값이다 —
   * 화면은 규칙을 몰라도 된다.
   */
  async riskCheck(clip: File, opts: {
    context?: string; sessionId?: string; atMs?: number; dangerStreak?: number;
    /** 조사 종류 (016). 서버가 이걸 보고 무엇을 물을지 정한다 — 일반 조사에 법률 코칭을 걸지 않는다 */
    kind?: 'legal' | 'business' | 'general';
  } = {}): Promise<ApiResponse> {
    const form = new FormData();
    form.append('audio', clip);
    if (opts.kind) form.append('kind', opts.kind);
    if (opts.context) form.append('context', opts.context);
    if (opts.sessionId) form.append('sessionId', opts.sessionId);
    form.append('atMs', String(Math.max(0, Math.round(opts.atMs ?? 0))));
    form.append('dangerStreak', String(Math.max(0, opts.dangerStreak ?? 0)));
    return this.client.post('/risk', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  }

  /** 코칭 판정에 대한 응답. 유일한 정답표다 (015). */
  async coachingFeedback(eventId: string, feedback: 'helpful' | 'missed'): Promise<ApiResponse> {
    return this.client.patch(`/coaching/${eventId}/feedback`, { feedback });
  }

  // ── 수사사건 (016~022) ──
  async getMatters(status?: string): Promise<ApiResponse> {
    return this.client.get('/matters', { params: status ? { status } : undefined });
  }
  async getMatter(id: string): Promise<ApiResponse> { return this.client.get(`/matters/${id}`); }

  // 끝난 조사를 수사사건에 붙이고 뗀다 (030).
  // **PATCH 가 아니다** — 수사사건 자료를 다시 만드는 일이라 결과를 돌려받아야 한다.
  async attachMeetingToMatter(meetingId: string, matterId: string): Promise<ApiResponse> {
    return this.client.post(`/meetings/${meetingId}/matter`, { matterId });
  }
  async detachMeetingFromMatter(meetingId: string): Promise<ApiResponse> {
    return this.client.delete(`/meetings/${meetingId}/matter`);
  }
  async createMatter(data: any): Promise<ApiResponse> { return this.client.post('/matters', data); }

  // 수사사건 정리 (030). **사본을 먼저 꺼낼 수 있고, 지우면 사본이 함께 돌아온다.**
  async matterPurgeCandidates(): Promise<ApiResponse> {
    return this.client.get('/matters/purge-candidates');
  }
  async matterExport(id: string): Promise<ApiResponse> { return this.client.get(`/matters/${id}/export`); }
  async matterDeletePreview(id: string): Promise<ApiResponse> {
    return this.client.get(`/matters/${id}/delete-preview`);
  }
  async deleteMatter(id: string, confirm: string): Promise<ApiResponse> {
    return this.client.delete(`/matters/${id}`, { data: { confirm } });
  }
  async updateMatter(id: string, data: any): Promise<ApiResponse> {
    return this.client.patch(`/matters/${id}`, data);
  }
  /** 이해충돌 검사. **막지 않는다 — 보여 준다.** 수임 여부는 사람이 정한다 */
  async checkConflict(name: string): Promise<ApiResponse> {
    return this.client.get('/matters/conflicts', { params: { name } });
  }
  async addAdverseParty(matterId: string, data: any): Promise<ApiResponse> {
    return this.client.post(`/matters/${matterId}/adverse-parties`, data);
  }
  /** 요건을 손으로 더한다 (018·025). 템플릿은 뼈대일 뿐 — 수사사건마다 다투는 자리가 다르다 */
  async addElement(matterId: string, data: any): Promise<ApiResponse> {
    return this.client.post(`/matters/${matterId}/elements`, data);
  }
  /** 고치면 set_by=human 이 되어 **AI 분석이 이 행을 덮지 않는다** (025) */
  async updateElement(id: string, data: any): Promise<ApiResponse> {
    return this.client.patch(`/elements/${id}`, data);
  }
  async deleteElement(id: string): Promise<ApiResponse> {
    return this.client.delete(`/elements/${id}`);
  }
  async addDeadline(matterId: string, data: any): Promise<ApiResponse> {
    return this.client.post(`/matters/${matterId}/deadlines`, data);
  }
  /** 기한 확정 (017). 누가 언제 확정했는지가 함께 남는다 */
  async confirmDeadline(id: string): Promise<ApiResponse> {
    return this.client.patch(`/deadlines/${id}/confirm`, {});
  }
  async updateDeadline(id: string, data: any): Promise<ApiResponse> {
    return this.client.patch(`/deadlines/${id}`, data);
  }
  async getUpcomingDeadlines(days = 60): Promise<ApiResponse> {
    return this.client.get('/deadlines', { params: { days } });
  }

  // ── 서면 (029). **서식을 모른다** — kind 를 넘기면 서버 등록부가 처리한다.
  async documentsAvailable(matterId: string, meetingId?: string): Promise<ApiResponse> {
    return this.client.get(`/matters/${matterId}/documents/available`,
      { params: meetingId ? { meetingId } : undefined });
  }
  /** 모델에게 보낼 자료를 먼저 본다 — 수사관이 읽고 보탤 수 있어야 한다 */
  async documentBrief(matterId: string, kind: string, meetingId?: string): Promise<ApiResponse> {
    return this.client.get(`/matters/${matterId}/documents/brief`,
      { params: { kind, ...(meetingId ? { meetingId } : {}) } });
  }
  async matterDocuments(matterId: string): Promise<ApiResponse> {
    return this.client.get(`/matters/${matterId}/documents`);
  }
  async createDocument(matterId: string, data: any): Promise<ApiResponse> {
    return this.client.post(`/matters/${matterId}/documents`, data);
  }
  async getDocument(id: string): Promise<ApiResponse> { return this.client.get(`/documents/${id}`); }
  async deleteDocument(id: string): Promise<ApiResponse> { return this.client.delete(`/documents/${id}`); }
  async updateDocument(id: string, data: any): Promise<ApiResponse> {
    return this.client.patch(`/documents/${id}`, data);
  }

  /** 법률 분해 결과 (018). 조사 단위(원문·findings)와 수사사건 단위(요건·타임라인·증거)를 함께 준다 */
  async getLegalAnalysis(meetingId: string): Promise<ApiResponse> {
    return this.client.get(`/legal/meeting/${meetingId}`);
  }

  /** 이 조사의 코칭 타임라인 */
  async getCoachingTimeline(meetingId: string): Promise<ApiResponse> {
    return this.client.get(`/coaching/meeting/${meetingId}`);
  }

  /** 인터셉터가 붙은 client 로 부르면 401 이 다시 인터셉터를 타고 재귀한다. authClient 를 쓴다. */
  async refresh(): Promise<ApiResponse> {
    const refreshToken = localStorage.getItem('refreshToken');
    const res = await this.authClient.post('/auth/refresh', { refreshToken });
    return res.data as ApiResponse;
  }

  // 조사 API
  async createMeeting(data: any): Promise<ApiResponse> {
    return this.client.post('/meetings', data);
  }

  async getMeetings(params?: Record<string, any>): Promise<ApiResponse> {
    return this.client.get('/meetings', { params });
  }

  async getMeetingById(id: string): Promise<ApiResponse> {
    return this.client.get(`/meetings/${id}`);
  }

  async updateMeeting(id: string, data: any): Promise<ApiResponse> {
    return this.client.patch(`/meetings/${id}`, data);
  }

  async deleteMeeting(id: string): Promise<ApiResponse> {
    return this.client.delete(`/meetings/${id}`);
  }

  // 분석 API
  async getAnalysis(meetingId: string): Promise<ApiResponse> {
    return this.client.get(`/analysis/meeting/${meetingId}`);
  }

  /** 본인 목소리 등록. 클립은 2~10초여야 한다 — 서버도 같은 값을 검사한다. */
  async enrollVoice(clip: File, durationMs: number): Promise<ApiResponse> {
    const form = new FormData();
    form.append('audio', clip);
    form.append('durationMs', String(Math.round(durationMs)));
    return this.client.post('/users/me/voice', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  }

  async deleteVoice(): Promise<ApiResponse> {
    return this.client.delete('/users/me/voice');
  }

  /** 액션 아이템 완료 체크 저장 (순번 배열) */
  async setActionItemsDone(meetingId: string, done: number[]): Promise<ApiResponse> {
    return this.client.patch(`/analysis/meeting/${meetingId}/action-items`, { done });
  }

  async getTranscript(meetingId: string): Promise<ApiResponse> {
    return this.client.get(`/analysis/meeting/${meetingId}/transcript`);
  }

  // 대시보드 API
  async getDashboard(): Promise<ApiResponse> {
    return this.client.get('/dashboard/score/me');
  }

  async getHome(): Promise<ApiResponse> {
    return this.client.get('/dashboard/home/me');
  }

  async getInsights(): Promise<ApiResponse> {
    return this.client.get('/dashboard/insights/me');
  }

  // 대상자 API
  async getCustomers(params?: Record<string, any>): Promise<ApiResponse> {
    return this.client.get('/customers', { params });
  }

  async getCustomerById(id: string): Promise<ApiResponse> {
    return this.client.get(`/customers/${id}`);
  }

  async createCustomer(data: any): Promise<ApiResponse> {
    return this.client.post('/customers', data);
  }

  // 액션 API
  async getActions(params?: Record<string, any>): Promise<ApiResponse> {
    return this.client.get('/actions', { params });
  }

  async updateAction(id: string, data: any): Promise<ApiResponse> {
    return this.client.patch(`/actions/${id}`, data);
  }

  // 사용자 API
  async getMe(): Promise<ApiResponse> {
    return this.client.get('/users/me');
  }

  async updateProfile(data: any): Promise<ApiResponse> {
    return this.client.patch('/users/me', data);
  }

  // 관리자 API
  async adminListUsers(): Promise<ApiResponse> {
    return this.client.get('/admin/users');
  }

  async adminCreateUser(data: {
    email: string; name: string; password: string; role?: string;
  }): Promise<ApiResponse> {
    return this.client.post('/admin/users', data);
  }

  /** 지우면 무슨 일이 벌어지는지 **먼저** 본다 (023). 아무것도 지우지 않는다 */
  async adminUserDeletion(id: string): Promise<ApiResponse> {
    return this.client.get(`/admin/users/${id}/deletion`);
  }
  /** 이메일을 그대로 적어야 지워진다 — 목록에서 한 줄 잘못 누르는 것을 막는다 */
  async adminDeleteUser(id: string, confirm: string): Promise<ApiResponse> {
    return this.client.delete(`/admin/users/${id}`, { data: { confirm } });
  }
  /** 인계. **이것이 없으면 삭제도 비활성화도 막다른 길이다** — 수사사건은 담당자만 본다.
   *  수사사건·기한·대상자·조사·녹음·메일을 **전부** 옮긴다 (023 의 blockers 와 같은 목록) */
  async adminTransferMatters(id: string, toUserId: string): Promise<ApiResponse> {
    return this.client.post(`/admin/users/${id}/transfer`, { toUserId });
  }
  async adminResetPassword(id: string, newPassword: string): Promise<ApiResponse> {
    return this.client.post(`/admin/users/${id}/reset-password`, { newPassword });
  }
  async adminSetUserActive(id: string, isActive: boolean): Promise<ApiResponse> {
    return this.client.patch(`/admin/users/${id}`, { isActive });
  }
}

// 싱글톤 인스턴스
export const apiClient = new APIClient();
