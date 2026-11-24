// Approximate coverage, to spot missed photos. Footprints use height above
// takeoff, so they drift on slopes. Missed photos are found by rebuilding the
// flight lines from the photos: late shots along a line mean lost shots, and
// line ends or whole lines that stop short of the task mean an unflown part.
// Turns, climb-out and hovering shots are left out of the lines.

import { ringAreaM2 } from "./aoi";
import type { PhotoInfo } from "./photos";
import { bufferPolygon } from "./qfield";

type LonLat = [number, number];
type Xy = [number, number];

const TARGET_CELLS = 10_000;
const FULL_FRAME_WIDTH_MM = 36;
const M_PER_DEG_LAT = 111_320;
/** Share of the task with no photos, or whose planned photos are missing, that needs a refly. */
const REFLY_MIN_SHARE = 0.1;
// EXIF times are whole seconds and GPS wanders, so spacing varies a little.
const GAP_FACTOR = 1.75;
/** Photos less than half a step apart sideways are on the same flight line. */
const SAME_LINE_SHARE = 0.5;
/** Timer shots while hovering, such as before landing, add no information. */
const MIN_MOVE_M = 1;
/** Steps turning more than this off the flight lines are turns or transit. */
const LINE_HEADING_TOLERANCE_RAD = (15 * Math.PI) / 180;
/** Drones slow down at line ends, so the cruising spacing sits above the median. */
const CRUISE_PERCENTILE = 0.75;
/** EXIF times are whole seconds, so a step can read up to a second long. */
const EXIF_TIME_SLACK_S = 1;
/** Over lost shots the drone keeps near its usual pace, unlike a pause where time passes but it barely moves. */
const MIN_PACE_SHARE = 0.4;
/** A turn's path is longer than the straight step across it, so less pace is needed there. */
const TURN_PACE_SHARE = 0.2;
/** A step that is only possibly late must also be this much longer than the usual step. */
const LOST_SHOT_STRETCH = 1.5;
/** A real line sits a whole number of line spacings from a neighbour, give or take this. */
const LINE_SPACING_TOLERANCE = 0.25;
/** Expected photos closer than this to the task edge are not required. */
const GPS_TOLERANCE_M = 3;
/** Beyond this, the photos are not a planned grid and gaps are not checked. */
const MAX_EXPECTED_PER_PHOTO = 10;
/** Share of steps at the usual interval for the timer to count as firing through turns too. */
const STEADY_TIMER_SHARE = 0.95;
/** Stretches each photo's patch so drift and speed changes leave no slivers between photos. */
const PATCH_SLACK = 1.25;

export type CellStatus = "missing" | "ok";
/** "unknown": no photo had the height and lens data to size it. */
export type Verdict = "good" | "gaps" | "refly" | "unknown";

export interface PhotoGap {
  /** Where the planner would have taken the missing photos. */
  missed: LonLat[];
}

/** Buffer cells are only listed near a photo or a missed photo, as the plan does not promise to cover all of it. */
export interface CoverageCell {
  ring: LonLat[];
  status: CellStatus;
  /** In the overlap buffer around the task rather than the task itself. */
  inBuffer: boolean;
}

export interface Coverage {
  cells: CoverageCell[];
  /** Share of the task with no photo close enough to capture it well. */
  missingShare: number;
  /** Missed photos in the overlap buffer, which neighbouring tasks rely on. */
  bufferMissedCount: number;
  /** Null when the photos have no capture times or do not form a survey grid. */
  gaps: PhotoGap[] | null;
  verdict: Verdict;
  /** The planner's overlap margin around the task, when the flight lines show it. */
  buffer: LonLat[] | null;
  /** Photo centres outside the task but inside the drawn buffer. */
  bufferCount: number;
  outsideCount: number;
  unsizedCount: number;
}

interface Footprint {
  centre: Xy;
  sin: number;
  cos: number;
  halfAcross: number;
  halfAlong: number;
}

interface Axis {
  along: Xy;
  across: Xy;
}

/** A timed photo; `order` is its place in the capture sequence. */
interface Shot {
  photo: PhotoInfo;
  xy: Xy;
  seconds: number;
  order: number;
}

interface LineShot {
  along: number;
  order: number;
}

/** Shots sorted by position along the line. */
interface FlightLine {
  across: number;
  shots: LineShot[];
}

