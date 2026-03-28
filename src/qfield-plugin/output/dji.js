.pragma library

// ============================================================================
// DJI WPML XML output format
// Port of output/dji.py
// ============================================================================

// Build WPML XML string for DJI flight controller
// Uses string concatenation since QML JS has no XML DOM API
function createWpml(placemarks, globalHeight) {
    if (globalHeight === undefined) globalHeight = 100;

    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">\n';
    xml += '  <Document>\n';

    // Mission config
    xml += missionConfig(globalHeight);

    // Folder with waypoints
    xml += '    <Folder>\n';
    xml += '      <wpml:templateId>0</wpml:templateId>\n';
    xml += '      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>\n';
    xml += '      <wpml:waylineId>0</wpml:waylineId>\n';
    xml += '      <wpml:distance>0</wpml:distance>\n';
    xml += '      <wpml:duration>0</wpml:duration>\n';
    xml += '      <wpml:globalWaypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:globalWaypointTurnMode>\n';
    xml += '      <wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>\n';
    xml += '      <wpml:autoFlightSpeed>2.5</wpml:autoFlightSpeed>\n';

    var features = placemarks.features;
    var finalIndex = features.length - 1;

    for (var i = 0; i < features.length; i++) {
        xml += placemark(features[i], finalIndex);
    }

    xml += '    </Folder>\n';
    xml += '  </Document>\n';
    xml += '</kml>\n';

    return xml;
}

function missionConfig(globalHeight) {
    var xml = '    <wpml:missionConfig>\n';
    xml += '      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>\n';
    xml += '      <wpml:finishAction>goHome</wpml:finishAction>\n';
    xml += '      <wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>\n';
    xml += '      <wpml:globalTransitionalSpeed>2.5</wpml:globalTransitionalSpeed>\n';
    xml += '      <wpml:globalRTHHeight>' + globalHeight + '</wpml:globalRTHHeight>\n';
    xml += '      <wpml:droneInfo>\n';
    xml += '        <wpml:droneEnumValue>68</wpml:droneEnumValue>\n';
    xml += '        <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>\n';
    xml += '      </wpml:droneInfo>\n';
    xml += '    </wpml:missionConfig>\n';
    return xml;
}

function placemark(feature, finalIndex) {
    var props = feature.properties;
    var coords = feature.geometry.coordinates;
    var index = props.index;
    var lon = coords[0];
    var lat = coords[1];
    var executeHeight = (coords.length > 2) ? coords[2] : 100;
    var speed = props.speed || 2.5;
    var heading = props.heading;
    var gimbal = props.gimbal_angle;
    var takePhoto = props.take_photo;

    var xml = '      <Placemark>\n';
    xml += '        <Point>\n';
    xml += '          <coordinates>' + lon + ',' + lat + '</coordinates>\n';
    xml += '        </Point>\n';
    xml += '        <wpml:index>' + index + '</wpml:index>\n';
    xml += '        <wpml:executeHeight>' + executeHeight + '</wpml:executeHeight>\n';
    xml += '        <wpml:waypointSpeed>' + speed + '</wpml:waypointSpeed>\n';

    // Heading
    xml += '        <wpml:waypointHeadingParam>\n';
    xml += '          <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>\n';
    xml += '          <wpml:waypointHeadingAngle>' + heading + '</wpml:waypointHeadingAngle>\n';
    xml += '          <wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint>\n';
    xml += '          <wpml:waypointHeadingAngleEnable>1</wpml:waypointHeadingAngleEnable>\n';
    xml += '        </wpml:waypointHeadingParam>\n';

    // Turn mode (straight lines)
    xml += '        <wpml:waypointTurnParam>\n';
    xml += '          <wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>\n';
    xml += '          <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>\n';
    xml += '        </wpml:waypointTurnParam>\n';
    xml += '        <wpml:useStraightLine>1</wpml:useStraightLine>\n';

    // Action group 1: photo or gimbal rotate at waypoint
    xml += '        <wpml:actionGroup>\n';
    xml += '          <wpml:actionGroupId>1</wpml:actionGroupId>\n';
    xml += '          <wpml:actionGroupStartIndex>' + index + '</wpml:actionGroupStartIndex>\n';
    xml += '          <wpml:actionGroupEndIndex>' + index + '</wpml:actionGroupEndIndex>\n';
    xml += '          <wpml:actionGroupMode>parallel</wpml:actionGroupMode>\n';
    xml += '          <wpml:actionTrigger>\n';
    xml += '            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>\n';
    xml += '          </wpml:actionTrigger>\n';

    if (takePhoto) {
        xml += takePhotoAction("1");
    } else {
        xml += gimbalRotateAction("1", gimbal);
    }

    xml += '        </wpml:actionGroup>\n';

    // Action group 3: smooth gimbal rotation
    xml += smoothGimbalGroup(index, gimbal);

    xml += '      </Placemark>\n';
    return xml;
}

