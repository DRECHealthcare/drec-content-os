from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import close_db, connect_db, fetch_row, fetch_rows
from .models import FeedbackIn, KnowledgeEntryIn, MetricIn, PublishQueueIn


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
    db_status = "configured" if await fetch_row("select 1 as ok") else "not_connected"
    return {"ok": True, "service": "drec-content-os-api", "database": db_status}


@app.get("/kb")
async def list_knowledge_entries():
    rows = await fetch_rows(
        """
        select id, category, title, body, tags, created_at
        from kb_entries
        order by created_at desc
        limit 100
        """
    )
    return {"items": rows}


@app.post("/kb")
async def create_knowledge_entry(entry: KnowledgeEntryIn):
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
    return {"item": row or entry.model_dump()}


@app.get("/publish-queue")
async def list_publish_queue():
    rows = await fetch_rows(
        """
        select id, channel, format, caption, media_urls, planned_slot, status,
               compliance_status, created_at
        from publish_queue
        order by planned_slot nulls last, created_at desc
        limit 100
        """
    )
    return {"items": rows}


@app.post("/publish-queue")
async def create_publish_queue_item(item: PublishQueueIn):
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
        item.compliance_status,
    )
    return {"item": row or item.model_dump()}


@app.post("/metrics")
async def ingest_metric(metric: MetricIn):
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
    return {"item": row or metric.model_dump()}


@app.post("/feedback")
async def capture_feedback(feedback: FeedbackIn):
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
    return {"item": row or feedback.model_dump()}


@app.get("/loop-status")
async def loop_status():
    queue = await fetch_rows(
        "select status, count(*)::int as count from publish_queue group by status"
    )
    feedback_count = await fetch_row("select count(*)::int as count from feedback")
    kb_count = await fetch_row("select count(*)::int as count from kb_entries")
    metric_count = await fetch_row("select count(*)::int as count from raw_metrics")
    return {
        "stage": "stage_1_thin_core",
        "beats": ["sense", "decide", "create", "review", "publish", "measure", "learn"],
        "queue": queue,
        "feedback_count": (feedback_count or {}).get("count", 0),
        "kb_count": (kb_count or {}).get("count", 0),
        "metric_count": (metric_count or {}).get("count", 0),
    }
