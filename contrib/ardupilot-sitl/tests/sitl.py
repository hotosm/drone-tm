"""MAVLink helpers for talking to ArduPilot SITL as a ground station."""

import math
import os

from pymavlink import mavutil

mavlink = mavutil.mavlink

SITL_HOST = os.environ.get("SITL_HOST", "127.0.0.1")
GCS_PORT = 5760  # SITL SERIAL0
VEHICLE_SYSTEM = 1
AUTOPILOT_COMPONENT = 1
DEGREES_TO_MAVLINK_INT = 1e7  # lat/lon in MISSION_ITEM_INT
REPLY_TIMEOUT_S = 5


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


def download(gcs) -> list:
    """The stored mission as MISSION_ITEM_INT messages, without home."""
    drain(gcs)
    gcs.mav.mission_request_list_send(
        VEHICLE_SYSTEM, AUTOPILOT_COMPONENT, mavlink.MAV_MISSION_TYPE_MISSION
    )
    count = gcs.recv_match(type="MISSION_COUNT", blocking=True, timeout=REPLY_TIMEOUT_S)
    assert count, "SITL did not answer the mission download"
    items = []
    for seq in range(count.count):
        gcs.mav.mission_request_int_send(
            VEHICLE_SYSTEM, AUTOPILOT_COMPONENT, seq, mavlink.MAV_MISSION_TYPE_MISSION
        )
        item = gcs.recv_match(
            type="MISSION_ITEM_INT", blocking=True, timeout=REPLY_TIMEOUT_S
        )
        assert item and item.seq == seq, f"Missing mission item {seq}"
        items.append(item)
    gcs.mav.mission_ack_send(
        VEHICLE_SYSTEM,
        AUTOPILOT_COMPONENT,
        mavlink.MAV_MISSION_ACCEPTED,
        mavlink.MAV_MISSION_TYPE_MISSION,
    )
    return items[1:]


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
