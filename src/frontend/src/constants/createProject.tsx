/* eslint-disable import/prefer-default-export */
import lineOrientation from "@Assets/images/line_orientation.svg";
import straightenFlightPlan from "@Assets/images/straigh-flight.svg";
import generateAllPoints from "@Assets/images/generate-all-points.svg";
import imageOverlap from "@Assets/images/image-overlap.svg";
import {
  UseCase,
  BasicInformation,
  DefineAOI,
  KeyParameters,
  GenerateTasks,
} from "@Components/CreateProject/DescriptionContents";
import orthoPhotoIcon from "@Assets/images/ortho-photo-icon.svg";
import DTMIcon from "@Assets/images/DTM-Icon.svg";
import DSMIcon from "@Assets/images/DSM-icon.svg";
import { m } from "@/paraglide/messages";

export type StepComponentMap = {
  [key: number]: any;
};

export const stepDescriptionComponents: StepComponentMap = {
  1: UseCase,
  2: BasicInformation,
  3: DefineAOI,
  4: KeyParameters,
  5: GenerateTasks,
};

export const stepSwitcherData = () => [
  {
    url: "/",
    step: 1,
    label: "01",
    name: m.create_step_use_case(),
  },
  {
    url: "/",
    step: 2,
    label: "02",
    name: m.create_step_basic_info(),
  },
  {
    url: "/",
    step: 3,
    label: "03",
    name: m.create_step_aoi(),
  },
  {
    url: "/",
    step: 4,
    label: "04",
    name: m.create_step_key_parameters(),
  },
  {
    url: "/",
    step: 5,
    label: "05",
    name: m.create_step_generate_task(),
  },
];

export const useCaseOptions = () => [
  {
    value: "ORTHOPHOTO_2D",
    label: m.create_use_case_2d_label(),
    description: m.create_use_case_2d_desc(),
    icon: orthoPhotoIcon,
  },
  {
    value: "DIGITAL_SURFACE_MODEL",
    label: m.create_use_case_dsm_label(),
    description: m.create_use_case_dsm_desc(),
    icon: DSMIcon,
  },
  {
    value: "DIGITAL_TERRAIN_MODEL",
    label: m.create_use_case_dtm_label(),
    description: m.create_use_case_dtm_desc(),
    icon: DTMIcon,
  },
];

export const uploadAreaOptions = () => [
  {
    name: m.create_generate_yes(),
    value: "yes",
    label: m.create_generate_yes(),
  },
  {
    name: m.create_generate_no(),
    value: "no",
    label: m.create_generate_no(),
  },
];

export const KeyParametersOptions = () => [
  {
    name: "basic",
    value: "basic",
    label: m.create_params_basic(),
  },
  {
    name: "advanced",
    value: "advanced",
    label: m.create_params_advanced(),
  },
];

export const terrainOptions = () => [
  {
    name: m.create_params_terrain_flat(),
    value: "flat",
    label: m.create_params_terrain_flat(),
  },
  {
    name: "hilly",
    value: "hilly",
    label: m.create_params_terrain_hilly(),
  },
];

export const contributionsOptions = () => [
  {
    name: "public",
    value: "public",
    label: m.create_contributions_publish_public(),
  },
  {
    name: "invite_with_email",
    value: "invite_with_email",
    label: m.create_contributions_publish_invite(),
  },
];

export const generateTaskOptions = () => [
  {
    name: "divide_hexagon",
    value: "divide_hexagon",
    label: m.create_generate_option_hexagon(),
  },
  {
    name: "divide_rectangle",
    value: "divide_rectangle",
    label: m.create_generate_option_rectangle(),
  },
];

export const keyParamsDescriptions = () => [
  {
    id: 1,
    title: m.create_params_desc_line_orientation_title(),
    description: m.create_params_desc_line_orientation(),
    icon: lineOrientation,
  },
  {
    id: 2,
    title: m.create_params_desc_straighten_title(),
    description: m.create_params_desc_straighten(),
    icon: straightenFlightPlan,
  },
  {
    id: 3,
    title: m.create_params_desc_all_points_title(),
    description: m.create_params_desc_all_points(),
    icon: generateAllPoints,
  },
  {
    id: 4,
    title: m.create_params_desc_image_overlap_title(),
    description: m.create_params_desc_image_overlap(),
    icon: imageOverlap,
  },
];

