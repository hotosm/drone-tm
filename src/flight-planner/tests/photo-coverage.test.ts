import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessCoverage } from "../src/core/photo-coverage";
import type { PhotoInfo } from "../src/core/photos";
import { FlightMode, generate } from "../src/core/qfield";

const LON0 = 85.3;
const LAT0 = 27.7;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

type Xy = [number, number];

const toLonLat = (x: number, y: number): [number, number] => [
  LON0 + x / M_PER_DEG_LON,
  LAT0 + y / M_PER_DEG_LAT,
];

const toXy = (p: { lon: number; lat: number }): Xy => [
  (p.lon - LON0) * M_PER_DEG_LON,
  (p.lat - LAT0) * M_PER_DEG_LAT,
];

const AREA = [
  toLonLat(0, 0),
  toLonLat(200, 0),
  toLonLat(200, 200),
  toLonLat(0, 200),
  toLonLat(0, 0),
];

// 100 m up with a 24 mm lens: footprint 150 m across, 112.5 m along.
// 75/75 overlap puts lines 37.5 m apart and photos 28.125 m apart.
const LINE_SPACING = 37.5;
const PHOTO_SPACING = 28.125;
const SHOT_SECONDS = 2;
const TURN_SECONDS = 10;

type Skip = (line: number, shot: number) => boolean;

const minus = (a: Xy, b: Xy): [number, number] => [a[0] - b[0], a[1] - b[1]];

function exifTime(seconds: number): string {
  const iso = new Date(Date.UTC(2026, 10, 20, 10) + seconds * 1000).toISOString();
  return iso.replace(/-/g, ":").replace("T", " ").slice(0, 19);
}

function photo(x: number, y: number, overrides: Partial<PhotoInfo> = {}): PhotoInfo {
  const [lon, lat] = toLonLat(x, y);
  return {
    name: `${x},${y}`,
    lon,
    lat,
    heightM: 100,
    yawDeg: 0,
    focal35mm: 24,
    aspect: 4 / 3,
    takenAt: "",
    ...overrides,
  };
}

/** Back-and-forth north-south lines plus a margin, like a planned flight. */
function survey(skip: Skip = () => false): PhotoInfo[] {
  const photos: PhotoInfo[] = [];
  let seconds = 0;
  for (let line = 0; line < 10; line++) {
    const x = -75 + line * LINE_SPACING;
    for (let shot = 0; shot < 12; shot++) {
      const y = line % 2 ? 249.375 - shot * PHOTO_SPACING : -60 + shot * PHOTO_SPACING;
      if (!skip(line, shot)) photos.push(photo(x, y, { takenAt: exifTime(seconds) }));
      seconds += SHOT_SECONDS;
    }
    seconds += TURN_SECONDS;
  }
  return photos;
}

