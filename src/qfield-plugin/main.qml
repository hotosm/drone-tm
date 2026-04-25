import QtQuick
import QtQuick.Controls
import org.qfield
import org.qgis
import Theme

import "flightplan/core.js" as Flightplan
import "flightplan/drone_specs.js" as Specs
import "output/dji.js" as DjiOutput
import "output/kmz.js" as Kmz

Item {
  id: plugin

  property var mainWindow: iface.mainWindow()
  property var mapCanvas: iface.mapCanvas()
  property var geometryHighlighter: iface.findItemByObjectName('geometryHighlighter')

  property var taskLayer: null
  property var flightplanResult: null
  property string lastKmzPath: ""
  property var lastKmzData: null

  // Takeoff point state
  property var takeoffPoint: null  // {lon, lat} or null
  property bool placingTakeoff: false
  property var positionSource: iface.findItemByObjectName('positionSource')

  // --- Toolbar Button ---
  QfToolButton {
    id: dronetmButton
    iconSource: 'dronetm.svg'
    iconColor: '#C53639'
    bgcolor: '#FFFFFF'
    round: true

    onClicked: {
      log("DroneTM button clicked")
      findTaskLayer()
      if (!taskLayer) {
        mainWindow.displayToast(qsTr('No "dtm-tasks" layer found in project'))
        return
      }
      flightplanDialog.populateTaskList()
      flightplanDialog.open()
    }
  }

  // --- Canvas action button (shown on feature long-press menu) ---
  QfToolButton {
    id: canvasActionButton
    iconSource: 'dronetm.svg'
    iconColor: '#C53639'
    bgcolor: '#FFFFFF'
    round: true

    onClicked: {
      log("Canvas action button clicked")
      findTaskLayer()
      if (!taskLayer) {
        mainWindow.displayToast(qsTr('No "dtm-tasks" layer found in project'))
        return
      }
      flightplanDialog.populateTaskList()
      flightplanDialog.open()
    }
  }

  Component.onCompleted: {
    iface.addItemToPluginsToolbar(dronetmButton)
    iface.addItemToCanvasActionsToolbar(canvasActionButton)
    findTaskLayer()
    log("DroneTM plugin loaded. taskLayer=" + (taskLayer ? taskLayer.name : "null"))

    // Try to discover the point handler object name for future use
    discoverPointHandler()
  }

  // --- Flightplan Configuration Dialog ---
  FlightplanDialog {
    id: flightplanDialog
    taskLayer: plugin.taskLayer
    takeoffPoint: plugin.takeoffPoint

    onGenerateRequested: function(config) {
      generateFlightplan(config)
    }

    onCopyToControllerRequested: {
      copyToFlightController()
    }

    onUseGpsTakeoff: {
      setTakeoffFromGps()
    }

    onPlaceMapTakeoff: {
      setTakeoffFromMap()
    }

    onClearTakeoff: {
      takeoffPoint = null
      flightplanDialog.takeoffPoint = null
    }
  }

  // --- ExpressionEvaluator for DEM sampling ---
  ExpressionEvaluator {
    id: demEvaluator
  }

  // --- Map tap handler for placing takeoff point ---
  Connections {
    target: mapCanvas
    function onClicked(point) {
      if (!placingTakeoff) return
      placingTakeoff = false

      var wgs84Crs = CoordinateReferenceSystemUtils.fromDescription("EPSG:4326")
      var mapCrs = mapCanvas.mapSettings.destinationCrs
      var mapPoint = mapCanvas.mapSettings.screenToCoordinate(point)
      var projected = GeometryUtils.reprojectPoint(
        GeometryUtils.point(mapPoint.x, mapPoint.y), mapCrs, wgs84Crs
      )

      takeoffPoint = { lon: projected.x, lat: projected.y }
      flightplanDialog.takeoffPoint = takeoffPoint
      mainWindow.displayToast(qsTr('Takeoff point set'))
      flightplanDialog.populateTaskList()
      flightplanDialog.open()
    }
  }

  // --- Core Functions ---

  function log(msg) {
    iface.logMessage("DroneTM: " + msg)
  }

  function discoverPointHandler() {
    // Try various object names to find the MapCanvasPointHandler
    var names = ['sketcher', 'pointHandler', 'mapCanvasPointHandler',
                 'canvasPointHandler', 'identifyTool', 'sketcher_sketcher']
    for (var i = 0; i < names.length; i++) {
      var obj = iface.findItemByObjectName(names[i])
      if (obj) {
        var methods = []
        // Check for registerHandler
        if (obj.registerHandler) methods.push('registerHandler')
        if (obj.pointClicked) methods.push('pointClicked')
        log("Found object '" + names[i] + "' with methods: " + methods.join(', '))
      }
    }
  }

  function setTakeoffFromGps() {
    if (!positionSource || !positionSource.active ||
        !positionSource.positionInformation.latitudeValid) {
      mainWindow.displayToast(qsTr('GPS not available'))
      return
    }
    takeoffPoint = {
      lon: positionSource.positionInformation.longitude,
      lat: positionSource.positionInformation.latitude
    }
    flightplanDialog.takeoffPoint = takeoffPoint
    mainWindow.displayToast(qsTr('Takeoff point set from GPS'))
  }

  function setTakeoffFromMap() {
    placingTakeoff = true
    flightplanDialog.close()
    mainWindow.displayToast(qsTr('Tap map to set takeoff point'))
  }

  function findTaskLayer() {
    var layers = qgisProject.mapLayersByName("dtm-tasks")
    if (layers.length > 0) {
      taskLayer = layers[0]
    }
  }

  function getTaskFeatureById(taskId) {
    if (!taskLayer) return null

    var expression = "\"project_task_id\" = '" + taskId + "'"
    log("Querying task: " + expression)
    var iterator = LayerUtils.createFeatureIteratorFromExpression(taskLayer, expression)

    if (iterator && iterator.hasNext()) {
      var feature = iterator.next()
      iterator.close()
      return feature
    }
    return null
  }

  function extractPolygonCoords(geometry) {
    var wkt = geometry.asWkt()
    log("WKT: " + wkt.substring(0, 120) + "...")

    // Parse WKT polygon - handle POLYGON((x y, ...)) and variants
    var coordStr = wkt.replace(/^[A-Za-z]+\s*\(\(/, '').replace(/\)\).*$/, '')
    var pairs = coordStr.split(',')
    var coords = []

    var sourceCrs = taskLayer.crs
    var wgs84Crs = CoordinateReferenceSystemUtils.fromDescription("EPSG:4326")

    for (var i = 0; i < pairs.length; i++) {
      var parts = pairs[i].trim().split(/\s+/)
      if (parts.length >= 2) {
        var x = parseFloat(parts[0])
        var y = parseFloat(parts[1])
        if (isNaN(x) || isNaN(y)) continue

        var point = GeometryUtils.point(x, y)
        var projected = GeometryUtils.reprojectPoint(point, sourceCrs, wgs84Crs)
        coords.push([projected.x, projected.y])
      }
    }

    log("Extracted " + coords.length + " vertices")
    return coords
  }

  function generateFlightplan(config) {
    // Get the selected task feature
    var taskId = config.taskId
    log("Generating flightplan for task " + taskId)

    var feature = getTaskFeatureById(taskId)
    if (!feature) {
      mainWindow.displayToast(qsTr('Task "%1" not found').arg(taskId))
      return
    }

    var geom = feature.geometry
    var coords = extractPolygonCoords(geom)
    if (!coords || coords.length < 3) {
      mainWindow.displayToast(qsTr('Invalid task geometry'))
      return
    }

    // Highlight selected task and pan map to its extent
    if (geometryHighlighter) {
      geometryHighlighter.geometryWrapper.qgsGeometry = geom
      geometryHighlighter.geometryWrapper.crs = taskLayer.crs
    }
    try {
      var extent = GeometryUtils.reprojectRectangle(
        geom.boundingBox(), taskLayer.crs, mapCanvas.mapSettings.destinationCrs
      )
      mapCanvas.mapSettings.extent = extent
    } catch (e) {
      log("Could not pan to task extent: " + e)
    }

    log("Generating with config: " + JSON.stringify(config))
    mainWindow.displayToast(qsTr('Generating flightplan...'))

    try {
      // When DEM is selected with waylines mode, generate ALL points first
      // (as waypoints), then simplify to waylines after DEM sampling.
      // This matches the Python create_flightplan.py flow for terrain following.
      var generateConfig = config
      var actualFlightMode = config.flightMode
      if (config.demLayer && config.flightMode === "waylines") {
        generateConfig = JSON.parse(JSON.stringify(config))
        generateConfig.flightMode = "waypoints"
        log("DEM + waylines: generating all waypoints first for terrain-aware simplification")
      }

      var result = Flightplan.generate(coords, generateConfig)
      flightplanResult = result

      log("Generated: " + result.geojson.features.length + " waypoints, " +
          result.estimatedFlightTimeMinutes + " min")

      var msg = qsTr('Generated: %1 waypoints, ~%2 min')
        .arg(result.geojson.features.length)
        .arg(result.estimatedFlightTimeMinutes)
      if (result.batteryWarning) {
        msg += qsTr(' - Battery warning!')
      }
      mainWindow.displayToast(msg)

      if (config.demLayer) {
        applyDemElevation(result, actualFlightMode, config, taskId)
      } else {
        var placemarks = applyFlatPlacemarks(result.geojson, result.parameters)
        outputFlightplan(placemarks, config, taskId)
      }

    } catch (e) {
      log("Generation error: " + e)
      mainWindow.displayToast(qsTr('Error: %1').arg(e.toString()))
    }
  }

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

  function applyDemElevation(result, flightMode, config, taskId) {
    var demLayerName = config.demLayer
    var geojson = result.geojson
    var features = geojson.features

    var demLayer = qgisProject.mapLayersByName(demLayerName)[0]
    if (!demLayer) {
      log("DEM layer not found: " + demLayerName)
      mainWindow.displayToast(qsTr('DEM layer "%1" not found, using flat altitude').arg(demLayerName))
      var placemarks = applyFlatPlacemarks(geojson, result.parameters)
      outputFlightplan(placemarks, config, taskId)
      return
    }

    // Sample DEM at takeoff point if set
    var takeoffElevation = null
    if (config.takeoffPoint) {
      var tLon = config.takeoffPoint.lon
      var tLat = config.takeoffPoint.lat
      demEvaluator.expressionText =
        "raster_value('" + demLayerName + "', 1, " +
        "transform(make_point(" + tLon + "," + tLat + "), 'EPSG:4326', layer_property('" + demLayerName + "', 'crs')))"
      var tElev = demEvaluator.evaluate()
      if (tElev !== null && tElev !== undefined && !isNaN(tElev) && tElev > -9999) {
        takeoffElevation = tElev
        log("Takeoff elevation from DEM: " + takeoffElevation + " at " + tLon.toFixed(6) + "," + tLat.toFixed(6))
      } else {
        log("Could not sample DEM at takeoff point (" + tLon.toFixed(6) + "," + tLat.toFixed(6) + "), using first waypoint")
      }
    }

    log("Sampling DEM from " + demLayerName + " for " + features.length + " waypoints")

    var sampledCount = 0
    var failedCount = 0
    for (var i = 0; i < features.length; i++) {
      var coords = features[i].geometry.coordinates
      var lon = coords[0]
      var lat = coords[1]

      demEvaluator.expressionText =
        "raster_value('" + demLayerName + "', 1, " +
        "transform(make_point(" + lon + "," + lat + "), 'EPSG:4326', layer_property('" + demLayerName + "', 'crs')))"

      var elevation = demEvaluator.evaluate()
      if (elevation !== null && elevation !== undefined && !isNaN(elevation) && elevation > -9999) {
        if (coords.length < 3) coords.push(elevation)
        else coords[2] = elevation
        sampledCount++
        if (i < 5) log("  WP" + i + ": elev=" + elevation + " at " + lon.toFixed(6) + "," + lat.toFixed(6))
      } else {
        failedCount++
        if (i < 5) log("  WP" + i + ": no DEM value (got " + elevation + ") at " + lon.toFixed(6) + "," + lat.toFixed(6))
      }
    }

    log("DEM sampling complete: " + sampledCount + " sampled, " + failedCount + " failed, " + features.length + " total")

    // Apply terrain-following altitude adjustments, then convert to waylines if needed
    var placemarks = Flightplan.applyTerrainFollowing(
      geojson, result.parameters, flightMode, takeoffElevation
    )
    log("After terrain following: " + placemarks.features.length + " features (mode=" + flightMode + ")")
    outputFlightplan(placemarks, config, taskId)
  }

  function outputFlightplan(placemarks, config, taskId) {
    var globalHeight = 100
    if (placemarks.features.length > 0) {
      var firstCoords = placemarks.features[0].geometry.coordinates
      if (firstCoords.length > 2) globalHeight = firstCoords[2]
    }

    var wpmlXml = DjiOutput.createWpml(placemarks, globalHeight)

    var outputDir = qgisProject.homePath + '/flightplans'
    platformUtilities.createDir(qgisProject.homePath, 'flightplans')

    var timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    var filename = 'task_' + taskId + '_' + timestamp

    var geojsonStr = JSON.stringify(placemarks, null, 2)
    var geojsonPath = outputDir + '/' + filename + '.geojson'
    var wpmlPath = outputDir + '/' + filename + '.wpml'
    var kmzPath = outputDir + '/' + filename + '.kmz'

    log("Saving to " + outputDir)
    var geojsonOk = saveTextFile(geojsonPath, geojsonStr)
    var wpmlOk = saveTextFile(wpmlPath, wpmlXml)

    // Create KMZ (ZIP containing wpmz/waylines.wpml)
    var kmzOk = false
    try {
      var kmzData = Kmz.createKmz(wpmlXml)
      kmzOk = saveBinaryFile(kmzPath, kmzData)
      if (kmzOk) {
        lastKmzPath = kmzPath
        lastKmzData = kmzData
        log("KMZ saved: " + kmzPath + " (" + kmzData.byteLength + " bytes)")
      }
    } catch (e) {
      log("KMZ creation error: " + e)
    }

    if (geojsonOk && wpmlOk) {
      var msg = qsTr('Saved: %1').arg(filename)
      mainWindow.displayToast(msg)

      // Update dialog with result
      flightplanDialog.generationState = "done"
      flightplanDialog.resultMessage = msg
      flightplanDialog.kmzAvailable = kmzOk

      // Scroll dialog to reveal the Copy/Close buttons
      flightplanDialog.scrollToBottom()

      // Load GeoJSON as visualization layer inside a "Flightplans" group
      try {
        var vectorLayer = LayerUtils.loadVectorLayer(geojsonPath, 'flightplan_' + taskId)
        if (vectorLayer) {
          ProjectUtils.addMapLayer(qgisProject, vectorLayer)

          // Move the layer into a "Flightplans" group (create if needed)
          try {
            var root = qgisProject.layerTreeRoot
            var group = root.findGroup("Flightplans")
            if (!group) {
              group = root.addGroup("Flightplans")
              log("Created 'Flightplans' layer group")
            }
            var layerNode = root.findLayer(vectorLayer.id)
            if (layerNode) {
              var clone = layerNode.clone()
              group.insertChildNode(0, clone)
              root.removeChildNode(layerNode)
            }
          } catch (ge) {
            log("Could not move layer to group: " + ge)
          }

          log("Flightplan layer added")
        }
      } catch (e) {
        log("Could not add flightplan layer: " + e)
      }
    } else {
      // File write failed - copy WPML to clipboard as fallback
      log("File write failed, copying WPML to clipboard")
      flightplanDialog.generationState = "error"
      try {
        platformUtilities.copyTextToClipboard(wpmlXml)
        flightplanDialog.resultMessage = qsTr('File write failed - WPML copied to clipboard')
        mainWindow.displayToast(
          qsTr('File write failed - WPML copied to clipboard. Paste into %1.wpml').arg(filename)
        )
      } catch (e) {
        log("Clipboard copy also failed: " + e)
        flightplanDialog.resultMessage = qsTr('File write failed - could not copy to clipboard either')
        mainWindow.displayToast(qsTr('File write failed - check app storage permissions'))
      }
    }
  }

  function saveTextFile(filepath, content) {
    // Method 1: Try platformUtilities.writeFile (available in some QField builds)
    try {
      if (platformUtilities.writeFile && platformUtilities.writeFile(filepath, content)) {
        log("Saved via platformUtilities: " + filepath)
        return true
      }
    } catch (e) {
      log("platformUtilities.writeFile not available: " + e)
    }

    // Method 2: Try FileUtils (QField native utility)
    try {
      if (typeof FileUtils !== 'undefined') {
        // Try common method names
        if (FileUtils.writeFileContent) {
          FileUtils.writeFileContent(filepath, content)
          log("Saved via FileUtils.writeFileContent: " + filepath)
          return true
        }
        if (FileUtils.createFile) {
          FileUtils.createFile(filepath, content)
          log("Saved via FileUtils.createFile: " + filepath)
          return true
        }
      }
    } catch (e) {
      log("FileUtils write not available: " + e)
    }

    // Method 3: XMLHttpRequest PUT (works on Android, blocked on Windows desktop)
    try {
      var xhr = new XMLHttpRequest()
      xhr.open("PUT", "file://" + filepath, false)
      xhr.send(content)
      log("Saved via XHR PUT: " + filepath)
      return true
    } catch (e) {
      log("XHR PUT failed for " + filepath + ": " + e)
    }

    // Method 4: Try XMLHttpRequest with file:/// (triple slash)
    try {
      var xhr2 = new XMLHttpRequest()
      xhr2.open("PUT", "file:///" + filepath, false)
      xhr2.send(content)
      log("Saved via XHR PUT (triple slash): " + filepath)
      return true
    } catch (e) {
      log("XHR PUT (triple slash) also failed: " + e)
    }

    log("ERROR: All file write methods failed for " + filepath)
    mainWindow.displayToast(qsTr('File write failed - check app storage permissions'))
    return false
  }

  function saveBinaryFile(filepath, arrayBuffer) {
    // Method 1: XHR PUT with ArrayBuffer (Qt 6 QML supports this)
    try {
      var xhr = new XMLHttpRequest()
      xhr.open("PUT", "file://" + filepath, false)
      xhr.send(arrayBuffer)
      log("Binary saved via XHR PUT: " + filepath)
      return true
    } catch (e) {
      log("XHR PUT binary failed: " + e)
    }

    // Method 2: Try triple-slash file URL
    try {
      var xhr2 = new XMLHttpRequest()
      xhr2.open("PUT", "file:///" + filepath, false)
      xhr2.send(arrayBuffer)
      log("Binary saved via XHR PUT (triple slash): " + filepath)
      return true
    } catch (e) {
      log("XHR PUT binary (triple slash) failed: " + e)
    }

    log("ERROR: Binary file write failed for " + filepath)
    return false
  }

  // DJI flight controller waypoint paths to scan
  readonly property var djiWaypointPaths: [
    // QField running on the DJI RC itself
    "/sdcard/Android/data/dji.go.v5/files/waypoint",
    // Common USB OTG mount points on Android
    "/storage/usbotg/Android/data/dji.go.v5/files/waypoint",
    "/mnt/media_rw/usbotg/Android/data/dji.go.v5/files/waypoint"
  ]

  function copyToFlightController() {
    if (!lastKmzPath) {
      mainWindow.displayToast(qsTr('No flightplan generated yet'))
      return
    }

    log("Attempting to export KMZ to flight controller...")

    // Strategy 1: Open DroneTM Transfer app via deeplink.
    // The transfer app handles MTP/SAF to write onto the DJI controller.
    try {
      var fileUri = "file://" + lastKmzPath
      var deeplink = "dronetm://transfer?file=" + encodeURIComponent(fileUri)
      log("Trying DroneTM Transfer deeplink: " + deeplink)
      Qt.openUrlExternally(deeplink)
      mainWindow.displayToast(qsTr('Opening DroneTM Transfer...'))
      flightplanDialog.resultMessage = qsTr('Sent to DroneTM Transfer app. Follow the steps there to complete the transfer.')
      return
    } catch (e) {
      log("DroneTM Transfer deeplink failed: " + e)
    }

    // Strategy 2: Direct filesystem write (works when QField runs on the DJI
    // RC itself or the controller is mounted with relaxed scoped-storage).
    if (lastKmzData && _tryDirectCopyToController()) {
      return
    }

    // Strategy 3: Platform file-picker (Android SAF folder picker).
    try {
      if (typeof platformUtilities !== 'undefined' && platformUtilities.exportDatasetTo) {
        log("Opening file picker via platformUtilities.exportDatasetTo")
        platformUtilities.exportDatasetTo(lastKmzPath)
        mainWindow.displayToast(qsTr('Choose a location to save the KMZ'))
        flightplanDialog.generationState = "manual_transfer"
        flightplanDialog.resultMessage = qsTr('Save the KMZ file, then copy it to your controller')
        return
      }
    } catch (e) {
      log("platformUtilities.exportDatasetTo failed: " + e)
    }

    // No method worked
    log("Could not export KMZ via any method")
    mainWindow.displayToast(
      qsTr('DJI controller not found - see transfer options below')
    )
    flightplanDialog.generationState = "transfer_failed"
    flightplanDialog.resultMessage = qsTr(
      'Could not find DJI controller storage. The KMZ is saved in the project flightplans/ folder.\n\n' +
      'Install the DroneTM Transfer app for reliable USB transfer.'
    )
  }

  function _tryDirectCopyToController() {
    // Scan for DJI waypoint directory and write directly.
    // This may fail on modern Android due to scoped storage restrictions.
    for (var p = 0; p < djiWaypointPaths.length; p++) {
      var basePath = djiWaypointPaths[p]
      var uuids = listDirectory(basePath)
      if (uuids.length > 0) {
        var uuid = uuids[0]
        var targetPath = basePath + "/" + uuid + "/" + uuid + ".kmz"
        log("Found DJI waypoint dir: " + basePath + ", UUID: " + uuid)

        if (saveBinaryFile(targetPath, lastKmzData)) {
          mainWindow.displayToast(qsTr('Copied to flight controller'))
          flightplanDialog.resultMessage = qsTr('Copied to flight controller')
          log("KMZ copied to: " + targetPath)
          return true
        }
      }
    }

    // Also try scanning /storage/ for USB volumes
    var storageVolumes = listDirectory("/storage")
    for (var v = 0; v < storageVolumes.length; v++) {
      var vol = storageVolumes[v]
      if (vol === "emulated" || vol === "self") continue

      var volWaypointPath = "/storage/" + vol + "/Android/data/dji.go.v5/files/waypoint"
      var volUuids = listDirectory(volWaypointPath)
      if (volUuids.length > 0) {
        var volUuid = volUuids[0]
        var volTarget = volWaypointPath + "/" + volUuid + "/" + volUuid + ".kmz"
        log("Found DJI waypoint on USB volume: " + vol + ", UUID: " + volUuid)

        if (saveBinaryFile(volTarget, lastKmzData)) {
          mainWindow.displayToast(qsTr('Copied to flight controller'))
          flightplanDialog.resultMessage = qsTr('Copied to flight controller')
          log("KMZ copied to: " + volTarget)
          return true
        }
      }
    }

    return false
  }

  function listDirectory(path) {
    // Try to list directory contents using XHR GET on file:// URL
    // Returns array of entry names, or empty array on failure
    var entries = []
    try {
      var xhr = new XMLHttpRequest()
      xhr.open("GET", "file://" + path, false)
      xhr.send()
      if (xhr.status === 200 || xhr.status === 0) {
        var text = xhr.responseText
        if (text) {
          // Directory listing format varies - try to parse entries
          // On Android file:// GET may return raw content or fail
          var lines = text.split('\n')
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim()
            if (line.length > 0 && line !== "." && line !== "..") {
              entries.push(line)
            }
          }
        }
      }
    } catch (e) {
      // Silently fail - directory may not exist
    }
    return entries
  }
}
