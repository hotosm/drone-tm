from sitl import fly_mission, upload

FLIGHT_TIMEOUT_S = 300


def test_tricam_plan_runs_every_item(gcs, mission):
    upload(gcs, mission)

    started = fly_mission(gcs, FLIGHT_TIMEOUT_S)

    # Item 0 is home, so the plan's items are numbered from 1
    assert sorted(set(started)) == list(range(1, len(mission["items"]) + 1))
