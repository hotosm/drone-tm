import os
import uuid
import zipfile
import xml.etree.ElementTree as ET
from shapely.geometry import Polygon
from app.models.enums import DroneType
from math import radians, sin, cos, sqrt, atan2
from xml.etree.ElementTree import Element


def haversine_distance(coord1, coord2):
    # Haversine formula for great-circle distance
    lon1, lat1 = map(radians, coord1)
    lon2, lat2 = map(radians, coord2)

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    # Radius of Earth in kilometers
    radius = 6371.0
    distance = radius * c

    return distance


async def get_drone_specs(drone_type: DroneType):
    if drone_type == DroneType.DJI_MINI_4_PRO:
        drone_specs = {
            "sensor_width": 9.6,  # mm
            "sensor_height": 7.2,  # mm
            "sensor_diagonal": 12.0,  # mm
            "image_width": 4032,  # pixels
            "image_height": 3024,  # pixels
            "focal_length": 6.7,  # mm
            "sensor_size": "1/1.3",
        }
    else:
        drone_specs = None
    return drone_specs


async def calculate_gsd(drone_type: DroneType, flight_altitude: int):
    drone_specs = await get_drone_specs(drone_type)

    # gsd = (sensor_width * flight_altitude * 100) / (focal_length * image_width)
    gsd = (drone_specs["sensor_width"] * flight_altitude * 100) / (
        drone_specs["focal_length"] * drone_specs["image_width"]
    )
    return gsd  # (cm/pixel)


async def calculate_drone_flying_speed(
    flight_altitude: float, drone_type: DroneType, image_interval: int, overlap: float
):
    # Calculate the ground sampling distance (GSD)
    gsd = await calculate_gsd(drone_type, flight_altitude)

    drone_specs = await get_drone_specs(drone_type)

    # calculate vertical image footprint
    vertical_image_footprint = (gsd * drone_specs["image_height"]) / 100

    # Calculate the drone flying speed
    drone_flying_speed = (vertical_image_footprint / (100 / (100 - overlap))) / (
        image_interval + 0.1
    )

    return drone_flying_speed


async def calculate_distance_between_2_lines(
    overlap: float, drone_type: DroneType, flight_altitude: float
):
    gsd = await calculate_gsd(drone_type, flight_altitude)
    drone_specs = await get_drone_specs(drone_type)
    image_width_in_pixels = drone_specs["image_width"]
    overlap_fraction = overlap / 100
    image_width_in_cm = gsd * image_width_in_pixels
    overlap_distance_in_cm = image_width_in_cm * (1 - overlap_fraction)
    return overlap_distance_in_cm / 100  # return in metre


def zip_directory(directory_path, zip_path):
    with zipfile.ZipFile(zip_path, "w") as zipf:
        for root, dirs, files in os.walk(directory_path):
            for file in files:
                zipf.write(
                    os.path.join(root, file),
                    os.path.relpath(
                        os.path.join(root, file), os.path.join(directory_path, "..")
                    ),
                )


def create_zip_file(waylines_path_uid):
    # Create the wpmz folder if it doesn't exist
    wpmz_path = f"/tmp/{waylines_path_uid}/wpmz"
    os.makedirs(wpmz_path, exist_ok=True)

    import xml.etree.ElementTree as ET

    xml_string = """<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
      <Document>
        <wpml:author>fly</wpml:author>
        <wpml:createTime>1702051864938</wpml:createTime>
        <wpml:updateTime>1702051864938</wpml:updateTime>
        <wpml:missionConfig>
          <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
          <wpml:finishAction>noAction</wpml:finishAction>
          <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
          <wpml:executeRCLostAction>hover</wpml:executeRCLostAction>
          <wpml:globalTransitionalSpeed>2.5</wpml:globalTransitionalSpeed>
          <wpml:droneInfo>
            <wpml:droneEnumValue>68</wpml:droneEnumValue>
            <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>
          </wpml:droneInfo>
        </wpml:missionConfig>
      </Document>
    </kml>
    """

    # Parse the XML string
    root = ET.fromstring(xml_string)

    # Create an ElementTree object
    tree = ET.ElementTree(root)

    # Write the ElementTree object to a file
    with open(f"{wpmz_path}/template.kml", "wb") as file:
        tree.write(file, encoding="utf-8", xml_declaration=True)

    # Read content of template.kml
    with open(f"/tmp/{waylines_path_uid}/waylines.wpml", "r") as f:
        wpml_content = f.read()

    with open(f"{wpmz_path}/waylines.wpml", "w") as f:
        f.write(wpml_content)

    # Create a Zip file containing the contents of the wpmz folder directly
    output_file_name = f"/tmp/{waylines_path_uid}/output.kmz"
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


def gimble_rotate_action(
    action_group_element: Element, index: str, gimble_pitch_rotate_angle: str
):
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
    gimbal_pitch_rotate_angle.text = str(gimble_pitch_rotate_angle)
    gimbal_roll_rotate_enable = ET.SubElement(
        action1_actuator_func_param, "wpml:gimbalRollRotateEnable"
    )
    gimbal_roll_rotate_enable.text = "0"
    gimbal_roll_rotate_angle = ET.SubElement(
        action1_actuator_func_param, "wpml:gimbalRollRotateAngle"
    )
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


