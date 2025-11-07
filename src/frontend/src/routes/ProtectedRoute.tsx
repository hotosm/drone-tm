import { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

interface IProtectedRoute {
  isAuthenticated: boolean;
  redirectPath?: string;
  children?: ReactElement;
}
export default function ProtectedRoute({
  isAuthenticated,
  redirectPath = '/',
  children,
}: IProtectedRoute): ReactElement {
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to={redirectPath} state={{ from: location }} replace />;
  }

  return children || <Outlet />;
}
