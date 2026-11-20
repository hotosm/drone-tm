"""
Create QGroundControl .plan files for the Tri-Cam capture payload.

Tri-Cam is a three-camera MAVLink payload driven by an ArduPilot mission,
using repurposed camera commands:

- #217 DO_SEND_SCRIPT_MESSAGE items: config header, before takeoff
- #531 (type 1): exposure calibration while spinning before the first line
- #2500 / #2501: start and pause survey triggering
- #532 (type 4): end the survey

Header words carry check bits, so never edit them by hand.
"""

import binascii
import json
import logging
from uuid import UUID, uuid4

import geojson
from geojson import FeatureCollection

from drone_flightplan.output.output_paths import resolve_output_path
from drone_flightplan.output.qgroundcontrol import (
    FIRMWARE_TYPE_ARDUPILOT,
    MAV_FRAME_GLOBAL_RELATIVE_ALT,
    MAV_FRAME_MISSION,
    build_plan,
    create_return_to_launch_item,
    create_simple_item,
    create_speed_change_item,
    create_takeoff_item,
    create_waypoint_item,
)

log = logging.getLogger(__name__)

CMD_HEADER_STANZA = 217  # MAV_CMD_DO_SEND_SCRIPT_MESSAGE
CMD_START_SURVEY = 2500  # MAV_CMD_VIDEO_START_CAPTURE
CMD_PAUSE_SURVEY = 2501  # MAV_CMD_VIDEO_STOP_CAPTURE
CMD_END_SURVEY = 532  # MAV_CMD_SET_CAMERA_FOCUS
END_SURVEY_TYPE = 4
CMD_CAPTURE_CONFIG = 531  # MAV_CMD_SET_CAMERA_ZOOM
CAPTURE_CONFIG_SERIES = 1
CMD_CONDITION_DELAY = 112
CMD_CONDITION_YAW = 115
CMD_LOITER_TIME = 19

# The Tri-Cam stretches this if its SD cards can't keep up, cutting overlap
PHOTO_INTERVAL_S = 1.2
# Delay after every Tri-Cam command, so MAVLink chatter can't drop one
PACING_DELAY_S = 0.1

PRE_SURVEY_AEC = 3
EXPOSURE_MODE_SHIFT = 13
AEC_FRAMES = 5  # at least 4, or the Tri-Cam discards the calibration
AEC_FRAMES_SHIFT = 16
FULL_TURN_DEG = 360
SPIN_MARGIN_S = 2  # the spin starts after a pacing delay and has to speed up
YAW_CLOCKWISE = 1
YAW_RELATIVE = 1

HEADER_MAGIC = 0x54
HEADER_VERSION = 1

STANZA_HEADER = 1
STANZA_UUID_A = 2
STANZA_UUID_B = 3
STANZA_SERIES = 4
STANZA_CHECK = 6

MIN_INTERVAL_S = 0.5
INTERVAL_STEP_S = 0.014
MAX_INTERVAL_S = 4.0
SERIES_DATA_BITS = 20
SERIES_CHECK_WIDTH = 4
CHECK_POLYNOMIAL = 0x03

FINGERPRINT_SEED = 0xFFFF

# Takeoff, return and detour placemarks have heading 0; survey lines are +-90
TRANSIT_HEADING = 0

Stanza = tuple[int, int, int, int]  # (p1 tag, W0, W1, W2)


def add_check_bits(data: int, data_bits: int, width: int) -> int:
    """Place the MSB-first CRC above the data bits of a config word.

    The register is seeded with all ones so an all-zero word never passes.
    """
    mask = (1 << width) - 1
    register = mask
    for bit in reversed(range(data_bits)):
        top = register >> (width - 1)
        register = (register << 1) & mask
        if top ^ ((data >> bit) & 1):
            register ^= CHECK_POLYNOMIAL
    return (register << data_bits) | data


def _interval_steps(interval_s: float) -> int:
    if not MIN_INTERVAL_S <= interval_s <= MAX_INTERVAL_S:
        raise ValueError(f"Tri-Cam interval must be 0.5-4.0 s, got {interval_s}")
    return round((interval_s - MIN_INTERVAL_S) / INTERVAL_STEP_S)


