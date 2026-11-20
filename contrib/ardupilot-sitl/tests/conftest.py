"""Fixtures for tests against ArduPilot SITL, run with `just test sitl`.

SITL serves one ground station on TCP 5760 and exits when it disconnects, so
the connection is shared by the whole session.
"""

import json
import os

# Must be set before pymavlink is imported. Extension fields such as
# COMMAND_ACK.result_param2 only exist in MAVLink 2.
os.environ["MAVLINK20"] = "1"

import pytest
from drone_flightplan.create_flightplan import build_placemarks
from drone_flightplan.drone_type import DroneType
from drone_flightplan.output.tricam import create_tricam_plan
from pymavlink import mavutil
from sitl import GCS_PORT, SITL_HOST

GCS_SYSTEM = 255
GCS_COMPONENT = 190
BOOT_TIMEOUT_S = 60
READY_TEXT = "ArduPilot Ready"  # missions can be uploaded from here on

AOI = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [85.3230, 27.7165],
                        [85.3250, 27.7165],
                        [85.3250, 27.7180],
                        [85.3230, 27.7180],
                        [85.3230, 27.7165],
                    ]
                ],
            },
        }
    ],
}
TAKE_OFF_POINT = [85.3240, 27.7172]


@pytest.fixture(scope="session")
def gcs():
    conn = mavutil.mavlink_connection(
        f"tcp:{SITL_HOST}:{GCS_PORT}",
        source_system=GCS_SYSTEM,
        source_component=GCS_COMPONENT,
    )
    if not conn.wait_heartbeat(timeout=BOOT_TIMEOUT_S):
        pytest.exit(f"No SITL heartbeat on {SITL_HOST}:{GCS_PORT}", returncode=1)
    # ArduPilot only sends STATUSTEXT to channels it has received from
    conn.mav.heartbeat_send(
        mavutil.mavlink.MAV_TYPE_GCS, mavutil.mavlink.MAV_AUTOPILOT_INVALID, 0, 0, 0
    )
    ready = conn.recv_match(
        type="STATUSTEXT",
        condition=f"STATUSTEXT.text=='{READY_TEXT}'",
        blocking=True,
        timeout=BOOT_TIMEOUT_S,
    )
    if not ready:
        pytest.exit("SITL did not finish booting", returncode=1)
    yield conn
    conn.close()


@pytest.fixture(scope="session")
def placemarks():
    placemarks, _ = build_placemarks(
        AOI,
        forward_overlap=70,
        side_overlap=70,
        agl=None,
        gsd=2,
        take_off_point=TAKE_OFF_POINT,
        drone_type=DroneType.TRICAM,
    )
    return placemarks


@pytest.fixture
def mission(placemarks, tmp_path) -> dict:
    """The `mission` block of a fresh Tri-Cam plan."""
    path = create_tricam_plan(placemarks, output_file_path=str(tmp_path / "test.plan"))
    with open(path) as f:
        return json.load(f)["mission"]
