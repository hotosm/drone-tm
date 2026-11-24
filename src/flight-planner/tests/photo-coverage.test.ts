import { describe, expect, it } from "vitest";
import { assessCoverage } from "../src/core/photo-coverage";
import type { PhotoInfo } from "../src/core/photos";

const LON0 = 85.3;
const LAT0 = 27.7;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

const toLonLat = (x: number, y: number): [number, number] => [
  LON0 + x / M_PER_DEG_LON,
  LAT0 + y / M_PER_DEG_LAT,
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

  it("flags a single missed photo that overlap hides", () => {
    const coverage = assessCoverage(
      AREA,
      survey((line, shot) => line === 4 && shot === 6),
    );

    expect(coverage.missingShare).toBe(0);
    expect(coverage.gaps).toHaveLength(1);
    expect(coverage.gaps[0].missedCount).toBe(1);
    expect(coverage.verdict).toBe("gaps");
  });

  it("counts a run of missed photos as one gap", () => {
    const coverage = assessCoverage(
      AREA,
      survey((line, shot) => line === 2 && shot >= 3 && shot <= 5),
    );

    expect(coverage.gaps).toHaveLength(1);
    expect(coverage.gaps[0].missedCount).toBe(3);
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

    expect(assessCoverage(AREA, photos).gaps).toEqual([]);
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

    expect(coverage.missingShare).toBeGreaterThan(0);
    expect(coverage.missingShare).toBeLessThan(0.1);
    expect(coverage.verdict).toBe("gaps");
  });

  it("gives no verdict when no photo can be sized", () => {
    const photos = survey().map((p) => ({ ...p, heightM: null }));

    expect(assessCoverage(AREA, photos).verdict).toBe("unknown");
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
