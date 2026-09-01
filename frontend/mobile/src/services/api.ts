import axios, { AxiosInstance, AxiosError } from 'axios';
import type { MMKV as MMKVType } from 'react-native-mmkv';
import type { ApiResponse } from '../types';

let storage: any;
try {
  const { MMKV } = require('react-native-mmkv');
  storage = new MMKV();
} catch {
  // Fallback for type-check environment
  storage = { getString: () => null, setString: () => {}, delete: () => {} };
}

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api/v2';

class APIClient {
  private client: AxiosInstance;
  private accessToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
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
        if (error.response?.status === 401) {
          try {
            const response = await this.refresh();
            if (response.success) {
              this.setAccessToken(response.data.accessToken);
              return this.client.request(error.config!);
            }
          } catch (e) {
            this.logout();
          }
        }
        return Promise.reject(error.response?.data || error);
      },
    );

    this.restoreToken();
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
    storage.setString('accessToken', token);
  }

  private restoreToken(): void {
    const token = storage.getString('accessToken');
    if (token) {
      this.accessToken = token;
    }
  }

  logout(): void {
    this.accessToken = null;
    storage.delete('accessToken');
    storage.delete('refreshToken');
  }

  // 인증 API
  async login(email: string, password: string): Promise<ApiResponse> {
    const response = await this.client.post('/auth/login', { email, password }) as ApiResponse;
    if (response.success && response.data?.accessToken) {
      this.setAccessToken(response.data.accessToken);
      storage.setString('refreshToken', response.data.refreshToken);
      storage.setString('user', JSON.stringify(response.data.user));
    }
    return response;
  }

  async refresh(): Promise<ApiResponse> {
    const refreshToken = storage.getString('refreshToken');
    return this.client.post('/auth/refresh', { refreshToken });
  }

  // 미팅 API
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

  // 분석 API
  async getAnalysis(meetingId: string): Promise<ApiResponse> {
    return this.client.get(`/analysis/meeting/${meetingId}`);
  }

  // 대시보드 API
  async getDashboard(): Promise<ApiResponse> {
    return this.client.get('/dashboard/score/me');
  }

  // 고객 API
  async getCustomers(params?: Record<string, any>): Promise<ApiResponse> {
    return this.client.get('/customers', { params });
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
}

export const apiClient = new APIClient();
