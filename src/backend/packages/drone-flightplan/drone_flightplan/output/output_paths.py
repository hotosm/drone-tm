import os
import tempfile


def resolve_output_path(output_file_path: str | None, suffix: str) -> str:
    """Return the given path, creating its parent dir, or a new temp file.

    A generated temp file is owned by the caller, which must remove it.
    """
    if output_file_path is None:
        fd, output_file_path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        return output_file_path

    os.makedirs(os.path.dirname(output_file_path) or ".", exist_ok=True)
    return output_file_path
