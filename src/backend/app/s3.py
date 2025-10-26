from datetime import timedelta
from io import BytesIO
from typing import Any
from urllib.parse import urljoin, urlparse

import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from loguru import logger as log

from app.config import settings
from app.utils import strip_presigned_url_for_local_dev

# For presigned URL generation, use signature version 2 for MinIO compatibility
from botocore.client import Config


def s3_client(use_public_endpoint=False):
    """Return the initialised S3 client with credentials.

    Args:
        use_public_endpoint: If True and in DEBUG mode, use S3_DOWNLOAD_ROOT for presigned URLs
    """
    # Determine which endpoint to use
    if use_public_endpoint and settings.DEBUG and settings.S3_DOWNLOAD_ROOT:
        endpoint_url = settings.S3_DOWNLOAD_ROOT
    else:
        endpoint_url = settings.S3_ENDPOINT

    # Ensure the endpoint has proper protocol
    if not endpoint_url.startswith(('http://', 'https://')):
        endpoint_url = f"http://{endpoint_url}"

    log.debug(f"Connecting to S3 server via boto3 at {endpoint_url}")

    

    return boto3.client(
        's3',
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name='us-east-1', 
        use_ssl=endpoint_url.startswith('https://'),
        verify=False, 
        config=Config(
            signature_version='s3v4',
            s3={'addressing_style': 'path'}
        )
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
        # Remove leading slash if present for boto3 compatibility
        object_name = object_name.lstrip("/")
        client.head_object(Bucket=bucket_name, Key=object_name)
        return True
    except ClientError:
        return False


def add_file_to_bucket(bucket_name: str, file_path: str, s3_path: str):
    """Upload a file from the filesystem to an S3 bucket.

    Args:
        bucket_name (str): The name of the S3 bucket.
        file_path (str): The path to the file on the local filesystem.
        s3_path (str): The path in the S3 bucket where the file will be stored.
    """
    # Remove leading slash for boto3 compatibility
    s3_path = s3_path.lstrip("/")

    client = s3_client()
    client.upload_file(file_path, bucket_name, s3_path)
    log.debug(f"Uploaded file {file_path} to {bucket_name}/{s3_path}")


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
    # Strip "/" from start of s3_path (not required by boto3)
    s3_path = s3_path.lstrip("/")

    client = s3_client()
    # Set BytesIO object to start, prior to .read()
    file_obj.seek(0)

    # Prepare extra args for put_object
    extra_args = kwargs.copy()
    extra_args['ContentType'] = content_type

    response = client.put_object(
        Bucket=bucket_name,
        Key=s3_path,
        Body=file_obj,
        **extra_args
    )
    log.debug(
        f"Created {s3_path} object; etag: {response.get('ETag', 'N/A')}, "
        f"version-id: {response.get('VersionId', 'N/A')}"
    )


def get_file_from_bucket(bucket_name: str, s3_path: str, file_path: str):
    """Download a file from an S3 bucket and save it to the local filesystem.

    Args:
        bucket_name (str): The name of the S3 bucket.
        s3_path (str): The path to the file in the S3 bucket.
        file_path (str): The path on the local filesystem where the S3
            file will be saved.
    """
    # Remove leading slash for boto3 compatibility
    s3_path = s3_path.lstrip("/")

    try:
        client = s3_client()
        client.download_file(bucket_name, s3_path, file_path)
        log.debug(f"Downloaded {bucket_name}/{s3_path} to {file_path}")
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code == '404' or error_code == 'NoSuchKey':
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
    # Remove leading slash for boto3 compatibility
    s3_path = s3_path.lstrip("/")

    client = s3_client()
    try:
        response = client.get_object(Bucket=bucket_name, Key=s3_path)
        return BytesIO(response['Body'].read())
    except ClientError as e:
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
        # Remove leading slash for boto3
        prefix = image_dir.lstrip("/")
        response = client.list_objects_v2(Bucket=bucket_name, Prefix=prefix, MaxKeys=1)
        if response.get('Contents'):
            return url
        else:
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
    # Remove leading slash for boto3
    prefix = prefix.lstrip("/")

    objects = []
    paginator = client.get_paginator('list_objects_v2')
    page_iterator = paginator.paginate(Bucket=bucket_name, Prefix=prefix)

    for page in page_iterator:
        if 'Contents' in page:
            # Convert boto3 format to be compatible with old minio code
            for obj in page['Contents']:
                # Create a simple object with attributes for compatibility
                class S3Object:
                    def __init__(self, key, size, etag, last_modified):
                        self.object_name = key
                        self.size = size
                        self.etag = etag
                        self.last_modified = last_modified

                objects.append(S3Object(
                    obj['Key'],
                    obj.get('Size', 0),
                    obj.get('ETag', ''),
                    obj.get('LastModified', None)
                ))

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
    client = s3_client(use_public_endpoint=True)
    # Remove leading slash for boto3
    object_name = object_name.lstrip("/")

    url = client.generate_presigned_url(
        'get_object',
        Params={'Bucket': bucket_name, 'Key': object_name},
        ExpiresIn=expires * 3600  # Convert hours to seconds
    )
    return url


def get_object_metadata(bucket_name: str, object_name: str):
    """Get object metadata from an S3 bucket.

    Args:
        bucket_name (str): The name of the S3 bucket.
        object_name (str): The name of the object in the bucket.

    Returns:
        dict: A dictionary containing metadata about the object.
    """
    client = s3_client()
    # Remove leading slash for boto3
    object_name = object_name.lstrip("/")

    return client.head_object(Bucket=bucket_name, Key=object_name)


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
            client.head_object(Bucket=bucket_name, Key=source_path)
        except ClientError:
            log.warning(f"Source file not found: {source_path} in bucket {bucket_name}")
            return False

        # Copy the object within the same bucket
        copy_source = {
            'Bucket': bucket_name,
            'Key': source_path
        }

        result = client.copy_object(
            Bucket=bucket_name,
            Key=destination_path,
            CopySource=copy_source
        )

        log.debug(
            f"Successfully copied object within {bucket_name} "
            f"from {source_path} to {destination_path}. "
            f"ETag: {result.get('ETag', 'N/A')}, Version ID: {result.get('VersionId', 'N/A')}"
        )
        return True

    except ClientError as e:
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
        response = client.create_multipart_upload(
            Bucket=bucket_name,
            Key=object_name
        )
        upload_id = response['UploadId']
        log.debug(f"Initiated multipart upload for {object_name} with upload ID: {upload_id}")
        return upload_id
    except ClientError as e:
        log.error(f"Error initiating multipart upload: {e}")
        raise
    except Exception as e:
        log.error(f"Unexpected error during multipart upload initiation: {e}")
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

    # Use public endpoint (localhost:9000) for presigned URLs
    # Backend can now reach localhost:9000 via extra_hosts mapping to host-gateway
    client = s3_client(use_public_endpoint=True)

    try:
        # Generate presigned URL signed for localhost:9000
        url = client.generate_presigned_url(
            'upload_part',
            Params={
                'Bucket': bucket_name,
                'Key': object_name,
                'UploadId': upload_id,
                'PartNumber': part_number
            },
            ExpiresIn=expires * 3600  # Convert hours to seconds
        )

        log.debug(f"Generated presigned URL for part {part_number} of {object_name}")
        return url
    except ClientError as e:
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
        # Format parts for boto3 (expects 'PartNumber' and 'ETag' keys)
        formatted_parts = []
        for part in parts:
            formatted_part = {}
            # Handle both lowercase and uppercase key names
            if 'PartNumber' in part:
                formatted_part['PartNumber'] = part['PartNumber']
            elif 'part_number' in part:
                formatted_part['PartNumber'] = part['part_number']

            if 'ETag' in part:
                formatted_part['ETag'] = part['ETag']
            elif 'etag' in part:
                formatted_part['ETag'] = part['etag']

            formatted_parts.append(formatted_part)

        result = client.complete_multipart_upload(
            Bucket=bucket_name,
            Key=object_name,
            UploadId=upload_id,
            MultipartUpload={
                'Parts': formatted_parts
            }
        )
        log.info(
            f"Completed multipart upload for {object_name}. "
            f"ETag: {result.get('ETag', 'N/A')}, Version ID: {result.get('VersionId', 'N/A')}"
        )
        return True
    except ClientError as e:
        log.error(f"Error completing multipart upload: {e}")
        raise
    except Exception as e:
        log.error(f"Unexpected error completing multipart upload: {e}")
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
        client.abort_multipart_upload(
            Bucket=bucket_name,
            Key=object_name,
            UploadId=upload_id
        )
        log.info(f"Aborted multipart upload for {object_name} with upload ID: {upload_id}")
        return True
    except ClientError as e:
        log.error(f"Error aborting multipart upload: {e}")
        raise
    except Exception as e:
        log.error(f"Unexpected error aborting multipart upload: {e}")
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
        parts = []
        paginator = client.get_paginator('list_parts')
        page_iterator = paginator.paginate(
            Bucket=bucket_name,
            Key=object_name,
            UploadId=upload_id
        )

        for page in page_iterator:
            if 'Parts' in page:
                for part in page['Parts']:
                    parts.append({
                        'part_number': part['PartNumber'],
                        'etag': part['ETag']
                    })

        log.debug(f"Listed {len(parts)} parts for {object_name}")
        return parts
    except ClientError as e:
        log.error(f"Error listing parts: {e}")
        raise
    except Exception as e:
        log.error(f"Unexpected error listing parts: {e}")
        raise