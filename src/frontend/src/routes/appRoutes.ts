import Projects from '@Views/Projects';
import Dashboard from '@Views/Dashboard';
import UserProfile from '@Views/UserProfile';
import CreateProject from '@Components/CreateProject';
import GoogleAuth from '@Components/GoogleAuth';
import userRoutes from '@UserModule/routes';
import LandingPage from '@Views/LandingPage';
import { IRoute } from './types';
import IndividualProject from '@Components/IndividualProject';

const appRoutes: IRoute[] = [
  ...userRoutes,
  {
    path: '/',
    name: 'Landing Page',
    component: LandingPage,
    authenticated: false,
  },
  {
    path: '/projects',
    name: 'Projects ',
    component: Projects,
    authenticated: true,
  },
  {
    path: '/auth',
    name: 'Google Authentication',
    component: GoogleAuth,
    authenticated: false,
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: Dashboard,
    authenticated: true,
  },
  {
    path: '/create-project',
    name: 'Create Project',
    component: CreateProject,
    authenticated: true,
  },
  {
    path: '/projects/:id',
    name: 'Individual Project',
    component: IndividualProject,
    authenticated: true,
  },
  {
    path: '/user-profile',
    name: 'User Profile',
    component: UserProfile,
    authenticated: true,
  },
];

export default appRoutes;
