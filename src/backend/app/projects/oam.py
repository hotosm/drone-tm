import base64
import os
from datetime import datetime
from typing import Dict, List
from urllib.parse import urlencode

import aiohttp
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from loguru import logger as log
from psycopg import Connection

from app.config import settings
from app.models.enums import OAMUploadStatus
from app.projects import project_logic
from app.s3 import get_orthophoto_url_for_project
from app.users.user_logic import get_oam_token_for_user


def derive_encryption_key(user_id: str):
    """Derives a unique encryption key for each user.
    A salt is added to the hashing process to force their uniqueness, increase complexity without
    increasing user requirements, and mitigate password attacks like hash tables
    """
    salt = settings.SECRET_KEY.encode()
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,  # 32 bytes = 256 bits (valid for AES-256)
        salt=salt,
        iterations=100000,
    )
    return kdf.derive(user_id.encode())  # Return raw key bytes


def encrypt_oam_api_token(user_id: str, oam_api_token: str):
    """Encrypts an API token using AES-GCM encryption with a user-specific key.

    The function generates a random 12-byte IV (Initialization Vector) and encrypts
    the token.
    The resulting data (IV + tag + ciphertext) is base64-encoded for safe storage or transmission.

    Args:
        user_id (str): The unique identifier of the user.
        oam_api_token (str): The API token to be encrypted.

    Returns:
        str: The encrypted API token, base64-encoded.
    """
    key = derive_encryption_key(user_id)  # Ensure key is raw bytes
    iv = os.urandom(12)  # AES-GCM requires a 12-byte IV
    cipher = Cipher(algorithms.AES(key), modes.GCM(iv))
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(oam_api_token.encode()) + encryptor.finalize()

    # Combine IV, tag, and ciphertext, then base64 encode for storage
    encrypted_data = iv + encryptor.tag + ciphertext
    return base64.b64encode(encrypted_data).decode()


def decrypt_oam_api_token(user_id: str, encrypted_token: str):
    """Decrypts an API token encrypted with AES-GCM using the user-specific key.

    The function decodes the base64-encoded encrypted data, extracts the IV,
    authentication tag, and ciphertext, then decrypts the data to retrieve
    the original API token.

    Args:
        user_id (str): The unique identifier of the user.
        encrypted_token (str): The base64-encoded encrypted API token from the database.

    Returns:
        str: The decrypted API token in plaintext.
    """
    key = derive_encryption_key(user_id)
    data = base64.b64decode(encrypted_token)

    iv, tag, ciphertext = data[:12], data[12:28], data[28:]

    cipher = Cipher(algorithms.AES(key), modes.GCM(iv, tag))
    decryptor = cipher.decryptor()

    decrypted_data = decryptor.update(ciphertext) + decryptor.finalize()
    return decrypted_data.decode()


async def upload_to_oam(db: Connection, project, user_data, tags: Dict[str, List[str]]):
    """Upload project orthophoto to OpenAerialMap with status tracking."""

    async def handle_upload_failure(message: str):
        """Helper function to handle OAM upload failures"""
        await project_logic.update_project_oam_status(
            db, project.id, OAMUploadStatus.FAILED
        )
        log.error(message)
        return None

    # Check for OAM token
    oam_api_token = await get_oam_token_for_user(db, user_data.id)
    if not oam_api_token:
        return await handle_upload_failure(
            f"OAM API token not found for user {user_data.id}"
        )

    # Get orthophoto URL
    orthophoto_url = get_orthophoto_url_for_project(project.id)
    if not orthophoto_url:
        return await handle_upload_failure(
            f"Orthophoto not found for project {project.id}"
        )

    decrypted_oam_token = decrypt_oam_api_token(user_data.id, oam_api_token)

    # Prepare tags and parameters
    default_tags = ["dronetm", "naxa", "hotosm"]
    user_tags = tags.get("tags", [])
    combined_tags = list(set(default_tags + user_tags))

    oam_params = {
        "acquisition_end": datetime.now().isoformat(),
        "acquisition_start": datetime.now().isoformat(),
        "provider": f"{user_data.name}",
        "sensor": "DJI MINI4",
        "tags": combined_tags,
        "title": project.name,
        "token": decrypted_oam_token,
    }

    # Prepare the API URL with encoded parameters
    oam_upload_url = (
        f"https://api.openaerialmap.org/dronedeploy?{urlencode(oam_params)}"
    )

    # Make the API request
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                oam_upload_url,
                json={"download_path": orthophoto_url},
            ) as response:
                res = await response.json()
                if (
                    response.status == 200
                    and "results" in res
                    and "upload" in res["results"]
                ):
                    oam_upload_id = res["results"]["upload"]

                    # Update status to UPLOADED
                    await project_logic.update_project_oam_status(
                        db, project.id, OAMUploadStatus.UPLOADED
                    )
                    log.info(
                        f"Orthophoto successfully uploaded to OAM with ID: {oam_upload_id}"
                    )
                else:
                    err_msg = res.get("message", "Failed to upload to OAM")
                    return await handle_upload_failure(f"OAM upload failed: {err_msg}")
    except Exception as e:
        return await handle_upload_failure(
            f"Error during OAM upload for project {project.id}: {str(e)}"
        )

    return {
        "message": "Upload initiated",
        "project_id": project.id,
        "oam_id": oam_upload_id,
    }