describe("assessCoverage", () => {
  it("passes a complete survey", () => {
    const coverage = assessCoverage(AREA, survey());

    expect(coverage.verdict).toBe("good");
    expect(coverage.missingShare).toBe(0);
    expect(coverage.gaps).toEqual([]);
    expect(coverage.cells.length).toBeGreaterThan(5000);
  });

  it("flags a single missed photo even though neighbouring footprints overlap it", () => {
    const coverage = assessCoverage(
      AREA,
      survey((line, shot) => line === 4 && shot === 6),
    );

    expect(coverage.missingShare).toBeGreaterThan(0);
    expect(coverage.gaps).toHaveLength(1);
    expect(coverage.gaps?.[0].missed).toHaveLength(1);
    expect(coverage.verdict).toBe("gaps");
  });

  it("counts a run of missed photos as one gap", () => {
    const coverage = assessCoverage(
      AREA,
      survey((line, shot) => line === 5 && shot >= 3 && shot <= 5),
    );

    expect(coverage.gaps).toHaveLength(1);
    expect(coverage.gaps?.[0].missed).toHaveLength(3);
  });

  it("flags photos missing from the end of a line", () => {
    const coverage = assessCoverage(
      AREA,
      survey((line, shot) => line === 4 && shot >= 8),
    );

    expect(coverage.gaps).toHaveLength(1);
    expect(coverage.gaps?.[0].missed).toHaveLength(2);
    expect(coverage.verdict).toBe("gaps");
  });

  it("flags lines and photos missing from the start of the flight", () => {
    const coverage = assessCoverage(
      AREA,
      survey((line, shot) => line < 4 || (line === 4 && shot < 5)),
    );

    const missed = (coverage.gaps ?? []).map((gap) => gap.missed.length).sort((a, b) => a - b);
    expect(missed).toEqual([2, 7]);
    expect(coverage.verdict).not.toBe("good");
  });

  it("does not mistake a long turn between lines for a gap", () => {
    const coverage = assessCoverage(
      AREA,
      survey((line) => line % 2 === 1),
    );

    expect(coverage.gaps).toEqual([]);
  });

  it("ignores a pause on the line, such as a battery swap", () => {
    const photos = survey().map((p, i) =>
      i < 50 ? p : { ...p, takenAt: exifTime(30 * 60 + i * SHOT_SECONDS) },
    );

    expect(assessCoverage(AREA, photos).gaps).toEqual([]);
  });

  it("skips gap checks for photos without a time", () => {
    const photos = survey((line, shot) => line === 4 && shot === 6).map((p) => ({
      ...p,
      takenAt: "",
    }));

    expect(assessCoverage(AREA, photos).gaps).toBeNull();
  });

  it("skips gap checks for a single flight line", () => {
    const photos = survey((line) => line !== 4);

    expect(assessCoverage(AREA, photos).gaps).toBeNull();
  });

  it("skips gap checks for photos that are not a survey grid", () => {
    // Hovering shots a few centimetres apart would imply millions of expected photos.
    const photos = [0, 0.1].flatMap((x) =>
      [0, 0.1, 0.2].map((y, i) => photo(100 + x, 100 + y, { takenAt: exifTime(x * 100 + i) })),
    );

    expect(assessCoverage(AREA, photos).gaps).toBeNull();
  });

  it("does not ask for a refly over uncovered ground when some photos could not be sized", () => {
    // Without capture times only uncovered ground counts, so sizing decides the verdict.
    const photos = survey((line) => line >= 4).map((p) => ({ ...p, takenAt: "" }));
    photos[0] = { ...photos[0], focal35mm: null };

    expect(assessCoverage(AREA, photos).verdict).toBe("gaps");
  });

  it("does not report a photo missing just because it has no capture time", () => {
    const photos = survey();
    photos[50] = { ...photos[50], takenAt: "" };

    expect(assessCoverage(AREA, photos).gaps).toEqual([]);
  });

  it("copes with bursts of shots that share a whole-second time", () => {
    // Three shots a second leave a usual interval of zero seconds.
    const photos = survey((line, shot) => line === 4 && shot === 6).map((p, i) => ({
      ...p,
      takenAt: exifTime(Math.floor(i / 3)),
    }));

    expect(() => assessCoverage(AREA, photos)).not.toThrow();
  });

  it("asks for a refly when half the task has no photos", () => {
    const coverage = assessCoverage(
      AREA,
      survey((line) => line >= 4),
    );

    expect(coverage.verdict).toBe("refly");
    expect(coverage.missingShare).toBeGreaterThan(0.1);
  });

  it("never passes a task with a hole in it", () => {
    const coverage = assessCoverage(
      AREA,
      survey((line) => line >= 6),
    );

    // The two unflown lines leave about a third of the task with no photo nearby.
    expect(coverage.missingShare).toBeGreaterThan(0.1);
    expect(coverage.verdict).toBe("refly");
  });

  it("marks only the ground a missed photo was meant to capture", () => {
    const coverage = assessCoverage(
      AREA,
      survey((line, shot) => line === 4 && shot === 6),
    );
    const patch = (PHOTO_SPACING * LINE_SPACING) / (200 * 200);

    // Neighbouring photos overlap part of it, so the hole is smaller than one patch.
    expect(coverage.missingShare).toBeGreaterThan(patch * 0.25);
    expect(coverage.missingShare).toBeLessThan(patch);
    expect(coverage.verdict).toBe("gaps");
  });

  it("shows the buffer only around photos and missed photos", () => {
    const complete = assessCoverage(AREA, survey());
    const bufferCells = complete.cells.filter((cell) => cell.inBuffer);

    expect(bufferCells.length).toBeGreaterThan(0);
    expect(bufferCells.every((cell) => cell.status === "ok")).toBe(true);
  });

  it("draws the planner's overlap buffer from the photo spacing", () => {
    const coverage = assessCoverage(AREA, survey());
    const xs = coverage.buffer!.map(([lon]) => (lon - LON0) * M_PER_DEG_LON);

    // Half the wider of the 28.125 m photo and 37.5 m line spacings.
    expect(Math.min(...xs)).toBeCloseTo(-18.75, 1);
    expect(Math.max(...xs)).toBeCloseTo(218.75, 1);
  });

  it("splits photos outside the task into buffer and beyond", () => {
    const base = assessCoverage(AREA, survey());
    // (214, 214) is past the 18.75 m margin but inside the drawn mitred corner.
    const extras = [photo(210, 100), photo(214, 214), photo(300, 100)];
    const coverage = assessCoverage(AREA, [...survey(), ...extras]);

    expect(coverage.bufferCount - base.bufferCount).toBe(2);
    expect(coverage.outsideCount - base.outsideCount).toBe(1);
  });

  it("gives no verdict without photo sizes or capture times", () => {
    const photos = survey().map((p) => ({ ...p, heightM: null, takenAt: "" }));

    expect(assessCoverage(AREA, photos).verdict).toBe("unknown");
  });

  it("checks coverage from the flight lines when photos cannot be sized", () => {
    const photos = survey().map((p) => ({ ...p, heightM: null }));

    expect(assessCoverage(AREA, photos).verdict).toBe("good");
  });

  it("counts photos outside the task and photos it cannot size", () => {
    const coverage = assessCoverage(AREA, [
      photo(100, 100),
      photo(500, 500),
      photo(100, 100, { heightM: null }),
    ]);

    expect(coverage.outsideCount).toBe(1);
    expect(coverage.unsizedCount).toBe(1);
  });
});

