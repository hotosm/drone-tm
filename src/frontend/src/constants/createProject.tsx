/* eslint-disable import/prefer-default-export */
import lineOrientation from '@Assets/images/line_orientation.svg';
import straightenFlightPlan from '@Assets/images/straigh-flight.svg';
import generateAllPoints from '@Assets/images/generate-all-points.svg';
import imageOverlap from '@Assets/images/image-overlap.svg';
import {
  BasicInformation,
  DefineAOI,
  KeyParameters,
  Contributions,
  GenerateTask,
} from '@Components/CreateProject/DescriptionContents';
import orthoPhotoIcon from '@Assets/images/ortho-photo-icon.svg';
// import _3DModal from '@Assets/images/3d-model-icon.svg';
import DTMIcon from '@Assets/images/DTM-Icon.svg';
import DSMIcon from '@Assets/images/DSM-icon.svg';

export type StepComponentMap = {
  [key: number]: any;
};

export const stepDescriptionComponents: StepComponentMap = {
  1: BasicInformation,
  2: DefineAOI,
  3: KeyParameters,
  4: GenerateTask,
  5: Contributions,
};

export const stepSwitcherData = [
  {
    url: '/',
    step: 1,
    label: '01',
    name: 'Basic Information',
  },
  {
    url: '/',
    step: 2,
    label: '02',
    name: 'Define Area Of Interest (AOI)',
  },
  {
    url: '/',
    step: 3,
    label: '03',
    name: 'Key Parameters',
  },
  {
    url: '/',
    step: 4,
    label: '04',
    name: 'Generate Task',
  },
  {
    url: '/',
    step: 5,
    label: '05',
    name: 'Conditions for contributions',
  },
];

