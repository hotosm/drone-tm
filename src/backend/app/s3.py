from datetime import timedelta
from functools import lru_cache
from io import BytesIO
from typing import Any

from fastapi.concurrency import run_in_threadpool
from loguru import logger as log
from minio import Minio
from minio.deleteobjects import DeleteObject
from minio.commonconfig import CopySource
from minio.datatypes import Part
from minio.error import S3Error

from app.config import settings


def _normalize_object_name(object_name: str) -> str:
    """Normalize an S3 object key for SDK calls (no leading slash)."""
    return object_name.lstrip("/")


def _parse_endpoint(endpoint: str) -> tuple[str, bool]:
    """Parse endpoint URL and determine if connection should be secure.

    Args:
        endpoint: Full URL string (e.g. "https://s3.amazonaws.com" or "http://localhost:9000")

    Returns:
        tuple: (stripped_url, is_secure)

    Raises:
        ValueError: If endpoint doesn't start with http:// or https://
    """
    if endpoint.startswith("http://"):
        return endpoint[7:], False
    elif endpoint.startswith("https://"):
        return endpoint[8:], True
    else:
        raise ValueError(
            "The S3 endpoint is set incorrectly. It must start with http:// or https://"
        )


@lru_cache(maxsize=4)
def _create_client(endpoint: str) -> Minio:
    """Create (or return cached) a MinIO client for the given endpoint.

    Clients are cached per endpoint URL so we don't create a new TCP
    connection pool on every S3 operation.

    Args:
        endpoint: Full URL string for the S3-compatible endpoint

    Returns:
        Minio: Configured MinIO client instance
    """
    minio_url, is_secure = _parse_endpoint(endpoint)
    log.debug(f"Creating S3 client at {minio_url} (secure={is_secure})")

    return Minio(
        minio_url,
        access_key=settings.S3_ACCESS_KEY,
        secret_key=settings.S3_SECRET_KEY,
        secure=is_secure,
    )


def s3_client() -> Minio:
    """S3 client for backend/worker operations.

    Uses S3_ENDPOINT_UPLOAD for all backend operations.

    Returns:
        Minio: Client configured for internal backend operations
    """
    return _create_client(settings.S3_ENDPOINT_UPLOAD)


def _presign_client_for_upload() -> Minio:
    """S3 client for generating presigned upload URLs.

    Uses S3_ENDPOINT_UPLOAD (e.g., S3 Transfer Acceleration in production,
    localhost:9000 in development).

    Returns:
        Minio: Client configured for presigning upload operations
    """
    return _create_client(settings.S3_ENDPOINT_UPLOAD)


def _presign_client_for_download() -> Minio:
    """S3 client for generating presigned download URLs.

    Uses S3_ENDPOINT_DOWNLOAD (e.g., CloudFront in production,
    localhost:9000 in development).

    Returns:
        Minio: Client configured for presigning download operations
    """
    return _create_client(settings.S3_ENDPOINT_DOWNLOAD)


def build_browser_object_url(bucket_name: str, object_name: str) -> str:
    """Browser-facing URL for an object (no signing), using S3_ENDPOINT_DOWNLOAD.

    When a CDN like CloudFront is configured (S3_ENDPOINT_DOWNLOAD differs from
    S3_ENDPOINT_UPLOAD), the bucket is already the CDN origin, so the URL omits
    the bucket name: `<cdn>/<key>`.

    For local/MinIO (endpoints are the same), path-style URLs are used:
    `<base>/<bucket>/<key>`.

    Args:
        bucket_name: Name of the S3 bucket
        object_name: Path to the object in the bucket

    Returns:
        str: Full browser-accessible URL to the object
    """
    object_name = _normalize_object_name(object_name)
    base = settings.S3_ENDPOINT_DOWNLOAD.rstrip("/")
    # CDN (e.g. CloudFront) already points at the bucket; don't repeat it
    if settings.S3_ENDPOINT_DOWNLOAD != settings.S3_ENDPOINT_UPLOAD:
        return f"{base}/{object_name}"
    return f"{base}/{bucket_name}/{object_name}"


