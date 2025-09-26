import argparse
import logging
import os
import xml.etree.ElementTree as ET
import zipfile
from typing import Union
from xml.etree.ElementTree import Element

import geojson
from geojson import FeatureCollection

from drone_flightplan.enums import RCLostOptions

# Instantiate logger
log = logging.getLogger(__name__)


def zip_directory(directory_path, zip_path):
    with zipfile.ZipFile(zip_path, "w") as zipf:
        for root, _dirs, files in os.walk(directory_path):
            for file in files:
                zipf.write(
                    os.path.join(root, file),
                    os.path.relpath(
                        os.path.join(root, file), os.path.join(directory_path, "..")
                    ),
                )


def create_zip_file(waylines_path_uid):
    # Create the wpmz folder if it doesn't exist
    wpmz_path = f"{waylines_path_uid}/wpmz"
    os.makedirs(wpmz_path, exist_ok=True)

    # TODO: Need to check if it is really required. It might not be needed.

    # import xml.etree.ElementTree as ET

    # xml_string = """<?xml version="1.0" encoding="UTF-8"?>
    # <kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
    #   <Document>
    #     <wpml:author>fly</wpml:author>
    #     <wpml:createTime>1702051864938</wpml:createTime>
    #     <wpml:updateTime>1702051864938</wpml:updateTime>
    #     <wpml:missionConfig>
    #       <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
    #       <wpml:finishAction>noAction</wpml:finishAction>
    #       <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
    #       <wpml:executeRCLostAction>hover</wpml:executeRCLostAction>
    #       <wpml:globalTransitionalSpeed>2.5</wpml:globalTransitionalSpeed>
    #       <wpml:droneInfo>
    #         <wpml:droneEnumValue>68</wpml:droneEnumValue>
    #         <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>
    #       </wpml:droneInfo>
    #     </wpml:missionConfig>
    #   </Document>
    # </kml>
    # """

    # # Parse the XML string
    # root = ET.fromstring(xml_string)

    # # Create an ElementTree object
    # tree = ET.ElementTree(root)

    # # Write the ElementTree object to a file
    # with open(f"{wpmz_path}/template.kml", "wb") as file:
    #     tree.write(file, encoding="utf-8", xml_declaration=True)

    # Read content of template.kml
    with open(f"{waylines_path_uid}/waylines.wpml", "r") as f:
        wpml_content = f.read()

    with open(f"{wpmz_path}/waylines.wpml", "w") as f:
        f.write(wpml_content)

    # Create a Zip file containing the contents of the wpmz folder directly
    output_file_name = f"{waylines_path_uid}/output.kmz"
    zip_directory(wpmz_path, output_file_name)

    return output_file_name


def take_photo_action(action_group_element: Element, index: str):
    action = ET.SubElement(action_group_element, "wpml:action")
    action_id = ET.SubElement(action, "wpml:actionId")
    action_id.text = str(index)
    action_actuator_func = ET.SubElement(action, "wpml:actionActuatorFunc")
    action_actuator_func.text = "takePhoto"
    action_actuator_func_param = ET.SubElement(action, "wpml:actionActuatorFuncParam")
    payload_position_index = ET.SubElement(
        action_actuator_func_param, "wpml:payloadPositionIndex"
    )
    payload_position_index.text = "0"


