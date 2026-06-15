from contextlib import asynccontextmanager
import json

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .auth import require_access_token
from .compliance import check_text
from .db import close_db, connect_db, fetch_row, fetch_rows
from .models import (
    AssetIn,
    ComplianceCheckIn,
    ContentBriefIn,
    CreativeDraftIn,
    FeedbackIn,
    KnowledgeEntryIn,
    LearningWeightIn,
    MediaAssetIn,
    MetricIn,
    MetricRollupIn,
    OutcomeIn,
    PublishQueueIn,
    PublishQueueStatusIn,
    WeeklyPlanIn,
)
from . import supabase_rest


DEFAULT_PLAN_TOPICS = [
    "为什么空腹血糖正常，不代表胰岛素一定健康",
    "餐后血糖和腰围，如何一起看代谢风险",
    "逆转医学内容里，为什么要先谈习惯和数据，而不是奇迹",
    "看体检报告时，HbA1c、甘油三酯和腰围各自代表什么",
    "给50岁以上华人的控糖复诊问题清单",
]

FORMAT_ROTATION = ["carousel", "single", "reel", "carousel", "story"]
STAGE_ROTATION = ["TOFU", "TOFU", "MOFU", "MOFU", "BOFU"]


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


def brief_payload(brief: ContentBriefIn):
    return {
        "channel": brief.channel,
        "format": brief.format,
        "pillar": brief.pillar,
        "funnel_stage": brief.funnel_stage,
        "awareness_stage": brief.awareness_stage,
        "topic": brief.topic,
        "hook_primary": brief.hook_primary,
        "hook_alt1": brief.hook_alt1,
        "hook_alt2": brief.hook_alt2,
        "structure_beats": brief.structure_beats,
        "style_hint": brief.style_hint,
        "cta_type": brief.cta_type,
        "target_signal": brief.target_signal,
        "language": brief.language,
        "compliance_notes": brief.compliance_notes,
    }


async def insert_brief(brief: ContentBriefIn):
    payload = brief_payload(brief)
    row = await fetch_row(
        """
        insert into content_briefs
          (channel, format, pillar, funnel_stage, awareness_stage, topic,
           hook_primary, hook_alt1, hook_alt2, structure_beats, style_hint,
           cta_type, target_signal, language, compliance_notes)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15)
        returning id, channel, format, pillar, funnel_stage, awareness_stage, topic,
                  hook_primary, hook_alt1, hook_alt2, structure_beats, style_hint,
                  cta_type, target_signal, language, compliance_notes, status, created_at
        """,
        payload["channel"],
        payload["format"],
        payload["pillar"],
        payload["funnel_stage"],
        payload["awareness_stage"],
        payload["topic"],
        payload["hook_primary"],
        payload["hook_alt1"],
        payload["hook_alt2"],
        json.dumps(payload["structure_beats"]),
        payload["style_hint"],
        payload["cta_type"],
        payload["target_signal"],
        payload["language"],
        payload["compliance_notes"],
    )
    if row is None:
        row = await supabase_rest.insert("content_briefs", payload)
    return row or payload


def make_generated_brief(topic: str, index: int, language: str) -> ContentBriefIn:
    stage = STAGE_ROTATION[index % len(STAGE_ROTATION)]
    fmt = FORMAT_ROTATION[index % len(FORMAT_ROTATION)]
    hook = f"很多人忽略了：{topic}" if language != "en" else f"One thing people often miss: {topic}"
    return ContentBriefIn(
        channel="organic",
        format=fmt,
        pillar="metabolic_education",
        funnel_stage=stage,
        awareness_stage="problem_aware" if stage == "TOFU" else "solution_aware",
        topic=topic,
        hook_primary=hook,
        hook_alt1=f"先别急着下结论，先看懂：{topic}" if language != "en" else f"Before jumping to conclusions, understand: {topic}",
        hook_alt2=f"用一个简单框架看：{topic}" if language != "en" else f"A simple framework for: {topic}",
        structure_beats={
            "opening": "Start with a common misconception.",
            "body": ["Explain the mechanism simply.", "Give one safe practical observation.", "Invite professional review."],
            "close": "Save and discuss with a clinician.",
        },
        style_hint="DREC educational, calm, evidence-led, Mandarin-first",
        cta_type="save_or_consult",
        target_signal="saves, comments, qualified consult interest",
        language=language,
        compliance_notes="Education only. Avoid guaranteed outcomes, diagnosis, or personal medical claims.",
    )


