import { lazy } from "react";
import userRoutes from "@UserModule/routes";
import LandingPage from "@Views/LandingPage";
import { IRoute } from "./types";

// Lazy-load all routes except the landing page (which is the entry point)
const Projects = lazy(() => import("@Views/Projects"));
const Dashboard = lazy(() => import("@Views/Dashboard"));
const CompleteUserProfile = lazy(() => import("@Views/CompleteUserProfile"));
const CreateProject = lazy(() => import("@Components/CreateProject"));
const GoogleAuth = lazy(() => import("@Components/GoogleAuth"));
const HankoAuth = lazy(() => import("@Components/HankoAuth"));
const IndividualProject = lazy(() => import("@Views/IndividualProject"));
const TaskDescription = lazy(() => import("@Views/TaskDescription"));
const UpdateUserProfile = lazy(() => import("@Views/UpdateUserProfile"));
const RegulatorsApprovalPage = lazy(() => import("@Views/RegulatorsApprovalPage"));
const Tutorials = lazy(() => import("@Views/Tutorial"));
const ImportPage = lazy(() => import("@Views/Import"));
const View3DModel = lazy(() => import("@Views/View3DModel"));
const ViewOrthophoto = lazy(() => import("@Views/ViewOrthophoto"));
const FlyMyDronePage = lazy(() => import("@Views/TryDrone"));

const appRoutes: IRoute[] = [
  ...userRoutes,
  {
    path: "/",
    name: "Landing Page",
    component: LandingPage,
    authenticated: false,
  },
  {
    path: "tutorials",
    name: "tutorials",
    component: Tutorials,
  },
  {
    path: "/projects",
    name: "Projects ",
    component: Projects,
    authenticated: false,
  },
  {
    path: "/auth",
    name: "Google Authentication",
    component: GoogleAuth,
    authenticated: false,
  },
  {
    path: "/hanko-auth",
    name: "Hanko Authentication",
    component: HankoAuth,
    authenticated: false,
  },
  {
    path: "/dashboard",
    name: "Dashboard",
    component: Dashboard,
    authenticated: true,
  },
  {
    path: "/create-project",
    name: "Create Project",
    component: CreateProject,
    authenticated: true,
  },
  {
    path: "/projects/:id",
    name: "Individual Project",
    component: IndividualProject,
    authenticated: false,
  },
  {
    path: "/complete-profile",
    name: "Complete Profile",
    component: CompleteUserProfile,
    authenticated: true,
  },
  {
    path: "projects/:projectId/tasks/:taskId",
    name: "Task description",
    component: TaskDescription,
    authenticated: true,
  },

  {
    path: "/user-profile",
    name: "User Profile",
    component: UpdateUserProfile,
    authenticated: true,
  },
  {
    path: "projects/:id/approval",
    name: "Task project approval",
    component: RegulatorsApprovalPage,
    authenticated: false,
  },
  {
    path: "/import",
    name: "Import Imagery",
    component: ImportPage,
    authenticated: true,
  },
  {
    path: "/projects/:id/3d-model",
    name: "3D Model Viewer",
    component: View3DModel,
    authenticated: false,
  },
  {
    path: "/projects/:id/orthophoto",
    name: "Orthophoto Viewer",
    component: ViewOrthophoto,
    authenticated: false,
  },
  {
    path: "/try-drone",
    name: "Fly My Drone",
    component: FlyMyDronePage,
    authenticated: false,
  },
];

export default appRoutes;