interface Survey {
  ring: Xy[];
  /** The task plus the planner's overlap buffer, where photos are expected. */
  reach: Xy[];
  /** The camera timer kept firing through turns and climb-out, so any late shot is a lost one. */
  steadyTimer: boolean;
  /** Every timed photo in capture order, hovering shots included. */
  shots: Shot[];
  /** Usual seconds between shots. */
  interval: number;
  /** Photos without a capture time, which timing cannot place in the sequence. */
  untimed: Xy[];
  axis: Axis;
  forward: number;
  side: number;
  lines: FlightLine[];
  /** How far the task reaches along and across the flight lines. */
  alongRange: [number, number];
  acrossRange: [number, number];
}

/** Positions of photos missed together, such as a run along one line. */
type MissedRun = Xy[];

function localProjection([lon0, lat0]: LonLat) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  return {
    toXy: ([lon, lat]: LonLat): Xy => [(lon - lon0) * mPerDegLon, (lat - lat0) * M_PER_DEG_LAT],
    toLonLat: ([x, y]: Xy): LonLat => [lon0 + x / mPerDegLon, lat0 + y / M_PER_DEG_LAT],
  };
}

function dot(a: Xy, b: Xy): number {
  return a[0] * b[0] + a[1] * b[1];
}

function insideRing(ring: Xy[], [x, y]: Xy): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function distance(a: Xy, b: Xy): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function distanceToSegment(point: Xy, a: Xy, b: Xy): number {
  const ab: Xy = [b[0] - a[0], b[1] - a[1]];
  const ap: Xy = [point[0] - a[0], point[1] - a[1]];
  const t = Math.max(0, Math.min(1, dot(ap, ab) / (dot(ab, ab) || 1)));
  return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1]);
}

function distanceToEdge(ring: Xy[], point: Xy): number {
  const distances = ring.slice(1).map((b, i) => distanceToSegment(point, ring[i], b));
  return Math.min(...distances);
}

function wellInside(ring: Xy[], point: Xy): boolean {
  return insideRing(ring, point) && distanceToEdge(ring, point) >= GPS_TOLERANCE_M;
}

/** The image's long side runs across the camera heading. */
function footprint(photo: PhotoInfo, centre: Xy): Footprint | null {
  if (!photo.heightM || !photo.focal35mm) return null;
  const across = (photo.heightM * FULL_FRAME_WIDTH_MM) / photo.focal35mm;
  const yaw = (photo.yawDeg * Math.PI) / 180;
  return {
    centre,
    sin: Math.sin(yaw),
    cos: Math.cos(yaw),
    halfAcross: across / 2,
    halfAlong: across / photo.aspect / 2,
  };
}

function covers(fp: Footprint, [x, y]: Xy): boolean {
  const dx = x - fp.centre[0];
  const dy = y - fp.centre[1];
  const along = dx * fp.sin + dy * fp.cos;
  const across = dx * fp.cos - dy * fp.sin;
  return Math.abs(across) <= fp.halfAcross && Math.abs(along) <= fp.halfAlong;
}

interface Evidence {
  missingShare: number;
  gapCount: number;
  /** False when unsized photos may cover ground the check cannot see. */
  complete: boolean;
}

function verdictFor(evidence: Evidence): Verdict {
  const { missingShare, gapCount, complete } = evidence;
  if (complete && missingShare > REFLY_MIN_SHARE) return "refly";
  return missingShare > 0 || gapCount > 0 ? "gaps" : "good";
}

/** EXIF "2026:11:20 10:00:00", in camera local time. */
function exifSeconds(text: string): number | null {
  const match = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Averages doubled angles, so lines flown in opposite directions agree. */
function meanAxis(steps: Xy[]): Axis {
  let cos = 0;
  let sin = 0;
  for (const [dx, dy] of steps) {
    const doubled = 2 * Math.atan2(dy, dx);
    cos += Math.cos(doubled);
    sin += Math.sin(doubled);
  }
  const angle = Math.atan2(sin, cos) / 2;
  return { along: [Math.cos(angle), Math.sin(angle)], across: [-Math.sin(angle), Math.cos(angle)] };
}

function onAxis(step: Xy, axis: Axis): boolean {
  const length = Math.hypot(step[0], step[1]);
  if (length === 0) return false;
  const sideways = Math.abs(dot(step, axis.across)) / length;
  return sideways <= Math.sin(LINE_HEADING_TOLERANCE_RAD);
}

/** A step along the flight lines that stays on the same line. */
function alongOneLine(step: Xy, axis: Axis, sameLine: number): boolean {
  return onAxis(step, axis) && Math.abs(dot(step, axis.across)) < sameLine;
}

/** Re-fits to the steps along the lines, so turns and transit stop pulling it askew. */
function flightAxis(steps: Xy[]): Axis {
  let axis = meanAxis(steps);
  for (let pass = 0; pass < 2; pass++) {
    const onLine = steps.filter((step) => onAxis(step, axis));
    if (onLine.length > 0) axis = meanAxis(onLine);
  }
  return axis;
}

function percentile(values: number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * share)] ?? 0;
}

