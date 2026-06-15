from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .auth import require_access_token
from .compliance import check_text
from .db import close_db, connect_db, fetch_row, fetch_rows
from .models import ComplianceCheckIn, FeedbackIn, KnowledgeEntryIn, MetricIn, PublishQueueIn, PublishQueueStatusIn
from . import supabase_rest


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    yield
    await close_db()


app = FastAPI(
    title="DREC Content OS API",
    version="0.1.0",
    description="Stage 1 API for the DREC Content OS thin core.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    postgres_status = "configured" if await fetch_row("select 1 as ok") else "not_connected"
    supabase_status = "configured" if supabase_rest.configured() else "not_connected"
    return {
        "ok": True,
        "service": "drec-content-os-api",
        "postgres": postgres_status,
        "supabase_rest": supabase_status,
    }


@app.get("/kb")
async def list_knowledge_entries(_: None = Depends(require_access_token)):
    rows = await fetch_rows(
        """
        select id, category, title, body, tags, created_at
        from kb_entries
        order by created_at desc
        limit 100
        """
    )
    if not rows:
        rows = await supabase_rest.select(
            "kb_entries",
            {
                "select": "id,category,title,body,tags,created_at",
                "order": "created_at.desc",
                "limit": "100",
            },
        )
    return {"items": rows}


@app.post("/kb")
async def create_knowledge_entry(entry: KnowledgeEntryIn, _: None = Depends(require_access_token)):
    row = await fetch_row(
        """
        insert into kb_entries (category, title, body, tags)
        values ($1, $2, $3, $4)
        returning id, category, title, body, tags, created_at
        """,
        entry.category,
        entry.title,
        entry.body,
        entry.tags,
    )
    if row is None:
        row = await supabase_rest.insert(
            "kb_entries",
            {
                "category": entry.category,
                "title": entry.title,
                "body": entry.body,
                "tags": entry.tags,
            },
        )
    return {"item": row or entry.model_dump()}


@app.get("/publish-queue")
async def list_publish_queue(_: None = Depends(require_access_token)):
    rows = await fetch_rows(
        """
        select id, channel, format, caption, media_urls, planned_slot, status,
               compliance_status, created_at
        from publish_queue
        order by planned_slot nulls last, created_at desc
        limit 100
        """
    )
    if not rows:
        rows = await supabase_rest.select(
            "publish_queue",
            {
                "select": "id,channel,format,caption,media_urls,planned_slot,status,compliance_status,created_at",
                "order": "planned_slot.asc.nullslast,created_at.desc",
                "limit": "100",
            },
        )
    return {"items": rows}


@app.post("/compliance/check")
async def check_compliance(item: ComplianceCheckIn, _: None = Depends(require_access_token)):
    return check_text(item.text)


@app.post("/publish-queue")
async def create_publish_queue_item(item: PublishQueueIn, _: None = Depends(require_access_token)):
    compliance = check_text(item.caption)
    if compliance["status"] == "flagged":
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Compliance check blocked this caption.",
                "compliance": compliance,
            },
        )
    compliance_status = "pending" if compliance["status"] == "pending" else item.compliance_status
    row = await fetch_row(
        """
        insert into publish_queue
          (channel, format, caption, media_urls, planned_slot, compliance_status)
        values ($1, $2, $3, $4, $5, $6)
        returning id, channel, format, caption, media_urls, planned_slot, status,
                  compliance_status, created_at
        """,
        item.channel,
        item.format,
        item.caption,
        item.media_urls,
        item.planned_slot,
        compliance_status,
    )
    if row is None:
        row = await supabase_rest.insert(
            "publish_queue",
            {
                "channel": item.channel,
                "format": item.format,
                "caption": item.caption,
                "media_urls": item.media_urls,
                "planned_slot": item.planned_slot.isoformat() if item.planned_slot else None,
                "compliance_status": compliance_status,
            },
        )
    return {"item": row or item.model_dump()}


