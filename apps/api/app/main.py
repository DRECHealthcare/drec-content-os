from contextlib import asynccontextmanager
import csv
from datetime import datetime, timedelta, timezone
from io import StringIO
import json
import re
from uuid import UUID, uuid4

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .auth import require_access_token
from .config import settings
from .compliance import check_text
from .db import close_db, connect_db, fetch_row, fetch_rows
from .models import (
    AssetIn,
    AssetComplianceIn,
    AssetStatusIn,
    ComplianceCheckIn,
    ContentBriefIn,
    ContentBriefStatusIn,
    CreativeDraftIn,
    FeedbackIn,
    KnowledgeEntryIn,
    LearningWeightIn,
    MediaAssetIn,
    MediaAssetStatusIn,
    MetaDispatchIn,
    MetaMetricsIn,
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

LEARNING_TOPIC_LIBRARY = {
    "reel": "用60秒解释一个常被误会的血糖指标",
    "carousel": "用5页图文拆解一个代谢误区",
    "single": "用一张图讲清楚一个复诊前要观察的数据",
    "story": "用问答形式收集粉丝最想知道的控糖问题",
    "facebook": "适合Facebook长文讨论的控糖观察清单",
    "instagram": "适合Instagram保存分享的血糖教育重点",
    "save_or_consult": "为什么这类内容值得保存并带去问医生",
    "metabolic_education": "把代谢教育讲成50岁以上华人听得懂的生活判断",
    "TOFU": "刚开始担心血糖时，应该先看懂哪三个信号",
    "MOFU": "已经在控糖的人，如何判断方法是否真的适合自己",
    "BOFU": "复诊前如何整理饮食、血糖和腰围记录",
}

FORMAT_ROTATION = ["carousel", "single", "reel", "carousel", "story"]
STAGE_ROTATION = ["TOFU", "TOFU", "MOFU", "MOFU", "BOFU"]
MYT = timezone(timedelta(hours=8))
PUBLISH_SLOT_ROTATION = {
    "facebook": [(9, 30), (20, 30)],
    "instagram": [(12, 30), (21, 0)],
}
META_REQUIRED_PERMISSIONS = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "instagram_basic",
    "instagram_content_publish",
]
META_ENV_REQUIREMENTS = [
    ("META_APP_ID", "meta_app_id", "Meta app ID"),
    ("META_APP_SECRET", "meta_app_secret", "Meta app secret"),
    ("META_PAGE_ID", "meta_page_id", "Facebook Page ID"),
    ("META_IG_USER_ID", "meta_ig_user_id", "Instagram business user ID"),
    ("META_PAGE_ACCESS_TOKEN", "meta_page_access_token", "Page access token"),
]


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


def meta_env_status():
    checks = []
    for env_name, setting_name, label in META_ENV_REQUIREMENTS:
        configured = bool(getattr(settings, setting_name, None))
        checks.append(
            {
                "key": env_name,
                "label": label,
                "configured": configured,
                "status": "ready" if configured else "missing",
            }
        )
    return checks


