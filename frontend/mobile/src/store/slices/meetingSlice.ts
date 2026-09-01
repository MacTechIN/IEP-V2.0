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
    fetchMeetingsRequest: (state) => {
      state.isLoading = true;
      state.error = null;
    },

    fetchMeetingsSuccess: (state, action: PayloadAction<{ meetings: Meeting[]; total: number }>) => {
      state.isLoading = false;
      state.meetings = action.payload.meetings;
      state.total = action.payload.total;
    },

    fetchMeetingsFailure: (state, action: PayloadAction<string>) => {
      state.isLoading = false;
      state.error = action.payload;
    },

    setCurrentMeeting: (state, action: PayloadAction<Meeting>) => {
      state.currentMeeting = action.payload;
    },

    setCurrentAnalysis: (state, action: PayloadAction<AnalysisResult>) => {
      state.currentAnalysis = action.payload;
    },

    updateAnalysisProgress: (state, action: PayloadAction<{ meetingId: string; progress: number }>) => {
      if (state.currentMeeting?.id === action.payload.meetingId) {
        state.currentMeeting.analysisProgress = action.payload.progress;
      }
    },

    addMeeting: (state, action: PayloadAction<Meeting>) => {
      state.meetings.unshift(action.payload);
      state.total += 1;
    },

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
