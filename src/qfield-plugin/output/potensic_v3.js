.pragma library

.import "potensic_v2.js" as PotensicV2Output

// Atom 3 keeps the Atom 2 ZIP and global.json layout, but stores the mission
// as a plain JSON waypoint array.

function _missionSpeed(featcol, defaultSpeed) {
    var features = featcol.features || []
    for (var i = 0; i < features.length; i++) {
        var props = features[i].properties || {}
        if (props.speed !== undefined && props.speed !== null) return props.speed
    }
    return defaultSpeed
}

function createGlobalJson(speed) {
    return JSON.stringify({
        finishAction: "RETURN",
        globalHeight: 0,
        globalHeightType: 0,
        isOrder: true,
        lostAction: "RETURN",
        speed: speed
    }, null, 2)
}

function createMissionJson(featcol, missionSpeed) {
    var features = featcol.features || []
    var waypoints = []

    for (var i = 0; i < features.length; i++) {
        var feature = features[i]
        var props = feature.properties || {}
        var geometry = feature.geometry || {}
        var coords = geometry.coordinates || []

        if (coords.length < 3) continue

        var gimbalAngle = (props.gimbal_angle !== undefined) ? props.gimbal_angle : -80
        var gimbalPitch = Math.round(parseFloat(gimbalAngle))
        if (isNaN(gimbalPitch)) gimbalPitch = -80

        var waypointSpeed = (props.speed !== undefined) ? props.speed : missionSpeed
        waypoints.push({
            action: props.take_photo ? "PHOTO" : "NONE",
            gimbalPitch: gimbalPitch,
            gimbalType: "DEFINE",
            height: coords[2],
            hoverTime: (props.hover_time !== undefined) ? props.hover_time : 0,
            lat: coords[1],
            lng: coords[0],
            poiHeight: coords[2],
            poiLat: 0.0,
            poiLng: 0.0,
            poiType: 0,
            speed: waypointSpeed,
            speedType: (waypointSpeed === missionSpeed) ? "GLOBAL" : "DEFINE",
            yaw: 0,
            yawType: "TO_WAYPOINT",
            zoomRatio: 1.0,
            zoomType: "HAND"
        })
    }

    return JSON.stringify(waypoints)
}

// Returns {zipData, globalJson, missionJson, timestampMs}.
function createPotensicZip(featcol, defaultSpeed, timestampMs) {
    var features = featcol.features || []
    if (features.length === 0) {
        throw new Error("No features found in feature collection")
    }

    if (defaultSpeed === undefined || defaultSpeed === null) defaultSpeed = 10.0
    if (!timestampMs) timestampMs = Date.now()

    var speed = _missionSpeed(featcol, defaultSpeed)
    var globalJson = createGlobalJson(speed)
    var missionJson = createMissionJson(featcol, speed)
    var ts = String(timestampMs)
    var zipData = PotensicV2Output.buildZip([
        { name: ts + "/global.json", data: globalJson },
        { name: ts + "/" + ts + ".json", data: missionJson }
    ])

    return {
        zipData: zipData,
        globalJson: globalJson,
        missionJson: missionJson,
        timestampMs: timestampMs
    }
}
