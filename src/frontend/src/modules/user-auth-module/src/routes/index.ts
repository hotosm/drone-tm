import React, { LazyExoticComponent } from 'react';
import AuthenticationPage from '../components/Authentication';

interface IRoute {
  id?: number;
  path: string;
  name: string;
  component:
    | LazyExoticComponent<() => React.JSX.Element>
    | (() => React.JSX.Element);
  authenticated?: boolean;
  children?: IRoute[];
}

const userRoutes: IRoute[] = [
  {
    path: '/login',
    name: 'Login',
    component: AuthenticationPage,
    authenticated: false,
  },
  {
    path: '/forgot-password',
    name: 'ForgotPassword',
    component: AuthenticationPage,
    authenticated: false,
  },
];

export default userRoutes;