/** Runs of consecutive shots stepping along one flight line. */
function lineRuns(shots: Shot[], steps: Xy[], axis: Axis): Shot[][] {
  const sameLine = median(steps.map(([dx, dy]) => Math.hypot(dx, dy))) * SAME_LINE_SHARE;
  const runs = [[shots[0]]];
  steps.forEach((step, i) => {
    if (!alongOneLine(step, axis, sameLine)) runs.push([]);
    runs[runs.length - 1].push(shots[i + 1]);
  });
  return runs.filter((run) => run.length > 1);
}

/** Lines flown in parts, such as either side of a battery swap, are merged. */
function mergeRuns(runs: Shot[][], axis: Axis, sameLine: number): FlightLine[] {
  const lines: FlightLine[] = runs
    .map((run) => ({
      across: median(run.map((shot) => dot(shot.xy, axis.across))),
      shots: run.map((shot) => ({
        along: dot(shot.xy, axis.along),
        order: shot.order,
      })),
    }))
    .sort((a, b) => a.across - b.across);

  const merged: FlightLine[] = [];
  for (const line of lines) {
    const previous = merged[merged.length - 1];
    if (previous && line.across - previous.across < sameLine) {
      previous.shots.push(...line.shots);
    } else {
      merged.push(line);
    }
  }
  merged.forEach((line) => line.shots.sort((a, b) => a.along - b.along));
  return merged;
}

function lineSpacing(lines: FlightLine[]): number {
  return median(lines.slice(1).map((line, i) => line.across - lines[i].across));
}

function wholeSpacingsApart(gap: number, side: number): boolean {
  const spacings = gap / side;
  return (
    spacings > 1 - LINE_SPACING_TOLERANCE &&
    Math.abs(spacings - Math.round(spacings)) <= LINE_SPACING_TOLERANCE
  );
}

/** Drops stray runs between lines, such as a straight stretch of a turn. */
function gridLines(lines: FlightLine[]): FlightLine[] {
  const side = lineSpacing(lines);
  return lines.filter((line, i) =>
    [lines[i - 1], lines[i + 1]].some(
      (neighbour) =>
        neighbour && wholeSpacingsApart(Math.abs(line.across - neighbour.across), side),
    ),
  );
}

function rangeAlong(ring: Xy[], direction: Xy): [number, number] {
  const values = ring.map((point) => dot(point, direction));
  return [Math.min(...values), Math.max(...values)];
}

/** Null without timed photos on at least two flight lines in a plausible grid. */
function traceSurvey(ring: Xy[], photos: PhotoInfo[], centres: Xy[]): Survey | null {
  const shots = photos
    .flatMap((photo, i) => {
      const seconds = exifSeconds(photo.takenAt);
      return seconds === null ? [] : [{ photo, xy: centres[i], seconds }];
    })
    .sort((a, b) => a.seconds - b.seconds || a.photo.name.localeCompare(b.photo.name))
    .map((shot, order): Shot => ({ ...shot, order }));
  const untimed = centres.filter((_, i) => exifSeconds(photos[i].takenAt) === null);
  const moving = shots.filter(
    (shot, i) => i === 0 || distance(shot.xy, shots[i - 1].xy) >= MIN_MOVE_M,
  );
  if (moving.length < 2) return null;

  const steps = moving
    .slice(1)
    .map((shot, i): Xy => [shot.xy[0] - moving[i].xy[0], shot.xy[1] - moving[i].xy[1]]);
  const axis = flightAxis(steps);
  const runs = lineRuns(moving, steps, axis);
  const runSteps = runs.flatMap((run) =>
    run.slice(1).map((shot, i) => Math.abs(dot(shot.xy, axis.along) - dot(run[i].xy, axis.along))),
  );
  const forward = percentile(runSteps, CRUISE_PERCENTILE);
  const merged = mergeRuns(runs, axis, forward * SAME_LINE_SHARE);
  if (merged.length < 2) return null;
  const lines = gridLines(merged);
  if (lines.length < 2) return null;

  const side = lineSpacing(lines);
  const alongRange = rangeAlong(ring, axis.along);
  const acrossRange = rangeAlong(ring, axis.across);
  // Also bounds the candidate positions generated below.
  const expected =
    ((alongRange[1] - alongRange[0]) / forward) * ((acrossRange[1] - acrossRange[0]) / side);
  if (expected > photos.length * MAX_EXPECTED_PER_PHOTO) return null;
  const intervals = shots.slice(1).map((shot, i) => shot.seconds - shots[i].seconds);
  const interval = median(intervals);
  const steady = intervals.filter((seconds) => seconds <= interval + EXIF_TIME_SLACK_S).length;
  return {
    ring,
    reach: bufferOutline(ring, Math.max(forward, side) / 2),
    steadyTimer: steady >= intervals.length * STEADY_TIMER_SHARE,
    shots,
    interval,
    untimed,
    axis,
    forward,
    side,
    lines,
    alongRange,
    acrossRange,
  };
}

