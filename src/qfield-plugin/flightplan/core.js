.pragma library

.import "geometry.js" as Geo
.import "parameters.js" as Params
.import "grid.js" as Grid
.import "drone_specs.js" as Specs
.import "terrain.js" as Terrain

// ============================================================================
// Flightplan generation - main entry point
// Port of create_flightplan.py and waypoints.py::create_waypoint
// ============================================================================

// Generate a complete flightplan from a polygon AOI
//
// Parameters:
//   polygonCoords - Array of [lon, lat] coordinate pairs (WGS84)
//   config - Object with:
//     agl: altitude above ground level (m)
//     gsd: ground sampling distance (cm/px), optional (overrides agl)
//     forwardOverlap: forward overlap percentage (default 70)
//     sideOverlap: side overlap percentage (default 70)
//     rotationAngle: grid rotation in degrees (default 0, auto-calculated)
//     flightMode: "waylines" or "waypoints" (default "waylines")
//     droneType: drone type key (default "DJI_MINI_4_PRO")
//     gimbalAngle: gimbal angle string (default "-80")
//     imageInterval: seconds between photos (default 2)
//
// Returns:
//   Object with:
//     geojson: GeoJSON FeatureCollection of waypoints
//     batteryWarning: boolean
//     estimatedFlightTimeMinutes: number
//     parameters: calculated flight parameters
//
function generate(polygonCoords, config) {
    // Defaults
    var agl = config.agl || 115;
    var gsd = config.gsd || null;
    var forwardOverlap = config.forwardOverlap || 70;
    var sideOverlap = config.sideOverlap || 70;
    var rotationAngle = config.rotationAngle || 0;
    var autoRotation = (config.autoRotation !== undefined) ? config.autoRotation : true;
    var flightMode = config.flightMode || Specs.FlightMode.WAYLINES;
    var droneType = config.droneType || Specs.DroneType.DJI_MINI_4_PRO;
    var gimbalAngle = config.gimbalAngle || Specs.GimbalAngle.OFF_NADIR;
    var imageInterval = config.imageInterval || 2;

    // If user specifies clockwise rotation, convert to counter-clockwise
    rotationAngle = 360 - rotationAngle;

    // Calculate flight parameters
    var parameters = Params.calculateParameters(
        forwardOverlap, sideOverlap, agl, gsd, imageInterval, droneType
    );

    if (gsd) {
        agl = parameters.altitude_above_ground_level;
    }

    var sideSpacing = parameters.side_spacing;
    var forwardSpacing = parameters.forward_spacing;

    // Project polygon to EPSG:3857 for meter-based calculations
    var poly3857 = [];
    for (var i = 0; i < polygonCoords.length; i++) {
        var projected = Geo.toMercator(polygonCoords[i][0], polygonCoords[i][1]);
        poly3857.push({ x: projected.x, y: projected.y });
    }

    // Auto-calculate rotation angle if enabled
    if (autoRotation && (rotationAngle === 0 || rotationAngle === 360)) {
        rotationAngle = Grid.calculateOptimalRotationAngle(poly3857);
    }

    // Generate grid within AOI
    var grid = Grid.generateGridInAoi(
        poly3857, forwardSpacing, sideSpacing, rotationAngle, sideOverlap
    );

    // Create flight path with snake pattern
    var path = Grid.createPath(
        grid, forwardSpacing, rotationAngle, poly3857, gimbalAngle
    );

    // Debug: log grid and path sizes for diagnostics
    // (console.log outputs to QField log via Qt message handler)
    console.log("DroneTM grid: " + grid.length + " points, path: " + path.length +
        " points, rotation: " + rotationAngle.toFixed(1) +
        ", spacing: " + forwardSpacing.toFixed(1) + "x" + sideSpacing.toFixed(1) +
        "m, mode: " + flightMode);

    // Simplify to waylines if requested
    var waypoints;
    if (flightMode === Specs.FlightMode.WAYLINES) {
        waypoints = Grid.removeMiddlePoints(path);
    } else {
        waypoints = path;
    }

    // Calculate total distance and flight time
    var totalDistance = 0;
    for (var d = 0; d < waypoints.length - 1; d++) {
        totalDistance += Geo.distance(
            waypoints[d].x, waypoints[d].y,
            waypoints[d + 1].x, waypoints[d + 1].y
        );
    }

    var groundSpeed = parameters.ground_speed;
    var estimatedFlightTimeMinutes = 0;
    if (groundSpeed > 0) {
        estimatedFlightTimeMinutes = (totalDistance / groundSpeed) / 60;
    }

    // Check battery life
    var batteryWarning = false;
    var specs = Specs.DRONE_SPECS[droneType];
    if (specs && specs.max_battery_life_minutes) {
        var batteryLife = specs.max_battery_life_minutes.tested_value ||
                          specs.max_battery_life_minutes.quoted_value;
        if (estimatedFlightTimeMinutes > (batteryLife * 0.8)) {
            batteryWarning = true;
        }
    }

    // Convert waypoints to GeoJSON (back to WGS84)
    var features = [];
    for (var wi = 0; wi < waypoints.length; wi++) {
        var wp = waypoints[wi];
        var wgs = Geo.toWgs84(wp.x, wp.y);
        features.push({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [wgs.lon, wgs.lat]
            },
            properties: {
                index: wi,
                heading: wp.angle,
                take_photo: wp.take_photo,
                gimbal_angle: wp.gimbal_angle
            }
        });
    }

    var geojson = {
        type: "FeatureCollection",
        features: features
    };

    return {
        geojson: geojson,
        batteryWarning: batteryWarning,
        estimatedFlightTimeMinutes: Math.round(estimatedFlightTimeMinutes * 100) / 100,
        parameters: parameters
    };
}

// Add DEM elevations to a flightplan GeoJSON and create placemarks
// This is called from QML after DEM sampling has been done via ExpressionEvaluator
//
// Parameters:
//   geojson - FeatureCollection with elevation in coordinates[2]
//   parameters - flight parameters from generate()
//   flightMode - "waylines" or "waypoints"
//   takeoffElevation - DEM elevation at takeoff point (null to use first waypoint)
//   threshold - AGL deviation threshold for terrain following (default 5m)
//
// Returns:
//   Updated GeoJSON FeatureCollection with altitude/speed properties
function applyTerrainFollowing(geojson, parameters, flightMode, takeoffElevation, threshold) {
    if (threshold === undefined) threshold = 5;

    // Add altitude/speed properties based on elevation
    var placemarks = Terrain.createPlacemarks(geojson, parameters, takeoffElevation);

    // For waylines mode, simplify to terrain-aware waylines
    // This removes intermediate points while maintaining AGL within threshold
    if (flightMode === Specs.FlightMode.WAYLINES) {
        placemarks = Terrain.waypoints2waylines(placemarks, threshold);
    }

    return placemarks;
}