def generate_presigned_put_url(
    bucket_name: str,
    object_name: str,
    expires_hours: int = 1,
) -> str:
    """Generate a presigned PUT URL for browser uploads.

    Uses S3_ENDPOINT_UPLOAD (e.g., S3 Transfer Acceleration or localhost:9000).

    Args:
        bucket_name: Name of the S3 bucket
        object_name: Path where the object will be stored
        expires_hours: Hours until the URL expires (default: 1)

    Returns:
        str: Presigned URL for PUT operation
    """
    object_name = _normalize_object_name(object_name)
    client = _presign_client_for_upload()
    return client.get_presigned_url(
        "PUT",
        bucket_name,
        object_name,
        expires=timedelta(hours=expires_hours),
    )


def generate_presigned_get_url(
    bucket_name: str,
    object_name: str,
    expires_hours: int = 2,
    *,
    internal: bool = False,
) -> str:
    """Generate a presigned GET URL.

    By default, uses S3_ENDPOINT_DOWNLOAD (e.g., CloudFront) for browser-facing
    URLs. Pass ``internal=True`` for worker/backend downloads so the URL is
    signed against S3_ENDPOINT_UPLOAD (the actual S3 endpoint) - S3 presigned
    signatures are bound to the host they were generated for, so a URL signed
    for a CloudFront domain will fail with AccessDenied at the S3 origin.

    Args:
        bucket_name: Name of the S3 bucket
        object_name: Path to the object in the bucket
        expires_hours: Hours until the URL expires (default: 2)
        internal: If True, sign against S3 directly (for worker downloads)

    Returns:
        str: Presigned URL for GET operation
    """
    object_name = _normalize_object_name(object_name)
    client = s3_client() if internal else _presign_client_for_download()
    return client.presigned_get_object(
        bucket_name, object_name, expires=timedelta(hours=expires_hours)
    )


def maybe_presign_s3_key(value: str | None, expires_hours: int = 2) -> str | None:
    """Convert an S3 key to a presigned/direct URL if needed.

    This centralizes URL behavior for DB fields that store raw S3 keys (common in this repo).

    In production, if download endpoint differs from upload endpoint (e.g., CloudFront vs S3),
    uses direct URL for CDN caching. Otherwise uses presigned URLs.

    Args:
        value: S3 key or existing URL (or None)
        expires_hours: Hours until presigned URL expires (default: 2)

    Returns:
        str | None: Presigned URL, direct URL, or None if value is None
    """
    if not value:
        return None

    # Already a full URL - return as-is
    if value.startswith("http://") or value.startswith("https://"):
        return value

    # If download endpoint differs from upload (e.g., CloudFront vs S3),
    # use direct URL for CDN caching. Otherwise use presigned URLs.
    if settings.S3_ENDPOINT_DOWNLOAD != settings.S3_ENDPOINT_UPLOAD:
        return build_browser_object_url(settings.S3_BUCKET_NAME, value)

    return generate_presigned_get_url(settings.S3_BUCKET_NAME, value, expires_hours)


def check_file_exists(bucket_name: str, object_name: str) -> bool:
    """Check if a file exists in the S3 bucket.

    Args:
        bucket_name: The name of the S3 bucket
        object_name: The path to the object in the bucket

    Returns:
        bool: True if file exists, False otherwise
    """
    client = s3_client()
    try:
        client.stat_object(bucket_name, object_name)
        return True
    except S3Error:
        return False


def add_file_to_bucket(bucket_name: str, file_path: str, s3_path: str):
    """Upload a file from the filesystem to an S3 bucket.

    Args:
        bucket_name: The name of the S3 bucket
        file_path: The path to the file on the local filesystem
        s3_path: The path in the S3 bucket where the file will be stored
    """
    client = s3_client()
    client.fput_object(bucket_name, s3_path, file_path)


