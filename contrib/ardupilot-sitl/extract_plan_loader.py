"""Extract the Tri-Cam Plan Loader (Lua) from a KB2040 firmware .uf2.

The KB2040 normally installs it on the flight controller itself. This is for
testing on a flight controller without a Tri-Cam. Compare the printed build,
size and CRC with the KB2040 release notes.

Usage: python3 extract_plan_loader.py tri_cam_kb2040.uf2 tricam_plan_loader.lua
"""

import re
import sys
import zlib

UF2_BLOCK_SIZE = 512
UF2_PAYLOAD_START = 32
UF2_PAYLOAD_SIZE = 256
# The script is stored as plain text, the only long printable run with a BUILD
LUA_SCRIPT = re.compile(rb"[\t\n\r\x20-\x7e]{1000,}")
BUILD = re.compile(rb"^local BUILD = (\d+)$", re.MULTILINE)


def firmware_image(uf2: bytes) -> bytes:
    return b"".join(
        uf2[offset + UF2_PAYLOAD_START : offset + UF2_PAYLOAD_START + UF2_PAYLOAD_SIZE]
        for offset in range(0, len(uf2), UF2_BLOCK_SIZE)
    )


def ardupilot_crc32(data: bytes) -> int:
    """CRC32 as ArduPilot's MAVFTP computes it, without the final inversion."""
    return ~zlib.crc32(data, 0xFFFFFFFF) & 0xFFFFFFFF


def main(uf2_path: str, lua_path: str):
    with open(uf2_path, "rb") as f:
        image = firmware_image(f.read())
    scripts = [m.group() for m in LUA_SCRIPT.finditer(image) if BUILD.search(m.group())]
    if len(scripts) != 1:
        sys.exit(f"Expected one Plan Loader in {uf2_path}, found {len(scripts)}")

    script = scripts[0]
    with open(lua_path, "wb") as f:
        f.write(script)
    build = BUILD.search(script).group(1).decode()
    print(
        f"Plan Loader build {build}, {len(script)} bytes, CRC {ardupilot_crc32(script):08X}"
    )


if __name__ == "__main__":
    main(*sys.argv[1:])
