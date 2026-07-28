// PaintTools geometry: the point-in-polygon test that lasso removal relies on.
import { pointInPolygon } from "../src/PaintTools.js";

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
};

// unit square 0..10
const sq = [0, 0, 10, 0, 10, 10, 0, 10];
assert(pointInPolygon([5, 5], sq), "centre inside square");
assert(!pointInPolygon([15, 5], sq), "right of square outside");
assert(!pointInPolygon([-1, 5], sq), "left of square outside");
assert(!pointInPolygon([5, 20], sq), "above square outside");

// concave lasso (C shape) — a point in the notch is OUTSIDE
const cshape = [0, 0, 10, 0, 10, 3, 3, 3, 3, 7, 10, 7, 10, 10, 0, 10];
assert(pointInPolygon([1, 5], cshape), "inside the C spine");
assert(!pointInPolygon([7, 5], cshape), "in the C notch is outside");
assert(pointInPolygon([8, 1], cshape), "inside upper arm");

console.log("\nAll paint-tool tests passed.");
