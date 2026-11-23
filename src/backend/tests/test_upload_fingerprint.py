import pytest
from app.images.image_logic import compute_upload_fingerprint

# Known answers shared with src/frontend/src/utils/uploadFingerprint.ts.
# If these change, the browser and server fingerprints no longer match.
LARGE_FILE = bytes(i % 251 for i in range(200_000))


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        (LARGE_FILE, "0fedb685cf5c1c47f375e07de565c455"),
        (b"abc", "12694ffd375cdd882893573f42cba2d4"),
        (b"", "ba768b331fd86cec803be04e56ab2b3d"),
    ],
)
def test_compute_upload_fingerprint_known_answers(content: bytes, expected: str):
    assert compute_upload_fingerprint(content) == expected


def test_compute_upload_fingerprint_changes_when_only_metadata_changes():
    regeotagged = b"X" + LARGE_FILE[1:]
    assert compute_upload_fingerprint(regeotagged) != compute_upload_fingerprint(
        LARGE_FILE
    )
