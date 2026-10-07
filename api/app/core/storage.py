"""MinIO (S3 API) storage for uploaded PDFs. boto3 is blocking, so calls run in a thread."""

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from functools import lru_cache
from typing import IO, Any

import boto3
from anyio import to_thread
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import get_settings

logger = logging.getLogger(__name__)

STREAM_CHUNK_SIZE = 64 * 1024


def document_key(org_id: str, document_id: str) -> str:
    return f"orgs/{org_id}/documents/{document_id}.pdf"


@lru_cache
def get_client() -> Any:  # botocore clients are dynamically typed
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if settings.s3_force_path_style else "virtual"},
            connect_timeout=5,
            read_timeout=60,
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    )


def _bucket() -> str:
    return get_settings().s3_bucket


@dataclass
class ObjectStream:
    """A stored object opened for reading. Pass `iterator` to a StreamingResponse
    (Starlette iterates sync iterators in a threadpool); the body closes when it ends."""

    iterator: Iterator[bytes]
    content_length: int | None
    content_type: str | None


async def put_pdf(key: str, fileobj: IO[bytes], size: int) -> None:
    await to_thread.run_sync(
        lambda: get_client().put_object(
            Bucket=_bucket(),
            Key=key,
            Body=fileobj,
            ContentLength=size,
            ContentType="application/pdf",
        )
    )


async def open_stream(key: str) -> ObjectStream:
    response = await to_thread.run_sync(lambda: get_client().get_object(Bucket=_bucket(), Key=key))
    body = response["Body"]

    def iterate() -> Iterator[bytes]:
        try:
            yield from body.iter_chunks(STREAM_CHUNK_SIZE)
        finally:
            body.close()

    return ObjectStream(
        iterator=iterate(),
        content_length=response.get("ContentLength"),
        content_type=response.get("ContentType"),
    )


async def delete(key: str) -> None:
    await to_thread.run_sync(lambda: get_client().delete_object(Bucket=_bucket(), Key=key))


def _ensure_bucket_sync() -> bool:
    client, bucket = get_client(), _bucket()
    try:
        client.head_bucket(Bucket=bucket)
        return False
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code not in {"404", "NoSuchBucket", "NotFound"}:
            raise
    # Dev convenience; in prod the bucket is provisioned with the MinIO service.
    client.create_bucket(Bucket=bucket)
    return True


async def ensure_bucket() -> None:
    created = await to_thread.run_sync(_ensure_bucket_sync)
    logger.info("Storage bucket %r %s", _bucket(), "created" if created else "is ready")