function toXy(survey: Survey, along: number, across: number): Xy {
  const { along: a, across: c } = survey.axis;
  return [a[0] * along + c[0] * across, a[1] * along + c[1] * across];
}

/**
 * Positions between `from` and `to`, one photo spacing apart in step with
 * `anchor`, that are well inside the task. Scans the whole span, as a line
 * can leave and re-enter a concave or slanted task.
 */
function expectedInside(
  survey: Survey,
  across: number,
  anchor: number,
  [from, to]: [number, number],
): Xy[] {
  const [start, end] = survey.alongRange;
  const firstStep = Math.ceil((Math.max(from, start) - anchor) / survey.forward);
  const lastStep = Math.floor((Math.min(to, end) - anchor) / survey.forward);
  const count = Math.max(0, lastStep - firstStep + 1);
  return Array.from({ length: count }, (_, k) =>
    toXy(survey, anchor + (firstStep + k) * survey.forward, across),
  ).filter((xy) => wellInside(survey.ring, xy));
}

function missedAlongLine(survey: Survey, line: FlightLine): MissedRun[] {
  const halfStep = survey.forward / 2;
  const runs: MissedRun[] = [];
  line.shots.slice(1).forEach((shot, i) => {
    const previous = line.shots[i];
    // Back-to-back shots are judged by their timing instead.
    if (Math.abs(shot.order - previous.order) === 1) return;
    if (shot.along - previous.along <= survey.forward * GAP_FACTOR) return;
    const span: [number, number] = [previous.along + halfStep, shot.along - halfStep];
    runs.push(expectedInside(survey, line.across, previous.along, span));
  });

  const first = line.shots[0];
  const last = line.shots[line.shots.length - 1];
  runs.push(expectedInside(survey, line.across, first.along, [-Infinity, first.along - halfStep]));
  runs.push(expectedInside(survey, line.across, last.along, [last.along + halfStep, Infinity]));
  return runs;
}

/**
 * Rounding can make a normal step read one second long, so distance decides
 * those. Otherwise the step must fit the shots its time implies, so a pause is
 * not read as many lost shots.
 */
function neededMetres(step: ShotStep, lateAfter: number, usual: number, count: number): number {
  if (step.seconds <= lateAfter) return usual * LOST_SHOT_STRETCH;
  const pace = step.onLine ? MIN_PACE_SHARE : TURN_PACE_SHARE;
  return usual * pace * (count + 1);
}

interface ShotStep {
  previous: Shot;
  shot: Shot;
  vector: Xy;
  metres: number;
  seconds: number;
  onLine: boolean;
}

function stepsFrom(from: Xy, direction: Xy, spacing: number, count: number): Xy[] {
  const length = Math.hypot(direction[0], direction[1]);
  return Array.from({ length: count }, (_, k): Xy => {
    const offset = ((k + 1) * spacing) / length;
    return [from[0] + offset * direction[0], from[1] + offset * direction[1]];
  });
}

/**
 * Lost shots along a line sit evenly between the shots either side. Across a
 * turn the curve is unknown, so they are placed only where they would carry on
 * the flight line before or after it, at the planned spacing; the reach check
 * then drops those that fall in the turn.
 */
