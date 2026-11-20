"""MAVLink helpers for talking to ArduPilot SITL as a ground station."""

import math
import os
import re
import time

from pymavlink import mavutil

mavlink = mavutil.mavlink

SITL_HOST = os.environ.get("SITL_HOST", "127.0.0.1")
GCS_PORT = 5760  # SITL SERIAL0
VEHICLE_SYSTEM = 1
AUTOPILOT_COMPONENT = 1
DEGREES_TO_MAVLINK_INT = 1e7  # lat/lon in MISSION_ITEM_INT
REPLY_TIMEOUT_S = 5
COPTER_MODE_AUTO = 3
ARM_RETRY_S = 5  # arming fails until the EKF has a GPS fix
MISSION_TEXT = re.compile(r"Mission: (\d+) ")


def drain(gcs):
    while gcs.recv_match(blocking=False):
        pass


def upload(gcs, mission: dict):
    """Upload plan items over the MAVLink mission protocol, as QGC would."""
    home_lat, home_lon, _ = mission["plannedHomePosition"]
    home = {
        "command": mavlink.MAV_CMD_NAV_WAYPOINT,
        "frame": mavlink.MAV_FRAME_GLOBAL,
        "params": [0, 0, 0, 0, home_lat, home_lon, 0],
    }
    items = [home, *mission["items"]]  # ArduPilot keeps home as item 0

    drain(gcs)
    gcs.mav.mission_count_send(
        VEHICLE_SYSTEM,
        AUTOPILOT_COMPONENT,
        len(items),
        mavlink.MAV_MISSION_TYPE_MISSION,
    )
    while True:
        msg = gcs.recv_match(
            type=["MISSION_REQUEST_INT", "MISSION_REQUEST", "MISSION_ACK"],
            blocking=True,
            timeout=REPLY_TIMEOUT_S,
        )
        assert msg, "SITL stopped answering the mission upload"
        if msg.get_type() == "MISSION_ACK":
            assert msg.type == mavlink.MAV_MISSION_ACCEPTED, f"Upload rejected: {msg}"
            return
        _send_item(gcs, msg.seq, items[msg.seq])


def set_param(gcs, name: str, value: float):
    gcs.mav.param_set_send(
        VEHICLE_SYSTEM,
        AUTOPILOT_COMPONENT,
        name.encode(),
        value,
        mavlink.MAV_PARAM_TYPE_REAL32,
    )
    reply = gcs.recv_match(
        type="PARAM_VALUE",
        condition=f"PARAM_VALUE.param_id=='{name}'",
        blocking=True,
        timeout=REPLY_TIMEOUT_S,
    )
    assert reply and reply.param_value == value, f"Could not set {name}"


def fly_mission(gcs, timeout_s: float) -> list[int]:
    """Arm in AUTO, fly the uploaded mission until it disarms after landing.

    Returns the mission item numbers ArduPilot started, in order.
    """
    set_param(gcs, "AUTO_OPTIONS", 3)  # arm and take off in AUTO, no RC sticks
    gcs.mav.set_mode_send(
        VEHICLE_SYSTEM, mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, COPTER_MODE_AUTO
    )
    started = []
    armed = False
    next_arm_attempt = 0.0
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if not armed and time.monotonic() > next_arm_attempt:
            gcs.arducopter_arm()
            next_arm_attempt = time.monotonic() + ARM_RETRY_S
        msg = gcs.recv_match(type=["STATUSTEXT", "HEARTBEAT"], blocking=True, timeout=1)
        if msg is None:
            continue
        if msg.get_type() == "STATUSTEXT":
            match = MISSION_TEXT.match(msg.text)
            if match:
                started.append(int(match.group(1)))
        elif msg.get_srcComponent() == AUTOPILOT_COMPONENT:
            is_armed = bool(msg.base_mode & mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
            if armed and not is_armed:
                return started
            armed = is_armed
    raise AssertionError(f"Mission did not finish within {timeout_s}s")


def _send_item(gcs, seq: int, item: dict):
    # QGC writes NaN params (e.g. "keep current yaw") as JSON null
    params = [math.nan if p is None else p for p in item["params"]]
    p1, p2, p3, p4, x, y, z = params
    if item["frame"] != mavlink.MAV_FRAME_MISSION:
        x, y = round(x * DEGREES_TO_MAVLINK_INT), round(y * DEGREES_TO_MAVLINK_INT)
    gcs.mav.mission_item_int_send(
        VEHICLE_SYSTEM, AUTOPILOT_COMPONENT, seq, item["frame"], item["command"],
        current=0, autocontinue=1,
        param1=p1, param2=p2, param3=p3, param4=p4, x=int(x), y=int(y), z=z,
        mission_type=mavlink.MAV_MISSION_TYPE_MISSION,
    )  # fmt: skip