def encode_series_word(interval_s: float) -> int:
    """Capture Config word for a fixed-cadence survey at the given interval.

    All other fields stay 0: exposure unchanged, uncompressed, default AEC frames.
    """
    steps = _interval_steps(interval_s)
    return add_check_bits(steps, SERIES_DATA_BITS, SERIES_CHECK_WIDTH)


def encode_calibration_word(interval_s: float) -> int:
    """Capture Config word that makes the next Start run exposure calibration."""
    data = (
        _interval_steps(interval_s)
        | PRE_SURVEY_AEC << EXPOSURE_MODE_SHIFT
        | AEC_FRAMES << AEC_FRAMES_SHIFT
    )
    return add_check_bits(data, SERIES_DATA_BITS, SERIES_CHECK_WIDTH)


def fingerprint(stanzas: list[Stanza]) -> int:
    """CRC-16/CCITT-FALSE over each stanza's tag (2 bytes) then words (3 bytes each)."""
    data = b"".join(
        tag.to_bytes(2, "big") + b"".join(word.to_bytes(3, "big") for word in words)
        for tag, *words in stanzas
    )
    return binascii.crc_hqx(data, FINGERPRINT_SEED)


def build_header(mission_uuid: UUID, series_word: int) -> list[Stanza]:
    """Header stanzas in plan order, ending with the Check fingerprint."""
    if mission_uuid.bytes in (bytes(16), b"\xff" * 16):
        raise ValueError("Tri-Cam mission UUID must not be all 0x00 or all 0xFF")

    padded = mission_uuid.bytes + bytes(2)
    uuid_words = [int.from_bytes(padded[i : i + 3], "big") for i in range(0, 18, 3)]
    body = [
        (STANZA_UUID_A, *uuid_words[:3]),
        (STANZA_UUID_B, *uuid_words[3:]),
        (STANZA_SERIES, series_word, 0, 0),
    ]
    header_word = (HEADER_MAGIC << 16) | (HEADER_VERSION << 8)
    items_after_header = len(body) + 1  # the body plus the Check stanza
    stanzas = [(STANZA_HEADER, header_word, 0, items_after_header), *body]

    tagged = [
        ((stanza_type << 8) | seq, *words)
        for seq, (stanza_type, *words) in enumerate(stanzas)
    ]
    check_tag = (STANZA_CHECK << 8) | len(tagged)
    return [*tagged, (check_tag, fingerprint(tagged), 0, 0)]


def _command_item(
    command: int,
    param1: float = 0,
    param2: float = 0,
    param3: float = 0,
    param4: float = 0,
) -> dict:
    """A non-navigation mission item with unused params written as 0."""
    return create_simple_item(
        command=command,
        frame=MAV_FRAME_MISSION,
        latitude=0,
        longitude=0,
        altitude=0,
        param1=param1,
        param2=param2,
        param3=param3,
        param4=param4,
    )


def _paced_command(command: int, param1: float = 0, param2: float = 0) -> list[dict]:
    return [
        _command_item(command, param1, param2),
        _command_item(CMD_CONDITION_DELAY, PACING_DELAY_S),
    ]


def _calibration_items(
    latitude: float, longitude: float, altitude: float, interval_s: float
) -> list[dict]:
    """Spin in place while the Tri-Cam calibrates exposure for the day's light.

    Start begins the calibration and Pause ends it. The spin lasts long enough
    for AEC_FRAMES photos, and the caller then sends the survey's own Start.
    """
    spin_s = AEC_FRAMES * interval_s
    return [
        *_paced_command(
            CMD_CAPTURE_CONFIG,
            CAPTURE_CONFIG_SERIES,
            encode_calibration_word(interval_s),
        ),
        *_paced_command(CMD_START_SURVEY),
        _command_item(
            CMD_CONDITION_YAW,
            FULL_TURN_DEG,
            FULL_TURN_DEG / spin_s,
            YAW_CLOCKWISE,
            YAW_RELATIVE,
        ),
        create_simple_item(
            command=CMD_LOITER_TIME,
            frame=MAV_FRAME_GLOBAL_RELATIVE_ALT,
            latitude=latitude,
            longitude=longitude,
            altitude=altitude,
            param1=spin_s + SPIN_MARGIN_S,
            param4=0,  # ArduPilot rejects the default NaN here
        ),
        *_paced_command(CMD_PAUSE_SURVEY),
    ]


