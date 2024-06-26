import { put } from 'redux-saga/effects';
import { PayloadAction } from '@reduxjs/toolkit';
import { startAction, stopAction } from '@Store/actions/loader';
// import toastActions from '@src/actions/toast';
// import errorResponseHandler from './errorResponseHandler';

// /**
//  *
//  * Wrapper function for reducing loader action boilerplate in saga.
//  *
//  * @param {function} fn - worker saga function
//  *
//  * @returns {function} function that handles loader action start and stop.
//  *
//  * @example
//  * function loginWatcher() {
//  *   yield takeLatest(Types.LOGIN_REQUEST, withLoader(loginRequest));
//  * }
//  */

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

// /**
//  *
//  * Wrapper function for abstracting task cancellation in redux saga.
//  *
//  * @param {function} workerSaga - worker saga function
//  * @param {string} cancelActionType - cancel action type
//  *
//  * @returns {function} function that handles task cancellation out of the box.
//  *
//  * @example
//  * yield takeLatest(
//  *   Types.LOGIN_REQUEST,
//  *   cancelable(loginRequest, Types.LOGIN_REQUEST_CANCEL),
//  * );
//  */
// export function cancelable(workerSaga, cancelActionType) {
//   return function* cancelableSagaWorker(action) {
//     // starts the task in the background
//     const cancelableTask = yield fork(workerSaga, action);
//
//     // wait for the user stop action
//     yield take(cancelActionType);
//
//     // cancel the background task
//     // this will cause the forked task to jump into its finally block
//     yield cancel(cancelableTask);
//   };
// }
//
// /**
//  *
//  * Wrapper function for reducing toast action boilerplate in saga.
//  *
//  * @param {function} fn - worker saga function
//  *
//  * @returns {function} function that handles toast action start and stop.
//  *
//  * @example
//  * function loginWatcher() {
//  *   yield takeLatest(Types.LOGIN_REQUEST, withErrorHandler(loginRequest));
//  * }
//  */
// export function withErrorHandler(func) {
//   return function* errorHandlerWrapper(action) {
//     try {
//       yield func(action);
//     } catch (err) {
//       yield put(
//         toastActions.error({
//           message: errorResponseHandler(err),
//           delay: 20 * 1000,
//         }),
//       );
//     }
//   };
// }
//
// export const getFormattedErrorMessage = err =>
//   err
//     .map((error, index) => `${index + 1}. ${error.errorName}: ${error.details}`)
//     .join(', ');
//
// /**
//  * Function for catching the error in saga.
//  *
//  * @param {Object} error - error occured - in ui, during api call and after api call
//  *
//  * @returns {string} error message as string.
//  */
// export const catchHandler = error => {
//   // eslint-disable-next-line no-console
//   console.log({ error });
//   if (error?.response?.status) {
//     if (error?.response?.status === 404) {
//       return `Something's wrong${
//         error?.response?.config?.url
//           ? ` in ${error?.response?.config?.url}`
//           : ''
//       }. Please try again later.`;
//     }
//     if (error?.response?.status >= 400 && error?.response?.status < 600) {
//       return ``;
//     }
//     if (error?.response?.data?.Error) {
//       if (typeof error.response.data.Error === 'string') {
//         return error.response.data.Error;
//       }
//       return getFormattedErrorMessage(error.response.data.Error);
//     }
//     if (error?.response?.data) {
//       if (typeof error.response.data === 'string') {
//         return error.response.data;
//       }
//       const errorothers = Object.keys(error.response.data).map(item => ({
//         errorName: item,
//         details: error.response.data[item],
//       }));
//       return getFormattedErrorMessage(errorothers);
//     }
//     return "Something's wrong. Please try again later.";
//   }
//   return String(error);
// };