def gimble_rotate_action(action_group_element: Element, index: str, gimbal_angle: str):
    action1 = ET.SubElement(action_group_element, "wpml:action")
    action1_id = ET.SubElement(action1, "wpml:actionId")
    action1_id.text = str(index)
    action1_actuator_func = ET.SubElement(action1, "wpml:actionActuatorFunc")
    action1_actuator_func.text = "gimbalRotate"
    action1_actuator_func_param = ET.SubElement(action1, "wpml:actionActuatorFuncParam")
    gimbal_heading_yaw_base = ET.SubElement(
        action1_actuator_func_param, "wpml:gimbalHeadingYawBase"
    )
    gimbal_heading_yaw_base.text = "aircraft"
    gimbal_rotate_mode = ET.SubElement(
        action1_actuator_func_param, "wpml:gimbalRotateMode"
    )
    gimbal_rotate_mode.text = "absoluteAngle"
    gimbal_pitch_rotate_enable = ET.SubElement(
        action1_actuator_func_param, "wpml:gimbalPitchRotateEnable"
    )
    gimbal_pitch_rotate_enable.text = "1"
    gimbal_pitch_rotate_angle = ET.SubElement(
        action1_actuator_func_param, "wpml:gimbalPitchRotateAngle"
    )
    gimbal_roll_rotate_enable = ET.SubElement(
        action1_actuator_func_param, "wpml:gimbalRollRotateEnable"
    )
    gimbal_roll_rotate_angle = ET.SubElement(
        action1_actuator_func_param, "wpml:gimbalRollRotateAngle"
    )

    # If the gimbal pitch rotate angle is 45, make it -90. 45 is just for reference. We need to change roll angle for this.
    if str(gimbal_angle) == "45":
        gimbal_pitch_rotate_angle.text = "-90"
        gimbal_roll_rotate_enable.text = "1"
        gimbal_roll_rotate_angle.text = "-45"

    else:
        gimbal_pitch_rotate_angle.text = str(gimbal_angle)
        gimbal_roll_rotate_enable.text = "0"
        gimbal_roll_rotate_angle.text = "0"

    gimbal_yaw_rotate_enable = ET.SubElement(
        action1_actuator_func_param, "wpml:gimbalYawRotateEnable"
    )
    gimbal_yaw_rotate_enable.text = "0"
    gimbal_yaw_rotate_angle = ET.SubElement(
        action1_actuator_func_param, "wpml:gimbalYawRotateAngle"
    )
    gimbal_yaw_rotate_angle.text = "0"
    gimbal_rotate_time_enable = ET.SubElement(
        action1_actuator_func_param, "wpml:gimbalRotateTimeEnable"
    )
    gimbal_rotate_time_enable.text = "0"
    gimbal_rotate_time = ET.SubElement(
        action1_actuator_func_param, "wpml:gimbalRotateTime"
    )
    gimbal_rotate_time.text = "0"
    payload_position_index = ET.SubElement(
        action1_actuator_func_param, "wpml:payloadPositionIndex"
    )
    payload_position_index.text = "0"