@app.patch("/publish-queue/{item_id}")
async def update_publish_queue_item(
    item_id: str,
    update: PublishQueueStatusIn,
    _: None = Depends(require_access_token),
):
    if update.status == "scheduled":
        existing = await fetch_row(
            "select compliance_status from publish_queue where id = $1",
            item_id,
        )
        if existing is None:
            rows = await supabase_rest.select(
                "publish_queue",
                {"select": "compliance_status", "id": f"eq.{item_id}", "limit": "1"},
            )
            existing = rows[0] if rows else None
        if (existing or {}).get("compliance_status") != "clear":
            raise HTTPException(
                status_code=422,
                detail="Only compliance-clear items can be scheduled.",
            )
    row = await fetch_row(
        """
        update publish_queue
        set status = $2, updated_at = now()
        where id = $1
        returning id, channel, format, caption, media_urls, planned_slot, status,
                  compliance_status, created_at
        """,
        item_id,
        update.status,
    )
    if row is None:
        row = await supabase_rest.update(
            "publish_queue",
            {"status": update.status},
            {"id": f"eq.{item_id}"},
        )
    return {"item": row or {"id": item_id, "status": update.status}}


@app.post("/metrics")
async def ingest_metric(metric: MetricIn, _: None = Depends(require_access_token)):
    row = await fetch_row(
        """
        insert into raw_metrics (source, external_post_id, captured_at, metrics)
        values ($1, $2, $3, $4::jsonb)
        returning id, source, external_post_id, captured_at, metrics, created_at
        """,
        metric.source,
        metric.external_post_id,
        metric.captured_at,
        metric.metrics,
    )
    if row is None:
        row = await supabase_rest.insert(
            "raw_metrics",
            {
                "source": metric.source,
                "external_post_id": metric.external_post_id,
                "captured_at": metric.captured_at.isoformat(),
                "metrics": metric.metrics,
            },
        )
    return {"item": row or metric.model_dump()}


@app.post("/feedback")
async def capture_feedback(feedback: FeedbackIn, _: None = Depends(require_access_token)):
    row = await fetch_row(
        """
        insert into feedback
          (module, ref_type, ref_id, action, before_text, after_text, reason, tags)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning id, module, ref_type, ref_id, action, reason, tags, created_at
        """,
        feedback.module,
        feedback.ref_type,
        feedback.ref_id,
        feedback.action,
        feedback.before_text,
        feedback.after_text,
        feedback.reason,
        feedback.tags,
    )
    if row is None:
        row = await supabase_rest.insert(
            "feedback",
            {
                "module": feedback.module,
                "ref_type": feedback.ref_type,
                "ref_id": feedback.ref_id,
                "action": feedback.action,
                "before_text": feedback.before_text,
                "after_text": feedback.after_text,
                "reason": feedback.reason,
                "tags": feedback.tags,
            },
        )
    return {"item": row or feedback.model_dump()}


@app.get("/loop-status")
async def loop_status(_: None = Depends(require_access_token)):
    queue = await fetch_rows(
        "select status, count(*)::int as count from publish_queue group by status"
    )
    feedback_count = await fetch_row("select count(*)::int as count from feedback")
    kb_count = await fetch_row("select count(*)::int as count from kb_entries")
    metric_count = await fetch_row("select count(*)::int as count from raw_metrics")
    if not queue and supabase_rest.configured():
        queue_rows = await supabase_rest.select(
            "publish_queue",
            {"select": "status", "limit": "1000"},
        )
        counts = {}
        for row in queue_rows:
            status = row.get("status", "unknown")
            counts[status] = counts.get(status, 0) + 1
        queue = [{"status": status, "count": count} for status, count in counts.items()]
        feedback_count = {"count": await supabase_rest.count("feedback")}
        kb_count = {"count": await supabase_rest.count("kb_entries")}
        metric_count = {"count": await supabase_rest.count("raw_metrics")}
    return {
        "stage": "stage_1_thin_core",
        "beats": ["sense", "decide", "create", "review", "publish", "measure", "learn"],
        "queue": queue,
        "feedback_count": (feedback_count or {}).get("count", 0),
        "kb_count": (kb_count or {}).get("count", 0),
        "metric_count": (metric_count or {}).get("count", 0),
    }
