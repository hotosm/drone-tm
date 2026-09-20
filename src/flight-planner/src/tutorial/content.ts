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
    "Four steps and you will have a mission file ready for your controller. " +
    "Everything runs in this browser - no account, and no signal needed once " +
    "this page has loaded.",
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
    "Download the terrain while you still have signal. It covers the area " +
    "around your flight too, so the rest of a project's areas need no " +
    "connection at all.",
};

export const COACH: Record<string, CoachCard> = {
  aoi: {
    title: "Mark the area you want to map",
    lead:
      "Tap the draw tool, then tap each corner of your area on the map. Tap the " +
      "first corner again to close the shape.",
    points: [
      "Add a little margin past the edges - the drone turns outside the area.",
      "Keep it to what one battery can cover. Around 0.2 km² is a lot for a small drone.",
      "Already have the area as a file? Upload a GeoJSON instead.",
    ],
    why:
      "The area decides the flight grid. The generator fills it with parallel " +
      "lines spaced so photos overlap enough to stitch into one map, so a " +
      "sloppy edge shows up as missing coverage in the final imagery.",
  },

  params: {
    title: "Tell us about the flight",
    lead:
      "Pick your drone, then choose how much detail you need. Everything else " +
      "already has a sensible default.",
    points: [
      "Detail is set as GSD - centimetres per pixel. Smaller number, sharper map, longer flight.",
      "3.5 cm/px suits most mapping. Go to 2 cm/px for detailed survey work.",
      "Overlap at 75% is the safe default. Lower it only if you are confident.",
      "Leave rotation on automatic unless you have a reason to fix the grid angle.",
    ],
    why:
      "These numbers set the flight altitude, the spacing between lines and the " +
      "drone's speed. They are the same calculations DroneTM runs on the server, " +
      "so a plan made here matches a plan made on a project page.",
  },

  dem: {
    title: "Download the terrain",
    lead:
      "One download of the ground height, so the drone can hold a steady height " +
      "above sloping ground.",
    points: [
      "This is the only step that needs a connection. Do it before you head out.",
      "It covers the ground around your flight too - usually a whole DroneTM project.",
      "Other areas inside that coverage pick it up automatically, with no signal.",
      "Flat site, or no signal? You can skip this and fly at a fixed altitude.",
    ],
    why:
      "Without terrain data the drone flies at one altitude above its takeoff " +
      "point. Over a hill that means flying too low, and over a valley too high - " +
      "either way the ground detail changes across the map. The terrain data lets " +
      "the plan step the altitude to follow the slope.",
  },

  generate: {
    title: "Check it, then download",
    lead:
      "Look over the summary before you download. The flight time and battery " +
      "warning are the two worth a second glance.",
    points: [
      "A battery warning means the plan is longer than one charge. Split the area, or raise the GSD.",
      "The .kmz is the file your controller wants. The GeoJSON files are for checking the plan in QGIS.",
      "Change anything on an earlier step and come back - regenerating is instant and needs no connection.",
    ],
    why:
      "The waypoint count, spacing and altitudes here are produced by the same " +
      "code as DroneTM's server-side generator, so what you download is what the " +
      "platform would have given you.",
  },
};

export const HINTS = {
  droneType: "Sets the camera and battery figures used for the plan.",
  gsd: "Centimetres per pixel on the ground. Lower is sharper but takes longer.",
  agl: "Metres above the takeoff point.",
  detailMode:
    "Most pilots set detail. Set altitude directly if you have a height limit to respect.",
  forwardOverlap: "How much each photo overlaps the next along a line. 75% is safe.",
  sideOverlap: "How much neighbouring lines overlap. 75% is safe.",
  flightMode:
    "Waylines is fewer waypoints and smoother flying. Waypoints gives the controller every single point.",
  gimbalAngle: "How far the camera tilts down.",
  autoRotation: "Aligns the flight lines with the longest edge of your area.",
  rotationAngle: "Grid angle in degrees, clockwise from north.",
  imageInterval: "Seconds between photos. Leave at 2 unless your drone differs.",
  terrainFollow: "Steps the altitude to follow the ground. Needs the terrain download.",
  threshold:
    "How far the height may drift from target before an extra waypoint is added. 5 m is the default.",
  takeoff: "Where you will launch from. Heights in the plan are measured from here.",
};

export const VIDEO_GUIDES: Array<{ label: string; url: string }> = [
  { label: "DroneTM video guides", url: "https://docs.drone.hotosm.org/video-guides/" },
];
