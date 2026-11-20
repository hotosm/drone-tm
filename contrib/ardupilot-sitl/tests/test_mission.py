import json
import subprocess
import sys
import urllib.request

from sitl import fly_mission, upload

# The Tri-Cam plan validator, pinned to a commit of its releases repo. Bump it
# when a new Plan Loader build changes the plan rules.
TRICAM_VALIDATOR_URL = (
    "https://raw.githubusercontent.com/mrkensan/x500-tri-cam-releases/"
    "008c939045d98030fad19d4d6e521f764edc8a08/plan_development/tricam_plan_check.py"
)
FLIGHT_TIMEOUT_S = 300


def test_tricam_plan_passes_validator(plan_path, tmp_path):
    validator = tmp_path / "tricam_plan_check.py"
    urllib.request.urlretrieve(TRICAM_VALIDATOR_URL, validator)

    result = subprocess.run(
        [sys.executable, "-I", validator, "validate", plan_path, "--json"],
        check=False,  # it exits 1 on errors, reported by the asserts below
        capture_output=True,
        text=True,
    )

    report = json.loads(result.stdout)
    assert report["result"] == "OK", report["findings"]
    assert report["warnings"] == 0, report["findings"]


def test_tricam_plan_runs_every_item(gcs, mission):
    upload(gcs, mission)

    started = fly_mission(gcs, FLIGHT_TIMEOUT_S)

    # Item 0 is home, so the plan's items are numbered from 1
    assert sorted(set(started)) == list(range(1, len(mission["items"]) + 1))
