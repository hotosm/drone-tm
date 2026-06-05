import { m } from "@/paraglide/messages";

// eslint-disable-next-line import/prefer-default-export
export const getLayerOptionsByStatus = (status: string) => {
  const layerOptions = {
    LOCKED: {
      type: "fill",
      paint: {
        "fill-color": "#98BBC8",
        "fill-outline-color": "#484848",
        "fill-opacity": 0.8,
      },
    },
    AWAITING_APPROVAL: {
      type: "fill",
      paint: {
        "fill-color": "#F3C5C5",
        "fill-outline-color": "#484848",
        "fill-opacity": 0.7,
      },
    },
    FULLY_FLOWN: {
      type: "fill",
      paint: {
        "fill-color": "#176149",
        "fill-outline-color": "#484848",
        "fill-opacity": 0.5,
      },
    },
    HAS_IMAGERY: {
      type: "fill",
      paint: {
        "fill-color": "#98BBC8",
        "fill-outline-color": "#484848",
        "fill-opacity": 0.8,
      },
    },
    IMAGE_PROCESSING_FINISHED: {
      type: "fill",
      paint: {
        "fill-color": "#ACD2C4",
        "fill-outline-color": "#484848",
        "fill-opacity": 0.7,
      },
    },
    READY_FOR_PROCESSING: {
      type: "fill",
      paint: {
        "fill-color": "#9ec7ff",
        "fill-outline-color": "#484848",
        "fill-opacity": 0.5,
      },
    },
    IMAGE_PROCESSING_STARTED: {
      type: "fill",
      paint: {
        "fill-color": "#9C77B2",
        "fill-outline-color": "#484848",
        "fill-opacity": 0.5,
      },
    },
    IMAGE_PROCESSING_FAILED: {
      type: "fill",
      paint: {
        "fill-color": "#D73F3F",
        "fill-outline-color": "#484848",
        "fill-opacity": 0.5,
      },
    },
    HAS_ISSUES: {
      type: "fill",
      paint: {
        "fill-color": "#D73F3F",
        "fill-outline-color": "#484848",
        "fill-opacity": 0.7,
      },
    },
    default: {
      type: "fill",
      paint: {
        "fill-color": "#ffffff",
        "fill-outline-color": "#484848",
        "fill-opacity": 0.5,
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
    case "UNLOCKED":
      return true;
    case "LOCKED":
      if (lockedUser === currentUser || author === currentUser) return true;
      return false;
    case "READY_FOR_PROCESSING":
      if (lockedUser === currentUser || author === currentUser) return true;
      return false;
    case "IMAGE_PROCESSING_STARTED":
      if (lockedUser === currentUser || author === currentUser) return true;
      return false;
    case "IMAGE_PROCESSING_FINISHED":
      return true;
    case "IMAGE_PROCESSING_FAILED":
      if (lockedUser === currentUser || author === currentUser) return true;
      return false;
    default:
      return false;
  }
};

export const getStartProcessingOptions = () => [
  {
    label: m.proj_choose_param_with_gcp(),
    value: "with_gcp",
    name: "start_processing",
  },
  {
    label: m.proj_choose_param_without_gcp(),
    value: "without_gcp",
    name: "start_processing",
  },
];

type DescriptionDataType =
  | "array"
  | "boolean"
  | "date"
  | "double"
  | "finalOutput"
  | "number"
  | "string";

type DescriptionItem = {
  label: string;
  key: string;
  expectedDataType: DescriptionDataType;
  unit?: string;
  unite?: string;
};

export const getFinalOutputLabels = (): Record<string, string> => ({
  ORTHOPHOTO_2D: m.proj_desc_output_orthophoto(),
  DIGITAL_TERRAIN_MODEL: "DTM",
  DIGITAL_SURFACE_MODEL: "DSM",
  POINT_CLOUD: "Point Cloud",
});

export const getDescriptionItems = (): DescriptionItem[] => [
  {
    label: m.proj_desc_label_project_created(),
    key: "created_at",
    expectedDataType: "date",
  },
  {
    label: m.proj_desc_label_total_project_area(),
    key: "project_area",
    expectedDataType: "double",
    unite: "km²",
  },
  {
    label: m.proj_desc_label_total_tasks(),
    key: "tasks",
    expectedDataType: "array",
  },
  {
    label: m.proj_desc_label_project_created_by(),
    key: "author_name",
    expectedDataType: "string",
  },
  {
    label: m.proj_desc_label_outputs(),
    key: "final_output",
    expectedDataType: "finalOutput",
  },
  {
    label: m.proj_desc_label_gsd(),
    key: "gsd_cm_px",
    expectedDataType: "number",
    unit: "cm/px",
  },
  {
    label: m.proj_desc_label_flight_altitude(),
    key: "flight_altitude",
    expectedDataType: "number",
    unit: "m",
  },
  {
    label: m.proj_desc_label_task_split_size(),
    key: "task_split_dimension",
    expectedDataType: "number",
    unit: "m",
  },
  {
    label: m.proj_desc_label_front_overlap(),
    key: "front_overlap",
    expectedDataType: "double",
    unit: "%",
  },
  {
    label: m.proj_desc_label_side_overlap(),
    key: "side_overlap",
    expectedDataType: "double",
    unit: "%",
  },
  {
    label: m.proj_desc_label_terrain_following(),
    key: "is_terrain_follow",
    expectedDataType: "boolean",
  },
  {
    label: m.proj_desc_label_require_approval_to_lock(),
    key: "requires_approval_from_manager_for_locking",
    expectedDataType: "boolean",
  },
  {
    label: m.proj_desc_label_regulator_approval_status(),
    key: "regulator_approval_status",
    expectedDataType: "string",
  },
  {
    label: m.proj_desc_label_regulator_comment(),
    key: "regulator_comment",
    expectedDataType: "string",
  },
];

// Backwards-compatible export for type-extraction (typeof descriptionItems[number])
// Provides the same shape without the runtime localized labels.
export const descriptionItems: DescriptionItem[] = [
  { label: "", key: "created_at", expectedDataType: "date" },
  { label: "", key: "project_area", expectedDataType: "double", unite: "km²" },
  { label: "", key: "tasks", expectedDataType: "array" },
  { label: "", key: "author_name", expectedDataType: "string" },
  { label: "", key: "final_output", expectedDataType: "finalOutput" },
  { label: "", key: "gsd_cm_px", expectedDataType: "number", unit: "cm/px" },
  { label: "", key: "flight_altitude", expectedDataType: "number", unit: "m" },
  { label: "", key: "task_split_dimension", expectedDataType: "number", unit: "m" },
  { label: "", key: "front_overlap", expectedDataType: "double", unit: "%" },
  { label: "", key: "side_overlap", expectedDataType: "double", unit: "%" },
  { label: "", key: "is_terrain_follow", expectedDataType: "boolean" },
  {
    label: "",
    key: "requires_approval_from_manager_for_locking",
    expectedDataType: "boolean",
  },
  { label: "", key: "regulator_approval_status", expectedDataType: "string" },
  { label: "", key: "regulator_comment", expectedDataType: "string" },
];
