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

/** North-south lines plus a margin, like a planned flight. */
function survey(skipLine: (x: number) => boolean = () => false): PhotoInfo[] {
  const photos: PhotoInfo[] = [];
  for (let x = -75; x <= 275; x += LINE_SPACING) {
    if (skipLine(x)) continue;
    for (let y = -60; y <= 260; y += PHOTO_SPACING) photos.push(photo(x, y));
  }
  return photos;
}

describe("assessCoverage", () => {
  it("passes a complete survey", () => {
    const coverage = assessCoverage(AREA, survey());

    expect(coverage.verdict).toBe("good");
    expect(coverage.missingShare).toBe(0);
    expect(coverage.cells.length).toBeGreaterThan(5000);
  });

  it("flags low overlap where three neighbouring lines are missing", () => {
    const coverage = assessCoverage(
      AREA,
      survey((x) => x > 50 && x < 160),
    );

    expect(coverage.verdict).toBe("gaps");
    expect(coverage.missingShare).toBe(0);
    expect(coverage.lowShare).toBeGreaterThan(0.02);
  });

  it("asks for a refly when half the task has no photos", () => {
    const coverage = assessCoverage(
      AREA,
      survey((x) => x > 60),
    );

    expect(coverage.verdict).toBe("refly");
    expect(coverage.missingShare).toBeGreaterThan(0.1);
  });

  it("never passes a task with a hole in it", () => {
    const coverage = assessCoverage(
      AREA,
      survey((x) => x > 140),
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
