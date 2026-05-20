import { m } from "@/paraglide/messages";

export const dashboardCardsForProjectCreator = () => [
  {
    id: 1,
    title: m.dashboard_request_logs_title(),
    value: "request_logs",
  },
  {
    id: 2,
    title: m.dashboard_ongoing_tasks_title(),
    value: "ongoing_tasks",
  },
  {
    id: 3,
    title: m.dashboard_unflyable_tasks_title(),
    value: "unflyable_tasks",
  },
  {
    id: 4,
    title: m.dashboard_completed_tasks_title(),
    value: "completed_tasks",
  },
];

export const dashboardCardsForDroneOperator = () => [
  {
    id: 1,
    title: m.dashboard_ongoing_tasks_title(),
    value: "ongoing_tasks",
  },
  {
    id: 2,
    title: m.dashboard_unflyable_tasks_title(),
    value: "unflyable_tasks",
  },
  {
    id: 3,
    title: m.dashboard_completed_tasks_title(),
    value: "completed_tasks",
  },
];