async def inspect_meta_page_token():
    if not settings.meta_page_access_token:
        return {
            "status": "missing",
            "message": "Page access token is not configured.",
            "permissions": [],
            "missing_permissions": META_REQUIRED_PERMISSIONS,
        }
    url = f"https://graph.facebook.com/{settings.meta_graph_version}/me"
    params = {
        "fields": "id,name,permissions",
        "access_token": settings.meta_page_access_token,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(url, params=params)
        if res.status_code >= 400:
            return {
                "status": "error",
                "message": "Meta token check failed. Reconnect or refresh the Page token.",
                "permissions": [],
                "missing_permissions": META_REQUIRED_PERMISSIONS,
            }
        data = res.json()
    except httpx.HTTPError:
        return {
            "status": "error",
            "message": "Meta token check could not reach Graph API.",
            "permissions": [],
            "missing_permissions": META_REQUIRED_PERMISSIONS,
        }
    granted = []
    for permission in data.get("permissions", {}).get("data", []):
        if permission.get("status") == "granted":
            granted.append(permission.get("permission"))
    missing = [permission for permission in META_REQUIRED_PERMISSIONS if permission not in granted]
    return {
        "status": "ready" if not missing else "needs_review",
        "message": "Meta token is reachable." if not missing else "Meta token is reachable but some permissions are missing.",
        "page_identity": {"id": data.get("id"), "name": data.get("name")},
        "permissions": granted,
        "missing_permissions": missing,
    }


@app.get("/meta/readiness")
async def meta_readiness(_: None = Depends(require_access_token)):
    env_checks = meta_env_status()
    token_check = await inspect_meta_page_token()
    missing_env = [check["key"] for check in env_checks if not check["configured"]]
    page_ready = not missing_env and token_check.get("status") == "ready"
    facebook_status = "ready" if page_ready else "blocked"
    instagram_status = "ready" if page_ready and settings.meta_ig_user_id else "blocked"
    return {
        "graph_version": settings.meta_graph_version,
        "mode": "manual_handoff" if not page_ready else "ready_for_worker_testing",
        "overall_status": "ready_for_worker_testing" if page_ready else "not_connected",
        "env_checks": env_checks,
        "token_check": token_check,
        "required_permissions": META_REQUIRED_PERMISSIONS,
        "channels": [
            {
                "channel": "facebook",
                "status": facebook_status,
                "next_step": "Run worker against compliance-clear scheduled queue items." if page_ready else "Connect Page credentials first.",
            },
            {
                "channel": "instagram",
                "status": instagram_status,
                "next_step": "Enable Instagram two-step container publishing after Facebook is stable." if instagram_status == "ready" else "Connect IG user ID and Page token after Facebook readiness.",
            },
        ],
        "safe_sequence": [
            "Keep manual handoff active until Meta readiness is ready.",
            "Test Facebook Page publishing with one compliance-clear scheduled item.",
            "Add Instagram two-step publishing after Facebook succeeds.",
            "Turn on nightly metrics ingestion only after publish IDs are stored.",
        ],
    }


@app.get("/meta/setup-checklist")
async def meta_setup_checklist(_: None = Depends(require_access_token)):
    readiness = await meta_readiness(None)
    security = security_status_payload()
    missing_env = [check for check in readiness.get("env_checks", []) if not check.get("configured")]
    missing_permissions = readiness.get("token_check", {}).get("missing_permissions", [])
    required_secret_names = [
        "META_APP_ID",
        "META_APP_SECRET",
        "META_PAGE_ID",
        "META_IG_USER_ID",
        "META_PAGE_ACCESS_TOKEN",
        "SUPABASE_SERVICE_ROLE_KEY",
    ]
    setup_commands = [
        f'fly secrets set {name}="<paste-{name.lower().replace("_", "-")}>"'
        for name in required_secret_names
    ]
    setup_commands.extend(
        [
            "fly deploy",
            "DREC_ACCESS_TOKEN=\"<paste-drec-access-token>\" npm run smoke:live",
            "fly secrets set META_ENABLE_PUBLISHING=true META_ENABLE_PUBLISHING_JOB=true",
            "fly secrets set META_ENABLE_METRICS_JOB=true",
        ]
    )
    scheduler_setup = {
        "status": "repository_ready",
        "workflow_file": ".github/workflows/drec-scheduler-dry-run.yml",
        "required_github_secrets": ["DREC_ACCESS_TOKEN"],
        "optional_github_variables": ["DREC_API_BASE_URL"],
        "default_api_base_url": "https://drec-content-os-api.fly.dev",
        "steps": [
            "Open GitHub repository Settings > Secrets and variables > Actions.",
            "Add repository secret DREC_ACCESS_TOKEN with the current DREC app access token.",
            "Optionally add repository variable DREC_API_BASE_URL when the API URL changes.",
            "Run the DREC Scheduler Dry Run workflow manually once before trusting the recurring schedule.",
        ],
        "safety": "The GitHub workflow calls only dry-run endpoints, so it checks publishing and metrics readiness without posting to Meta or mutating live records.",
    }
    return {
        "overall_status": "ready_to_enable" if readiness.get("overall_status") == "ready_for_worker_testing" and security.get("rls_hardening_ready") else "needs_setup",
        "missing_credentials": [item["key"] for item in missing_env],
        "missing_permissions": missing_permissions,
        "required_secrets": required_secret_names,
        "setup_commands": setup_commands,
        "scheduler_setup": scheduler_setup,
        "steps": [
            {
                "label": "Install Supabase service role key on Fly",
                "status": "ready" if security.get("rls_hardening_ready") else "needed",
                "detail": security.get("next_step"),
            },
            {
                "label": "Install Meta app, Page, IG, and Page token secrets",
                "status": "ready" if not missing_env else "needed",
                "detail": "Missing: " + ", ".join(item["key"] for item in missing_env) if missing_env else "All required Meta secrets are configured.",
            },
            {
                "label": "Confirm Meta token permissions",
                "status": "ready" if not missing_permissions and readiness.get("token_check", {}).get("status") == "ready" else "needed",
                "detail": "Missing: " + ", ".join(missing_permissions) if missing_permissions else readiness.get("token_check", {}).get("message", "Check Page token permissions."),
            },
            {
                "label": "Run dry-run checks before live switches",
                "status": "ready",
                "detail": "Use Meta Setup dry-run buttons and live smoke before enabling real publishing or metrics jobs.",
            },
            {
                "label": "Activate GitHub scheduled dry runs",
                "status": scheduler_setup["status"],
                "detail": "Add GitHub Actions secret DREC_ACCESS_TOKEN, then run the dry-run workflow once.",
            },
            {
                "label": "Enable live Meta workers only after green dry runs",
                "status": "locked",
                "detail": "Enable META_ENABLE_PUBLISHING, META_ENABLE_PUBLISHING_JOB, and META_ENABLE_METRICS_JOB after readiness is green.",
            },
        ],
        "notes": [
            "Do not paste secret values into GitHub, Vercel, or the browser UI.",
            "Keep manual handoff active until setup status is ready_to_enable.",
            "Run one Facebook publish first, then Instagram, then nightly metrics.",
        ],
    }


def security_status_payload():
    has_service_role = bool(settings.supabase_service_role_key)
    has_supabase_rest = bool(settings.supabase_url and supabase_rest.api_key())
    fallback_key_mode = bool(settings.supabase_api_key and not settings.supabase_service_role_key)
    rls_ready = has_service_role and has_supabase_rest
    return {
        "overall_status": "ready_for_rls_hardening" if rls_ready else "needs_service_role_key",
        "supabase_rest": "configured" if has_supabase_rest else "missing",
        "service_role_key": "configured" if has_service_role else "missing",
        "fallback_key_mode": fallback_key_mode,
        "direct_browser_supabase": "disabled_by_design",
        "rls_hardening_ready": rls_ready,
        "checks": [
            {
                "label": "Fly API uses Supabase REST",
                "status": "ready" if has_supabase_rest else "missing",
            },
            {
                "label": "Service role key installed on Fly",
                "status": "ready" if has_service_role else "missing",
            },
            {
                "label": "Browser talks only to protected API",
                "status": "ready",
            },
        ],
        "next_step": (
            "Apply strict Supabase RLS policies after live smoke passes with SUPABASE_SERVICE_ROLE_KEY."
            if rls_ready
            else "Add SUPABASE_SERVICE_ROLE_KEY to Fly before tightening Supabase RLS policies."
        ),
    }


@app.get("/security/status")
async def security_status(_: None = Depends(require_access_token)):
    return security_status_payload()


async def automation_status_payload():
    loop = await build_loop_status()
    workflow = build_workflow_guidance(loop)
    meta = await meta_readiness(None)
    security = security_status_payload()
    total_queue = total_queue_count(loop.get("queue"))
    scheduled_queue = sum(
        int(item.get("count") or 0)
        for item in loop.get("queue") or []
        if item.get("status") == "scheduled"
    )
    published_queue = sum(
        int(item.get("count") or 0)
        for item in loop.get("queue") or []
        if item.get("status") == "published"
    )
    ready_assets = queue_ready_asset_count(loop.get("asset_status"))
    gates = [
        {
            "key": "manual_workflow",
            "label": "Manual workflow",
            "status": "ready" if total_queue or ready_assets else "needs_content",
            "detail": "Queue or approved clear assets are available." if total_queue or ready_assets else "Create and approve one asset first.",
        },
        {
            "key": "handoff",
            "label": "Manual publishing handoff",
            "status": "ready" if scheduled_queue else "waiting",
            "detail": f"{scheduled_queue} scheduled item(s) can be checked for handoff." if scheduled_queue else "Schedule a reviewed item before handoff.",
        },
        {
            "key": "learning",
            "label": "Learning loop",
            "status": "ready" if loop.get("outcome_count") else "waiting",
            "detail": f"{loop.get('outcome_count', 0)} outcome(s) recorded." if loop.get("outcome_count") else "Record metrics after publishing.",
        },
        {
            "key": "meta",
            "label": "Meta workers",
            "status": "ready" if meta.get("overall_status") == "ready_for_worker_testing" else "blocked",
            "detail": meta.get("mode", "manual_handoff"),
        },
        {
            "key": "security",
            "label": "Strict Supabase RLS",
            "status": "ready" if security.get("rls_hardening_ready") else "blocked",
            "detail": security.get("next_step"),
        },
    ]
    blocked = [gate for gate in gates if gate["status"] == "blocked"]
    waiting = [gate for gate in gates if gate["status"] in {"waiting", "needs_content"}]
    if blocked:
        overall = "manual_safe_auto_blocked"
    elif waiting:
        overall = "manual_workflow_in_progress"
    else:
        overall = "automation_ready"
    return {
        "overall_status": overall,
        "ready_count": sum(1 for gate in gates if gate["status"] == "ready"),
        "blocked_count": len(blocked),
        "waiting_count": len(waiting),
        "gates": gates,
        "summary": {
            "queue_total": total_queue,
            "scheduled_queue": scheduled_queue,
            "published_queue": published_queue,
            "ready_assets": ready_assets,
            "outcomes": loop.get("outcome_count", 0),
            "next_action": workflow.get("next_action", {}),
        },
        "next_step": blocked[0]["detail"] if blocked else waiting[0]["detail"] if waiting else "Automation gates are ready for controlled rollout.",
    }


@app.get("/automation/status")
async def automation_status(_: None = Depends(require_access_token)):
    return await automation_status_payload()


def audit_item(kind, item_id, severity, title, detail, action, channel="", fmt=""):
    return {
        "kind": kind,
        "id": str(item_id or ""),
        "severity": severity,
        "title": title,
        "detail": detail,
        "action": action,
        "channel": channel or "",
        "format": fmt or "",
    }


def audit_score(items: list[dict]):
    if any(item.get("severity") == "block" for item in items):
        return "blocked"
    if any(item.get("severity") == "warn" for item in items):
        return "needs_review"
    return "clear"


async def content_risk_audit_payload():
    automation = await automation_status_payload()
    assets = await fetch_asset_list(200)
    queue = await fetch_publish_queue_items(200)
    media = await fetch_rows(
        """
        select id, title, source_url, media_type, rights_status, approval_status,
               notes, tags, metadata, created_at
        from media_assets
        order by created_at desc
        limit 200
        """
    )
    if not media and supabase_rest.configured():
        media = await supabase_rest.select(
            "media_assets",
            {
                "select": "id,title,source_url,media_type,rights_status,approval_status,notes,tags,metadata,created_at",
                "order": "created_at.desc",
                "limit": "200",
            },
        )
    items = []
    for gate in automation.get("gates", []):
        if gate.get("status") == "blocked":
            items.append(
                audit_item(
                    "automation_gate",
                    gate.get("key"),
                    "warn",
                    f"{gate.get('label')} is blocked",
                    gate.get("detail") or "Automation gate needs attention.",
                    "Resolve this gate before enabling hands-off automation.",
                )
            )
    for asset in assets:
        compliance = asset.get("compliance_status")
        review = asset.get("review_status")
        if compliance == "flagged":
            items.append(audit_item("asset", asset.get("id"), "block", "Asset is safety flagged", "Flagged captions must not enter the queue.", "Rewrite or reject this asset.", asset.get("channel"), asset.get("format")))
        elif compliance != "clear":
            items.append(audit_item("asset", asset.get("id"), "warn", "Asset safety is not clear", f"Current safety status: {compliance or 'unknown'}.", "Run safety review before approval or queueing.", asset.get("channel"), asset.get("format")))
        if review == "rejected":
            items.append(audit_item("asset", asset.get("id"), "warn", "Asset was rejected", "Rejected assets should not be reused accidentally.", "Archive, rewrite, or leave rejected.", asset.get("channel"), asset.get("format")))
        elif review != "approved":
            items.append(audit_item("asset", asset.get("id"), "warn", "Asset needs human approval", f"Current review status: {review or 'unknown'}.", "Approve only after checking caption, media fit, and safety.", asset.get("channel"), asset.get("format")))
        caption_check = check_text(asset.get("caption") or "")
        if caption_check.get("status") == "flagged":
            items.append(audit_item("asset", asset.get("id"), "block", "Asset caption triggers safety rule", caption_check.get("recommendation"), "Rewrite and re-check safety before queueing.", asset.get("channel"), asset.get("format")))
        elif caption_check.get("status") == "pending" and compliance == "clear":
            items.append(audit_item("asset", asset.get("id"), "warn", "Asset has cautionary safety findings", caption_check.get("recommendation"), "Review the findings before publishing.", asset.get("channel"), asset.get("format")))
    for item in queue:
        status = item.get("status")
        compliance = item.get("compliance_status")
        latest_action = (item.get("latest_feedback") or {}).get("action")
        if compliance == "flagged":
            items.append(audit_item("queue", item.get("id"), "block", "Queue item is safety flagged", "Flagged queue items must not be scheduled or published.", "Rewrite or cancel this queue item.", item.get("channel"), item.get("format")))
        elif compliance != "clear":
            items.append(audit_item("queue", item.get("id"), "warn", "Queue item is not safety clear", f"Current safety status: {compliance or 'unknown'}.", "Run safety check before scheduling.", item.get("channel"), item.get("format")))
        if status == "scheduled" and not item.get("planned_slot"):
            items.append(audit_item("queue", item.get("id"), "block", "Scheduled item has no planned time", "Publishing workers and handoff need a real planned time.", "Set a planned publish time.", item.get("channel"), item.get("format")))
        if status == "draft" and latest_action != "approve":
            items.append(audit_item("queue", item.get("id"), "warn", "Draft queue item is not review-approved", "Draft items need approval feedback before batch scheduling.", "Review and approve, regenerate, or reject.", item.get("channel"), item.get("format")))
        if status == "published" and not item.get("external_post_id"):
            items.append(audit_item("queue", item.get("id"), "warn", "Published item has no Meta post ID", "Metrics ingestion needs an external post ID.", "Record the post ID after manual publishing.", item.get("channel"), item.get("format")))
        caption_check = check_text(item.get("caption") or "")
        if caption_check.get("status") == "flagged":
            items.append(audit_item("queue", item.get("id"), "block", "Queue caption triggers safety rule", caption_check.get("recommendation"), "Rewrite and re-check before scheduling.", item.get("channel"), item.get("format")))
    for item in media:
        rights = item.get("rights_status")
        approval = item.get("approval_status")
        if rights not in {"owned", "licensed", "approved"}:
            items.append(audit_item("media", item.get("id"), "warn", "Media rights need confirmation", f"Rights status: {rights or 'unknown'}.", "Confirm rights before using this media.", fmt=item.get("media_type")))
        if approval == "blocked":
            items.append(audit_item("media", item.get("id"), "block", "Media is blocked", item.get("title") or "Blocked media asset.", "Do not use this media in publishing.", fmt=item.get("media_type")))
        elif approval != "approved":
            items.append(audit_item("media", item.get("id"), "warn", "Media needs approval", item.get("title") or "Media asset needs review.", "Approve or block the media before publishing.", fmt=item.get("media_type")))
    severity_order = {"block": 0, "warn": 1}
    items = sorted(items, key=lambda item: (severity_order.get(item.get("severity"), 2), item.get("kind", ""), item.get("title", "")))
    return {
        "overall_status": audit_score(items),
        "block_count": sum(1 for item in items if item.get("severity") == "block"),
        "warn_count": sum(1 for item in items if item.get("severity") == "warn"),
        "checked": {
            "assets": len(assets),
            "queue": len(queue),
            "media": len(media),
            "automation_gates": len(automation.get("gates", [])),
        },
        "items": items[:100],
        "next_step": "Resolve blocked items first." if any(item.get("severity") == "block" for item in items) else "Review warnings before the next publish." if items else "No content risk items found in the current operating set.",
    }


@app.get("/operations/risk-audit")
async def content_risk_audit(_: None = Depends(require_access_token)):
    return await content_risk_audit_payload()


async def launch_readiness_payload():
    loop = await build_loop_status()
    workflow = build_workflow_guidance(loop)
    automation = await automation_status_payload()
    security = security_status_payload()
    meta = await meta_readiness(None)
    risk = await content_risk_audit_payload()
    automation_gates = {gate.get("key"): gate for gate in automation.get("gates", [])}
    manual_ops_ready = security.get("supabase_rest") == "configured"
    handoff_ready = automation_gates.get("handoff", {}).get("status") == "ready"
    risk_blocks = int(risk.get("block_count") or 0)
    risk_warnings = int(risk.get("warn_count") or 0)
    manual_publish_status = "ready" if handoff_ready and risk_blocks == 0 else "blocked" if risk_blocks else "waiting"
    meta_ready = meta.get("overall_status") == "ready_for_worker_testing"
    rls_ready = bool(security.get("rls_hardening_ready"))
    automation_ready = meta_ready and rls_ready and risk_blocks == 0
    stages = [
        {
            "key": "manual_ops",
            "label": "Manual content workflow",
            "status": "ready" if manual_ops_ready else "blocked",
            "detail": "Plan, draft, review, schedule, handoff, record metrics, and export reports are available." if manual_ops_ready else "Connect Supabase/API before using the workflow.",
        },
        {
            "key": "manual_publish",
            "label": "Manual publishing run",
            "status": manual_publish_status,
            "detail": "Ready scheduled items can be handed off safely." if manual_publish_status == "ready" else risk.get("next_step") if manual_publish_status == "blocked" else "Schedule a reviewed item, then build the handoff.",
        },
        {
            "key": "scheduler_dry_run",
            "label": "Scheduler dry run",
            "status": "ready",
            "detail": "GitHub Actions dry-run workflow is in the repository; set DREC_ACCESS_TOKEN in GitHub Secrets to activate it.",
        },
        {
            "key": "meta_automation",
            "label": "Real Meta automation",
            "status": "ready" if automation_ready else "blocked",
            "detail": "Meta and security gates are ready for controlled rollout." if automation_ready else "Add Meta credentials/permissions and Supabase service-role key before enabling real jobs.",
        },
    ]
    if automation_ready:
        overall = "automation_ready"
    elif manual_ops_ready and risk_blocks == 0:
        overall = "manual_ops_ready_auto_blocked"
    elif manual_ops_ready:
        overall = "manual_ops_ready_needs_review"
    else:
        overall = "setup_needed"
    return {
        "overall_status": overall,
        "manual_use_ready": manual_ops_ready,
        "manual_publish_status": manual_publish_status,
        "automation_ready": automation_ready,
        "next_step": next((stage.get("detail") for stage in stages if stage.get("status") != "ready"), "Manual and automation readiness gates are green."),
        "risk": {
            "overall_status": risk.get("overall_status"),
            "block_count": risk_blocks,
            "warn_count": risk_warnings,
        },
        "summary": {
            "next_action": workflow.get("next_action", {}),
            "queue_total": total_queue_count(loop.get("queue")),
            "ready_assets": queue_ready_asset_count(loop.get("asset_status")),
            "scheduled_queue": automation.get("summary", {}).get("scheduled_queue", 0),
            "published_queue": automation.get("summary", {}).get("published_queue", 0),
        },
        "stages": stages,
        "external_blockers": [
            blocker
            for blocker in [
                "Meta Graph API credentials and permissions" if not meta_ready else None,
                "Supabase service-role key on Fly" if not rls_ready else None,
                "GitHub Actions DREC_ACCESS_TOKEN secret" if not automation_ready else None,
            ]
            if blocker
        ],
    }


@app.get("/operations/launch-readiness")
async def launch_readiness(_: None = Depends(require_access_token)):
    return await launch_readiness_payload()


def test_run_step(key, label, status, detail, screen, action, evidence=None):
    return {
        "key": key,
        "label": label,
        "status": status,
        "detail": detail,
        "screen": screen,
        "action": action,
        "evidence": evidence or {},
    }


async def test_run_checklist_payload():
    loop = await build_loop_status()
    handoff = await publishing_handoff(None)
    workflow = build_workflow_guidance(loop)
    queue_counts = {
        item.get("status", "unknown"): int(item.get("count") or 0)
        for item in loop.get("queue") or []
    }
    brief_count = int(loop.get("brief_count") or 0)
    asset_count = int(loop.get("asset_count") or 0)
    ready_assets = queue_ready_asset_count(loop.get("asset_status"))
    queue_total = total_queue_count(loop.get("queue"))
    draft_queue = queue_counts.get("draft", 0)
    scheduled_queue = queue_counts.get("scheduled", 0)
    published_queue = queue_counts.get("published", 0)
    metric_count = int(loop.get("metric_count") or 0)
    outcome_count = int(loop.get("outcome_count") or 0)
    weight_count = int(loop.get("weight_count") or 0)
    ready_handoff = int(handoff.get("ready_count") or 0)
    steps = [
        test_run_step(
            "briefs",
            "Briefs generated",
            "done" if brief_count else "open",
            f"{brief_count} brief(s) available." if brief_count else "Generate weekly briefs from the Plan screen.",
            "plan",
            "Open Weekly Plan",
            {"brief_count": brief_count},
        ),
        test_run_step(
            "assets",
            "Approved clear asset",
            "done" if ready_assets else "open" if asset_count else "locked",
            f"{ready_assets} approved clear asset(s) ready." if ready_assets else f"{asset_count} asset(s) exist; approve one and mark safety clear." if asset_count else "Save one brief as an asset first.",
            "assets" if asset_count else "plan",
            "Open Assets" if asset_count else "Save Asset",
            {"asset_count": asset_count, "ready_assets": ready_assets},
        ),
        test_run_step(
            "queue",
            "Queue item created",
            "done" if queue_total else "open" if ready_assets else "locked",
            f"{queue_total} queue item(s) exist." if queue_total else "Add one approved clear asset to the queue.",
            "review" if queue_total else "assets",
            "Review Queue" if queue_total else "Queue Ready Asset",
            {"queue_total": queue_total, "draft_queue": draft_queue},
        ),
        test_run_step(
            "schedule",
            "Approved and scheduled",
            "done" if scheduled_queue or ready_handoff or published_queue else "open" if queue_total else "locked",
            f"{scheduled_queue} scheduled item(s) waiting for handoff." if scheduled_queue else "Approve a queue item, then schedule a planned publish time.",
            "scheduler" if queue_total else "review",
            "Open Scheduler",
            {"scheduled_queue": scheduled_queue},
        ),
        test_run_step(
            "handoff",
            "Handoff ready",
            "done" if ready_handoff else "open" if scheduled_queue else "locked",
            f"{ready_handoff} item(s) ready in the publishing handoff." if ready_handoff else "Build handoff after an item is scheduled, clear, and planned.",
            "scheduler",
            "Build Handoff",
            {"ready_handoff": ready_handoff, "blocked_handoff": handoff.get("blocked_count", 0)},
        ),
        test_run_step(
            "published",
            "Published ID recorded",
            "done" if published_queue else "open" if ready_handoff else "locked",
            f"{published_queue} published queue item(s) have been recorded." if published_queue else "After manual posting, record the Meta post ID from the handoff item.",
            "scheduler",
            "Record Published",
            {"published_queue": published_queue},
        ),
        test_run_step(
            "metrics",
            "Metrics saved and rolled up",
            "done" if metric_count and outcome_count else "open" if published_queue else "locked",
            f"{metric_count} metric(s) and {outcome_count} outcome(s) are available." if metric_count or outcome_count else "Save metrics after publishing, then roll them into learning.",
            "outcomes",
            "Save & Roll Up",
            {"metric_count": metric_count, "outcome_count": outcome_count},
        ),
        test_run_step(
            "learning",
            "Learning loop active",
            "done" if outcome_count and weight_count else "open" if outcome_count else "locked",
            f"{outcome_count} outcome(s) and {weight_count} active learning weight(s)." if outcome_count or weight_count else "Build the weekly report and send topics back into the next plan.",
            "learning",
            "Build Weekly Report",
            {"outcome_count": outcome_count, "weight_count": weight_count},
        ),
        test_run_step(
            "meta",
            "Meta remains safely gated",
            "done",
            "Meta publishing stays in dry-run/manual mode until credentials, permissions, and service-role security are ready.",
            "meta",
            "Open Meta Setup",
        ),
    ]
    required_steps = [step for step in steps if step["key"] != "meta"]
    done_count = sum(1 for step in required_steps if step["status"] == "done")
    first_open = next((step for step in required_steps if step["status"] == "open"), None)
    first_locked = next((step for step in required_steps if step["status"] == "locked"), None)
    next_step = first_open or first_locked or steps[-1]
    return {
        "overall_status": "manual_cycle_verified" if done_count == len(required_steps) else "manual_cycle_in_progress",
        "done_count": done_count,
        "total_required": len(required_steps),
        "next_step": next_step,
        "steps": steps,
        "workflow_next_action": workflow.get("next_action", {}),
        "summary": {
            "brief_count": brief_count,
            "ready_assets": ready_assets,
            "queue_total": queue_total,
            "scheduled_queue": scheduled_queue,
            "handoff_ready": ready_handoff,
            "published_queue": published_queue,
            "metric_count": metric_count,
            "outcome_count": outcome_count,
        },
    }


@app.get("/operations/test-run-checklist")
async def operations_test_run_checklist(_: None = Depends(require_access_token)):
    return await test_run_checklist_payload()


def snapshot_row(record_type, item_id="", status="", channel="", fmt="", title="", created_at="", detail=""):
    return {
        "record_type": record_type,
        "id": item_id or "",
        "status": status or "",
        "channel": channel or "",
        "format": fmt or "",
        "title": title or "",
        "created_at": str(created_at or ""),
        "detail": detail or "",
    }


async def snapshot_select(table: str, sql: str, rest_params: dict):
    rows = await fetch_rows(sql)
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(table, rest_params)
    return rows


@app.get("/operations/snapshot.csv")
async def operations_snapshot_csv(_: None = Depends(require_access_token)):
    automation = await automation_status_payload()
    briefs = await snapshot_select(
        "content_briefs",
        """
        select id, topic, channel, format, status, funnel_stage, created_at
        from content_briefs
        order by created_at desc
        limit 200
        """,
        {"select": "id,topic,channel,format,status,funnel_stage,created_at", "order": "created_at.desc", "limit": "200"},
    )
    assets = await snapshot_select(
        "assets",
        """
        select id, channel, format, compliance_status, review_status, caption, created_at
        from assets
        order by created_at desc
        limit 200
        """,
        {"select": "id,channel,format,compliance_status,review_status,caption,created_at", "order": "created_at.desc", "limit": "200"},
    )
    queue = await snapshot_select(
        "publish_queue",
        """
        select id, channel, format, status, compliance_status, planned_slot, external_post_id, caption, created_at
        from publish_queue
        order by created_at desc
        limit 200
        """,
        {"select": "id,channel,format,status,compliance_status,planned_slot,external_post_id,caption,created_at", "order": "created_at.desc", "limit": "200"},
    )
    media = await snapshot_select(
        "media_assets",
        """
        select id, title, media_type, rights_status, approval_status, created_at
        from media_assets
        order by created_at desc
        limit 200
        """,
        {"select": "id,title,media_type,rights_status,approval_status,created_at", "order": "created_at.desc", "limit": "200"},
    )
    outcomes = await snapshot_select(
        "outcomes",
        """
        select id, post_id, channel, format, metric_window, score, saves, shares, created_at
        from outcomes
        order by created_at desc
        limit 200
        """,
        {"select": "id,post_id,channel,format,metric_window,score,saves,shares,created_at", "order": "created_at.desc", "limit": "200"},
    )
    rows = [
        snapshot_row(
            "automation_gate",
            item.get("key"),
            item.get("status"),
            title=item.get("label"),
            detail=item.get("detail"),
        )
        for item in automation.get("gates", [])
    ]
    rows.extend(
        snapshot_row("brief", item.get("id"), item.get("status"), item.get("channel"), item.get("format"), item.get("topic"), item.get("created_at"), item.get("funnel_stage"))
        for item in briefs
    )
    rows.extend(
        snapshot_row("asset", item.get("id"), f"{item.get('review_status')}/{item.get('compliance_status')}", item.get("channel"), item.get("format"), (item.get("caption") or "")[:80], item.get("created_at"))
        for item in assets
    )
    rows.extend(
        snapshot_row("queue", item.get("id"), f"{item.get('status')}/{item.get('compliance_status')}", item.get("channel"), item.get("format"), (item.get("caption") or "")[:80], item.get("created_at"), f"planned={item.get('planned_slot') or ''} external={item.get('external_post_id') or ''}")
        for item in queue
    )
    rows.extend(
        snapshot_row("media", item.get("id"), item.get("approval_status"), item.get("rights_status"), item.get("media_type"), item.get("title"), item.get("created_at"))
        for item in media
    )
    rows.extend(
        snapshot_row("outcome", item.get("id"), f"score={item.get('score')}", item.get("channel"), item.get("format"), item.get("post_id"), item.get("created_at"), f"{item.get('metric_window') or ''} saves={item.get('saves') or 0} shares={item.get('shares') or 0}")
        for item in outcomes
    )
    output = StringIO()
    fieldnames = ["record_type", "id", "status", "channel", "format", "title", "created_at", "detail"]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="drec-content-os-snapshot.csv"'},
    )


def markdown_list(items, empty="- None"):
    clean = [str(item).strip() for item in items or [] if str(item or "").strip()]
    return [f"- {item}" for item in clean] if clean else [empty]


