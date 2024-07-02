/* eslint-disable import/prefer-default-export */
import rocketIcon from '@Assets/images/LandingPage/RockerIcon.svg';
import targetIcon from '@Assets/images/LandingPage/TargetIcon.svg';

export const accordionData = [
  {
    id: 1,
    title: 'Enhanced Crisis Response',
    description:
      'Significant savings in mapping and surveying costs for underprivileged areas.',
    isOpen: true,
  },
  {
    id: 2,
    title: 'Community Empowerment',
    description:
      "Yes, you can try us for free for 30 days. If you want, we'll provide you with a free, personalized 30-minute onboarding call to get you up and running as soon as possible.",
    isOpen: false,
  },
  {
    id: 3,
    title: 'Cost Reduction',
    description:
      "Yes, you can try us for free for 30 days. If you want, we'll provide you with a free, personalized 30-minute onboarding call to get you up and running as soon as possible.",
    isOpen: false,
  },
  {
    id: 4,
    title: 'Data Accessibility',
    description:
      "Yes, you can try us for free for 30 days. If you want, we'll provide you with a free, personalized 30-minute onboarding call to get you up and running as soon as possible.",
    isOpen: false,
  },
];

export const userAndRolesData = [
  {
    id: 1,
    title: 'Project Managers',
    listItems: [
      {
        id: 1,
        text: 'Create areas for drone mapping',
      },
      {
        id: 2,
        text: 'Plan a flight for the desired imagery characteristics such as flying height, overlaps, angles, Ground Sampling Distance (GSD, essentially resolution), etc.',
      },
      {
        id: 3,
        text: 'Publish Tasks for Drone Operators',
      },
      {
        id: 4,
        text: 'View the progress and updates',
      },
      {
        id: 5,
        text: 'Review the final output',
      },
    ],
  },
  {
    id: 2,
    title: 'Drone Operators',
    listItems: [
      {
        id: 1,
        text: 'Register to participate in imagery acquisition',
      },
      {
        id: 2,
        text: 'Select areas that they are interested in flying from the overall project area',
      },
      {
        id: 3,
        text: 'Download flight plans appropriate to their hardware and capacity',
      },
      {
        id: 4,
        text: 'Operate the drone by pushing a “Fly mission” button, causing the drone to cover the assigned area automatically',
      },
      {
        id: 5,
        text: 'Upload the resulting images to a processing server',
      },
    ],
  },
  {
    id: 3,
    title: 'Data Users',
    listItems: [
      {
        id: 1,
        text: 'Task areas for drone mapping',
      },
      {
        id: 2,
        text: 'Define desired imagery characteristics such as Ground Sampling Distance (GSD, essentially resolution), overlap, angles, etc.',
      },
    ],
  },
];

export const ourRationaleData = [
  {
    id: 1,
    title: 'Limited Access to High Resolution Aerial Datasets',
    description:
      'In low-income and disaster-prone areas, access to near real-time satellite datasets is severely limited. High-resolution satellite imagery, when available, is often expensive and out-of-date. Additionally, full-scale aircraft mapping is not a viable option due to its high costs and operational complexity.',
  },
  {
    id: 2,
    title: 'Limited Engagement Of Communitites',
    description:
      'Traditional mapping solutions involve professional consultants with expensive equipment who with communities only briefly, which can lead to delays and lack of locally relevant data.',
  },
  {
    id: 3,
    title: 'Commercial Proprietary Software to Consumer',
    description:
      'Many existing drone operation tools are proprietary and not designed for large-scale collaborative efforts, which limits their usefulness for community-driven projects',
  },
  {
    id: 4,
    title: 'Regular Compliance in Conflict Areas',
    description:
      'The use of drones, especially in sensitive or conflict-prone areas, raises significant safety and regulatory concerns.',
  },
];

export const featuresData = [
  {
    id: 1,
    title: 'User Management',
    description:
      'Simplifies the onboarding process, enhances security with role-based access, and facilitates efficient management of participant activities.',
  },
  {
    id: 2,
    title: 'Survey Project Creation',
    description:
      'Streamlines project setup, allows for custom project specifications, and ensures all participants clear guidelines and objectives.',
  },
  {
    id: 3,
    title: 'Data/Flight Plan Upload',
    description:
      'Ensures consistency and accuracy in flight plans, maximizes area coverage, and minimizes data gaps.',
  },
  {
    id: 4,
    title: 'Photogrammetric Processing',
    description:
      'Provides a seamless workflow from data capture to processing, quickly turning raw images into actionable insights.',
  },
  {
    id: 5,
    title: 'Notifications/Status Management',
    description:
      ' Keeps all users informed and engaged, ensures timely responses to project needs, and enhances collaborative efforts.',
  },
  {
    id: 6,
    title: 'Data Visualization',
    description:
      'Aids in better understanding and interpretation of the data, supports decision-making processes, and enhances presentation of findings.',
  },
];

export const aboutData = [
  {
    id: 1,
    icon: rocketIcon,
    title: 'Our Motivation',
    description:
      'Drones belonging to and operated by communities are more effective because they are in place and can respond immediately, responsibly, and take into account the needs of the community as they see them.',
  },
  {
    id: 2,
    icon: targetIcon,
    title: 'Our Vision',
    description:
      ' A user-friendly, inclusive application suite enabling anyone with access to a drone, even an inexpensive consumer or DIY drone, to contribute easily and effectively to a global free and open aerial imagery repository.',
  },
];

export const caseStudiesData = [
  {
    id: 1,
    title: 'Piloting drone tasking manager in the carribean',
    description:
      ' Simplifies the onboarding process, enhances security with role-based access, and facilitates efficient management of participant activities.',
  },
  {
    id: 2,
    title: 'Piloting drone tasking manager in the carribean',
    description:
      ' Simplifies the onboarding process, enhances security with role-based access, and facilitates efficient management of participant activities.',
  },
];
