import { createSlice } from '@reduxjs/toolkit';
import type { CaseReducer, PayloadAction } from '@reduxjs/toolkit';
import persist from '../persist';

export interface UserState {
  user: Record<string, any> | null;
  userProfile: Record<string, any> | null;
  permissions: string[];
}

const initialState: UserState = {
  user: null,
  userProfile: null,
  permissions: [],
};

const setUserState: CaseReducer<
  UserState,
  PayloadAction<Partial<UserState>>
> = (state, action) => ({
  ...state,
  ...action.payload,
});

const resetUserState: CaseReducer<UserState> = () => ({
  ...initialState,
});

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUserState,
    resetUserState,
  },
});

export { userSlice };

export default persist(
  'user',
  ['user', 'permissions', 'userProfile'],
  userSlice.reducer,
);
