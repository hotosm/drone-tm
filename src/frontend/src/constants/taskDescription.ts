/* eslint-disable import/prefer-default-export */
import { m } from "@/paraglide/messages";

export const getTakeOffPointOptions = () => [
  {
    label: m.task_takeoff_my_current_location(),
    value: "current_location",
    name: "take_off_point",
  },
  {
    label: m.task_takeoff_place_on_map(),
    value: "place_on_map",
    name: "take_off_point",
  },
];

export const getWaypointModeOptions = () => [
  { label: m.task_waypoint_mode_waylines(), value: "waylines" },
  { label: m.task_waypoint_mode_waypoints(), value: "waypoints" },
];

export const waypointUpperLimit = 200;

// FIXME we need a separate DroneType and OutputFormat
// instead of this hack to reuse DroneType
// Drone model names are technical identifiers (brand product names) - not localized.
export const droneModelOptions = [
  { label: "DJI Mini 4 Pro", value: "DJI_MINI_4_PRO" },
  { label: "DJI Mini 5 Pro", value: "DJI_MINI_5_PRO" },
  { label: "DJI Air 3", value: "DJI_AIR_3" },
  { label: "Potensic Atom 1", value: "POTENSIC_ATOM_1" },
  { label: "Potensic Atom 2", value: "POTENSIC_ATOM_2" },
  { label: "Litchi", value: "LITCHI" },
  { label: "QGroundControl", value: "QGROUNDCONTROL" },
];

// Numeric gimbal angle values - not localized.
export const gimbalAngleOptions = [
  { label: "-80", value: "-80" },
  { label: "-90", value: "-90" },
  { label: "45", value: "-45" },
];