// The planner trims line ends and skips points around concave corners, so
// check against its real output rather than an idealised grid.
describe("assessCoverage on planner flights", () => {
  const SHAPES: Record<string, Xy[]> = {
    rectangle: [
      [0, 0],
      [400, 0],
      [400, 220],
      [0, 220],
      [0, 0],
    ],
    concave: [
      [0, 0],
      [400, 0],
      [400, 110],
      [200, 110],
      [200, 330],
      [0, 330],
      [0, 0],
    ],
    // Its first flight line drifts away from the slanted south edge.
    triangle: [
      [0, 0],
      [490, 55],
      [100, 445],
      [0, 0],
    ],
  };
  // Low and high flights: the second has few, widely spaced photos.
  const SETTINGS = [
    { agl: 100, forwardOverlap: 75, sideOverlap: 70 },
    { agl: 120, forwardOverlap: 70, sideOverlap: 60 },
  ];
  type Settings = (typeof SETTINGS)[number];
  const EDGE_MARGIN_M = 5;

  function plannedPhotos(
    area: Array<[number, number]>,
    rotationAngle: number,
    settings: Settings,
  ): PhotoInfo[] {
    const plan = generate(area, {
      ...settings,
      flightMode: FlightMode.WAYPOINTS,
      rotationAngle,
      autoRotation: false,
    });
    return plan.geojson.features
      .filter((waypoint) => waypoint.properties.take_photo)
      .map((waypoint, i) => {
        const [lon, lat] = waypoint.geometry.coordinates;
        return {
          ...photo(0, 0),
          name: String(i),
          lon,
          lat,
          heightM: settings.agl,
          yawDeg: waypoint.properties.heading,
          takenAt: exifTime(i * SHOT_SECONDS),
        };
      });
  }

  function wellInside(ring: Xy[], [x, y]: Xy): boolean {
    let inside = false;
    let nearest = Infinity;
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1];
      const [bx, by] = ring[i];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      const t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2);
      const clamped = Math.max(0, Math.min(1, t));
      nearest = Math.min(
        nearest,
        Math.hypot(x - ax - clamped * (bx - ax), y - ay - clamped * (by - ay)),
      );
    }
    return inside && nearest > EDGE_MARGIN_M;
  }

  const cases = Object.keys(SHAPES).flatMap((shape) =>
    [0, 15, 60, 90].flatMap((angle) => SETTINGS.map((settings) => ({ shape, angle, settings }))),
  );

  it.each(cases)(
    "$shape at $angle° and $settings.agl m: passes the full flight",
    ({ shape, angle, settings }) => {
      const area = SHAPES[shape].map(([x, y]) => toLonLat(x, y));

      const coverage = assessCoverage(area, plannedPhotos(area, angle, settings));

      expect(coverage.gaps).toEqual([]);
      expect(coverage.verdict).toBe("good");
    },
  );

  it.each(cases)(
    "$shape at $angle° and $settings.agl m: allows for GPS error",
    ({ shape, angle, settings }) => {
      const area = SHAPES[shape].map(([x, y]) => toLonLat(x, y));
      // Repeatable wander of up to 2 m, within a consumer drone's GPS error.
      const wander = (seed: number) => Math.sin(seed * 12.9898) * 2;
      const photos = plannedPhotos(area, angle, settings).map((p, i) => ({
        ...p,
        lon: p.lon + wander(i) / M_PER_DEG_LON,
        lat: p.lat + wander(i + 0.5) / M_PER_DEG_LAT,
      }));

      expect(assessCoverage(area, photos).gaps).toEqual([]);
    },
  );

  it.each(cases)(
    "$shape at $angle° and $settings.agl m: flags photos lost inside the task",
    ({ shape, angle, settings }) => {
      const ring = SHAPES[shape];
      const area = ring.map(([x, y]) => toLonLat(x, y));
      const photos = plannedPhotos(area, angle, settings);
      const inside = photos.filter((p) => wellInside(ring, toXy(p)));
      const singles = [0, 0.25, 0.5, 0.75, 1].map((share) =>
        photos.filter((p) => p !== inside[Math.floor(share * (inside.length - 1))]),
      );
      const cut = Math.floor(photos.length * 0.15);
      const flights = [...singles, photos.slice(cut), photos.slice(0, photos.length - cut)];

      const lossy = flights.filter((flight) => inside.some((p) => !flight.includes(p)));

      expect(lossy.length).toBeGreaterThanOrEqual(singles.length);
      for (const flight of lossy) {
        expect(assessCoverage(area, flight).gaps?.length).toBeGreaterThan(0);
      }
    },
  );

  // Flies the planned path the way a drone does on a photo timer: shooting
  // through the climb-out and turns, slowing for turns and terrain-following
  // waypoints, hovering before landing, with GPS noise and timing jitter.
  const CLIMB_OUT: Xy = [-80, -120];
  const TURN_ANGLE_RAD = Math.PI / 9;
  const SLOW_EVERY = 8;
  const SLOW_SPEED = 3;
  const ACCELERATION = 2;
  const HOVER_SHOTS = 10;
  const GPS_NOISE_M = 1.5;
  // Whole-second EXIF times then read 2 s apart, with the odd 1 s or 3 s.
  const TIMER_OFFSET_S = 0.7;
  const TIMER_JITTER_S = 0.2;

  type SimulatedShot = PhotoInfo & { onLine: boolean };
  /** Line shots inside the task lost from each end of a flight cut short. */
  const CUT_LINE_SHOTS = 3;
  /** Lose every nth line shot in turn, to keep the run time down. */
  const LOST_SHOT_SAMPLE = 9;

  function simulatedFlight(
    area: Array<[number, number]>,
    rotationAngle: number,
    settings: Settings,
  ) {
    const plan = generate(area, {
      ...settings,
      flightMode: FlightMode.WAYPOINTS,
      rotationAngle,
      autoRotation: false,
    });
    const waypoints = plan.geojson.features.map((waypoint) => {
      const [lon, lat] = waypoint.geometry.coordinates;
      return { xy: toXy({ lon, lat }), photo: waypoint.properties.take_photo };
    });
    const start = waypoints[0].xy;
    const vertices = [
      { xy: [start[0] + CLIMB_OUT[0], start[1] + CLIMB_OUT[1]] as Xy, photo: false },
      ...waypoints,
    ];
    const along = [0];
    vertices.slice(1).forEach((vertex, i) => {
      const [x0, y0] = vertices[i].xy;
      along.push(along[i] + Math.hypot(vertex.xy[0] - x0, vertex.xy[1] - y0));
    });
    const heading = (i: number) => {
      const [x0, y0] = vertices[i].xy;
      const [x1, y1] = vertices[i + 1].xy;
      return Math.atan2(x1 - x0, y1 - y0);
    };
    const slowAt = along.filter((_, i) => {
      if (i === 0 || i === vertices.length - 1) return true;
      const turn = Math.abs(
        Math.atan2(Math.sin(heading(i) - heading(i - 1)), Math.cos(heading(i) - heading(i - 1))),
      );
      return turn > TURN_ANGLE_RAD || i % SLOW_EVERY === 0;
    });
    const cruise = plan.parameters.forward_spacing / SHOT_SECONDS;
    const speedAt = (s: number) => {
      const nearest = Math.min(...slowAt.map((point) => Math.abs(point - s)));
      return Math.min(cruise, Math.sqrt(SLOW_SPEED ** 2 + 2 * ACCELERATION * nearest));
    };

    const shots: SimulatedShot[] = [];
    const shoot = (xy: Xy, triggeredAt: number, segment: number) => {
      const n = shots.length;
      const noise = (seed: number) => Math.sin(seed * 12.9898) * GPS_NOISE_M;
      const [lon, lat] = toLonLat(xy[0] + noise(n), xy[1] + noise(n + 0.5));
      const onLine = vertices[segment].photo && vertices[segment + 1].photo;
      shots.push({
        ...photo(0, 0),
        name: String(n),
        lon,
        lat,
        heightM: settings.agl,
        yawDeg: (heading(segment) * 180) / Math.PI,
        takenAt: exifTime(triggeredAt + TIMER_OFFSET_S + TIMER_JITTER_S * Math.sin(n * 7.3)),
        onLine,
      });
    };

    const STEP_M = 0.5;
    let seconds = 0;
    let nextShot = 0;
    let segment = 0;
    for (let s = 0; s < along[along.length - 1]; s += STEP_M) {
      while (along[segment + 1] < s) segment++;
      if (seconds >= nextShot) {
        const share = (s - along[segment]) / (along[segment + 1] - along[segment]);
        const [x0, y0] = vertices[segment].xy;
        const [x1, y1] = vertices[segment + 1].xy;
        shoot([x0 + share * (x1 - x0), y0 + share * (y1 - y0)], nextShot, segment);
        nextShot += SHOT_SECONDS;
      }
      seconds += STEP_M / speedAt(s);
    }
    for (let k = 0; k < HOVER_SHOTS; k++) {
      shoot(vertices[vertices.length - 1].xy, nextShot + k * SHOT_SECONDS, vertices.length - 2);
    }
    return { shots, spacing: plan.parameters.forward_spacing };
  }

  const timerCases = Object.keys(SHAPES).flatMap((shape) =>
    [0, 30, 90].flatMap((angle) => SETTINGS.map((settings) => ({ shape, angle, settings }))),
  );

  it.each(timerCases)(
    "$shape at $angle° and $settings.agl m on a timer: passes the full flight",
    ({ shape, angle, settings }) => {
      const area = SHAPES[shape].map(([x, y]) => toLonLat(x, y));
      const { shots } = simulatedFlight(area, angle, settings);

      const coverage = assessCoverage(area, shots);

      expect(coverage.gaps).toEqual([]);
      expect(coverage.verdict).toBe("good");
    },
  );

  it.each(timerCases)(
    "$shape at $angle° and $settings.agl m on a timer: finds each lost shot where it was",
    ({ shape, angle, settings }) => {
      const ring = SHAPES[shape];
      const area = ring.map(([x, y]) => toLonLat(x, y));
      const { shots, spacing } = simulatedFlight(area, angle, settings);
      const lineShots = shots.filter((shot) => shot.onLine && wellInside(ring, toXy(shot)));

      for (const lost of lineShots.filter((_, i) => i % LOST_SHOT_SAMPLE === 0)) {
        const flagged = (
          assessCoverage(
            area,
            shots.filter((shot) => shot !== lost),
          ).gaps ?? []
        )
          .flatMap((gap) => gap.missed)
          .map(([lon, lat]) => Math.hypot(...minus(toXy({ lon, lat }), toXy(lost))));

        expect(Math.min(...flagged)).toBeLessThan(spacing);
        expect(Math.max(...flagged)).toBeLessThan(spacing * 2);
      }
    },
  );

  it.each(timerCases)(
    "$shape at $angle° and $settings.agl m on a timer: finds a flight cut short",
    ({ shape, angle, settings }) => {
      const ring = SHAPES[shape];
      const area = ring.map(([x, y]) => toLonLat(x, y));
      const { shots } = simulatedFlight(area, angle, settings);
      const lineShots = shots.filter((shot) => shot.onLine && wellInside(ring, toXy(shot)));
      const firstKept = shots.indexOf(lineShots[CUT_LINE_SHOTS]);
      const lastKept = shots.indexOf(lineShots[lineShots.length - 1 - CUT_LINE_SHOTS]);

      for (const flight of [shots.slice(firstKept), shots.slice(0, lastKept + 1)]) {
        expect(assessCoverage(area, flight).gaps?.length).toBeGreaterThan(0);
      }
    },
  );
});

