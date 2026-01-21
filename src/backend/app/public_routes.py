from fastapi import APIRouter, HTTPException, Query

from app.models.enums import HTTPStatus
from app.s3 import maybe_presign_s3_key

router = APIRouter(tags=["Public"])


@router.get("/public/presigned-url")
async def get_public_presigned_url(
    key: str = Query(..., description="S3 object key (e.g. tutorials/Foo.mp4)"),
    expires_hours: int = Query(2, ge=1, le=24),
):
    """Return a presigned GET URL for a limited set of public-facing objects.

    This allows keeping the bucket private while still serving a few static resources
    (e.g. landing-page downloads, tutorial videos) without hardcoding bucket URLs in the frontend.
    """
    allowed_prefixes = ("tutorials/", "publicuploads/")
    if not key or not key.startswith(allowed_prefixes):
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail="Key is not allowed",
        )

    try:
        return {"url": maybe_presign_s3_key(key, expires_hours=expires_hours)}
    except Exception as e:
        raise HTTPException(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
