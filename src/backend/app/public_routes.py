from typing import Optional

from arq import ArqRedis
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.arq.tasks import get_redis_pool
from app.config import settings
from app.models.enums import HTTPStatus
from app.s3 import maybe_presign_s3_key

router = APIRouter(tags=["Public"])


class ScaleOdmWebhookPayload(BaseModel):
    """Body ScaleODM POSTs on a terminal status transition."""

    uuid: str
    statusCode: Optional[int] = None


@router.post("/integrations/scaleodm/webhook", tags=["Integrations"])
async def scaleodm_webhook(
    payload: ScaleOdmWebhookPayload,
    redis_pool: ArqRedis = Depends(get_redis_pool),
    token: Optional[str] = Query(None),
):
    """Untrusted trigger from ScaleODM: enqueue a reconcile for one task.

    Only the uuid is used; the reconcile re-derives status itself. The optional
    token just cuts noise, so correctness never depends on it.
    """
    secret = settings.SCALEODM_WEBHOOK_SECRET
    if secret and token != secret:
        raise HTTPException(
            status_code=HTTPStatus.UNAUTHORIZED,
            detail="Invalid webhook token",
        )

    # _job_id keyed on the uuid coalesces duplicate pokes for the same task.
    await redis_pool.enqueue_job(
        "reconcile_odm_by_uuid",
        payload.uuid,
        _job_id=f"odm-reconcile:{payload.uuid}",
        _queue_name="default_queue",
    )
    return {"status": "accepted", "uuid": payload.uuid}


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