function lostPositions(
  survey: Survey,
  count: number,
  before: ShotStep | undefined,
  step: ShotStep,
  after: ShotStep | undefined,
): Xy[] {
  const between = stepsFrom(step.previous.xy, step.vector, step.metres / (count + 1), count);
  if (step.onLine) return between;
  // Follow the flight lines themselves, as the step next to a turn is often already curving.
  const alongLine = (vector: Xy, sign: number): Xy => {
    const [x, y] = survey.axis.along;
    const direction = Math.sign(dot(vector, survey.axis.along)) * sign;
    return [x * direction, y * direction];
  };
  const lineEnds = [
    before?.onLine
      ? stepsFrom(step.previous.xy, alongLine(before.vector, 1), survey.forward, count)
      : [],
    after?.onLine
      ? stepsFrom(step.shot.xy, alongLine(after.vector, -1), survey.forward, count)
      : [],
  ].flat();
  return lineEnds.length > 0 ? lineEnds : between;
}

/**
 * Shots come at a steady interval, so a late shot along a line means shots
 * were lost in between, even where the drone slows and spacing alone looks
 * normal. Hovering and resuming after a pause are late too but barely move.
 * Turns and climb-out count only when the timer fired steadily through them,
 * as some flights take no shots there.
 */
function lostShots(survey: Survey): MissedRun[] {
  const { shots, interval, axis, untimed } = survey;
  // Burst shots can share a whole-second time, leaving no interval to judge by.
  if (interval <= 0) return [];
  const sameLine = survey.forward * SAME_LINE_SHARE;
  const steps = shots.slice(1).map((shot, i) => {
    const previous = shots[i];
    const vector: Xy = [shot.xy[0] - previous.xy[0], shot.xy[1] - previous.xy[1]];
    return {
      previous,
      shot,
      vector,
      metres: Math.hypot(vector[0], vector[1]),
      seconds: shot.seconds - previous.seconds,
      onLine: alongOneLine(vector, axis, sameLine),
    };
  });

  const lateAfter = Math.max(interval * GAP_FACTOR, interval + EXIF_TIME_SLACK_S);
  return steps.flatMap((step, i) => {
    if (!(step.onLine || survey.steadyTimer) || step.seconds <= interval) return [];
    // Turn steps are longer, so steps along a line are paced only by their own kind.
    const neighbours = [steps[i - 1], steps[i + 1]].filter(
      (other) => other && (!step.onLine || other.onLine),
    );
    const usual =
      neighbours.reduce((sum, other) => sum + other.metres, 0) / (neighbours.length || 1);
    const count = Math.max(1, Math.round(step.seconds / interval) - 1);
    const needed = neededMetres(step, lateAfter, usual, count);
    if (step.metres < needed) return [];
    const missed = lostPositions(survey, count, steps[i - 1], step, steps[i + 1])
      .filter((xy) => wellInside(survey.reach, xy))
      // An untimed photo may be the "lost" shot itself.
      .filter((xy) => untimed.every((photo) => distance(xy, photo) >= survey.forward / 2));
    return [missed];
  });
}

/** Positions on an unflown line, in step with the neighbouring line's photos. */
function missedLine(survey: Survey, neighbour: FlightLine, across: number): MissedRun {
  return expectedInside(survey, across, neighbour.shots[0].along, survey.alongRange);
}

/** Line offsets one spacing apart from `from` towards `to`, kept to the task. */
function lineOffsets(survey: Survey, from: number, to: number): number[] {
  const { side } = survey;
  const [low, high] = survey.acrossRange;
  const step = Math.sign(to - from) * side;
  const offsets: number[] = [];
  for (let across = from + step; Math.abs(to - across) > side / 2; across += step) {
    if (step > 0 ? across > high : across < low) break;
    if (across >= low && across <= high) offsets.push(across);
  }
  return offsets;
}

function missedLines(survey: Survey): MissedRun[] {
  const { lines, side } = survey;
  const runs: MissedRun[] = [];
  lines.slice(1).forEach((line, i) => {
    if (line.across - lines[i].across <= side * GAP_FACTOR) return;
    for (const across of lineOffsets(survey, lines[i].across, line.across)) {
      runs.push(missedLine(survey, lines[i], across));
    }
  });

  const first = lines[0];
  const last = lines[lines.length - 1];
  for (const across of lineOffsets(survey, first.across, -Infinity)) {
    runs.push(missedLine(survey, first, across));
  }
  for (const across of lineOffsets(survey, last.across, Infinity)) {
    runs.push(missedLine(survey, last, across));
  }
  return runs;
}

/** Checks can overlap, such as a lost shot at a line end, so each place counts once. */
function withoutRepeats(runs: MissedRun[], spacing: number): MissedRun[] {
  const kept: Xy[] = [];
  return runs
    .map((run) => {
      const missed = run.filter((xy) => kept.every((other) => distance(xy, other) >= spacing / 2));
      kept.push(...missed);
      return missed;
    })
    .filter((run) => run.length > 0);
}

