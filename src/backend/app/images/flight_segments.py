"""Shared SQL for splitting a task's imagery into per-aircraft flight passes."""

_GAP_SECONDS = 600
_JUMP_METERS = 1000
_MAX_SPEED_MPS = 50


# Second-precision capture times tie between concurrent aircraft, so every
# window and result ordering needs a stable tie-breaker.
PASS_ORDER_SQL = "sort_ts ASC, id ASC"


def camera_serial_sql(prefix: str = "") -> str:
    """Camera body identifier, used to keep concurrent aircraft apart."""
    p = f"{prefix}." if prefix else ""
    return (
        f"COALESCE(NULLIF({p}exif->>'CameraSerialNumber', ''), "
        f"NULLIF({p}exif->>'SerialNumber', ''))"
    )


def segment_break_sql(ts: str, prev_ts: str, geom: str, prev_geom: str) -> str:
    """1 when the step from the previous frame is too big to be the same pass."""
    step_s = f"GREATEST(EXTRACT(EPOCH FROM ({ts} - {prev_ts})), 0)"
    step_m = f"ST_Distance({prev_geom}::geography, {geom}::geography)"
    return f"""
        CASE
            WHEN EXTRACT(EPOCH FROM ({ts} - {prev_ts})) > {_GAP_SECONDS} THEN 1
            WHEN {step_m} > {_JUMP_METERS} THEN 1
            WHEN {step_s} > 0 AND ({step_m} / {step_s}) > {_MAX_SPEED_MPS} THEN 1
            ELSE 0
        END
    """


def group_by_pass(rows: list[dict]) -> list[list[dict]]:
    """Group capture-ordered rows into passes keyed by (camera body, segment)."""
    passes: dict[tuple, list[dict]] = {}
    for row in rows:
        key = (row.get("camera_serial"), int(row.get("segment_id") or 0))
        passes.setdefault(key, []).append(row)
    return list(passes.values())
