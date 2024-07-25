/* eslint-disable no-unused-vars */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Flex } from '@Components/common/Layouts';
import { toast } from 'react-toastify';
import { UserProfileDetailsType } from './types';

const { BASE_URL } = process.env;

function GoogleAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isReadyToRedirect, setIsReadyToRedirect] = useState(false);
  const [userProfileDetails, setUserProfileDetails] =
    useState<UserProfileDetailsType>();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const authcode = params.get('code');
    const state = params.get('state');

    const loginRedirect = async () => {
      if (authcode) {
        const callbackUrl = `${BASE_URL}/users/callback/?code=${authcode}&state=${state}`;
        const userDetailsUrl = `${BASE_URL}/users/my-info/`;

        const completeLogin = async () => {
          // fetch callback api
          const response = await fetch(callbackUrl, { credentials: 'include' });
          const token = await response.json();
          localStorage.setItem('token', token.access_token);
          localStorage.setItem('refresh', token.refresh_token);

          // fetch user details
          const response2 = await fetch(userDetailsUrl, {
            credentials: 'include',
            headers: { 'access-token': token.access_token },
          });
          const userDetails = await response2.json();

          // stringify the response and set it to local storage
          const userDetailsString = JSON.stringify(userDetails);
          localStorage.setItem('userprofile', userDetailsString);
          setUserProfileDetails(userDetails);

          // navigate according the user
          if (userDetails?.has_user_profile) {
            navigate('/projects');
          } else {
            navigate('/user-profile');
          }
        };
        await completeLogin();
        toast.success('Logged In Successfully');
      }
      setIsReadyToRedirect(true);
    };
    loginRedirect();
  }, [location.search]);

  return (
    <Flex className="naxatw-h-screen-nav naxatw-w-full naxatw-animate-pulse naxatw-items-center naxatw-justify-center">
      <h3>Redirecting....</h3>
    </Flex>
  );
}

export default GoogleAuth;
