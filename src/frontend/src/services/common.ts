import { UserProfileDetailsType } from '@Components/GoogleAuth/types';
import axios from 'axios';
import { api, authenticated } from '.';

const { OSM_NOMINATIM_URL } = process.env;

export const signInUser = (data: any) => api.post('/users/login/', data);

export const signInGoogle = () => api.get('/users/google-login');

export const signInCallBackUrl = () => api.get('/users/callback/');

export const logoutUser = () => api.post('/user/logout/');

export const postUserProfile = ({
  userId,
  data,
}: {
  userId: number;
  data: UserProfileDetailsType;
}) =>
  authenticated(api).post(`/users/${userId}/profile`, data, {
    headers: { 'Content-Type': 'application/json' },
  });

export const getUserProfileInfo = () =>
  authenticated(api).get('/users/my-info/');

export const patchUserProfile = ({ userId, data }: Record<string, any>) =>
  authenticated(api).patch(`/users/${userId}/profile`, data, {
    headers: { 'Content-Type': 'application/json' },
  });

export const getCountry = (params: {
  lat: number;
  lon: number;
  format: string;
}) => axios.get(`${OSM_NOMINATIM_URL}/reverse`, { params });