@app.get("/briefs")
async def list_content_briefs(_: None = Depends(require_access_token)):
    rows = await fetch_rows(
        """
        select id, channel, format, pillar, funnel_stage, awareness_stage, topic,
               hook_primary, hook_alt1, hook_alt2, structure_beats, style_hint,
               cta_type, target_signal, language, compliance_notes, status, created_at
        from content_briefs
        order by created_at desc
        limit 100
        """
    )
    if not rows:
        rows = await supabase_rest.select(
            "content_briefs",
            {
                "select": "id,channel,format,pillar,funnel_stage,awareness_stage,topic,hook_primary,hook_alt1,hook_alt2,structure_beats,style_hint,cta_type,target_signal,language,compliance_notes,status,created_at",
                "order": "created_at.desc",
                "limit": "100",
            },
        )
    return {"items": rows}


@app.post("/briefs")
async def create_content_brief(brief: ContentBriefIn, _: None = Depends(require_access_token)):
    return {"item": await insert_brief(brief)}


@app.post("/weekly-plan/generate")
async def generate_weekly_plan(plan: WeeklyPlanIn, _: None = Depends(require_access_token)):
    topics = [topic.strip() for topic in plan.topics if topic.strip()] or DEFAULT_PLAN_TOPICS
    count = max(1, min(plan.count, 10))
    generated = []
    for index, topic in enumerate(topics[:count]):
        generated.append(await insert_brief(make_generated_brief(topic, index, plan.language)))
    return {"items": generated}


def asset_payload(asset: AssetIn):
    return {
        "brief_id": asset.brief_id,
        "channel": asset.channel,
        "format": asset.format,
        "caption": asset.caption,
        "media_urls": asset.media_urls,
        "metadata": asset.metadata,
        "compliance_status": asset.compliance_status,
        "review_status": asset.review_status,
    }


@app.get("/assets")
async def list_assets(_: None = Depends(require_access_token)):
    rows = await fetch_rows(
        """
        select id, brief_id, channel, format, caption, media_urls, metadata,
               compliance_status, review_status, created_at
        from assets
        order by created_at desc
        limit 100
        """
    )
    if not rows:
        rows = await supabase_rest.select(
            "assets",
            {
                "select": "id,brief_id,channel,format,caption,media_urls,metadata,compliance_status,review_status,created_at",
                "order": "created_at.desc",
                "limit": "100",
            },
        )
    return {"items": rows}


@app.post("/assets")
async def create_asset(asset: AssetIn, _: None = Depends(require_access_token)):
    payload = asset_payload(asset)
    compliance = check_text(payload["caption"] or "")
    if compliance["status"] == "flagged":
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Compliance check blocked this asset.",
                "compliance": compliance,
            },
        )
    payload["compliance_status"] = "pending" if compliance["status"] == "pending" else payload["compliance_status"]
    row = await fetch_row(
        """
        insert into assets
          (brief_id, channel, format, caption, media_urls, metadata, compliance_status, review_status)
        values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
        returning id, brief_id, channel, format, caption, media_urls, metadata,
                  compliance_status, review_status, created_at
        """,
        payload["brief_id"],
        payload["channel"],
        payload["format"],
        payload["caption"],
        payload["media_urls"],
        json.dumps(payload["metadata"]),
        payload["compliance_status"],
        payload["review_status"],
    )
    if row is None:
        row = await supabase_rest.insert("assets", payload)
    return {"item": row or payload}


def media_asset_payload(media: MediaAssetIn):
    return {
        "title": media.title,
        "source_url": media.source_url,
        "media_type": media.media_type,
        "rights_status": media.rights_status,
        "approval_status": media.approval_status,
        "notes": media.notes,
        "tags": media.tags,
        "metadata": media.metadata,
    }