function takePhotoAction(actionId) {
    var xml = '          <wpml:action>\n';
    xml += '            <wpml:actionId>' + actionId + '</wpml:actionId>\n';
    xml += '            <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>\n';
    xml += '            <wpml:actionActuatorFuncParam>\n';
    xml += '              <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>\n';
    xml += '            </wpml:actionActuatorFuncParam>\n';
    xml += '          </wpml:action>\n';
    return xml;
}

function gimbalRotateAction(actionId, gimbalAngle) {
    var xml = '          <wpml:action>\n';
    xml += '            <wpml:actionId>' + actionId + '</wpml:actionId>\n';
    xml += '            <wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>\n';
    xml += '            <wpml:actionActuatorFuncParam>\n';
    xml += '              <wpml:gimbalHeadingYawBase>aircraft</wpml:gimbalHeadingYawBase>\n';
    xml += '              <wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode>\n';
    xml += '              <wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>\n';
    xml += '              <wpml:gimbalPitchRotateAngle>' + gimbalAngle + '</wpml:gimbalPitchRotateAngle>\n';
    xml += '              <wpml:gimbalRollRotateEnable>0</wpml:gimbalRollRotateEnable>\n';
    xml += '              <wpml:gimbalRollRotateAngle>0</wpml:gimbalRollRotateAngle>\n';
    xml += '              <wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable>\n';
    xml += '              <wpml:gimbalYawRotateAngle>0</wpml:gimbalYawRotateAngle>\n';
    xml += '              <wpml:gimbalRotateTimeEnable>0</wpml:gimbalRotateTimeEnable>\n';
    xml += '              <wpml:gimbalRotateTime>0</wpml:gimbalRotateTime>\n';
    xml += '              <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>\n';
    xml += '            </wpml:actionActuatorFuncParam>\n';
    xml += '          </wpml:action>\n';
    return xml;
}

function smoothGimbalGroup(index, gimbalAngle) {
    var xml = '        <wpml:actionGroup>\n';
    xml += '          <wpml:actionGroupId>3</wpml:actionGroupId>\n';
    xml += '          <wpml:actionGroupStartIndex>0</wpml:actionGroupStartIndex>\n';
    xml += '          <wpml:actionGroupEndIndex>1</wpml:actionGroupEndIndex>\n';
    xml += '          <wpml:actionGroupMode>parallel</wpml:actionGroupMode>\n';
    xml += '          <wpml:actionTrigger>\n';
    xml += '            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>\n';
    xml += '          </wpml:actionTrigger>\n';
    xml += '          <wpml:action>\n';
    xml += '            <wpml:actionId>0</wpml:actionId>\n';
    xml += '            <wpml:actionActuatorFunc>gimbalEvenlyRotate</wpml:actionActuatorFunc>\n';
    xml += '            <wpml:actionActuatorFuncParam>\n';
    xml += '              <wpml:gimbalPitchRotateAngle>' + gimbalAngle + '</wpml:gimbalPitchRotateAngle>\n';
    xml += '              <wpml:gimbalRollRotateEnable>0</wpml:gimbalRollRotateEnable>\n';
    xml += '              <wpml:gimbalRollRotateAngle>0</wpml:gimbalRollRotateAngle>\n';
    xml += '              <wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable>\n';
    xml += '              <wpml:gimbalYawRotateAngle>0</wpml:gimbalYawRotateAngle>\n';
    xml += '              <wpml:gimbalRotateTimeEnable>0</wpml:gimbalRotateTimeEnable>\n';
    xml += '              <wpml:gimbalRotateTime>0</wpml:gimbalRotateTime>\n';
    xml += '              <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>\n';
    xml += '            </wpml:actionActuatorFuncParam>\n';
    xml += '          </wpml:action>\n';
    xml += '        </wpml:actionGroup>\n';
    return xml;
}
