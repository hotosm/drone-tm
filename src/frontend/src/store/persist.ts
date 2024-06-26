import storage from 'redux-persist/lib/storage';
import { persistReducer } from 'redux-persist';
import { AnyAction, Reducer } from '@reduxjs/toolkit';
import { IRootReducer } from './reducers';

export default function persist(
  key: string,
  whitelist: string[],
  reducer: Reducer,
) {
  return persistReducer<IRootReducer, AnyAction>(
    {
      key,
      storage,
      whitelist,
    },
    reducer,
  ) as Reducer;
}