@app.get("/media-assets")
async def list_media_assets(_: None = Depends(require_access_token)):
    rows = await fetch_rows(
        """
        select id, title, source_url, media_type, rights_status, approval_status,
               notes, tags, metadata, created_at
        from media_assets
        order by created_at desc
        limit 100
        """
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "media_assets",
            {
                "select": "id,title,source_url,media_type,rights_status,approval_status,notes,tags,metadata,created_at",
                "order": "created_at.desc",
                "limit": "100",
            },
        )
    return {"items": rows}


@app.post("/media-assets")
async def create_media_asset(media: MediaAssetIn, _: None = Depends(require_access_token)):
    payload = media_asset_payload(media)
    row = await fetch_row(
        """
        insert into media_assets
          (title, source_url, media_type, rights_status, approval_status, notes, tags, metadata)
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        returning id, title, source_url, media_type, rights_status, approval_status,
                  notes, tags, metadata, created_at
        """,
        payload["title"],
        payload["source_url"],
        payload["media_type"],
        payload["rights_status"],
        payload["approval_status"],
        payload["notes"],
        payload["tags"],
        json.dumps(payload["metadata"]),
    )
    if row is None and supabase_rest.configured():
        row = await supabase_rest.insert("media_assets", payload)
    return {"item": row or payload}


def caption_variants(draft: CreativeDraftIn):
    points = draft.points or ["Explain the core idea simply.", "Give one safe practical observation.", "Invite review with a clinician."]
    if draft.language == "en":
        education_line = "This is general education, not a diagnosis or treatment plan."
        return [
            "\n".join(
                [
                    f"A practical way to understand {draft.topic}:",
                    "",
                    *[f"{index + 1}. {point}" for index, point in enumerate(points[:4])],
                    "",
                    education_line,
                    "Save this for your next health conversation.",
                ]
            ),
            "\n".join(
                [
                    f"Before you make a health decision about {draft.topic}, check these points:",
                    "",
                    *[f"- {point}" for point in points[:4]],
                    "",
                    education_line,
                    "Discuss personal changes with a qualified clinician.",
                ]
            ),
        ]
    education_line = "以上是一般健康教育，不等于个人诊断或治疗方案。"
    return [
        "\n".join(
            [
                f"关于「{draft.topic}」，可以这样理解：",
                "",
                *[f"{index + 1}. {point}" for index, point in enumerate(points[:4])],
                "",
                education_line,
                "可以收藏起来，下一次和医生讨论时参考。",
            ]
        ),
        "\n".join(
            [
                f"先别急着下结论。看懂「{draft.topic}」之前，先看这几个点：",
                "",
                *[f"- {point}" for point in points[:4]],
                "",
                education_line,
                "如果与你的健康状况有关，请先咨询合格医生。",
            ]
        ),
    ]


def carousel_slides(draft: CreativeDraftIn):
    points = draft.points or ["先看误区", "再看机制", "最后给一个安全行动"]
    cta = "收藏这篇，复诊前看一遍" if draft.language != "en" else "Save this before your next check-up"
    titles = [
        draft.topic,
        "大家常误会的地方" if draft.language != "en" else "The common misconception",
        "关键机制" if draft.language != "en" else "The key mechanism",
        "可以观察什么" if draft.language != "en" else "What to observe",
        "安全提醒" if draft.language != "en" else "Safety note",
        cta,
    ]
    bodies = [
        points[0] if points else draft.topic,
        points[1] if len(points) > 1 else "不要只看单一数字，要看趋势和背景。",
        points[2] if len(points) > 2 else "用简单框架解释，不做个人诊断。",
        points[3] if len(points) > 3 else "记录饮食、腰围、餐后反应，再与医生讨论。",
        "一般健康教育，不替代诊断、处方或个人治疗建议。" if draft.language != "en" else "General education only, not personal medical advice.",
        "@drec 逆转医学" if draft.language != "en" else "@drec",
    ]
    return [
        {
            "slide": index + 1,
            "title": titles[index],
            "body": bodies[index],
            "visual_note": "Use DREC navy/teal template; no small text baked into generated images.",
        }
        for index in range(6)
    ]


