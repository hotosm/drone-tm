.pragma library

// ============================================================================
// Pure JavaScript geometry utilities
// Replaces Shapely + pyproj for use in QField QML plugin
// ============================================================================

// --- CRS Projection (Web Mercator EPSG:3857 <-> WGS84 EPSG:4326) ---
// Direct formulas - avoids per-point QML/C++ boundary crossings

var EARTH_RADIUS = 20037508.34;

function toMercator(lon, lat) {
    var x = lon * EARTH_RADIUS / 180;
    var y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) * EARTH_RADIUS / Math.PI;
    return { x: x, y: y };
}

function toWgs84(x, y) {
    var lon = x * 180 / EARTH_RADIUS;
    var lat = (Math.atan(Math.exp(y * Math.PI / EARTH_RADIUS)) * 360 / Math.PI) - 90;
    return { lon: lon, lat: lat };
}

// --- Basic geometry ---

function distance(x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

function rotatePoint(px, py, cx, cy, angleDeg) {
    var rad = angleDeg * Math.PI / 180;
    var cosA = Math.cos(rad);
    var sinA = Math.sin(rad);
    var dx = px - cx;
    var dy = py - cy;
    return {
        x: cx + dx * cosA - dy * sinA,
        y: cy + dx * sinA + dy * cosA
    };
}

// --- Polygon operations ---

function polygonBounds(coords) {
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (var i = 0; i < coords.length; i++) {
        var c = coords[i];
        if (c.x < minx) minx = c.x;
        if (c.y < miny) miny = c.y;
        if (c.x > maxx) maxx = c.x;
        if (c.y > maxy) maxy = c.y;
    }
    return { minx: minx, miny: miny, maxx: maxx, maxy: maxy };
}

function polygonCentroid(coords) {
    var area = 0;
    var cx = 0;
    var cy = 0;
    var n = coords.length;
    for (var i = 0; i < n; i++) {
        var j = (i + 1) % n;
        var cross = coords[i].x * coords[j].y - coords[j].x * coords[i].y;
        area += cross;
        cx += (coords[i].x + coords[j].x) * cross;
        cy += (coords[i].y + coords[j].y) * cross;
    }
    area *= 0.5;
    if (Math.abs(area) < 1e-10) {
        // Degenerate polygon, return average
        var sx = 0, sy = 0;
        for (var k = 0; k < n; k++) { sx += coords[k].x; sy += coords[k].y; }
        return { x: sx / n, y: sy / n };
    }
    cx /= (6 * area);
    cy /= (6 * area);
    return { x: cx, y: cy };
}

// Ray casting algorithm for point-in-polygon test
function pointInPolygon(px, py, coords) {
    var inside = false;
    var n = coords.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
        var xi = coords[i].x, yi = coords[i].y;
        var xj = coords[j].x, yj = coords[j].y;
        if (((yi > py) !== (yj > py)) &&
            (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

// Rotate an entire polygon (array of {x,y}) around a center point
function rotatePolygon(coords, angleDeg, center) {
    var result = [];
    for (var i = 0; i < coords.length; i++) {
        result.push(rotatePoint(coords[i].x, coords[i].y, center.x, center.y, angleDeg));
    }
    return result;
}

// Simple polygon buffer using edge-normal offset method
// Works well for convex/near-convex task area polygons
function bufferPolygon(coords, dist) {
    var n = coords.length;
    if (n < 3) return coords;

    // Compute offset edges
    var offsetEdges = [];
    for (var i = 0; i < n; i++) {
        var j = (i + 1) % n;
        var dx = coords[j].x - coords[i].x;
        var dy = coords[j].y - coords[i].y;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-10) continue;
        // Outward normal (assumes counter-clockwise winding)
        var nx = -dy / len;
        var ny = dx / len;
        offsetEdges.push({
            x1: coords[i].x + nx * dist,
            y1: coords[i].y + ny * dist,
            x2: coords[j].x + nx * dist,
            y2: coords[j].y + ny * dist
        });
    }

    // Check winding direction - if clockwise, flip normals
    var area = signedArea(coords);
    if (area > 0) {
        // Clockwise winding, flip the offset direction
        offsetEdges = [];
        for (var i2 = 0; i2 < n; i2++) {
            var j2 = (i2 + 1) % n;
            var dx2 = coords[j2].x - coords[i2].x;
            var dy2 = coords[j2].y - coords[i2].y;
            var len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
            if (len2 < 1e-10) continue;
            var nx2 = dy2 / len2;
            var ny2 = -dx2 / len2;
            offsetEdges.push({
                x1: coords[i2].x + nx2 * dist,
                y1: coords[i2].y + ny2 * dist,
                x2: coords[j2].x + nx2 * dist,
                y2: coords[j2].y + ny2 * dist
            });
        }
    }

    // Find intersections of adjacent offset edges
    var buffered = [];
    var ne = offsetEdges.length;
    for (var e = 0; e < ne; e++) {
        var e2idx = (e + 1) % ne;
        var pt = lineIntersection(
            offsetEdges[e].x1, offsetEdges[e].y1, offsetEdges[e].x2, offsetEdges[e].y2,
            offsetEdges[e2idx].x1, offsetEdges[e2idx].y1, offsetEdges[e2idx].x2, offsetEdges[e2idx].y2
        );
        if (pt) {
            buffered.push(pt);
        } else {
            // Parallel edges - use midpoint of endpoints
            buffered.push({
                x: (offsetEdges[e].x2 + offsetEdges[e2idx].x1) / 2,
                y: (offsetEdges[e].y2 + offsetEdges[e2idx].y1) / 2
            });
        }
    }
    return buffered;
}

function signedArea(coords) {
    var area = 0;
    var n = coords.length;
    for (var i = 0; i < n; i++) {
        var j = (i + 1) % n;
        area += coords[i].x * coords[j].y;
        area -= coords[j].x * coords[i].y;
    }
    return area * 0.5;
}

function lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
    var denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null;
    var t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return {
        x: x1 + t * (x2 - x1),
        y: y1 + t * (y2 - y1)
    };
}

// --- Convex hull (Andrew's monotone chain) ---

function convexHull(points) {
    var pts = points.slice().sort(function(a, b) {
        return a.x === b.x ? a.y - b.y : a.x - b.x;
    });
    var n = pts.length;
    if (n <= 2) return pts;

    var lower = [];
    for (var i = 0; i < n; i++) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) {
            lower.pop();
        }
        lower.push(pts[i]);
    }

    var upper = [];
    for (var j = n - 1; j >= 0; j--) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[j]) <= 0) {
            upper.pop();
        }
        upper.push(pts[j]);
    }

    // Remove last point of each half because it's repeated
    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// --- Minimum rotated rectangle (rotating calipers) ---