def _survey_command(headings: list[float], index: int) -> int | None:
    """Tri-Cam command to run on reaching placemark `index`, if any.

    A survey line is a run of placemarks sharing a non-transit heading. A
    single placemark has no line to survey, so it gets no command.
    """
    heading = headings[index]
    if heading == TRANSIT_HEADING:
        return None
    starts = index == 0 or headings[index - 1] != heading
    ends = index == len(headings) - 1 or headings[index + 1] != heading
    if starts and ends:
        return None
    if starts:
        return CMD_START_SURVEY
    if ends:
        return CMD_PAUSE_SURVEY
    return None


def create_tricam_plan(
    placemark_geojson: str | FeatureCollection | dict,
    mission_uuid: UUID | None = None,
    output_file_path: str | None = None,
    photo_interval_time: float = PHOTO_INTERVAL_S,
) -> str:
    """Generate an ArduPilot QGC .plan file that drives a Tri-Cam survey.

    The drone spins at the first line start to calibrate exposure, and End
    Survey replaces the last Pause, so the return transit has no photos.
    Every Tri-Cam command is followed by a short pacing delay.

    Args:
        placemark_geojson: Waylines placemarks from `build_placemarks`
        mission_uuid: Identity of the survey, new by default. Reuse it when
            re-flying the same plan.
        output_file_path: Path for the .plan file. Defaults to a temporary
            file, which the caller is responsible for removing.
        photo_interval_time: Seconds between photos, 0.5 to 4.0

    Returns:
        Path to the created plan file
    """
    if isinstance(placemark_geojson, str):
        placemark_geojson = geojson.loads(placemark_geojson)

    features = placemark_geojson.get("features", [])
    if not features:
        raise ValueError("No waypoints found in GeoJSON")

    mission_uuid = mission_uuid or uuid4()
    series_word = encode_series_word(photo_interval_time)
    mission_items = [
        _command_item(CMD_HEADER_STANZA, *stanza)
        for stanza in build_header(mission_uuid, series_word)
    ]

    home_longitude, home_latitude = features[0]["geometry"]["coordinates"][:2]
    home_altitude = float(features[0]["properties"].get("altitude", 50))
    headings = [f["properties"].get("heading", TRANSIT_HEADING) for f in features]
    commands = [_survey_command(headings, i) for i in range(len(features))]
    if CMD_START_SURVEY not in commands:
        raise ValueError("No survey lines found in placemarks")
    first_line_start = commands.index(CMD_START_SURVEY)

    # ArduCopter climbs from wherever it is, so the first placemark also needs
    # a waypoint. Without one, Start would fire before reaching the first line.
    mission_items.append(
        create_takeoff_item(home_latitude, home_longitude, home_altitude)
    )
    if "speed" in features[0]["properties"]:
        speed = float(features[0]["properties"]["speed"])
        mission_items.append(create_speed_change_item(speed))

    for index, feature in enumerate(features):
        longitude, latitude = feature["geometry"]["coordinates"][:2]
        altitude = float(feature["properties"].get("altitude", home_altitude))
        mission_items.append(create_waypoint_item(latitude, longitude, altitude))

        if index == first_line_start:
            mission_items.extend(
                _calibration_items(latitude, longitude, altitude, photo_interval_time)
            )
        if commands[index] is not None:
            mission_items.extend(_paced_command(commands[index]))

    pauses = [
        i for i, item in enumerate(mission_items) if item["command"] == CMD_PAUSE_SURVEY
    ]
    mission_items[pauses[-1]] = _command_item(CMD_END_SURVEY, END_SURVEY_TYPE)

    mission_items.append(create_return_to_launch_item())

    plan = build_plan(
        mission_items,
        [home_latitude, home_longitude, home_altitude],
        firmware_type=FIRMWARE_TYPE_ARDUPILOT,
    )

    output_file_path = resolve_output_path(output_file_path, suffix=".plan")
    with open(output_file_path, "w") as f:
        json.dump(plan, f, indent=2)

    log.info(f"Created Tri-Cam plan {mission_uuid} at {output_file_path}")
    return output_file_path
