/* eslint-disable react-hooks/rules-of-hooks */
import { Route, Routes } from 'react-router-dom';
import { ReactNode, Suspense } from 'react';
import Fallback from '@Components/common/Fallback';
import useAuth from '@Hooks/useAuth';
import ProtectedRoute from './ProtectedRoute';
import { IRoute } from './types';

interface IGenerateRouteParams {
  routes: IRoute[];
  fallback?: ReactNode;
}
export default function generateRoutes({
  routes,
  fallback = <Fallback />,
}: IGenerateRouteParams) {
  const { isAuthenticated } = useAuth();

  return (
    <Suspense fallback={fallback}>
      <Routes>
        {routes?.map(route => {
          if (route.authenticated) {
            return (
              <Route
                key={route.name}
                element={<ProtectedRoute isAuthenticated={isAuthenticated()} />}
              >
                {route?.children ? (
                  <Route key={route.name} path={route.path}>
                    {route?.children?.map(child => (
                      <Route
                        key={child.name}
                        path={child.path}
                        element={<child.component />}
                      />
                    ))}
                  </Route>
                ) : (
                  <Route
                    key={route.name}
                    path={route.path}
                    element={<route.component />}
                  />
                )}
              </Route>
            );
          }
          return route?.children ? (
            <Route key={route.name} path={route.path}>
              {route?.children?.map(child => (
                <Route
                  key={child.name}
                  path={child.path}
                  element={<child.component />}
                />
              ))}
            </Route>
          ) : (
            <Route
              key={route.name}
              path={route.path}
              element={<route.component />}
            />
          );
        })}
      </Routes>
    </Suspense>
  );
}
