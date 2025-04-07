from datetime import datetime
from typing import Dict, List
from urllib.parse import urlencode

import aiohttp
from loguru import logger as log
from psycopg import Connection

from app.models.enums import OAMUploadStatus
from app.projects import project_logic
from app.s3 import get_orthophoto_url_for_project
from app.users.user_logic import get_oam_token_for_user
from app.config import decrypt_token


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

    decrypted_oam_token = decrypt_token(user_data.id, oam_api_token)

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
