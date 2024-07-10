import { put } from 'redux-saga/effects';
import { PayloadAction } from '@reduxjs/toolkit';
import { startAction, stopAction } from '@Store/actions/loader';

/**
 *
 * Wrapper function for reducing loader action boilerplate in saga.
 *
 * @param {function} fn - worker saga function
 *
 * @returns {function} function that handles loader action start and stop.
 *
 * @example
 * function loginWatcher() {
 *   yield takeLatest(Types.LOGIN_REQUEST, withLoader(loginRequest));
 * }
 */

export function withLoader(func: Function) {
  return function* loaderActionWrappper(action: PayloadAction) {
    try {
      yield put(startAction(action.type));
      yield func(action);
    } catch (err) {
      // eslint-disable-next-line no-console
      // console.log(err);
    } finally {
      yield put(stopAction(action.type));
    }
  };
}

export const nothing = '';
