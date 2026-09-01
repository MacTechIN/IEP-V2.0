import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Meeting, AnalysisResult } from '../../types';

interface MeetingState {
  meetings: Meeting[];
  currentMeeting: Meeting | null;
  currentAnalysis: AnalysisResult | null;
  isLoading: boolean;
  error: string | null;
  total: number;
}

const initialState: MeetingState = {
  meetings: [],
  currentMeeting: null,
  currentAnalysis: null,
  isLoading: false,
  error: null,
  total: 0,
};

const meetingSlice = createSlice({
  name: 'meeting',
  initialState,
  reducers: {
    // 미팅 목록 요청
    fetchMeetingsRequest: (state) => {
      state.isLoading = true;
      state.error = null;
    },

    // 미팅 목록 성공
    fetchMeetingsSuccess: (state, action: PayloadAction<{ meetings: Meeting[]; total: number }>) => {
      state.isLoading = false;
      state.meetings = action.payload.meetings;
      state.total = action.payload.total;
    },

    // 미팅 목록 실패
    fetchMeetingsFailure: (state, action: PayloadAction<string>) => {
      state.isLoading = false;
      state.error = action.payload;
    },

    // 미팅 상세 설정
    setCurrentMeeting: (state, action: PayloadAction<Meeting>) => {
      state.currentMeeting = action.payload;
    },

    // 분석 결과 설정
    setCurrentAnalysis: (state, action: PayloadAction<AnalysisResult>) => {
      state.currentAnalysis = action.payload;
    },

    // 분석 진행률 업데이트
    updateAnalysisProgress: (state, action: PayloadAction<{ meetingId: string; progress: number }>) => {
      if (state.currentMeeting?.id === action.payload.meetingId) {
        state.currentMeeting.analysisProgress = action.payload.progress;
      }
    },

    // 미팅 추가
    addMeeting: (state, action: PayloadAction<Meeting>) => {
      state.meetings.unshift(action.payload);
      state.total += 1;
    },

    // 에러 클리어
    clearError: (state) => {
      state.error = null;
    },
  },
});

export const {
  fetchMeetingsRequest,
  fetchMeetingsSuccess,
  fetchMeetingsFailure,
  setCurrentMeeting,
  setCurrentAnalysis,
  updateAnalysisProgress,
  addMeeting,
  clearError,
} = meetingSlice.actions;

export default meetingSlice.reducer;
