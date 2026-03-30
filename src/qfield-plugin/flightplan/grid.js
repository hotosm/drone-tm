.pragma library

.import "geometry.js" as Geo

// ============================================================================
// Grid generation and flight path creation
// Port of waypoints.py
// ============================================================================

// Calculate optimal rotation angle from polygon's longest edge
// Minimizes the number of turns by aligning flight direction with longest edge
function calculateOptimalRotationAngle(polyCoords3857) {
    var rect = Geo.minimumRotatedRectangle(polyCoords3857);
    var coords = rect.coords;
    if (!coords || coords.length < 4) return 0;

    // Find longest edge and its angle
    var longestLen = 0;
    var longestAngle = 0;
    for (var i = 0; i < coords.length; i++) {
        var j = (i + 1) % coords.length;
        var len = Geo.distance(coords[i].x, coords[i].y, coords[j].x, coords[j].y);
        if (len > longestLen) {
            longestLen = len;
            longestAngle = Math.atan2(
                coords[j].y - coords[i].y,
                coords[j].x - coords[i].x
            ) * 180 / Math.PI;
        }
    }

    // Normalize to 0-180 range
    if (longestAngle < 0) longestAngle += 180;

    // Return negative angle to align grid with longest edge
    var rotationAngle = -longestAngle;
    if (rotationAngle < -180) rotationAngle += 360;
    else if (rotationAngle > 180) rotationAngle -= 360;

    return rotationAngle;
}

// Generate an optimized grid of waypoints within an AOI polygon (in EPSG:3857)
function generateGridInAoi(polyCoords3857, xSpacing, ySpacing, rotationAngle, sideOverlap) {
    if (sideOverlap === undefined) sideOverlap = 70;

    var overlapThreshold = ySpacing * (1 - sideOverlap / 100);
    var bufferedPoly = Geo.bufferPolygon(polyCoords3857, xSpacing * 0.5);
    var centroid = Geo.polygonCentroid(polyCoords3857);

    // Rotate polygon to align with flight direction
    var rotatedPoly = Geo.rotatePolygon(polyCoords3857, rotationAngle, centroid);
    var bounds = Geo.polygonBounds(rotatedPoly);

    // Add padding for corner coverage
    var cornerPadding = Math.sqrt(xSpacing * xSpacing + ySpacing * ySpacing) * 0.5;
    var minx = bounds.minx - cornerPadding;
    var miny = bounds.miny - cornerPadding;
    var maxx = bounds.maxx + cornerPadding;
    var maxy = bounds.maxy + cornerPadding;

    var xpoints = Math.floor((maxx - minx) / xSpacing) + 1;
    var ypoints = Math.floor((maxy - miny) / ySpacing) + 1;

    var points = [];
    var currentAxis = "x";

    // Generate base flight grid
    for (var yi = 0; yi < ypoints; yi++) {
        for (var xi = 0; xi < xpoints; xi++) {
            var x = minx + xi * xSpacing;
            var y = miny + yi * ySpacing;

            // Rotate point back to original coordinate system
            // NOTE: Uses rotationAngle (not negated) to match Python Shapely rotate() convention
            var rotated = Geo.rotatePoint(x, y, centroid.x, centroid.y, rotationAngle);

            // Alternate flight direction between waylines
            var angle = (currentAxis === "x") ? -90 : 90;

            if (Geo.pointInPolygon(rotated.x, rotated.y, bufferedPoly)) {
                points.push({ x: rotated.x, y: rotated.y, angle: angle });
            }
        }
        currentAxis = (currentAxis === "x") ? "y" : "x";
    }

    if (points.length === 0) return points;

    // Verify corner coverage
    var origBounds = Geo.polygonBounds(polyCoords3857);
    var corners = [
        { x: origBounds.minx, y: origBounds.miny },
        { x: origBounds.minx, y: origBounds.maxy },
        { x: origBounds.maxx, y: origBounds.miny },
        { x: origBounds.maxx, y: origBounds.maxy }
    ];

    var cornersMissingCoverage = [];
    for (var ci = 0; ci < corners.length; ci++) {
        var corner = corners[ci];
        var minDist = Infinity;
        for (var pi = 0; pi < points.length; pi++) {
            var d = Geo.distance(corner.x, corner.y, points[pi].x, points[pi].y);
            if (d < minDist) minDist = d;
        }
        if (minDist > overlapThreshold) {
            cornersMissingCoverage.push(corner);
        }
    }

    // Add targeted waypoints for under-covered corners
    if (cornersMissingCoverage.length > 0) {
        for (var mi = 0; mi < cornersMissingCoverage.length; mi++) {
            var mc = cornersMissingCoverage[mi];
            // Rotate corner into grid space
            var rotCorner = Geo.rotatePoint(mc.x, mc.y, centroid.x, centroid.y, rotationAngle);
            var newY = miny + Math.round((rotCorner.y - miny) / ySpacing) * ySpacing;
            var yIdx = Math.round((newY - miny) / ySpacing);
            var cAxis = (yIdx % 2 === 0) ? "x" : "y";
            var cAngle = (cAxis === "x") ? -90 : 90;

            for (var cxi = 0; cxi < xpoints; cxi++) {
                var cx = minx + cxi * xSpacing;
                var rotPt = Geo.rotatePoint(cx, newY, centroid.x, centroid.y, rotationAngle);

                if (Geo.pointInPolygon(rotPt.x, rotPt.y, bufferedPoly)) {
                    // Check for duplicates
                    var isDuplicate = false;
                    for (var di = 0; di < points.length; di++) {
                        if (Geo.distance(rotPt.x, rotPt.y, points[di].x, points[di].y) < xSpacing * 0.1) {
                            isDuplicate = true;
                            break;
                        }
                    }
                    if (!isDuplicate) {
                        points.push({ x: rotPt.x, y: rotPt.y, angle: cAngle });
                    }
                }
            }
        }
    }

    return points;
}

