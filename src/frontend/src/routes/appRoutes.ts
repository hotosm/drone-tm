import Projects from '@Views/Projects';
import Dashboard from '@Views/Dashboard';
import CompleteUserProfile from '@Views/CompleteUserProfile';
import CreateProject from '@Components/CreateProject';
import GoogleAuth from '@Components/GoogleAuth';
import userRoutes from '@UserModule/routes';
import LandingPage from '@Views/LandingPage';
import IndividualProject from '@Views/IndividualProject';
import TaskDescription from '@Views/TaskDescription';
import UpdateUserProfile from '@Views/UpdateUserProfile';
import RegulatorsApprovalPage from '@Views/RegulatorsApprovalPage';
import { IRoute } from './types';

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
    path: '/complete-profile',
    name: 'Complete Profile',
    component: CompleteUserProfile,
    authenticated: true,
  },
  {
    path: 'projects/:projectId/tasks/:taskId',
    name: 'Task description',
    component: TaskDescription,
    authenticated: true,
  },

  {
    path: '/user-profile',
    name: 'User Profile',
    component: UpdateUserProfile,
    authenticated: true,
  },
  {
    path: 'projects/:id/approval',
    name: 'Task project approval',
    component: RegulatorsApprovalPage,
    authenticated: true,
  },
];

export default appRoutes;
