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

    var provider = demLayer.dataProvider()

    // Use LayerUtils to create a feature iterator
    var iterator = LayerUtils.createFeatureIteratorFromExpression(flightPlan, "TRUE")

    var count = 0
    var elevations = []

    // Iterate through features
    while (iterator.hasNext()) {
      var feature = iterator.next()

      // Access geometry as a property
      var geom = feature.geometry

      if (geom) {
        // Use GeometryUtils.centroid() to get a QgsPoint from the geometry
        var point = GeometryUtils.centroid(geom)

        // Sample the DEM at this point
        var ok = { value: false }
        // NOTE this doesn't work. We have access to QgsGdalProvider, but can't call .sample() on it?
        // Can't see any relevant raster utils here to help
        // https://github.com/opengisch/QField/tree/master/src/core/utils
        var elevation = provider.sample(point, 1, ok)

        if (ok.value) {
          elevations.push(elevation)
          console.log('Feature', feature.id, 'at', point.x(), point.y(), 'elevation:', elevation)
          count++
        } else {
          console.log('Failed to sample for feature', feature.id)
        }
      }
    }

    // Important: close the iterator when done
    iterator.close()

    mainWindow.displayToast(qsTr('Sampled ' + count + ' elevations'))

    if (count > 0) {
      var avg = elevations.reduce(function(a, b) { return a + b; }, 0) / elevations.length
      console.log('Average elevation:', avg.toFixed(2), 'm')
    }

    // FIXME Is raster sampling possible in QML plugin / all relevant parts of QGIS engine exposed?

    // TODO convert Python flightplan generation code to JavaScript
    // TODO hook into Javascript code like this:
    // import "flightplan.js" as Flightplan
    // Flightplan.generate(aoiLayerExtent, droneModel, etc)
  }
}
