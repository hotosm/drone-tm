"""Helpers for deciding where generated flightplan files are written."""

import logging
import os
import tempfile

log = logging.getLogger(__name__)


def resolve_output_path(
    output_file_path: str | None,
    suffix: str,
    prefix: str = "flightplan_",
) -> str:
    """Resolve the destination path for a generated flightplan file.

    The output modules used to default to hardcoded paths under `/tmp`
    (e.g. `/tmp/mission.csv`). That had two problems: concurrent missions
    overwrote each other's file, and nothing ever removed them, so the
    deployed server slowly filled up.

    Args:
        output_file_path: Caller-provided destination. `None` means
            "generate a temporary path for me".
        suffix: Extension used when generating a temporary file.
        prefix: Filename prefix used when generating a temporary file.

    Returns:
        The path to write the output to. When the path is generated here the
        file is created empty and ownership passes to the caller, which must
        remove it once consumed.
    """
    if output_file_path is None:
        file_descriptor, generated_path = tempfile.mkstemp(suffix=suffix, prefix=prefix)
        os.close(file_descriptor)
        log.debug(f"No output path provided, using temporary file: {generated_path}")
        return generated_path

    parent_dir = os.path.dirname(output_file_path)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)

    return output_file_path