def add_obj_to_bucket(
    bucket_name: str,
    file_obj: BytesIO,
    s3_path: str,
    content_type: str = "application/octet-stream",
    **kwargs: dict[str, Any],
):
    """Upload a BytesIO object to an S3 bucket.

    Args:
        bucket_name: The name of the S3 bucket
        file_obj: A BytesIO object containing the data to be uploaded
        s3_path: The path in the S3 bucket where the data will be stored
        content_type: The content type of the uploaded file (default: application/octet-stream)
        kwargs: Any other arguments to pass to client.put_object
    """
    s3_path = _normalize_object_name(s3_path)
    client = s3_client()

    # Set BytesIO object to start, prior to .read()
    file_obj.seek(0)

    result = client.put_object(
        bucket_name, s3_path, file_obj, file_obj.getbuffer().nbytes, **kwargs
    )
    log.debug(
        f"Created {result.object_name} object; etag: {result.etag}, "
        f"version-id: {result.version_id}"
    )


def get_file_from_bucket(bucket_name: str, s3_path: str, file_path: str):
    """Download a file from an S3 bucket and save it to the local filesystem.

    Args:
        bucket_name: The name of the S3 bucket
        s3_path: The path to the file in the S3 bucket
        file_path: The path on the local filesystem where the S3 file will be saved
    """
    try:
        client = s3_client()
        client.fget_object(bucket_name, s3_path, file_path)
    except S3Error as e:
        if e.code == "NoSuchKey":
            log.warning(f"File not found in bucket: {s3_path}")
        else:
            log.error(f"Error occurred while downloading file: {e}")
        return False


def get_obj_from_bucket(bucket_name: str, s3_path: str) -> BytesIO:
    """Download an S3 object from a bucket and return it as a BytesIO object.

    Args:
        bucket_name: The name of the S3 bucket
        s3_path: The path to the S3 object in the bucket

    Returns:
        BytesIO: A BytesIO object containing the content of the downloaded S3 object
    """
    client = s3_client()
    response = None
    try:
        response = client.get_object(bucket_name, s3_path)
        return BytesIO(response.read())
    except Exception as e:
        log.warning(f"Failed attempted download from S3 path: {s3_path}")
        raise ValueError(str(e)) from e
    finally:
        if response:
            response.close()
            response.release_conn()


async def async_get_obj_from_bucket(bucket_name: str, s3_path: str) -> BytesIO:
    """Download an S3 object from a bucket and return it as a BytesIO object (async).

    This async wrapper uses run_in_threadpool to handle the synchronous MinIO client
    without blocking the event loop.

    Args:
        bucket_name: The name of the S3 bucket
        s3_path: The path to the S3 object in the bucket

    Returns:
        BytesIO: A BytesIO object containing the content of the downloaded S3 object
    """
    return await run_in_threadpool(get_obj_from_bucket, bucket_name, s3_path)


def get_image_dir_url(bucket_name: str, image_dir: str):
    """Generate the full URL for the image directory in an S3 bucket.

    Args:
        bucket_name: The name of the S3 bucket
        image_dir: The directory path within the bucket where images are stored

    Returns:
        str | None: The full URL to access the image directory, or None if empty
    """
    # Normalize the path
    if not image_dir.startswith("/"):
        image_dir = f"/{image_dir}"

    client = s3_client()
    try:
        # List objects with a prefix to check if the directory exists
        objects = client.list_objects(bucket_name, prefix=image_dir.lstrip("/"))
        if any(objects):
            return build_browser_object_url(bucket_name, image_dir.lstrip("/"))
        else:
            return None
    except Exception as e:
        log.error(f"Error checking directory existence: {str(e)}")


def list_objects_from_bucket(bucket_name: str, prefix: str):
    """List all objects in a bucket with a specified prefix.

    Args:
        bucket_name: The name of the S3 bucket
        prefix: The prefix to filter objects by

    Returns:
        list: A list of objects in the bucket with the specified prefix
    """
    client = s3_client()
    return client.list_objects(bucket_name, prefix=prefix, recursive=True)


def delete_objects_by_prefix(bucket_name: str, prefix: str) -> int:
    """Delete all objects under a given S3 prefix.

    Args:
        bucket_name: The name of the S3 bucket
        prefix: The prefix whose objects should be deleted

    Returns:
        int: Number of objects deleted
    """
    client = s3_client()
    objects = list(client.list_objects(bucket_name, prefix=prefix, recursive=True))
    if not objects:
        return 0

    delete_list = [DeleteObject(obj.object_name) for obj in objects if not obj.is_dir]
    errors = list(client.remove_objects(bucket_name, delete_list))
    if errors:
        for err in errors:
            log.warning(f"Failed to delete {err.name}: {err.message}")

    deleted = len(delete_list) - len(errors)
    log.info(f"Deleted {deleted} objects under prefix {prefix}")
    return deleted


