from http import HTTPStatus
from fastapi import HTTPException
import requests
from urllib.parse import urlencode
import json
from app.models.enums import HTTPStatus
from loguru import logger as log


async def upload_orthophoto_to_oam(oam_params, download_url):
    """
    Uploads an orthophoto to OpenAerialMap (OAM) using provided parameters.

    Args:
        oam_params: A dictionary of OAM parameters.
        download_url: The URL of the orthophoto file.
    """
    try:
        # Prepare the API URL with encoded parameters
        api_url = f"https://api.openaerialmap.org/dronedeploy?{urlencode(oam_params)}"

        response = requests.post(
            api_url,
            json={"download_path": download_url},
        )

        res = response.json()
        if (
            response.status_code == 200
            and "results" in res
            and "upload" in res["results"]
        ):
            oam_upload_id = res["results"]["upload"]
            log.info(
                f"Orthophoto successfully uploaded to OAM with ID: {oam_upload_id}"
            )
            return oam_upload_id
        else:
            err_msg = f"Failed to upload orthophoto. Response: {json.dumps(res)}"
            raise HTTPException(
                status_code=HTTPStatus.INTERNAL_SERVER_ERROR, detail=err_msg
            )

    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail=f"Error: {e}",
        )
