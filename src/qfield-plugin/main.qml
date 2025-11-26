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

  ExpressionEvaluator {
    id: expressionEvaluator
    feature: feature

    expressionText: "raster_value('dem_layer', 1, @geometry)"
  }

  function getDEMValue() {
    const value = expressionEvaluator.evaluate()
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

    // Set the layer context for the expression evaluator
    expressionEvaluator.layer = flightPlan

    // By setting the expression to 'True', this simply returns an iterator on all features
    var iterator = LayerUtils.createFeatureIteratorFromExpression(flightPlan, "TRUE")
    var count = 0
    var elevations = []

    // Iterate through features
    while (iterator.hasNext()) {
      var feature = iterator.next()

      var elevation = getDEMValue()
      var geom = feature.geometry

      if (geom) {
        // Use GeometryUtils.centroid() to get a QgsPoint from the geometry
        var point = GeometryUtils.centroid(geom)

        elevations.push(elevation)
        iface.logMessage('Feature', feature.id, 'elevation:', elevation)
        count++
      }
    }

    // Important: close the iterator when done
    iterator.close()

    mainWindow.displayToast(qsTr('Sampled ' + count + ' elevations'))

    if (count > 0) {
      var avg = elevations.reduce(function(a, b) { return a + b; }, 0) / elevations.length
      iface.logMessage('Average elevation:', avg.toFixed(2), 'm')
    }

    // TODO convert Python flightplan generation code to JavaScript
    // TODO hook into Javascript code like this:
    // import "flightplan.js" as Flightplan
    // Flightplan.generate(aoiLayerExtent, droneModel, etc)
  }
}