function minimumRotatedRectangle(coords) {
    var hull = convexHull(coords);
    var n = hull.length;
    if (n < 3) return { coords: hull, angle: 0, width: 0, height: 0 };

    var minArea = Infinity;
    var bestRect = null;
    var bestAngle = 0;

    for (var i = 0; i < n; i++) {
        var j = (i + 1) % n;
        // Edge vector
        var edx = hull[j].x - hull[i].x;
        var edy = hull[j].y - hull[i].y;
        var edgeLen = Math.sqrt(edx * edx + edy * edy);
        if (edgeLen < 1e-10) continue;

        // Unit vectors along and perpendicular to edge
        var ux = edx / edgeLen;
        var uy = edy / edgeLen;

        // Project all hull points onto edge coordinate system
        var minProj = Infinity, maxProj = -Infinity;
        var minPerp = Infinity, maxPerp = -Infinity;

        for (var k = 0; k < n; k++) {
            var dx = hull[k].x - hull[i].x;
            var dy = hull[k].y - hull[i].y;
            var proj = dx * ux + dy * uy;
            var perp = dx * (-uy) + dy * ux;
            if (proj < minProj) minProj = proj;
            if (proj > maxProj) maxProj = proj;
            if (perp < minPerp) minPerp = perp;
            if (perp > maxPerp) maxPerp = perp;
        }

        var area = (maxProj - minProj) * (maxPerp - minPerp);
        if (area < minArea) {
            minArea = area;
            bestAngle = Math.atan2(uy, ux);

            // Reconstruct rectangle corners
            bestRect = [
                {
                    x: hull[i].x + ux * minProj + (-uy) * minPerp,
                    y: hull[i].y + uy * minProj + ux * minPerp
                },
                {
                    x: hull[i].x + ux * maxProj + (-uy) * minPerp,
                    y: hull[i].y + uy * maxProj + ux * minPerp
                },
                {
                    x: hull[i].x + ux * maxProj + (-uy) * maxPerp,
                    y: hull[i].y + uy * maxProj + ux * maxPerp
                },
                {
                    x: hull[i].x + ux * minProj + (-uy) * maxPerp,
                    y: hull[i].y + uy * minProj + ux * maxPerp
                }
            ];
        }
    }

    return {
        coords: bestRect,
        angle: bestAngle * 180 / Math.PI,
        width: bestRect ? distance(bestRect[0].x, bestRect[0].y, bestRect[1].x, bestRect[1].y) : 0,
        height: bestRect ? distance(bestRect[1].x, bestRect[1].y, bestRect[2].x, bestRect[2].y) : 0
    };
}