def get_object_metadata(bucket_name: str, object_name: str):
    """Get object metadata from an S3 bucket.

    Args:
        bucket_name: The name of the S3 bucket
        object_name: The name of the object in the bucket

    Returns:
        dict: A dictionary containing metadata about the object
    """
    client = s3_client()
    return client.stat_object(bucket_name, object_name)


def get_orthophoto_url_for_project(project_id: str):
    """Generate browser URL for project orthophoto.

    Args:
        project_id: The unique identifier for the project

    Returns:
        str | None: URL to download the orthophoto, or None if not found
    """
    ortho_path = f"projects/{project_id}/odm/odm_orthophoto/odm_orthophoto.tif"
    if check_file_exists(settings.S3_BUCKET_NAME, ortho_path):
        return maybe_presign_s3_key(ortho_path, expires_hours=12)

    log.warning("Orthophoto not found in S3 bucket")
    return None


def move_file_within_bucket(
    bucket_name: str, source_path: str, destination_path: str
) -> bool:
    """Move a file within the same bucket by copying then deleting the source.

    If source deletion fails after a successful copy, this attempts to delete the
    new destination object as compensation so callers do not end up with duplicates.
    """
    try:
        source_path = _normalize_object_name(source_path)
        destination_path = _normalize_object_name(destination_path)

        client = s3_client()

        try:
            client.stat_object(bucket_name, source_path)
        except S3Error:
            log.warning(f"Source file not found: {source_path} in bucket {bucket_name}")
            return False

        copy_source = CopySource(bucket_name, source_path)
        result = client.copy_object(bucket_name, destination_path, copy_source)

        try:
            client.remove_object(bucket_name, source_path)
        except Exception as e:
            log.error(
                f"Failed to delete source object after copy: {source_path} -> "
                f"{destination_path}: {e}"
            )
            try:
                client.remove_object(bucket_name, destination_path)
            except Exception as cleanup_error:
                log.error(
                    f"Failed to clean up copied destination object {destination_path} "
                    f"after source delete failure: {cleanup_error}"
                )
            return False

        log.debug(
            f"Successfully moved object within {bucket_name} "
            f"from {source_path} to {destination_path}. "
            f"Object name: {result.object_name}, Version ID: {result.version_id}"
        )
        return True

    except S3Error as e:
        log.error(f"Error moving object: {e}")
        return False
    except Exception as e:
        log.error(f"Unexpected error during object move: {e}")
        return False


def initiate_multipart_upload(bucket_name: str, object_name: str) -> str:
    """Initiate a multipart upload and return the upload ID.

    Args:
        bucket_name: The name of the S3 bucket
        object_name: The path in the S3 bucket where the file will be stored

    Returns:
        str: The upload ID for the multipart upload session
    """
    object_name = _normalize_object_name(object_name)
    client = s3_client()

    try:
        upload_id = client._create_multipart_upload(bucket_name, object_name, {})
        log.debug(
            f"Initiated multipart upload for {object_name} with upload ID: {upload_id}"
        )
        return upload_id
    except S3Error as e:
        log.error(f"Error initiating multipart upload: {e}")
        raise
    except Exception as e:
        log.error(f"Unexpected error during multipart upload initiation: {e}")
        raise


