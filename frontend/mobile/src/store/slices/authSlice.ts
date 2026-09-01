import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { User, AuthResponse } from '../../types';
import type { MMKV as MMKVType } from 'react-native-mmkv';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
}

let storage: any;
try {
  const { MMKV } = require('react-native-mmkv');
  storage = new MMKV();
} catch {
  storage = { getString: () => null, setString: () => {}, delete: () => {} };
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  isLoading: false,
  error: null,
  isAuthenticated: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    loginRequest: (state) => {
      state.isLoading = true;
      state.error = null;
    },

    loginSuccess: (state, action: PayloadAction<AuthResponse>) => {
      state.isLoading = false;
      state.isAuthenticated = true;
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      state.error = null;

      // MMKV 스토리지에 저장 (React Native 최적화)
      storage.setString('accessToken', action.payload.accessToken);
      storage.setString('refreshToken', action.payload.refreshToken);
      storage.setString('user', JSON.stringify(action.payload.user));
    },

    loginFailure: (state, action: PayloadAction<string>) => {
      state.isLoading = false;
      state.error = action.payload;
      state.isAuthenticated = false;
    },

    logout: (state) => {
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      state.isAuthenticated = false;
      state.error = null;

      storage.delete('accessToken');
      storage.delete('refreshToken');
      storage.delete('user');
    },

    refreshTokenSuccess: (state, action: PayloadAction<{ accessToken: string }>) => {
      state.accessToken = action.payload.accessToken;
      storage.setString('accessToken', action.payload.accessToken);
    },

    restoreTokens: (state, action: PayloadAction<{ accessToken: string; refreshToken: string; user: User }>) => {
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      state.user = action.payload.user;
      state.isAuthenticated = true;
    },
  },
});

export const {
  loginRequest,
  loginSuccess,
  loginFailure,
  logout,
  refreshTokenSuccess,
  restoreTokens,
} = authSlice.actions;

export default authSlice.reducer;
