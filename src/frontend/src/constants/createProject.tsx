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

export type StepComponentMap = {
  [key: number]: React.FC;
};

export const stepDescriptionComponents: StepComponentMap = {
  1: BasicInformation,
  2: DefineAOI,
  3: KeyParameters,
  4: Contributions,
  5: GenerateTask,
};

export const stepSwticherData = [
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
    name: 'Conditions for contributions',
  },
  {
    url: '/',
    step: 5,
    label: '05',
    name: 'Generate Task',
  },
];

export const uploadAreaOptions = [
  {
    name: 'upload_area',
    value: 'draw',
    label: 'Draw',
  },
  {
    name: 'upload_area',
    value: 'upload_file',
    label: 'Upload File',
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
      'Generate every point as a waypoint. Sometimes crashes if you open the map in the DJI FLy App',
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
