// Single-file build of the DroneTM QField plugin.
//
// Demo-only merge of main.qml + FlightplanDialog.qml so the plugin survives
// QFieldSync / libqfieldsync packaging (which only ships the project's
// matching `<basename>.qml` and drops every sibling QML type).  The JS modules
// in generate/ and output/ still live alongside this file - if you also need
// those inlined, that's a follow-up refactor.
//
// To deploy: rename this file to `<project_basename>.qml` (so it matches the
// .qgs filename) and drop it next to the .qgs in the QFieldCloud project.

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import org.qfield
import org.qgis
import Theme

import "generate/core.js" as Flightplan
import "generate/drone_specs.js" as Specs
import "output/dji.js" as DjiOutput
import "output/kmz.js" as Kmz
import "output/potensic_v2.js" as PotensicV2Output

Item {
  id: plugin

  property var mainWindow: iface.mainWindow()
  property var mapCanvas: iface.mapCanvas()
  property var geometryHighlighter: iface.findItemByObjectName('geometryHighlighter')

  property var taskLayer: null
  property var flightplanResult: null
  property string lastKmzPath: ""
  property var lastKmzData: null

  property string lastPathGeojsonPath: ""

  // Potensic Atom 2 output state
  property string lastPotensicZipPath: ""
  property var lastPotensicZipData: null
  property string lastPotensicGlobalJson: ""
  property string lastPotensicMissionJson: ""
  property string lastPotensicMissionDirName: ""
  property string lastPotensicTsSubDir: ""

  property string lastDroneType: ""

  property var djiPickerResourceSource: null

  Connections {
    target: plugin.djiPickerResourceSource
    function onResourceReceived(path) {
      handleDjiFilePicked(path)
    }
  }

  property var takeoffPoint: null
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

  Component.onCompleted: {
    iface.addItemToPluginsToolbar(dronetmButton)
    findTaskLayer()
    log("DroneTM plugin loaded. taskLayer=" + (taskLayer ? taskLayer.name : "null"))
    discoverPointHandler()
  }

  // --- Flightplan Configuration Dialog (inlined from FlightplanDialog.qml) ---
  QfDialog {
    id: flightplanDialog

    // Bound to plugin state so any change in the outer Item flows in.
    property var taskLayer: plugin.taskLayer
    property var taskIds: []

    property int droneTypeIndex: 0
    property int gimbalAngleIndex: 0
    property int flightModeIndex: 0
    property bool autoRotation: true
    property int rotationAngle: 0

    property real forwardOverlap: 75
    property real sideOverlap: 75
    property real altitude: 0
    property real gsd: 3.5
    property bool useGsd: true

    property var takeoffPoint: plugin.takeoffPoint

    property string generationState: "idle"
    property string resultMessage: ""
    property bool kmzAvailable: false
    property string lastDroneType: ""
    property string djiMissionId: ""

    parent: iface.mainWindow().contentItem
    width: Math.min(parent.width * 0.9, 400)
    height: Math.min(parent.height * 0.85, 500)
    x: (parent.width - width) / 2
    y: (parent.height - height) / 2
    title: qsTr("Generate Flightplan")

    standardButtons: Dialog.NoButton
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside

    header: Rectangle {
      height: 48
      color: "transparent"

      Label {
        text: flightplanDialog.title
        font.bold: true
        font.pixelSize: Theme.defaultFont.pixelSize * 1.2
        color: Theme.mainTextColor
        anchors.left: parent.left
        anchors.leftMargin: 16
        anchors.verticalCenter: parent.verticalCenter
      }

      Rectangle {
        width: 36
        height: 36
        radius: 18
        anchors.right: parent.right
        anchors.rightMargin: 8
        anchors.verticalCenter: parent.verticalCenter
        color: closeArea.pressed ? Theme.mainTextDisabledColor : "transparent"

        Label {
          anchors.centerIn: parent
          text: "✕"
          font.pixelSize: Theme.defaultFont.pixelSize * 1.3
          color: Theme.mainTextColor
        }

        MouseArea {
          id: closeArea
          anchors.fill: parent
          onClicked: flightplanDialog.close()
        }
      }

      Rectangle {
        anchors.bottom: parent.bottom
        width: parent.width
        height: 1
        color: Theme.mainTextDisabledColor
      }
    }

    function scrollToBottom() {
      scrollTimer.start();
    }

    Timer {
      id: scrollTimer
      interval: 100
      repeat: false
      onTriggered: {
        var maxY = formFlickable.contentHeight - formFlickable.height;
        if (maxY > 0) {
          formFlickable.contentY = maxY;
        }
      }
    }

    contentItem: Flickable {
      id: formFlickable
      clip: true
      contentHeight: formColumn.height
      flickableDirection: Flickable.VerticalFlick

      ColumnLayout {
        id: formColumn
        width: parent.width
        spacing: 12

        // --- Task Selection ---
        Label {
          text: qsTr("Task")
          font.bold: true
          font.pixelSize: Theme.defaultFont.pixelSize * 1.1
          color: Theme.mainTextColor
        }
        ComboBox {
          id: taskCombo
          Layout.fillWidth: true
          model: flightplanDialog.taskIds
        }

        Rectangle {
          Layout.fillWidth: true
          Layout.preferredHeight: 1
          color: Theme.mainTextDisabledColor
        }

        // --- Takeoff Point ---
        Label {
          text: qsTr("Takeoff Point")
          font.bold: true
          font.pixelSize: Theme.defaultFont.pixelSize * 1.1
          color: Theme.mainTextColor
        }

        RowLayout {
          Layout.fillWidth: true
          spacing: 8

          QfButton {
            Layout.fillWidth: true
            text: qsTr("Use GPS")
            onClicked: plugin.setTakeoffFromGps()
          }

          QfButton {
            Layout.fillWidth: true
            text: qsTr("Place on Map")
            onClicked: plugin.setTakeoffFromMap()
          }
        }

        Label {
          text: {
            if (flightplanDialog.takeoffPoint) {
              return qsTr("Takeoff: %1, %2")
                .arg(flightplanDialog.takeoffPoint.lon.toFixed(6))
                .arg(flightplanDialog.takeoffPoint.lat.toFixed(6))
            }
            return qsTr("Not set - will use first waypoint")
          }
          font.pixelSize: Theme.defaultFont.pixelSize * 0.9
          font.italic: true
          color: flightplanDialog.takeoffPoint ? Theme.mainTextColor : Theme.mainTextDisabledColor
          wrapMode: Text.WordWrap
          Layout.fillWidth: true

          MouseArea {
            anchors.fill: parent
            visible: flightplanDialog.takeoffPoint !== null
            cursorShape: Qt.PointingHandCursor
            onClicked: plugin.takeoffPoint = null
          }

          Label {
            visible: flightplanDialog.takeoffPoint !== null
            anchors.right: parent.right
            text: qsTr("Clear")
            font.pixelSize: Theme.defaultFont.pixelSize * 0.85
            font.underline: true
            color: "#C53639"

            MouseArea {
              anchors.fill: parent
              onClicked: plugin.takeoffPoint = null
            }
          }
        }

        Rectangle {
          Layout.fillWidth: true
          Layout.preferredHeight: 1
          color: Theme.mainTextDisabledColor
        }

        // --- Drone Model ---
        Label {
          text: qsTr("Drone Model")
          font: Theme.defaultFont
          color: Theme.mainTextColor
        }
        ComboBox {
          id: droneTypeCombo
          Layout.fillWidth: true
          model: ["DJI Mini 4 Pro", "DJI Air 3", "DJI Mini 5 Pro", "Potensic Atom 1", "Potensic Atom 2"]
          currentIndex: flightplanDialog.droneTypeIndex
          onCurrentIndexChanged: flightplanDialog.droneTypeIndex = currentIndex
        }

        // --- Gimbal Angle ---
        Label {
          text: qsTr("Gimbal Angle")
          font: Theme.defaultFont
          color: Theme.mainTextColor
        }
        ComboBox {
          id: gimbalAngleCombo
          Layout.fillWidth: true
          model: ["Off-Nadir (-80°)", "Nadir (-90°)", "Oblique (-45°)"]
          currentIndex: flightplanDialog.gimbalAngleIndex
          onCurrentIndexChanged: flightplanDialog.gimbalAngleIndex = currentIndex
        }

        // --- DEM Layer ---
        Label {
          text: qsTr("DEM Layer (optional)")
          font: Theme.defaultFont
          color: Theme.mainTextColor
        }
        ComboBox {
          id: demLayerCombo
          Layout.fillWidth: true
          model: ["None"]
          onCurrentIndexChanged: flightplanDialog.updateFlightModeOptions()
        }

        // --- Flight Mode ---
        Label {
          text: qsTr("Flight Mode")
          font: Theme.defaultFont
          color: Theme.mainTextColor
        }
        ComboBox {
          id: flightModeCombo
          Layout.fillWidth: true
          model: ["Waypoints"]
          currentIndex: 0
        }

        // --- Grid Rotation ---
        Label {
          text: qsTr("Grid Rotation")
          font: Theme.defaultFont
          color: Theme.mainTextColor
        }

        RowLayout {
          Layout.fillWidth: true
          spacing: 8

          CheckBox {
            id: autoRotationCheck
            text: qsTr("Auto")
            checked: flightplanDialog.autoRotation
            onCheckedChanged: flightplanDialog.autoRotation = checked
          }

          SpinBox {
            id: rotationSpinBox
            Layout.fillWidth: true
            from: 0
            to: 359
            stepSize: 5
            value: flightplanDialog.rotationAngle
            enabled: !autoRotationCheck.checked
            opacity: enabled ? 1.0 : 0.4
            onValueModified: flightplanDialog.rotationAngle = value
            textFromValue: function(value) { return value + "°" }
            valueFromText: function(text) { return parseInt(text) || 0 }
          }
        }

        Rectangle {
          Layout.fillWidth: true
          Layout.preferredHeight: 1
          color: Theme.mainTextDisabledColor
        }
        Label {
          text: {
            if (flightplanDialog.useGsd) {
              return qsTr("GSD: %1 cm/px | Overlap: %2/%3%")
                .arg(flightplanDialog.gsd).arg(flightplanDialog.forwardOverlap).arg(flightplanDialog.sideOverlap)
            } else {
              return qsTr("Altitude: %1m AGL | Overlap: %2/%3%")
                .arg(flightplanDialog.altitude).arg(flightplanDialog.forwardOverlap).arg(flightplanDialog.sideOverlap)
            }
          }
          font.pixelSize: Theme.defaultFont.pixelSize * 0.9
          font.italic: true
          color: Theme.mainTextDisabledColor
          wrapMode: Text.WordWrap
          Layout.fillWidth: true
        }

        Item { Layout.preferredHeight: 8 }

        // --- Generate Button ---
        QfButton {
          id: generateButton
          Layout.fillWidth: true
          text: qsTr("Generate Flightplan")
          bgcolor: "#C53639"
          enabled: taskCombo.currentIndex >= 0 && taskCombo.count > 0

          onClicked: {
            var droneTypes = ["DJI_MINI_4_PRO", "DJI_AIR_3", "DJI_MINI_5_PRO", "POTENSIC_ATOM_1", "POTENSIC_ATOM_2"];
            var gimbalAngles = ["-80", "-90", "-45"];

            var hasDem = demLayerCombo.currentIndex > 0;
            var flightMode;
            if (hasDem) {
              flightMode = (flightModeCombo.currentIndex === 0) ? "waylines" : "waypoints";
            } else {
              flightMode = "waypoints";
            }

            var config = {
              taskId: taskCombo.currentText,
              droneType: droneTypes[droneTypeCombo.currentIndex],
              gimbalAngle: gimbalAngles[gimbalAngleCombo.currentIndex],
              flightMode: flightMode,
              forwardOverlap: flightplanDialog.forwardOverlap,
              sideOverlap: flightplanDialog.sideOverlap,
              agl: flightplanDialog.useGsd ? null : flightplanDialog.altitude,
              gsd: flightplanDialog.useGsd ? flightplanDialog.gsd : null,
              demLayer: hasDem ? demLayerCombo.currentText : null,
              takeoffPoint: flightplanDialog.takeoffPoint,
              rotationAngle: autoRotationCheck.checked ? 0 : rotationSpinBox.value,
              autoRotation: autoRotationCheck.checked
            };

            flightplanDialog.saveSettings();
            flightplanDialog.generationState = "idle";
            flightplanDialog.resultMessage = "";
            plugin.generateFlightplan(config);
          }
        }

        Label {
          visible: flightplanDialog.generationState !== "idle"
          text: flightplanDialog.resultMessage
          font.pixelSize: Theme.defaultFont.pixelSize * 0.9
          color: flightplanDialog.generationState === "error" ? "#C53639" : Theme.mainTextColor
          wrapMode: Text.WordWrap
          Layout.fillWidth: true
        }

        // --- File write failure help ---
        Label {
          visible: flightplanDialog.generationState === "error"
          text: flightplanDialog.lastDroneType === "POTENSIC_ATOM_2"
            ? qsTr("File write failed. Mission JSON files may still be saved in flightplans_potensic2/ in the project folder.\n\n" +
                "To transfer manually, connect your phone via USB and copy global.json and the timestamped .json into:\n" +
                "Android/data/com.ipotensic.atom/files/Waypoint/<mission-id>/")
            : qsTr("The WPML has been copied to your clipboard. To get the flightplan to your drone:\n\n" +
                "1. Paste clipboard into a new file named <task>.wpml using a text editor\n" +
                "2. Use a file manager app to copy the .kmz or .wpml from this project's flightplans_dji/ folder to the DJI controller storage\n" +
                "3. Or transfer later via the DroneTM web app (requires internet) using ADB Web transfer\n\n" +
                "Files are saved to: flightplans_dji/ in the QField project directory")
          font.pixelSize: Theme.defaultFont.pixelSize * 0.8
          wrapMode: Text.WordWrap
          Layout.fillWidth: true
        }

        // --- Manual transfer help (file picker was used) ---
        Label {
          visible: flightplanDialog.generationState === "manual_transfer"
          text: flightplanDialog.lastDroneType === "POTENSIC_ATOM_2"
            ? qsTr("A file picker was opened. To load the mission on your Potensic controller:\n\n" +
                "1. In the picker, browse to your controller (connect by USB if not visible)\n" +
                "2. Navigate to: Android/data/com.ipotensic.atom/files/Waypoint/<mission-id>/\n" +
                "3. Save the global.json and timestamped .json into that folder, overwriting any existing files\n\n" +
                "Tip: Create one test mission in Potensic Eve first so the Waypoint directory exists.")
            : qsTr("A file picker is open. To replace the mission on your DJI controller:\n\n" +
                "1. Navigate back to the waypoint folder you picked from:\n   Android/data/dji.go.v5/files/waypoint/%1/\n" +
                "2. Save the file - it will overwrite the existing %1.kmz\n" +
                "3. The filename is already set - do not rename it\n\n" +
                "The mission ID has been copied to your clipboard in case the picker's search needs it.").arg(flightplanDialog.djiMissionId || "<mission>")
          font.pixelSize: Theme.defaultFont.pixelSize * 0.8
          wrapMode: Text.WordWrap
          Layout.fillWidth: true
        }

        // --- DJI mission section ---
        Label {
          visible: flightplanDialog.kmzAvailable && flightplanDialog.lastDroneType !== "POTENSIC_ATOM_2"
          text: qsTr("DJI Mission")
          font: Theme.defaultFont
          color: Theme.mainTextColor
          Layout.fillWidth: true
        }

        QfButton {
          Layout.fillWidth: true
          visible: flightplanDialog.kmzAvailable && flightplanDialog.lastDroneType !== "POTENSIC_ATOM_2" && flightplanDialog.djiMissionId.length === 0
          text: qsTr("Select File to Replace")
          onClicked: plugin.selectDjiMissionFile()
        }

        Label {
          visible: flightplanDialog.kmzAvailable && flightplanDialog.lastDroneType !== "POTENSIC_ATOM_2" && flightplanDialog.djiMissionId.length === 0
          text: qsTr("Opens a file picker. Navigate to the DJI controller's waypoint folder (Android/data/dji.go.v5/files/waypoint/<mission>/) and pick any file inside - the filename is the mission ID. Stored after first pick.")
          font.pixelSize: Theme.defaultFont.pixelSize * 0.8
          color: Theme.secondaryTextColor
          wrapMode: Text.WordWrap
          Layout.fillWidth: true
        }

        RowLayout {
          Layout.fillWidth: true
          visible: flightplanDialog.kmzAvailable && flightplanDialog.lastDroneType !== "POTENSIC_ATOM_2" && flightplanDialog.djiMissionId.length > 0
          spacing: 8

          Label {
            Layout.fillWidth: true
            text: flightplanDialog.djiMissionId
            font: Theme.defaultFont
            color: Theme.mainTextColor
            elide: Text.ElideMiddle
          }

          Label {
            text: qsTr("Change")
            font.pixelSize: Theme.defaultFont.pixelSize * 0.85
            font.underline: true
            color: "#C53639"

            MouseArea {
              anchors.fill: parent
              cursorShape: Qt.PointingHandCursor
              onClicked: plugin.selectDjiMissionFile()
            }
          }
        }

        Label {
          visible: flightplanDialog.kmzAvailable && flightplanDialog.lastDroneType !== "POTENSIC_ATOM_2" && flightplanDialog.djiMissionId.length > 0
          text: qsTr("Mission ID captured from the controller file. Tap 'Change' to re-pick.")
          font.pixelSize: Theme.defaultFont.pixelSize * 0.8
          color: Theme.secondaryTextColor
          wrapMode: Text.WordWrap
          Layout.fillWidth: true
        }

        QfButton {
          Layout.fillWidth: true
          visible: flightplanDialog.kmzAvailable && (flightplanDialog.generationState === "done" || flightplanDialog.generationState === "manual_transfer")
          text: (flightplanDialog.lastDroneType !== "POTENSIC_ATOM_2" && flightplanDialog.djiMissionId.length > 0)
            ? qsTr("Copy Flightplan to Controller")
            : qsTr("Save to Device")

          onClicked: {
            if (flightplanDialog.lastDroneType !== "POTENSIC_ATOM_2" && flightplanDialog.djiMissionId.length > 0) {
              plugin.exportDjiMissionToDevice(flightplanDialog.djiMissionId);
            } else {
              plugin.exportFlightplanToDevice();
            }
          }
        }

        Label {
          visible: flightplanDialog.kmzAvailable && flightplanDialog.lastDroneType !== "POTENSIC_ATOM_2" && flightplanDialog.djiMissionId.length > 0 && flightplanDialog.generationState === "done"
          text: qsTr("Opens a file picker. Navigate back to the waypoint folder you picked from and save - it will replace the existing %1.kmz.").arg(flightplanDialog.djiMissionId)
          font.pixelSize: Theme.defaultFont.pixelSize * 0.8
          color: Theme.secondaryTextColor
          wrapMode: Text.WordWrap
          Layout.fillWidth: true
        }

        // --- Close Button ---
        QfButton {
          Layout.fillWidth: true
          visible: flightplanDialog.generationState !== "idle"
          text: qsTr("Close")

          onClicked: {
            flightplanDialog.close();
          }
        }
      }
    }

    function populateTaskList() {
      var ids = [];
      if (taskLayer) {
        iface.logMessage("DroneTM: Iterating task layer: " + taskLayer.name);

        var iterator = LayerUtils.createFeatureIteratorFromExpression(taskLayer, "TRUE");

        var count = 0;
        while (iterator && iterator.hasNext()) {
          var feature = iterator.next();
          count++;

          var fNames = feature.fields.names;
          var fieldName = null;
          if (fNames.indexOf("project_task_id") >= 0) fieldName = "project_task_id";
          else if (fNames.indexOf("task_id") >= 0) fieldName = "task_id";
          else if (fNames.indexOf("id") >= 0) fieldName = "id";

          if (fieldName) {
            var val = feature.attribute(fieldName);
            if (val !== undefined && val !== null) {
              ids.push(String(val));
            }
          }
        }
        if (iterator) iterator.close();

        iface.logMessage("DroneTM: Iterated " + count + " features, got " + ids.length + " task IDs");

        ids.sort(function(a, b) {
          var na = parseInt(a);
          var nb = parseInt(b);
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return a.localeCompare(b);
        });
      }
      taskIds = ids;
      iface.logMessage("DroneTM: Found " + ids.length + " tasks");
    }

    function updateFlightModeOptions() {
      var hasDem = demLayerCombo.currentIndex > 0;
      if (hasDem) {
        flightModeCombo.model = ["Waylines", "Waypoints"];
        flightModeCombo.currentIndex = (flightplanDialog.flightModeIndex < 2) ? flightplanDialog.flightModeIndex : 0;
      } else {
        flightModeCombo.model = ["Waypoints"];
        flightModeCombo.currentIndex = 0;
      }
    }

    function populateDemLayers() {
      var layers = ["None"];
      try {
        var demNames = ["dem", "DEM", "dtm", "DTM", "dsm", "DSM"];
        for (var i = 0; i < demNames.length; i++) {
          var found = qgisProject.mapLayersByName(demNames[i]);
          if (found.length > 0 && found[0].type === 1) {
            layers.push(found[0].name);
          }
        }
      } catch (e) {
        iface.logMessage("DroneTM: Error enumerating DEM layers: " + e);
      }
      demLayerCombo.model = layers;
      if (layers.length > 1) {
        demLayerCombo.currentIndex = 1;
      }
    }

    function persistDjiMissionId(value) {
      djiMissionId = value;
      var projectInfo = iface.findItemByObjectName("projectInfo");
      if (projectInfo) {
        projectInfo.saveVariable("dtm_dji_mission_id", value);
      }
    }

    function saveSettings() {
      var projectInfo = iface.findItemByObjectName("projectInfo");
      if (projectInfo) {
        projectInfo.saveVariable("dtm_drone_type", droneTypeIndex);
        projectInfo.saveVariable("dtm_gimbal_angle", gimbalAngleIndex);
        var hasDem = demLayerCombo.currentIndex > 0;
        var effectiveIndex = hasDem ? flightModeCombo.currentIndex : 1;
        projectInfo.saveVariable("dtm_flight_mode", effectiveIndex);

        projectInfo.saveVariable("dtm_auto_rotation", autoRotation ? 1 : 0);
        projectInfo.saveVariable("dtm_rotation_angle", rotationAngle);
        projectInfo.saveVariable("dtm_dji_mission_id", djiMissionId);

        if (takeoffPoint) {
          projectInfo.saveVariable("dtm_takeoff_lon", takeoffPoint.lon);
          projectInfo.saveVariable("dtm_takeoff_lat", takeoffPoint.lat);
        } else {
          projectInfo.saveVariable("dtm_takeoff_lon", "");
          projectInfo.saveVariable("dtm_takeoff_lat", "");
        }
      }
    }

    function loadSettings() {
      var variables = ExpressionContextUtils.projectVariables(qgisProject);

      if (variables["dtm_drone_type"] !== undefined) droneTypeIndex = parseInt(variables["dtm_drone_type"]) || 0;
      if (variables["dtm_gimbal_angle"] !== undefined) gimbalAngleIndex = parseInt(variables["dtm_gimbal_angle"]) || 0;
      if (variables["dtm_flight_mode"] !== undefined) flightModeIndex = parseInt(variables["dtm_flight_mode"]) || 0;
      if (variables["dtm_auto_rotation"] !== undefined)
          autoRotation = parseInt(variables["dtm_auto_rotation"]) !== 0;
      if (variables["dtm_rotation_angle"] !== undefined)
          rotationAngle = parseInt(variables["dtm_rotation_angle"]) || 0;
      if (variables["dtm_dji_mission_id"] !== undefined)
          djiMissionId = String(variables["dtm_dji_mission_id"]);

      if (variables["dtm_forward_overlap"] !== undefined) forwardOverlap = parseFloat(variables["dtm_forward_overlap"]) || 75;
      if (variables["dtm_side_overlap"] !== undefined) sideOverlap = parseFloat(variables["dtm_side_overlap"]) || 75;

      var hasGsd = variables["dtm_gsd"] !== undefined && parseFloat(variables["dtm_gsd"]) > 0;
      var hasAgl = variables["dtm_agl"] !== undefined && parseFloat(variables["dtm_agl"]) > 0;

      if (hasGsd) {
        gsd = parseFloat(variables["dtm_gsd"]);
        useGsd = true;
      } else if (hasAgl) {
        altitude = parseFloat(variables["dtm_agl"]);
        useGsd = false;
      }

      // Restore takeoff point onto the plugin so both plugin and dialog see it
      // (dialog.takeoffPoint is bound to plugin.takeoffPoint).
      var tLon = parseFloat(variables["dtm_takeoff_lon"]);
      var tLat = parseFloat(variables["dtm_takeoff_lat"]);
      if (!isNaN(tLon) && !isNaN(tLat) && tLon !== 0 && tLat !== 0) {
        plugin.takeoffPoint = { lon: tLon, lat: tLat };
      }

      iface.logMessage("DroneTM: Config loaded - " +
        (useGsd ? "GSD: " + gsd + " cm/px" : "AGL: " + altitude + "m") +
        ", overlap: " + forwardOverlap + "/" + sideOverlap + "%");
    }

    onOpened: {
      generationState = "idle";
      resultMessage = "";
      kmzAvailable = false;
      lastDroneType = "";
      loadSettings();
      populateDemLayers();
      updateFlightModeOptions();
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
    var names = ['sketcher', 'pointHandler', 'mapCanvasPointHandler',
                 'canvasPointHandler', 'identifyTool', 'sketcher_sketcher']
    for (var i = 0; i < names.length; i++) {
      var obj = iface.findItemByObjectName(names[i])
      if (obj) {
        var methods = []
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
    _writeStyleSidecar('point-markers', geojsonPath)

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

    var tsStr = String(tsMs)
    var tsSubDir = outputDir + '/' + tsStr
    platformUtilities.createDir(outputDir, tsStr)
    var globalOk  = saveTextFile(tsSubDir + '/global.json', potensic.globalJson)
    var missionOk = saveTextFile(tsSubDir + '/' + tsStr + '.json', potensic.missionJson)
    var jsonFilesOk = globalOk && missionOk

    var zipPath = outputDir + '/' + filename + '.zip'
    var zipOk = saveBinaryFile(zipPath, potensic.zipData)
    if (zipOk) {
      var zipVerify = _verifyZipFile(zipPath, potensic.zipData.byteLength)
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
    try {
      if (platformUtilities.writeFile && platformUtilities.writeFile(filepath, content)) {
        log("Saved via platformUtilities: " + filepath)
        return true
      }
    } catch (e) {
      log("platformUtilities.writeFile not available: " + e)
    }

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

    try {
      var xhr = new XMLHttpRequest()
      xhr.open("PUT", "file://" + filepath, false)
      xhr.send(content)
      log("Saved via XHR PUT: " + filepath)
      return true
    } catch (e) {
      log("XHR PUT failed for " + filepath + ": " + e)
    }

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

    try {
      var xhr = new XMLHttpRequest()
      xhr.open("PUT", "file://" + filepath, false)
      xhr.send(arrayBuffer)
      log("Binary saved via XHR PUT: " + filepath)
      return true
    } catch (e) {
      log("XHR PUT binary failed: " + e)
    }

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

  function _verifyZipFile(filepath, expectedByteLength) {
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
          return true
        }
      }
    } catch (e) {
      log("ZIP verify via FileUtils failed: " + e)
    }

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

  function selectDjiMissionFile() {
    try {
      platformUtilities.createDir(qgisProject.homePath, '.dtm_picker_cache')
    } catch (e) {
      log("createDir for picker cache failed: " + e)
    }
    try {
      djiPickerResourceSource = platformUtilities.getFile(
        qgisProject.homePath + '/',
        '.dtm_picker_cache/{filename}',
        '*/*',
        plugin
      )
      if (!djiPickerResourceSource) {
        mainWindow.displayToast(qsTr('File picker not available on this device'))
      }
    } catch (e) {
      log("getFile failed: " + e)
      mainWindow.displayToast(qsTr('File picker not available on this device'))
    }
  }

  function handleDjiFilePicked(relPath) {
    if (!relPath) {
      log("DJI file pick cancelled or returned empty path")
      return
    }
    log("DJI file picked: " + relPath)

    var clean = String(relPath).replace(/\\/g, '/')
    var slashIdx = clean.lastIndexOf('/')
    var basename = (slashIdx >= 0) ? clean.substring(slashIdx + 1) : clean

    var dotIdx = basename.lastIndexOf('.')
    var stem = (dotIdx > 0) ? basename.substring(0, dotIdx) : basename
    stem = stem.trim()

    if (!/^[A-Za-z0-9_-]+$/.test(stem)) {
      mainWindow.displayToast(qsTr('Cannot extract mission ID from "%1"').arg(basename))
      log("Invalid UUID from picked filename: " + basename)
    } else {
      flightplanDialog.djiMissionId = stem
      flightplanDialog.persistDjiMissionId(stem)
      mainWindow.displayToast(qsTr('Mission ID: %1').arg(stem))
    }

    try {
      platformUtilities.rmFile(qgisProject.homePath + '/' + clean)
    } catch (e) {
      log("Failed to remove picker cache file: " + e)
    }
  }

  function exportDjiMissionToDevice(missionId) {
    if (!lastKmzData) {
      mainWindow.displayToast(qsTr('No flightplan generated yet'))
      return
    }

    var normalizedMissionId = _normalizeDjiMissionId(missionId)
    if (!normalizedMissionId) {
      mainWindow.displayToast(qsTr('Pick a controller file first to capture the mission ID'))
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

    try {
      platformUtilities.copyTextToClipboard(normalizedMissionId)
    } catch (e) {
      log("Clipboard copy of mission id failed: " + e)
    }

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

    mainWindow.displayToast(qsTr('File picker not available'))
    flightplanDialog.generationState = "manual_transfer"
    flightplanDialog.resultMessage = qsTr('Find mission files in flightplans_potensic2/%1/ in the project folder').arg(lastPotensicMissionDirName)
  }
}
