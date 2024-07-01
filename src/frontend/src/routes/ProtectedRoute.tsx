import { ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

interface IProtectedRoute {
  isAuthenticated: boolean;
  redirectPath?: string;
  children?: ReactElement;
}
export default function ProtectedRoute({
  isAuthenticated,
  redirectPath = '/login',
  children,
}: IProtectedRoute): ReactElement {
  if (!isAuthenticated) {
    return <Navigate to={redirectPath} replace />;
  }
  return children || <Outlet />;
}