function missedPhotos(survey: Survey): MissedRun[] {
  const runs = [
    ...lostShots(survey),
    ...survey.lines.flatMap((line) => missedAlongLine(survey, line)),
    ...missedLines(survey),
  ];
  return withoutRepeats(runs, survey.forward);
}

/** The ground a photo was planned to capture well: one spacing along and across the lines. */
function photoPatch(survey: Survey, centre: Xy): Footprint {
  const [sin, cos] = survey.axis.along;
  return {
    centre,
    sin,
    cos,
    halfAlong: (survey.forward * PATCH_SLACK) / 2,
    halfAcross: (survey.side * PATCH_SLACK) / 2,
  };
}

/** The planner keeps waypoints within half the wider spacing of the task. */
function bufferOutline(ring: Xy[], distance: number): Xy[] {
  const buffered = bufferPolygon(
    ring.map(([x, y]) => ({ x, y })),
    distance,
  ).map(({ x, y }): Xy => [x, y]);
  return [...buffered, buffered[0]];
}

function shareMissing(cells: CoverageCell[]): number {
  return cells.filter((cell) => cell.status === "missing").length / Math.max(cells.length, 1);
}

/**
 * Ground is missing where no footprint sees it, or where a planned photo is
 * missing and no other photo is near enough to stand in. Away from missed
 * photos a footprint is enough, as the planner itself ends some lines short of
 * the task edge.
 */
export function assessCoverage(area: LonLat[], photos: PhotoInfo[]): Coverage {
  const projection = localProjection(area[0]);
  const ring = area.map(projection.toXy);
  const centres = photos.map((photo) => projection.toXy([photo.lon, photo.lat]));
  const footprints = photos
    .map((photo, i) => footprint(photo, centres[i]))
    .filter((fp): fp is Footprint => fp !== null);

  const survey = traceSurvey(ring, photos, centres);
  const missedRuns = survey ? missedPhotos(survey) : [];
  const buffer = survey?.reach ?? null;
  const patches = survey ? centres.map((centre) => photoPatch(survey, centre)) : [];
  const missedPatches = survey ? missedRuns.flat().map((xy) => photoPatch(survey, xy)) : [];
  const region = buffer ?? ring;

  const xs = region.map(([x]) => x);
  const ys = region.map(([, y]) => y);
  const step = Math.sqrt(ringAreaM2(area) / TARGET_CELLS);
  const half = step / 2;

  const cells: CoverageCell[] = [];
  for (let x = Math.min(...xs) + half; x < Math.max(...xs); x += step) {
    for (let y = Math.min(...ys) + half; y < Math.max(...ys); y += step) {
      if (!insideRing(region, [x, y])) continue;
      const inBuffer = !insideRing(ring, [x, y]);
      const nearPhoto = patches.some((patch) => covers(patch, [x, y]));
      const missed = !nearPhoto && missedPatches.some((patch) => covers(patch, [x, y]));
      if (inBuffer && !nearPhoto && !missed) continue;
      const seen = nearPhoto || footprints.some((fp) => covers(fp, [x, y]));
      const covered = seen && !missed;
      const corners: Xy[] = [
        [x - half, y - half],
        [x + half, y - half],
        [x + half, y + half],
        [x - half, y + half],
        [x - half, y - half],
      ];
      cells.push({
        ring: corners.map(projection.toLonLat),
        status: covered ? "ok" : "missing",
        inBuffer,
      });
    }
  }

  const missingShare = shareMissing(cells.filter((cell) => !cell.inBuffer));
  const bufferMissedCount = missedRuns.flat().filter((xy) => !insideRing(ring, xy)).length;
  const gaps = missedRuns.map((run) => ({ missed: run.map(projection.toLonLat) }));
  const outside = centres.filter((centre) => !insideRing(ring, centre));
  const bufferCount = buffer ? outside.filter((centre) => insideRing(buffer, centre)).length : 0;
  const verdict =
    survey || footprints.length > 0
      ? verdictFor({
          missingShare,
          gapCount: gaps.length,
          complete: Boolean(survey) || footprints.length === photos.length,
        })
      : "unknown";

  return {
    cells,
    missingShare,
    bufferMissedCount,
    gaps: survey ? gaps : null,
    verdict,
    buffer: buffer && buffer.map(projection.toLonLat),
    bufferCount,
    outsideCount: outside.length - bufferCount,
    unsizedCount: photos.length - footprints.length,
  };
}
