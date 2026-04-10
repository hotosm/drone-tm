/* eslint-disable no-param-reassign */
import axios, { AxiosInstance } from "axios";
import { toast } from "react-toastify";

import { getRuntimeConfig } from "@/runtimeConfig";

const API_URL = getRuntimeConfig("VITE_API_URL", "/api");

export const api = axios.create({
  baseURL: API_URL,
  timeout: 5 * 60 * 1000,
  headers: {
    accept: "application/json",
    "Content-Type": "multipart/form-data",
  },
});

// This interceptor is required to set token on request
function requestInterceptorFunction(config: any): any {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers["Access-Token"] = token;
  }
  return config;
}

api.interceptors.request.use(requestInterceptorFunction);
api.interceptors.response.use(
  (response) => response,
  async (responseError) => {
    // handle token expire or invalid token case
    const originalRequest = responseError.config;

    // Handle 401 for Hanko SSO (cookie expired)
    const token = localStorage.getItem("token");
    const userprofile = localStorage.getItem("userprofile");
    if (responseError.response?.status === 401 && !token && userprofile) {
      // Hanko session expired - clean up localStorage
      localStorage.removeItem("userprofile");
      localStorage.removeItem("signedInAs");
      toast.error("Session Expired. Please Re-login.");
      window.location.href = "/";
      return Promise.reject(responseError);
    }

    // Handle 401 for legacy token
    if (
      responseError.response?.status === 401 &&
      responseError.response?.data?.detail === "Access token not valid" &&
      // eslint-disable-next-line no-underscore-dangle
      !originalRequest._retry
    ) {
      // eslint-disable-next-line no-underscore-dangle
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem("refresh");

      if (refreshToken) {
        try {
          const response = await axios.get(`${API_URL}/users/refresh-token`, {
            headers: { "access-token": refreshToken },
          });
          const newAccessToken = response.data.access_token;
          localStorage.setItem("token", newAccessToken); // set new access token
          originalRequest.headers["Access-Token"] = `${newAccessToken}`;
          return axios(originalRequest); // recall Api with new token1
        } catch (error: any) {
          toast.error("Session Expired. Please Re-login.");
          localStorage.removeItem("token");
          localStorage.removeItem("refresh");
          window.location.href = "/";
          return Promise.reject(responseError);
        }
      }
    }
    // eslint-disable-next-line prefer-promise-reject-errors
    return Promise.reject({ ...responseError });
  },
);

export const authenticated = (apiInstance: AxiosInstance) => {
  const token = localStorage.getItem("token");

  // When using Hanko SSO, we need to send cookies for authentication
  // Set withCredentials=true to include cookies in CORS requests
  apiInstance.defaults.withCredentials = true;

  // For legacy authentication, also set Access-Token header if token exists
  if (token) {
    apiInstance.defaults.headers.common["Access-Token"] = `${token}`;
  }

  return apiInstance;
};