def creative_pack_asset_lines(asset: dict, index: int):
    metadata = asset.get("metadata") or {}
    creative = metadata.get("creative") or {}
    knowledge = creative.get("knowledge_context") or metadata.get("knowledge_context") or {}
    slides = metadata.get("slides") or []
    script = metadata.get("reel_script") or []
    variants = metadata.get("caption_variants") or []
    media_urls = asset.get("media_urls") or []
    lines = [
        f"## Asset {index}: {metadata.get('topic') or asset.get('format') or 'Draft Asset'}",
        "",
        f"- Asset ID: {asset.get('id')}",
        f"- Channel: {asset.get('channel')}",
        f"- Format: {asset.get('format')}",
        f"- Review: {asset.get('review_status')}",
        f"- Safety: {asset.get('compliance_status')}",
        f"- Target signal: {metadata.get('target_signal') or ''}",
        f"- Style key: {metadata.get('style_key') or ''}",
        "",
        "### Primary Caption",
        "",
        asset.get("caption") or "No caption available.",
        "",
    ]
    if variants:
        lines.extend(["### Caption Variants", ""])
        for variant_index, caption in enumerate(variants, start=1):
            lines.extend([f"Variant {variant_index}:", "", caption or "", ""])
    if slides:
        lines.extend(["### Carousel / Story Slides", ""])
        for slide in slides:
            lines.extend(
                [
                    f"{slide.get('slide') or ''}. {slide.get('title') or 'Untitled'}",
                    f"- Body: {slide.get('body') or ''}",
                    f"- Visual note: {slide.get('visual_note') or ''}",
                    "",
                ]
            )
    if script:
        lines.extend(["### Reel Script", ""])
        for beat in script:
            lines.extend([f"- {beat.get('time') or ''} · {beat.get('beat') or ''}: {beat.get('line') or ''}"])
        lines.append("")
    lines.extend(["### Media", "", *markdown_list(media_urls, "- Add approved media before publishing."), ""])
    review_guidance = creative.get("review_guidance") or []
    lines.extend(["### Review Guidance", "", *markdown_list(review_guidance, "- Human review required before publishing."), ""])
    safety_rules = knowledge.get("safety_rules") or []
    style_rules = knowledge.get("style_rules") or []
    medical_terms = knowledge.get("medical_terms") or []
    lines.extend(["### Knowledge Context", ""])
    lines.extend(["Style rules:", *markdown_list(style_rules), ""])
    lines.extend(["Safety rules:", *markdown_list(safety_rules), ""])
    if medical_terms:
        lines.extend(["Medical dictionary:", *markdown_list(medical_terms), ""])
    return lines


@app.get("/operations/creative-pack.md")
async def operations_creative_pack(_: None = Depends(require_access_token)):
    assets = await fetch_asset_list(200)
    active_assets = [asset for asset in assets if asset.get("review_status") != "rejected"]
    knowledge = await active_knowledge_context()
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# DREC Content OS Creative Pack",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this pack for design, carousel assembly, reel scripting, and final human review before scheduling.",
        "",
        "## Production Rules",
        "",
        "- Keep captions and visuals educational; do not turn safety notes into tiny unreadable design text.",
        "- Do not publish rejected assets, flagged safety items, or unapproved media.",
        "- Preserve DREC voice and compliance context unless the asset returns to review.",
        "",
        "## Active Knowledge Context",
        "",
        f"- Entries loaded: {knowledge.get('entry_count', 0)}",
        f"- Categories: {', '.join(f'{key}={value}' for key, value in (knowledge.get('categories') or {}).items()) or 'none'}",
        "",
        "## Assets",
        "",
    ]
    if not active_assets:
        lines.append("No active draft assets found. Generate a weekly plan and save one brief as an asset first.")
    for index, asset in enumerate(active_assets, start=1):
        lines.extend(creative_pack_asset_lines(asset, index))
    return Response(
        "\n".join(lines) + "\n",
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-creative-pack.md"'},
    )


async def fetch_feedback_log(limit: int = 200):
    bounded_limit = max(1, min(int(limit or 200), 500))
    rows = await fetch_rows(
        """
        select id, module, ref_type, ref_id, action, reason, before_text, after_text, tags, created_at
        from feedback
        order by created_at desc
        limit $1
        """,
        bounded_limit,
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "feedback",
            {
                "select": "id,module,ref_type,ref_id,action,reason,before_text,after_text,tags,created_at",
                "order": "created_at.desc",
                "limit": str(bounded_limit),
            },
        )
    return rows


def feedback_excerpt(value: str | None, limit: int = 260):
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


@app.get("/operations/review-log.md")
async def operations_review_log(_: None = Depends(require_access_token)):
    feedback_rows = await fetch_feedback_log()
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    action_counts = {}
    module_counts = {}
    for item in feedback_rows:
        action = item.get("action") or "unknown"
        module = item.get("module") or "unknown"
        action_counts[action] = action_counts.get(action, 0) + 1
        module_counts[module] = module_counts.get(module, 0) + 1
    lines = [
        "# DREC Content OS Review Log",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this audit trail to review human approvals, regeneration requests, rejections, and safety decisions before publishing or enabling automation.",
        "",
        "## Summary",
        "",
        f"- Total feedback records: {len(feedback_rows)}",
        f"- Actions: {', '.join(f'{key}={value}' for key, value in action_counts.items()) or 'none'}",
        f"- Modules: {', '.join(f'{key}={value}' for key, value in module_counts.items()) or 'none'}",
        "",
        "## Recent Decisions",
        "",
    ]
    if not feedback_rows:
        lines.append("No review feedback has been recorded yet.")
    for index, item in enumerate(feedback_rows, start=1):
        lines.extend(
            [
                f"### {index}. {item.get('action', 'unknown')} · {item.get('module', 'unknown')}",
                "",
                f"- Feedback ID: {item.get('id')}",
                f"- Reference: {item.get('ref_type')} / {item.get('ref_id')}",
                f"- Created: {item.get('created_at')}",
                f"- Tags: {', '.join(item.get('tags') or []) or 'none'}",
                f"- Reason: {item.get('reason') or 'No reason recorded.'}",
                "",
            ]
        )
        before = feedback_excerpt(item.get("before_text"))
        after = feedback_excerpt(item.get("after_text"))
        if before:
            lines.extend(["Before:", "", before, ""])
        if after:
            lines.extend(["After:", "", after, ""])
    return Response(
        "\n".join(lines) + "\n",
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-review-log.md"'},
    )


def learning_snapshot_row(record_type, item_id="", dimension="", key="", value="", created_at="", detail=""):
    return {
        "record_type": record_type,
        "id": item_id or "",
        "dimension": dimension or "",
        "key": key or "",
        "value": str(value if value is not None else ""),
        "created_at": str(created_at or ""),
        "detail": detail or "",
    }


@app.get("/operations/learning-snapshot.csv")
async def operations_learning_snapshot(_: None = Depends(require_access_token)):
    raw_metrics = await snapshot_select(
        "raw_metrics",
        """
        select id, source, external_post_id, captured_at, metrics, created_at
        from raw_metrics
        order by captured_at desc
        limit 500
        """,
        {"select": "id,source,external_post_id,captured_at,metrics,created_at", "order": "captured_at.desc", "limit": "500"},
    )
    outcomes = await snapshot_select(
        "outcomes",
        """
        select id, post_id, pillar, funnel_stage, hook_archetype, style_key,
               format, channel, audience_label, published_at, metric_window,
               score, watch_metric, shares, saves, cpl, vs_plan_note, created_at
        from outcomes
        order by created_at desc
        limit 500
        """,
        {"select": "id,post_id,pillar,funnel_stage,hook_archetype,style_key,format,channel,audience_label,published_at,metric_window,score,watch_metric,shares,saves,cpl,vs_plan_note,created_at", "order": "created_at.desc", "limit": "500"},
    )
    weights = await snapshot_select(
        "learning_weights",
        """
        select id, dimension, key, value, previous_value, reason, source, is_active, created_at
        from learning_weights
        order by created_at desc
        limit 500
        """,
        {"select": "id,dimension,key,value,previous_value,reason,source,is_active,created_at", "order": "created_at.desc", "limit": "500"},
    )
    rows = []
    for item in raw_metrics:
        metrics = item.get("metrics") or {}
        metric_bits = []
        if isinstance(metrics, dict):
            for key in ["reach", "likes", "comments", "saves", "shares", "leads", "spend", "plays", "total_interactions"]:
                if key in metrics:
                    metric_bits.append(f"{key}={metrics.get(key)}")
        rows.append(
            learning_snapshot_row(
                "raw_metric",
                item.get("id"),
                item.get("source"),
                item.get("external_post_id"),
                item.get("captured_at"),
                item.get("created_at"),
                "; ".join(metric_bits) or json.dumps(metrics, ensure_ascii=False)[:500],
            )
        )
    for item in outcomes:
        rows.append(
            learning_snapshot_row(
                "outcome",
                item.get("id"),
                item.get("channel"),
                item.get("post_id"),
                item.get("score"),
                item.get("created_at"),
                f"format={item.get('format') or ''}; window={item.get('metric_window') or ''}; saves={item.get('saves') or 0}; shares={item.get('shares') or 0}; note={item.get('vs_plan_note') or ''}",
            )
        )
    for item in weights:
        rows.append(
            learning_snapshot_row(
                "learning_weight",
                item.get("id"),
                item.get("dimension"),
                item.get("key"),
                item.get("value"),
                item.get("created_at"),
                f"active={item.get('is_active')}; previous={item.get('previous_value') or ''}; source={item.get('source') or ''}; reason={item.get('reason') or ''}",
            )
        )
    output = StringIO()
    fieldnames = ["record_type", "id", "dimension", "key", "value", "created_at", "detail"]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="drec-learning-snapshot.csv"'},
    )


def queue_item_blockers(item: dict):
    blockers = []
    if item.get("status") != "scheduled":
        blockers.append("Needs scheduled status.")
    if item.get("compliance_status") != "clear":
        blockers.append("Needs compliance clear.")
    if not item.get("planned_slot"):
        blockers.append("Needs a planned publish time.")
    if not (item.get("caption") or "").strip():
        blockers.append("Needs final caption.")
    return blockers


def run_sheet_item_lines(item: dict, index: int, heading: str):
    media_urls = [url for url in item.get("media_urls") or [] if url]
    blockers = item.get("handoff_blockers") or []
    caption = item.get("caption") or "No caption available."
    lines = [
        f"### {heading} {index}: {item.get('channel') or 'unknown'} / {item.get('format') or 'unknown'}",
        "",
        f"- Queue ID: {item.get('id')}",
        f"- Asset ID: {item.get('asset_id') or 'none'}",
        f"- Status: {item.get('status')}",
        f"- Compliance: {item.get('compliance_status')}",
        f"- Planned time: {item.get('planned_slot') or 'not set'}",
        f"- External post ID: {item.get('external_post_id') or 'not recorded'}",
        "",
        "Caption:",
        "",
        caption,
        "",
        "Media:",
        "",
        *markdown_list(media_urls, "- No media attached."),
        "",
    ]
    if blockers:
        lines.extend(["Blockers:", "", *markdown_list(blockers), ""])
    else:
        lines.extend(
            [
                "Operator steps:",
                "",
                "- Publish at the planned time using the caption and approved media above.",
                "- Keep the caption unchanged unless it returns to review.",
                "- After posting, paste the Meta post ID into Record Published.",
                "- Add 7-day performance results in Performance.",
                "",
            ]
        )
    return lines


@app.get("/operations/publishing-run-sheet.md")
async def operations_publishing_run_sheet(_: None = Depends(require_access_token)):
    rows = await snapshot_select(
        "publish_queue",
        """
        select id, asset_id, channel, format, caption, media_urls, planned_slot, status,
               compliance_status, external_post_id, created_at
        from publish_queue
        order by planned_slot nulls last, created_at desc
        limit 200
        """,
        {
            "select": "id,asset_id,channel,format,caption,media_urls,planned_slot,status,compliance_status,external_post_id,created_at",
            "order": "planned_slot.asc.nullslast,created_at.desc",
            "limit": "200",
        },
    )
    active = []
    blocked = []
    completed = []
    for item in rows:
        enriched = {**item, "handoff_blockers": queue_item_blockers(item)}
        status = item.get("status")
        if status == "published":
            completed.append(enriched)
        elif enriched["handoff_blockers"]:
            blocked.append(enriched)
        else:
            active.append(enriched)

    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    channel_counts = {}
    for item in rows:
        channel = item.get("channel") or "unknown"
        channel_counts[channel] = channel_counts.get(channel, 0) + 1
    lines = [
        "# DREC Content OS Publishing Run Sheet",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this sheet for the human posting shift while Meta automation is not enabled. It is read-only and does not change the queue.",
        "",
        "## Shift Summary",
        "",
        f"- Ready to publish: {len(active)}",
        f"- Blocked / needs work: {len(blocked)}",
        f"- Published / recorded: {len(completed)}",
        f"- Channel mix: {', '.join(f'{key}={value}' for key, value in channel_counts.items()) or 'none'}",
        "",
        "## Posting Rules",
        "",
        "- Only publish items with scheduled status, compliance clear, a planned time, and a final caption.",
        "- Do not use rejected, flagged, or unapproved material.",
        "- Record the Meta post ID immediately after manual posting.",
        "- Enter first performance metrics after the chosen reporting window.",
        "",
        "## Ready To Publish",
        "",
    ]
    if not active:
        lines.append("No ready scheduled items. Approve and schedule content before the next posting shift.")
        lines.append("")
    for index, item in enumerate(active, start=1):
        lines.extend(run_sheet_item_lines(item, index, "Ready Item"))
    lines.extend(["## Blocked Items", ""])
    if not blocked:
        lines.append("No blocked active items found.")
        lines.append("")
    for index, item in enumerate(blocked, start=1):
        lines.extend(run_sheet_item_lines(item, index, "Blocked Item"))
    lines.extend(["## Recently Recorded", ""])
    if not completed:
        lines.append("No published queue items have been recorded yet.")
        lines.append("")
    for index, item in enumerate(completed[:25], start=1):
        lines.extend(run_sheet_item_lines(item, index, "Recorded Item"))
    return Response(
        "\n".join(lines) + "\n",
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-publishing-run-sheet.md"'},
    )


@app.get("/operations/operator-pack.md")
async def operations_operator_pack(_: None = Depends(require_access_token)):
    launch = await launch_readiness_payload()
    test_run = await test_run_checklist_payload()
    workflow = await workflow_status(None)
    automation = await automation_status_payload()
    security = security_status_payload()
    meta = await meta_readiness(None)
    setup = await meta_setup_checklist(None)
    risk = await content_risk_audit_payload()
    handoff = await publishing_handoff(None)
    weekly = await weekly_report(None)
    weekly_text = weekly.body.decode("utf-8") if getattr(weekly, "body", None) else ""
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    gate_lines = [
        f"- {gate.get('label')}: {gate.get('status')} — {gate.get('detail')}"
        for gate in automation.get("gates", [])
    ] or ["- No automation gates available."]
    setup_lines = [
        f"- {step.get('label')}: {step.get('status')} — {step.get('detail')}"
        for step in setup.get("steps", [])
    ] or ["- No setup checks available."]
    scheduler = setup.get("scheduler_setup", {})
    scheduler_lines = [
        f"- Status: {scheduler.get('status', 'unknown')}",
        f"- Workflow: {scheduler.get('workflow_file', 'unknown')}",
        f"- Required GitHub secrets: {', '.join(scheduler.get('required_github_secrets', [])) or 'None'}",
        f"- Optional GitHub variables: {', '.join(scheduler.get('optional_github_variables', [])) or 'None'}",
        f"- Default API URL: {scheduler.get('default_api_base_url', 'unknown')}",
        f"- Safety: {scheduler.get('safety', 'Dry-run checks only.')}",
    ]
    scheduler_step_lines = [f"- {step}" for step in scheduler.get("steps", [])] or ["- No scheduler setup steps available."]
    risk_lines = [
        f"- [{item.get('severity')}] {item.get('kind')} {item.get('id')}: {item.get('title')} — {item.get('action')}"
        for item in risk.get("items", [])[:25]
    ] or ["- No content risk items found."]
    secret_lines = [f"- {secret}" for secret in setup.get("required_secrets", [])] or ["- No required secrets listed."]
    command_lines = ["```bash", *(setup.get("setup_commands") or ["# No setup commands available."]), "```"]
    launch_lines = [
        f"- {stage.get('label')}: {stage.get('status')} — {stage.get('detail')}"
        for stage in launch.get("stages", [])
    ] or ["- No launch readiness stages available."]
    test_run_lines = [
        f"- {step.get('label')}: {step.get('status')} — {step.get('detail')}"
        for step in test_run.get("steps", [])
    ] or ["- No test-run checklist available."]
    lines = [
        "# DREC Content OS Operator Pack",
        "",
        f"Generated: {generated_at}",
        "",
        "## Current Operating Status",
        "",
        f"- Workflow: {workflow.get('workflow', {}).get('next_action', {}).get('title', 'Unknown')}",
        f"- Launch readiness: {launch.get('overall_status')}",
        f"- Automation: {automation.get('overall_status')}",
        f"- Security: {security.get('overall_status')}",
        f"- Meta: {meta.get('overall_status')} ({meta.get('mode')})",
        f"- Content risk: {risk.get('overall_status')} ({risk.get('block_count', 0)} block / {risk.get('warn_count', 0)} warn)",
        f"- Handoff ready: {handoff.get('ready_count', 0)} ready / {handoff.get('blocked_count', 0)} blocked",
        "",
        "## Launch Readiness",
        "",
        *launch_lines,
        "",
        "## Manual Test Run Checklist",
        "",
        f"Status: {test_run.get('overall_status')} ({test_run.get('done_count', 0)}/{test_run.get('total_required', 0)} required steps done)",
        f"Next: {(test_run.get('next_step') or {}).get('label', 'Unknown')} — {(test_run.get('next_step') or {}).get('detail', '')}",
        "",
        *test_run_lines,
        "",
        "## Automation Gates",
        "",
        *gate_lines,
        "",
        "## Credential Setup",
        "",
        *setup_lines,
        "",
        "Required secrets:",
        "",
        *secret_lines,
        "",
        "Command template:",
        "",
        *command_lines,
        "",
        "## GitHub Scheduler Setup",
        "",
        *scheduler_lines,
        "",
        "Steps:",
        "",
        *scheduler_step_lines,
        "",
        "## Content Risk Audit",
        "",
        *risk_lines,
        "",
        "## Publishing Handoff",
        "",
        "```text",
        handoff.get("handoff_text") or "No handoff available.",
        "```",
        "",
        "## Weekly Operating Report",
        "",
        weekly_text.strip() or "No weekly report available.",
        "",
    ]
    return Response(
        "\n".join(lines) + "\n",
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-operator-pack.md"'},
    )


