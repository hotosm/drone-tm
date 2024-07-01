/* eslint-disable no-param-reassign */
import axios, { AxiosInstance } from 'axios';

const { API_URL_V1, BASE_URL } = process.env;

export const baseURL = BASE_URL;
export const apiURL = API_URL_V1;

export const api = axios.create({
  baseURL: API_URL_V1,
  timeout: 5 * 60 * 1000,
  headers: {
    accept: 'application/json',
    'Content-Type': 'multipart/form-data',
  },
});

export const authenticated = (apiInstance: AxiosInstance) => {
  const token = localStorage.getItem('token');
  if (!token) return apiInstance;
  if (process.env.NODE_ENV === 'development') {
    apiInstance.defaults.headers.common.Authorization = `Token ${token}`;
  } else {
    apiInstance.defaults.headers.common.Authorization = `Token ${token}`;
    apiInstance.defaults.withCredentials = false;
  }
  return apiInstance;
};
