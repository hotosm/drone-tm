import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import org.qfield
import Theme

QfDialog {
  id: flightplanDialog

  property var taskLayer: null
  property var taskIds: []

  // User-selectable settings (saved/loaded via project variables)
  property int droneTypeIndex: 0
  property int gimbalAngleIndex: 0
  property int flightModeIndex: 0
  property bool autoRotation: true
  property int rotationAngle: 0

  // Manager-configured values (injected via pyQGIS project variables, not shown in UI)
  property real forwardOverlap: 75
  property real sideOverlap: 75
  property real altitude: 0
  property real gsd: 3.5
  property bool useGsd: true

  // Takeoff point (set from parent)
  property var takeoffPoint: null

  signal generateRequested(var config)
  signal copyToControllerRequested()
  signal useGpsTakeoff()
  signal placeMapTakeoff()
  signal clearTakeoff()

  // Post-generation state
  property string generationState: "idle"  // "idle", "done", "error"
  property string resultMessage: ""
  property bool kmzAvailable: false

  parent: iface.mainWindow().contentItem
  width: Math.min(parent.width * 0.9, 400)
  height: Math.min(parent.height * 0.85, 500)
  x: (parent.width - width) / 2
  y: (parent.height - height) / 2
  title: qsTr("Generate Flightplan")

  // Remove default OK/Cancel footer buttons
  standardButtons: Dialog.NoButton
  // Close when tapping outside or pressing Escape
  closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside

  // Custom header with title and X close button
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
        text: "\u2715"
        font.pixelSize: Theme.defaultFont.pixelSize * 1.3
        color: Theme.mainTextColor
      }

      MouseArea {
        id: closeArea
        anchors.fill: parent
        onClicked: flightplanDialog.close()
      }
    }

    // Bottom border
    Rectangle {
      anchors.bottom: parent.bottom
      width: parent.width
      height: 1
      color: Theme.mainTextDisabledColor
    }
  }

  // Scroll the dialog to reveal post-generation buttons (deferred to let layout update)
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

      // --- Separator ---
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
          onClicked: useGpsTakeoff()
        }

        QfButton {
          Layout.fillWidth: true
          text: qsTr("Place on Map")
          onClicked: placeMapTakeoff()
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
          onClicked: clearTakeoff()
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
            onClicked: clearTakeoff()
          }
        }
      }

      // --- Separator ---
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
        model: ["Off-Nadir (-80\u00B0)", "Nadir (-90\u00B0)", "Oblique (-45\u00B0)"]
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
        onCurrentIndexChanged: updateFlightModeOptions()
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
          textFromValue: function(value) { return value + "\u00B0" }
          valueFromText: function(text) { return parseInt(text) || 0 }
        }
      }

      // --- Flight config summary (read-only, from project settings) ---
      Rectangle {
        Layout.fillWidth: true
        Layout.preferredHeight: 1
        color: Theme.mainTextDisabledColor
      }
      Label {
        text: {
          if (useGsd) {
            return qsTr("GSD: %1 cm/px | Overlap: %2/%3%")
              .arg(gsd).arg(forwardOverlap).arg(sideOverlap)
          } else {
            return qsTr("Altitude: %1m AGL | Overlap: %2/%3%")
              .arg(altitude).arg(forwardOverlap).arg(sideOverlap)
          }
        }
        font.pixelSize: Theme.defaultFont.pixelSize * 0.9
        font.italic: true
        color: Theme.mainTextDisabledColor
        wrapMode: Text.WordWrap
        Layout.fillWidth: true
      }

      // --- Spacer ---
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

          // Flight mode depends on DEM selection
          var hasDem = demLayerCombo.currentIndex > 0;
          var flightMode;
          if (hasDem) {
            // With DEM: combo has ["Waylines", "Waypoints"]
            flightMode = (flightModeCombo.currentIndex === 0) ? "waylines" : "waypoints";
          } else {
            // Without DEM: combo only has ["Waypoints"]
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

          saveSettings();
          generationState = "idle";
          resultMessage = "";
          generateRequested(config);
        }
      }

      // --- Result Message ---
      Label {
        visible: generationState !== "idle"
        text: resultMessage
        font.pixelSize: Theme.defaultFont.pixelSize * 0.9
        color: (generationState === "error" || generationState === "transfer_failed") ? "#C53639" : Theme.mainTextColor
        wrapMode: Text.WordWrap
        Layout.fillWidth: true
      }

      // --- File write failure help ---
      Label {
        visible: generationState === "error"
        text: qsTr("The WPML has been copied to your clipboard. To get the flightplan to your drone:\n\n" +
          "1. Paste clipboard into a new file named <task>.wpml using a text editor\n" +
          "2. Use a file manager app to copy the .kmz or .wpml from this project's flightplans/ folder to the DJI controller storage\n" +
          "3. Or transfer later via the DroneTM web app (requires internet) using ADB Web transfer\n\n" +
          "Files are saved to: flightplans/ in the QField project directory")
        font.pixelSize: Theme.defaultFont.pixelSize * 0.8
        wrapMode: Text.WordWrap
        Layout.fillWidth: true
      }

      // --- Manual transfer help (file picker was used) ---
      Label {
        visible: generationState === "manual_transfer"
        text: qsTr("A file picker was opened to save the KMZ. To load it on your DJI controller:\n\n" +
          "1. Save the file to a location you can find (e.g. Downloads)\n" +
          "2. Connect the controller via USB or use a file manager app\n" +
          "3. Copy the .kmz to:\n" +
          "   Android/data/dji.go.v5/files/waypoint/<mission-id>/\n\n" +
          "Tip: The controller must have at least one prior waypoint mission for the waypoint directory to exist.")
        font.pixelSize: Theme.defaultFont.pixelSize * 0.8
        wrapMode: Text.WordWrap
        Layout.fillWidth: true
      }

      // --- Controller transfer failure help ---
      Label {
        visible: generationState === "transfer_failed"
        text: qsTr("To transfer the flightplan to your DJI controller:\n\n" +
          "1. Ensure the controller is connected via USB and has at least one prior waypoint mission\n" +
          "2. Use a file manager app to copy the .kmz from this project's flightplans/ folder to:\n" +
          "   Android/data/dji.go.v5/files/waypoint/<mission-id>/\n" +
          "3. Or transfer later via the DroneTM web app (requires internet) using ADB Web transfer\n\n" +
          "Tip: If this is a new controller, fly one test waypoint mission first so DJI creates the waypoint directory.")
        font.pixelSize: Theme.defaultFont.pixelSize * 0.8
        wrapMode: Text.WordWrap
        Layout.fillWidth: true
      }

      // --- Copy to Flight Controller Button ---
      QfButton {
        id: copyButton
        Layout.fillWidth: true
        visible: generationState === "done" && kmzAvailable
        text: qsTr("Copy to Flight Controller")

        onClicked: {
          copyToControllerRequested();
        }
      }

      // --- Retry Copy Button (shown after transfer failure or manual transfer) ---
      QfButton {
        Layout.fillWidth: true
        visible: generationState === "transfer_failed" || generationState === "manual_transfer"
        text: qsTr("Retry Copy to Controller")

        onClicked: {
          generationState = "done";
          copyToControllerRequested();
        }
      }

      // --- Close Button (shown after generation) ---
      QfButton {
        Layout.fillWidth: true
        visible: generationState !== "idle"
        text: qsTr("Close")

        onClicked: {
          flightplanDialog.close();
        }
      }
    }
  }

  // Populate task ID list from dtm-tasks layer
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

  // Update flight mode options based on DEM selection
  function updateFlightModeOptions() {
    var hasDem = demLayerCombo.currentIndex > 0;
    if (hasDem) {
      flightModeCombo.model = ["Waylines", "Waypoints"];
      // Restore saved index if valid
      flightModeCombo.currentIndex = (flightplanDialog.flightModeIndex < 2) ? flightplanDialog.flightModeIndex : 0;
    } else {
      flightModeCombo.model = ["Waypoints"];
      flightModeCombo.currentIndex = 0;
    }
  }

  // Populate DEM layer list from project
  function populateDemLayers() {
    var layers = ["None"];
    try {
      var demNames = ["dem", "DEM", "dtm", "DTM", "dsm", "DSM", "elevation"];
      for (var i = 0; i < demNames.length; i++) {
        var found = qgisProject.mapLayersByName(demNames[i]);
        if (found.length > 0) {
          layers.push(found[0].name);
        }
      }
    } catch (e) {
      iface.logMessage("DroneTM: Error enumerating DEM layers: " + e);
    }
    demLayerCombo.model = layers;
    // Auto-select first DEM layer found as a convenience
    if (layers.length > 1) {
      demLayerCombo.currentIndex = 1;
    }
  }

  // Save user-selectable settings (drone, gimbal, flight mode) via project variables
  function saveSettings() {
    var projectInfo = iface.findItemByObjectName("projectInfo");
    if (projectInfo) {
      projectInfo.saveVariable("dtm_drone_type", droneTypeIndex);
      projectInfo.saveVariable("dtm_gimbal_angle", gimbalAngleIndex);
      // Save the effective flight mode index (accounting for DEM-gated options)
      var hasDem = demLayerCombo.currentIndex > 0;
      var effectiveIndex = hasDem ? flightModeCombo.currentIndex : 1; // 1 = waypoints in full list
      projectInfo.saveVariable("dtm_flight_mode", effectiveIndex);

      projectInfo.saveVariable("dtm_auto_rotation", autoRotation ? 1 : 0);
      projectInfo.saveVariable("dtm_rotation_angle", rotationAngle);

      if (takeoffPoint) {
        projectInfo.saveVariable("dtm_takeoff_lon", takeoffPoint.lon);
        projectInfo.saveVariable("dtm_takeoff_lat", takeoffPoint.lat);
      } else {
        projectInfo.saveVariable("dtm_takeoff_lon", "");
        projectInfo.saveVariable("dtm_takeoff_lat", "");
      }
    }
  }

  // Load all settings from project variables
  // Manager-injected: dtm_forward_overlap, dtm_side_overlap, dtm_agl, dtm_gsd
  // User-selectable: dtm_drone_type, dtm_gimbal_angle, dtm_flight_mode
  function loadSettings() {
    var variables = ExpressionContextUtils.projectVariables(qgisProject);

    // User-selectable
    if (variables["dtm_drone_type"] !== undefined) droneTypeIndex = parseInt(variables["dtm_drone_type"]) || 0;
    if (variables["dtm_gimbal_angle"] !== undefined) gimbalAngleIndex = parseInt(variables["dtm_gimbal_angle"]) || 0;
    if (variables["dtm_flight_mode"] !== undefined) flightModeIndex = parseInt(variables["dtm_flight_mode"]) || 0;
    if (variables["dtm_auto_rotation"] !== undefined)
        autoRotation = parseInt(variables["dtm_auto_rotation"]) !== 0;
    if (variables["dtm_rotation_angle"] !== undefined)
        rotationAngle = parseInt(variables["dtm_rotation_angle"]) || 0;

    // Manager-injected flight parameters
    if (variables["dtm_forward_overlap"] !== undefined) forwardOverlap = parseFloat(variables["dtm_forward_overlap"]) || 75;
    if (variables["dtm_side_overlap"] !== undefined) sideOverlap = parseFloat(variables["dtm_side_overlap"]) || 75;

    // AGL and GSD: if dtm_gsd is set, use GSD mode; if dtm_agl is set, use altitude mode
    // If both set, GSD takes precedence; if neither, default to GSD 3.5
    var hasGsd = variables["dtm_gsd"] !== undefined && parseFloat(variables["dtm_gsd"]) > 0;
    var hasAgl = variables["dtm_agl"] !== undefined && parseFloat(variables["dtm_agl"]) > 0;

    if (hasGsd) {
      gsd = parseFloat(variables["dtm_gsd"]);
      useGsd = true;
    } else if (hasAgl) {
      altitude = parseFloat(variables["dtm_agl"]);
      useGsd = false;
    }
    // else: keep defaults (GSD 3.5 cm/px)

    // Restore takeoff point
    var tLon = parseFloat(variables["dtm_takeoff_lon"]);
    var tLat = parseFloat(variables["dtm_takeoff_lat"]);
    if (!isNaN(tLon) && !isNaN(tLat) && tLon !== 0 && tLat !== 0) {
      takeoffPoint = { lon: tLon, lat: tLat };
    }

    iface.logMessage("DroneTM: Config loaded - " +
      (useGsd ? "GSD: " + gsd + " cm/px" : "AGL: " + altitude + "m") +
      ", overlap: " + forwardOverlap + "/" + sideOverlap + "%");
  }

  onOpened: {
    generationState = "idle";
    resultMessage = "";
    kmzAvailable = false;
    loadSettings();
    populateDemLayers();
    updateFlightModeOptions();
  }
}