def create_placemark(placemark):
    try:
        index = placemark["properties"]["index"]
        coordinate = placemark["geometry"]["coordinates"]
        coordinates = f"{coordinate[0]},{coordinate[1]}"
        execute_height = str(coordinate[2])
        waypoint_speed = placemark["properties"]["speed"]
        waypoint_heading_angle = placemark["properties"]["heading"]
        gimbal_angle = placemark["properties"]["gimbal_angle"]
        take_photo = placemark["properties"]["take_photo"]
    except IndexError as e:
        raise ValueError(str(e))

    placemark = ET.Element("Placemark")

    point = ET.SubElement(placemark, "Point")
    coordinates_elem = ET.SubElement(point, "coordinates")
    coordinates_elem.text = coordinates

    wpml_index = ET.SubElement(placemark, "wpml:index")
    wpml_index.text = str(index)

    execute_height_elem = ET.SubElement(placemark, "wpml:executeHeight")
    execute_height_elem.text = str(execute_height)

    waypoint_speed_elem = ET.SubElement(placemark, "wpml:waypointSpeed")
    waypoint_speed_elem.text = str(waypoint_speed)

    waypoint_heading_param = ET.SubElement(placemark, "wpml:waypointHeadingParam")
    wpml_waypoint_heading_mode = ET.SubElement(
        waypoint_heading_param, "wpml:waypointHeadingMode"
    )
    wpml_waypoint_heading_mode.text = "followWayline"

    wpml_waypoint_heading_angle = ET.SubElement(
        waypoint_heading_param, "wpml:waypointHeadingAngle"
    )
    wpml_waypoint_heading_angle.text = str(waypoint_heading_angle)
    wpml_waypoint_poi_point = ET.SubElement(
        waypoint_heading_param, "wpml:waypointPoiPoint"
    )
    wpml_waypoint_poi_point.text = "0.000000,0.000000,0.000000"
    wpml_waypoint_heading_angle_enable = ET.SubElement(
        waypoint_heading_param, "wpml:waypointHeadingAngleEnable"
    )
    wpml_waypoint_heading_angle_enable.text = "1"
    # wpml_waypoint_heading_angle_enable.text = "0"

    # NOTE if we need to update the heading direction per waypoint
    # wpml_waypoint_heading_path_mode = ET.SubElement(
    #     waypoint_heading_param, "wpml:waypointHeadingPathMode"
    # )
    # wpml_waypoint_heading_path_mode.text = "followBadArc"

    # Set the turn mode between waypoint (straight lines through points, no curves)
    # NOTE we can't seem to set these globally, so we set them per point instead
    wpml_waypoint_turn_param = ET.SubElement(placemark, "wpml:waypointTurnParam")
    wpml_waypoint_turn_mode = ET.SubElement(
        wpml_waypoint_turn_param, "wpml:waypointTurnMode"
    )
    wpml_waypoint_turn_mode.text = "toPointAndStopWithDiscontinuityCurvature"
    wpml_waypoint_turn_damping_dist = ET.SubElement(
        wpml_waypoint_turn_param, "wpml:waypointTurnDampingDist"
    )
    wpml_waypoint_turn_damping_dist.text = "0"
    use_straight_line = ET.SubElement(placemark, "wpml:useStraightLine")
    use_straight_line.text = "1"

    action_group1 = ET.SubElement(placemark, "wpml:actionGroup")
    action_group1_id = ET.SubElement(action_group1, "wpml:actionGroupId")
    action_group1_id.text = "1"
    action_group1_start = ET.SubElement(action_group1, "wpml:actionGroupStartIndex")
    action_group1_start.text = str(index)  # Start index
    action_group1_end = ET.SubElement(action_group1, "wpml:actionGroupEndIndex")
    action_group1_end.text = str(index)  # End Index
    action_group1_mode = ET.SubElement(action_group1, "wpml:actionGroupMode")
    action_group1_mode.text = "parallel"
    action_group1_trigger = ET.SubElement(action_group1, "wpml:actionTrigger")
    action_group1_trigger_type = ET.SubElement(
        action_group1_trigger, "wpml:actionTriggerType"
    )
    action_group1_trigger_type.text = "reachPoint"

    if take_photo:
        # Take photo action
        take_photo_action(action_group1, "1")
    else:
        # Gimble rotate action
        gimble_rotate_action(action_group1, "1", str(gimbal_angle))

    action_group2 = ET.SubElement(placemark, "wpml:actionGroup")
    action_group2_id = ET.SubElement(action_group2, "wpml:actionGroupId")
    action_group2_id.text = "2"  # Not always 2
    action_group2_start = ET.SubElement(action_group2, "wpml:actionGroupStartIndex")
    action_group2_start.text = "0"
    action_group2_end = ET.SubElement(action_group2, "wpml:actionGroupEndIndex")
    action_group2_end.text = "1"
    action_group2_mode = ET.SubElement(action_group2, "wpml:actionGroupMode")
    action_group2_mode.text = "parallel"
    action_group2_trigger = ET.SubElement(action_group2, "wpml:actionTrigger")
    action_group2_trigger_type = ET.SubElement(
        action_group2_trigger, "wpml:actionTriggerType"
    )
    action_group2_trigger_type.text = "reachPoint"
    action2 = ET.SubElement(action_group2, "wpml:action")
    action2_id = ET.SubElement(action2, "wpml:actionId")
    action2_id.text = "2"  # Not always 2
    action2_actuator_func = ET.SubElement(action2, "wpml:actionActuatorFunc")
    action2_actuator_func.text = "gimbalEvenlyRotate"
    action2_actuator_func_param = ET.SubElement(action2, "wpml:actionActuatorFuncParam")
    gimbal_pitch_rotate_angle2 = ET.SubElement(
        action2_actuator_func_param, "wpml:gimbalPitchRotateAngle"
    )
    gimbal_pitch_rotate_angle2.text = str(gimbal_angle)
    payload_position_index2 = ET.SubElement(
        action2_actuator_func_param, "wpml:payloadPositionIndex"
    )
    payload_position_index2.text = "0"

    return placemark


