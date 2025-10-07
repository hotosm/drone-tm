import argparse
import logging
import os
import xml.etree.ElementTree as ET
import zipfile
from typing import Optional
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
    """Add a takePhoto action to an actionGroup."""
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


def set_gimbal_pitch_and_roll(function_params: Element, gimbal_angle: str):
    """Adjust gimbal pitch and roll angles."""
    gimbal_pitch_rotate_angle = ET.SubElement(
        function_params, "wpml:gimbalPitchRotateAngle"
    )
    gimbal_roll_rotate_enable = ET.SubElement(
        function_params, "wpml:gimbalRollRotateEnable"
    )
    gimbal_roll_rotate_angle = ET.SubElement(
        function_params, "wpml:gimbalRollRotateAngle"
    )

    # If gimbal_angle is -45 oblique, set the pitch to -90 and the roll -45
    # This ensures the gimbal is in the correct position for sideward shots
    # if str(gimbal_angle) == "-45":
    #     gimbal_pitch_rotate_angle.text = "-90"
    #     gimbal_roll_rotate_enable.text = "0"
    #     gimbal_roll_rotate_angle.text = "-45"
    # else:
    # NOTE for now we just adjust pitch, no roll (i.e. straight forward shots)
    # Default is to just adjust the pitch to point downwards
    # With no roll (sidewards movement)
    gimbal_pitch_rotate_angle.text = str(gimbal_angle)
    gimbal_roll_rotate_enable.text = "0"
    gimbal_roll_rotate_angle.text = "0"


def gimbal_rotate_action(
    parent: Element,
    group_id: str,
    gimbal_angle: str,
    smooth: bool = False,
    index: str = "0",
):
    """Create an action (or action group) that rotates the gimbal to a target angle.

    If `smooth` is True, the gimbal moves smoothly using gimbalEvenlyRotate.
    Otherwise, it rotates immediately using gimbalRotate.

    We support both pitch-only and oblique (pitch + roll) cases.
    """
    if smooth:
        # Smooth rotation - wrap in an action group
        group = create_action_group(
            parent,
            group_id=group_id,
            start_index="0",
            end_index="1",
            mode="parallel",
            trigger_type="reachPoint",
        )
        action_parent = group
        func_name = "gimbalEvenlyRotate"
        action_id_value = str(index)
    else:
        # Immediate rotation - add directly to existing group
        action_parent = parent
        func_name = "gimbalRotate"
        action_id_value = str(index)

    # Create the action element
    action = ET.SubElement(action_parent, "wpml:action")
    action_id = ET.SubElement(action, "wpml:actionId")
    action_id.text = action_id_value

    func = ET.SubElement(action, "wpml:actionActuatorFunc")
    func.text = func_name

    params = ET.SubElement(action, "wpml:actionActuatorFuncParam")

    if not smooth:
        # Additional parameters for immediate rotation mode
        gimbal_heading_yaw_base = ET.SubElement(params, "wpml:gimbalHeadingYawBase")
        gimbal_heading_yaw_base.text = "aircraft"

        gimbal_rotate_mode = ET.SubElement(params, "wpml:gimbalRotateMode")
        gimbal_rotate_mode.text = "absoluteAngle"

        gimbal_pitch_rotate_enable = ET.SubElement(
            params, "wpml:gimbalPitchRotateEnable"
        )
        gimbal_pitch_rotate_enable.text = "1"

    # Common pitch + roll setup
    set_gimbal_pitch_and_roll(params, str(gimbal_angle))

    # Always keep yaw + timing disabled unless explicitly needed
    gimbal_yaw_rotate_enable = ET.SubElement(params, "wpml:gimbalYawRotateEnable")
    gimbal_yaw_rotate_enable.text = "0"

    gimbal_yaw_rotate_angle = ET.SubElement(params, "wpml:gimbalYawRotateAngle")
    gimbal_yaw_rotate_angle.text = "0"

    gimbal_rotate_time_enable = ET.SubElement(params, "wpml:gimbalRotateTimeEnable")
    gimbal_rotate_time_enable.text = "0"

    gimbal_rotate_time = ET.SubElement(params, "wpml:gimbalRotateTime")
    gimbal_rotate_time.text = "0"

    payload_position_index = ET.SubElement(params, "wpml:payloadPositionIndex")
    payload_position_index.text = "0"

    return action_parent


def create_action_group(
    parent: Element,
    group_id: str,
    start_index: str,
    end_index: str,
    mode: str,
    trigger_type: str,
    trigger_param: Optional[str] = None,
) -> Element:
    """Utility to create an actionGroup with trigger and return it."""
    action_group = ET.SubElement(parent, "wpml:actionGroup")

    gid = ET.SubElement(action_group, "wpml:actionGroupId")
    gid.text = str(group_id)

    gstart = ET.SubElement(action_group, "wpml:actionGroupStartIndex")
    gstart.text = str(start_index)

    gend = ET.SubElement(action_group, "wpml:actionGroupEndIndex")
    gend.text = str(end_index)

    gmode = ET.SubElement(action_group, "wpml:actionGroupMode")
    gmode.text = mode

    trigger = ET.SubElement(action_group, "wpml:actionTrigger")
    trigger_type_el = ET.SubElement(trigger, "wpml:actionTriggerType")
    trigger_type_el.text = trigger_type

    if trigger_param is not None:
        trigger_param_el = ET.SubElement(trigger, "wpml:actionTriggerParam")
        trigger_param_el.text = str(trigger_param)

    return action_group