// Create a continuous flight path from grid points with snake pattern
function createPath(points, forwardSpacing, rotationAngle, polygon3857, gimbalAngle) {
    if (gimbalAngle === undefined) gimbalAngle = "-80";

    // Process angle-based segments: group by angle, reverse -90 segments for snake pattern
    var segments = [];
    var currentSegment = [];
    var currentAngle = null;

    for (var i = 0; i < points.length; i++) {
        if (currentAngle === null) {
            currentAngle = points[i].angle;
        }
        if (points[i].angle === currentAngle) {
            currentSegment.push(i);
        } else {
            segments.push({ indices: currentSegment, angle: currentAngle });
            currentSegment = [i];
            currentAngle = points[i].angle;
        }
    }
    if (currentSegment.length > 0) {
        segments.push({ indices: currentSegment, angle: currentAngle });
    }

    // Make a copy and reverse -90 segments
    var processedPoints = points.slice();
    for (var si = 0; si < segments.length; si++) {
        if (segments[si].angle === -90) {
            var indices = segments[si].indices;
            var segValues = [];
            for (var k = 0; k < indices.length; k++) {
                segValues.push(points[indices[k]]);
            }
            segValues.reverse();
            for (var m = 0; m < indices.length; m++) {
                processedPoints[indices[m]] = segValues[m];
            }
        }
    }

    // Filter points outside polygon for non-edge segments
    function filterPointsInPolygon(segPoints, isEdge) {
        if (!polygon3857 || isEdge) return segPoints;

        var outside = [];
        for (var fi = 0; fi < segPoints.length; fi++) {
            if (!Geo.pointInPolygon(segPoints[fi].x, segPoints[fi].y, polygon3857)) {
                outside.push(fi);
            }
        }
        if (outside.length > 2) {
            var filtered = [];
            for (var fj = 0; fj < segPoints.length; fj++) {
                if (fj !== outside[0] && fj !== outside[outside.length - 1]) {
                    filtered.push(segPoints[fj]);
                }
            }
            return filtered;
        }
        return segPoints;
    }

    var newData = [];

    for (var idx = 0; idx < segments.length; idx++) {
        var isEdgeSegment = (idx === 0) || (idx === segments.length - 1);
        var segIndices = segments[idx].indices;
        var segAngle = segments[idx].angle;

        var segPoints = [];
        for (var sp = 0; sp < segIndices.length; sp++) {
            segPoints.push(processedPoints[segIndices[sp]]);
        }

        segPoints = filterPointsInPolygon(segPoints, isEdgeSegment);
        if (segPoints.length === 0) continue;

        // Add start buffer point
        var firstPt = segPoints[0];
        var startX = firstPt.x;
        var startY = firstPt.y;
        if (segAngle === -90) startX += forwardSpacing;
        else if (segAngle === 90) startX -= forwardSpacing;

        var rotStart = Geo.rotatePoint(startX, startY, firstPt.x, firstPt.y, rotationAngle);
        newData.push({
            x: rotStart.x, y: rotStart.y,
            angle: segAngle, take_photo: false, gimbal_angle: gimbalAngle
        });

        // Add all segment points
        for (var wp = 0; wp < segPoints.length; wp++) {
            newData.push({
                x: segPoints[wp].x, y: segPoints[wp].y,
                angle: segPoints[wp].angle, take_photo: true, gimbal_angle: gimbalAngle
            });
        }

        // Add end buffer point
        var lastPt = segPoints[segPoints.length - 1];
        var endX = lastPt.x;
        var endY = lastPt.y;
        if (segAngle === -90) endX -= forwardSpacing;
        else if (segAngle === 90) endX += forwardSpacing;

        var rotEnd = Geo.rotatePoint(endX, endY, lastPt.x, lastPt.y, rotationAngle);
        newData.push({
            x: rotEnd.x, y: rotEnd.y,
            angle: segAngle, take_photo: false, gimbal_angle: gimbalAngle
        });
    }

    return newData;
}

// Simplify waypoints to waylines (keep only start and end of each segment)
function removeMiddlePoints(data) {
    if (!data || data.length === 0) return [];

    var processed = [];
    var i = 0;

    while (i < data.length) {
        var currentAngle = data[i].angle;
        var segStart = i;

        while (i < data.length && data[i].angle === currentAngle) {
            i++;
        }

        var segEnd = i;
        var segLen = segEnd - segStart;

        if (segLen > 2) {
            processed.push(data[segStart]);
            processed.push(data[segEnd - 1]);
        } else {
            for (var j = segStart; j < segEnd; j++) {
                processed.push(data[j]);
            }
        }
    }

    // Set all take_photo = false for waylines mode (uses interval instead)
    for (var k = 0; k < processed.length; k++) {
        processed[k].take_photo = false;
    }

    return processed;
}
