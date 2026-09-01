"""add_obj_to_bucket declares a content_type, so it has to send one.

The call it makes passes four positional arguments and then **kwargs. Because
content_type is an explicit named parameter it is bound there rather than left
in kwargs, so it never reached minio and every BytesIO upload was stored with
the SDK's own application/octet-stream default.

Arguments are recorded by binding them through the real Minio.put_object
signature, so what is asserted is what the SDK would have put on the wire.
"""

import inspect
from io import BytesIO

from minio import Minio

from app import s3


class _Result:
    object_name = "object"
    etag = "etag"
    version_id = None


class _RecordingClient:
    def __init__(self):
        self.calls = []

    def put_object(self, *args, **kwargs):
        bound = inspect.signature(Minio.put_object).bind(self, *args, **kwargs)
        bound.apply_defaults()
        self.calls.append(bound.arguments)
        return _Result()


def test_add_obj_to_bucket_forwards_content_type(monkeypatch):
    client = _RecordingClient()
    monkeypatch.setattr(s3, "s3_client", lambda: client)

    s3.add_obj_to_bucket(
        "test-bucket",
        BytesIO(b"fake-image-bytes"),
        "projects/1/photo.jpg",
        content_type="image/jpeg",
    )

    assert client.calls[0]["content_type"] == "image/jpeg"


def test_add_obj_to_bucket_keeps_forwarding_other_kwargs(monkeypatch):
    """The QField export passes both, so the fix must not displace metadata."""
    client = _RecordingClient()
    monkeypatch.setattr(s3, "s3_client", lambda: client)

    s3.add_obj_to_bucket(
        "test-bucket",
        BytesIO(b"fake-zip-bytes"),
        "projects/1/qfield.zip",
        content_type="application/zip",
        metadata={"Cache-Control": "no-cache"},
    )

    assert client.calls[0]["content_type"] == "application/zip"
    assert client.calls[0]["metadata"] == {"Cache-Control": "no-cache"}
