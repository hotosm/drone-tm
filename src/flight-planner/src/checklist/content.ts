import type { OutputFormat } from "../core/qfield";

export type Severity = "stop" | "fix" | "advise";
export type StageKey = "depart" | "site" | "next";

/** Limits an entry to one drone family, for settings that differ between apps. */
export interface DroneSpecific {
  only?: OutputFormat;
}

export interface ChecklistItem extends DroneSpecific {
  id: string;
  label: string;
  severity: Severity;
  why?: string;
}

export interface ReferenceLine extends DroneSpecific {
  text: string;
}

export interface ChecklistGroup {
  title: string;
  items: ChecklistItem[];
}

export interface ChecklistStage {
  key: StageKey;
  title: string;
  hint: string;
  groups: ChecklistGroup[];
}

export const NOT_OK_MESSAGE: Record<Severity, string> = {
  stop: "Do not fly until this is OK.",
  fix: "Fix this before takeoff.",
  advise: "You can still fly, but image quality may be lower.",
};

export const STAGES: ChecklistStage[] = [
  {
    key: "depart",
    title: "Before you leave",
    hint: "Do these before you leave, while you have internet.",
    groups: [
      {
        title: "Permissions",
        items: [
          {
            id: "registered",
            label: "Flight registered with the coordinator or local authorities",
            severity: "stop",
          },
          {
            id: "authorized",
            label: "Flight permission received, and NOTAMs checked",
            severity: "stop",
            why: "NOTAMs are notices of temporary airspace restrictions, for example a helicopter operation.",
          },
          {
            id: "geofence",
            label: "Manufacturer no-fly zones (geofence) checked, and unlocked if needed",
            severity: "stop",
            why:
              "Government permission does not unlock the manufacturer's no-fly zones. " +
              "You must request this separately.",
          },
          {
            id: "informed",
            label: "Local authorities and community leaders informed",
            severity: "stop",
          },
          {
            id: "sensitive",
            label: "Sensitive places excluded, or safeguards agreed",
            severity: "stop",
          },
        ],
      },
      {
        title: "Equipment and weather",
        items: [
          {
            id: "forecast",
            label: "Weather forecast checked (best time to fly: 10:00-14:00)",
            severity: "advise",
            why: "When the sun is high, there are fewer shadows in the photos.",
          },
          { id: "takeoff-spots", label: "Takeoff locations chosen", severity: "fix" },
          { id: "firmware", label: "Drone firmware and apps updated", severity: "fix" },
          {
            id: "activated",
            label: "Drone activated in Potensic Eve",
            severity: "fix",
            why: "Before activation, the drone cannot fly higher or further than 30 m.",
            only: "potensic",
          },
          { id: "batteries", label: "All batteries charged, including spares", severity: "fix" },
          { id: "sd-card", label: "SD card tested", severity: "fix" },
        ],
      },
    ],
  },
  {
    key: "site",
    title: "At the site",
    hint: "Do these at the site, with the drone in front of you.",
    groups: [
      {
        title: "Airspace and weather",
        items: [
          { id: "restricted", label: "No restricted airspace nearby", severity: "stop" },
          { id: "weather", label: "No rain, fog or storms", severity: "stop" },
          { id: "wind", label: "Wind is below 20 km/h", severity: "stop" },
          { id: "crowds", label: "No crowds in the flight area", severity: "stop" },
          {
            id: "obstacles",
            label: "No power lines or other obstacles in the flight area",
            severity: "stop",
          },
          { id: "sky", label: "You can see the sky over the whole flight area", severity: "stop" },
          {
            id: "stable-sky",
            label: "No patchy clouds (clear sky or full cloud cover is fine)",
            severity: "advise",
            why:
              "Patchy clouds make light and dark areas in the map. Waiting 15-30 minutes " +
              "often helps.",
          },
        ],
      },
      {
        title: "Drone",
        items: [
          { id: "gimbal-cover", label: "Gimbal cover removed", severity: "fix" },
          { id: "arms", label: "Arms fully open", severity: "fix" },
          { id: "propellers", label: "Propellers clean and undamaged", severity: "stop" },
          { id: "damage", label: "No damage or loose parts", severity: "stop" },
          { id: "battery-swollen", label: "Battery not swollen or damaged", severity: "stop" },
          { id: "site-sd", label: "SD card inserted", severity: "fix" },
        ],
      },
      {
        title: "Controller",
        items: [
          { id: "connected", label: "Controller connected to the drone", severity: "stop" },
          {
            id: "phone",
            label: "Phone charged, attached to the controller, and Potensic Eve open",
            severity: "fix",
            only: "potensic",
          },
          { id: "plan-loaded", label: "Flight plan loaded on the controller", severity: "stop" },
          { id: "drone-battery", label: "Drone battery above 90%", severity: "fix" },
          { id: "controller-battery", label: "Controller battery above 60%", severity: "fix" },
          { id: "gps", label: "Strong GPS signal", severity: "stop" },
          { id: "camera-view", label: "Camera view is clear and in focus", severity: "fix" },
          { id: "no-errors", label: "No error messages", severity: "stop" },
        ],
      },
      {
        title: "Flight settings",
        items: [
          {
            id: "zoom",
            label: "Camera zoom is 1x",
            severity: "fix",
            why:
              "Zoomed photos cannot be joined into a map. DroneTM rejects them, and the " +
              "area must be flown again.",
          },
          {
            id: "jpeg",
            label: "Photo format is JPEG, not RAW (DNG)",
            severity: "fix",
            why: "JPEG files are smaller and faster to upload. Some processing tools cannot read RAW.",
          },
          { id: "aspect", label: "Photo aspect ratio is 4:3", severity: "fix" },
          { id: "resolution", label: "Photo resolution is 12 MP", severity: "fix", only: "dji" },
          {
            id: "avoidance",
            label: "Obstacle avoidance is set to Bypass",
            severity: "fix",
            only: "dji",
          },
          {
            id: "rth",
            label: "Return to Home (RTH) altitude is 120 m",
            severity: "fix",
            only: "dji",
          },
          {
            id: "beginner-mode",
            label: "Beginner Mode is off",
            severity: "fix",
            why: "Beginner Mode keeps the drone within 30 m, so the mission cannot fly.",
            only: "potensic",
          },
          {
            id: "return-altitude",
            label: "Return altitude is higher than nearby obstacles",
            severity: "fix",
            why: "The Atom 2 cannot detect obstacles. It will hit anything taller on its way back.",
            only: "potensic",
          },
          {
            id: "virtual-fence",
            label: "Virtual fence is higher and wider than the flight plan",
            severity: "fix",
            why:
              "Fence height is measured from the takeoff point. The maximum is 120 m, so a " +
              "plan that goes higher cannot be flown.",
            only: "potensic",
          },
          {
            id: "max-altitude",
            label: "Maximum altitude is 500 m",
            severity: "fix",
            why:
              "Altitude is measured from the takeoff point, not the ground. Following the " +
              "terrain uphill can need much more than the flight height.",
            only: "dji",
          },
          {
            id: "max-distance",
            label: "Maximum distance is 5000 m",
            severity: "fix",
            only: "dji",
          },
        ],
      },
      {
        title: "Takeoff",
        items: [
          {
            id: "plan-location",
            label: "Flight plan shows the correct location",
            severity: "stop",
          },
          { id: "level", label: "Drone is on flat ground", severity: "fix" },
          { id: "facing", label: "Drone is facing away from you", severity: "fix" },
          { id: "observer", label: "Observer is ready", severity: "fix" },
        ],
      },
    ],
  },
  {
    key: "next",
    title: "Next flight here",
    hint: "A shorter list for each extra flight at the same site.",
    groups: [
      {
        title: "Before the next takeoff",
        items: [
          { id: "next-conditions", label: "Weather and wind are still OK", severity: "stop" },
          { id: "next-battery", label: "New drone battery, above 90%", severity: "fix" },
          { id: "next-propellers", label: "Propellers still undamaged", severity: "stop" },
          { id: "next-plan", label: "Correct flight plan selected", severity: "stop" },
          { id: "next-zoom", label: "Camera zoom is still 1x", severity: "fix" },
          { id: "next-errors", label: "No error messages", severity: "stop" },
        ],
      },
    ],
  },
];

export const IN_FLIGHT = { title: "In flight", hint: "Read this before takeoff." };

/** In the order they happen. */
export const IN_FLIGHT_STEPS: ReferenceLine[] = [
  { text: 'After takeoff, wait for the "Home point updated" message' },
  { text: "Set the photo mode to Timed Shot, 2 seconds", only: "dji" },
  { text: "Start taking photos at the first waypoint, and stop at the last", only: "dji" },
  { text: "Photos are taken automatically at each waypoint", only: "potensic" },
  { text: "Keep the drone in sight at all times" },
  { text: "Watch the battery level, altitude, error messages and zoom (1x)" },
];

export const EMERGENCIES: Array<{ situation: string; action: string }> = [
  {
    situation: "Rain or strong wind",
    action: "Press and hold Return to Home (RTH) until it beeps",
  },
  { situation: "You need to stop and hover", action: "Press Pause" },
  { situation: "You lose track of direction", action: "Let go of both sticks" },
  { situation: "A bird comes close", action: "Fly straight up" },
  { situation: "A plane or helicopter is nearby", action: "Descend and land" },
];