export const lockApprovalOptions = () => [
  { name: "Required", label: m.create_contributions_approval_required(), value: "required" },
  {
    name: "Not Required",
    label: m.create_contributions_approval_not_required(),
    value: "not_required",
  },
];

export const regulatorApprovalOptions = () => [
  {
    name: "regulator approval Required",
    label: m.create_contributions_approval_required(),
    value: "required",
  },
  {
    name: "regulator approval not Required",
    label: m.create_contributions_approval_not_required(),
    value: "not_required",
  },
];

export const measurementTypeOptions = () => [
  {
    name: "GSD",
    value: "gsd",
    label: m.create_params_measurement_gsd(),
  },
  {
    name: "Altitude",
    value: "altitude",
    label: m.create_params_measurement_altitude(),
  },
];

export const imageMergeTypeOptions = () => [
  {
    name: "Overlap",
    value: "overlap",
    label: m.create_params_merge_overlap(),
  },
  {
    name: "Spacing",
    value: "spacing",
    label: m.create_params_merge_spacing(),
  },
];

export const contributionsInfo = () => [
  {
    key: m.create_contributions_instructions_key(),
    description: m.create_contributions_instructions_desc(),
  },
  {
    key: m.create_contributions_deadline_key(),
    description: m.create_contributions_deadline_desc(),
  },
  {
    key: m.create_contributions_regulator_key(),
    description: m.create_contributions_regulator_desc(),
  },
  {
    key: m.create_contributions_regulator_email_key(),
    description: m.create_contributions_regulator_email_desc(),
  },

  {
    key: m.create_contributions_lock_approval_key(),
    description: m.create_contributions_lock_approval_desc(),
  },
];

export const DefineAOIInfo = () => [
  {
    key: m.create_aoi_project_area(),
    description: m.create_aoi_project_area_desc(),
  },
  {
    key: m.create_aoi_no_fly_zone(),
    description: m.create_aoi_no_fly_zone_desc(),
  },
];

export const keyParametersInfo = () => [
  {
    key: m.create_params_info_gsd_title(),
    description: m.create_params_info_gsd_desc(),
  },
  {
    key: m.create_params_info_altitude_title(),
    description: m.create_params_info_altitude_desc(),
  },
  {
    key: m.create_params_info_front_overlap_title(),
    description: m.create_params_info_front_overlap_desc(),
  },

  {
    key: m.create_params_info_side_overlap_title(),
    description: m.create_params_info_side_overlap_desc(),
  },
  {
    key: m.create_params_info_orthophoto_title(),
    description: m.create_params_info_orthophoto_desc(),
  },
  {
    key: m.create_params_info_dtm_title(),
    description: m.create_params_info_dtm_desc(),
  },
  {
    key: m.create_params_info_dsm_title(),
    description: m.create_params_info_dsm_desc(),
  },
  {
    key: m.create_params_info_dem_title(),
    description: m.create_params_info_dem_desc(),
  },
];

export const taskGenerationGuidelines = () => ({
  title: m.create_generate_guidelines_title(),
  guidelines: [
    m.create_generate_guideline_rc2_terrain(),
    m.create_generate_guideline_rcn2_terrain(),
    m.create_generate_guideline_rcn2_no_terrain(),
  ],
  conclusion: m.create_generate_guidelines_conclusion(),
});

export const demFileOptions = () => [
  {
    name: "Download DEM file from JAXA",
    label: m.create_params_dem_jaxa(),
    value: "auto",
  },
  { name: "Upload DEM File", label: m.create_params_dem_upload(), value: "manual" },
];

export const uploadOrDrawAreaOptions = (): Record<string, any>[] => [
  { name: "project", value: "project", label: m.create_aoi_option_project() },
  {
    name: "no_fly_zone",
    value: "no_fly_zone",
    label: m.create_aoi_option_no_fly_zone(),
  },
];