def reel_script(draft: CreativeDraftIn):
    points = draft.points or ["Hook with a common belief.", "Explain the mechanism.", "Close with safe next step."]
    return [
        {"time": "0-3s", "beat": "Hook", "line": f"{draft.topic}：很多人第一步就看错了。" if draft.language != "en" else f"Most people read {draft.topic} the wrong way first."},
        {"time": "3-10s", "beat": "Context", "line": points[0]},
        {"time": "10-25s", "beat": "Mechanism", "line": points[1] if len(points) > 1 else "Explain the mechanism in plain language."},
        {"time": "25-38s", "beat": "Practical observation", "line": points[2] if len(points) > 2 else "Give one safe thing to observe, not a treatment instruction."},
        {"time": "38-45s", "beat": "Close", "line": "收藏，复诊前再看；个人调整请先问医生。" if draft.language != "en" else "Save this; ask your clinician before personal changes."},
    ]


@app.post("/creative/draft")
async def create_creative_draft(draft: CreativeDraftIn, _: None = Depends(require_access_token)):
    variants = caption_variants(draft)
    primary_caption = variants[0]
    compliance = check_text(primary_caption)
    package = {
        "channel": draft.channel,
        "format": draft.format,
        "stage": draft.stage,
        "language": draft.language,
        "topic": draft.topic,
        "style_key": draft.style_key,
        "target_signal": draft.target_signal or ("saves" if draft.format == "carousel" else "watch_time"),
        "caption_variants": variants,
        "primary_caption": primary_caption,
        "slides": carousel_slides(draft) if draft.format in ["carousel", "single", "story"] else [],
        "reel_script": reel_script(draft) if draft.format == "reel" else [],
        "compliance": compliance,
        "metadata": {
            "points": draft.points,
            "creative_engine": "deterministic_v1",
            "notes": "Human review is required before publishing.",
        },
    }
    return {"item": package}


