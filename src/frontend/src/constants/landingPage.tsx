/* eslint-disable import/prefer-default-export */
import rocketIcon from "@Assets/images/LandingPage/RockerIcon.svg";
import targetIcon from "@Assets/images/LandingPage/TargetIcon.svg";
import { m } from "@/paraglide/messages";

export const accordionData = () => [
  {
    id: 1,
    title: m.landing_accordion_crisis_response_title(),
    description: m.landing_accordion_crisis_response_desc(),
    isOpen: true,
  },
  {
    id: 2,
    title: m.landing_accordion_community_empowerment_title(),
    description: m.landing_accordion_community_empowerment_desc(),
    isOpen: false,
  },
  {
    id: 3,
    title: m.landing_accordion_cost_reduction_title(),
    description: m.landing_accordion_cost_reduction_desc(),
    isOpen: false,
  },
  {
    id: 4,
    title: m.landing_accordion_data_accessibility_title(),
    description: m.landing_accordion_data_accessibility_desc(),
    isOpen: false,
  },
];

export const userAndRolesData = () => [
  {
    id: 1,
    title: m.landing_roles_project_managers_title(),
    listItems: [
      {
        id: 1,
        text: m.landing_roles_project_managers_item_1(),
      },
      {
        id: 2,
        text: m.landing_roles_project_managers_item_2(),
      },
      {
        id: 3,
        text: m.landing_roles_project_managers_item_3(),
      },
      {
        id: 4,
        text: m.landing_roles_project_managers_item_4(),
      },
      {
        id: 5,
        text: m.landing_roles_project_managers_item_5(),
      },
    ],
  },
  {
    id: 2,
    title: m.landing_roles_drone_operators_title(),
    listItems: [
      {
        id: 1,
        text: m.landing_roles_drone_operators_item_1(),
      },
      {
        id: 2,
        text: m.landing_roles_drone_operators_item_2(),
      },
      {
        id: 3,
        text: m.landing_roles_drone_operators_item_3(),
      },
      {
        id: 4,
        text: m.landing_roles_drone_operators_item_4(),
      },
      {
        id: 5,
        text: m.landing_roles_drone_operators_item_5(),
      },
    ],
  },
  {
    id: 3,
    title: m.landing_roles_data_users_title(),
    listItems: [
      {
        id: 1,
        text: m.landing_roles_data_users_item_1(),
      },
      {
        id: 2,
        text: m.landing_roles_data_users_item_2(),
      },
    ],
  },
];

export const ourRationaleData = () => [
  {
    id: 1,
    title: m.landing_rationale_limited_access_title(),
    description: m.landing_rationale_limited_access_desc(),
  },
  {
    id: 2,
    title: m.landing_rationale_limited_engagement_title(),
    description: m.landing_rationale_limited_engagement_desc(),
  },
  {
    id: 3,
    title: m.landing_rationale_proprietary_title(),
    description: m.landing_rationale_proprietary_desc(),
  },
  {
    id: 4,
    title: m.landing_rationale_compliance_title(),
    description: m.landing_rationale_compliance_desc(),
  },
];

export const featuresData = () => [
  {
    id: 1,
    title: m.landing_features_user_management_title(),
    description: m.landing_features_user_management_desc(),
  },
  {
    id: 2,
    title: m.landing_features_survey_project_title(),
    description: m.landing_features_survey_project_desc(),
  },
  {
    id: 3,
    title: m.landing_features_flight_plan_title(),
    description: m.landing_features_flight_plan_desc(),
  },
  {
    id: 4,
    title: m.landing_features_photogrammetric_title(),
    description: m.landing_features_photogrammetric_desc(),
  },
  {
    id: 5,
    title: m.landing_features_notifications_title(),
    description: m.landing_features_notifications_desc(),
  },
  {
    id: 6,
    title: m.landing_features_data_viz_title(),
    description: m.landing_features_data_viz_desc(),
  },
];

export const aboutData = () => [
  {
    id: 1,
    icon: rocketIcon,
    title: m.landing_about_motivation_title(),
    description: m.landing_about_motivation_desc(),
  },
  {
    id: 2,
    icon: targetIcon,
    title: m.landing_about_vision_title(),
    description: m.landing_about_vision_desc(),
  },
];

export const caseStudiesData = () => [
  {
    id: 1,
    tag: m.landing_case_freetown_tag(),
    location: m.landing_case_freetown_location(),
    title: m.landing_case_freetown_title(),
    description: m.landing_case_freetown_desc(),
    link: "https://www.hotosm.org/en/projects/kyc-africa-drone-mapping-in-freetown-city/",
  },
  {
    id: 2,
    tag: m.landing_case_dominica_tag(),
    location: m.landing_case_dominica_location(),
    title: m.landing_case_dominica_title(),
    description: m.landing_case_dominica_desc(),
    link: "https://www.hotosm.org/en/news/boosting-caribbean-resilience-collaborative-efforts-using-drone-imagery-in-coulibistrie-dominica/",
  },
  {
    id: 3,
    tag: m.landing_case_mexico_tag(),
    location: m.landing_case_mexico_location(),
    title: m.landing_case_mexico_title(),
    description: m.landing_case_mexico_desc(),
    link: "https://www.hotosm.org/en/news/can-low-cost-drones-contribute-to-mangrove-monitoring-and-conservation-testing-drone-tasking-manager-in-la-paz-mexico/",
  },
];