def generate_presigned_multipart_upload_url(
    bucket_name: str,
    object_name: str,
    upload_id: str,
    part_number: int,
    expires_hours: int = 2,
) -> str:
    """Generate a presigned URL for uploading a single part in a multipart upload.

    This is used by the frontend (Uppy) to upload large files in chunks. Each chunk/part
    gets its own presigned URL. This endpoint is called frequently during active uploads.
    Uses S3_ENDPOINT_UPLOAD.

    Args:
        bucket_name: The name of the S3 bucket
        object_name: The S3 key/path where the file will be stored
        upload_id: The upload ID from initiate_multipart_upload
        part_number: The part number (1-10000) for this chunk
        expires_hours: Hours until the URL expires (default: 2)

    Returns:
        str: The presigned URL for uploading this specific part

    Raises:
        S3Error: If there's an error communicating with S3
    """
    object_name = _normalize_object_name(object_name)
    client = _presign_client_for_upload()

    try:
        url = client.get_presigned_url(
            "PUT",
            bucket_name,
            object_name,
            expires=timedelta(hours=expires_hours),
            extra_query_params={
                "uploadId": upload_id,
                "partNumber": str(part_number),
            },
        )
        log.debug(f"Generated presigned URL for part {part_number} of {object_name}")
        return url
    except S3Error as e:
        log.error(f"Error generating presigned URL for part upload: {e}")
        raise
    except Exception as e:
        log.error(f"Unexpected error generating presigned URL: {e}")
        raise


def complete_multipart_upload(
    bucket_name: str, object_name: str, upload_id: str, parts: list[dict]
) -> bool:
    """Complete a multipart upload by combining all uploaded parts.

    Args:
        bucket_name: The name of the S3 bucket
        object_name: The path in the S3 bucket where the file is stored
        upload_id: The upload ID from initiate_multipart_upload
        parts: List of parts with 'PartNumber' and 'ETag' keys

    Returns:
        bool: True if the multipart upload was completed successfully
    """
    object_name = _normalize_object_name(object_name)
    client = s3_client()

    try:
        # Convert dict parts to Part objects for MinIO SDK
        part_objects = []
        for part in parts:
            # Handle both lowercase and uppercase key names
            part_number = part.get("PartNumber") or part.get("part_number")
            etag = part.get("ETag") or part.get("etag")

            if part_number and etag:
                # Create Part object - strip quotes from ETag if present
                part_obj = Part(int(part_number), etag.strip('"'))
                part_objects.append(part_obj)

        result = client._complete_multipart_upload(
            bucket_name, object_name, upload_id, part_objects
        )
        log.info(
            f"Completed multipart upload for {object_name}. "
            f"ETag: {result.etag}, Version ID: {result.version_id}"
        )
        return True
    except S3Error as e:
        log.error(f"Error completing multipart upload: {e}")
        raise
    except Exception as e:
        log.error(f"Unexpected error completing multipart upload: {e}")
        raise


def abort_multipart_upload(bucket_name: str, object_name: str, upload_id: str) -> bool:
    """Abort a multipart upload and clean up uploaded parts.

    Args:
        bucket_name: The name of the S3 bucket
        object_name: The path in the S3 bucket
        upload_id: The upload ID from initiate_multipart_upload

    Returns:
        bool: True if the upload was aborted successfully
    """
    object_name = _normalize_object_name(object_name)
    client = s3_client()

    try:
        client._abort_multipart_upload(bucket_name, object_name, upload_id)
        log.info(
            f"Aborted multipart upload for {object_name} with upload ID: {upload_id}"
        )
        return True
    except S3Error as e:
        log.error(f"Error aborting multipart upload: {e}")
        raise
    except Exception as e:
        log.error(f"Unexpected error aborting multipart upload: {e}")
        raise


def list_parts(bucket_name: str, object_name: str, upload_id: str) -> list[dict]:
    """List all uploaded parts for a multipart upload.

    Args:
        bucket_name: The name of the S3 bucket
        object_name: The path in the S3 bucket
        upload_id: The upload ID from initiate_multipart_upload

    Returns:
        list[dict]: List of uploaded parts with part number and ETag
    """
    object_name = _normalize_object_name(object_name)
    client = s3_client()

    try:
        parts_response = client._list_parts(bucket_name, object_name, upload_id)
        parts = [
            {"part_number": part.part_number, "etag": part.etag}
            for part in parts_response.parts
        ]
        log.debug(f"Listed {len(parts)} parts for {object_name}")
        return parts
    except S3Error as e:
        log.error(f"Error listing parts: {e}")
        raise
    except Exception as e:
        log.error(f"Unexpected error listing parts: {e}")
        raise
