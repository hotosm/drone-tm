from datetime import timedelta
from io import BytesIO
from typing import Any
from urllib.parse import urljoin

from minio import Minio
from minio.error import S3Error
from loguru import logger as log

from app.config import settings
from app.utils import strip_presigned_url_for_local_dev


def s3_client(use_public_endpoint: bool = False):
    """Return the initialised MinIO client with credentials.

    Args:
        use_public_endpoint: If True and in DEBUG mode, use S3_DOWNLOAD_ROOT for presigned URLs.
                            This is needed when generating presigned URLs that will be accessed
                            by the browser, so the signature matches the public hostname.
    """
    # For presigned URLs in local dev, use S3_DOWNLOAD_ROOT so signature matches browser endpoint
    if use_public_endpoint and settings.DEBUG and settings.S3_DOWNLOAD_ROOT:
        endpoint = settings.S3_DOWNLOAD_ROOT
    else:
        endpoint = settings.S3_ENDPOINT

    minio_url, is_secure = is_connection_secure(endpoint)

    log.debug(f"Connecting to MinIO server at {minio_url} (secure={is_secure})")

    return Minio(
        minio_url,
        access_key=settings.S3_ACCESS_KEY,
        secret_key=settings.S3_SECRET_KEY,
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

    return strip_presigned_url_for_local_dev(stripped_url), secure


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
        # Remove leading slash if present for MinIO compatibility
        object_name = object_name.lstrip("/")
        client.stat_object(bucket_name, object_name)
        return True
    except S3Error as e:
        if e.code == 'NoSuchKey':
            return False
        log.error(f"Error checking file existence: {e}")
        return False


def add_file_to_bucket(bucket_name: str, file_path: str, s3_path: str):
    """Upload a file from the filesystem to an S3 bucket.

    Args:
        bucket_name (str): The name of the S3 bucket.
        file_path (str): The path to the file on the local filesystem.
        s3_path (str): The path in the S3 bucket where the file will be stored.
    """
    # Remove leading slash for MinIO compatibility
    s3_path = s3_path.lstrip("/")

    client = s3_client()
    result = client.fput_object(bucket_name, s3_path, file_path)
    log.debug(f"Uploaded file {file_path} to {bucket_name}/{s3_path}, etag: {result.etag}")


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
        kwargs (dict[str, Any]): Any other arguments (metadata, tags, etc).

    """
    # Strip "/" from start of s3_path (not required by MinIO)
    s3_path = s3_path.lstrip("/")

    client = s3_client()
    # Set BytesIO object to start, prior to .read()
    file_obj.seek(0)

    # Get the size of the BytesIO object
    file_obj.seek(0, 2)  # Seek to end
    length = file_obj.tell()
    file_obj.seek(0)  # Seek back to start

    # Extract metadata and tags from kwargs if provided
    metadata = kwargs.get('Metadata', {})
    tags = kwargs.get('Tagging', {})

    result = client.put_object(
        bucket_name,
        s3_path,
        file_obj,
        length,
        content_type=content_type,
        metadata=metadata,
        tags=tags
    )
    log.debug(
        f"Created {s3_path} object; etag: {result.etag}, "
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
    # Remove leading slash for MinIO compatibility
    s3_path = s3_path.lstrip("/")

    try:
        client = s3_client()
        client.fget_object(bucket_name, s3_path, file_path)
        log.debug(f"Downloaded {bucket_name}/{s3_path} to {file_path}")
        return True
    except S3Error as e:
        if e.code == 'NoSuchKey':
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
    # Remove leading slash for MinIO compatibility
    s3_path = s3_path.lstrip("/")

    client = s3_client()
    try:
        response = client.get_object(bucket_name, s3_path)
        data = response.read()
        response.close()
        response.release_conn()
        return BytesIO(data)
    except S3Error as e:
        log.warning(f"Failed attempted download from S3 path: {s3_path}")
        raise ValueError(str(e)) from e


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

    client = s3_client()
    try:
        # List objects with a prefix to check if the directory exists
        # Remove leading slash for MinIO
        prefix = image_dir.lstrip("/")
        objects = client.list_objects(bucket_name, prefix=prefix, recursive=False)

        # Check if any objects exist with this prefix
        for _ in objects:
            return url

        return None

    except Exception as e:
        log.error(f"Error checking directory existence: {str(e)}")
        return None


def list_objects_from_bucket(bucket_name: str, prefix: str):
    """List all objects in a bucket with a specified prefix.

    Args:
        bucket_name (str): The name of the S3 bucket.
        prefix (str): The prefix to filter objects by.

    Returns:
        list: A list of objects in the bucket with the specified prefix.
    """
    client = s3_client()
    # Remove leading slash for MinIO
    prefix = prefix.lstrip("/")

    objects = []

    try:
        # List objects with the given prefix
        object_list = client.list_objects(bucket_name, prefix=prefix, recursive=True)

        for obj in object_list:
            # Create a simple object with attributes for compatibility
            class S3Object:
                def __init__(self, key, size, etag, last_modified):
                    self.object_name = key
                    self.size = size
                    self.etag = etag
                    self.last_modified = last_modified

            objects.append(S3Object(
                obj.object_name,
                obj.size,
                obj.etag,
                obj.last_modified
            ))
    except S3Error as e:
        log.error(f"Error listing objects: {e}")

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
    # Use public endpoint for presigned URLs in local dev
    client = s3_client()
    # Remove leading slash for MinIO
    object_name = object_name.lstrip("/")

    url = client.presigned_get_object(
        bucket_name,
        object_name,
        expires=timedelta(hours=expires)
    )
    return strip_presigned_url_for_local_dev(url)


def get_object_metadata(bucket_name: str, object_name: str):
    """Get object metadata from an S3 bucket.

    Args:
        bucket_name (str): The name of the S3 bucket.
        object_name (str): The name of the object in the bucket.

    Returns:
        dict: A dictionary containing metadata about the object.
    """
    client = s3_client()
    # Remove leading slash for MinIO
    object_name = object_name.lstrip("/")

    stat = client.stat_object(bucket_name, object_name)

    # Convert MinIO stat object to dict similar to boto3's head_object response
    return {
        'ContentLength': stat.size,
        'ETag': stat.etag,
        'LastModified': stat.last_modified,
        'ContentType': stat.content_type,
        'Metadata': stat.metadata,
        'VersionId': stat.version_id
    }


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
        url = urljoin(s3_download_root, project_assets_path)
        return strip_presigned_url_for_local_dev(url)
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
        url = urljoin(s3_download_root, project_orthophoto_path)
        return strip_presigned_url_for_local_dev(url)
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
        except S3Error as e:
            if e.code == 'NoSuchKey':
                log.warning(f"Source file not found: {source_path} in bucket {bucket_name}")
                return False
            raise

        # Copy the object within the same bucket
        result = client.copy_object(
            bucket_name,
            destination_path,
            f"/{bucket_name}/{source_path}"  # MinIO expects source in this format
        )

        log.debug(
            f"Successfully copied object within {bucket_name} "
            f"from {source_path} to {destination_path}. "
            f"ETag: {result.etag}, Version ID: {result.version_id}"
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

    Uses MinIO's internal _create_multipart_upload method.

    Args:
        bucket_name (str): The name of the S3 bucket.
        object_name (str): The path in the S3 bucket where the file will be stored.

    Returns:
        str: The upload ID for the multipart upload session.
    """
    object_name = object_name.lstrip("/")
    client = s3_client()

    try:
        # Use MinIO's internal method - much simpler!
        upload_id = client._create_multipart_upload(bucket_name, object_name, {})
        log.debug(f"Initiated multipart upload for {object_name} with upload ID: {upload_id}")
        return upload_id
    except Exception as e:
        log.error(f"Error initiating multipart upload: {e}")
        raise


def get_presigned_upload_part_url(
    bucket_name: str, object_name: str, upload_id: str, part_number: int, expires: int = 2
) -> str:
    """Generate a presigned URL for uploading a specific part in a multipart upload.

    Args:
        bucket_name (str): The name of the S3 bucket.
        object_name (str): The path in the S3 bucket where the file will be stored.
        upload_id (str): The upload ID from initiate_multipart_upload.
        part_number (int): The part number (1-10000).
        expires (int, optional): The time in hours until the URL expires. Defaults to 2 hours.

    Returns:
        str: The presigned URL for uploading the part.
    """
    object_name = object_name.lstrip("/")
    client = s3_client()

    try:
        # In local dev with public bucket, construct URL manually without signature
        if settings.DEBUG and settings.S3_DOWNLOAD_ROOT:
            url = f"{settings.S3_DOWNLOAD_ROOT}/{bucket_name}/{object_name}?uploadId={upload_id}&partNumber={part_number}"
            log.debug(f"Generated unsigned URL for part {part_number} (local dev)")
            return url

        # In production, generate proper presigned URL
        url = client.get_presigned_url(
            "PUT",
            bucket_name,
            object_name,
            expires=timedelta(hours=expires),
            extra_query_params={
                'uploadId': upload_id,
                'partNumber': str(part_number)
            }
        )

        log.debug(f"Generated presigned URL for part {part_number} of {object_name}")
        return url
    except Exception as e:
        log.error(f"Error generating presigned URL for part upload: {e}")
        raise


def complete_multipart_upload(
    bucket_name: str, object_name: str, upload_id: str, parts: list[dict]
) -> bool:
    """Complete a multipart upload by combining all uploaded parts.

    Args:
        bucket_name (str): The name of the S3 bucket.
        object_name (str): The path in the S3 bucket where the file is stored.
        upload_id (str): The upload ID from initiate_multipart_upload.
        parts (list[dict]): List of parts with 'PartNumber' and 'ETag' keys.

    Returns:
        bool: True if the multipart upload was completed successfully.
    """
    object_name = object_name.lstrip("/")
    client = s3_client()

    try:
        # Format parts for MinIO's internal method
        formatted_parts = []
        for part in parts:
            # Handle both lowercase and uppercase key names
            part_number = part.get('PartNumber') or part.get('part_number')
            etag = part.get('ETag') or part.get('etag')

            if part_number and etag:
                formatted_parts.append({
                    'PartNumber': int(part_number),
                    'ETag': etag.strip('"')
                })

        # Use MinIO's internal method - much simpler!
        client._complete_multipart_upload(
            bucket_name,
            object_name,
            upload_id,
            formatted_parts
        )

        log.info(f"Completed multipart upload for {object_name}")
        return True
    except Exception as e:
        log.error(f"Error completing multipart upload: {e}")
        raise


def abort_multipart_upload(bucket_name: str, object_name: str, upload_id: str) -> bool:
    """Abort a multipart upload and clean up uploaded parts.

    Args:
        bucket_name (str): The name of the S3 bucket.
        object_name (str): The path in the S3 bucket.
        upload_id (str): The upload ID from initiate_multipart_upload.

    Returns:
        bool: True if the upload was aborted successfully.
    """
    object_name = object_name.lstrip("/")
    client = s3_client()

    try:
        # Use MinIO's internal method
        client._abort_multipart_upload(bucket_name, object_name, upload_id)
        log.info(f"Aborted multipart upload for {object_name} with upload ID: {upload_id}")
        return True
    except Exception as e:
        log.error(f"Error aborting multipart upload: {e}")
        raise


def list_parts(bucket_name: str, object_name: str, upload_id: str) -> list[dict]:
    """List all uploaded parts for a multipart upload.

    Args:
        bucket_name (str): The name of the S3 bucket.
        object_name (str): The path in the S3 bucket.
        upload_id (str): The upload ID from initiate_multipart_upload.

    Returns:
        list[dict]: List of uploaded parts with part number and ETag.
    """
    object_name = object_name.lstrip("/")
    client = s3_client()

    try:
        parts_data = client._list_object_parts(bucket_name, object_name, upload_id)

        parts = []
        for part in parts_data:
            parts.append({
                'part_number': part.part_number,
                'etag': part.etag.strip('"') if part.etag else ''
            })

        log.debug(f"Listed {len(parts)} parts for {object_name}")
        return parts
    except Exception as e:
        log.error(f"Error listing parts: {e}")
        raise