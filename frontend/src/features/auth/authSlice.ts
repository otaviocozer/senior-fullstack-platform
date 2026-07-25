import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { User } from '../../types';
import {
  clearAuthStorage,
  getStoredUser,
  setStoredUser,
  setTokens,
} from './tokenStorage';

interface AuthState {
  user: User | null;
  /**
   * True while we still might have a valid session but haven't confirmed the
   * user (e.g. we have tokens in storage but no user object yet and are
   * fetching /auth/me). Consumers can use this to avoid a login flash.
   */
  initialized: boolean;
}

const initialState: AuthState = {
  user: getStoredUser(),
  initialized: false,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /** Persist tokens + user after a successful login. */
    credentialsReceived(
      state,
      action: PayloadAction<{ access: string; refresh: string; user: User }>,
    ) {
      const { access, refresh, user } = action.payload;
      setTokens(access, refresh);
      setStoredUser(user);
      state.user = user;
      state.initialized = true;
    },
    /** Update just the cached user (e.g. after /auth/me). */
    userLoaded(state, action: PayloadAction<User>) {
      setStoredUser(action.payload);
      state.user = action.payload;
      state.initialized = true;
    },
    markInitialized(state) {
      state.initialized = true;
    },
    /** Clear everything on logout or unrecoverable auth failure. */
    loggedOut(state) {
      clearAuthStorage();
      state.user = null;
      state.initialized = true;
    },
  },
});

export const { credentialsReceived, userLoaded, markInitialized, loggedOut } =
  authSlice.actions;

export default authSlice.reducer;
