/* eslint-disable import/prefer-default-export */
import { m } from "@/paraglide/messages";

export const navLinks = [
  {
    id: 1,
    link: "/projects",
    linkName: m.nav_projects(),
  },
  {
    id: 2,
    link: "/dashboard",
    linkName: m.nav_dashboard(),
  },
];

export const tabOptions = [
  {
    id: 1,
    label: m.user_profile_tab_basic_details(),
    value: 1,
  },
  {
    id: 2,
    label: m.user_profile_tab_other_details(),
    value: 2,
  },
  {
    id: 3,
    label: m.user_profile_tab_password(),
    value: 3,
    hideForHanko: true,
  },
];

export const projectOptions = [
  {
    id: 0,
    label: m.individual_project_tab_about(),
    value: "about",
  },
  {
    id: 1,
    label: m.individual_project_tab_tasks(),
    value: "tasks",
  },
  {
    id: 2,
    label: m.individual_project_tab_instructions(),
    value: "instructions",
  },
  {
    id: 3,
    label: m.individual_project_tab_contributions(),
    value: "contributions",
  },
];

export const droneOperatorOptions = [
  {
    name: m.common_yes(),
    value: "yes",
    label: m.common_yes(),
  },
  {
    name: m.common_no(),
    value: "no",
    label: m.common_no(),
  },
];

// keys only present in project creator form
export const projectCreatorKeys = [
  "organization_name",
  "organization_address",
  "job_title",
  "confirm_password",
  // 'country_code',
];

// keys only present in drone operator form
export const droneOperatorKeys = [
  "notify_for_projects_within_km",
  "experience_years",
  "certified_drone_operator",
  "drone_you_own",
  "confirm_password",
  // 'country_code',
];

export const rowsPerPageOptions = [
  { label: "12", value: 12 },
  { label: "18", value: 18 },
  { label: "24", value: 24 },
  { label: "30", value: 30 },
];

export const taskStatusObj = {
  request_logs: ["AWAITING_APPROVAL"],
  ongoing: [
    "LOCKED",
    "FULLY_FLOWN",
    "HAS_IMAGERY",
    "READY_FOR_PROCESSING",
    "IMAGE_PROCESSING_STARTED",
    "IMAGE_PROCESSING_FAILED",
  ],
  completed: ["IMAGE_PROCESSING_FINISHED"],
  unflyable: ["HAS_ISSUES"],
};
