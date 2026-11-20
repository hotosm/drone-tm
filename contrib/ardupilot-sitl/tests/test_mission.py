from drone_flightplan.output.tricam import CMD_HEADER_STANZA
from sitl import download, upload


def test_tricam_plan_is_stored_unchanged(gcs, mission):
    upload(gcs, mission)

    stored = download(gcs)
    assert [item.command for item in stored] == [
        item["command"] for item in mission["items"]
    ]
    stored_header = [
        [item.param1, item.param2, item.param3, item.param4]
        for item in stored
        if item.command == CMD_HEADER_STANZA
    ]
    planned_header = [
        item["params"][:4]
        for item in mission["items"]
        if item["command"] == CMD_HEADER_STANZA
    ]
    assert stored_header == planned_header