export const uploadAreaOptions = [
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

export const KeyParametersOptions = [
  {
    name: 'basic',
    value: 'basic',
    label: 'Basic',
  },
  {
    name: 'advanced',
    value: 'advanced',
    label: 'Advanced',
  },
];

export const terrainOptions = [
  {
    name: 'Flat',
    value: 'flat',
    label: 'Flat',
  },
  {
    name: 'hilly',
    value: 'hilly',
    label: 'Hilly',
  },
];

export const contributionsOptions = [
  {
    name: 'public',
    value: 'public',
    label: 'Public',
  },
  {
    name: 'invite_with_email',
    value: 'invite_with_email',
    label: 'Invite With Email',
  },
];

export const generateTaskOptions = [
  {
    name: 'divide_hexagon',
    value: 'divide_hexagon',
    label: 'Divide as Hexagon',
  },
  {
    name: 'divide_rectangle',
    value: 'divide_rectangle',
    label: 'Divide as Rectangle',
  },
];

export const keyParamsDescriptions = [
  {
    id: 1,
    title: 'Line Orientation',
    description: 'How many perpendicular passes should the drone make ?',
    icon: lineOrientation,
  },
  {
    id: 2,
    title: 'Straighten Flight Paths',
    description:
      'Straighten the leg of the flight, so that it removes the curves in the flight.',
    icon: straightenFlightPlan,
  },
  {
    id: 3,
    title: 'Generate All Points',
    description:
      'Generate every point as a waypoint. Sometimes crashes if you open the map in the DJI FLy App.',
    icon: generateAllPoints,
  },
  {
    id: 4,
    title: 'Image Overlap',
    description:
      'Overlap between images in the flight plan. Will modify the value of “ Distance Between Paths” and “speed” based on altitude, gimbal angle, overlap, and photo interval.',
    icon: imageOverlap,
  },
];

export const lockApprovalOptions = [
  { name: 'Required', label: 'Required', value: 'required' },
  { name: 'Not Required', label: 'Not Required', value: 'not_required' },
];

export const regulatorApprovalOptions = [
  { name: 'regulator approval Required', label: 'Required', value: 'required' },
  {
    name: 'regulator approval not Required',
    label: 'Not Required',
    value: 'not_required',
  },
];

export const FinalOutputOptions = [
  { label: '2D Orthophoto', value: 'ORTHOPHOTO_2D', icon: orthoPhotoIcon },
  // { label: '3D Model', value: 'ORTHOPHOTO_3D', icon: _3DModal },
  {
    label: 'Digital Terrain Model (DTM)',
    value: 'DIGITAL_TERRAIN_MODEL',
    icon: DTMIcon,
  },
  {
    label: 'Digital Surface Model (DSM)',
    value: 'DIGITAL_SURFACE_MODEL',
    icon: DSMIcon,
  },
];

export const measurementTypeOptions = [
  {
    name: 'GSD',
    value: 'gsd',
    label: 'GSD',
  },
  {
    name: 'Altitude',
    value: 'altitude',
    label: 'Altitude',
  },
];

export const imageMergeTypeOptions = [
  {
    name: 'Overlap',
    value: 'overlap',
    label: 'Overlap',
  },
  {
    name: 'Spacing',
    value: 'spacing',
    label: 'Spacing',
  },
];

export const contributionsInfo = [
  {
    key: 'Instructions for Drone Operators',
    description: 'Detailed instructions or parameters for the drone operation.',
  },
  {
    key: 'Deadline for Submission',
    description: 'Date for specifying when the project should be submitted.',
  },
  {
    key: 'Does this project require approval from the local regulatory committee?',
    description:
      'Indicate if the project requires approval from the local regulatory committee before proceeding.',
  },
  {
    key: 'Local regulation committee Email Address',
    description:
      'The email addresses of local regulatory committee members. If one of them approves or rejects the project, it will be processed accordingly. This is required for areas where drone flights are restricted and require permission.',
  },

  {
    key: 'Approval for task lock',
    description:
      'Approval required tasks should be approved from project creator to proceed the mapping.',
  },
];

export const DefineAOIInfo = [
  {
    key: 'Project Area',
    description: 'Boundary of a project.',
  },
  {
    key: 'No-fly-zone',
    description: 'GEO zones that prohibit flight.',
  },
];

export const keyParametersInfo = [
  {
    key: 'Ground Sampling Distance (GSD)',
    description:
      'GSD in a digital photo of the ground from air is the distance between pixel centers measured on the ground.',
  },
  {
    key: 'Altitude',
    description:
      'The altitude at which the drone should fly during the mission, in meters.',
  },
  {
    key: 'Front Overlap',
    description:
      'The percentage of overlap between consecutive images taken in the forward direction.',
  },

  {
    key: 'Side Overlap',
    description:
      'The percentage of overlap between images captured on adjacent flight lines.',
  },
  {
    key: '2D Orthophoto/Orthophotograph',
    description:
      '2D orthophoto is a geometrically corrected aerial image that can be used as a map with consistent scale and accurate measurements.',
  },
  {
    key: 'Digital Terrain Model (DTM)',
    description:
      "DTM represents the bare earth surface, excluding objects and showing only the terrain's elevation.",
  },
  {
    key: 'A Digital Surface Model (DSM)',
    description:
      "DSM is a 3D representation of the Earth's surface including all features like buildings and vegetation.",
  },
  {
    key: 'DEM',
    description:
      'The Digital Elevation Model (DEM) file that will be used to generate the terrain follow flight plan. This file should be in GeoTIFF format.',
  },
];

export const taskGenerationGuidelines = {
  title: `When setting up your task area, please consider the following
      recommendations based on the equipment and parameters used by the drone
      operators:`,
  guidelines: [
    `If the drone operators are using the RC2 controller with the terrain
  following parameter, it's recommended to create a square with dimensions
  up to 300 meters, covering approximately 0.1 km².`,
    `If the drone operators are using the RC-N2 controller with the
    terrain following parameter or the RC2 controller without the terrain
    following parameter, create a square with dimensions up to 550 meters,
    covering approximately 0.3 km².`,
    `If the drone operators are using the RC-N2 controller without the
      terrain following parameter, the recommended square dimensions are up to
      1000 meters, covering approximately 1 km².`,
  ],
  conclusion: `These guidelines will help ensure that your task area is appropriately
      sized based on the drone equipment and parameters being used. This will
      also reduce the chances of RC lagging while flying the drone.`,
};

export const demFileOptions = [
  {
    name: 'Download DEM file from JAXA',
    label: 'Download DEM file from JAXA',
    value: 'auto',
  },
  { name: 'Upload DEM File', label: 'Upload DEM File', value: 'manual' },
];

export const uploadOrDrawAreaOptions: Record<string, any>[] = [
  { name: 'project', value: 'project', label: 'Project' },
  {
    name: 'no_fly_zone',
    value: 'no_fly_zone',
    label: 'No Fly Zone',
  },
];