def create_mission_config(global_height):
    mission_config = ET.Element("wpml:missionConfig")

    fly_to_wayline_mode = ET.SubElement(mission_config, "wpml:flyToWaylineMode")
    fly_to_wayline_mode.text = "safely"

    finish_action = ET.SubElement(mission_config, "wpml:finishAction")
    # NOTE options:
    # goHome: Return to home / take off point.
    # noAction: Hover in place.
    # autoLand: Lands at the current location.
    # gotoFirstWaypoint: Fly back to the starting point, then hover.
    finish_action.text = str("goHome")

    # NOTE ensure the flight continues if signal lost
    exit_on_rc_lost = ET.SubElement(mission_config, "wpml:goContinue")
    exit_on_rc_lost.text = str(RCLostOptions.CONTINUE.value)

    # NOTE for now, we don't want to execute lost action other than continue
    # NOTE perhaps in future we may have user configuration
    # execute_rc_lost_action = ET.SubElement(mission_config, "wpml:executeRCLostAction")
    # execute_rc_lost_action.text = str(RCLostAction.GO_BACK.value)

    global_transitional_speed = ET.SubElement(
        mission_config, "wpml:globalTransitionalSpeed"
    )
    global_transitional_speed.text = "2.5"

    global_rth_height = ET.SubElement(mission_config, "wpml:globalRTHHeight")
    global_rth_height.text = str(global_height)

    drone_info = ET.SubElement(mission_config, "wpml:droneInfo")
    drone_enum_value = ET.SubElement(drone_info, "wpml:droneEnumValue")
    drone_enum_value.text = "68"
    drone_sub_enum_value = ET.SubElement(drone_info, "wpml:droneSubEnumValue")
    drone_sub_enum_value.text = "0"

    return mission_config


def create_folder(placemarks):
    folder = ET.Element("Folder")

    template_id = ET.SubElement(folder, "wpml:templateId")
    template_id.text = "0"

    execute_height_mode = ET.SubElement(folder, "wpml:executeHeightMode")
    execute_height_mode.text = "relativeToStartPoint"

    wayline_id = ET.SubElement(folder, "wpml:waylineId")
    wayline_id.text = "0"

    distance = ET.SubElement(folder, "wpml:distance")
    distance.text = "0"

    duration = ET.SubElement(folder, "wpml:duration")
    duration.text = "0"

    # NOTE this setting ensure we fly in a straight line & stop at the waypoint
    # NOTE not sure these settings work, so we set per point instead
    global_waypoint_turn_mode = ET.SubElement(folder, "wpml:globalWaypointTurnMode")
    global_waypoint_turn_mode.text = "toPointAndStopWithDiscontinuityCurvature"
    single_straight_line = ET.SubElement(folder, "wpml:globalUseStraightLine")
    single_straight_line.text = "1"

    auto_flight_speed = ET.SubElement(folder, "wpml:autoFlightSpeed")
    auto_flight_speed.text = "2.5"

    for placemark in placemarks:
        placemark = create_placemark(placemark)
        folder.append(placemark)

    return folder


def create_kml(mission_config, folder):
    kml = ET.Element("kml")
    kml.set("xmlns", "http://www.opengis.net/kml/2.2")
    kml.set("xmlns:wpml", "http://www.dji.com/wpmz/1.0.2")

    document = ET.SubElement(kml, "Document")
    document.append(mission_config)
    document.append(folder)

    return kml


def create_xml(placemarks, global_height, output_file_path="/tmp/"):
    mission_config = create_mission_config(global_height)
    folder = create_folder(placemarks)
    kml = create_kml(mission_config, folder)

    tree = ET.ElementTree(kml)

    folder_name = "flight"
    os.makedirs(os.path.join(output_file_path, folder_name), exist_ok=True)
    waylines_path = os.path.join(output_file_path, folder_name, "waylines.wpml")

    tree.write(waylines_path, encoding="UTF-8", xml_declaration=True)
    output_file_name = create_zip_file(os.path.join(output_file_path, folder_name))
    return output_file_name


def create_wpml(
    placemark_geojson: Union[str, FeatureCollection, dict],
    output_file_path: str = "/tmp/",
):
    """Arguments:
        placemark_geojson: The placemark coordinates to be included in the flightplan mission
        output_file_path: The output file path for the wpml file
    Returns:
        wpml file.
    """
    # global height is taken from the first point
    try:
        global_height = placemark_geojson["features"][0]["geometry"]["coordinates"][2]
    except IndexError:
        global_height = 100

    placemarks = placemark_geojson["features"]

    output_file = create_xml(placemarks, global_height, output_file_path)

    return output_file


def main(args_list: list[str] | None = None):
    parser = argparse.ArgumentParser(
        description="Generate wpml file for drone missions."
    )
    parser.add_argument(
        "--placemark",
        required=True,
        type=str,
        help="The placemark geojson file to be included in the flightplan mission",
    )
    parser.add_argument(
        "--outfile",
        required=True,
        type=str,
        help="The output file path for the wpml file",
    )
    args = parser.parse_args(args_list)

    infile = open(args.placemark, "r")
    placemarks = infile.read()

    create_wpml(geojson.loads(placemarks), args.outfile)


if __name__ == "__main__":
    main()
