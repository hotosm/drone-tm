import { Navigate, useLocation } from 'react-router-dom';

import { Flex } from '@Components/common/Layouts';
import Login from './Login';
import ForgotPassword from './ForgotPassword';
import SignInBanner from './SignInBanner';

export default function AuthenticationPage() {
  const { pathname } = useLocation();

  const getContent = () => {
    switch (pathname) {
      case '/login':
        return <Login />;
      case '/forgot-password':
        return <ForgotPassword />;
      default:
        return <Login />;
    }
  };

  if (localStorage.getItem('token')) return <Navigate to="/" />;

  return (
    <Flex className="naxatw-grid naxatw-h-screen naxatw-w-screen md:naxatw-grid-cols-5">
      <Flex className="naxatw-col-span-3">
        <SignInBanner />
      </Flex>
      <Flex className="naxatw-col-span-2 naxatw-bg-white">{getContent()}</Flex>
    </Flex>
  );
}