@app.get("/kb")
async def list_knowledge_entries(_: None = Depends(require_access_token)):
    return {"items": await fetch_knowledge_entries()}


async def fetch_knowledge_entries(limit: int = 100):
    bounded_limit = max(1, min(int(limit or 100), 200))
    rows = await fetch_rows(
        """
        select id, category, title, body, tags, created_at
        from kb_entries
        order by created_at desc
        limit $1
        """,
        bounded_limit,
    )
    if not rows:
        rows = await supabase_rest.select(
            "kb_entries",
            {
                "select": "id,category,title,body,tags,created_at",
                "order": "created_at.desc",
                "limit": str(bounded_limit),
            },
        )
    return rows


def summarize_knowledge_item(item: dict, max_body: int = 220):
    body = re.sub(r"\s+", " ", str(item.get("body") or "")).strip()
    if len(body) > max_body:
        body = body[: max_body - 1].rstrip() + "…"
    title = str(item.get("title") or "Untitled").strip()
    return f"{title}: {body}" if body else title


def build_knowledge_context(entries: list[dict]):
    categories = {}
    for item in entries:
        category = str(item.get("category") or "general").strip() or "general"
        categories.setdefault(category, []).append(item)
    category_summaries = {
        category: [summarize_knowledge_item(item) for item in items[:4]]
        for category, items in categories.items()
    }
    voice = category_summaries.get("voice", [])
    brand = category_summaries.get("brand", [])
    compliance = category_summaries.get("compliance", [])
    medical = category_summaries.get("medical_dictionary", [])
    offers = category_summaries.get("offer", [])
    style_rules = []
    if voice:
        style_rules.extend(voice[:2])
    if brand:
        style_rules.extend(brand[:2])
    safety_rules = compliance[:3] or ["Education only. Avoid guaranteed outcomes, diagnosis, or personal medical claims."]
    medical_terms = medical[:4]
    offer_notes = offers[:3]
    return {
        "entry_count": len(entries),
        "categories": {category: len(items) for category, items in categories.items()},
        "category_summaries": category_summaries,
        "style_rules": style_rules,
        "safety_rules": safety_rules,
        "medical_terms": medical_terms,
        "offer_notes": offer_notes,
        "brief_style_hint": " | ".join(style_rules[:3]) if style_rules else "DREC educational, calm, evidence-led, Mandarin-first",
        "brief_compliance_notes": " | ".join(safety_rules[:3]),
        "planning_notes": [
            "Apply voice and brand entries to hooks and structure.",
            "Use compliance entries as non-negotiable safety constraints.",
            "Use medical dictionary entries to keep terminology consistent.",
        ],
    }


async def active_knowledge_context(limit: int = 80):
    return build_knowledge_context(await fetch_knowledge_entries(limit))


@app.get("/kb/context")
async def knowledge_context(_: None = Depends(require_access_token)):
    return await active_knowledge_context()


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


def make_generated_brief(topic: str, index: int, language: str, knowledge_context: dict | None = None) -> ContentBriefIn:
    stage = STAGE_ROTATION[index % len(STAGE_ROTATION)]
    fmt = FORMAT_ROTATION[index % len(FORMAT_ROTATION)]
    hook = f"很多人忽略了：{topic}" if language != "en" else f"One thing people often miss: {topic}"
    kb = knowledge_context or {}
    style_hint = kb.get("brief_style_hint") or "DREC educational, calm, evidence-led, Mandarin-first"
    compliance_notes = kb.get("brief_compliance_notes") or "Education only. Avoid guaranteed outcomes, diagnosis, or personal medical claims."
    medical_terms = kb.get("medical_terms") or []
    body_beats = ["Explain the mechanism simply.", "Give one safe practical observation.", "Invite professional review."]
    if medical_terms:
        body_beats.append(f"Use DREC medical dictionary consistently: {'; '.join(medical_terms[:2])}")
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
            "body": body_beats,
            "close": "Save and discuss with a clinician.",
            "knowledge_context": {
                "entry_count": kb.get("entry_count", 0),
                "style_rules": (kb.get("style_rules") or [])[:3],
                "safety_rules": (kb.get("safety_rules") or [])[:3],
                "medical_terms": medical_terms[:3],
            },
        },
        style_hint=style_hint,
        cta_type="save_or_consult",
        target_signal="saves, comments, qualified consult interest",
        language=language,
        compliance_notes=compliance_notes,
    )


async def recent_learning_context():
    outcomes = await fetch_rows(
        """
        select post_id, format, channel, funnel_stage, pillar, score, saves, shares, cpl, vs_plan_note, created_at
        from outcomes
        order by score desc nulls last, created_at desc
        limit 10
        """
    )
    weights = await fetch_rows(
        """
        select dimension, key, value, reason, source, created_at
        from learning_weights
        where is_active = true
        order by value desc nulls last, created_at desc
        limit 10
        """
    )
    if supabase_rest.configured() and not outcomes:
        outcomes = await supabase_rest.select(
            "outcomes",
            {
                "select": "post_id,format,channel,funnel_stage,pillar,score,saves,shares,cpl,vs_plan_note,created_at",
                "order": "score.desc.nullslast,created_at.desc",
                "limit": "10",
            },
        )
    if supabase_rest.configured() and not weights:
        weights = await supabase_rest.select(
            "learning_weights",
            {
                "select": "dimension,key,value,reason,source,created_at",
                "is_active": "eq.true",
                "order": "value.desc.nullslast,created_at.desc",
                "limit": "10",
            },
        )
    return outcomes, weights


def topic_from_signal(signal: str, language: str):
    topic = LEARNING_TOPIC_LIBRARY.get(signal) or LEARNING_TOPIC_LIBRARY.get(str(signal).lower())
    if topic:
        return topic if language != "en" else f"What recent performance suggests about {signal}"
    return f"围绕「{signal}」做一篇更清楚、更容易保存的控糖教育内容" if language != "en" else f"Create a clearer education post around {signal}"


def topic_from_outcome_note(note: str, language: str):
    lowered = note.lower()
    if "saves" in lowered or "save" in lowered:
        return "复盘高保存内容：为什么这个控糖主题值得做成系列" if language != "en" else "Turn a high-save post into a follow-up series"
    if "shares" in lowered or "share" in lowered:
        return "复盘高分享内容：把这个代谢误区讲得更容易转发" if language != "en" else "Turn a high-share post into a clearer myth-busting follow-up"
    if "lead" in lowered or "consult" in lowered:
        return "复盘有咨询兴趣的内容：下一篇如何更清楚回答复诊前问题" if language != "en" else "Follow up on a consult-interest post with clearer visit-prep education"
    return f"根据最近表现复盘：{note}" if language != "en" else f"Turn this recent result into a lesson: {note}"


async def learning_recommended_topics(language: str = "zh", count: int = 5):
    outcomes, weights = await recent_learning_context()
    topics = []
    reasons = []
    for weight in weights:
        key = str(weight.get("key") or "").strip()
        if not key:
            continue
        topics.append(topic_from_signal(key, language))
        reasons.append(f"Active learning weight: {weight.get('dimension')}={key} ({weight.get('reason') or weight.get('source')}).")
    for outcome in outcomes:
        best_signal = outcome.get("format") or outcome.get("channel") or outcome.get("funnel_stage") or outcome.get("pillar")
        if best_signal:
            topics.append(topic_from_signal(str(best_signal), language))
            reasons.append(f"Recent result signal: {best_signal}, score {outcome.get('score') or 'n/a'}.")
        if outcome.get("vs_plan_note"):
            topics.append(topic_from_outcome_note(str(outcome.get("vs_plan_note")), language))
            reasons.append("Recent performance note suggested a follow-up angle.")
    topics.extend(DEFAULT_PLAN_TOPICS)
    deduped = []
    for topic in topics:
        if topic and topic not in deduped:
            deduped.append(topic)
        if len(deduped) >= count:
            break
    return {
        "topics": deduped,
        "reasons": reasons[: len(deduped)],
        "signals": {
            "outcome_count": len(outcomes),
            "weight_count": len(weights),
        },
    }


def safe_float(value, default: float = 0.0):
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def outcome_group_insights(outcomes: list[dict], dimension: str):
    groups = {}
    for outcome in outcomes:
        key = str(outcome.get(dimension) or "").strip()
        if not key:
            continue
        group = groups.setdefault(
            key,
            {
                "dimension": dimension,
                "key": key,
                "count": 0,
                "score_total": 0.0,
                "saves_total": 0,
                "shares_total": 0,
                "best_post_id": None,
                "best_score": None,
                "note": "",
            },
        )
        score = safe_float(outcome.get("score"))
        saves = int(safe_float(outcome.get("saves")))
        shares = int(safe_float(outcome.get("shares")))
        group["count"] += 1
        group["score_total"] += score
        group["saves_total"] += saves
        group["shares_total"] += shares
        if group["best_score"] is None or score > group["best_score"]:
            group["best_score"] = score
            group["best_post_id"] = outcome.get("post_id")
            group["note"] = outcome.get("vs_plan_note") or ""
    insights = []
    for group in groups.values():
        count = max(group["count"], 1)
        avg_score = round(group["score_total"] / count, 2)
        insight = {
            "dimension": group["dimension"],
            "key": group["key"],
            "count": group["count"],
            "avg_score": avg_score,
            "saves_total": group["saves_total"],
            "shares_total": group["shares_total"],
            "best_post_id": group["best_post_id"],
            "best_score": group["best_score"],
            "note": group["note"],
            "recommendation": f"Repeat or extend {group['key']} if it still fits safety and brand context."
            if avg_score >= 1
            else f"Treat {group['key']} as exploratory until more results confirm it.",
        }
        insights.append(insight)
    return sorted(insights, key=lambda item: (item["avg_score"], item["saves_total"], item["shares_total"], item["count"]), reverse=True)[:5]


async def outcome_insights():
    outcomes = await fetch_rows(
        """
        select post_id, pillar, funnel_stage, format, channel, audience_label,
               score, shares, saves, cpl, vs_plan_note, created_at
        from outcomes
        order by created_at desc
        limit 200
        """
    )
    if supabase_rest.configured() and not outcomes:
        outcomes = await supabase_rest.select(
            "outcomes",
            {
                "select": "post_id,pillar,funnel_stage,format,channel,audience_label,score,shares,saves,cpl,vs_plan_note,created_at",
                "order": "created_at.desc",
                "limit": "200",
            },
        )
    dimensions = ["format", "channel", "pillar", "funnel_stage", "audience_label"]
    by_dimension = {dimension: outcome_group_insights(outcomes, dimension) for dimension in dimensions}
    top_signals = []
    for dimension, items in by_dimension.items():
        if items:
            top = items[0]
            top_signals.append(
                {
                    **top,
                    "label": f"{dimension}: {top['key']}",
                }
            )
    top_signals = sorted(top_signals, key=lambda item: (item["avg_score"], item["saves_total"], item["shares_total"]), reverse=True)
    return {
        "sample_size": len(outcomes),
        "by_dimension": by_dimension,
        "top_signals": top_signals[:6],
        "summary": "No performance outcomes yet. Publish and record metrics to activate insights."
        if not outcomes
        else f"{len(outcomes)} outcome(s) analyzed across format, channel, pillar, funnel stage, and audience.",
    }


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


async def content_brief_by_id(brief_id: str):
    try:
        UUID(str(brief_id))
    except ValueError:
        return None
    row = await fetch_row(
        """
        select id, channel, format, pillar, funnel_stage, awareness_stage, topic,
               hook_primary, hook_alt1, hook_alt2, structure_beats, style_hint,
               cta_type, target_signal, language, compliance_notes, status, created_at
        from content_briefs
        where id = $1
        """,
        brief_id,
    )
    if row is None and supabase_rest.configured():
        rows = await supabase_rest.select(
            "content_briefs",
            {
                "select": "id,channel,format,pillar,funnel_stage,awareness_stage,topic,hook_primary,hook_alt1,hook_alt2,structure_beats,style_hint,cta_type,target_signal,language,compliance_notes,status,created_at",
                "id": f"eq.{brief_id}",
                "limit": "1",
            },
        )
        row = rows[0] if rows else None
    return row


@app.patch("/briefs/{brief_id}")
async def update_content_brief_status(
    brief_id: str,
    update: ContentBriefStatusIn,
    _: None = Depends(require_access_token),
):
    row = await fetch_row(
        """
        update content_briefs
        set status = $2, updated_at = now()
        where id = $1
        returning id, channel, format, pillar, funnel_stage, awareness_stage, topic,
                  hook_primary, hook_alt1, hook_alt2, structure_beats, style_hint,
                  cta_type, target_signal, language, compliance_notes, status, created_at
        """,
        brief_id,
        update.status,
    )
    if row is None and supabase_rest.configured():
        row = await supabase_rest.update(
            "content_briefs",
            {"status": update.status},
            {"id": f"eq.{brief_id}"},
        )
    if row is None:
        raise HTTPException(status_code=404, detail="Content brief not found.")
    return {"item": row}


@app.post("/briefs/archive-drafted")
async def archive_drafted_content_briefs(_: None = Depends(require_access_token)):
    rows = await fetch_rows(
        """
        update content_briefs
        set status = 'archived', updated_at = now()
        where status = 'drafted'
        returning id, topic, status
        """
    )
    if not rows and supabase_rest.configured():
        existing = await supabase_rest.select(
            "content_briefs",
            {
                "select": "id,topic,status",
                "status": "eq.drafted",
                "limit": "1000",
            },
        )
        if existing:
            await supabase_rest.update(
                "content_briefs",
                {"status": "archived"},
                {"status": "eq.drafted"},
            )
            rows = [{**item, "status": "archived"} for item in existing]
    return {"archived": len(rows), "items": rows}


@app.get("/weekly-plan/recommendations")
async def weekly_plan_recommendations(
    language: str = "zh",
    count: int = 5,
    _: None = Depends(require_access_token),
):
    safe_language = language if language in {"zh", "en", "mixed"} else "zh"
    bounded_count = max(1, min(count, 10))
    return await learning_recommended_topics(safe_language, bounded_count)


@app.post("/weekly-plan/generate")
async def generate_weekly_plan(plan: WeeklyPlanIn, _: None = Depends(require_access_token)):
    count = max(1, min(plan.count, 10))
    requested_topics = [topic.strip() for topic in plan.topics if topic.strip()]
    knowledge = await active_knowledge_context()
    if requested_topics:
        topics = requested_topics
        source = "manual"
    else:
        recommendation = await learning_recommended_topics(plan.language, count)
        topics = recommendation["topics"] or DEFAULT_PLAN_TOPICS
        source = "learning"
    generated = []
    for index, topic in enumerate(topics[:count]):
        generated.append(await insert_brief(make_generated_brief(topic, index, plan.language, knowledge)))
    return {"items": generated, "source": source, "knowledge_context": knowledge}


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
    return {"items": await fetch_asset_list()}


async def fetch_asset_list(limit: int = 100):
    bounded_limit = max(1, min(int(limit or 100), 200))
    rows = await fetch_rows(
        """
        select id, brief_id, channel, format, caption, media_urls, metadata,
               compliance_status, review_status, created_at
        from assets
        order by created_at desc
        limit $1
        """,
        bounded_limit,
    )
    if not rows:
        rows = await supabase_rest.select(
            "assets",
            {
                "select": "id,brief_id,channel,format,caption,media_urls,metadata,compliance_status,review_status,created_at",
                "order": "created_at.desc",
                "limit": str(bounded_limit),
            },
        )
    return rows


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


async def asset_by_id(asset_id: str):
    try:
        UUID(str(asset_id))
    except ValueError:
        return None
    row = await fetch_row(
        """
        select id, brief_id, channel, format, caption, media_urls, metadata,
               compliance_status, review_status, created_at
        from assets
        where id = $1
        """,
        asset_id,
    )
    if row is None and supabase_rest.configured():
        rows = await supabase_rest.select(
            "assets",
            {
                "select": "id,brief_id,channel,format,caption,media_urls,metadata,compliance_status,review_status,created_at",
                "id": f"eq.{asset_id}",
                "limit": "1",
            },
        )
        row = rows[0] if rows else None
    return row


