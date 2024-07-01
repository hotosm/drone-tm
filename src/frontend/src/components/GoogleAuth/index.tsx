/* eslint-disable no-unused-vars */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Flex } from '@Components/common/Layouts';

const { BASE_URL } = process.env;

function GoogleAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isReadyToRedirect, setIsReadyToRedirect] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const authcode = params.get('code');
    const state = params.get('state');

    const loginRedirect = async () => {
      if (authcode) {
        const callbackUrl = `${BASE_URL}/users/callback/?code=${authcode}&state=${state}`;

        const completeLogin = async () => {
          await fetch(callbackUrl, { credentials: 'include' });
        };

        await completeLogin();
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
