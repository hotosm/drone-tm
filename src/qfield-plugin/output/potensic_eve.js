.pragma library

// Potensic Eve (iOS) waypoint JSON format for the Atom 2.
// Keep this module compatible with the QField plugin's older JavaScript style.

function finiteNumber(value) {
    return typeof value === "number" && isFinite(value)
}

function createPotensicEveJson(featcol, defaultSpeed) {
    if (!featcol || featcol.type !== "FeatureCollection" || !Array.isArray(featcol.features)) {
        throw new Error("Expected a GeoJSON FeatureCollection")
    }

    var features = featcol.features
    if (features.length === 0) {
        throw new Error("The flight plan has no waypoints")
    }

    var speed = defaultSpeed
    if (!finiteNumber(speed) || speed < 0.1 || speed > 30) {
        throw new Error("Potensic Eve speed must be a finite number from 0.1 to 30 m/s")
    }

    var waypoints = []
    for (var i = 0; i < features.length; i++) {
        var feature = features[i]
        var props = feature && feature.properties ? feature.properties : {}
        var geometry = feature && feature.geometry ? feature.geometry : null
        var coords = geometry && geometry.coordinates ? geometry.coordinates : null
        var at = "Waypoint " + (i + 1)

        if (!coords || coords.length < 2) {
            throw new Error(at + " has invalid coordinates")
        }

        var lng = coords[0]
        var lat = coords[1]
        if (!finiteNumber(lat) || !finiteNumber(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            throw new Error(at + " has invalid latitude or longitude")
        }
        if (lat === 0 && lng === 0) {
            throw new Error(at + " is at latitude 0, longitude 0")
        }

        var height = coords.length > 2 ? coords[2] : props.altitude
        if (!finiteNumber(height) || height < 2 || height > 500) {
            throw new Error(at + " height must be between 2 and 500 m")
        }

        var gimbalValue = props.gimbal_angle
        var gimbalPitch = (gimbalValue === undefined || gimbalValue === null || gimbalValue === "")
            ? -90
            : Number(gimbalValue)
        if (!isFinite(gimbalPitch) || gimbalPitch < -90 || gimbalPitch > 20) {
            throw new Error(at + " gimbal pitch must be between -90 and 20 degrees")
        }

        var hoverValue = props.hover_time
        if (hoverValue === undefined || hoverValue === null || hoverValue === "") {
            hoverValue = props.hoverTime
        }
        var hoverTime = (hoverValue === undefined || hoverValue === null || hoverValue === "")
            ? 0
            : Number(hoverValue)
        if (!isFinite(hoverTime) || hoverTime < 0 || hoverTime > 3600) {
            throw new Error(at + " hover time must be between 0 and 3600 seconds")
        }

        waypoints.push({
            global_speed: speed,
            snapshootFile: "",
            wp_speed: speed,
            wp_speed_type: 0,
            wp_yaw_custom: 0,
            wp_gimbal_type: 2,
            wp_yaw_type: 0,
            wp_hover_time: hoverTime,
            wp_action: props.take_photo ? 1 : 0,
            wp_zoom_type: 0,
            wp_height: Math.round(height * 10) / 10,
            wp_yaw_interest: 0,
            isHaveAltitude: false,
            wp_zoom_ratio: 1,
            isFromSave: true,
            wp_gimbal_pitch_custom: gimbalPitch,
            wp_lon: Number(lng.toFixed(7)),
            wp_lat: Number(lat.toFixed(7)),
            wp_altitude: 0,
            addPointWay: 0
        })
    }

    return JSON.stringify(waypoints)
}