async def existing_asset_for_brief(brief_id: str):
    row = await fetch_row(
        """
        select id, brief_id, channel, format, caption, media_urls, metadata,
               compliance_status, review_status, created_at
        from assets
        where brief_id = $1
          and review_status != 'rejected'
        order by created_at desc
        limit 1
        """,
        brief_id,
    )
    if row is None and supabase_rest.configured():
        rows = await supabase_rest.select(
            "assets",
            {
                "select": "id,brief_id,channel,format,caption,media_urls,metadata,compliance_status,review_status,created_at",
                "brief_id": f"eq.{brief_id}",
                "review_status": "neq.rejected",
                "order": "created_at.desc",
                "limit": "1",
            },
        )
        row = rows[0] if rows else None
    return row


@app.patch("/assets/{asset_id}")
async def update_asset_status(
    asset_id: str,
    update: AssetStatusIn,
    _: None = Depends(require_access_token),
):
    existing = await asset_by_id(asset_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Asset not found.")
    row = await fetch_row(
        """
        update assets
        set review_status = $2, updated_at = now()
        where id = $1
        returning id, brief_id, channel, format, caption, media_urls, metadata,
                  compliance_status, review_status, created_at
        """,
        asset_id,
        update.review_status,
    )
    if row is None and supabase_rest.configured():
        row = await supabase_rest.update(
            "assets",
            {"review_status": update.review_status},
            {"id": f"eq.{asset_id}"},
        )
    if update.reason:
        await save_feedback(
            FeedbackIn(
                module="asset_library",
                ref_type="asset",
                ref_id=asset_id,
                action="approve" if update.review_status == "approved" else "reject" if update.review_status == "rejected" else "edit",
                reason=update.reason,
                before_text=existing.get("caption"),
                tags=["asset_review", update.review_status],
            )
        )
    return {"item": row or {**existing, "review_status": update.review_status}}


@app.patch("/assets/{asset_id}/compliance")
async def update_asset_compliance(
    asset_id: str,
    update: AssetComplianceIn,
    _: None = Depends(require_access_token),
):
    existing = await asset_by_id(asset_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Asset not found.")
    row = await fetch_row(
        """
        update assets
        set compliance_status = $2, updated_at = now()
        where id = $1
        returning id, brief_id, channel, format, caption, media_urls, metadata,
                  compliance_status, review_status, created_at
        """,
        asset_id,
        update.compliance_status,
    )
    if row is None and supabase_rest.configured():
        row = await supabase_rest.update(
            "assets",
            {"compliance_status": update.compliance_status},
            {"id": f"eq.{asset_id}"},
        )
    if update.reason:
        await save_feedback(
            FeedbackIn(
                module="asset_compliance",
                ref_type="asset",
                ref_id=asset_id,
                action="approve" if update.compliance_status == "clear" else "reject" if update.compliance_status == "flagged" else "edit",
                reason=update.reason,
                before_text=existing.get("caption"),
                tags=["asset_compliance", update.compliance_status],
            )
        )
    return {"item": row or {**existing, "compliance_status": update.compliance_status}}


async def existing_queue_for_asset(asset_id: str):
    row = await fetch_row(
        """
        select id, asset_id, channel, format, caption, media_urls, planned_slot, status,
               compliance_status, external_post_id, created_at
        from publish_queue
        where asset_id = $1
          and status in ('draft', 'scheduled', 'publishing')
        order by created_at desc
        limit 1
        """,
        asset_id,
    )
    if row is None and supabase_rest.configured():
        rows = await supabase_rest.select(
            "publish_queue",
            {
                "select": "id,asset_id,channel,format,caption,media_urls,planned_slot,status,compliance_status,external_post_id,created_at",
                "asset_id": f"eq.{asset_id}",
                "status": "in.(draft,scheduled,publishing)",
                "order": "created_at.desc",
                "limit": "1",
            },
        )
        row = rows[0] if rows else None
    return row


@app.post("/assets/{asset_id}/queue")
async def queue_asset(asset_id: str, _: None = Depends(require_access_token)):
    asset = await asset_by_id(asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found.")
    if asset.get("review_status") != "approved":
        raise HTTPException(
            status_code=422,
            detail="Only approved assets can be added to the publishing queue.",
        )
    if asset.get("compliance_status") != "clear":
        raise HTTPException(
            status_code=422,
            detail="Only compliance-clear assets can be added to the publishing queue.",
        )
    existing_queue = await existing_queue_for_asset(asset.get("id"))
    if existing_queue is not None:
        return {
            "item": existing_queue,
            "asset": asset,
            "reused": True,
            "message": "Existing queue item reused for this asset.",
        }
    item = PublishQueueIn(
        asset_id=asset.get("id"),
        channel="instagram" if asset.get("channel") == "instagram" else "facebook",
        format=asset.get("format") or "carousel",
        caption=asset.get("caption") or "",
        media_urls=asset.get("media_urls") or [],
        planned_slot=None,
        compliance_status="clear",
    )
    queued = await create_publish_queue_item(item)
    return {"item": queued.get("item"), "asset": asset, "reused": False}


@app.post("/assets/approve-clear")
async def approve_clear_assets(limit: int = 20, _: None = Depends(require_access_token)):
    assets = await fetch_asset_list(limit)
    results = []
    for asset in assets:
        status = "skipped"
        detail = None
        if asset.get("review_status") == "approved":
            status = "already_approved"
        elif asset.get("review_status") == "rejected":
            detail = "Rejected assets are not batch-approved."
        elif asset.get("compliance_status") != "clear":
            detail = "Asset is not compliance-clear."
        else:
            updated = await update_asset_status(
                str(asset.get("id")),
                AssetStatusIn(review_status="approved", reason="Batch approved after clear safety review."),
            )
            asset = updated.get("item") or asset
            status = "approved"
        results.append({
            "asset_id": asset.get("id"),
            "status": status,
            "detail": detail,
        })
    return {
        "processed": len(results),
        "approved": sum(1 for item in results if item.get("status") == "approved"),
        "already_approved": sum(1 for item in results if item.get("status") == "already_approved"),
        "skipped": sum(1 for item in results if item.get("status") == "skipped"),
        "items": results,
    }


@app.post("/assets/queue-ready")
async def queue_ready_assets(limit: int = 20, _: None = Depends(require_access_token)):
    assets = await fetch_asset_list(limit)
    results = []
    for asset in assets:
        if asset.get("review_status") != "approved" or asset.get("compliance_status") != "clear":
            results.append({
                "asset_id": asset.get("id"),
                "status": "skipped",
                "detail": "Asset must be approved and compliance-clear.",
            })
            continue
        result = await queue_asset(str(asset.get("id")))
        results.append({
            "asset_id": asset.get("id"),
            "queue_id": result.get("item", {}).get("id"),
            "status": "reused" if result.get("reused") else "queued",
        })
    return {
        "processed": len(results),
        "queued": sum(1 for item in results if item.get("status") == "queued"),
        "reused": sum(1 for item in results if item.get("status") == "reused"),
        "skipped": sum(1 for item in results if item.get("status") == "skipped"),
        "items": results,
    }


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


@app.patch("/media-assets/{media_id}")
async def update_media_asset_status(
    media_id: str,
    update: MediaAssetStatusIn,
    _: None = Depends(require_access_token),
):
    existing = await media_asset_by_id(media_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Media asset not found.")
    notes = existing.get("notes")
    if update.reason:
        note_line = f"Status note: {update.reason}"
        notes = f"{notes}\n{note_line}" if notes else note_line
    row = await fetch_row(
        """
        update media_assets
        set approval_status = $2, notes = $3, updated_at = now()
        where id = $1
        returning id, title, source_url, media_type, rights_status, approval_status,
                  notes, tags, metadata, created_at
        """,
        media_id,
        update.approval_status,
        notes,
    )
    if row is None and supabase_rest.configured():
        row = await supabase_rest.update(
            "media_assets",
            {"approval_status": update.approval_status, "notes": notes},
            {"id": f"eq.{media_id}"},
        )
    return {"item": row or {**existing, "approval_status": update.approval_status, "notes": notes}}


def safe_storage_name(filename: str):
    clean = re.sub(r"[^A-Za-z0-9._-]+", "-", filename or "upload").strip(".-")
    return clean[:96] or "upload"


def media_type_from_content_type(content_type: str):
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("video/"):
        return "video"
    if content_type == "application/pdf":
        return "document"
    return "other"


async def upload_to_storage(path: str, content_type: str, data: bytes):
    if not supabase_rest.configured():
        raise HTTPException(status_code=500, detail="Supabase storage is not configured.")
    key = supabase_rest.api_key() or ""
    url = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/drec-media/{path}"
    headers = {
        "apikey": key,
        "authorization": f"Bearer {key}",
        "content-type": content_type,
        "x-upsert": "false",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(url, headers=headers, content=data)
        if res.status_code == 409:
            raise HTTPException(status_code=409, detail="A storage object already exists at this path.")
        res.raise_for_status()
        return res.json() if res.content else {"path": path}


@app.post("/media-assets/upload")
async def upload_media_asset(
    file: UploadFile = File(...),
    title: str | None = Form(None),
    rights_status: str = Form("owned"),
    approval_status: str = Form("needs_review"),
    notes: str | None = Form(None),
    tags: str | None = Form(None),
    _: None = Depends(require_access_token),
):
    allowed_rights = {"owned", "licensed", "patient_consented", "stock", "unknown"}
    allowed_status = {"approved", "needs_review", "blocked"}
    if rights_status not in allowed_rights:
        raise HTTPException(status_code=422, detail="Invalid rights status.")
    if approval_status not in allowed_status:
        raise HTTPException(status_code=422, detail="Invalid approval status.")
    content_type = file.content_type or "application/octet-stream"
    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail="Upload file is empty.")
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Upload file is larger than 50 MB.")
    media_type = media_type_from_content_type(content_type)
    today = datetime.utcnow().strftime("%Y/%m/%d")
    object_name = f"{today}/{uuid4().hex}-{safe_storage_name(file.filename or 'upload')}"
    await upload_to_storage(object_name, content_type, content)
    media = MediaAssetIn(
        title=title or safe_storage_name(file.filename or "Uploaded media"),
        source_url=f"supabase://drec-media/{object_name}",
        media_type=media_type,
        rights_status=rights_status,
        approval_status=approval_status,
        notes=notes,
        tags=[tag.strip() for tag in (tags or "").split(",") if tag.strip()],
        metadata={
            "storage_bucket": "drec-media",
            "storage_path": object_name,
            "content_type": content_type,
            "size_bytes": len(content),
            "original_filename": file.filename,
        },
    )
    return await create_media_asset(media)


async def media_asset_by_id(media_id: str):
    row = await fetch_row(
        """
        select id, title, source_url, media_type, rights_status, approval_status,
               notes, tags, metadata, created_at
        from media_assets
        where id = $1
        """,
        media_id,
    )
    if row is None and supabase_rest.configured():
        rows = await supabase_rest.select(
            "media_assets",
            {
                "select": "id,title,source_url,media_type,rights_status,approval_status,notes,tags,metadata,created_at",
                "id": f"eq.{media_id}",
                "limit": "1",
            },
        )
        row = rows[0] if rows else None
    return row


async def create_signed_storage_url(path: str, expires_in: int = 3600):
    key = supabase_rest.api_key() or ""
    url = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/sign/drec-media/{path}"
    headers = {
        "apikey": key,
        "authorization": f"Bearer {key}",
        "content-type": "application/json",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(url, headers=headers, json={"expiresIn": expires_in})
        res.raise_for_status()
        data = res.json()
    signed = data.get("signedURL") or data.get("signedUrl") or data.get("signed_url")
    if signed and signed.startswith("/"):
        signed = f"{settings.supabase_url.rstrip('/')}/storage/v1{signed}"
    return signed


@app.post("/media-assets/{media_id}/signed-url")
async def signed_media_asset_url(media_id: str, _: None = Depends(require_access_token)):
    row = await media_asset_by_id(media_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Media asset not found.")
    metadata = row.get("metadata") or {}
    path = metadata.get("storage_path")
    if not path:
        return {"url": row.get("source_url"), "expires_in": None}
    signed_url = await create_signed_storage_url(path)
    return {"url": signed_url, "expires_in": 3600}


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
    knowledge = await active_knowledge_context()
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
            "knowledge_context": knowledge,
            "review_guidance": [
                "Check caption against active DREC voice, compliance, and medical dictionary entries.",
                "If a KB entry conflicts with generated copy, edit or reject before scheduling.",
                "Keep Meta publishing in dry-run/manual mode until credential gates are green.",
            ],
        },
    }
    return {"item": package}


def draft_points_from_brief(brief: dict):
    points = [
        brief.get("hook_primary"),
        brief.get("hook_alt1"),
        brief.get("hook_alt2"),
        brief.get("target_signal"),
        brief.get("compliance_notes"),
    ]
    return [str(point) for point in points if point]


@app.post("/briefs/{brief_id}/draft-asset")
async def create_asset_from_brief(brief_id: str, _: None = Depends(require_access_token)):
    brief = await content_brief_by_id(brief_id)
    if brief is None:
        raise HTTPException(status_code=404, detail="Content brief not found.")
    existing_asset = await existing_asset_for_brief(brief_id)
    if existing_asset is not None:
        await update_content_brief_status(brief_id, ContentBriefStatusIn(status="drafted"))
        return {
            "item": existing_asset,
            "brief": {**brief, "status": "drafted"},
            "reused": True,
            "message": "Existing draft asset reused for this brief.",
        }
    draft = CreativeDraftIn(
        channel="facebook",
        format=brief.get("format") or "carousel",
        stage=brief.get("funnel_stage") or "TOFU",
        language=brief.get("language") or "zh",
        topic=brief.get("topic") or "DREC education",
        points=draft_points_from_brief(brief),
        style_key=brief.get("style_hint") or "edu_carousel_navy",
        target_signal=brief.get("target_signal"),
    )
    creative = (await create_creative_draft(draft)).get("item", {})
    compliance = creative.get("compliance") or check_text(creative.get("primary_caption") or "")
    if compliance.get("status") == "flagged":
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Compliance check blocked this draft asset.",
                "compliance": compliance,
            },
        )
    asset = AssetIn(
        brief_id=brief_id,
        channel="facebook",
        format=draft.format,
        caption=creative.get("primary_caption"),
        media_urls=[],
        metadata={
            "topic": brief.get("topic"),
            "stage": draft.stage,
            "source": "brief_draft_asset",
            "caption_variants": creative.get("caption_variants") or [],
            "slides": creative.get("slides") or [],
            "reel_script": creative.get("reel_script") or [],
            "creative": creative.get("metadata") or {},
            "target_signal": creative.get("target_signal"),
            "style_key": creative.get("style_key"),
        },
        compliance_status="clear" if compliance.get("status") == "clear" else "pending",
        review_status="draft",
    )
    saved = await create_asset(asset)
    await update_content_brief_status(brief_id, ContentBriefStatusIn(status="drafted"))
    return {"item": saved.get("item"), "brief": {**brief, "status": "drafted"}, "creative": creative, "reused": False}


async def recent_assetable_briefs(limit: int):
    bounded_limit = max(1, min(int(limit or 5), 20))
    rows = await fetch_rows(
        """
        select id, channel, format, pillar, funnel_stage, awareness_stage, topic,
               hook_primary, hook_alt1, hook_alt2, structure_beats, style_hint,
               cta_type, target_signal, language, compliance_notes, status, created_at
        from content_briefs
        where status != 'archived'
        order by created_at desc
        limit $1
        """,
        bounded_limit,
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "content_briefs",
            {
                "select": "id,channel,format,pillar,funnel_stage,awareness_stage,topic,hook_primary,hook_alt1,hook_alt2,structure_beats,style_hint,cta_type,target_signal,language,compliance_notes,status,created_at",
                "status": "neq.archived",
                "order": "created_at.desc",
                "limit": str(bounded_limit),
            },
        )
    return rows


@app.post("/briefs/draft-assets")
async def create_assets_from_recent_briefs(limit: int = 5, _: None = Depends(require_access_token)):
    briefs = await recent_assetable_briefs(limit)
    results = []
    for brief in briefs:
        brief_id = str(brief.get("id"))
        try:
            result = await create_asset_from_brief(brief_id)
            results.append({
                "brief_id": brief_id,
                "topic": brief.get("topic"),
                "asset_id": result.get("item", {}).get("id"),
                "reused": bool(result.get("reused")),
                "status": "reused" if result.get("reused") else "created",
            })
        except HTTPException as error:
            results.append({
                "brief_id": brief_id,
                "topic": brief.get("topic"),
                "status": "skipped",
                "detail": error.detail,
            })
    return {
        "processed": len(results),
        "created": sum(1 for item in results if item.get("status") == "created"),
        "reused": sum(1 for item in results if item.get("status") == "reused"),
        "skipped": sum(1 for item in results if item.get("status") == "skipped"),
        "items": results,
    }


@app.get("/publish-queue")
async def list_publish_queue(_: None = Depends(require_access_token)):
    return {"items": await fetch_publish_queue_items()}


async def fetch_publish_queue_items(limit: int = 100):
    bounded_limit = max(1, min(int(limit or 100), 200))
    rows = await fetch_rows(
        """
        select id, asset_id, channel, format, caption, media_urls, planned_slot, status,
               compliance_status, external_post_id, created_at
        from publish_queue
        order by planned_slot nulls last, created_at desc
        limit $1
        """,
        bounded_limit,
    )
    if not rows:
        rows = await supabase_rest.select(
            "publish_queue",
            {
                "select": "id,asset_id,channel,format,caption,media_urls,planned_slot,status,compliance_status,external_post_id,created_at",
                "order": "planned_slot.asc.nullslast,created_at.desc",
                "limit": str(bounded_limit),
            },
        )
    rows = await attach_latest_feedback(rows)
    return rows


async def attach_latest_feedback(rows: list[dict]):
    ids = [str(row.get("id")) for row in rows if row.get("id")]
    if not ids:
        return rows
    feedback_rows = await fetch_rows(
        """
        select ref_id, action, reason, tags, created_at
        from feedback
        where ref_type = 'publish_queue'
          and ref_id = any($1::text[])
        order by created_at desc
        """,
        ids,
    )
    if not feedback_rows and supabase_rest.configured():
        feedback_rows = await supabase_rest.select(
            "feedback",
            {
                "select": "ref_id,action,reason,tags,created_at",
                "ref_type": "eq.publish_queue",
                "ref_id": f"in.({','.join(ids)})",
                "order": "created_at.desc",
                "limit": "500",
            },
        )
    latest_by_ref = {}
    for feedback in feedback_rows:
        ref_id = str(feedback.get("ref_id"))
        if ref_id not in latest_by_ref:
            latest_by_ref[ref_id] = feedback
    for row in rows:
        row["latest_feedback"] = latest_by_ref.get(str(row.get("id")))
    return rows


def parse_datetime(value):
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def ics_escape(value):
    return (
        str(value or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def ics_timestamp(value):
    date = parse_datetime(value)
    if not date:
        return None
    if date.tzinfo:
        date = date.astimezone(timezone.utc)
    else:
        date = date.replace(tzinfo=timezone.utc)
    return date.strftime("%Y%m%dT%H%M%SZ")


async def planned_queue_slots():
    rows = await fetch_rows(
        """
        select id, channel, planned_slot
        from publish_queue
        where planned_slot is not null
          and status in ('draft', 'scheduled', 'publishing')
        order by planned_slot asc
        limit 300
        """
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "publish_queue",
            {
                "select": "id,channel,planned_slot",
                "planned_slot": "not.is.null",
                "status": "in.(draft,scheduled,publishing)",
                "order": "planned_slot.asc",
                "limit": "300",
            },
        )
    return rows


def slot_is_open(candidate: datetime, planned_rows: list[dict], ignore_item_id: str | None = None):
    for row in planned_rows:
        if ignore_item_id and str(row.get("id")) == ignore_item_id:
            continue
        planned = parse_datetime(row.get("planned_slot"))
        if not planned:
            continue
        planned_local = planned.astimezone(MYT) if planned.tzinfo else planned.replace(tzinfo=MYT)
        if abs((planned_local - candidate).total_seconds()) < 90 * 60:
            return False
    return True


async def suggest_publish_slot(channel: str = "facebook", ignore_item_id: str | None = None):
    now = datetime.now(MYT)
    planned_rows = await planned_queue_slots()
    slot_times = PUBLISH_SLOT_ROTATION.get(channel, PUBLISH_SLOT_ROTATION["facebook"])
    for day_offset in range(0, 21):
        day = now.date() + timedelta(days=day_offset)
        if day.weekday() == 6:
            continue
        for hour, minute in slot_times:
            candidate = datetime(day.year, day.month, day.day, hour, minute, tzinfo=MYT)
            if candidate <= now + timedelta(minutes=30):
                continue
            if slot_is_open(candidate, planned_rows, ignore_item_id=ignore_item_id):
                return {
                    "channel": channel,
                    "suggested_slot": candidate.astimezone(timezone.utc).isoformat(),
                    "local_slot": candidate.isoformat(),
                    "timezone": "Asia/Kuala_Lumpur",
                    "reason": "Next open DREC publishing slot, avoiding Sundays and nearby scheduled items.",
                }
    fallback = (now + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
    return {
        "channel": channel,
        "suggested_slot": fallback.astimezone(timezone.utc).isoformat(),
        "local_slot": fallback.isoformat(),
        "timezone": "Asia/Kuala_Lumpur",
        "reason": "Fallback slot after the standard 21-day window was full.",
    }


@app.get("/publish-queue/suggest-slot")
async def publish_queue_suggest_slot(
    channel: str = "facebook",
    item_id: str | None = None,
    _: None = Depends(require_access_token),
):
    clean_channel = channel if channel in PUBLISH_SLOT_ROTATION else "facebook"
    return await suggest_publish_slot(clean_channel, ignore_item_id=item_id)


@app.get("/publish-queue/calendar.ics")
async def publish_queue_calendar(_: None = Depends(require_access_token)):
    rows = await fetch_rows(
        """
        select id, channel, format, caption, media_urls, planned_slot, status, compliance_status
        from publish_queue
        where status = 'scheduled'
          and planned_slot is not null
        order by planned_slot asc
        limit 200
        """
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "publish_queue",
            {
                "select": "id,channel,format,caption,media_urls,planned_slot,status,compliance_status",
                "status": "eq.scheduled",
                "planned_slot": "not.is.null",
                "order": "planned_slot.asc",
                "limit": "200",
            },
        )
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//DREC//Content OS//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:DREC Content OS Publishing Queue",
    ]
    now_stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    for item in rows:
        start = ics_timestamp(item.get("planned_slot"))
        if not start:
            continue
        media_urls = item.get("media_urls") or []
        description_parts = [
            f"Queue ID: {item.get('id')}",
            f"Compliance: {item.get('compliance_status')}",
            "",
            "Caption:",
            item.get("caption") or "",
        ]
        if media_urls:
            description_parts.extend(["", "Media:", *media_urls])
        summary = f"DREC {item.get('channel')} {item.get('format')} publish"
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{item.get('id')}@drec-content-os",
                f"DTSTAMP:{now_stamp}",
                f"DTSTART:{start}",
                f"DURATION:PT30M",
                f"SUMMARY:{ics_escape(summary)}",
                f"DESCRIPTION:{ics_escape(chr(10).join(description_parts))}",
                "END:VEVENT",
            ]
        )
    lines.append("END:VCALENDAR")
    return Response(
        "\r\n".join(lines) + "\r\n",
        media_type="text/calendar",
        headers={"Content-Disposition": 'attachment; filename="drec-publishing-calendar.ics"'},
    )


@app.get("/publish-queue/schedule.csv")
async def publish_queue_schedule_csv(_: None = Depends(require_access_token)):
    rows = await snapshot_select(
        "publish_queue",
        """
        select id, asset_id, channel, format, caption, media_urls, planned_slot, status,
               compliance_status, external_post_id, created_at
        from publish_queue
        order by planned_slot nulls last, created_at desc
        limit 500
        """,
        {
            "select": "id,asset_id,channel,format,caption,media_urls,planned_slot,status,compliance_status,external_post_id,created_at",
            "order": "planned_slot.asc.nullslast,created_at.desc",
            "limit": "500",
        },
    )
    output = StringIO()
    fieldnames = [
        "queue_id",
        "asset_id",
        "status",
        "channel",
        "format",
        "planned_slot",
        "compliance_status",
        "external_post_id",
        "handoff_ready",
        "blockers",
        "media_urls",
        "caption",
        "created_at",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for item in rows:
        blockers = queue_item_blockers(item)
        writer.writerow(
            {
                "queue_id": item.get("id") or "",
                "asset_id": item.get("asset_id") or "",
                "status": item.get("status") or "",
                "channel": item.get("channel") or "",
                "format": item.get("format") or "",
                "planned_slot": item.get("planned_slot") or "",
                "compliance_status": item.get("compliance_status") or "",
                "external_post_id": item.get("external_post_id") or "",
                "handoff_ready": "yes" if not blockers else "no",
                "blockers": "; ".join(blockers),
                "media_urls": "\n".join([url for url in item.get("media_urls") or [] if url]),
                "caption": item.get("caption") or "",
                "created_at": item.get("created_at") or "",
            }
        )
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="drec-publishing-schedule.csv"'},
    )


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


@app.post("/publish-queue/{item_id}/schedule-next")
async def schedule_publish_queue_next_slot(item_id: str, _: None = Depends(require_access_token)):
    existing = await fetch_row(
        """
        select id, asset_id, channel, format, caption, media_urls, planned_slot, status,
               compliance_status, external_post_id, created_at
        from publish_queue
        where id = $1
        """,
        item_id,
    )
    if existing is None and supabase_rest.configured():
        rows = await supabase_rest.select(
            "publish_queue",
            {
                "select": "id,asset_id,channel,format,caption,media_urls,planned_slot,status,compliance_status,external_post_id,created_at",
                "id": f"eq.{item_id}",
                "limit": "1",
            },
        )
        existing = rows[0] if rows else None
    if existing is None:
        raise HTTPException(status_code=404, detail="Queue item not found.")
    if existing.get("status") == "published":
        raise HTTPException(status_code=422, detail="Published items cannot be rescheduled.")
    if existing.get("compliance_status") != "clear":
        raise HTTPException(status_code=422, detail="Only compliance-clear items can be scheduled.")

    suggestion = await suggest_publish_slot(existing.get("channel") or "facebook", ignore_item_id=item_id)
    planned_slot = parse_datetime(suggestion.get("suggested_slot"))
    row = await fetch_row(
        """
        update publish_queue
        set status = 'scheduled',
            planned_slot = $2,
            updated_at = now()
        where id = $1
        returning id, asset_id, channel, format, caption, media_urls, planned_slot, status,
                  compliance_status, external_post_id, created_at
        """,
        item_id,
        planned_slot,
    )
    if row is None:
        row = await supabase_rest.update(
            "publish_queue",
            {
                "status": "scheduled",
                "planned_slot": planned_slot.isoformat() if planned_slot else suggestion.get("suggested_slot"),
            },
            {"id": f"eq.{item_id}"},
        )
    return {"item": row or {**existing, "status": "scheduled", "planned_slot": suggestion.get("suggested_slot")}, "suggestion": suggestion}


@app.post("/publish-queue/schedule-approved")
async def schedule_review_approved_queue(limit: int = 20, _: None = Depends(require_access_token)):
    items = await fetch_publish_queue_items(limit)
    results = []
    for item in items:
        latest_feedback = item.get("latest_feedback") or {}
        if item.get("status") == "scheduled" and item.get("planned_slot"):
            results.append({
                "item_id": item.get("id"),
                "status": "already_scheduled",
                "planned_slot": item.get("planned_slot"),
            })
            continue
        if item.get("status") != "draft" or item.get("compliance_status") != "clear" or latest_feedback.get("action") != "approve":
            results.append({
                "item_id": item.get("id"),
                "status": "skipped",
                "detail": "Item must be draft, compliance-clear, and review-approved.",
            })
            continue
        scheduled = await schedule_publish_queue_next_slot(str(item.get("id")))
        results.append({
            "item_id": item.get("id"),
            "status": "scheduled",
            "planned_slot": scheduled.get("item", {}).get("planned_slot"),
            "suggestion": scheduled.get("suggestion"),
        })
    return {
        "processed": len(results),
        "scheduled": sum(1 for item in results if item.get("status") == "scheduled"),
        "already_scheduled": sum(1 for item in results if item.get("status") == "already_scheduled"),
        "skipped": sum(1 for item in results if item.get("status") == "skipped"),
        "items": results,
    }


@app.patch("/publish-queue/{item_id}")
async def update_publish_queue_item(
    item_id: str,
    update: PublishQueueStatusIn,
    _: None = Depends(require_access_token),
):
    existing = await fetch_row(
        """
        select status, compliance_status
        from publish_queue
        where id = $1
        """,
        item_id,
    )
    if existing is None and supabase_rest.configured():
        rows = await supabase_rest.select(
            "publish_queue",
            {"select": "status,compliance_status", "id": f"eq.{item_id}", "limit": "1"},
        )
        existing = rows[0] if rows else None
    if existing is None:
        raise HTTPException(status_code=404, detail="Queue item not found.")
    compliance_status = update.compliance_status
    if update.caption is not None:
        compliance = check_text(update.caption)
        if compliance["status"] == "flagged":
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Compliance check blocked this caption.",
                    "compliance": compliance,
                },
            )
        compliance_status = "pending" if compliance["status"] == "pending" else (compliance_status or "clear")
    if update.status == "scheduled":
        final_compliance = compliance_status or (existing or {}).get("compliance_status")
        if final_compliance != "clear":
            raise HTTPException(
                status_code=422,
                detail="Only compliance-clear items can be scheduled.",
            )
    external_post_id = update.external_post_id.strip() if update.external_post_id else None
    if update.status == "published" and not external_post_id:
        raise HTTPException(
            status_code=422,
            detail="Published items need a Meta post ID.",
        )
    row = await fetch_row(
        """
        update publish_queue
        set status = coalesce($2, status),
            external_post_id = coalesce($3, external_post_id),
            channel = coalesce($4, channel),
            format = coalesce($5, format),
            caption = coalesce($6, caption),
            media_urls = coalesce($7::text[], media_urls),
            planned_slot = case when $8 then $9 else planned_slot end,
            compliance_status = coalesce($10, compliance_status),
            updated_at = now()
        where id = $1
        returning id, asset_id, channel, format, caption, media_urls, planned_slot, status,
                  compliance_status, external_post_id, created_at
        """,
        item_id,
        update.status,
        external_post_id,
        update.channel,
        update.format,
        update.caption,
        update.media_urls,
        update.planned_slot_changed,
        update.planned_slot,
        compliance_status,
    )
    if row is None:
        payload = {}
        if update.status is not None:
            payload["status"] = update.status
        if external_post_id:
            payload["external_post_id"] = external_post_id
        if update.channel is not None:
            payload["channel"] = update.channel
        if update.format is not None:
            payload["format"] = update.format
        if update.caption is not None:
            payload["caption"] = update.caption
        if update.media_urls is not None:
            payload["media_urls"] = update.media_urls
        if update.planned_slot_changed:
            payload["planned_slot"] = update.planned_slot.isoformat() if update.planned_slot else None
        if compliance_status is not None:
            payload["compliance_status"] = compliance_status
        row = await supabase_rest.update(
            "publish_queue",
            payload,
            {"id": f"eq.{item_id}"},
        )
    return {"item": row or {"id": item_id, **payload}}


