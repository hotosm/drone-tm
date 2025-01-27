// eslint-disable-next-line import/prefer-default-export
export const getLayerOptionsByStatus = (status: string) => {
  const layerOptions = {
    LOCKED_FOR_MAPPING: {
      type: 'fill',
      paint: {
        'fill-color': '#98BBC8',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.8,
      },
    },
    REQUEST_FOR_MAPPING: {
      type: 'fill',
      paint: {
        'fill-color': '#F3C5C5',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.7,
      },
    },
    UNLOCKED_TO_VALIDATE: {
      type: 'fill',
      paint: {
        'fill-color': '#176149',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.5,
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
    IMAGE_UPLOADED: {
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
        'fill-color': '#f00000',
        'fill-outline-color': '#484848',
        'fill-opacity': 0.5,
      },
    },
    UNFLYABLE_TASK: {
      type: 'fill',
      paint: {
        'fill-color': '#9EA5AD',
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
    case 'UNLOCKED_TO_MAP':
      return true;
    case 'LOCKED_FOR_MAPPING':
      if (lockedUser === currentUser || author === currentUser) return true;
      return false;
    case 'IMAGE_UPLOADED':
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