def create_photo_interval_group(
    parent: Element,
    group_id: str,
    index: int,
    interval_sec: int = 2,
    stop: bool = False,
):
    """Create a group that starts or stops the photo interval timer."""
    trigger_type = "multipleTiming"
    trigger_param = (
        interval_sec if not stop else "0"
    )  # NOTE DJI convention: param=0 stops interval

    group = create_action_group(
        parent,
        group_id=group_id,
        start_index=str(index),
        end_index=str(index),
        mode="parallel",
        trigger_type=trigger_type,
        trigger_param=str(trigger_param),
    )

    # Add takePhoto action if starting
    if not stop:
        take_photo_action(group, "1")

    return group


def create_placemark(placemark, final_index: int):
    """Build Placemark element with gimbal/photo actions depending on waypoint properties."""
    try:
        index = placemark["properties"]["index"]
        coordinate = placemark["geometry"]["coordinates"]
        coordinates = f"{coordinate[0]},{coordinate[1]}"
        execute_height = str(coordinate[2])
        waypoint_speed = placemark["properties"]["speed"]
        waypoint_heading_angle = placemark["properties"]["heading"]
        gimbal_angle = placemark["properties"]["gimbal_angle"]
        print(gimbal_angle)
        take_photo = placemark["properties"]["take_photo"]
    except IndexError as e:
        raise ValueError(str(e))

    placemark_el = ET.Element("Placemark")

    # Basic waypoint elements
    point = ET.SubElement(placemark_el, "Point")
    coordinates_elem = ET.SubElement(point, "coordinates")
    coordinates_elem.text = coordinates

    wpml_index = ET.SubElement(placemark_el, "wpml:index")
    wpml_index.text = str(index)

    execute_height_elem = ET.SubElement(placemark_el, "wpml:executeHeight")
    execute_height_elem.text = str(execute_height)

    waypoint_speed_elem = ET.SubElement(placemark_el, "wpml:waypointSpeed")
    waypoint_speed_elem.text = str(waypoint_speed)

    # Set direction the drone is facing (i.e. the heading)
    waypoint_heading_param = ET.SubElement(placemark_el, "wpml:waypointHeadingParam")
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

    # NOTE if we need swap the heading mode (i.e. for future object tracking etc)
    # wpml_waypoint_heading_path_mode = ET.SubElement(
    #     waypoint_heading_param, "wpml:waypointHeadingPathMode"
    # )
    # wpml_waypoint_heading_path_mode.text = "followBadArc"

    # Ensure the drone turns in straight lines for mapping, not curves
    wpml_waypoint_turn_param = ET.SubElement(placemark_el, "wpml:waypointTurnParam")
    wpml_waypoint_turn_mode = ET.SubElement(
        wpml_waypoint_turn_param, "wpml:waypointTurnMode"
    )
    wpml_waypoint_turn_mode.text = "toPointAndStopWithDiscontinuityCurvature"

    wpml_waypoint_turn_damping_dist = ET.SubElement(
        wpml_waypoint_turn_param, "wpml:waypointTurnDampingDist"
    )
    wpml_waypoint_turn_damping_dist.text = "0"

    use_straight_line = ET.SubElement(placemark_el, "wpml:useStraightLine")
    use_straight_line.text = "1"

    # Action groups
    action_group1 = create_action_group(
        placemark_el,
        group_id="1",
        start_index=index,
        end_index=index,
        mode="parallel",
        trigger_type="reachPoint",
    )

    if take_photo:
        # Take photo action, for waypoint mode
        take_photo_action(action_group1, "1")
    else:
        # Gimbal rotate action (immediate), prior to setting photo interval timer
        gimbal_rotate_action(action_group1, "1", str(gimbal_angle))

        # FIXME we are trying to enable and disable the photo capture interval
        # FIXME timer, but this implementation doesn't work
        # FIXME see https://github.com/hotosm/drone-tm/issues/612
        #
        # # start photo interval timer on second waypoint
        # # the first waypoint is the takeoff point, so we don't want photos immediately
        # # the second waypoint is the start of the waypoint mission grid
        # if index == 1:
        #     set_shoot_type_timed = ET.SubElement(placemark_el, "wpml:shootType")
        #     set_shoot_type_timed.text = "time"
        #     create_photo_interval_group(
        #         placemark_el, group_id="2", index=index, stop=False
        #     )

        # # stop interval capture on the final waypoint
        # if index == final_index:
        #     set_shoot_type_timed = ET.SubElement(placemark_el, "wpml:shootType")
        #     # NOTE try and disable the shootType=time interval timer
        #     set_shoot_type_timed.text = ""
        #     create_photo_interval_group(
        #         placemark_el, group_id="99", index=index, stop=True
        #     )
        #     take_photo_action(action_group1, "1")

    # Final action group = smoothly rotate the gimbal toward the target angle
    gimbal_rotate_action(
        placemark_el, group_id="3", gimbal_angle=str(gimbal_angle), smooth=True
    )

    return placemark_el


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

    # # NOTE ensure the flight continues if signal lost
    execute_exit_on_rc_lost = ET.SubElement(mission_config, "wpml:exitOnRCLost")
    execute_exit_on_rc_lost.text = str(RCLostOptions.CONTINUE.value)
    # NOTE for now we don't need a configurable lost action, as want to ensure
    # the flight continues every time (especially in hilly terrain)
    # execute_exit_on_rc_lost.text = str(RCLostOptions.EXECUTE_LOST_ACTION.value)
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

    final_placemark_index = len(placemarks) - 1
    for placemark in placemarks:
        placemark = create_placemark(placemark, final_placemark_index)
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
    placemark_geojson: str | FeatureCollection | dict,
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
