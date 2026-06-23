import { ReactElement } from "react";
import { Navigate, Outlet } from "react-router-dom";

interface IPublicOnlyRoute {
  isAuthenticated: boolean;
  redirectPath?: string;
  children?: ReactElement;
}

export default function PublicOnlyRoute({
  isAuthenticated,
  redirectPath = "/projects",
  children,
}: IPublicOnlyRoute): ReactElement {
  if (isAuthenticated) {
    return <Navigate to={redirectPath} replace />;
  }

  return children || <Outlet />;
}
