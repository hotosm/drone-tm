import QtQuick
import QtQuick.Controls
import org.qfield
import org.qgis
import Theme

import "plugin"
import "plugin/flightplan/core.js" as Flightplan
import "plugin/flightplan/drone_specs.js" as Specs
import "plugin/output/dji.js" as DjiOutput
import "plugin/output/kmz.js" as Kmz
import "plugin/output/potensic_v2.js" as PotensicV2Output

Item {
  id: plugin

  property var mainWindow: iface.mainWindow()
  property var mapCanvas: iface.mapCanvas()
  property var geometryHighlighter: iface.findItemByObjectName('geometryHighlighter')

  property var taskLayer: null
  property var flightplanResult: null
  property string lastKmzPath: ""
  property var lastKmzData: null

  // Last generated flightpath LineString geojson (workspace/flightpaths/...).
  // Stashed here so _loadFlightplanLayer can add it as a second layer without
  // needing extra arguments through _outputDji / _outputPotensicV2.
  property string lastPathGeojsonPath: ""

  // Potensic Atom 2 output state
  property string lastPotensicZipPath: ""
  property var lastPotensicZipData: null
  property string lastPotensicGlobalJson: ""
  property string lastPotensicMissionJson: ""
  property string lastPotensicMissionDirName: ""
  property string lastPotensicTsSubDir: ""

  // Last generated drone type (persists until next generation, used by export logic)
  property string lastDroneType: ""

  // Takeoff point state
  property var takeoffPoint: null  // {lon, lat} or null
  property bool placingTakeoff: false
  property var positionSource: iface.findItemByObjectName('positionSource')

  // --- Toolbar Button ---
  QfToolButton {
    id: dronetmButton
    iconSource: 'plugin/dronetm.svg'
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

  Component.onCompleted: {
    iface.addItemToPluginsToolbar(dronetmButton)
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

    onExportToDeviceRequested: {
      exportFlightplanToDevice()
    }

    onExportToDjiMissionRequested: function(missionId) {
      exportDjiMissionToDevice(missionId)
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

  // --- Takeoff placement overlay: crosshair + confirm button ---
  Item {
    id: takeoffPlacementOverlay
    visible: plugin.placingTakeoff
    parent: iface.mainWindow().contentItem
    anchors.fill: parent
    z: 1000

    Rectangle {
      anchors.top: parent.top
      anchors.left: parent.left
      anchors.right: parent.right
      height: 56
      color: Qt.rgba(0, 0, 0, 0.75)

      Label {
        anchors.centerIn: parent
        text: qsTr("Pan map to takeoff location")
        color: "white"
        font.pixelSize: Theme.defaultFont.pixelSize
      }
    }

    Rectangle {
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.verticalCenter: parent.verticalCenter
      width: 2
      height: 36
      color: "#C53639"
    }
    Rectangle {
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.verticalCenter: parent.verticalCenter
      width: 36
      height: 2
      color: "#C53639"
    }

    Row {
      anchors.bottom: parent.bottom
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottomMargin: 96
      spacing: 16

      QfButton {
        text: qsTr("Cancel")
        onClicked: {
          plugin.placingTakeoff = false
          flightplanDialog.open()
        }
      }

      QfButton {
        text: qsTr("Set Here")
        bgcolor: "#C53639"
        onClicked: plugin.confirmMapTakeoff()
      }
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
  }

  function confirmMapTakeoff() {
    placingTakeoff = false
    var center = mapCanvas.mapSettings.center
    var wgs84Crs = CoordinateReferenceSystemUtils.fromDescription("EPSG:4326")
    var mapCrs = mapCanvas.mapSettings.destinationCrs
    var projected = GeometryUtils.reprojectPoint(
      GeometryUtils.point(center.x, center.y), mapCrs, wgs84Crs
    )
    takeoffPoint = { lon: projected.x, lat: projected.y }
    flightplanDialog.takeoffPoint = takeoffPoint
    mainWindow.displayToast(qsTr('Takeoff point set'))
    flightplanDialog.populateTaskList()
    flightplanDialog.open()
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
    var droneType = config.droneType || "DJI_MINI_4_PRO"
    lastDroneType = droneType
    flightplanDialog.lastDroneType = droneType

    // GeoJSONs live under workspace/ so operators only see the
    // drone-specific output dirs (flightplans_dji, flightplans_potensic2)
    // when browsing the project folder. platformUtilities.createDir is
    // non-recursive (QDir::mkdir), so create the parent first.
    var geojsonDir = qgisProject.homePath + '/workspace/flightplans'
    var pathDir = qgisProject.homePath + '/workspace/flightpaths'
    platformUtilities.createDir(qgisProject.homePath, 'workspace')
    platformUtilities.createDir(qgisProject.homePath + '/workspace', 'flightplans')
    platformUtilities.createDir(qgisProject.homePath + '/workspace', 'flightpaths')

    var timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    var filename = 'task_' + taskId + '_' + timestamp

    var geojsonStr = JSON.stringify(placemarks, null, 2)
    var geojsonPath = geojsonDir + '/' + filename + '.geojson'
    var geojsonOk = saveTextFile(geojsonPath, geojsonStr)
    // Sidecar style: QgsVectorLayer ctor defaults to loadDefaultStyle=true,
    // which auto-applies a same-basename .qml next to the data file. This is
    // the only path to runtime styling - QGIS loadNamedStyle() is not
    // Q_INVOKABLE and no QField helper re-exposes it.
    _writeStyleSidecar('point-markers', geojsonPath)

    // Build + save the flight-path LineString visualisation. linestring.qml
    // places its "takeoff" SVG marker at the first vertex, so vertex 0 must
    // be the takeoff point when one is set.
    var pathFc = _buildFlightpathGeojson(placemarks, config.takeoffPoint)
    var pathGeojsonPath = pathDir + '/' + filename + '.geojson'
    if (saveTextFile(pathGeojsonPath, JSON.stringify(pathFc, null, 2))) {
      _writeStyleSidecar('linestring', pathGeojsonPath)
      lastPathGeojsonPath = pathGeojsonPath
    } else {
      lastPathGeojsonPath = ""
    }

    if (droneType === "POTENSIC_ATOM_2") {
      var potensicDir = qgisProject.homePath + '/flightplans_potensic2'
      platformUtilities.createDir(qgisProject.homePath, 'flightplans_potensic2')
      log("Saving Potensic files to " + potensicDir)
      _outputPotensicV2(placemarks, filename, potensicDir, geojsonPath, geojsonOk, taskId)
    } else {
      var djiDir = qgisProject.homePath + '/flightplans_dji'
      platformUtilities.createDir(qgisProject.homePath, 'flightplans_dji')
      log("Saving DJI files to " + djiDir)
      _outputDji(placemarks, filename, djiDir, geojsonPath, geojsonOk, taskId)
    }
  }

  function _outputDji(placemarks, filename, outputDir, geojsonPath, geojsonOk, taskId) {
    var globalHeight = 100
    if (placemarks.features.length > 0) {
      var firstCoords = placemarks.features[0].geometry.coordinates
      if (firstCoords.length > 2) globalHeight = firstCoords[2]
    }

    var wpmlXml = DjiOutput.createWpml(placemarks, globalHeight)
    var wpmlPath = outputDir + '/' + filename + '.wpml'
    var kmzPath  = outputDir + '/' + filename + '.kmz'

    var wpmlOk = saveTextFile(wpmlPath, wpmlXml)

    try {
      var kmzData = Kmz.createKmz(wpmlXml)
      // Cache bytes in memory immediately - controller copy uses these directly,
      // so a flaky local write/verify must not hide the copy button
      lastKmzData = kmzData

      var writeOk = saveBinaryFile(kmzPath, kmzData)
      if (writeOk) {
        var verifyResult = _verifyZipFile(kmzPath, kmzData.byteLength)
        if (verifyResult === false) {
          log("KMZ on disk failed verify - file may be corrupt, in-memory copy still usable")
        }
        lastKmzPath = kmzPath
        log("KMZ saved: " + kmzPath + " (" + kmzData.byteLength + " bytes)" +
            (verifyResult === null ? " (verify inconclusive)" : ""))
      }
    } catch (e) {
      log("KMZ creation error: " + e)
    }

    if (geojsonOk && wpmlOk) {
      var msg = qsTr('Saved: %1').arg(filename)
      mainWindow.displayToast(msg)
      flightplanDialog.generationState = "done"
      flightplanDialog.resultMessage = msg
      flightplanDialog.kmzAvailable = (lastKmzData !== null)
      flightplanDialog.scrollToBottom()
      _loadFlightplanLayer(geojsonPath, taskId)
    } else {
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

  function _outputPotensicV2(placemarks, filename, outputDir, geojsonPath, geojsonOk, taskId) {
    var defaultSpeed = 11.5
    if (placemarks.features.length > 0) {
      var s = placemarks.features[0].properties.speed
      if (s) defaultSpeed = s
    }

    var tsMs = Date.now()
    var potensic
    try {
      potensic = PotensicV2Output.createPotensicZip(placemarks, defaultSpeed, tsMs)
    } catch (e) {
      log("Potensic V2 ZIP creation error: " + e)
      flightplanDialog.generationState = "error"
      flightplanDialog.resultMessage = qsTr('Flightplan generation failed: %1').arg(e)
      return
    }

    // Save JSON files as text - this is the reliable cross-platform write.
    // Binary XHR PUT (used for the zip) silently fails on Windows desktop.
    var tsStr = String(tsMs)
    var tsSubDir = outputDir + '/' + tsStr
    platformUtilities.createDir(outputDir, tsStr)
    var globalOk  = saveTextFile(tsSubDir + '/global.json', potensic.globalJson)
    var missionOk = saveTextFile(tsSubDir + '/' + tsStr + '.json', potensic.missionJson)
    var jsonFilesOk = globalOk && missionOk

    // Also save zip for file-picker export. Use FileUtils first (Android-safe), then
    // verify the write by reading back the magic bytes - XHR PUT silently corrupts
    // binary files on Android 11+ scoped storage, so we can't trust the return value alone.
    var zipPath = outputDir + '/' + filename + '.zip'
    var zipOk = saveBinaryFile(zipPath, potensic.zipData)
    if (zipOk) {
      var zipVerify = _verifyZipFile(zipPath, potensic.zipData.byteLength)
      // null = inconclusive read-back, trust the write; false = positively bad
      if (zipVerify === false) {
        log("Potensic zip failed read-back sanity check - treating as failed write")
        zipOk = false
      }
    }
    if (!zipOk) log("Potensic zip write failed (expected on Windows desktop) - JSON files used instead")

    if (geojsonOk && jsonFilesOk) {
      lastPotensicZipPath = zipOk ? zipPath : ""
      lastPotensicZipData = potensic.zipData
      lastPotensicGlobalJson = potensic.globalJson
      lastPotensicMissionJson = potensic.missionJson
      lastPotensicMissionDirName = tsStr
      lastPotensicTsSubDir = tsSubDir

      var msg = qsTr('Saved: %1').arg(filename)
      mainWindow.displayToast(msg)
      flightplanDialog.generationState = "done"
      flightplanDialog.resultMessage = msg
      // kmzAvailable gates the Export button - JSON files are always the reliable output
      flightplanDialog.kmzAvailable = true
      flightplanDialog.scrollToBottom()
      _loadFlightplanLayer(geojsonPath, taskId)
    } else {
      log("Potensic file write failed")
      flightplanDialog.generationState = "error"
      flightplanDialog.resultMessage = qsTr('File write failed - check storage permissions')
      mainWindow.displayToast(qsTr('File write failed - check app storage permissions'))
    }
  }

  function _loadFlightplanLayer(geojsonPath, taskId) {
    // QgsProject::layerTreeRoot() is not Q_INVOKABLE / Q_PROPERTY in QGIS and QField
    // does not re-expose it, so layer tree grouping is not possible from a plugin.
    // The layer lands at the project root via ProjectUtils.addMapLayer.
    try {
      var vectorLayer = LayerUtils.loadVectorLayer(geojsonPath, 'waypoints_' + taskId)
      if (vectorLayer) {
        ProjectUtils.addMapLayer(qgisProject, vectorLayer)
        log("Waypoints layer added")
      }
    } catch (e) {
      log("Could not add waypoints layer: " + e)
    }

    if (lastPathGeojsonPath) {
      try {
        var pathLayer = LayerUtils.loadVectorLayer(lastPathGeojsonPath, 'flightpath_' + taskId)
        if (pathLayer) {
          ProjectUtils.addMapLayer(qgisProject, pathLayer)
          log("Flightpath layer added")
        }
      } catch (e) {
        log("Could not add flightpath layer: " + e)
      }
    }
  }

  // Build a single-feature FeatureCollection containing a LineString of
  // the waypoint sequence. When a takeoff point is set it becomes vertex 0
  // so linestring.qml's FirstVertex marker line places its SVG there.
  // Altitudes are dropped (2D path is what the visualisation needs).
  function _buildFlightpathGeojson(placemarks, takeoffPoint) {
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

  // Copy a project-bundled style (.qml) so it sits next to the geojson with
  // a matching basename. QgsVectorLayer's ctor picks this up automatically
  // via styleURI() -> {basename}.qml in the same directory.
  function _writeStyleSidecar(styleName, geojsonPath) {
    var srcPath = qgisProject.homePath + '/styles/' + styleName + '.qml'
    var content = _readTextFile(srcPath)
    if (!content) {
      log("Style sidecar skipped - could not read " + srcPath)
      return false
    }
    var dstPath = geojsonPath.replace(/\.geojson$/, '.qml')
    return saveTextFile(dstPath, content)
  }

  // Best-effort text read. XHR file:// works on Android/iOS in sync mode;
  // FileUtils is the QField-native fallback, restricted to paths inside the
  // project directory (which /styles/ always satisfies).
  function _readTextFile(filepath) {
    try {
      var xhr = new XMLHttpRequest()
      xhr.open("GET", "file://" + filepath, false)
      xhr.send()
      if ((xhr.status === 200 || xhr.status === 0) && xhr.responseText) {
        return xhr.responseText
      }
    } catch (e) {
      log("XHR text read failed for " + filepath + ": " + e)
    }
    try {
      if (typeof FileUtils !== 'undefined' && FileUtils.readFileContent) {
        var buf = FileUtils.readFileContent(filepath)
        if (typeof buf === 'string' && buf.length > 0) return buf
        if (buf && buf.byteLength > 0) {
          var view = new Uint8Array(buf)
          var s = ''
          for (var i = 0; i < view.length; i++) s += String.fromCharCode(view[i])
          return s
        }
      }
    } catch (e) {
      log("FileUtils text read failed: " + e)
    }
    return null
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
        if (FileUtils.writeFileContent) {
          var ok = FileUtils.writeFileContent(filepath, content)
          if (ok) {
            log("Saved via FileUtils.writeFileContent: " + filepath)
            return true
          }
          log("FileUtils.writeFileContent returned false for " + filepath)
        } else if (FileUtils.createFile) {
          var ok2 = FileUtils.createFile(filepath, content)
          if (ok2) {
            log("Saved via FileUtils.createFile: " + filepath)
            return true
          }
          log("FileUtils.createFile returned false for " + filepath)
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
    // Method 1: FileUtils.writeFileContent - QField native, handles Android scoped storage correctly
    try {
      if (typeof FileUtils !== 'undefined' && FileUtils.writeFileContent) {
        var ok = FileUtils.writeFileContent(filepath, arrayBuffer)
        if (ok) {
          log("Binary saved via FileUtils.writeFileContent: " + filepath)
          return true
        }
        log("FileUtils.writeFileContent returned false for " + filepath)
      }
    } catch (e) {
      log("FileUtils.writeFileContent not available: " + e)
    }

    // Method 2: XHR PUT with ArrayBuffer (Qt 6 QML - partial support, flaky on Android 11+)
    try {
      var xhr = new XMLHttpRequest()
      xhr.open("PUT", "file://" + filepath, false)
      xhr.send(arrayBuffer)
      log("Binary saved via XHR PUT: " + filepath)
      return true
    } catch (e) {
      log("XHR PUT binary failed: " + e)
    }

    // Method 3: Triple-slash file URL
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

  // Verify a written ZIP/KMZ file by checking size and magic bytes (PK\x03\x04).
  // Returns true (verified good), false (positively bad), or null (inconclusive -
  // read-back not supported for this path). Callers should treat null as "trust
  // the write" since paths outside the QGIS project directory cannot be
  // introspected by QField's native FileUtils, and sync XMLHttpRequest cannot use
  // responseType="arraybuffer" (throws InvalidStateError per the W3C spec).
  function _verifyZipFile(filepath, expectedByteLength) {
    // Path 1: FileUtils - reliable, but isWithinProjectDirectory-gated. Returns
    // info.exists=false (with a warning) for paths outside the project dir.
    try {
      if (typeof FileUtils !== 'undefined' && FileUtils.getFileInfo) {
        var info = FileUtils.getFileInfo(filepath)
        if (info && info.exists === true) {
          if (info.fileSize !== undefined && info.fileSize !== expectedByteLength) {
            log("ZIP size mismatch via FileUtils: got " + info.fileSize +
                ", expected " + expectedByteLength)
            return false
          }
          if (FileUtils.readFileContent) {
            var buf = FileUtils.readFileContent(filepath)
            if (buf && buf.byteLength >= 4) {
              var view = new Uint8Array(buf)
              var valid = view[0] === 0x50 && view[1] === 0x4B &&
                          view[2] === 0x03 && view[3] === 0x04
              if (!valid) {
                log("ZIP magic bytes invalid via FileUtils: " + view[0] + " " +
                    view[1] + " " + view[2] + " " + view[3])
                return false
              }
              return true
            }
          }
          // Size matched but content not readable; size alone is enough signal.
          return true
        }
      }
    } catch (e) {
      log("ZIP verify via FileUtils failed: " + e)
    }

    // Path 2: sync XHR in text mode. Cannot use responseType="arraybuffer" on a
    // sync request (per spec, throws InvalidStateError). The ZIP magic
    // PK\x03\x04 = 0x50 0x4B 0x03 0x04 is entirely ASCII-safe so charCodeAt of
    // the response text is a faithful read of the first four bytes. Size check
    // is skipped because text decoding of binary content mangles the length.
    try {
      var xhr = new XMLHttpRequest()
      xhr.open("GET", "file://" + filepath, false)
      xhr.send()
      if (xhr.status !== 200 && xhr.status !== 0) {
        log("ZIP verify inconclusive: HTTP status " + xhr.status)
        return null
      }
      var text = xhr.responseText
      if (!text || text.length < 4) {
        log("ZIP verify inconclusive: empty read-back")
        return null
      }
      var ok = text.charCodeAt(0) === 0x50 && text.charCodeAt(1) === 0x4B &&
               text.charCodeAt(2) === 0x03 && text.charCodeAt(3) === 0x04
      if (!ok) {
        log("ZIP magic bytes invalid via XHR: " + text.charCodeAt(0) + " " +
            text.charCodeAt(1) + " " + text.charCodeAt(2) + " " +
            text.charCodeAt(3))
        return false
      }
      return true
    } catch (e) {
      log("ZIP verify inconclusive: " + e)
      return null
    }
  }

  function exportFlightplanToDevice() {
    if (lastDroneType === "POTENSIC_ATOM_2") {
      _exportPotensicToDevice()
      return
    }

    // DJI: export KMZ
    if (!lastKmzPath) {
      mainWindow.displayToast(qsTr('No flightplan generated yet'))
      return
    }
    try {
      if (typeof platformUtilities !== 'undefined' && platformUtilities.exportDatasetTo) {
        platformUtilities.exportDatasetTo(lastKmzPath)
        mainWindow.displayToast(qsTr('Choose a location to save the file'))
        flightplanDialog.generationState = "manual_transfer"
        flightplanDialog.resultMessage = qsTr('Save the KMZ file, then copy it to your controller')
        return
      }
    } catch (e) {
      log("exportDatasetTo failed: " + e)
    }
    mainWindow.displayToast(qsTr('File picker not available on this device'))
  }

  function exportDjiMissionToDevice(missionId) {
    if (!lastKmzData) {
      mainWindow.displayToast(qsTr('No flightplan generated yet'))
      return
    }

    var normalizedMissionId = _normalizeDjiMissionId(missionId)
    if (!normalizedMissionId) {
      mainWindow.displayToast(qsTr('Paste the DJI waypoint folder name first'))
      return
    }

    var outputDir = qgisProject.homePath + '/flightplans_dji'
    platformUtilities.createDir(qgisProject.homePath, 'flightplans_dji')
    var missionKmzPath = outputDir + '/' + normalizedMissionId + '.kmz'

    if (missionKmzPath !== lastKmzPath) {
      if (!saveBinaryFile(missionKmzPath, lastKmzData)) {
        mainWindow.displayToast(qsTr('Could not create DJI-named KMZ'))
        return
      }
      if (_verifyZipFile(missionKmzPath, lastKmzData.byteLength) === false) {
        mainWindow.displayToast(qsTr('DJI-named KMZ failed verification'))
        return
      }
      log("Prepared DJI mission KMZ: " + missionKmzPath)
    }

    // Stash UUID on clipboard so the user can paste it into the picker's
    // search/filename box - the SAF picker doesn't preserve filename hints
    // across folder navigation on every Android version.
    try {
      platformUtilities.copyTextToClipboard(normalizedMissionId)
    } catch (e) {
      log("Clipboard copy of mission id failed: " + e)
    }

    // Set the post-picker help text BEFORE opening the picker - exportDatasetTo
    // returns synchronously but the picker may steal focus immediately, so any
    // state we set after the call may not paint until the user returns.
    flightplanDialog.generationState = "manual_transfer"
    flightplanDialog.resultMessage = qsTr(
      'Mission ID copied to clipboard: %1 - save into the matching waypoint folder.'
    ).arg(normalizedMissionId)

    try {
      if (typeof platformUtilities !== 'undefined' && platformUtilities.exportDatasetTo) {
        platformUtilities.exportDatasetTo(missionKmzPath)
        mainWindow.displayToast(qsTr('Save into the waypoint folder named %1').arg(normalizedMissionId))
        return
      }
    } catch (e) {
      log("exportDatasetTo (DJI mission) failed: " + e)
    }

    mainWindow.displayToast(qsTr('File picker not available on this device'))
  }

  function _normalizeDjiMissionId(missionId) {
    var value = String(missionId || "").trim()
    if (!value) return ""

    value = value.replace(/\\/g, "/")
    var slashIdx = value.lastIndexOf("/")
    if (slashIdx >= 0) value = value.substring(slashIdx + 1)

    if (value.length > 4 && value.toLowerCase().lastIndexOf(".kmz") === value.length - 4) {
      value = value.substring(0, value.length - 4)
    }
    value = value.trim()

    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      log("Invalid DJI mission id: " + missionId)
      return ""
    }

    return value
  }

  function _exportPotensicToDevice() {
    if (!lastPotensicGlobalJson) {
      mainWindow.displayToast(qsTr('No flightplan generated yet'))
      return
    }

    // Primary: export the mission folder - avoids ZIP binary corruption on Android 11+
    // scoped storage.  The folder contains global.json + mission JSON, which is what
    // the Potensic Eve app reads directly.
    try {
      if (typeof platformUtilities !== 'undefined' && platformUtilities.exportFolderTo
          && lastPotensicTsSubDir) {
        platformUtilities.exportFolderTo(lastPotensicTsSubDir)
        mainWindow.displayToast(qsTr('Choose a location to save the mission folder'))
        flightplanDialog.generationState = "manual_transfer"
        flightplanDialog.resultMessage = qsTr('Save the folder, then copy its contents to the Potensic waypoint folder')
        return
      }
    } catch (e) {
      log("exportFolderTo not available: " + e)
    }

    // Fallback: export verified ZIP (sanity-checked after write, so not corrupt)
    if (lastPotensicZipPath) {
      try {
        if (typeof platformUtilities !== 'undefined' && platformUtilities.exportDatasetTo) {
          platformUtilities.exportDatasetTo(lastPotensicZipPath)
          mainWindow.displayToast(qsTr('Choose a location to save the ZIP'))
          flightplanDialog.generationState = "manual_transfer"
          flightplanDialog.resultMessage = qsTr('Save the zip, then copy its contents to the Potensic waypoint folder')
          return
        }
      } catch (e) {
        log("exportDatasetTo (zip) failed: " + e)
      }
    }

    // Last resort: point user at the saved JSON files
    mainWindow.displayToast(qsTr('File picker not available'))
    flightplanDialog.generationState = "manual_transfer"
    flightplanDialog.resultMessage = qsTr('Find mission files in flightplans_potensic2/%1/ in the project folder').arg(lastPotensicMissionDirName)
  }

}
