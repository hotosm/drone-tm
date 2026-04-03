// eslint-disable-next-line import/prefer-default-export
export const getLayerOptionsByStatus = (status: string) => {
  const layerOptions = {
    LOCKED: {
      type: 'fill',
      paint: {
        'fill-color': '#98BBC8',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.8,
      },
    },
    AWAITING_APPROVAL: {
      type: 'fill',
      paint: {
        'fill-color': '#F3C5C5',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.7,
      },
    },
    FULLY_FLOWN: {
      type: 'fill',
      paint: {
        'fill-color': '#176149',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.5,
      },
    },
    HAS_IMAGERY: {
      type: 'fill',
      paint: {
        'fill-color': '#98BBC8',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.8,
      },
    },
    IMAGE_PROCESSING_FINISHED: {
      type: 'fill',
      paint: {
        'fill-color': '#ACD2C4',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.7,
      },
    },
    READY_FOR_PROCESSING: {
      type: 'fill',
      paint: {
        'fill-color': '#9ec7ff',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.5,
      },
    },
    IMAGE_PROCESSING_STARTED: {
      type: 'fill',
      paint: {
        'fill-color': '#9C77B2',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.5,
      },
    },
    IMAGE_PROCESSING_FAILED: {
      type: 'fill',
      paint: {
        'fill-color': '#D73F3F',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.5,
      },
    },
    HAS_ISSUES: {
      type: 'fill',
      paint: {
        'fill-color': '#D73F3F',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.7,
      },
    },
    default: {
      type: 'fill',
      paint: {
        'fill-color': '#ffffff',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.5,
      },
    },
  };

  // @ts-ignore
  return layerOptions?.[status] || layerOptions.default;
};

export const showPrimaryButton = (
  status: string,
  lockedUser: any,
  currentUser: any,
  author: any,
) => {
  switch (status) {
    case 'UNLOCKED':
      return true;
    case 'LOCKED':
      if (lockedUser === currentUser || author === currentUser) return true;
      return false;
    case 'READY_FOR_PROCESSING':
      if (lockedUser === currentUser || author === currentUser) return true;
      return false;
    case 'IMAGE_PROCESSING_STARTED':
      if (lockedUser === currentUser || author === currentUser) return true;
      return false;
    case 'IMAGE_PROCESSING_FINISHED':
      return true;
    case 'IMAGE_PROCESSING_FAILED':
      if (lockedUser === currentUser || author === currentUser) return true;
      return false;
    default:
      return false;
  }
};

export const startProcessingOptions = [
  {
    label: 'Start Processing with GCP',
    value: 'with_gcp',
    name: 'start_processing',
  },
  {
    label: 'Start Processing without GCP',
    value: 'without_gcp',
    name: 'start_processing',
  },
];

export const descriptionItems = [
  {
    label: 'Total Project Area',
    key: 'project_area',
    expectedDataType: 'double',
    unite: 'km²',
  },
  {
    label: 'Total Tasks',
    key: 'tasks',
    expectedDataType: 'array',
  },
  {
    label: 'Project Created By',
    key: 'author_name',
    expectedDataType: 'string',
  },
  {
    label: 'Flight Altitude',
    key: 'flight_altitude',
    expectedDataType: 'number',
    unite: 'm',
  },
  {
    label: 'Front Overlap',
    key: 'front_overlap',
    expectedDataType: 'double',
    unit: '%',
  },
  {
    label: 'Side Overlap',
    key: 'side_overlap',
    expectedDataType: 'double',
    unit: '%',
  },
  {
    label: 'Terrain Following',
    key: 'is_terrain_follow',
    expectedDataType: 'boolean',
  },
  {
    label: 'Require Approval to Lock Task',
    key: 'requires_approval_from_manager_for_locking',
    expectedDataType: 'boolean',
  },
  {
    label: 'Local Regulator Approval Status',
    key: 'regulator_approval_status',
    expectedDataType: 'string',
  },
  {
    label: 'Local Regulator Comment',
    key: 'regulator_comment',
    expectedDataType: 'string',
  },
];