@app.get("/publish-queue")
async def list_publish_queue(_: None = Depends(require_access_token)):
    rows = await fetch_rows(
        """
        select id, asset_id, channel, format, caption, media_urls, planned_slot, status,
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
                "select": "id,asset_id,channel,format,caption,media_urls,planned_slot,status,compliance_status,created_at",
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
          (asset_id, channel, format, caption, media_urls, planned_slot, compliance_status)
        values ($1, $2, $3, $4, $5, $6, $7)
        returning id, asset_id, channel, format, caption, media_urls, planned_slot, status,
                  compliance_status, created_at
        """,
        item.asset_id,
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
                "asset_id": item.asset_id,
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
        returning id, asset_id, channel, format, caption, media_urls, planned_slot, status,
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


@app.get("/publishing-handoff")
async def publishing_handoff(_: None = Depends(require_access_token)):
    rows = await fetch_rows(
        """
        select id, asset_id, channel, format, caption, media_urls, planned_slot, status,
               compliance_status, created_at
        from publish_queue
        where status in ('draft', 'scheduled')
        order by planned_slot nulls last, created_at desc
        limit 50
        """
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "publish_queue",
            {
                "select": "id,asset_id,channel,format,caption,media_urls,planned_slot,status,compliance_status,created_at",
                "status": "in.(draft,scheduled)",
                "order": "planned_slot.asc.nullslast,created_at.desc",
                "limit": "50",
            },
        )

    ready = [item for item in rows if item.get("status") == "scheduled" and item.get("compliance_status") == "clear"]
    blocked = [item for item in rows if item not in ready]
    checklist = [
        "Publish only items marked scheduled and compliance-clear.",
        "Keep the caption unchanged unless it goes back through review.",
        "After posting, record the post ID and first 7-day result in Performance.",
    ]
    return {
        "ready_count": len(ready),
        "blocked_count": len(blocked),
        "checklist": checklist,
        "ready_items": ready,
        "needs_review": blocked,
    }


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


def numeric_metric(metrics: dict, *keys: str) -> float:
    for key in keys:
        value = metrics.get(key)
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                continue
    return 0.0


def score_metrics(metrics: dict) -> dict:
    reach = max(numeric_metric(metrics, "reach", "impressions"), 1.0)
    saves = numeric_metric(metrics, "saves", "saved")
    shares = numeric_metric(metrics, "shares")
    comments = numeric_metric(metrics, "comments")
    likes = numeric_metric(metrics, "likes", "reactions")
    leads = numeric_metric(metrics, "leads", "registrations")
    spend = numeric_metric(metrics, "spend", "cost")
    watch_metric = numeric_metric(metrics, "avg_watch_time", "watch_time", "video_avg_time_watched")
    engagement_rate = ((saves * 3) + (shares * 4) + (comments * 2) + likes) / reach
    conversion_bonus = min(leads * 2, 20)
    score = round(min(100, (engagement_rate * 1000) + conversion_bonus + min(watch_metric, 30)), 2)
    cpl = round(spend / leads, 2) if spend and leads else None
    return {
        "score": score,
        "watch_metric": round(watch_metric, 2) if watch_metric else None,
        "shares": int(shares) if shares else 0,
        "saves": int(saves) if saves else 0,
        "cpl": cpl,
        "note": f"Rolled up from raw metrics: reach {int(reach)}, saves {int(saves)}, shares {int(shares)}, comments {int(comments)}, leads {int(leads)}.",
    }


async def latest_metric_row(external_post_id: str | None):
    if external_post_id:
        row = await fetch_row(
            """
            select source, external_post_id, captured_at, metrics
            from raw_metrics
            where external_post_id = $1
            order by captured_at desc
            limit 1
            """,
            external_post_id,
        )
        if row is None and supabase_rest.configured():
            rows = await supabase_rest.select(
                "raw_metrics",
                {
                    "select": "source,external_post_id,captured_at,metrics",
                    "external_post_id": f"eq.{external_post_id}",
                    "order": "captured_at.desc",
                    "limit": "1",
                },
            )
            row = rows[0] if rows else None
        return row
    row = await fetch_row(
        """
        select source, external_post_id, captured_at, metrics
        from raw_metrics
        order by captured_at desc
        limit 1
        """
    )
    if row is None and supabase_rest.configured():
        rows = await supabase_rest.select(
            "raw_metrics",
            {
                "select": "source,external_post_id,captured_at,metrics",
                "order": "captured_at.desc",
                "limit": "1",
            },
        )
        row = rows[0] if rows else None
    return row


@app.post("/metrics/rollup")
async def rollup_metric_to_outcome(rollup: MetricRollupIn, _: None = Depends(require_access_token)):
    metric = await latest_metric_row(rollup.external_post_id)
    if metric is None:
        raise HTTPException(status_code=404, detail="No matching raw metric found.")
    metrics = metric.get("metrics") or {}
    scored = score_metrics(metrics)
    source_channel = rollup.channel or metric.get("source") or "manual"
    if source_channel not in ["facebook", "instagram", "manual"]:
        source_channel = "manual"
    outcome = OutcomeIn(
        post_id=metric.get("external_post_id"),
        pillar=rollup.pillar,
        funnel_stage=rollup.funnel_stage,
        hook_archetype=rollup.hook_archetype,
        style_key=rollup.style_key,
        format=rollup.format,
        channel=source_channel,
        audience_label=rollup.audience_label,
        published_at=None,
        metric_window=rollup.metric_window,
        score=scored["score"],
        watch_metric=scored["watch_metric"],
        shares=scored["shares"],
        saves=scored["saves"],
        cpl=scored["cpl"],
        vs_plan_note=scored["note"],
    )
    return await create_outcome(outcome)


def outcome_payload(outcome: OutcomeIn, for_rest: bool = False):
    payload = outcome.model_dump()
    if for_rest and outcome.published_at:
        payload["published_at"] = outcome.published_at.isoformat()
    return payload


@app.get("/outcomes")
async def list_outcomes(_: None = Depends(require_access_token)):
    rows = await fetch_rows(
        """
        select id, post_id, pillar, funnel_stage, hook_archetype, style_key,
               format, channel, audience_label, published_at, metric_window,
               score, watch_metric, shares, saves, cpl, vs_plan_note, created_at
        from outcomes
        order by created_at desc
        limit 100
        """
    )
    if not rows:
        rows = await supabase_rest.select(
            "outcomes",
            {
                "select": "id,post_id,pillar,funnel_stage,hook_archetype,style_key,format,channel,audience_label,published_at,metric_window,score,watch_metric,shares,saves,cpl,vs_plan_note,created_at",
                "order": "created_at.desc",
                "limit": "100",
            },
        )
    return {"items": rows}


@app.post("/outcomes")
async def create_outcome(outcome: OutcomeIn, _: None = Depends(require_access_token)):
    payload = outcome_payload(outcome)
    row = await fetch_row(
        """
        insert into outcomes
          (post_id, pillar, funnel_stage, hook_archetype, style_key, format,
           channel, audience_label, published_at, metric_window, score,
           watch_metric, shares, saves, cpl, vs_plan_note)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        returning id, post_id, pillar, funnel_stage, hook_archetype, style_key,
                  format, channel, audience_label, published_at, metric_window,
                  score, watch_metric, shares, saves, cpl, vs_plan_note, created_at
        """,
        payload["post_id"],
        payload["pillar"],
        payload["funnel_stage"],
        payload["hook_archetype"],
        payload["style_key"],
        payload["format"],
        payload["channel"],
        payload["audience_label"],
        payload["published_at"],
        payload["metric_window"],
        payload["score"],
        payload["watch_metric"],
        payload["shares"],
        payload["saves"],
        payload["cpl"],
        payload["vs_plan_note"],
    )
    if row is None:
        row = await supabase_rest.insert("outcomes", outcome_payload(outcome, for_rest=True))
    return {"item": row or payload}


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


@app.get("/learning-weights")
async def list_learning_weights(_: None = Depends(require_access_token)):
    rows = await fetch_rows(
        """
        select id, dimension, key, value, previous_value, reason, source, is_active, created_at
        from learning_weights
        order by created_at desc
        limit 100
        """
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "learning_weights",
            {
                "select": "id,dimension,key,value,previous_value,reason,source,is_active,created_at",
                "order": "created_at.desc",
                "limit": "100",
            },
        )
    return {"items": rows}


@app.post("/learning-weights")
async def create_learning_weight(weight: LearningWeightIn, _: None = Depends(require_access_token)):
    row = await fetch_row(
        """
        insert into learning_weights
          (dimension, key, value, previous_value, reason, source)
        values ($1, $2, $3, $4, $5, $6)
        returning id, dimension, key, value, previous_value, reason, source, is_active, created_at
        """,
        weight.dimension,
        weight.key,
        weight.value,
        weight.previous_value,
        weight.reason,
        weight.source,
    )
    payload = weight.model_dump()
    if row is None:
        row = await supabase_rest.insert("learning_weights", payload)
    return {"item": row or payload}


@app.patch("/learning-weights/{weight_id}/revert")
async def revert_learning_weight(weight_id: str, _: None = Depends(require_access_token)):
    row = await fetch_row(
        """
        update learning_weights
        set value = coalesce(previous_value, value), is_active = false, updated_at = now()
        where id = $1
        returning id, dimension, key, value, previous_value, reason, source, is_active, created_at
        """,
        weight_id,
    )
    if row is None:
        existing_rows = await supabase_rest.select(
            "learning_weights",
            {"select": "value,previous_value", "id": f"eq.{weight_id}", "limit": "1"},
        )
        existing = existing_rows[0] if existing_rows else {}
        reverted_value = existing.get("previous_value") if existing.get("previous_value") is not None else existing.get("value")
        row = await supabase_rest.update(
            "learning_weights",
            {"value": reverted_value, "is_active": False},
            {"id": f"eq.{weight_id}"},
        )
    return {"item": row or {"id": weight_id, "is_active": False}}


@app.get("/learning-summary")
async def learning_summary(_: None = Depends(require_access_token)):
    queue = await fetch_rows(
        "select status, count(*)::int as count from publish_queue group by status"
    )
    feedback = await fetch_rows(
        "select action, count(*)::int as count from feedback group by action"
    )
    recent_briefs = await fetch_rows(
        """
        select topic, format, funnel_stage, language, status, created_at
        from content_briefs
        order by created_at desc
        limit 5
        """
    )
    recent_outcomes = await fetch_rows(
        """
        select post_id, format, channel, metric_window, score, shares, saves, cpl, vs_plan_note, created_at
        from outcomes
        order by created_at desc
        limit 5
        """
    )
    weights = await fetch_rows(
        """
        select id, dimension, key, value, previous_value, reason, source, is_active, created_at
        from learning_weights
        where is_active = true
        order by created_at desc
        limit 5
        """
    )
    if supabase_rest.configured() and not queue:
        queue_rows = await supabase_rest.select("publish_queue", {"select": "status", "limit": "1000"})
        queue_counts = {}
        for row in queue_rows:
            status = row.get("status", "unknown")
            queue_counts[status] = queue_counts.get(status, 0) + 1
        queue = [{"status": status, "count": count} for status, count in queue_counts.items()]
    if supabase_rest.configured() and not feedback:
        feedback_rows = await supabase_rest.select("feedback", {"select": "action", "limit": "1000"})
        feedback_counts = {}
        for row in feedback_rows:
            action = row.get("action", "unknown")
            feedback_counts[action] = feedback_counts.get(action, 0) + 1
        feedback = [{"action": action, "count": count} for action, count in feedback_counts.items()]
    if supabase_rest.configured() and not recent_briefs:
        recent_briefs = await supabase_rest.select(
            "content_briefs",
            {
                "select": "topic,format,funnel_stage,language,status,created_at",
                "order": "created_at.desc",
                "limit": "5",
            },
        )
    if supabase_rest.configured() and not recent_outcomes:
        recent_outcomes = await supabase_rest.select(
            "outcomes",
            {
                "select": "post_id,format,channel,metric_window,score,shares,saves,cpl,vs_plan_note,created_at",
                "order": "created_at.desc",
                "limit": "5",
            },
        )
    if supabase_rest.configured() and not weights:
        weights = await supabase_rest.select(
            "learning_weights",
            {
                "select": "id,dimension,key,value,previous_value,reason,source,is_active,created_at",
                "is_active": "eq.true",
                "order": "created_at.desc",
                "limit": "5",
            },
        )

    queue_total = sum(item.get("count", 0) for item in queue)
    feedback_total = sum(item.get("count", 0) for item in feedback)
    outcome_total = len(recent_outcomes)
    recommendation = (
        "Draft from the weekly plan, then send safe items through review."
        if queue_total == 0
        else "After approved posts publish, record the first 7-day results."
        if outcome_total == 0
        else "Review pending queue items before connecting Meta publishing."
        if feedback_total == 0
        else "Use approval and rejection patterns to refine next week's topics."
    )
    return {
        "queue": queue,
        "feedback": feedback,
        "recent_briefs": recent_briefs,
        "recent_outcomes": recent_outcomes,
        "weights": weights,
        "recommendation": recommendation,
    }


@app.get("/loop-status")
async def loop_status(_: None = Depends(require_access_token)):
    queue = await fetch_rows(
        "select status, count(*)::int as count from publish_queue group by status"
    )
    feedback_count = await fetch_row("select count(*)::int as count from feedback")
    kb_count = await fetch_row("select count(*)::int as count from kb_entries")
    metric_count = await fetch_row("select count(*)::int as count from raw_metrics")
    brief_count = await fetch_row("select count(*)::int as count from content_briefs")
    asset_count = await fetch_row("select count(*)::int as count from assets")
    media_count = await fetch_row("select count(*)::int as count from media_assets")
    outcome_count = await fetch_row("select count(*)::int as count from outcomes")
    weight_count = await fetch_row("select count(*)::int as count from learning_weights where is_active = true")
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
        brief_count = {"count": await supabase_rest.count("content_briefs")}
        asset_count = {"count": await supabase_rest.count("assets")}
        media_count = {"count": await supabase_rest.count("media_assets")}
        outcome_count = {"count": await supabase_rest.count("outcomes")}
        active_weights = await supabase_rest.select("learning_weights", {"select": "id", "is_active": "eq.true", "limit": "1000"})
        weight_count = {"count": len(active_weights)}
    return {
        "stage": "stage_1_thin_core",
        "beats": ["sense", "decide", "create", "review", "publish", "measure", "learn"],
        "queue": queue,
        "feedback_count": (feedback_count or {}).get("count", 0),
        "kb_count": (kb_count or {}).get("count", 0),
        "metric_count": (metric_count or {}).get("count", 0),
        "brief_count": (brief_count or {}).get("count", 0),
        "asset_count": (asset_count or {}).get("count", 0),
        "media_count": (media_count or {}).get("count", 0),
        "outcome_count": (outcome_count or {}).get("count", 0),
        "weight_count": (weight_count or {}).get("count", 0),
    }