@app.get("/publishing-handoff")
async def publishing_handoff(_: None = Depends(require_access_token)):
    rows = await fetch_rows(
        """
        select id, asset_id, channel, format, caption, media_urls, planned_slot, status,
               compliance_status, external_post_id, created_at
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
                "select": "id,asset_id,channel,format,caption,media_urls,planned_slot,status,compliance_status,external_post_id,created_at",
                "status": "in.(draft,scheduled)",
                "order": "planned_slot.asc.nullslast,created_at.desc",
                "limit": "50",
            },
        )

    def handoff_blockers(item: dict):
        blockers = []
        if item.get("status") != "scheduled":
            blockers.append("Needs scheduling approval and scheduled status.")
        if item.get("compliance_status") != "clear":
            blockers.append("Needs compliance clear.")
        if not item.get("planned_slot"):
            blockers.append("Needs a planned publish time.")
        return blockers

    ready = []
    blocked = []
    for item in rows:
        blockers = handoff_blockers(item)
        enriched = {**item, "handoff_blockers": blockers}
        if not blockers:
            ready.append(enriched)
        else:
            blocked.append(enriched)
    checklist = [
        "Publish only items marked scheduled, compliance-clear, and carrying a planned time.",
        "Keep the caption unchanged unless it goes back through review.",
        "After posting, record the post ID and first 7-day result in Performance.",
    ]
    lines = [
        "DREC Content OS Publishing Handoff",
        "",
        "Checklist:",
        *[f"- {item}" for item in checklist],
        "",
        f"Ready to publish: {len(ready)}",
        f"Needs review: {len(blocked)}",
    ]
    for index, item in enumerate(ready, start=1):
        media_urls = [url for url in item.get("media_urls") or [] if url]
        lines.extend(
            [
                "",
                f"Ready Item {index}",
                f"Channel: {item.get('channel')}",
                f"Format: {item.get('format')}",
                f"Planned time: {item.get('planned_slot') or 'Not set'}",
                f"Queue ID: {item.get('id')}",
                "Caption:",
                item.get("caption") or "",
            ]
        )
        if media_urls:
            lines.append("Media:")
            lines.extend([f"- {url}" for url in media_urls])
        lines.append("After publishing: paste the Meta post ID back into the handoff with Record Published.")
    if blocked:
        lines.extend(["", "Needs Review Items:"])
        for index, item in enumerate(blocked, start=1):
            lines.append(f"{index}. {item.get('channel')}/{item.get('format')} · {item.get('id')}")
            lines.extend([f"   - {blocker}" for blocker in item.get("handoff_blockers") or []])
    return {
        "ready_count": len(ready),
        "blocked_count": len(blocked),
        "checklist": checklist,
        "ready_items": ready,
        "needs_review": blocked,
        "handoff_text": "\n".join(lines),
    }


async def next_facebook_publish_item(item_id: str | None = None):
    if item_id:
        row = await fetch_row(
            """
            select id, asset_id, channel, format, caption, media_urls, planned_slot, status,
                   compliance_status, external_post_id, created_at
            from publish_queue
            where id = $1
            """,
            item_id,
        )
        if row is None and supabase_rest.configured():
            rows = await supabase_rest.select(
                "publish_queue",
                {
                    "select": "id,asset_id,channel,format,caption,media_urls,planned_slot,status,compliance_status,external_post_id,created_at",
                    "id": f"eq.{item_id}",
                    "limit": "1",
                },
            )
            row = rows[0] if rows else None
        return row
    rows = await fetch_rows(
        """
        select id, asset_id, channel, format, caption, media_urls, planned_slot, status,
               compliance_status, external_post_id, created_at
        from publish_queue
        where channel = 'facebook'
          and status = 'scheduled'
          and compliance_status = 'clear'
          and planned_slot is not null
        order by planned_slot nulls last, created_at asc
        limit 1
        """
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "publish_queue",
            {
                "select": "id,asset_id,channel,format,caption,media_urls,planned_slot,status,compliance_status,external_post_id,created_at",
                "channel": "eq.facebook",
                "status": "eq.scheduled",
                "compliance_status": "eq.clear",
                "planned_slot": "not.is.null",
                "order": "planned_slot.asc.nullslast,created_at.asc",
                "limit": "1",
            },
        )
    return rows[0] if rows else None


def facebook_dispatch_blockers(item: dict | None, readiness: dict):
    blockers = []
    if item is None:
        blockers.append("No Facebook scheduled compliance-clear item is ready.")
        return blockers
    if item.get("channel") != "facebook":
        blockers.append("Only Facebook items are supported by this worker.")
    if item.get("status") != "scheduled":
        blockers.append("Item must be scheduled before Meta dispatch.")
    if not item.get("planned_slot"):
        blockers.append("Item needs a planned publish time before Meta dispatch.")
    if item.get("compliance_status") != "clear":
        blockers.append("Item must be compliance-clear before Meta dispatch.")
    if item.get("external_post_id"):
        blockers.append("Item already has an external Meta post ID.")
    if readiness.get("overall_status") != "ready_for_worker_testing":
        blockers.append("Meta credentials or permissions are not ready.")
    media_urls = [url for url in item.get("media_urls") or [] if url]
    unsupported_media = [url for url in media_urls if not str(url).startswith("http")]
    if unsupported_media:
        blockers.append("Private media needs a public/signed publishing URL before Meta can receive it.")
    return blockers


def is_video_url(url: str):
    lowered = url.lower().split("?", 1)[0]
    return lowered.endswith((".mp4", ".mov", ".m4v"))


async def next_instagram_publish_item(item_id: str | None = None):
    if item_id:
        row = await fetch_row(
            """
            select id, asset_id, channel, format, caption, media_urls, planned_slot, status,
                   compliance_status, external_post_id, created_at
            from publish_queue
            where id = $1
            """,
            item_id,
        )
        if row is None and supabase_rest.configured():
            rows = await supabase_rest.select(
                "publish_queue",
                {
                    "select": "id,asset_id,channel,format,caption,media_urls,planned_slot,status,compliance_status,external_post_id,created_at",
                    "id": f"eq.{item_id}",
                    "limit": "1",
                },
            )
            row = rows[0] if rows else None
        return row
    rows = await fetch_rows(
        """
        select id, asset_id, channel, format, caption, media_urls, planned_slot, status,
               compliance_status, external_post_id, created_at
        from publish_queue
        where channel = 'instagram'
          and status = 'scheduled'
          and compliance_status = 'clear'
          and planned_slot is not null
        order by planned_slot nulls last, created_at asc
        limit 1
        """
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "publish_queue",
            {
                "select": "id,asset_id,channel,format,caption,media_urls,planned_slot,status,compliance_status,external_post_id,created_at",
                "channel": "eq.instagram",
                "status": "eq.scheduled",
                "compliance_status": "eq.clear",
                "planned_slot": "not.is.null",
                "order": "planned_slot.asc.nullslast,created_at.asc",
                "limit": "1",
            },
        )
    return rows[0] if rows else None


def instagram_dispatch_blockers(item: dict | None, readiness: dict):
    blockers = []
    if item is None:
        blockers.append("No Instagram scheduled compliance-clear item is ready.")
        return blockers
    if item.get("channel") != "instagram":
        blockers.append("Only Instagram items are supported by this worker.")
    if item.get("status") != "scheduled":
        blockers.append("Item must be scheduled before Instagram dispatch.")
    if not item.get("planned_slot"):
        blockers.append("Item needs a planned publish time before Instagram dispatch.")
    if item.get("compliance_status") != "clear":
        blockers.append("Item must be compliance-clear before Instagram dispatch.")
    if item.get("external_post_id"):
        blockers.append("Item already has an external Meta post ID.")
    if readiness.get("overall_status") != "ready_for_worker_testing":
        blockers.append("Meta credentials or permissions are not ready.")
    media_urls = [url for url in item.get("media_urls") or [] if url]
    if not media_urls:
        blockers.append("Instagram publishing needs at least one image or video URL.")
    unsupported_media = [url for url in media_urls if not str(url).startswith("http")]
    if unsupported_media:
        blockers.append("Private media needs a public/signed publishing URL before Meta can receive it.")
    if item.get("format") == "carousel" and not 2 <= len(media_urls) <= 10:
        blockers.append("Instagram carousel needs 2 to 10 media URLs.")
    if item.get("format") == "reel" and not any(is_video_url(str(url)) for url in media_urls):
        blockers.append("Instagram reel needs a public video URL.")
    return blockers


def instagram_container_payload(item: dict, media_url: str | None = None, children: list[str] | None = None):
    fmt = item.get("format")
    payload = {"caption": item.get("caption") or ""}
    if children:
        payload.update({"media_type": "CAROUSEL", "children": ",".join(children)})
        return payload
    url = media_url or (item.get("media_urls") or [""])[0]
    key = "video_url" if is_video_url(str(url)) else "image_url"
    payload[key] = url
    if fmt == "reel":
        payload["media_type"] = "REELS"
    elif fmt == "story":
        payload["media_type"] = "STORIES"
    return payload


def instagram_dispatch_plan(item: dict | None):
    if not item:
        return []
    media_urls = [str(url) for url in item.get("media_urls") or [] if url]
    base = f"https://graph.facebook.com/{settings.meta_graph_version}/{settings.meta_ig_user_id or '{ig-user-id}'}"
    if item.get("format") == "carousel":
        child_steps = [
            {
                "step": "create_carousel_child_container",
                "url": f"{base}/media",
                "params": {
                    **instagram_container_payload(item, url),
                    "is_carousel_item": True,
                },
            }
            for url in media_urls
        ]
        return [
            *child_steps,
            {
                "step": "create_carousel_parent_container",
                "url": f"{base}/media",
                "params": {"media_type": "CAROUSEL", "children": "{child-container-ids}", "caption": item.get("caption") or ""},
            },
            {"step": "publish_container", "url": f"{base}/media_publish", "params": {"creation_id": "{container-id}"}},
        ]
    return [
        {"step": "create_media_container", "url": f"{base}/media", "params": instagram_container_payload(item)},
        {"step": "publish_container", "url": f"{base}/media_publish", "params": {"creation_id": "{container-id}"}},
    ]


async def publish_facebook_feed_item(item: dict):
    url = f"https://graph.facebook.com/{settings.meta_graph_version}/{settings.meta_page_id}/feed"
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            url,
            data={
                "message": item.get("caption") or "",
                "access_token": settings.meta_page_access_token,
            },
        )
    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail="Meta rejected the Facebook publish request.")
    data = res.json()
    post_id = data.get("id")
    if post_id:
        row = await fetch_row(
            """
            update publish_queue
            set status = 'published', external_post_id = $2, updated_at = now()
            where id = $1
            returning id, status, external_post_id
            """,
            item["id"],
            post_id,
        )
        if row is None and supabase_rest.configured():
            await supabase_rest.update(
                "publish_queue",
                {"status": "published", "external_post_id": post_id},
                {"id": f"eq.{item['id']}"},
            )
    return {"post_id": post_id, "meta_response": data}


async def create_instagram_container(payload: dict):
    url = f"https://graph.facebook.com/{settings.meta_graph_version}/{settings.meta_ig_user_id}/media"
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(url, data={**payload, "access_token": settings.meta_page_access_token})
    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail="Meta rejected the Instagram container request.")
    return res.json().get("id")


async def publish_instagram_container(container_id: str):
    url = f"https://graph.facebook.com/{settings.meta_graph_version}/{settings.meta_ig_user_id}/media_publish"
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            url,
            data={"creation_id": container_id, "access_token": settings.meta_page_access_token},
        )
    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail="Meta rejected the Instagram publish request.")
    return res.json()


async def publish_instagram_item(item: dict):
    if item.get("format") == "carousel":
        child_ids = []
        for url in item.get("media_urls") or []:
            child_id = await create_instagram_container(
                {**instagram_container_payload(item, str(url)), "is_carousel_item": True}
            )
            if child_id:
                child_ids.append(child_id)
        container_id = await create_instagram_container(instagram_container_payload(item, children=child_ids))
    else:
        container_id = await create_instagram_container(instagram_container_payload(item))
    if not container_id:
        raise HTTPException(status_code=502, detail="Meta did not return an Instagram container ID.")
    data = await publish_instagram_container(container_id)
    post_id = data.get("id")
    if post_id:
        row = await fetch_row(
            """
            update publish_queue
            set status = 'published', external_post_id = $2, updated_at = now()
            where id = $1
            returning id, status, external_post_id
            """,
            item["id"],
            post_id,
        )
        if row is None and supabase_rest.configured():
            await supabase_rest.update(
                "publish_queue",
                {"status": "published", "external_post_id": post_id},
                {"id": f"eq.{item['id']}"},
            )
    return {"post_id": post_id, "container_id": container_id, "meta_response": data}


async def next_due_publish_item(channel: str):
    now = datetime.utcnow()
    rows = await fetch_rows(
        """
        select id, asset_id, channel, format, caption, media_urls, planned_slot, status,
               compliance_status, external_post_id, created_at
        from publish_queue
        where channel = $1
          and status = 'scheduled'
          and compliance_status = 'clear'
          and planned_slot is not null
          and planned_slot <= $2
        order by planned_slot asc, created_at asc
        limit 1
        """,
        channel,
        now,
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "publish_queue",
            {
                "select": "id,asset_id,channel,format,caption,media_urls,planned_slot,status,compliance_status,external_post_id,created_at",
                "channel": f"eq.{channel}",
                "status": "eq.scheduled",
                "compliance_status": "eq.clear",
                "planned_slot": f"lte.{now.isoformat()}",
                "order": "planned_slot.asc,created_at.asc",
                "limit": "1",
            },
        )
    return rows[0] if rows else None


async def meta_publishing_job_result(channel: str, dry_run: bool):
    readiness = await meta_readiness()
    item = await next_due_publish_item(channel)
    if channel == "facebook":
        blockers = facebook_dispatch_blockers(item, readiness)
        planned_requests = []
        publish = publish_facebook_feed_item
    else:
        blockers = instagram_dispatch_blockers(item, readiness)
        planned_requests = instagram_dispatch_plan(item)
        publish = publish_instagram_item
    result = {
        "channel": channel,
        "mode": "dry_run" if dry_run else "publish",
        "ready": bool(item) and not blockers,
        "item": item,
        "planned_requests": planned_requests,
        "blockers": blockers,
    }
    if dry_run or blockers:
        return result
    result["published"] = await publish(item)
    return result


@app.post("/jobs/meta-publishing")
async def meta_publishing_job(
    channel: str = "all",
    dry_run: bool = True,
    _: None = Depends(require_access_token),
):
    channels = ["facebook", "instagram"] if channel == "all" else [channel]
    unsupported = [item for item in channels if item not in {"facebook", "instagram"}]
    if unsupported:
        raise HTTPException(status_code=422, detail="Channel must be facebook, instagram, or all.")
    if not dry_run and not settings.meta_enable_publishing_job:
        raise HTTPException(
            status_code=423,
            detail="Scheduled Meta publishing is locked. Set META_ENABLE_PUBLISHING_JOB=true after dry-run approval.",
        )
    if not dry_run and not settings.meta_enable_publishing:
        raise HTTPException(
            status_code=423,
            detail="Real Meta publishing is disabled. Set META_ENABLE_PUBLISHING=true only after Meta approval.",
        )
    results = [await meta_publishing_job_result(item, dry_run) for item in channels]
    return {
        "job": {
            "name": "meta-publishing",
            "enabled": settings.meta_enable_publishing_job,
            "dry_run": dry_run,
            "channel": channel,
            "due_only": True,
            "recommended_schedule": "every 15 minutes",
        },
        "results": results,
        "ready_count": sum(1 for item in results if item.get("ready")),
    }


@app.post("/publishing/facebook/dispatch")
async def dispatch_facebook_item(dispatch: MetaDispatchIn, _: None = Depends(require_access_token)):
    readiness = await meta_readiness()
    item = await next_facebook_publish_item(dispatch.item_id)
    blockers = facebook_dispatch_blockers(item, readiness)
    payload = {
        "mode": "dry_run" if dispatch.dry_run else "publish",
        "ready": bool(item) and not blockers,
        "item": item,
        "blockers": blockers,
        "safety": [
            "Requires scheduled status.",
            "Requires compliance-clear status.",
            "Requires Meta readiness to be ready.",
            "Real publishing also requires META_ENABLE_PUBLISHING=true.",
        ],
    }
    if dispatch.dry_run:
        return payload
    if not settings.meta_enable_publishing:
        raise HTTPException(status_code=423, detail="Real Meta publishing is disabled by configuration.")
    if blockers:
        raise HTTPException(status_code=422, detail={"message": "Facebook dispatch is blocked.", "blockers": blockers})
    published = await publish_facebook_feed_item(item)
    return {**payload, "published": published}


@app.post("/publishing/instagram/dispatch")
async def dispatch_instagram_item(dispatch: MetaDispatchIn, _: None = Depends(require_access_token)):
    readiness = await meta_readiness()
    item = await next_instagram_publish_item(dispatch.item_id)
    blockers = instagram_dispatch_blockers(item, readiness)
    payload = {
        "mode": "dry_run" if dispatch.dry_run else "publish",
        "ready": bool(item) and not blockers,
        "item": item,
        "planned_requests": instagram_dispatch_plan(item),
        "blockers": blockers,
        "safety": [
            "Only Instagram scheduled and compliance-clear items are eligible.",
            "Dry run lists the container and publish calls without contacting Meta.",
            "Real publishing remains locked unless Meta readiness passes and META_ENABLE_PUBLISHING=true.",
        ],
    }
    if dispatch.dry_run:
        return payload
    if not settings.meta_enable_publishing:
        raise HTTPException(status_code=423, detail="Instagram publishing is locked. Enable META_ENABLE_PUBLISHING only after dry-run approval.")
    if blockers:
        raise HTTPException(status_code=422, detail={"message": "Instagram publishing is blocked.", "blockers": blockers})
    published = await publish_instagram_item(item)
    return {**payload, "published": published}


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


@app.get("/metrics/published-source")
async def published_metric_source(limit: int = 10, _: None = Depends(require_access_token)):
    candidates = await meta_metric_candidates(None, limit)
    return {
        "items": candidates,
        "latest": candidates[0] if candidates else None,
        "message": "Use the latest published post as the starting point for manual metric entry." if candidates else "No published posts with Meta IDs are ready for metric entry.",
    }


async def meta_metric_candidates(item_id: str | None = None, limit: int = 10):
    bounded_limit = max(1, min(limit, 50))
    if item_id:
        row = await fetch_row(
            """
            select id, channel, format, caption, status, compliance_status,
                   external_post_id, created_at, updated_at
            from publish_queue
            where id = $1
            """,
            item_id,
        )
        if row is None and supabase_rest.configured():
            rows = await supabase_rest.select(
                "publish_queue",
                {
                    "select": "id,channel,format,caption,status,compliance_status,external_post_id,created_at,updated_at",
                    "id": f"eq.{item_id}",
                    "limit": "1",
                },
            )
            row = rows[0] if rows else None
        return [row] if row else []
    rows = await fetch_rows(
        """
        select id, channel, format, caption, status, compliance_status,
               external_post_id, created_at, updated_at
        from publish_queue
        where status = 'published'
          and external_post_id is not null
          and channel in ('facebook', 'instagram')
        order by updated_at desc nulls last, created_at desc
        limit $1
        """,
        bounded_limit,
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "publish_queue",
            {
                "select": "id,channel,format,caption,status,compliance_status,external_post_id,created_at,updated_at",
                "status": "eq.published",
                "external_post_id": "not.is.null",
                "channel": "in.(facebook,instagram)",
                "order": "updated_at.desc.nullslast,created_at.desc",
                "limit": str(bounded_limit),
            },
        )
    return rows


def meta_insights_metrics(channel: str, fmt: str | None):
    if channel == "instagram":
        if fmt == "reel":
            return ["reach", "likes", "comments", "saved", "shares", "plays", "total_interactions"]
        return ["reach", "likes", "comments", "saved", "shares", "total_interactions"]
    return ["post_impressions", "post_impressions_unique", "post_engaged_users", "post_reactions_by_type_total"]


def meta_metrics_endpoint(item: dict):
    metric_names = meta_insights_metrics(item.get("channel"), item.get("format"))
    return {
        "url": f"https://graph.facebook.com/{settings.meta_graph_version}/{item.get('external_post_id')}/insights",
        "params": {"metric": ",".join(metric_names)},
        "metric_names": metric_names,
    }


def normalize_meta_insights(item: dict, insights: dict):
    metrics = {"raw": insights, "channel": item.get("channel"), "format": item.get("format")}
    for row in insights.get("data", []):
        name = row.get("name")
        values = row.get("values") or []
        value = values[-1].get("value") if values else None
        if name == "post_impressions":
            metrics["impressions"] = value
        elif name == "post_impressions_unique":
            metrics["reach"] = value
        elif name == "post_engaged_users":
            metrics["engaged_users"] = value
        elif name == "post_reactions_by_type_total" and isinstance(value, dict):
            metrics["likes"] = sum(number for number in value.values() if isinstance(number, (int, float)))
            metrics["reactions"] = metrics["likes"]
        elif name == "saved":
            metrics["saves"] = value
        elif name in {"reach", "likes", "comments", "shares", "plays", "total_interactions"}:
            metrics[name] = value
    return metrics


async def fetch_meta_insights(item: dict):
    endpoint = meta_metrics_endpoint(item)
    params = {**endpoint["params"], "access_token": settings.meta_page_access_token}
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(endpoint["url"], params=params)
    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail="Meta rejected the metrics request.")
    return normalize_meta_insights(item, res.json())


@app.post("/metrics/meta/ingest")
async def ingest_meta_metrics(request: MetaMetricsIn, _: None = Depends(require_access_token)):
    readiness = await meta_readiness()
    candidates = await meta_metric_candidates(request.item_id, request.limit)
    planned = [
        {
            "item_id": item.get("id"),
            "channel": item.get("channel"),
            "format": item.get("format"),
            "external_post_id": item.get("external_post_id"),
            "status": item.get("status"),
            "endpoint": meta_metrics_endpoint(item),
        }
        for item in candidates
    ]
    blockers = []
    if not candidates:
        blockers.append("No published Meta posts with external post IDs are ready for metrics ingestion.")
    if readiness.get("overall_status") != "ready_for_worker_testing":
        blockers.append("Meta credentials or permissions are not ready.")
    payload = {
        "mode": "dry_run" if request.dry_run else "ingest",
        "ready": bool(candidates) and not blockers,
        "planned_requests": planned,
        "blockers": blockers,
        "safety": [
            "Only published queue items with external Meta post IDs are scanned.",
            "Dry run lists Graph insight calls without contacting Meta for metrics.",
            "Real ingestion stores raw metrics first, then optional rollup can create outcomes.",
        ],
    }
    if request.dry_run:
        return payload
    if blockers:
        raise HTTPException(status_code=422, detail={"message": "Meta metrics ingestion is blocked.", "blockers": blockers})
    inserted = []
    for item in candidates:
        metrics = await fetch_meta_insights(item)
        metric = MetricIn(
            source=item.get("channel"),
            external_post_id=item.get("external_post_id"),
            captured_at=datetime.utcnow(),
            metrics=metrics,
        )
        saved = await ingest_metric(metric)
        inserted.append(saved.get("item"))
        if request.rollup:
            await rollup_metric_to_outcome(
                MetricRollupIn(
                    external_post_id=item.get("external_post_id"),
                    format=item.get("format"),
                    channel=item.get("channel"),
                    pillar="metabolic_education",
                )
            )
    return {**payload, "inserted": inserted}


@app.post("/jobs/nightly-meta-metrics")
async def nightly_meta_metrics_job(
    dry_run: bool = True,
    limit: int = 25,
    rollup: bool = True,
    _: None = Depends(require_access_token),
):
    request = MetaMetricsIn(limit=limit, dry_run=dry_run, rollup=rollup)
    if not dry_run and not settings.meta_enable_metrics_job:
        raise HTTPException(
            status_code=423,
            detail="Nightly Meta metrics ingestion is locked. Set META_ENABLE_METRICS_JOB=true after dry-run approval.",
        )
    result = await ingest_meta_metrics(request, None)
    return {
        **result,
        "job": {
            "name": "nightly-meta-metrics",
            "enabled": settings.meta_enable_metrics_job,
            "dry_run": dry_run,
            "limit": limit,
            "rollup": rollup,
            "recommended_schedule": "daily 02:30 Asia/Kuala_Lumpur",
        },
    }


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


async def save_feedback(feedback: FeedbackIn):
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


@app.post("/feedback")
async def capture_feedback(feedback: FeedbackIn, _: None = Depends(require_access_token)):
    return await save_feedback(feedback)


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
    insights = await outcome_insights()
    recommendation = (
        "Draft from the weekly plan, then send safe items through review."
        if queue_total == 0
        else "After approved posts publish, record the first 7-day results."
        if outcome_total == 0
        else "Review pending queue items before connecting Meta publishing."
        if feedback_total == 0
        else "Use approval and rejection patterns to refine next week's topics."
    )
    plan_recommendations = await learning_recommended_topics("zh", 5)
    return {
        "queue": queue,
        "feedback": feedback,
        "recent_briefs": recent_briefs,
        "recent_outcomes": recent_outcomes,
        "weights": weights,
        "recommendation": recommendation,
        "plan_recommendations": plan_recommendations,
        "outcome_insights": insights,
    }


def count_label(rows: list[dict], key: str):
    if not rows:
        return "none"
    return ", ".join(f"{row.get(key, 'unknown')}: {row.get('count', 0)}" for row in rows)


def report_bullet(value: str):
    return f"- {value}" if value else "-"


def report_lines(rows: list[dict], formatter, empty: str):
    if not rows:
        return [f"- {empty}"]
    return [report_bullet(formatter(row)) for row in rows]


@app.get("/weekly-report.md")
async def weekly_report(_: None = Depends(require_access_token)):
    summary = await learning_summary()
    loop = await loop_status()
    workflow = build_workflow_guidance(loop)
    media_assets = await fetch_rows(
        """
        select title, media_type, rights_status, approval_status, created_at
        from media_assets
        order by created_at desc
        limit 10
        """
    )
    assets = await fetch_rows(
        """
        select channel, format, compliance_status, review_status, created_at
        from assets
        order by created_at desc
        limit 10
        """
    )
    if not media_assets and supabase_rest.configured():
        media_assets = await supabase_rest.select(
            "media_assets",
            {
                "select": "title,media_type,rights_status,approval_status,created_at",
                "order": "created_at.desc",
                "limit": "10",
            },
        )
    if not assets and supabase_rest.configured():
        assets = await supabase_rest.select(
            "assets",
            {
                "select": "channel,format,compliance_status,review_status,created_at",
                "order": "created_at.desc",
                "limit": "10",
            },
        )
    queue_total = sum(item.get("count", 0) for item in summary.get("queue", []))
    feedback_total = sum(item.get("count", 0) for item in summary.get("feedback", []))
    recent_briefs = summary.get("recent_briefs", [])
    recent_outcomes = summary.get("recent_outcomes", [])
    weights = summary.get("weights", [])
    plan_topics = summary.get("plan_recommendations", {}).get("topics", [])
    insights = summary.get("outcome_insights", {})
    top_signals = insights.get("top_signals", [])
    next_action = workflow.get("next_action", {})
    workflow_summary = workflow.get("summary", {})
    workflow_lines = report_lines(
        workflow.get("steps", []),
        lambda step: f"{step.get('state')} · {step.get('title')} · {step.get('body')}",
        "No workflow guidance available.",
    )
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    brief_lines = report_lines(
        recent_briefs,
        lambda brief: f"{brief.get('format', 'brief')} · {brief.get('funnel_stage') or 'stage'} · {brief.get('topic')}",
        "No recent briefs yet.",
    )
    asset_lines = report_lines(
        assets,
        lambda asset: f"Asset {asset.get('channel')}/{asset.get('format')} · compliance {asset.get('compliance_status')} · review {asset.get('review_status')}",
        "No draft assets yet.",
    )
    media_lines = report_lines(
        media_assets,
        lambda media: f"Media {media.get('title')} · {media.get('media_type')} · rights {media.get('rights_status')} · approval {media.get('approval_status')}",
        "No media assets yet.",
    )
    outcome_lines = report_lines(
        recent_outcomes,
        lambda outcome: f"{outcome.get('post_id')} · {outcome.get('channel')}/{outcome.get('format')} · score {outcome.get('score', 'n/a')} · saves {outcome.get('saves', 0)} · {outcome.get('vs_plan_note') or 'No note'}",
        "No performance outcomes yet.",
    )
    weight_lines = report_lines(
        weights,
        lambda weight: f"{weight.get('dimension')}={weight.get('key')} · {weight.get('previous_value', 'base')} -> {weight.get('value')} · {weight.get('reason') or weight.get('source')}",
        "No active learning weights yet.",
    )
    topic_lines = [report_bullet(topic) for topic in plan_topics] if plan_topics else ["- No recommendations yet."]
    insight_lines = report_lines(
        top_signals,
        lambda insight: f"{insight.get('label')} · avg score {insight.get('avg_score')} · saves {insight.get('saves_total')} · shares {insight.get('shares_total')} · {insight.get('recommendation')}",
        "No outcome insights yet.",
    )
    lines = [
        "# DREC Content OS Weekly Operating Report",
        "",
        f"Generated: {generated_at}",
        "",
        "## Executive Summary",
        "",
        report_bullet(f"Next best move: {summary.get('recommendation')}"),
        report_bullet(f"Workflow next action: {next_action.get('title')} — {next_action.get('body')}"),
        report_bullet(f"Loop stage: {loop.get('stage')}"),
        report_bullet(f"Queue total: {queue_total} ({count_label(summary.get('queue', []), 'status')})"),
        report_bullet(f"Queue-ready assets: {workflow_summary.get('queue_ready_asset_count', 0)} of {workflow_summary.get('asset_count', 0)}"),
        report_bullet(f"Feedback total: {feedback_total} ({count_label(summary.get('feedback', []), 'action')})"),
        report_bullet(f"Briefs: {loop.get('brief_count', 0)} · Assets: {loop.get('asset_count', 0)} · Media: {loop.get('media_count', 0)} · Outcomes: {loop.get('outcome_count', 0)}"),
        "",
        "## Workflow Readiness",
        "",
        *workflow_lines,
        "",
        "## Recent Briefs",
        "",
        *brief_lines,
        "",
        "## Asset And Media Review",
        "",
        *asset_lines,
        *media_lines,
        "",
        "## Recent Results",
        "",
        *outcome_lines,
        "",
        "## Outcome Insights",
        "",
        report_bullet(insights.get("summary")),
        *insight_lines,
        "",
        "## Active Learning Weights",
        "",
        *weight_lines,
        "",
        "## Recommended Next Plan Topics",
        "",
        *topic_lines,
        "",
        "## Manual Operating Notes",
        "",
        "- Keep Meta publishing in manual handoff mode until Meta readiness is green.",
        "- Schedule only compliance-clear items that have passed human review.",
        "- After manual publishing, paste the Meta post ID into Scheduler and record first 7-day metrics.",
    ]
    return Response(
        "\n".join(lines) + "\n",
        media_type="text/markdown",
        headers={"Content-Disposition": 'inline; filename="drec-weekly-report.md"'},
    )


async def build_loop_status():
    queue = await fetch_rows(
        "select status, count(*)::int as count from publish_queue group by status"
    )
    asset_status = await fetch_rows(
        """
        select review_status, compliance_status, count(*)::int as count
        from assets
        group by review_status, compliance_status
        """
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
        asset_rows = await supabase_rest.select(
            "assets",
            {"select": "review_status,compliance_status", "limit": "1000"},
        )
        asset_counts = {}
        for row in asset_rows:
            key = (row.get("review_status", "unknown"), row.get("compliance_status", "unknown"))
            asset_counts[key] = asset_counts.get(key, 0) + 1
        asset_status = [
            {"review_status": review, "compliance_status": compliance, "count": count}
            for (review, compliance), count in asset_counts.items()
        ]
    return {
        "stage": "stage_1_thin_core",
        "beats": ["sense", "decide", "create", "review", "publish", "measure", "learn"],
        "queue": queue,
        "asset_status": asset_status,
        "feedback_count": (feedback_count or {}).get("count", 0),
        "kb_count": (kb_count or {}).get("count", 0),
        "metric_count": (metric_count or {}).get("count", 0),
        "brief_count": (brief_count or {}).get("count", 0),
        "asset_count": (asset_count or {}).get("count", 0),
        "media_count": (media_count or {}).get("count", 0),
        "outcome_count": (outcome_count or {}).get("count", 0),
        "weight_count": (weight_count or {}).get("count", 0),
    }


def total_queue_count(queue):
    return sum(int(item.get("count") or 0) for item in queue or [])


def queue_ready_asset_count(asset_status):
    return sum(
        int(item.get("count") or 0)
        for item in asset_status or []
        if item.get("review_status") == "approved" and item.get("compliance_status") == "clear"
    )


def workflow_step(state, title, body, screen, action, optional=False):
    return {
        "state": state,
        "title": title,
        "body": body,
        "screen": screen,
        "action": action,
        "optional": optional,
    }


def build_workflow_guidance(loop):
    total_queue = total_queue_count(loop.get("queue"))
    brief_count = int(loop.get("brief_count") or 0)
    asset_count = int(loop.get("asset_count") or 0)
    ready_asset_count = queue_ready_asset_count(loop.get("asset_status"))
    media_count = int(loop.get("media_count") or 0)
    outcome_count = int(loop.get("outcome_count") or 0)
    steps = []

    if not brief_count:
        steps.append(
            workflow_step(
                "open",
                "Generate this week's briefs",
                "Start from Weekly Plan so the system has topics, formats, hooks, and safety notes.",
                "plan",
                "Open Weekly Plan",
            )
        )
    else:
        steps.append(
            workflow_step(
                "done",
                "Weekly briefs ready",
                f"{brief_count} brief(s) are available for drafting.",
                "plan",
                "View Briefs",
            )
        )

    if not asset_count:
        steps.append(
            workflow_step(
                "open" if brief_count else "locked",
                "Save one brief as an asset",
                "Use Save Asset on a brief to create a reusable caption package with slides or script notes.",
                "plan",
                "Save Asset",
            )
        )
    elif not ready_asset_count:
        steps.append(
            workflow_step(
                "open",
                "Approve a clear asset",
                f"{asset_count} asset(s) exist, but none are approved and compliance-clear yet.",
                "assets",
                "Open Assets",
            )
        )
    else:
        steps.append(
            workflow_step(
                "done",
                "Draft assets ready",
                f"{ready_asset_count} approved clear asset(s) can enter the queue.",
                "assets",
                "Review Assets",
            )
        )

    if not total_queue:
        steps.append(
            workflow_step(
                "open" if ready_asset_count else "locked",
                "Add an asset to the queue",
                "Move one approved, compliance-clear asset into Review Queue before scheduling.",
                "assets",
                "Open Assets",
            )
        )
    else:
        steps.append(
            workflow_step(
                "done",
                "Queue has content",
                f"{total_queue} item(s) are waiting in the publishing workflow.",
                "review",
                "Review Queue",
            )
        )

    steps.append(
        workflow_step(
            "open" if total_queue else "locked",
            "Review and schedule",
            "Approve safe content, choose a planned publish time, then build the manual handoff.",
            "review" if total_queue else "scheduler",
            "Open Review" if total_queue else "Open Scheduler",
        )
    )

    steps.append(
        workflow_step(
            "done" if outcome_count else "open",
            "Record performance",
            f"{outcome_count} result(s) are feeding the learning loop."
            if outcome_count
            else "After a post is published, add results so future topics improve.",
            "outcomes",
            "Open Performance",
        )
    )

    if not media_count:
        steps.append(
            workflow_step(
                "open",
                "Optional: add approved media",
                "Register owned or approved images/videos before using media-heavy posts.",
                "assets",
                "Add Media",
                optional=True,
            )
        )

    next_action = next(
        (step for step in steps if step["state"] == "open" and not step["optional"]),
        next((step for step in steps if step["state"] == "open"), steps[0]),
    )
    return {
        "next_action": next_action,
        "steps": steps,
        "summary": {
            "queue_total": total_queue,
            "brief_count": brief_count,
            "asset_count": asset_count,
            "queue_ready_asset_count": ready_asset_count,
            "media_count": media_count,
            "outcome_count": outcome_count,
        },
    }


@app.get("/workflow/status")
async def workflow_status(_: None = Depends(require_access_token)):
    loop = await build_loop_status()
    return {
        "loop": loop,
        "workflow": build_workflow_guidance(loop),
        "security": security_status_payload(),
        "automation": await automation_status_payload(),
    }


@app.get("/loop-status")
async def loop_status(_: None = Depends(require_access_token)):
    return await build_loop_status()