describe("assessCoverage on a real flight", () => {
  // A DJI flight on a 2 s timer over one task: climb-out, turns, slowdowns at
  // terrain-following waypoints and hovering before landing.
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/photo-check-flight.json", import.meta.url), "utf8"),
  ) as { area: Array<[number, number]>; photos: PhotoInfo[] };
  const { area, photos } = fixture;
  const LINE_DRIFT_M = 2;
  const PAUSE_S = 5 * 60;
  const shiftedExifTime = (takenAt: string, seconds: number) => {
    const [date, time] = takenAt.split(" ");
    const iso = `${date.replace(/:/g, "-")}T${time}Z`;
    return exifTime((Date.parse(iso) - Date.UTC(2026, 10, 20, 10)) / 1000 + seconds);
  };
  const FOUND_WITHIN_M = 25;
  const EDGE_DEPTH_M = 5;

  const metres = ([lon, lat]: [number, number]): Xy => {
    const [lon0, lat0] = area[0];
    const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
    return [(lon - lon0) * mPerDegLon, (lat - lat0) * M_PER_DEG_LAT];
  };
  const at = (p: PhotoInfo) => metres([p.lon, p.lat]);
  const ring = area.map(metres);

  function depthInside([x, y]: Xy): number {
    let inside = false;
    let nearest = Infinity;
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1];
      const [bx, by] = ring[i];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      const t =
        ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1);
      const clamped = Math.max(0, Math.min(1, t));
      nearest = Math.min(
        nearest,
        Math.hypot(x - ax - clamped * (bx - ax), y - ay - clamped * (by - ay)),
      );
    }
    return inside ? nearest : -nearest;
  }

  /** The task's lines run east-west, so a line shot has steady northing either side. */
  const onLine = (i: number) =>
    [photos[i - 1], photos[i + 1]].every(
      (neighbour) => neighbour && Math.abs(at(neighbour)[1] - at(photos[i])[1]) < LINE_DRIFT_M,
    );
  const lineShots = photos.filter((p, i) => onLine(i) && depthInside(at(p)) > EDGE_DEPTH_M);

  function flaggedDistances(flight: PhotoInfo[], lost: PhotoInfo[]): number[] {
    return (assessCoverage(area, flight).gaps ?? [])
      .flatMap((gap) => gap.missed)
      .map((position) => {
        const xy = metres(position);
        return Math.min(...lost.map((p) => Math.hypot(...minus(xy, at(p)))));
      });
  }

  it("passes the complete flight", () => {
    const coverage = assessCoverage(area, photos);

    expect(coverage.gaps).toEqual([]);
    expect(coverage.verdict).toBe("good");
    expect(coverage.cells.every((cell) => cell.status === "ok")).toBe(true);
  });

  it("finds every lost line shot where it was, and nowhere else", () => {
    expect(lineShots.length).toBeGreaterThan(80);
    for (const lost of lineShots) {
      const distances = flaggedDistances(
        photos.filter((p) => p !== lost),
        [lost],
      );

      expect(distances.length).toBeGreaterThan(0);
      expect(Math.max(...distances)).toBeLessThan(FOUND_WITHIN_M);
    }
  });

  it("asks for a refly when the last third is missing, marking only the unflown part", () => {
    const flight = photos.slice(0, Math.round((photos.length * 2) / 3));

    const coverage = assessCoverage(area, flight);

    expect(coverage.verdict).toBe("refly");
    // The unflown lines are about a fifth of the task, so red must not spread far beyond them.
    expect(coverage.missingShare).toBeGreaterThan(0.1);
    expect(coverage.missingShare).toBeLessThan(0.3);
  });

  it.each([
    ["a turn and the start of the next line", 34, 41],
    ["a whole line with the turns either side", 97, 117],
  ])("keeps shots lost across %s on the flight lines", (_, first, last) => {
    const isLost = (i: number) => i >= first && i <= last;
    const lostNorthings = photos.flatMap((p, i) => (isLost(i) && onLine(i) ? [at(p)[1]] : []));
    const coverage = assessCoverage(
      area,
      photos.filter((_, i) => !isLost(i)),
    );
    const missed = (coverage.gaps ?? []).flatMap((gap) => gap.missed).map(metres);

    expect(missed.length).toBeGreaterThan(0);
    for (const [, northing] of missed) {
      const offLine = Math.min(...lostNorthings.map((line) => Math.abs(line - northing)));
      expect(offLine).toBeLessThan(LINE_DRIFT_M * 2);
    }
  });

  it("does not read a pause away from the flight lines as lost shots", () => {
    const paused = photos.map((p, i) =>
      i < 2 ? p : { ...p, takenAt: shiftedExifTime(p.takenAt, PAUSE_S) },
    );

    expect(assessCoverage(area, paused).gaps).toEqual([]);
  });

  it("finds lost shots in the overlap buffer and the climb-out", () => {
    const climbOut = photos[5];
    const lineEndInBuffer = photos.find(
      (p) => depthInside(at(p)) < -5 && depthInside(at(p)) > -12,
    )!;

    for (const lost of [climbOut, lineEndInBuffer]) {
      const coverage = assessCoverage(
        area,
        photos.filter((p) => p !== lost),
      );
      const distances = (coverage.gaps ?? [])
        .flatMap((gap) => gap.missed)
        .map((position) => Math.hypot(...minus(metres(position), at(lost))));

      expect(Math.min(...distances)).toBeLessThan(FOUND_WITHIN_M);
    }
  });

  it.each([
    ["the start", (i: number) => i < 40],
    ["the end", (i: number) => i >= photos.length - 50],
    ["one whole line", (i: number) => i >= 97 && i <= 117],
  ])("finds shots lost from %s of the flight", (_, isLost) => {
    const lost = photos.filter((_, i) => isLost(i));
    const flight = photos.filter((_, i) => !isLost(i));
    const distances = flaggedDistances(flight, lost);

    expect(distances.length).toBeGreaterThan(0);
    expect(Math.max(...distances)).toBeLessThan(FOUND_WITHIN_M);
  });
});
