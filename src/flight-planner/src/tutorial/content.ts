export interface CoachCard {
  title: string;
  lead: string;
  points: string[];
  why?: string;
  video?: { label: string; url: string };
}

export const WELCOME = {
  title: "Plan a mapping flight, offline",
  lead:
    "Make a mission file for your controller in four steps. Everything runs in " +
    "your browser. You do not need an account, or internet once the page has loaded.",
  steps: [
    { title: "Mark the area", detail: "Draw it on the map, or upload a GeoJSON." },
    { title: "Set the flight", detail: "Pick your drone and how much detail you need." },
    {
      title: "Get the terrain",
      detail: "One download, covering this area and the ones around it.",
    },
    { title: "Generate", detail: "Check the summary, then download the mission." },
  ],
  offlineNote:
    "Download the terrain while you have internet. It also covers the area " +
    "around your flight, so the other areas in a project do not need internet.",
};

export const COACH: Record<string, CoachCard> = {
  aoi: {
    title: "Mark the area you want to map",
    lead:
      "Tap the draw tool, then tap each corner of your area on the map. Tap the " +
      "first corner again to close the shape.",
    points: [
      "Draw a little past the edges. The drone turns outside the area.",
      "Keep it to what one battery can cover. Around 0.2 km² is a lot for a small drone.",
      "Already have the area as a file? Upload a GeoJSON instead.",
    ],
    why:
      "The area decides the flight grid. The generator fills it with parallel " +
      "lines, spaced so the photos overlap enough to join into one map. If the " +
      "edge is too tight, the map will have gaps.",
  },

  params: {
    title: "Tell us about the flight",
    lead:
      "Pick your drone, then choose how much detail you need. Everything else " +
      "already has a sensible default.",
    points: [
      "Detail is set as GSD, in centimetres per pixel. A smaller number gives a sharper map, but a longer flight.",
      "3.5 cm/px suits most mapping. Go to 2 cm/px for detailed survey work.",
      "75% overlap is the safe default. Only lower it if you have a good reason.",
      "Leave rotation on automatic, unless you need a fixed grid angle.",
    ],
    why:
      "These numbers set the flight altitude, the spacing between lines and the " +
      "drone's speed. They use the same calculations as the DroneTM server, " +
      "so a plan made here matches a plan made on a project page.",
  },

  dem: {
    title: "Download the terrain",
    lead:
      "One download of the ground height, so the drone can hold a steady height " +
      "above sloping ground.",
    points: [
      "This is the only step that needs internet. Do it before you leave.",
      "It also covers the ground around your flight, usually a whole DroneTM project.",
      "Other areas inside that coverage use it automatically, without internet.",
      "Flat site, or no internet? You can skip this and fly at a fixed altitude.",
    ],
    why:
      "Without terrain data the drone flies at one altitude above its takeoff " +
      "point. Over a hill it flies too low, and over a valley too high, so the " +
      "detail changes across the map. With terrain data, the plan changes the " +
      "altitude to follow the slope.",
  },

  generate: {
    title: "Check it, then download",
    lead:
      "Check the summary before you download, especially the flight time and " +
      "any battery warning.",
    points: [
      "A battery warning means the plan is longer than one charge. Split the area, or raise the GSD.",
      "The .kmz is the file your controller wants. The GeoJSON files are for checking the plan in QGIS.",
      "You can change an earlier step and generate again. It is instant and does not need internet.",
    ],
    why:
      "The waypoints, spacing and altitudes come from the same code as the " +
      "DroneTM server, so you get the same plan as you would from the website.",
  },
};

export const HINTS = {
  droneType: "Sets the camera and battery figures used for the plan.",
  gsd: "Centimetres per pixel on the ground. Lower is sharper but takes longer.",
  agl: "Metres above the takeoff point.",
  detailMode:
    "Most pilots set detail. Set altitude directly if you have a height limit to respect.",
  forwardOverlap:
    "How much each photo overlaps the next one along a line. 75% is safe. Below 60% may leave gaps.",
  sideOverlap: "How much side-by-side lines overlap. 75% is safe. Below 60% may leave gaps.",
  flightMode:
    "Waylines uses fewer waypoints and flies more smoothly. Waypoints sends every point to the controller.",
  gimbalAngle: "How far the camera tilts down.",
  autoRotation: "Aligns the flight lines with the longest edge of your area.",
  rotationAngle: "Grid angle in degrees, clockwise from north.",
  imageInterval:
    "Seconds between photos. Keep this at 2, unless your drone needs a different value.",
  terrainFollow: "Changes the altitude to follow the ground. Needs the terrain download.",
  threshold:
    "How far the height can move from the target before an extra waypoint is added. The default is 5 m.",
  takeoff: "Where you will take off from. Heights in the plan are measured from here.",
};

export const VIDEO_GUIDES: Array<{ label: string; url: string }> = [
  { label: "DroneTM video guides", url: "https://docs.drone.hotosm.org/video-guides/" },
];
