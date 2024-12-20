/* eslint-disable import/prefer-default-export */
export const navLinks = [
  {
    id: 1,
    link: '/projects',
    linkName: 'Projects',
  },
  {
    id: 2,
    link: '/dashboard',
    linkName: 'Dashboard',
  },
];

export const tabOptions = [
  {
    id: 1,
    label: 'Basic Details',
    value: 1,
  },
  {
    id: 2,
    label: 'Other Details',
    value: 2,
  },
  {
    id: 3,
    label: 'Password',
    value: 3,
  },
];

export const projectOptions = [
  {
    id: 0,
    label: 'ABOUT',
    value: 'about',
  },
  {
    id: 1,
    label: 'AVAILABLE TASKS',
    value: 'tasks',
  },
  {
    id: 2,
    label: 'INSTRUCTIONS',
    value: 'instructions',
  },
  {
    id: 3,
    label: 'CONTRIBUTIONS',
    value: 'contributions',
  },
];

export const droneOperatorOptions = [
  {
    name: 'Yes',
    value: 'yes',
    label: 'Yes',
  },
  {
    name: 'No',
    value: 'no',
    label: 'No',
  },
];

// keys only present in project creator form
export const projectCreatorKeys = [
  'organization_name',
  'organization_address',
  'job_title',
  'confirm_password',
  // 'country_code',
];

// keys only present in drone operator form
export const droneOperatorKeys = [
  'notify_for_projects_within_km',
  'experience_years',
  'certified_drone_operator',
  'drone_you_own',
  'confirm_password',
  // 'country_code',
];

export const rowsPerPageOptions = [
  { label: '12', value: 12 },
  { label: '18', value: 18 },
  { label: '24', value: 24 },
  { label: '30', value: 30 },
];

export const taskStatusObj = {
  request_logs: ['REQUEST_FOR_MAPPING'],
  ongoing: ['LOCKED_FOR_MAPPING', 'IMAGE_UPLOADED', 'IMAGE_PROCESSING_STARTED', 'IMAGE_PROCESSING_FAILED'],
  completed: ['IMAGE_PROCESSING_FINISHED'],
  unflyable: ['UNFLYABLE_TASK'],
};
