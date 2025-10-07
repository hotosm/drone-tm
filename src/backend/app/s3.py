from datetime import timedelta
from io import BytesIO
from typing import Any
from urllib.parse import urljoin

from loguru import logger as log
from minio import Minio
from minio.commonconfig import CopySource
from minio.error import S3Error

from app.config import settings


def s3_client():
    """Return the initialised S3 client with credentials."""
    minio_url, is_secure = is_connection_secure(settings.S3_ENDPOINT)
    log.debug("Connecting to Minio S3 server")
    return Minio(
        minio_url,
        settings.S3_ACCESS_KEY,
        settings.S3_SECRET_KEY,
        secure=is_secure,
    )


def is_connection_secure(minio_url: str):
    """Determine from URL string if is http or https."""
    if minio_url.startswith("http://"):
        secure = False
        stripped_url = minio_url[len("http://") :]
        log.warning("S3 URL is insecure (ignore if on devserver)")

    elif minio_url.startswith("https://"):
        secure = True
        stripped_url = minio_url[len("https://") :]

    else:
        err = (
            "The S3_ENDPOINT is set incorrectly. It must start with http:// or https://"
        )
        log.error(err)
        raise ValueError(err)

    return stripped_url, secure


def check_file_exists(bucket_name: str, object_name: str) -> bool:
    """Check if a file exists in the S3 bucket.

    Args:
        bucket_name (str): The name of the S3 bucket
        object_name (str): The path to the object in the bucket

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
        bucket_name (str): The name of the S3 bucket.
        file_path (str): The path to the file on the local filesystem.
        s3_path (str): The path in the S3 bucket where the file will be stored.
    """
    # Ensure s3_path starts with a forward slash
    # if not s3_path.startswith("/"):
    #     s3_path = f"/{s3_path}"

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
        bucket_name (str): The name of the S3 bucket.
        file_obj (BytesIO): A BytesIO object containing the data to be uploaded.
        s3_path (str): The path in the S3 bucket where the data will be stored.
        content_type (str, optional): The content type of the uploaded file.
            Default application/octet-stream.
        kwargs (dict[str, Any]): Any other arguments to pass to client.put_object.

    """
    # Strip "/" from start of s3_path (not required by put_object)
    if s3_path.startswith("/"):
        s3_path = s3_path.lstrip("/")

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
        bucket_name (str): The name of the S3 bucket.
        s3_path (str): The path to the file in the S3 bucket.
        file_path (str): The path on the local filesystem where the S3
            file will be saved.
    """
    # Ensure s3_path starts with a forward slash
    # if not s3_path.startswith("/"):
    #     s3_path = f"/{s3_path}"
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
        bucket_name (str): The name of the S3 bucket.
        s3_path (str): The path to the S3 object in the bucket.

    Returns:
        BytesIO: A BytesIO object containing the content of the downloaded S3 object.
    """
    # Ensure s3_path starts with a forward slash
    # if not s3_path.startswith("/"):
    #     s3_path = f"/{s3_path}"

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


def get_image_dir_url(bucket_name: str, image_dir: str):
    """Generate the full URL for the image directory in an S3 bucket.

    Args:
        bucket_name (str): The name of the S3 bucket.
        image_dir (str): The directory path within the bucket where images are stored.

    Returns:
        str: The full URL to access the image directory.
    """
    minio_url, is_secure = is_connection_secure(settings.S3_ENDPOINT)

    # Ensure image_dir starts with a forward slash
    if not image_dir.startswith("/"):
        image_dir = f"/{image_dir}"

    # Construct the full URL
    protocol = "https" if is_secure else "http"

    url = f"{protocol}://{minio_url}/{bucket_name}{image_dir}"

    minio_client = s3_client()
    try:
        # List objects with a prefix to check if the directory exists
        objects = minio_client.list_objects(bucket_name, prefix=image_dir.lstrip("/"))
        if any(objects):
            return url
        else:
            return None

    except Exception as e:
        log.error(f"Error checking directory existence: {str(e)}")


def list_objects_from_bucket(bucket_name: str, prefix: str):
    """List all objects in a bucket with a specified prefix.

    Args:
        bucket_name (str): The name of the S3 bucket.
        prefix (str): The prefix to filter objects by.

    Returns:
        list: A list of objects in the bucket with the specified prefix.
    """
    client = s3_client()
    objects = client.list_objects(bucket_name, prefix=prefix, recursive=True)
    return objects


def get_presigned_url(bucket_name: str, object_name: str, expires: int = 2):
    """Generate a presigned URL for an object in an S3 bucket.

    Args:
        bucket_name (str): The name of the S3 bucket.
        object_name (str): The name of the object in the bucket.
        expires (int, optional): The time in hours until the URL expires.
            Defaults to 2 hour.

    Returns:
        str: The presigned URL to access the object.
    """
    client = s3_client()
    return client.presigned_get_object(
        bucket_name, object_name, expires=timedelta(hours=expires)
    )


def get_object_metadata(bucket_name: str, object_name: str):
    """Get object metadata from an S3 bucket.

    Args:
        bucket_name (str): The name of the S3 bucket.
        object_name (str): The name of the object in the bucket.

    Returns:
        dict: A dictionary containing metadata about the object.
    """
    client = s3_client()
    return client.stat_object(bucket_name, object_name)


def generate_static_url(bucket_name: str, s3_path: str):
    """Generate a static URL for an S3 object."""
    minio_url, is_secure = is_connection_secure(settings.S3_ENDPOINT)
    protocol = "https" if is_secure else "http"
    base_url = f"{protocol}://{minio_url}/{bucket_name}/"
    return urljoin(base_url, s3_path)


def get_assets_url_for_project(project_id: str):
    """Get the assets URL for a project."""
    project_assets_path = f"dtm-data/projects/{project_id}/assets.zip"
    s3_download_root = settings.S3_DOWNLOAD_ROOT
    if s3_download_root:
        return urljoin(s3_download_root, project_assets_path)
    return get_presigned_url(settings.S3_BUCKET_NAME, project_assets_path, 3)


def get_orthophoto_url_for_project(project_id: str):
    """Get the orthophoto URL for a project."""
    project_orthophoto_path = (
        f"dtm-data/projects/{project_id}/orthophoto/odm_orthophoto.tif"
    )

    if not check_file_exists(settings.S3_BUCKET_NAME, project_orthophoto_path):
        log.warning("Orthophoto not found in S3 bucket")
        return None

    s3_download_root = settings.S3_DOWNLOAD_ROOT
    if s3_download_root:
        return urljoin(s3_download_root, project_orthophoto_path)
    return get_presigned_url(settings.S3_BUCKET_NAME, project_orthophoto_path, 3)


def copy_file_within_bucket(
    bucket_name: str, source_path: str, destination_path: str
) -> bool:
    """Copy a file from one path to another within the same bucket.

    Args:
        bucket_name (str): The name of the bucket.
        source_path (str): The current path of the object.
        destination_path (str): The new path where the object will be copied.

    Returns:
        bool: True if the copy was successful, False otherwise.
    """
    try:
        # Remove leading slash if present
        source_path = source_path.lstrip("/")
        destination_path = destination_path.lstrip("/")

        client = s3_client()

        # Check if source file exists
        try:
            client.stat_object(bucket_name, source_path)
        except S3Error:
            log.warning(f"Source file not found: {source_path} in bucket {bucket_name}")
            return False

        # Create CopySource object
        copy_source = CopySource(bucket_name, source_path)

        # Copy the object within the same bucket
        result = client.copy_object(bucket_name, destination_path, copy_source)

        log.debug(
            f"Successfully copied object within {bucket_name} "
            f"from {source_path} to {destination_path}. "
            f"Object name: {result.object_name}, Version ID: {result.version_id}"
        )
        return True

    except S3Error as e:
        log.error(f"Error copying object: {e}")
        return False
    except Exception as e:
        log.error(f"Unexpected error during object copy: {e}")
        return False


def initiate_multipart_upload(bucket_name: str, object_name: str) -> str:
    """Initiate a multipart upload and return the upload ID.

    Args:
        bucket_name (str): The name of the S3 bucket.
        object_name (str): The path in the S3 bucket where the file will be stored.

    Returns:
        str: The upload ID for the multipart upload session.
    """
    object_name = object_name.lstrip("/")
    client = s3_client()

    try:
        result = client._create_multipart_upload(bucket_name, object_name, {})
        upload_id = result.upload_id
        log.debug(f"Initiated multipart upload for {object_name} with upload ID: {upload_id}")
        return upload_id
    except S3Error as e:
        log.error(f"Error initiating multipart upload: {e}")
        raise
    except Exception as e:
        log.error(f"Unexpected error during multipart upload initiation: {e}")
        raise
