import QtQuick
import QtQuick.Controls
import org.qfield
import org.qgis
import Theme

Item {
  id: plugin

  property var mainWindow: iface.mainWindow()

  Component.onCompleted: {
    iface.addItemToPluginsToolbar(dronetm)
  }

  QfToolButton {
    id: dronetm
    iconSource: 'dronetm.svg'
    iconColor: '#C53639'
    bgcolor: '#FFFFFF'
    round: true

    onClicked: {
      extractElevations()
    }
  }

  function extractElevations() {
    // Get layers using the correct API
    var demLayer = qgisProject.mapLayersByName('dem')[0]
    var flightPlan = qgisProject.mapLayersByName('flight_plan-a93e99f5-5aab-4316-b6f8-0acd56975df3-890dceae-d422-4337-b839-ab586bedea1a-waylines')[0]

    if (!demLayer) {
      mainWindow.displayToast(qsTr('DEM layer not found'))
      return
    }

    if (!flightPlan) {
      mainWindow.displayToast(qsTr('Flightplan layer not found'))
      return
    }

    // FIXME Is raster sampling possible in QML plugin / all relevant parts of QGIS engine exposed?

    // TODO convert Python flightplan generation code to JavaScript
    // TODO hook into Javascript code like this:
    // import "flightplan.js" as Flightplan
    // Flightplan.generate(aoiLayerExtent, droneModel, etc)
  }
}
