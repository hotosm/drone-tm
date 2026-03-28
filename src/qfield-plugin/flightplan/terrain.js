.pragma library

.import "geometry.js" as Geo

// ============================================================================
// Terrain following / DEM elevation support
// Port of terrain_following_waylines.py and create_placemarks.py
// ============================================================================

// Add altitude and speed properties to waypoints based on elevation data
// Adjusts altitude relative to base elevation at first waypoint
function createPlacemarks(waypointsGeojson, parameters) {
    var groundSpeed = parameters.ground_speed;
    var agl = parameters.altitude_above_ground_level;
    var features = waypointsGeojson.features;

    var baseElevation = 0;
    if (features.length > 0) {
        var firstCoords = features[0].geometry.coordinates;
        if (firstCoords.length > 2) {
            baseElevation = firstCoords[2];
        }
    }

    for (var i = 0; i < features.length; i++) {
        var coords = features[i].geometry.coordinates;
        var altitude;

        if (coords.length > 2) {
            var elevation = coords[2];
            var differenceInElevation = baseElevation - elevation;
            altitude = agl - differenceInElevation;
            coords[2] = altitude;
        } else {
            altitude = agl;
            coords.push(altitude);
        }

        features[i].properties.speed = groundSpeed;
        features[i].properties.altitude = altitude;
    }

    return waypointsGeojson;
}

// Extract unidirectional flight lines from a plan
// Creates a new line each time the heading changes
function extractLines(plan) {
    var waylines = [];
    var currentLine = [];
    var lastHeading = null;

    for (var i = 0; i < plan.length; i++) {
        var currentHeading = plan[i].properties.heading;
        if (lastHeading !== null && currentHeading !== lastHeading) {
            waylines.push(currentLine);
            currentLine = [];
        }
        currentLine.push(plan[i]);
        lastHeading = currentHeading;
    }
    if (currentLine.length > 0) {
        waylines.push(currentLine);
    }

    return waylines;
}

// Inject points needed to maintain AGL consistency within threshold
function inject(kp, tp, threshold) {
    // Create 2-point segments between keeper points
    var baseIndex = kp[0];
    var currentPoint = kp[0];
    var segments = [];
    for (var s = 1; s < kp.length; s++) {
        var endpoint = kp[s];
        var startOffset = currentPoint - baseIndex;
        segments.push({
            start: tp[startOffset],
            end: tp[endpoint - baseIndex],
            startOffset: startOffset
        });
        currentPoint = endpoint;
    }

    var newKeeperPoints = [];

    for (var si = 0; si < segments.length; si++) {
        var fp = segments[si].start;
        var lp = segments[si].end;
        var fpOffset = segments[si].startOffset;

        var fpGeom = fp.geometry;
        var lpGeom = lp.geometry;
        var run = Geo.distance(fpGeom.x, fpGeom.y, lpGeom.x, lpGeom.y);
        var rise = lpGeom.z - fpGeom.z;
        var slope = 0;
        if (run > 0) slope = rise / run;

        var maxAglDifference = 0;
        var injectionPoint = null;
        var pointsToTraverse = lp.index - fp.index;

        for (var pi = 1; pi < pointsToTraverse; pi++) {
            var pt = tp[fpOffset + pi];
            var z = pt.geometry.z;
            var ptRun = Geo.distance(fpGeom.x, fpGeom.y, pt.geometry.x, pt.geometry.y);
            var expectedZ = fpGeom.z + (ptRun * slope);
            var aglDifference = Math.abs(z - expectedZ);

            if (aglDifference > maxAglDifference && aglDifference > threshold) {
                maxAglDifference = aglDifference;
                injectionPoint = fpOffset + pi;
            }
        }

        if (injectionPoint !== null) {
            newKeeperPoints.push(fp.index);
            newKeeperPoints.push(tp[injectionPoint].index);
            newKeeperPoints.push(lp.index);
        } else {
            newKeeperPoints.push(fp.index);
            newKeeperPoints.push(lp.index);
        }
    }

    return newKeeperPoints;
}

// Trim a wayline by removing intermediate points while keeping AGL within threshold
function trim(line, threshold) {
    if (line.length <= 4) return line;

    // Transform points to EPSG:3857 for distance calculations
    var tp = [];
    for (var i = 0; i < line.length; i++) {
        var coords = line[i].geometry.coordinates;
        var projected = Geo.toMercator(coords[0], coords[1]);
        tp.push({
            index: line[i].properties.index,
            geometry: { x: projected.x, y: projected.y, z: coords[2] || 0 }
        });
    }

    // Start with first and last points as keepers
    var kp = [tp[0].index, tp[tp.length - 1].index];
    var nkp = inject(kp, tp, threshold);

    // Keep injecting until stable
    var maxIterations = 100;
    var iter = 0;
    while (iter < maxIterations) {
        var nextKp = inject(nkp, tp, threshold);
        // Check if sets are equal
        var setA = {};
        var setB = {};
        for (var a = 0; a < nkp.length; a++) setA[nkp[a]] = true;
        for (var b = 0; b < nextKp.length; b++) setB[nextKp[b]] = true;

        var changed = false;
        for (var key in setB) {
            if (!setA[key]) { changed = true; break; }
        }
        if (!changed) {
            for (var key2 in setA) {
                if (!setB[key2]) { changed = true; break; }
            }
        }
        if (!changed) break;
        nkp = nextKp;
        iter++;
    }

    // Filter line to keep only keeper points
    var keeperSet = {};
    for (var ki = 0; ki < nkp.length; ki++) keeperSet[nkp[ki]] = true;

    var newLine = [];
    for (var li = 0; li < line.length; li++) {
        if (keeperSet[line[li].properties.index]) {
            newLine.push(line[li]);
        }
    }
    return newLine;
}

// Convert terrain-following waypoints to waylines by removing unnecessary intermediate points
// while maintaining AGL within the specified threshold (default 5m)
function waypoints2waylines(geojson, threshold) {
    if (threshold === undefined) threshold = 5;

    var inplan = geojson.features;

    // NOTE: Python version skips first point (dummy takeoff waypoint),
    // but the QField plugin does not generate a dummy takeoff point.
    var lines = extractLines(inplan);

    var features = [];
    for (var i = 0; i < lines.length; i++) {
        var wayline = trim(lines[i], threshold);
        for (var j = 0; j < wayline.length; j++) {
            features.push(wayline[j]);
        }
    }

    // Re-index sequentially
    for (var idx = 0; idx < features.length; idx++) {
        features[idx].properties.index = idx;
    }

    return {
        type: geojson.type,
        features: features
    };
}