def create_placemark(
    index,
    coordinates,
    execute_height,
    waypoint_speed,
    waypoint_heading_angle,
    gimble_angle,
    take_photo: bool = False,
):
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
    wpml_waypoint_heading_path_mode = ET.SubElement(
        waypoint_heading_param, "wpml:waypointHeadingPathMode"
    )
    wpml_waypoint_heading_path_mode.text = "followBadArc"

    wpml_waypoint_turn_param = ET.SubElement(placemark, "wpml:waypointTurnParam")
    wpml_waypoint_turn_mode = ET.SubElement(
        wpml_waypoint_turn_param, "wpml:waypointTurnMode"
    )
    wpml_waypoint_turn_mode.text = "toPointAndStopWithContinuityCurvature"
    wpml_waypoint_turn_damping_dist = ET.SubElement(
        wpml_waypoint_turn_param, "wpml:waypointTurnDampingDist"
    )
    wpml_waypoint_turn_damping_dist.text = "0"

    use_straight_line = ET.SubElement(placemark, "wpml:useStraightLine")
    use_straight_line.text = "0"

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
        gimble_rotate_action(action_group1, "1", "-90")

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
    gimbal_pitch_rotate_angle2.text = str(gimble_angle)
    payload_position_index2 = ET.SubElement(
        action2_actuator_func_param, "wpml:payloadPositionIndex"
    )
    payload_position_index2.text = "0"

    return placemark


def create_mission_config(finish_action_value):
    mission_config = ET.Element("wpml:missionConfig")

    fly_to_wayline_mode = ET.SubElement(mission_config, "wpml:flyToWaylineMode")
    fly_to_wayline_mode.text = "safely"

    finish_action = ET.SubElement(mission_config, "wpml:finishAction")
    finish_action.text = str(finish_action_value)

    exit_on_rc_lost = ET.SubElement(mission_config, "wpml:exitOnRCLost")
    exit_on_rc_lost.text = "executeLostAction"

    execute_rc_lost_action = ET.SubElement(mission_config, "wpml:executeRCLostAction")
    execute_rc_lost_action.text = "hover"

    global_transitional_speed = ET.SubElement(
        mission_config, "wpml:globalTransitionalSpeed"
    )
    global_transitional_speed.text = "2.5"

    drone_info = ET.SubElement(mission_config, "wpml:droneInfo")
    drone_enum_value = ET.SubElement(drone_info, "wpml:droneEnumValue")
    drone_enum_value.text = "68"
    drone_sub_enum_value = ET.SubElement(drone_info, "wpml:droneSubEnumValue")
    drone_sub_enum_value.text = "0"

    return mission_config


def create_folder(placemarks, generate_each_points):
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

    auto_flight_speed = ET.SubElement(folder, "wpml:autoFlightSpeed")
    auto_flight_speed.text = "2.5"

    for index, placemark_data in enumerate(placemarks):
        placemark = create_placemark(index, *placemark_data, generate_each_points)
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


def create_xml(placemarks, finish_action, generate_each_points: bool = False):
    mission_config = create_mission_config(finish_action)
    folder = create_folder(placemarks, generate_each_points)
    kml = create_kml(mission_config, folder)

    tree = ET.ElementTree(kml)

    folder_name = str(uuid.uuid4())
    os.makedirs(os.path.join("/tmp/", folder_name), exist_ok=True)
    waylines_path = os.path.join("/tmp/", folder_name, "waylines.wpml")

    tree.write(waylines_path, encoding="UTF-8", xml_declaration=True)
    output_file_name = create_zip_file(folder_name)
    return output_file_name


async def generate_waypoints_within_polygon(
    aoi, distance_between_lines, generate_each_points
):
    # 1 degree = 111 km
    # 1 km = 1/111 degree
    # 1 metre = 1/111000 degree

    distance_between_lines = 1 / 111000 * distance_between_lines

    polygon = Polygon(aoi["features"][0]["geometry"]["coordinates"][0])

    minx, miny, maxx, maxy = polygon.bounds
    waypoints = []

    # Generate waypoints within the polygon
    y = miny
    row_count = 0
    angle = -90

    # Extend the loop by one iteration so that the point will be outside the polygon
    while y <= maxy + distance_between_lines:
        x = minx
        x_row_waypoints = []

        while x <= maxx + distance_between_lines:
            x_row_waypoints.append({"coordinates": (x, y), "angle": str(angle)})
            x += distance_between_lines
        y += distance_between_lines

        if generate_each_points:
            if row_count % 2 == 0:
                waypoints.extend(x_row_waypoints)
            else:
                waypoints.extend(reversed(x_row_waypoints))
        else:
            # Add waypoints ensuring at least two points at each end of the line
            if x_row_waypoints:
                if row_count % 2 == 0:
                    waypoints.append(x_row_waypoints[0])
                    if len(x_row_waypoints) > 1:
                        waypoints.append(x_row_waypoints[1])  # Append second point
                    if len(x_row_waypoints) > 2:
                        waypoints.append(
                            x_row_waypoints[-2]
                        )  # Append second-to-last point
                        waypoints.append(x_row_waypoints[-1])  # Append last point
                else:
                    if len(x_row_waypoints) > 2:
                        waypoints.append(x_row_waypoints[-1])  # Append last point
                        waypoints.append(
                            x_row_waypoints[-2]
                        )  # Append second-to-last point
                    if len(x_row_waypoints) > 1:
                        waypoints.append(x_row_waypoints[1])  # Append second point
                    waypoints.append(x_row_waypoints[0])  # Append first point

        row_count += 1
        angle = angle * -1

    return waypoints
