.pragma library

// Shared placemark helpers for QField and the browser flight planner.
function applyFlatPlacemarks(geojson, parameters) {
    var agl = parameters.altitude_above_ground_level
    var speed = parameters.ground_speed

    for (var i = 0; i < geojson.features.length; i++) {
      var feature = geojson.features[i]
      var coords = feature.geometry.coordinates
      if (coords.length < 3) coords.push(agl)
      else coords[2] = agl
      feature.properties.speed = speed
      feature.properties.altitude = agl
    }
    return geojson
}

// QField styles the first vertex as the takeoff point.
function buildFlightpathGeojson(placemarks, takeoffPoint) {
    var coords = []
    if (takeoffPoint && takeoffPoint.lon !== undefined && takeoffPoint.lat !== undefined) {
      coords.push([takeoffPoint.lon, takeoffPoint.lat])
    }
    for (var i = 0; i < placemarks.features.length; i++) {
      var c = placemarks.features[i].geometry.coordinates
      coords.push([c[0], c[1]])
    }
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { kind: "flightpath" },
        geometry: { type: "LineString", coordinates: coords }
      }]
    }
}
