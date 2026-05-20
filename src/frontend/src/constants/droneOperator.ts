import { m } from "@/paraglide/messages";

export const getDescriptionData = () => [
  [
    {
      name: m.op_constants_total_task_area(),
      value: m.op_constants_total_task_area_value(),
    },
    {
      name: m.op_constants_est_flight_time(),
      value: m.op_constants_est_flight_time_value(),
    },
  ],
  [
    {
      name: m.op_constants_altitude(),
      value: m.op_constants_altitude_value(),
    },
    {
      name: m.op_constants_gimble_angle(),
      value: m.op_constants_gimble_angle_value(),
    },
    {
      name: m.op_constants_image_overlap(),
      value: m.op_constants_image_overlap_value(),
    },
    {
      name: m.op_constants_starting_point_altitude(),
      value: m.op_constants_starting_point_altitude_value(),
    },
  ],
];

export const getDescriptionTitle = () => [
  m.op_task_description_title(),
  m.op_flight_parameters_title(),
];

export const mapLayerIDs = [
  "waypoint-points-layer",
  "waypoint-points-image-layer",
  "waypoint-line-layer",
  "waypoint-points-image-image/logo",
  "waypoint-line-image/logo",
];
