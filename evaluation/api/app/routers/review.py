"""Human review (E9): queues sampled from a run, the next item for a reviewer, grading."""

import uuid

from fastapi import APIRouter, Response, status
from sqlalchemy import select

from app.core.security import AdminDep, SessionDep
from app.models import ReviewQueue, Run
from app.schemas.review import (
    ItemOut,
    ItemSummary,
    NextOut,
    Progress,
    QueueDetailOut,
    QueueIn,
    QueueListOut,
    QueueOut,
    ReviewIn,
    ReviewOut,
)
from app.services import review as service

router = APIRouter(tags=["review"])


async def _queues_out(
    session: SessionDep, queues: list[ReviewQueue], reviewer: str
) -> list[QueueOut]:
    states = await service.item_states(session, [q.id for q in queues], reviewer)
    names = dict(
        (
            await session.execute(
                select(Run.id, Run.name).where(Run.id.in_({q.run_id for q in queues}))
            )
        ).all()
    )
    out = []
    for queue in queues:
        item = QueueOut.model_validate(queue)
        item.run_name = names.get(queue.run_id)
        item.progress = Progress(**service.progress(states.get(queue.id, [])))
        out.append(item)
    return out


@router.post("/review-queues", status_code=status.HTTP_201_CREATED)
async def create_queue(admin: AdminDep, session: SessionDep, body: QueueIn) -> QueueOut:
    queue = await service.create_queue(
        session,
        run_id=body.run_id,
        name=body.name,
        metrics=body.metrics,
        sampling=body.sampling,
        size=body.size,
        blind=body.blind,
        seed=body.seed,
        created_by=admin.id,
    )
    await session.commit()
    return (await _queues_out(session, [queue], admin.id))[0]


@router.get("/review-queues")
async def list_queues(
    admin: AdminDep, session: SessionDep, run_id: uuid.UUID | None = None
) -> QueueListOut:
    stmt = select(ReviewQueue).order_by(ReviewQueue.created_at.desc())
    if run_id:
        stmt = stmt.where(ReviewQueue.run_id == run_id)
    queues = list((await session.scalars(stmt)).all())
    return QueueListOut(queues=await _queues_out(session, queues, admin.id))


@router.get("/review-queues/{queue_id}")
async def get_queue(admin: AdminDep, session: SessionDep, queue_id: uuid.UUID) -> QueueDetailOut:
    queue = await service.get_queue_or_404(session, queue_id)
    states = (await service.item_states(session, [queue.id], admin.id)).get(queue.id, [])
    out = (await _queues_out(session, [queue], admin.id))[0]
    return QueueDetailOut(
        **out.model_dump(),
        items=[ItemSummary(**{k: getattr(s, k) for k in ItemSummary.model_fields}) for s in states],
    )


@router.delete("/review-queues/{queue_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_queue(_: AdminDep, session: SessionDep, queue_id: uuid.UUID) -> Response:
    """The queue and its items; the reviews stay (they belong to the run cases)."""
    queue = await service.get_queue_or_404(session, queue_id)
    await session.delete(queue)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/review-queues/{queue_id}/next")
async def next_item(admin: AdminDep, session: SessionDep, queue_id: uuid.UUID) -> NextOut:
    """The first item (by position) this reviewer hasn't graded or skipped."""
    queue = await service.get_queue_or_404(session, queue_id)
    states = (await service.item_states(session, [queue.id], admin.id)).get(queue.id, [])
    found = service.next_item(states)
    item = None
    if found is not None:
        row = await service.get_item_or_404(session, queue.id, found.id)
        item = ItemOut(**await service.item_view(session, queue, row, admin.id))
    return NextOut(item=item, progress=Progress(**service.progress(states)))


@router.get("/review-queues/{queue_id}/items/{item_id}")
async def get_item(
    admin: AdminDep, session: SessionDep, queue_id: uuid.UUID, item_id: uuid.UUID
) -> ItemOut:
    queue = await service.get_queue_or_404(session, queue_id)
    item = await service.get_item_or_404(session, queue_id, item_id)
    return ItemOut(**await service.item_view(session, queue, item, admin.id))


@router.post("/review-queues/{queue_id}/items/{item_id}/skip")
async def skip_item(
    admin: AdminDep, session: SessionDep, queue_id: uuid.UUID, item_id: uuid.UUID
) -> NextOut:
    """Skip for this reviewer; answers with their next item."""
    item = await service.get_item_or_404(session, queue_id, item_id, for_update=True)
    await service.skip(session, item, admin.id)
    await session.commit()
    return await next_item(admin, session, queue_id)


@router.post("/reviews")
async def submit_review(admin: AdminDep, session: SessionDep, body: ReviewIn) -> ReviewOut:
    """Grades for every metric of the item at once; the answer reveals the judge's."""
    queue = await service.get_queue_or_404(session, body.queue_id)
    item = await service.get_item_or_404(session, queue.id, body.item_id, for_update=True)
    grades = [service.Grade(**g.model_dump()) for g in body.grades]
    await service.submit(session, queue, item, admin.id, grades)
    await session.commit()
    states = (await service.item_states(session, [queue.id], admin.id)).get(queue.id, [])
    return ReviewOut(
        item=ItemOut(**await service.item_view(session, queue, item, admin.id)),
        progress=Progress(**service.progress(states)),
    )
