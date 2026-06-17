from contextlib import asynccontextmanager
import csv
from datetime import datetime, timedelta, timezone
from io import StringIO
import json
import re
from urllib.parse import urlencode
from uuid import UUID, uuid4

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .auth import (
    access_policy_payload,
    require_access_token,
    require_admin_access,
    require_metrics_access,
    require_review_access,
    require_schedule_access,
)
from .config import settings
from .compliance import check_text
from .db import close_db, connect_db, fetch_row, fetch_rows
from .models import (
    AssetIn,
    AssetComplianceIn,
    AssetStatusIn,
    ComposerPostIn,
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
META_OAUTH_STATE_PLACEHOLDER = "replace-with-random-state"


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


def meta_oauth_guide_payload():
    scopes = META_REQUIRED_PERMISSIONS
    app_id = settings.meta_app_id or "{META_APP_ID}"
    params = {
        "client_id": app_id,
        "redirect_uri": settings.meta_oauth_redirect_uri,
        "state": META_OAUTH_STATE_PLACEHOLDER,
        "scope": ",".join(scopes),
        "response_type": "code",
    }
    oauth_url = f"https://www.facebook.com/{settings.meta_graph_version}/dialog/oauth?{urlencode(params)}"
    return {
        "configured": bool(settings.meta_app_id),
        "graph_version": settings.meta_graph_version,
        "redirect_uri": settings.meta_oauth_redirect_uri,
        "required_scopes": scopes,
        "oauth_dialog_url": oauth_url if settings.meta_app_id else None,
        "oauth_dialog_url_template": oauth_url,
        "state_note": "Replace the state value with a random one-time value before using this URL in a production OAuth flow.",
        "meta_app_setup": [
            "In Meta for Developers, add Facebook Login for Business or Facebook Login to the app.",
            "Add the redirect URI shown here to Valid OAuth Redirect URIs.",
            "Request the listed permissions during login and complete Meta App Review where required.",
            "Exchange the returned code for a user token on a server-side machine only.",
            "Use the user token to list managed Pages and obtain a Page access token.",
            "Install the Page access token on Fly as META_PAGE_ACCESS_TOKEN, then run Meta readiness and dry-run checks.",
        ],
        "server_side_exchange": {
            "warning": "Do not exchange codes or handle META_APP_SECRET in the browser.",
            "token_exchange_url": f"https://graph.facebook.com/{settings.meta_graph_version}/oauth/access_token",
            "page_accounts_url": f"https://graph.facebook.com/{settings.meta_graph_version}/me/accounts",
            "needed_values": ["META_APP_ID", "META_APP_SECRET", "redirect_uri", "code"],
        },
        "safety": [
            "Keep DREC manual handoff active while connecting Meta.",
            "Do not enable META_ENABLE_PUBLISHING until /meta/readiness is ready and dry-runs pass.",
            "Use one Facebook test publish before Instagram or metrics automation.",
        ],
    }


@app.get("/meta/oauth-guide")
async def meta_oauth_guide(_: None = Depends(require_access_token)):
    return meta_oauth_guide_payload()


def parse_datetime(value):
    if isinstance(value, datetime):
        parsed = value
    elif value:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


async def latest_scheduler_heartbeat():
    row = await fetch_row(
        """
        select id, module, ref_type, ref_id, action, reason, tags, created_at
        from feedback
        where module = 'ops'
          and ref_type = 'scheduler'
          and action = 'heartbeat'
        order by created_at desc
        limit 1
        """
    )
    if row is None and supabase_rest.configured():
        rows = await supabase_rest.select(
            "feedback",
            {
                "select": "id,module,ref_type,ref_id,action,reason,tags,created_at",
                "module": "eq.ops",
                "ref_type": "eq.scheduler",
                "action": "eq.heartbeat",
                "order": "created_at.desc",
                "limit": "1",
            },
        )
        row = rows[0] if rows else None
    if not row:
        return {
            "status": "missing",
            "last_seen_at": None,
            "age_minutes": None,
            "detail": "No GitHub scheduler heartbeat has been recorded yet.",
        }
    created_at = parse_datetime(row.get("created_at"))
    age_minutes = None
    if created_at:
        age_minutes = round((datetime.now(timezone.utc) - created_at).total_seconds() / 60, 1)
    status = "recent" if age_minutes is not None and age_minutes <= 8 * 60 else "stale"
    return {
        "status": status,
        "last_seen_at": row.get("created_at"),
        "age_minutes": age_minutes,
        "detail": (
            f"GitHub scheduler heartbeat recorded {age_minutes} minute(s) ago."
            if age_minutes is not None
            else "GitHub scheduler heartbeat exists but its timestamp could not be parsed."
        ),
        "item": row,
    }


@app.get("/meta/setup-checklist")
async def meta_setup_checklist(_: None = Depends(require_access_token)):
    readiness = await meta_readiness(None)
    security = security_status_payload()
    scheduler_heartbeat = await latest_scheduler_heartbeat()
    oauth_guide = meta_oauth_guide_payload()
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
        "status": "active" if scheduler_heartbeat.get("status") == "recent" else "needs_first_run" if scheduler_heartbeat.get("status") == "missing" else "stale",
        "workflow_file": ".github/workflows/drec-scheduler-dry-run.yml",
        "required_github_secrets": ["DREC_ACCESS_TOKEN"],
        "optional_github_variables": ["DREC_API_BASE_URL"],
        "default_api_base_url": "https://drec-content-os-api.fly.dev",
        "heartbeat": scheduler_heartbeat,
        "steps": [
            "Open GitHub repository Settings > Secrets and variables > Actions.",
            "Add repository secret DREC_ACCESS_TOKEN with the current DREC app access token.",
            "Optionally add repository variable DREC_API_BASE_URL when the API URL changes.",
            "Run the DREC Scheduler Dry Run workflow manually once before trusting the recurring schedule.",
        ],
        "safety": "The GitHub workflow calls only dry-run endpoints, so it checks publishing and metrics readiness without posting to Meta or mutating live records.",
    }
    nightly_metrics_scheduler = {
        "status": "armed_dry_run" if scheduler_heartbeat.get("status") in {"recent", "stale"} else "needs_first_run",
        "workflow_file": ".github/workflows/drec-nightly-meta-metrics.yml",
        "schedule": "daily 02:30 Asia/Kuala_Lumpur",
        "required_github_secrets": ["DREC_ACCESS_TOKEN"],
        "optional_github_variables": ["DREC_API_BASE_URL"],
        "live_enable_github_variable": "DREC_ENABLE_REAL_META_METRICS=true",
        "live_enable_fly_secret": "META_ENABLE_METRICS_JOB=true",
        "default_mode": "dry_run",
        "steps": [
            "Keep DREC_ENABLE_REAL_META_METRICS unset or false while Meta credentials are pending.",
            "After Meta readiness is green, set Fly secret META_ENABLE_METRICS_JOB=true.",
            "Set GitHub Actions variable DREC_ENABLE_REAL_META_METRICS=true only after a successful dry run.",
            "Run DREC Nightly Meta Metrics manually once and confirm raw metrics plus rollup results.",
        ],
        "safety": "The workflow defaults to dry-run. Live ingestion requires both the GitHub variable and the Fly META_ENABLE_METRICS_JOB lock to be enabled, and the API still checks Meta readiness.",
    }
    meta_ready = readiness.get("overall_status") == "ready_for_worker_testing"
    security_ready = bool(security.get("rls_hardening_ready"))
    heartbeat_recent = scheduler_heartbeat.get("status") == "recent"
    activation_switchboard = [
        {
            "label": "Supabase service-role security",
            "status": "ready" if security_ready else "locked",
            "detail": security.get("next_step") or "Install SUPABASE_SERVICE_ROLE_KEY before strict RLS or live workers.",
        },
        {
            "label": "Meta secrets installed",
            "status": "ready" if not missing_env else "locked",
            "detail": "All required Meta secrets are configured." if not missing_env else "Missing: " + ", ".join(item["key"] for item in missing_env),
        },
        {
            "label": "Page token permission check",
            "status": "ready" if not missing_permissions and readiness.get("token_check", {}).get("status") == "ready" else "locked",
            "detail": readiness.get("token_check", {}).get("message") or "Confirm Page token permissions before live publishing.",
        },
        {
            "label": "Dry-run scheduler heartbeat",
            "status": "ready" if heartbeat_recent else scheduler_setup["status"],
            "detail": scheduler_heartbeat.get("detail") or "Run the GitHub dry-run scheduler once before enabling live jobs.",
        },
        {
            "label": "Live publishing switch",
            "status": "armed" if settings.meta_enable_publishing else "off",
            "detail": "Fly secret META_ENABLE_PUBLISHING is enabled." if settings.meta_enable_publishing else "Keep META_ENABLE_PUBLISHING=false until Meta readiness and dry runs are green.",
        },
        {
            "label": "Due-time publishing job switch",
            "status": "armed" if settings.meta_enable_publishing_job else "off",
            "detail": "Fly secret META_ENABLE_PUBLISHING_JOB is enabled." if settings.meta_enable_publishing_job else "Keep META_ENABLE_PUBLISHING_JOB=false until the first live Facebook test is approved.",
        },
        {
            "label": "Nightly metrics Fly switch",
            "status": "armed" if settings.meta_enable_metrics_job else "off",
            "detail": "Fly secret META_ENABLE_METRICS_JOB is enabled." if settings.meta_enable_metrics_job else "Keep META_ENABLE_METRICS_JOB=false until dry-run metrics ingestion succeeds.",
        },
        {
            "label": "Nightly metrics GitHub switch",
            "status": "manual_check",
            "detail": "Set GitHub Actions variable DREC_ENABLE_REAL_META_METRICS=true only after Meta readiness is green and the dry-run workflow passes.",
        },
    ]
    live_ready = meta_ready and security_ready and heartbeat_recent
    return {
        "overall_status": "ready_to_enable" if meta_ready and security_ready else "needs_setup",
        "missing_credentials": [item["key"] for item in missing_env],
        "missing_permissions": missing_permissions,
        "required_secrets": required_secret_names,
        "setup_commands": setup_commands,
        "oauth_guide": oauth_guide,
        "scheduler_setup": scheduler_setup,
        "nightly_metrics_scheduler": nightly_metrics_scheduler,
        "activation_switchboard": activation_switchboard,
        "live_ready": live_ready,
        "live_sequence": [
            "Run live smoke while all Meta enable flags are still off.",
            "Enable META_ENABLE_PUBLISHING=true only for a single Facebook test.",
            "Dispatch one approved scheduled Facebook item and record the Meta post ID.",
            "Confirm metrics dry run sees that post ID.",
            "Enable META_ENABLE_PUBLISHING_JOB=true only after due-time publishing dry run passes.",
            "Enable Instagram publishing after the Facebook test has clean evidence.",
            "Enable META_ENABLE_METRICS_JOB=true and then GitHub variable DREC_ENABLE_REAL_META_METRICS=true after nightly metrics dry run passes.",
        ],
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
                "detail": scheduler_heartbeat.get("detail") or "Add GitHub Actions secret DREC_ACCESS_TOKEN, then run the dry-run workflow once.",
            },
            {
                "label": "Enable live Meta workers only after green dry runs",
                "status": "locked",
                "detail": "Enable META_ENABLE_PUBLISHING, META_ENABLE_PUBLISHING_JOB, and META_ENABLE_METRICS_JOB after readiness is green.",
            },
            {
                "label": "Arm nightly Meta metrics scheduler",
                "status": "locked" if readiness.get("overall_status") != "ready_for_worker_testing" else nightly_metrics_scheduler["status"],
                "detail": "Use DREC Nightly Meta Metrics in dry-run mode first; live ingestion needs both GitHub and Fly switches.",
            },
        ],
        "notes": [
            "Do not paste secret values into GitHub, Vercel, or the browser UI.",
            "Keep manual handoff active until setup status is ready_to_enable.",
            "Run one Facebook publish first, then Instagram, then nightly metrics.",
        ],
    }


@app.get("/meta/activation-checklist.md")
async def meta_activation_checklist(_: None = Depends(require_access_token)):
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    setup = await meta_setup_checklist(None)
    switchboard = setup.get("activation_switchboard") or []
    live_sequence = setup.get("live_sequence") or []
    switch_lines = [
        f"| {item.get('label')} | {item.get('status')} | {item.get('detail')} |"
        for item in switchboard
    ] or ["| No activation switches found | unknown | Refresh Meta Setup first |"]
    sequence_lines = [f"{idx}. {step}" for idx, step in enumerate(live_sequence, start=1)] or [
        "1. Keep Meta workers disabled until Meta Setup is green.",
    ]
    lines = [
        "# DREC Content OS Meta Activation Checklist",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this after credentials are collected and before enabling real Meta publishing or real nightly metrics. It is read-only and does not store secrets or change worker switches.",
        "",
        "## Current Decision",
        "",
        f"- Setup status: {setup.get('overall_status')}",
        f"- Live ready: {'yes' if setup.get('live_ready') else 'no'}",
        f"- Missing credentials: {', '.join(setup.get('missing_credentials') or []) or 'None'}",
        f"- Missing permissions: {', '.join(setup.get('missing_permissions') or []) or 'None'}",
        "",
        "## Activation Switchboard",
        "",
        "| Gate | Status | Detail |",
        "| --- | --- | --- |",
        *switch_lines,
        "",
        "## Required Live Sequence",
        "",
        *sequence_lines,
        "",
        "## Proof To Save Before Live Automation",
        "",
        "- Latest live smoke result:",
        "- Launch Evidence export filename:",
        "- First Facebook test queue ID:",
        "- First Facebook Meta post ID:",
        "- First Instagram dry-run result:",
        "- First nightly metrics dry-run result:",
        "- Approval owner/date:",
        "",
        "## Hard Stop Rules",
        "",
        "- Do not enable real publishing if Page token permissions are missing.",
        "- Do not enable the due-time publishing job before a single manual live Facebook test is approved.",
        "- Do not enable live nightly metrics until the dry-run workflow can see a published Meta post ID.",
        "- If content risk audit is not clear, keep Meta workers off and use manual handoff only.",
        "",
    ]
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-meta-activation-checklist.md"'},
    )


async def meta_credential_wizard_payload():
    setup = await meta_setup_checklist(None)
    readiness = await meta_readiness(None)
    oauth = setup.get("oauth_guide") or {}
    env_by_key = {item.get("key"): item for item in readiness.get("env_checks") or []}
    token_check = readiness.get("token_check") or {}
    fields = [
        {
            "key": "META_APP_ID",
            "label": "Meta App ID",
            "status": env_by_key.get("META_APP_ID", {}).get("status", "missing"),
            "where_to_get": "Meta for Developers > your app > App settings > Basic.",
            "where_to_store": "Fly secret META_APP_ID.",
            "safe_note": "This is an identifier, but still keep it in deployment config instead of public notes.",
        },
        {
            "key": "META_APP_SECRET",
            "label": "Meta App Secret",
            "status": env_by_key.get("META_APP_SECRET", {}).get("status", "missing"),
            "where_to_get": "Meta for Developers > your app > App settings > Basic > App secret.",
            "where_to_store": "Fly secret META_APP_SECRET.",
            "safe_note": "Secret value. Never paste it into browser chat, GitHub files, docs, or screenshots.",
        },
        {
            "key": "META_PAGE_ID",
            "label": "Facebook Page ID",
            "status": env_by_key.get("META_PAGE_ID", {}).get("status", "missing"),
            "where_to_get": "Facebook Page settings, or Graph API /me/accounts after OAuth.",
            "where_to_store": "Fly secret META_PAGE_ID.",
            "safe_note": "Use the Page ID that belongs to the DREC publishing Page.",
        },
        {
            "key": "META_IG_USER_ID",
            "label": "Instagram Business User ID",
            "status": env_by_key.get("META_IG_USER_ID", {}).get("status", "missing"),
            "where_to_get": "Graph API Page connected Instagram business account field.",
            "where_to_store": "Fly secret META_IG_USER_ID.",
            "safe_note": "Must be the Instagram Business/Creator account connected to the Facebook Page.",
        },
        {
            "key": "META_PAGE_ACCESS_TOKEN",
            "label": "Page Access Token",
            "status": env_by_key.get("META_PAGE_ACCESS_TOKEN", {}).get("status", "missing"),
            "where_to_get": "Meta OAuth flow with pages_manage_posts, pages_read_engagement, pages_show_list, instagram_basic, and instagram_content_publish.",
            "where_to_store": "Fly secret META_PAGE_ACCESS_TOKEN.",
            "safe_note": "Secret value. Store only as a Fly secret and rotate it if exposed.",
        },
        {
            "key": "SUPABASE_SERVICE_ROLE_KEY",
            "label": "Supabase Service Role Key",
            "status": "ready" if security_status_payload().get("service_role_key") == "configured" else "missing",
            "where_to_get": "Supabase project settings > API > service_role key.",
            "where_to_store": "Fly secret SUPABASE_SERVICE_ROLE_KEY.",
            "safe_note": "Highly sensitive server-only key. Never put it in Vercel browser env vars.",
        },
    ]
    commands = [
        f'fly secrets set {field["key"]}="<paste-{field["key"].lower().replace("_", "-")}>"'
        for field in fields
    ]
    commands.extend(["fly deploy", 'DREC_ACCESS_TOKEN="<paste-drec-access-token>" npm run smoke:live'])
    permission_rows = [
        {
            "permission": permission,
            "status": "ready" if permission in (token_check.get("permissions") or []) else "missing",
        }
        for permission in META_REQUIRED_PERMISSIONS
    ]
    return {
        "overall_status": setup.get("overall_status"),
        "live_ready": setup.get("live_ready"),
        "fields": fields,
        "required_permissions": permission_rows,
        "oauth": {
            "configured": oauth.get("configured"),
            "redirect_uri": oauth.get("redirect_uri"),
            "graph_version": oauth.get("graph_version"),
            "url_or_template": oauth.get("oauth_dialog_url") or oauth.get("oauth_dialog_url_template"),
        },
        "safe_command_template": commands,
        "after_install_checks": [
            "Redeploy Fly after setting secrets.",
            "Open Meta Setup and confirm missing credentials becomes None.",
            "Confirm Page token permission check is ready.",
            "Run live smoke while all live Meta switches are still off.",
            "Save Launch Evidence and Audit Trail before first live Facebook test.",
        ],
        "hard_stop_rules": [
            "Do not enable real publishing until missing credentials and missing permissions are both empty.",
            "Do not put Meta tokens or Supabase service-role keys into Vercel browser variables.",
            "Do not enable Instagram live publishing before the Facebook-only test succeeds.",
            "Do not enable nightly real metrics until a dry run sees a published Meta post ID.",
        ],
    }


@app.get("/meta/credential-wizard")
async def meta_credential_wizard(_: None = Depends(require_access_token)):
    return await meta_credential_wizard_payload()


@app.get("/meta/credential-wizard.md")
async def meta_credential_wizard_markdown(_: None = Depends(require_access_token)):
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    wizard = await meta_credential_wizard_payload()
    field_lines = [
        f"| {field.get('key')} | {field.get('status')} | {field.get('where_to_get')} | {field.get('where_to_store')} | {field.get('safe_note')} |"
        for field in wizard.get("fields", [])
    ]
    permission_lines = [
        f"| {item.get('permission')} | {item.get('status')} |"
        for item in wizard.get("required_permissions", [])
    ]
    command_lines = ["```bash", *wizard.get("safe_command_template", []), "```"]
    lines = [
        "# DREC Content OS Meta Credential Wizard",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this worksheet before connecting Meta. It lists what to collect and where to store it, but it must not contain real secret values.",
        "",
        "## Current Decision",
        "",
        f"- Setup status: {wizard.get('overall_status')}",
        f"- Live ready: {'yes' if wizard.get('live_ready') else 'no'}",
        "",
        "## Credential Fields",
        "",
        "| Field | Status | Where To Get It | Where To Store It | Safe Note |",
        "| --- | --- | --- | --- | --- |",
        *field_lines,
        "",
        "## Required Permissions",
        "",
        "| Permission | Status |",
        "| --- | --- |",
        *permission_lines,
        "",
        "## OAuth",
        "",
        f"- Configured: {'yes' if wizard.get('oauth', {}).get('configured') else 'no'}",
        f"- Redirect URI: {wizard.get('oauth', {}).get('redirect_uri') or ''}",
        f"- Graph version: {wizard.get('oauth', {}).get('graph_version') or ''}",
        f"- URL or template: {wizard.get('oauth', {}).get('url_or_template') or ''}",
        "",
        "## Safe Command Template",
        "",
        *command_lines,
        "",
        "## After Install Checks",
        "",
        *markdown_list(wizard.get("after_install_checks")),
        "",
        "## Hard Stop Rules",
        "",
        *markdown_list(wizard.get("hard_stop_rules")),
        "",
    ]
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-meta-credential-wizard.md"'},
    )


@app.get("/meta/credential-intake-pack.md")
async def meta_credential_intake_pack(_: None = Depends(require_access_token)):
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    setup = await meta_setup_checklist(None)
    oauth = setup.get("oauth_guide", {})
    missing_credentials = setup.get("missing_credentials") or []
    missing_permissions = setup.get("missing_permissions") or []
    required_secrets = setup.get("required_secrets") or []
    setup_commands = setup.get("setup_commands") or []
    scheduler = setup.get("scheduler_setup") or {}
    nightly_scheduler = setup.get("nightly_metrics_scheduler") or {}
    command_lines = [f"```bash", *setup_commands, "```"] if setup_commands else ["- No setup commands available."]
    scope_lines = [f"- {scope}" for scope in oauth.get("required_scopes", [])] or ["- No scopes listed."]
    secret_lines = [
        f"| {secret} | pending | Store only in Fly secrets. Do not paste real value into this file. |"
        for secret in required_secrets
    ] or ["| No secrets listed | n/a | n/a |"]
    step_lines = [
        f"- [{ 'x' if step.get('status') == 'ready' else ' ' }] {step.get('label')} - {step.get('detail')}"
        for step in setup.get("steps", [])
    ] or ["- [ ] Load Meta setup checklist first."]
    lines = [
        "# DREC Content OS Meta Credential Intake Pack",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this pack when connecting the Facebook Page and Instagram Business account. It is a checklist and evidence sheet only; it does not store secrets, publish content, or enable real Meta jobs.",
        "",
        "## Current Gate Status",
        "",
        f"- Overall setup status: {setup.get('overall_status')}",
        f"- Missing credentials: {', '.join(missing_credentials) or 'None'}",
        f"- Missing permissions: {', '.join(missing_permissions) or 'None'}",
        f"- OAuth configured: {'yes' if oauth.get('configured') else 'no'}",
        f"- Scheduler dry-run status: {scheduler.get('status') or 'not_checked'}",
        f"- Nightly metrics scheduler: {nightly_scheduler.get('status') or 'not_checked'}",
        "",
        "## Values To Collect",
        "",
        "| Secret | Collection Status | Safe Handling Note |",
        "| --- | --- | --- |",
        *secret_lines,
        "",
        "## Required Meta Permissions",
        "",
        *scope_lines,
        "",
        "## OAuth Setup",
        "",
        f"- Redirect URI: {oauth.get('redirect_uri', '')}",
        f"- Graph version: {oauth.get('graph_version', '')}",
        f"- OAuth URL or template: {oauth.get('oauth_dialog_url') or oauth.get('oauth_dialog_url_template') or 'Unavailable'}",
        f"- State note: {oauth.get('state_note', '')}",
        "",
        "## Safe Setup Command Template",
        "",
        *command_lines,
        "",
        "## Verification Checklist",
        "",
        *step_lines,
        "",
        "## Go-Live Rules",
        "",
        "- Keep manual handoff as the publishing path until Meta readiness is green.",
        "- Run Meta Setup dry-run publishing before enabling META_ENABLE_PUBLISHING or META_ENABLE_PUBLISHING_JOB.",
        "- Run nightly metrics in dry-run mode before enabling META_ENABLE_METRICS_JOB.",
        "- Keep DREC_ENABLE_REAL_META_METRICS unset or false until the first dry-run metrics workflow succeeds.",
        "- Do one Facebook-only live test before Instagram publishing or metrics automation.",
        "- After every credential change, run the live smoke check and save the Launch Evidence export.",
        "",
        "## Nightly Metrics Scheduler",
        "",
        f"- Workflow file: {nightly_scheduler.get('workflow_file') or '.github/workflows/drec-nightly-meta-metrics.yml'}",
        f"- Schedule: {nightly_scheduler.get('schedule') or 'daily 02:30 Asia/Kuala_Lumpur'}",
        f"- Default mode: {nightly_scheduler.get('default_mode') or 'dry_run'}",
        f"- Live GitHub variable: {nightly_scheduler.get('live_enable_github_variable') or 'DREC_ENABLE_REAL_META_METRICS=true'}",
        f"- Live Fly secret: {nightly_scheduler.get('live_enable_fly_secret') or 'META_ENABLE_METRICS_JOB=true'}",
        f"- Safety: {nightly_scheduler.get('safety') or 'Live ingestion remains locked until Meta readiness and enable switches are green.'}",
        "",
        "## Evidence Fields",
        "",
        "- Meta app ID verified by:",
        "- Facebook Page ID verified by:",
        "- Instagram Business user ID verified by:",
        "- Page token permission check date:",
        "- First dry-run publishing check result:",
        "- First dry-run metrics check result:",
        "- First live Facebook test queue ID:",
        "- First live Facebook test Meta post ID:",
        "",
    ]
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-meta-credential-intake-pack.md"'},
    )


async def meta_preflight_audit_payload():
    setup = await meta_setup_checklist(None)
    readiness = await meta_readiness(None)
    launch = await launch_readiness_payload()
    risk = await content_risk_audit_payload()
    schedule = await schedule_audit_payload()
    security = security_status_payload()
    access_policy = access_policy_payload()
    gates = [
        {
            "key": "meta_credentials",
            "label": "Meta credentials and permissions",
            "status": "ready" if readiness.get("overall_status") == "ready_for_worker_testing" else "blocked",
            "detail": (
                "Meta credentials and Page token permissions are ready."
                if readiness.get("overall_status") == "ready_for_worker_testing"
                else "Missing credentials: "
                + (", ".join(setup.get("missing_credentials") or []) or "None")
                + "; missing permissions: "
                + (", ".join(setup.get("missing_permissions") or []) or "None")
            ),
        },
        {
            "key": "content_risk",
            "label": "Content risk audit",
            "status": "ready" if risk.get("overall_status") == "clear" else "blocked" if risk.get("block_count", 0) else "review",
            "detail": f"{risk.get('block_count', 0)} block(s), {risk.get('warn_count', 0)} warning(s). {risk.get('next_step')}",
        },
        {
            "key": "schedule_audit",
            "label": "Schedule audit",
            "status": "ready" if schedule.get("overall_status") == "clear" else "blocked" if schedule.get("block_count", 0) else "review",
            "detail": f"{schedule.get('block_count', 0)} block(s), {schedule.get('warn_count', 0)} warning(s). {schedule.get('next_step')}",
        },
        {
            "key": "manual_launch",
            "label": "Manual workflow readiness",
            "status": "ready" if launch.get("can_use_for_manual_ops") else "blocked",
            "detail": (launch.get("usability") or {}).get("detail") or launch.get("next_step"),
        },
        {
            "key": "security",
            "label": "Server-side security",
            "status": "ready" if security.get("rls_hardening_ready") else "review",
            "detail": security.get("next_step"),
        },
        {
            "key": "access_roles",
            "label": "Access role setup",
            "status": "ready" if "admin" in (access_policy.get("configured_roles") or []) else "review",
            "detail": "Configured roles: " + (", ".join(access_policy.get("configured_roles") or []) or "None"),
        },
        {
            "key": "live_switches",
            "label": "Live worker switches",
            "status": "armed" if setup.get("live_ready") else "locked",
            "detail": "Keep live switches off until all preflight gates are ready." if not setup.get("live_ready") else "Ready for the controlled live sequence.",
        },
    ]
    blockers = [gate for gate in gates if gate.get("status") == "blocked"]
    reviews = [gate for gate in gates if gate.get("status") == "review"]
    return {
        "overall_status": "blocked" if blockers else "needs_review" if reviews else "ready_for_controlled_test",
        "ready_count": sum(1 for gate in gates if gate.get("status") in {"ready", "armed"}),
        "blocked_count": len(blockers),
        "review_count": len(reviews),
        "gates": gates,
        "first_live_sequence": setup.get("live_sequence") or [],
        "hard_stop_rules": [
            "Do not run real Meta publishing while any gate is blocked.",
            "Resolve schedule blocks before handoff or Meta worker dry runs.",
            "Run one Facebook-only live test before Instagram live publishing.",
            "Keep nightly metrics live ingestion off until a dry run sees a published Meta post ID.",
        ],
        "next_step": blockers[0].get("detail") if blockers else reviews[0].get("detail") if reviews else "Run the controlled first-live-test sequence.",
    }


@app.get("/meta/preflight-audit")
async def meta_preflight_audit(_: None = Depends(require_access_token)):
    return await meta_preflight_audit_payload()


@app.get("/meta/preflight-audit.md")
async def meta_preflight_audit_markdown(_: None = Depends(require_access_token)):
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    audit = await meta_preflight_audit_payload()
    gate_lines = [
        f"| {gate.get('label')} | {gate.get('status')} | {gate.get('detail')} |"
        for gate in audit.get("gates", [])
    ]
    sequence_lines = [f"{index}. {step}" for index, step in enumerate(audit.get("first_live_sequence") or [], start=1)]
    lines = [
        "# DREC Content OS Meta Preflight Audit",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this immediately before a Meta dry run or the first controlled live Facebook test. It is read-only and does not enable live switches.",
        "",
        "## Decision",
        "",
        f"- Status: {audit.get('overall_status')}",
        f"- Ready gates: {audit.get('ready_count', 0)}",
        f"- Review gates: {audit.get('review_count', 0)}",
        f"- Blocked gates: {audit.get('blocked_count', 0)}",
        f"- Next step: {audit.get('next_step')}",
        "",
        "## Gates",
        "",
        "| Gate | Status | Detail |",
        "| --- | --- | --- |",
        *gate_lines,
        "",
        "## First Live Sequence",
        "",
        *(sequence_lines or ["1. Keep Meta live switches off until preflight is ready."]),
        "",
        "## Hard Stop Rules",
        "",
        *markdown_list(audit.get("hard_stop_rules")),
        "",
    ]
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-meta-preflight-audit.md"'},
    )


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


@app.get("/security/access-policy")
async def security_access_policy(session: dict = Depends(require_access_token)):
    return access_policy_payload(session.get("role", "none"), session.get("actor", ""))


@app.get("/security/access-control-pack.md")
async def security_access_control_pack(session: dict = Depends(require_admin_access)):
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    policy = access_policy_payload(session.get("role", "none"), session.get("actor", ""))
    role_lines = [
        f"| {role.get('role')} | {', '.join(role.get('scopes') or [])} |"
        for role in policy.get("recommended_roles", [])
    ]
    scope_lines = [
        f"| {scope} | {', '.join(items)} |"
        for scope, items in (policy.get("enforced_scopes") or {}).items()
    ]
    configured = ", ".join(policy.get("configured_roles") or []) or "None"
    commands = [
        "# Generate each token locally, then paste only into Fly secrets.",
        'DREC_VIEWER_TOKEN="$(openssl rand -base64 32)"',
        'DREC_REVIEWER_TOKEN="$(openssl rand -base64 32)"',
        'DREC_OPERATOR_TOKEN="$(openssl rand -base64 32)"',
        'DREC_ADMIN_TOKEN="$(openssl rand -base64 32)"',
        'fly secrets set DREC_VIEWER_TOKEN="$DREC_VIEWER_TOKEN" DREC_REVIEWER_TOKEN="$DREC_REVIEWER_TOKEN" DREC_OPERATOR_TOKEN="$DREC_OPERATOR_TOKEN" DREC_ADMIN_TOKEN="$DREC_ADMIN_TOKEN"',
        "fly deploy",
        'DREC_ACCESS_TOKEN="$DREC_ADMIN_TOKEN" DREC_ACTOR="admin-name" npm run smoke:live',
    ]
    lines = [
        "# DREC Content OS Access Control Pack",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this before handing the app to multiple operators. It gives role-token setup, actor naming, and rotation rules until full user login is added.",
        "",
        "## Current Access State",
        "",
        f"- Mode: {policy.get('mode')}",
        f"- Current role: {policy.get('current_role')}",
        f"- Current actor: {policy.get('current_actor') or 'not set'}",
        f"- Current scopes: {', '.join(policy.get('current_scopes') or []) or 'none'}",
        f"- Configured roles: {configured}",
        f"- Legacy access token accepted: {'yes' if policy.get('legacy_access_token_enabled') else 'no'}",
        "",
        "## Recommended Roles",
        "",
        "| Role | Scopes |",
        "| --- | --- |",
        *role_lines,
        "",
        "## Enforced Scope Map",
        "",
        "| Scope | Protects |",
        "| --- | --- |",
        *scope_lines,
        "",
        "## Safe Setup Command Template",
        "",
        "```bash",
        *commands,
        "```",
        "",
        "## Actor Naming Rule",
        "",
        "- Every tester should fill the browser Actor name field before review, scheduling, publishing handoff, or metrics work.",
        "- Use a stable name such as `dr-eason`, `reviewer-lim`, or an email-style label.",
        "- Actor labels are stored in feedback/audit tags; they are not a password and should not contain secrets.",
        "",
        "## Handoff Policy",
        "",
        "- Viewer token: reading and exports only.",
        "- Reviewer token: asset safety review, queue review, and feedback decisions.",
        "- Operator token: review, scheduling, publishing handoff, and metrics closeout.",
        "- Admin token: deployment, security exports, scheduler heartbeat setup, and credential rollout only.",
        "",
        "## Rotation Rules",
        "",
        "- Rotate the admin token after any shared-screen setup session.",
        "- Rotate reviewer/operator tokens when a team member no longer needs access.",
        "- Keep the legacy DREC_ACCESS_TOKEN only during migration; move routine users to role tokens.",
        "- After token changes, redeploy Fly and run live smoke with an admin actor label.",
        "",
        "## Proof To Save",
        "",
        "- Download Access Control Pack after token setup.",
        "- Download Audit Trail after the first review/scheduler test with actor labels.",
        "- Save Launch Evidence before enabling Meta live switches.",
        "",
    ]
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-access-control-pack.md"'},
    )


@app.get("/security/rls-hardening-plan.md")
async def security_rls_hardening_plan(_: None = Depends(require_admin_access)):
    security = security_status_payload()
    migration = "supabase/migrations/20260617040906_strict_server_only_rls.sql"
    lines = [
        "# DREC Content OS RLS Hardening Plan",
        "",
        "Use this only after the Fly API is using the Supabase service-role key. The browser must keep talking to the protected Fly API, not directly to Supabase.",
        "",
        "## Current Readiness",
        "",
        f"- Status: {security.get('overall_status')}",
        f"- Supabase REST: {security.get('supabase_rest')}",
        f"- Service-role key: {security.get('service_role_key')}",
        f"- Direct browser Supabase: {security.get('direct_browser_supabase')}",
        f"- Next step: {security.get('next_step')}",
        "",
        "## Migration",
        "",
        f"- File: `{migration}`",
        "- Purpose: revoke anon/authenticated direct table access, keep service_role access for the server API, and replace broad REST policies with service-role policies.",
        "- Storage: replaces broad `drec-media` storage access with service-role-only storage access.",
        "",
        "## Apply Gate",
        "",
        "- `GET /security/status` must return `ready_for_rls_hardening`.",
        "- `DREC_ACCESS_TOKEN=\"...\" npm run smoke:live` must pass immediately before applying.",
        "- Keep the Supabase SQL editor open so the migration can be reverted manually if needed.",
        "",
        "## Apply Steps",
        "",
        "1. Back up operations data with `Download Snapshot`, `Download Asset Review CSV`, `Download Review Queue CSV`, and `Download Learning Snapshot`.",
        "2. Confirm Fly secrets include `SUPABASE_SERVICE_ROLE_KEY` and the API was redeployed after setting it.",
        f"3. Apply `{migration}` in Supabase SQL Editor or with the Supabase CLI.",
        "4. Run `DREC_ACCESS_TOKEN=\"...\" npm run smoke:live`.",
        "5. If smoke fails with permission errors, restore the previous permissive policies temporarily and inspect grants/RLS before retrying.",
        "",
        "## Expected Result",
        "",
        "- Protected Fly API routes continue to work.",
        "- Direct anon/authenticated Supabase Data API access to Content OS tables is blocked.",
        "- Meta and browser workflows remain gated by the DREC API token until proper user login is added.",
    ]
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-rls-hardening-plan.md"'},
    )


async def automation_status_payload():
    loop = await build_loop_status()
    workflow = build_workflow_guidance(loop)
    meta = await meta_readiness(None)
    security = security_status_payload()
    scheduler_heartbeat = await latest_scheduler_heartbeat()
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
            "key": "scheduler",
            "label": "GitHub dry-run scheduler",
            "status": "ready" if scheduler_heartbeat.get("status") == "recent" else "waiting",
            "detail": scheduler_heartbeat.get("detail"),
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
            "scheduler_heartbeat": scheduler_heartbeat,
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


def is_overdue_scheduled_item(item: dict):
    if item.get("status") != "scheduled":
        return False
    planned_slot = parse_datetime(item.get("planned_slot"))
    if not planned_slot:
        return False
    planned_utc = planned_slot.astimezone(timezone.utc) if planned_slot.tzinfo else planned_slot.replace(tzinfo=timezone.utc)
    return planned_utc < datetime.now(timezone.utc) - timedelta(minutes=30)


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
        if status == "cancelled":
            continue
        planned_slot = parse_datetime(item.get("planned_slot"))
        compliance = item.get("compliance_status")
        latest_action = (item.get("latest_feedback") or {}).get("action")
        if compliance == "flagged":
            items.append(audit_item("queue", item.get("id"), "block", "Queue item is safety flagged", "Flagged queue items must not be scheduled or published.", "Rewrite or cancel this queue item.", item.get("channel"), item.get("format")))
        elif compliance != "clear":
            items.append(audit_item("queue", item.get("id"), "warn", "Queue item is not safety clear", f"Current safety status: {compliance or 'unknown'}.", "Run safety check before scheduling.", item.get("channel"), item.get("format")))
        if status == "scheduled" and not item.get("planned_slot"):
            items.append(audit_item("queue", item.get("id"), "block", "Scheduled item has no planned time", "Publishing workers and handoff need a real planned time.", "Set a planned publish time.", item.get("channel"), item.get("format")))
        if is_overdue_scheduled_item(item) and planned_slot:
            planned_utc = planned_slot.astimezone(timezone.utc) if planned_slot.tzinfo else planned_slot.replace(tzinfo=timezone.utc)
            items.append(audit_item("queue", item.get("id"), "warn", "Scheduled item is overdue", f"Planned time was {planned_utc.isoformat()}.", "Publish and record the post ID, or reschedule/cancel this item.", item.get("channel"), item.get("format")))
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
            "cancelled_queue": sum(1 for item in queue if item.get("status") == "cancelled"),
            "overdue_scheduled_queue": sum(1 for item in queue if is_overdue_scheduled_item(item)),
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
    can_test_now = manual_ops_ready
    can_use_for_manual_ops = manual_ops_ready and risk_blocks == 0
    can_auto_publish = automation_ready
    if can_auto_publish:
        usability_label = "Ready for controlled Meta automation"
        usability_detail = "Manual workflow, risk gates, Meta credentials, and security gates are green."
    elif can_use_for_manual_ops:
        usability_label = "Ready to test and use manually"
        usability_detail = "You can plan, draft, review, schedule, build handoff, record metrics, and learn. Keep real Meta posting manual until credentials and security gates are complete."
    elif can_test_now:
        usability_label = "Ready to test with review"
        usability_detail = "The workflow is available, but resolve current risk warnings or blockers before publishing anything externally."
    else:
        usability_label = "Setup needed before testing"
        usability_detail = "Connect the API and Supabase base workflow before starting the manual test path."
    return {
        "overall_status": overall,
        "manual_use_ready": manual_ops_ready,
        "can_test_now": can_test_now,
        "can_use_for_manual_ops": can_use_for_manual_ops,
        "can_auto_publish": can_auto_publish,
        "usability": {
            "label": usability_label,
            "detail": usability_detail,
            "safe_test_scope": [
                "Generate weekly plans and draft content packages",
                "Review assets and safety status",
                "Schedule items and build manual handoff",
                "Record manual post IDs and metrics for learning",
            ] if can_test_now else [],
            "not_ready_scope": [
                item
                for item in [
                    "Hands-off Facebook/Instagram publishing" if not can_auto_publish else None,
                    "Strict Supabase RLS hardening" if not rls_ready else None,
                    "Meta metrics auto-ingestion" if not meta_ready else None,
                ]
                if item
            ],
        },
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


def usability_markdown_lines(launch: dict):
    usability = launch.get("usability") or {}
    safe_scope = usability.get("safe_test_scope") or []
    not_ready_scope = usability.get("not_ready_scope") or []
    return [
        "## Can I Use It Now",
        "",
        f"- Decision: {usability.get('label') or launch.get('overall_status') or 'Unknown'}",
        f"- Detail: {usability.get('detail') or launch.get('next_step') or 'Check launch readiness.'}",
        f"- Can test now: {'yes' if launch.get('can_test_now') else 'no'}",
        f"- Can use for manual ops: {'yes' if launch.get('can_use_for_manual_ops') else 'no'}",
        f"- Can auto-publish: {'yes' if launch.get('can_auto_publish') else 'no'}",
        "",
        "Safe now:",
        "",
        *(markdown_list(safe_scope) if safe_scope else ["- No safe test scope is available yet."]),
        "",
        "Not ready yet:",
        "",
        *(markdown_list(not_ready_scope) if not_ready_scope else ["- No not-ready scope listed."]),
        "",
    ]


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
            "done" if ready_assets else "open" if brief_count else "locked",
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


@app.post("/operations/scheduler-heartbeat")
async def operations_scheduler_heartbeat(
    workflow: str = "DREC Scheduler Dry Run",
    mode: str = "dry_run",
    session: dict = Depends(require_admin_access),
):
    safe_workflow = re.sub(r"[^a-zA-Z0-9_. -]", "", workflow)[:80] or "github-actions"
    safe_mode = re.sub(r"[^a-zA-Z0-9_-]", "", mode)[:40] or "dry_run"
    payload = {
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "source": "github-actions",
        "workflow": safe_workflow,
        "mode": safe_mode,
    }
    await save_feedback(
        FeedbackIn(
            module="ops",
            ref_type="scheduler",
            ref_id=safe_workflow,
            action="heartbeat",
            before_text=json.dumps(payload, ensure_ascii=False),
            reason=f"GitHub scheduler {safe_mode} checks completed.",
            tags=["github-actions", "scheduler", safe_mode, *audit_tags(session)],
        )
    )
    return {"heartbeat": await latest_scheduler_heartbeat()}


@app.get("/operations/scheduler-activation-pack.md")
async def operations_scheduler_activation_pack(_: None = Depends(require_access_token)):
    setup = await meta_setup_checklist(None)
    automation = await automation_status_payload()
    security = security_status_payload()
    risk = await content_risk_audit_payload()
    scheduler = setup.get("scheduler_setup", {})
    nightly_scheduler = setup.get("nightly_metrics_scheduler", {})
    heartbeat = scheduler.get("heartbeat", {})
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    required_secret_lines = [f"- {secret}" for secret in scheduler.get("required_github_secrets", [])] or ["- DREC_ACCESS_TOKEN"]
    optional_variable_lines = [f"- {variable}" for variable in scheduler.get("optional_github_variables", [])] or ["- DREC_API_BASE_URL"]
    activation_steps = [
        "Open GitHub repository Settings > Secrets and variables > Actions.",
        "Add repository secret DREC_ACCESS_TOKEN with the current DREC app access token.",
        "Optionally add repository variable DREC_API_BASE_URL when the API URL changes.",
        "Open Actions > DREC Scheduler Dry Run and choose Run workflow.",
        "Refresh Meta Setup or Automation Status; heartbeat should become recent after a successful run.",
    ]
    setup_step_lines = [f"{idx}. {step}" for idx, step in enumerate(activation_steps, start=1)] or [
        "1. Open GitHub repository Settings > Secrets and variables > Actions.",
        "2. Add repository secret DREC_ACCESS_TOKEN with the current DREC app access token.",
        "3. Run the DREC Scheduler Dry Run workflow manually once.",
    ]
    gate_lines = [
        f"- {gate.get('label')}: {gate.get('status')} — {gate.get('detail')}"
        for gate in automation.get("gates", [])
    ] or ["- No automation gates available."]
    risk_lines = [
        f"- [{item.get('severity')}] {item.get('kind')} {item.get('id')}: {item.get('title')} — {item.get('action')}"
        for item in risk.get("items", [])[:12]
    ] or ["- No content risk items found."]
    lines = [
        "# DREC Content OS Scheduler Activation Pack",
        "",
        f"Generated: {generated_at}",
        "",
        "## Current Status",
        "",
        f"- Scheduler status: {scheduler.get('status', 'unknown')}",
        f"- Workflow file: {scheduler.get('workflow_file', '.github/workflows/drec-scheduler-dry-run.yml')}",
        f"- Default API URL: {scheduler.get('default_api_base_url', 'https://drec-content-os-api.fly.dev')}",
        f"- Latest heartbeat: {heartbeat.get('status', 'missing')}",
        f"- Heartbeat detail: {heartbeat.get('detail', 'No scheduler heartbeat has been recorded yet.')}",
        f"- Automation gate: {automation.get('overall_status', 'unknown')}",
        f"- Security gate: {security.get('overall_status', 'unknown')}",
        f"- Content risk: {risk.get('overall_status', 'unknown')}",
        "",
        "## Required GitHub Secret",
        "",
        *required_secret_lines,
        "",
        "## Optional GitHub Variable",
        "",
        *optional_variable_lines,
        "",
        "## Activation Steps",
        "",
        *setup_step_lines,
        "",
        "## What The Workflow Runs",
        "",
        "- Due Meta publishing dry run every 6 hours.",
        "- Nightly Meta metrics dry run at 02:30 Malaysia time.",
        "- Automation and content risk checks.",
        "- Scheduler heartbeat recording after checks pass.",
        "- Separate DREC Nightly Meta Metrics workflow, dry-run by default, ready for live ingestion after credential approval.",
        "",
        "## Nightly Metrics Scheduler",
        "",
        f"- Workflow file: {nightly_scheduler.get('workflow_file', '.github/workflows/drec-nightly-meta-metrics.yml')}",
        f"- Schedule: {nightly_scheduler.get('schedule', 'daily 02:30 Asia/Kuala_Lumpur')}",
        f"- Default mode: {nightly_scheduler.get('default_mode', 'dry_run')}",
        f"- Live GitHub switch: {nightly_scheduler.get('live_enable_github_variable', 'DREC_ENABLE_REAL_META_METRICS=true')}",
        f"- Live Fly switch: {nightly_scheduler.get('live_enable_fly_secret', 'META_ENABLE_METRICS_JOB=true')}",
        f"- Safety: {nightly_scheduler.get('safety', 'Live metrics ingestion is double-locked until credentials are approved.')}",
        "",
        "## Safety Rules",
        "",
        "- The workflow uses dry-run endpoints only.",
        "- It must not publish to Facebook or Instagram.",
        "- Keep META_ENABLE_PUBLISHING, META_ENABLE_PUBLISHING_JOB, and META_ENABLE_METRICS_JOB disabled until Meta credentials, permissions, service-role security, and live smoke checks are green.",
        "- If a workflow run fails, leave real Meta workers disabled and inspect the Actions logs before retrying.",
        "",
        "## Troubleshooting",
        "",
        "- Missing heartbeat: confirm GitHub Actions secret DREC_ACCESS_TOKEN is set and current.",
        "- API failure: confirm DREC_API_BASE_URL is unset or set to https://drec-content-os-api.fly.dev.",
        "- Auth failure: rotate the DREC app access token in GitHub Actions secret and rerun manually.",
        "- Risk failure: clear content risk items before relying on recurring dry runs.",
        "",
        "## Automation Gates",
        "",
        *gate_lines,
        "",
        "## Current Risk Items",
        "",
        *risk_lines,
        "",
    ]
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-scheduler-activation-pack.md"'},
    )


@app.get("/operations/launch-evidence.md")
async def operations_launch_evidence(_: None = Depends(require_access_token)):
    generated_at = datetime.now(timezone.utc).isoformat()
    launch = await launch_readiness_payload()
    checklist = await test_run_checklist_payload()
    automation = await automation_status_payload()
    security = security_status_payload()
    risk = await content_risk_audit_payload()
    meta = await meta_setup_checklist(None)
    next_step = checklist.get("next_step") or {}
    summary = checklist.get("summary") or {}
    lines = [
        "# DREC Content OS Launch Evidence",
        "",
        f"Generated: {generated_at}",
        "",
        "## Decision Summary",
        "",
        f"- Launch readiness: {launch.get('overall_status')}",
        f"- Manual cycle: {checklist.get('overall_status')} ({checklist.get('done_count')}/{checklist.get('total_required')} required steps done)",
        f"- Automation gate: {automation.get('overall_status')}",
        f"- Content risk: {risk.get('overall_status')} ({risk.get('block_count', 0)} block, {risk.get('warn_count', 0)} warn)",
        f"- Meta setup: {meta.get('overall_status')}",
        f"- Supabase security: {security.get('overall_status')}",
        "",
        *usability_markdown_lines(launch),
        "## Next Best Action",
        "",
        f"- {next_step.get('action') or next_step.get('label') or 'Continue manual test cycle'}",
        f"- {next_step.get('detail') or 'Use the Dashboard test path for the next action.'}",
        "",
        "## Operating Counts",
        "",
        f"- Briefs: {summary.get('brief_count', 0)}",
        f"- Ready assets: {summary.get('ready_assets', 0)}",
        f"- Queue total: {summary.get('queue_total', 0)}",
        f"- Scheduled queue: {summary.get('scheduled_queue', 0)}",
        f"- Handoff ready: {summary.get('handoff_ready', 0)}",
        f"- Published queue: {summary.get('published_queue', 0)}",
        f"- Raw metrics: {summary.get('metric_count', 0)}",
        f"- Outcomes: {summary.get('outcome_count', 0)}",
        "",
        "## Manual Test Path",
        "",
    ]
    for step in checklist.get("steps") or []:
        lines.append(f"- {step.get('status')}: {step.get('label')} - {step.get('detail')}")
    lines.extend(
        [
            "",
            "## Launch Readiness Stages",
            "",
        ]
    )
    for stage in launch.get("stages") or []:
        lines.append(f"- {stage.get('status')}: {stage.get('label')} - {stage.get('detail')}")
    lines.extend(
        [
            "",
            "## Automation Gates",
            "",
        ]
    )
    for gate in automation.get("gates") or []:
        lines.append(f"- {gate.get('status')}: {gate.get('label')} - {gate.get('detail')}")
    lines.extend(
        [
            "",
            "## Risk Items",
            "",
        ]
    )
    if risk.get("items"):
        for item in risk.get("items")[:25]:
            lines.append(f"- {item.get('severity')}: {item.get('kind')} {item.get('id')} - {item.get('title')} | {item.get('action')}")
    else:
        lines.append("- No current content risk items found.")
    lines.extend(
        [
            "",
            "## Meta And Credential Evidence",
            "",
            f"- Missing credentials: {', '.join(meta.get('missing_credentials') or []) or 'None'}",
            f"- Missing permissions: {', '.join(meta.get('missing_permissions') or []) or 'None'}",
            "- Required secrets: " + ", ".join(meta.get("required_secrets") or []),
            "",
            "## Safe Go-Live Rule",
            "",
            "- Use manual handoff while Meta setup is not ready_to_enable.",
            "- Enable real Meta publishing only after dry-run jobs pass and Meta permissions are approved.",
            "- Keep recording published IDs and metrics so the learning loop continues improving weekly plans.",
            "",
        ]
    )
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-launch-evidence.md"'},
    )


@app.get("/operations/first-test-kit.md")
async def operations_first_test_kit(_: None = Depends(require_access_token)):
    generated_at = datetime.now(timezone.utc).isoformat()
    launch = await launch_readiness_payload()
    checklist = await test_run_checklist_payload()
    risk = await content_risk_audit_payload()
    meta = await meta_setup_checklist(None)
    next_step = checklist.get("next_step") or {}
    summary = checklist.get("summary") or {}
    sample_topics = [
        "空腹血糖正常，为什么还要看餐后血糖？",
        "腰围变小，为什么可能比体重下降更重要？",
        "HbA1c、甘油三酯、腰围：复诊前如何一起看？",
        "控糖期间最容易误会的三个饮食信号",
        "50岁以后，如何用一周记录看懂代谢改善？",
    ]
    sample_metrics = [
        "Post ID: manual-test-001",
        "Source: manual",
        "Impressions: 1000",
        "Engagements: 60",
        "Saves: 12",
        "Shares: 8",
        "Comments: 5",
        "Leads: 1",
        "Notes: First manual workflow test result.",
    ]
    lines = [
        "# DREC Content OS First Test Kit",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this kit to move one safe sample post through the manual workflow before connecting Meta automation.",
        "",
        *usability_markdown_lines(launch),
        "## Current Test State",
        "",
        f"- Manual cycle: {checklist.get('overall_status')} ({checklist.get('done_count')}/{checklist.get('total_required')} required steps done)",
        f"- Next action: {next_step.get('action') or next_step.get('label') or 'Open Dashboard'}",
        f"- Next detail: {next_step.get('detail') or 'Follow the Dashboard Test Path.'}",
        f"- Content risk: {risk.get('overall_status')} ({risk.get('block_count', 0)} block / {risk.get('warn_count', 0)} warn)",
        f"- Meta setup: {meta.get('overall_status')}",
        "",
        "## Operating Counts",
        "",
        f"- Briefs: {summary.get('brief_count', 0)}",
        f"- Ready assets: {summary.get('ready_assets', 0)}",
        f"- Queue total: {summary.get('queue_total', 0)}",
        f"- Scheduled queue: {summary.get('scheduled_queue', 0)}",
        f"- Handoff ready: {summary.get('handoff_ready', 0)}",
        f"- Published queue: {summary.get('published_queue', 0)}",
        f"- Metrics: {summary.get('metric_count', 0)}",
        f"- Outcomes: {summary.get('outcome_count', 0)}",
        "",
        "## Copy/Paste Weekly Topics",
        "",
        *markdown_list(sample_topics),
        "",
        "## Manual Test Steps",
        "",
    ]
    for step in checklist.get("steps") or []:
        lines.append(f"- {step.get('status')}: {step.get('label')} - {step.get('detail')}")
    lines.extend(
        [
            "",
            "## Sample Metric Entry After Manual Publishing",
            "",
            *markdown_list(sample_metrics),
            "",
            "## Acceptance Criteria",
            "",
            "- At least one brief is saved as an asset.",
            "- The asset is safety-clear and approved.",
            "- One queue item is approved, scheduled, and appears in the publishing handoff.",
            "- A manual Meta post ID or manual-test label is recorded after posting.",
            "- Performance metrics are saved and rolled up into learning.",
            "- Weekly report and Launch Evidence download successfully after the test.",
            "",
            "## Safety Notes",
            "",
            "- Keep this as manual handoff only until Meta credentials and Supabase service-role key are installed.",
            "- Do not publish medical claims, diagnosis promises, or guaranteed reversal claims.",
            "- Use the content risk audit before any external posting.",
        ]
    )
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-first-test-kit.md"'},
    )


@app.get("/operations/test-run-tracker.md")
async def operations_test_run_tracker(_: None = Depends(require_access_token)):
    generated_at = datetime.now(timezone.utc).isoformat()
    checklist = await test_run_checklist_payload()
    risk = await content_risk_audit_payload()
    launch = await launch_readiness_payload()
    next_step = checklist.get("next_step") or {}
    summary = checklist.get("summary") or {}
    lines = [
        "# DREC Content OS First Test Run Tracker",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this during the first live manual test. It is read-only and does not change system records.",
        "",
        "## Current Decision",
        "",
        f"- Can test now: {'yes' if launch.get('can_test_now') else 'no'}",
        f"- Manual cycle: {checklist.get('overall_status')} ({checklist.get('done_count')}/{checklist.get('total_required')} required steps done)",
        f"- Next action: {next_step.get('action') or next_step.get('label') or 'Open Dashboard'}",
        f"- Next detail: {next_step.get('detail') or 'Follow the first open Dashboard Test Path step.'}",
        f"- Content risk: {risk.get('overall_status')} ({risk.get('block_count', 0)} block / {risk.get('warn_count', 0)} warn)",
        "",
        "## Live Counts Before Testing",
        "",
        f"- Briefs: {summary.get('brief_count', 0)}",
        f"- Ready assets: {summary.get('ready_assets', 0)}",
        f"- Queue total: {summary.get('queue_total', 0)}",
        f"- Scheduled queue: {summary.get('scheduled_queue', 0)}",
        f"- Handoff ready: {summary.get('handoff_ready', 0)}",
        f"- Published queue: {summary.get('published_queue', 0)}",
        f"- Metrics: {summary.get('metric_count', 0)}",
        f"- Outcomes: {summary.get('outcome_count', 0)}",
        "",
        "## Step Tracker",
        "",
        "| Done | Step | Current Status | What To Prove | Evidence To Record |",
        "| --- | --- | --- | --- | --- |",
    ]
    for step in checklist.get("steps") or []:
        if step.get("key") == "meta":
            evidence = "Confirm dry-run/manual mode is still active."
        elif step.get("key") == "published":
            evidence = "Write the manual Meta post ID or manual-test label."
        elif step.get("key") == "metrics":
            evidence = "Write the post ID and metric window used for rollup."
        else:
            evidence = "Write the item ID, screen, or downloaded file name."
        lines.append(
            "| [ ] "
            f"| {step.get('label', '')} "
            f"| {step.get('status', '')} "
            f"| {step.get('detail', '')} "
            f"| {evidence} |"
        )
    lines.extend(
        [
            "",
            "## Manual Notes",
            "",
            "- Tester:",
            "- Test start time:",
            "- Test end time:",
            "- Published post ID or manual label:",
            "- Metrics window used:",
            "- Issues found:",
            "- Decision after test:",
            "",
            "## Pass Rule",
            "",
            "- The manual workflow passes when all required non-Meta steps are done.",
            "- Real Meta automation stays off until Meta credentials, permissions, dry runs, and Supabase service-role security are green.",
            "- If risk audit shows any block, resolve it before external publishing.",
        ]
    )
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-first-test-run-tracker.md"'},
    )


@app.get("/operations/manual-cycle-qa.md")
async def operations_manual_cycle_qa(_: None = Depends(require_access_token)):
    generated_at = datetime.now(timezone.utc).isoformat()
    checklist = await test_run_checklist_payload()
    launch = await launch_readiness_payload()
    risk = await content_risk_audit_payload()
    handoff = await publishing_handoff(None)
    learning = await learning_summary(None)
    next_step = checklist.get("next_step") or {}
    steps = checklist.get("steps") or []
    open_steps = [step for step in steps if step.get("status") == "open"]
    locked_steps = [step for step in steps if step.get("status") == "locked"]
    blocked_handoff = handoff.get("blocked_items") or []
    ready_handoff = handoff.get("ready_items") or []
    insight_payload = learning.get("outcome_insights") or {}
    learning_signals = insight_payload.get("top_signals") or []
    qa_decision = (
        "PASS - manual cycle verified"
        if checklist.get("overall_status") == "manual_cycle_verified" and risk.get("block_count", 0) == 0
        else "HOLD - resolve content risk blocks"
        if risk.get("block_count", 0)
        else "CONTINUE - next manual step is open"
    )
    lines = [
        "# DREC Content OS Manual Cycle QA",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this after or during a manual workflow test to see what is proven, what is stuck, and what should happen next.",
        "",
        "## QA Decision",
        "",
        f"- Decision: {qa_decision}",
        f"- Manual cycle: {checklist.get('overall_status')} ({checklist.get('done_count')}/{checklist.get('total_required')} required steps done)",
        f"- Can test now: {'yes' if launch.get('can_test_now') else 'no'}",
        f"- Can use for manual ops: {'yes' if launch.get('can_use_for_manual_ops') else 'no'}",
        f"- Can auto-publish: {'yes' if launch.get('can_auto_publish') else 'no'}",
        f"- Next action: {next_step.get('action') or next_step.get('label') or 'Open Dashboard'}",
        f"- Next detail: {next_step.get('detail') or 'Follow the first open manual test step.'}",
        "",
        "## Step QA",
        "",
    ]
    for step in steps:
        status = step.get("status") or "unknown"
        marker = "[x]" if status == "done" else "[ ]"
        lines.append(f"- {marker} {status}: {step.get('label')} - {step.get('detail')}")
    lines.extend(
        [
            "",
            "## Open Work",
            "",
        ]
    )
    if open_steps:
        for step in open_steps:
            lines.append(f"- Open: {step.get('label')} - {step.get('action')} on {step.get('screen')}.")
    else:
        lines.append("- No open required steps.")
    if locked_steps:
        lines.append("")
        lines.append("Locked steps:")
        for step in locked_steps:
            lines.append(f"- {step.get('label')}: {step.get('detail')}")
    lines.extend(
        [
            "",
            "## Risk QA",
            "",
            f"- Risk status: {risk.get('overall_status')} ({risk.get('block_count', 0)} block / {risk.get('warn_count', 0)} warn)",
            f"- Risk next step: {risk.get('next_step')}",
        ]
    )
    if risk.get("items"):
        for item in risk.get("items")[:15]:
            lines.append(f"- {item.get('severity')}: {item.get('title')} - {item.get('action')}")
    else:
        lines.append("- No active risk items found.")
    lines.extend(
        [
            "",
            "## Publishing Handoff QA",
            "",
            f"- Ready to publish: {len(ready_handoff)}",
            f"- Blocked or needs work: {len(blocked_handoff)}",
        ]
    )
    if ready_handoff:
        for item in ready_handoff[:10]:
            lines.append(f"- Ready: {item.get('channel')} / {item.get('format')} - {item.get('planned_slot') or 'No planned time'}")
    if blocked_handoff:
        for item in blocked_handoff[:10]:
            blockers = ", ".join(item.get("handoff_blockers") or []) or "Needs review"
            lines.append(f"- Blocked: {item.get('channel')} / {item.get('format')} - {blockers}")
    lines.extend(
        [
            "",
            "## Learning QA",
            "",
            f"- Learning summary: {insight_payload.get('summary') or 'No learning insight summary yet.'}",
            f"- Active signals: {len(learning_signals)}",
        ]
    )
    if learning_signals:
        for item in learning_signals[:8]:
            lines.append(
                f"- {item.get('label') or item.get('key')}: avg score {item.get('avg_score', 0)}, "
                f"saves {item.get('saves_total', 0)}, shares {item.get('shares_total', 0)}"
            )
    else:
        lines.append("- Save and roll up manual metrics to create stronger learning signals.")
    lines.extend(
        [
            "",
            "## QA Notes",
            "",
            "- Tester:",
            "- What worked:",
            "- What failed:",
            "- Changes needed before next run:",
            "- Decision owner:",
            "",
            "## Safe Operating Rule",
            "",
            "- Publish manually until Meta readiness and security gates are green.",
            "- Run Risk Audit before external posting.",
            "- Record every manual post ID and metric window so learning stays useful.",
        ]
    )
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-manual-cycle-qa.md"'},
    )


@app.get("/operations/daily-ops-checklist.md")
async def operations_daily_ops_checklist(_: None = Depends(require_access_token)):
    generated_at = datetime.now(timezone.utc).isoformat()
    launch = await launch_readiness_payload()
    checklist = await test_run_checklist_payload()
    automation = await automation_status_payload()
    risk = await content_risk_audit_payload()
    handoff = await publishing_handoff(None)
    learning = await learning_summary(None)
    summary = checklist.get("summary") or {}
    next_step = checklist.get("next_step") or {}
    ready_items = handoff.get("ready_items") or []
    blocked_items = handoff.get("blocked_items") or handoff.get("needs_review") or []
    insight_payload = learning.get("outcome_insights") or {}
    learning_items = (insight_payload.get("top_signals") or [])[:5]
    risk_checked = risk.get("checked") or {}
    lines = [
        "# DREC Content OS Daily Ops Checklist",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this checklist at the start of each operating day. It is read-only and does not change the queue.",
        "",
        *usability_markdown_lines(launch),
        "## Today's Priority",
        "",
        f"- Next action: {next_step.get('action') or next_step.get('label') or 'Open Dashboard'}",
        f"- Detail: {next_step.get('detail') or 'Follow the first open Dashboard Test Path step.'}",
        f"- Automation status: {automation.get('overall_status')}",
        f"- Risk status: {risk.get('overall_status')} ({risk.get('block_count', 0)} block / {risk.get('warn_count', 0)} warn)",
        "",
        "## Morning Checks",
        "",
        "- Open Dashboard and confirm the access token is set.",
        "- Download First Test Kit if this is the first manual workflow run.",
        "- Run Content Risk Audit before any external publishing.",
        "- Open Weekly Plan and make sure there is at least one usable brief.",
        "- Open Assets and approve only safety-clear content.",
        "- Open Review Queue and approve, regenerate, or reject draft queue items.",
        "- Open Scheduler and make sure approved items have planned times.",
        "- Build Publishing Handoff before manual posting.",
        "",
        "## Current Counts",
        "",
        f"- Briefs: {summary.get('brief_count', 0)}",
        f"- Ready assets: {summary.get('ready_assets', 0)}",
        f"- Queue total: {summary.get('queue_total', 0)}",
        f"- Scheduled queue: {summary.get('scheduled_queue', 0)}",
        f"- Handoff ready: {summary.get('handoff_ready', 0)}",
        f"- Overdue scheduled: {risk_checked.get('overdue_scheduled_queue', 0)}",
        f"- Published queue: {summary.get('published_queue', 0)}",
        f"- Metrics: {summary.get('metric_count', 0)}",
        f"- Outcomes: {summary.get('outcome_count', 0)}",
        "",
        "## Ready To Publish Today",
        "",
    ]
    if ready_items:
        for index, item in enumerate(ready_items[:10], start=1):
            lines.extend(
                [
                    f"### {index}. {item.get('channel', 'channel')} / {item.get('format', 'format')}",
                    "",
                    f"- Queue ID: {item.get('id')}",
                    f"- Planned: {item.get('planned_slot') or 'No planned time'}",
                    f"- Caption preview: {(item.get('caption') or '')[:220]}",
                    "",
                ]
            )
    else:
        lines.extend(["- No handoff-ready scheduled items yet.", ""])
    lines.extend(["## Blocked Or Needs Work", ""])
    if blocked_items:
        for index, item in enumerate(blocked_items[:10], start=1):
            blockers = item.get("handoff_blockers") or []
            lines.extend(
                [
                    f"### {index}. {item.get('channel', 'channel')} / {item.get('format', 'format')}",
                    "",
                    f"- Queue ID: {item.get('id')}",
                    f"- Status: {item.get('status')}",
                    f"- Blockers: {', '.join(blockers) or 'Needs review'}",
                    "",
                ]
            )
    else:
        lines.extend(["- No blocked handoff items found.", ""])
    lines.extend(
        [
            "## Learning Prompts",
            "",
        ]
    )
    if learning_items:
        for item in learning_items:
            lines.append(
                f"- {item.get('label') or item.get('key') or 'Insight'}: "
                f"avg score {item.get('avg_score', 0)}, saves {item.get('saves_total', 0)}, shares {item.get('shares_total', 0)}"
            )
    else:
        lines.append(f"- {insight_payload.get('summary') or 'No learning insights yet. Record metrics and build the weekly report.'}")
    lines.extend(
        [
            "",
            "## End-Of-Day Closeout",
            "",
            "- Record Meta post IDs or manual labels for anything published today.",
            "- Enter first available performance metrics under Performance.",
            "- Use Save & Roll Up so the learning loop updates.",
            "- Download Weekly Report, Launch Evidence, and Operator Pack after meaningful changes.",
            "- Keep Meta automation off until Meta readiness and Supabase security gates are green.",
        ]
    )
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-daily-ops-checklist.md"'},
    )


@app.get("/operations/weekly-cycle-pack.md")
async def operations_weekly_cycle_pack(_: None = Depends(require_access_token)):
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    launch = await launch_readiness_payload()
    checklist = await test_run_checklist_payload()
    workflow = await workflow_status(None)
    risk = await content_risk_audit_payload()
    learning = await learning_summary(None)
    handoff = await publishing_handoff(None)
    briefs = await snapshot_select(
        "content_briefs",
        """
        select id, topic, channel, format, status, funnel_stage, awareness_stage, hook_primary, compliance_notes, created_at
        from content_briefs
        order by created_at desc
        limit 12
        """,
        {
            "select": "id,topic,channel,format,status,funnel_stage,awareness_stage,hook_primary,compliance_notes,created_at",
            "order": "created_at.desc",
            "limit": "12",
        },
    )
    assets = await snapshot_select(
        "assets",
        """
        select id, channel, format, review_status, compliance_status, media_urls, caption, created_at
        from assets
        order by created_at desc
        limit 12
        """,
        {
            "select": "id,channel,format,review_status,compliance_status,media_urls,caption,created_at",
            "order": "created_at.desc",
            "limit": "12",
        },
    )
    queue = await snapshot_select(
        "publish_queue",
        """
        select id, channel, format, status, compliance_status, planned_slot, external_post_id, caption, created_at
        from publish_queue
        order by planned_slot nulls last, created_at desc
        limit 12
        """,
        {
            "select": "id,channel,format,status,compliance_status,planned_slot,external_post_id,caption,created_at",
            "order": "planned_slot.asc.nullslast,created_at.desc",
            "limit": "12",
        },
    )
    summary = checklist.get("summary") or {}
    next_action = (workflow.get("workflow") or {}).get("next_action") or workflow.get("next_action") or {}
    plan_topics = learning.get("plan_recommendations", {}).get("topics", [])
    insights = learning.get("outcome_insights") or {}
    top_signals = insights.get("top_signals") or []
    risk_items = risk.get("items") or []
    ready_items = handoff.get("ready_items") or []
    blocked_items = handoff.get("blocked_items") or handoff.get("needs_review") or []
    brief_lines = report_lines(
        briefs,
        lambda item: f"{item.get('status', 'draft')} · {item.get('channel', 'channel')}/{item.get('format', 'format')} · {item.get('topic')} · hook: {item.get('hook_primary') or 'n/a'}",
        "No weekly briefs available. Generate a weekly plan first.",
    )
    asset_lines = report_lines(
        assets,
        lambda item: f"{item.get('review_status', 'review')} / {item.get('compliance_status', 'safety')} · {item.get('channel', 'channel')}/{item.get('format', 'format')} · media {len(item.get('media_urls') or [])} · {(item.get('caption') or '')[:120]}",
        "No draft assets available. Save briefs as assets first.",
    )
    queue_lines = report_lines(
        queue,
        lambda item: f"{item.get('status', 'status')} / {item.get('compliance_status', 'safety')} · {item.get('channel', 'channel')}/{item.get('format', 'format')} · planned {item.get('planned_slot') or 'not set'} · external {item.get('external_post_id') or 'not posted'}",
        "No queue items available. Queue approved assets first.",
    )
    ready_lines = report_lines(
        ready_items,
        lambda item: f"{item.get('channel', 'channel')}/{item.get('format', 'format')} · planned {item.get('planned_slot') or 'not set'} · queue {item.get('id')}",
        "No handoff-ready items yet.",
    )
    blocked_lines = report_lines(
        blocked_items,
        lambda item: f"{item.get('channel', 'channel')}/{item.get('format', 'format')} · {', '.join(item.get('handoff_blockers') or ['Needs review'])}",
        "No blocked handoff items found.",
    )
    topic_lines = [f"- {topic}" for topic in plan_topics] or ["- No learning topics yet. Record outcomes or use the default weekly plan topics."]
    insight_lines = report_lines(
        top_signals,
        lambda item: f"{item.get('label')} · avg score {item.get('avg_score')} · saves {item.get('saves_total')} · {item.get('recommendation')}",
        "No outcome insights yet.",
    )
    risk_lines = [
        f"- [{item.get('severity')}] {item.get('kind')} {item.get('id')}: {item.get('title')} — {item.get('action')}"
        for item in risk_items[:12]
    ] or ["- No current risk items found."]
    lines = [
        "# DREC Content OS Weekly Cycle Pack",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this pack to run one planning-to-learning content cycle without switching between exports.",
        "",
        *usability_markdown_lines(launch),
        "## Cycle Status",
        "",
        f"- Manual cycle: {checklist.get('overall_status')} ({checklist.get('done_count', 0)}/{checklist.get('total_required', 0)} required steps done)",
        f"- Next action: {next_action.get('title') or 'Open Dashboard'} — {next_action.get('body') or checklist.get('next_step', {}).get('detail') or 'Follow the first open step.'}",
        f"- Briefs: {summary.get('brief_count', 0)}",
        f"- Ready assets: {summary.get('ready_assets', 0)}",
        f"- Queue total: {summary.get('queue_total', 0)}",
        f"- Scheduled queue: {summary.get('scheduled_queue', 0)}",
        f"- Handoff ready: {handoff.get('ready_count', 0)}",
        f"- Published queue: {summary.get('published_queue', 0)}",
        f"- Outcomes: {summary.get('outcome_count', 0)}",
        f"- Risk: {risk.get('overall_status')} ({risk.get('block_count', 0)} block / {risk.get('warn_count', 0)} warn)",
        "",
        "## 1. Planning Inputs",
        "",
        "Recommended next topics:",
        "",
        *topic_lines,
        "",
        "Recent briefs:",
        "",
        *brief_lines,
        "",
        "## 2. Production And Review",
        "",
        *asset_lines,
        "",
        "## 3. Schedule And Handoff",
        "",
        "Queue snapshot:",
        "",
        *queue_lines,
        "",
        "Ready for manual publishing:",
        "",
        *ready_lines,
        "",
        "Blocked handoff items:",
        "",
        *blocked_lines,
        "",
        "## 4. Learning Closeout",
        "",
        f"- Learning recommendation: {learning.get('recommendation')}",
        f"- Outcome summary: {insights.get('summary') or 'No outcome summary yet.'}",
        "",
        *insight_lines,
        "",
        "## 5. Risk And Safety",
        "",
        *risk_lines,
        "",
        "## Weekly Closeout Rule",
        "",
        "- Do not enable real Meta workers from this pack. Use Meta Setup and Launch Evidence for go-live gates.",
        "- End the week only after posted items have external post IDs, metrics are entered, and next topics are sent back to Weekly Plan.",
        "- Archive drafted briefs after assets are saved so the next weekly plan stays focused.",
        "",
    ]
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-weekly-cycle-pack.md"'},
    )


@app.get("/operations/metrics-template.csv")
async def operations_metrics_template(_: None = Depends(require_access_token)):
    source = await published_metric_source(10, None)
    output = StringIO()
    fieldnames = [
        "row_type",
        "source",
        "external_post_id",
        "captured_at",
        "reach",
        "likes",
        "comments",
        "saves",
        "shares",
        "leads",
        "spend",
        "format",
        "channel",
        "funnel_stage",
        "metric_window",
        "notes",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    candidates = source.get("candidates") or []
    if candidates:
        for item in candidates[:10]:
            writer.writerow(
                {
                    "row_type": "published_candidate",
                    "source": item.get("channel") or "manual",
                    "external_post_id": item.get("external_post_id") or "",
                    "captured_at": datetime.now(timezone.utc).isoformat(),
                    "reach": "",
                    "likes": "",
                    "comments": "",
                    "saves": "",
                    "shares": "",
                    "leads": "",
                    "spend": "",
                    "format": item.get("format") or "",
                    "channel": item.get("channel") or "",
                    "funnel_stage": "TOFU",
                    "metric_window": "7d",
                    "notes": (item.get("caption") or "")[:160],
                }
            )
    else:
        writer.writerow(
            {
                "row_type": "sample",
                "source": "manual",
                "external_post_id": "manual-test-001",
                "captured_at": datetime.now(timezone.utc).isoformat(),
                "reach": "1000",
                "likes": "35",
                "comments": "5",
                "saves": "12",
                "shares": "8",
                "leads": "1",
                "spend": "0",
                "format": "carousel",
                "channel": "manual",
                "funnel_stage": "TOFU",
                "metric_window": "7d",
                "notes": "Example row for first manual workflow test.",
            }
        )
    writer.writerow(
        {
            "row_type": "instructions",
            "source": "Allowed: facebook, instagram, manual, ads",
            "external_post_id": "Required. Use Meta post ID or a manual label.",
            "captured_at": "ISO timestamp. Leave as generated or replace after capture.",
            "reach": "Number",
            "likes": "Number",
            "comments": "Number",
            "saves": "Number",
            "shares": "Number",
            "leads": "Number",
            "spend": "Number, use 0 for organic/manual",
            "format": "carousel, single, reel, or story",
            "channel": "facebook, instagram, or manual",
            "funnel_stage": "TOFU, MOFU, or BOFU",
            "metric_window": "7d, 28d, or 90d",
            "notes": "Paste notes into outcome vs_plan_note if useful.",
        }
    )
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="drec-metrics-template.csv"'},
    )


async def recent_raw_metrics(limit: int = 25):
    bounded_limit = max(1, min(int(limit or 25), 100))
    rows = await fetch_rows(
        """
        select id, source, external_post_id, captured_at, metrics, created_at
        from raw_metrics
        order by captured_at desc nulls last, created_at desc
        limit $1
        """,
        bounded_limit,
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "raw_metrics",
            {
                "select": "id,source,external_post_id,captured_at,metrics,created_at",
                "order": "captured_at.desc.nullslast,created_at.desc",
                "limit": str(bounded_limit),
            },
        )
    return rows


async def recent_outcome_rows(limit: int = 25):
    bounded_limit = max(1, min(int(limit or 25), 100))
    rows = await fetch_rows(
        """
        select id, post_id, format, channel, metric_window, score, shares, saves, cpl, vs_plan_note, created_at
        from outcomes
        order by created_at desc
        limit $1
        """,
        bounded_limit,
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "outcomes",
            {
                "select": "id,post_id,format,channel,metric_window,score,shares,saves,cpl,vs_plan_note,created_at",
                "order": "created_at.desc",
                "limit": str(bounded_limit),
            },
        )
    return rows


def closeout_metric_summary(metrics: dict):
    metrics = metrics or {}
    keys = ["reach", "impressions", "likes", "comments", "saves", "shares", "leads", "spend"]
    parts = [f"{key}={metrics.get(key)}" for key in keys if metrics.get(key) not in {None, ""}]
    return ", ".join(parts) or "No numeric metrics recorded."


@app.get("/operations/metrics-closeout-pack.md")
async def operations_metrics_closeout_pack(_: None = Depends(require_access_token)):
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    candidates = await meta_metric_candidates(None, 50)
    raw_rows = await recent_raw_metrics(50)
    outcome_rows = await recent_outcome_rows(50)
    raw_post_ids = {str(row.get("external_post_id")) for row in raw_rows if row.get("external_post_id")}
    outcome_post_ids = {str(row.get("post_id")) for row in outcome_rows if row.get("post_id")}
    waiting_for_metrics = [
        item
        for item in candidates
        if item.get("external_post_id") and str(item.get("external_post_id")) not in raw_post_ids
    ]
    waiting_for_rollup = [
        row
        for row in raw_rows
        if row.get("external_post_id") and str(row.get("external_post_id")) not in outcome_post_ids
    ]
    completed = [
        row
        for row in outcome_rows
        if row.get("post_id") in raw_post_ids or not raw_rows
    ]
    lines = [
        "# DREC Content OS Metrics Closeout Pack",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this pack after manual publishing to close the learning loop. It is read-only and does not import metrics or create outcomes.",
        "",
        "## Closeout Sequence",
        "",
        "1. Confirm published posts have a Meta post ID or manual label recorded.",
        "2. Download the Metrics Template and fill reach, likes, comments, saves, shares, leads, and spend.",
        "3. Preview the metrics CSV before import.",
        "4. Import with Roll up enabled when the numbers look correct.",
        "5. Download Weekly Report and use learning recommendations in the next Weekly Plan.",
        "",
        "## Current Counts",
        "",
        f"- Published candidates scanned: {len(candidates)}",
        f"- Waiting for raw metrics: {len(waiting_for_metrics)}",
        f"- Raw metrics waiting for outcome rollup: {len(waiting_for_rollup)}",
        f"- Recent outcomes available: {len(outcome_rows)}",
        "",
        "## Waiting For Metrics",
        "",
    ]
    if waiting_for_metrics:
        for index, item in enumerate(waiting_for_metrics[:30], start=1):
            lines.extend(
                [
                    f"### {index}. {item.get('channel')} / {item.get('format')}",
                    "",
                    f"- Queue ID: {item.get('id')}",
                    f"- External post ID: {item.get('external_post_id')}",
                    f"- Published/updated: {item.get('updated_at') or item.get('created_at') or 'unknown'}",
                    f"- Action: Add this row to Metrics Template, then Preview CSV.",
                    f"- Caption preview: {feedback_excerpt(item.get('caption'), 180)}",
                    "",
                ]
            )
    else:
        lines.extend(["- No published Facebook/Instagram candidates are waiting for raw metrics.", ""])
    lines.extend(["## Raw Metrics Waiting For Rollup", ""])
    if waiting_for_rollup:
        for index, row in enumerate(waiting_for_rollup[:30], start=1):
            lines.extend(
                [
                    f"### {index}. {row.get('external_post_id')}",
                    "",
                    f"- Source: {row.get('source')}",
                    f"- Captured: {row.get('captured_at') or row.get('created_at')}",
                    f"- Metrics: {closeout_metric_summary(row.get('metrics') or {})}",
                    f"- Action: Use Save & Roll Up or import CSV with rollup enabled.",
                    "",
                ]
            )
    else:
        lines.extend(["- No raw metrics are waiting for outcome rollup.", ""])
    lines.extend(["## Recent Learning Outcomes", ""])
    if completed:
        for index, row in enumerate(completed[:30], start=1):
            lines.extend(
                [
                    f"### {index}. {row.get('post_id')}",
                    "",
                    f"- Channel / format: {row.get('channel')} / {row.get('format')}",
                    f"- Window: {row.get('metric_window')}",
                    f"- Score: {row.get('score')}",
                    f"- Saves / shares: {row.get('saves')} / {row.get('shares')}",
                    f"- Note: {row.get('vs_plan_note') or 'No note'}",
                    "",
                ]
            )
    else:
        lines.extend(["- No recent learning outcomes yet.", ""])
    lines.extend(
        [
            "## Closeout Rules",
            "",
            "- Use real post IDs when available; use manual labels only for first-test evidence.",
            "- Keep spend at 0 for organic/manual posts unless paid spend was used.",
            "- Roll up only after preview looks correct.",
            "- Learning recommendations become useful only after outcomes exist.",
            "",
        ]
    )
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-metrics-closeout-pack.md"'},
    )


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


def pipeline_id(value):
    return str(value) if value else ""


def audit_tags(session=None):
    if not isinstance(session, dict):
        return []
    tags = []
    role = session.get("role")
    actor = session.get("actor")
    if role:
        tags.append(f"role:{role}")
    if actor:
        tags.append(f"actor:{actor}")
    return tags


def pipeline_latest(items, key):
    latest = {}
    for item in items:
        item_key = pipeline_id(item.get(key))
        if item_key and item_key not in latest:
            latest[item_key] = item
    return latest


def pipeline_status(brief=None, asset=None, queue_item=None, raw_metric=None, outcome=None):
    if not asset:
        return "brief_to_asset", "Save Asset", "Brief has no saved creative asset yet."

    asset_review = str(asset.get("review_status") or "")
    asset_safety = str(asset.get("compliance_status") or "")
    if asset_review != "approved" or asset_safety != "clear":
        return "asset_review", "Run safety review and approve clear asset", f"Asset is {asset_review or 'draft'} / {asset_safety or 'pending'}."

    if not queue_item:
        return "queue", "Add approved asset to queue", "Approved clear asset is not in the publishing queue."

    queue_status = str(queue_item.get("status") or "")
    queue_safety = str(queue_item.get("compliance_status") or "")
    feedback = queue_item.get("latest_feedback") or {}
    feedback_action = str(feedback.get("action") or "")
    if queue_safety != "clear" or (queue_status == "draft" and feedback_action != "approve"):
        return "queue_review", "Approve in Review Queue or request rewrite", f"Queue is {queue_status or 'draft'} / {queue_safety or 'pending'}."

    if queue_status == "draft":
        return "schedule", "Schedule approved item", "Queue item is approved and ready for a planned slot."

    if queue_status in {"scheduled", "publishing"} and not queue_item.get("external_post_id"):
        return "manual_handoff", "Build handoff and record post ID", "Scheduled item has no external post ID yet."

    if queue_status == "published" and not raw_metric:
        return "metrics", "Add or import metrics", "Published item is waiting for performance metrics."

    if raw_metric and not outcome:
        return "learning_rollup", "Roll up metrics into learning", "Raw metrics exist but no learning outcome is saved yet."

    if outcome:
        return "complete", "Use learning insight", "Learning outcome is available for future planning."

    return "publish_followup", "Check publishing status", "Queue item needs operator follow-up."


def pipeline_row(brief=None, asset=None, queue_item=None, raw_metric=None, outcome=None):
    stage, next_action, detail = pipeline_status(brief, asset, queue_item, raw_metric, outcome)
    return {
        "pipeline_stage": stage,
        "next_action": next_action,
        "brief_id": pipeline_id((brief or {}).get("id") or (asset or {}).get("brief_id") or (outcome or {}).get("brief_id")),
        "topic": (brief or {}).get("topic") or "",
        "brief_status": (brief or {}).get("status") or "",
        "asset_id": pipeline_id((asset or {}).get("id") or (queue_item or {}).get("asset_id") or (outcome or {}).get("asset_id")),
        "asset_review_status": (asset or {}).get("review_status") or "",
        "asset_safety_status": (asset or {}).get("compliance_status") or "",
        "queue_id": pipeline_id((queue_item or {}).get("id")),
        "queue_status": (queue_item or {}).get("status") or "",
        "queue_safety_status": (queue_item or {}).get("compliance_status") or "",
        "planned_slot": str((queue_item or {}).get("planned_slot") or ""),
        "external_post_id": (queue_item or {}).get("external_post_id") or (raw_metric or {}).get("external_post_id") or (outcome or {}).get("post_id") or "",
        "raw_metric_status": "captured" if raw_metric else "",
        "outcome_status": "saved" if outcome else "",
        "score": str((outcome or {}).get("score") or ""),
        "channel": (queue_item or {}).get("channel") or (asset or {}).get("channel") or (brief or {}).get("channel") or (outcome or {}).get("channel") or "",
        "format": (queue_item or {}).get("format") or (asset or {}).get("format") or (brief or {}).get("format") or (outcome or {}).get("format") or "",
        "funnel_stage": (brief or {}).get("funnel_stage") or (outcome or {}).get("funnel_stage") or "",
        "created_at": str((brief or asset or queue_item or raw_metric or outcome or {}).get("created_at") or ""),
        "detail": detail,
    }


@app.get("/operations/pipeline-board.csv")
async def operations_pipeline_board_csv(_: None = Depends(require_access_token)):
    briefs = await snapshot_select(
        "content_briefs",
        """
        select id, topic, channel, format, status, funnel_stage, created_at
        from content_briefs
        order by created_at desc
        limit 300
        """,
        {"select": "id,topic,channel,format,status,funnel_stage,created_at", "order": "created_at.desc", "limit": "300"},
    )
    assets = await snapshot_select(
        "assets",
        """
        select id, brief_id, channel, format, compliance_status, review_status, caption, created_at
        from assets
        order by created_at desc
        limit 300
        """,
        {"select": "id,brief_id,channel,format,compliance_status,review_status,caption,created_at", "order": "created_at.desc", "limit": "300"},
    )
    queue_items = await fetch_publish_queue_items(200)
    raw_metrics = await snapshot_select(
        "raw_metrics",
        """
        select id, source, external_post_id, captured_at, metrics, created_at
        from raw_metrics
        order by captured_at desc
        limit 300
        """,
        {"select": "id,source,external_post_id,captured_at,metrics,created_at", "order": "captured_at.desc", "limit": "300"},
    )
    outcomes = await snapshot_select(
        "outcomes",
        """
        select id, brief_id, asset_id, post_id, channel, format, funnel_stage, metric_window, score, saves, shares, created_at
        from outcomes
        order by created_at desc
        limit 300
        """,
        {"select": "id,brief_id,asset_id,post_id,channel,format,funnel_stage,metric_window,score,saves,shares,created_at", "order": "created_at.desc", "limit": "300"},
    )

    asset_by_brief = pipeline_latest(assets, "brief_id")
    asset_by_id = {pipeline_id(item.get("id")): item for item in assets if item.get("id")}
    queue_by_asset = pipeline_latest(queue_items, "asset_id")
    metric_by_post = pipeline_latest(raw_metrics, "external_post_id")
    outcome_by_asset = pipeline_latest(outcomes, "asset_id")
    outcome_by_brief = pipeline_latest(outcomes, "brief_id")
    outcome_by_post = pipeline_latest(outcomes, "post_id")

    rows = []
    seen_assets = set()
    seen_queue = set()
    seen_outcomes = set()
    for brief in briefs:
        asset = asset_by_brief.get(pipeline_id(brief.get("id")))
        queue_item = queue_by_asset.get(pipeline_id((asset or {}).get("id")))
        raw_metric = metric_by_post.get(pipeline_id((queue_item or {}).get("external_post_id")))
        outcome = (
            outcome_by_asset.get(pipeline_id((asset or {}).get("id")))
            or outcome_by_brief.get(pipeline_id(brief.get("id")))
            or outcome_by_post.get(pipeline_id((queue_item or {}).get("external_post_id")))
        )
        rows.append(pipeline_row(brief, asset, queue_item, raw_metric, outcome))
        if asset:
            seen_assets.add(pipeline_id(asset.get("id")))
        if queue_item:
            seen_queue.add(pipeline_id(queue_item.get("id")))
        if outcome:
            seen_outcomes.add(pipeline_id(outcome.get("id")))

    for asset in assets:
        asset_id = pipeline_id(asset.get("id"))
        if asset_id in seen_assets:
            continue
        queue_item = queue_by_asset.get(asset_id)
        raw_metric = metric_by_post.get(pipeline_id((queue_item or {}).get("external_post_id")))
        outcome = outcome_by_asset.get(asset_id) or outcome_by_brief.get(pipeline_id(asset.get("brief_id"))) or outcome_by_post.get(pipeline_id((queue_item or {}).get("external_post_id")))
        rows.append(pipeline_row(None, asset, queue_item, raw_metric, outcome))
        if queue_item:
            seen_queue.add(pipeline_id(queue_item.get("id")))
        if outcome:
            seen_outcomes.add(pipeline_id(outcome.get("id")))

    for queue_item in queue_items:
        queue_id = pipeline_id(queue_item.get("id"))
        if queue_id in seen_queue:
            continue
        asset = asset_by_id.get(pipeline_id(queue_item.get("asset_id")))
        raw_metric = metric_by_post.get(pipeline_id(queue_item.get("external_post_id")))
        outcome = outcome_by_asset.get(pipeline_id((asset or {}).get("id"))) or outcome_by_post.get(pipeline_id(queue_item.get("external_post_id")))
        rows.append(pipeline_row(None, asset, queue_item, raw_metric, outcome))
        if outcome:
            seen_outcomes.add(pipeline_id(outcome.get("id")))

    for outcome in outcomes:
        outcome_id = pipeline_id(outcome.get("id"))
        if outcome_id in seen_outcomes:
            continue
        rows.append(pipeline_row(None, None, None, None, outcome))

    output = StringIO()
    fieldnames = [
        "pipeline_stage",
        "next_action",
        "brief_id",
        "topic",
        "brief_status",
        "asset_id",
        "asset_review_status",
        "asset_safety_status",
        "queue_id",
        "queue_status",
        "queue_safety_status",
        "planned_slot",
        "external_post_id",
        "raw_metric_status",
        "outcome_status",
        "score",
        "channel",
        "format",
        "funnel_stage",
        "created_at",
        "detail",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="drec-content-pipeline-board.csv"'},
    )


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


def audit_tag_value(tags, prefix):
    for tag in tags or []:
        if isinstance(tag, str) and tag.startswith(prefix):
            return tag[len(prefix) :].strip()
    return ""


@app.get("/operations/audit-trail.csv")
async def operations_audit_trail_csv(_: None = Depends(require_access_token)):
    feedback = await snapshot_select(
        "feedback",
        """
        select id, module, ref_type, ref_id, action, reason, tags, created_at
        from feedback
        order by created_at desc
        limit 500
        """,
        {
            "select": "id,module,ref_type,ref_id,action,reason,tags,created_at",
            "order": "created_at.desc",
            "limit": "500",
        },
    )
    rows = []
    for item in feedback:
        tags = item.get("tags") or []
        rows.append(
            {
                "created_at": str(item.get("created_at") or ""),
                "module": item.get("module") or "",
                "ref_type": item.get("ref_type") or "",
                "ref_id": item.get("ref_id") or "",
                "action": item.get("action") or "",
                "role": audit_tag_value(tags, "role:"),
                "actor": audit_tag_value(tags, "actor:"),
                "tags": "; ".join(str(tag) for tag in tags),
                "reason": item.get("reason") or "",
                "feedback_id": str(item.get("id") or ""),
            }
        )
    output = StringIO()
    fieldnames = ["created_at", "module", "ref_type", "ref_id", "action", "role", "actor", "tags", "reason", "feedback_id"]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="drec-audit-trail.csv"'},
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


def asset_visual_direction(asset: dict):
    metadata = asset.get("metadata") or {}
    slides = metadata.get("slides") or []
    script = metadata.get("reel_script") or []
    visual_notes = [slide.get("visual_note") for slide in slides if slide.get("visual_note")]
    if visual_notes:
        return " | ".join(visual_notes[:4])
    if script:
        beats = [beat.get("beat") or beat.get("line") for beat in script if beat.get("beat") or beat.get("line")]
        return "Reel beats: " + " | ".join(beats[:4]) if beats else "Short educational talking-head reel with clean subtitle space."
    if asset.get("format") == "single":
        return "One clear educational image or clinic-safe visual with room for short headline text."
    if asset.get("format") == "story":
        return "Vertical story sequence with question/poll-friendly framing and minimal text."
    return "DREC navy/teal carousel with clear page hierarchy and no tiny medical text baked into the image."


def asset_shot_list(asset: dict):
    fmt = asset.get("format")
    metadata = asset.get("metadata") or {}
    topic = metadata.get("topic") or "metabolic education"
    if fmt == "reel":
        return f"1 vertical presenter clip; 1 simple B-roll cutaway for {topic}; optional metric/food/clinic close-up."
    if fmt in {"carousel", "story"}:
        slides = metadata.get("slides") or []
        count = len(slides) or (5 if fmt == "carousel" else 3)
        return f"{count} visual frame(s): cover, 2-3 explanation frames, final save/consult prompt."
    return "1 primary visual; optional supporting crop for story repost."


def asset_media_gap(asset: dict):
    media_count = len([url for url in asset.get("media_urls") or [] if url])
    if media_count:
        return "Media attached; verify rights, crop, and medical context before publishing."
    fmt = asset.get("format")
    if fmt == "reel":
        return "Needs vertical video or approved clinic/presenter footage."
    if fmt in {"carousel", "story", "single"}:
        return "Needs approved image/design export before publishing."
    return "Confirm whether this format needs an approved visual asset."


@app.get("/operations/media-shot-list.csv")
async def operations_media_shot_list_csv(_: None = Depends(require_access_token)):
    assets = await fetch_asset_list(200)
    active_assets = [asset for asset in assets if asset.get("review_status") != "rejected"]
    output = StringIO()
    fieldnames = [
        "asset_id",
        "topic",
        "channel",
        "format",
        "review_status",
        "safety_status",
        "media_count",
        "production_priority",
        "visual_direction",
        "shot_list",
        "media_gap",
        "rights_check",
        "caption_preview",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for asset in active_assets:
        metadata = asset.get("metadata") or {}
        media_urls = [url for url in asset.get("media_urls") or [] if url]
        blockers = asset_review_blockers(asset)
        if asset.get("review_status") == "approved" and asset.get("compliance_status") == "clear":
            priority = "ready_for_design_or_queue"
        elif blockers:
            priority = "needs_safety_review_before_design"
        else:
            priority = "draft_ready_for_visual_planning"
        writer.writerow(
            {
                "asset_id": asset.get("id") or "",
                "topic": metadata.get("topic") or "",
                "channel": asset.get("channel") or "",
                "format": asset.get("format") or "",
                "review_status": asset.get("review_status") or "",
                "safety_status": asset.get("compliance_status") or "",
                "media_count": len(media_urls),
                "production_priority": priority,
                "visual_direction": asset_visual_direction(asset),
                "shot_list": asset_shot_list(asset),
                "media_gap": asset_media_gap(asset),
                "rights_check": "Use only owned, licensed, stock-cleared, or patient-consented media. Avoid patient-identifiable content without explicit consent.",
                "caption_preview": feedback_excerpt(asset.get("caption"), 180),
            }
        )
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="drec-media-shot-list.csv"'},
    )


async def fetch_media_asset_list(limit: int = 100):
    bounded_limit = max(1, min(int(limit or 100), 200))
    rows = await fetch_rows(
        """
        select id, title, source_url, media_type, rights_status, approval_status,
               notes, tags, metadata, created_at
        from media_assets
        order by created_at desc
        limit $1
        """,
        bounded_limit,
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "media_assets",
            {
                "select": "id,title,source_url,media_type,rights_status,approval_status,notes,tags,metadata,created_at",
                "order": "created_at.desc",
                "limit": str(bounded_limit),
            },
        )
    return rows


def asset_review_blockers(asset: dict):
    blockers = []
    if asset.get("review_status") != "approved":
        blockers.append("Needs asset approval.")
    if asset.get("compliance_status") != "clear":
        blockers.append("Needs compliance clear.")
    if not (asset.get("caption") or "").strip():
        blockers.append("Needs caption.")
    return blockers


def media_review_blockers(media: dict):
    blockers = []
    if media.get("approval_status") != "approved":
        blockers.append("Needs media approval.")
    if media.get("rights_status") not in {"owned", "licensed", "partner"}:
        blockers.append("Needs usable rights status.")
    if not media.get("source_url"):
        blockers.append("Needs source URL or storage reference.")
    return blockers


def asset_review_decision_import_lines():
    return [
        "## Review Decision CSV Import",
        "",
        "- Download `drec-asset-review-decisions.csv` from Assets.",
        "- Fill `reviewer_safety_decision` with `clear`, `pending`, or `flagged`.",
        "- Fill `reviewer_review_decision` with `approved`, `review`, or `rejected`.",
        "- Add `reviewer_name` and `review_notes` for the audit trail.",
        "- Use Preview Decisions before Import Decisions when the frontend button is available.",
        "- Import updates asset safety/review status only; it does not queue, schedule, or publish.",
        "- Approval is rejected unless safety is already clear or the same row marks safety as clear.",
        "",
    ]


@app.get("/operations/asset-review.csv")
async def operations_asset_review_csv(_: None = Depends(require_access_token)):
    assets = await fetch_asset_list(200)
    media_assets = await fetch_media_asset_list(200)
    output = StringIO()
    fieldnames = [
        "record_type",
        "id",
        "status",
        "ready",
        "blockers",
        "channel",
        "format",
        "title_or_topic",
        "review_status",
        "compliance_status",
        "media_type",
        "rights_status",
        "approval_status",
        "media_count",
        "source_or_media_urls",
        "notes",
        "created_at",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for asset in assets:
        blockers = asset_review_blockers(asset)
        metadata = asset.get("metadata") or {}
        writer.writerow(
            {
                "record_type": "asset",
                "id": asset.get("id") or "",
                "status": f"{asset.get('review_status') or ''}/{asset.get('compliance_status') or ''}",
                "ready": "yes" if not blockers else "no",
                "blockers": "; ".join(blockers),
                "channel": asset.get("channel") or "",
                "format": asset.get("format") or "",
                "title_or_topic": metadata.get("topic") or (asset.get("caption") or "")[:80],
                "review_status": asset.get("review_status") or "",
                "compliance_status": asset.get("compliance_status") or "",
                "media_type": "",
                "rights_status": "",
                "approval_status": "",
                "media_count": len([url for url in asset.get("media_urls") or [] if url]),
                "source_or_media_urls": "\n".join([url for url in asset.get("media_urls") or [] if url]),
                "notes": metadata.get("target_signal") or "",
                "created_at": asset.get("created_at") or "",
            }
        )
    for media in media_assets:
        blockers = media_review_blockers(media)
        writer.writerow(
            {
                "record_type": "media",
                "id": media.get("id") or "",
                "status": f"{media.get('approval_status') or ''}/{media.get('rights_status') or ''}",
                "ready": "yes" if not blockers else "no",
                "blockers": "; ".join(blockers),
                "channel": "",
                "format": "",
                "title_or_topic": media.get("title") or "",
                "review_status": "",
                "compliance_status": "",
                "media_type": media.get("media_type") or "",
                "rights_status": media.get("rights_status") or "",
                "approval_status": media.get("approval_status") or "",
                "media_count": 1 if media.get("source_url") else 0,
                "source_or_media_urls": media.get("source_url") or "",
                "notes": media.get("notes") or "",
                "created_at": media.get("created_at") or "",
            }
        )
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="drec-asset-review.csv"'},
    )


@app.get("/operations/asset-review-worklist.md")
async def operations_asset_review_worklist(_: None = Depends(require_access_token)):
    generated_at = datetime.now(timezone.utc).isoformat()
    briefs = await fetch_content_brief_list(100)
    assets = await fetch_asset_list(200)
    assets_by_brief = {str(asset.get("brief_id")): asset for asset in assets if asset.get("brief_id")}
    unsaved_briefs = [
        brief
        for brief in briefs
        if brief.get("status") not in {"drafted", "archived"}
        and str(brief.get("id")) not in assets_by_brief
    ]
    needs_review = [
        asset
        for asset in assets
        if asset.get("review_status") != "rejected" and asset_review_blockers(asset)
    ]
    ready_to_queue = [
        asset
        for asset in assets
        if asset.get("review_status") == "approved" and asset.get("compliance_status") == "clear"
    ]
    lines = [
        "# DREC Content OS Asset Review Worklist",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this as the working sheet for turning weekly briefs into queue-ready assets. It is read-only and does not change records.",
        "",
        "## Decision",
        "",
        f"- Unsaved briefs: {len(unsaved_briefs)}",
        f"- Assets needing review: {len(needs_review)}",
        f"- Ready to queue: {len(ready_to_queue)}",
        "- Next action: Save Asset from Weekly Plan." if unsaved_briefs else "- Next action: Review and queue approved clear assets.",
        "",
        "## Briefs To Save As Assets",
        "",
    ]
    if unsaved_briefs:
        for index, brief in enumerate(unsaved_briefs[:20], start=1):
            lines.extend(
                [
                    f"### {index}. {brief.get('topic') or 'Untitled brief'}",
                    "",
                    f"- Brief ID: {brief.get('id')}",
                    f"- Format: {brief.get('format')}",
                    f"- Funnel stage: {brief.get('funnel_stage') or 'n/a'}",
                    f"- Hook: {brief.get('hook_primary') or 'No hook'}",
                    f"- Action: Open Weekly Plan and click Save Asset.",
                    "",
                ]
            )
    else:
        lines.extend(["- No unsaved active briefs found.", ""])
    lines.extend(["## Assets Needing Review", ""])
    if needs_review:
        for index, asset in enumerate(needs_review[:30], start=1):
            metadata = asset.get("metadata") or {}
            blockers = asset_review_blockers(asset)
            lines.extend(
                [
                    f"### {index}. {metadata.get('topic') or asset.get('format') or 'Untitled asset'}",
                    "",
                    f"- Asset ID: {asset.get('id')}",
                    f"- Review: {asset.get('review_status')}",
                    f"- Safety: {asset.get('compliance_status')}",
                    f"- Blockers: {', '.join(blockers) or 'None'}",
                    f"- Action: Mark Safety Clear and Approve only after human review.",
                    "",
                ]
            )
    else:
        lines.extend(["- No active assets need review.", ""])
    lines.extend(["## Ready To Queue", ""])
    if ready_to_queue:
        for index, asset in enumerate(ready_to_queue[:30], start=1):
            metadata = asset.get("metadata") or {}
            lines.extend(
                [
                    f"### {index}. {metadata.get('topic') or asset.get('format') or 'Untitled asset'}",
                    "",
                    f"- Asset ID: {asset.get('id')}",
                    f"- Channel: {asset.get('channel')}",
                    f"- Format: {asset.get('format')}",
                    f"- Media count: {len([url for url in asset.get('media_urls') or [] if url])}",
                    "- Action: Add To Queue, then approve and schedule from Review Queue/Scheduler.",
                    "",
                ]
            )
    else:
        lines.extend(["- No approved clear assets are ready to queue yet.", ""])
    lines.extend(
        [
            "## Review Rules",
            "",
            "- Do not queue rejected assets.",
            "- Do not queue pending or flagged safety items.",
            "- Add approved media before publishing if the format needs a visual.",
            "- Keep Meta automation off; use manual handoff until credential gates are green.",
        ]
    )
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-asset-review-worklist.md"'},
    )


@app.get("/operations/asset-safety-review.md")
async def operations_asset_safety_review(_: None = Depends(require_access_token)):
    generated_at = datetime.now(timezone.utc).isoformat()
    assets = await fetch_asset_list(100)
    active_assets = [asset for asset in assets if asset.get("review_status") != "rejected"]
    review_assets = [
        asset
        for asset in active_assets
        if asset.get("review_status") != "approved" or asset.get("compliance_status") != "clear"
    ]
    lines = [
        "# DREC Content OS Asset Safety Review Pack",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this pack for human safety review before any asset is approved, queued, scheduled, or published. It is read-only and does not change records.",
        "",
        "## Review Summary",
        "",
        f"- Active assets: {len(active_assets)}",
        f"- Assets needing review: {len(review_assets)}",
        f"- Approved clear assets: {sum(1 for asset in active_assets if asset.get('review_status') == 'approved' and asset.get('compliance_status') == 'clear')}",
        "- Next action: Open Assets, review each caption below, then mark Safety Clear and Approve only when the human reviewer agrees.",
        "",
        "## Human Review Checklist",
        "",
        "- The caption is general health education, not personal diagnosis or treatment advice.",
        "- It does not promise reversal, cure, lab improvement, weight loss, or guaranteed outcomes.",
        "- It does not imply the viewer has a condition.",
        "- It does not use patient stories, reports, testimonials, or before/after framing without documented consent.",
        "- Any media is owned, licensed, or explicitly approved for use.",
        "- If in doubt, keep Safety Pending or Safety Flag and rewrite before queueing.",
        "",
        "## Assets To Review",
        "",
    ]
    if review_assets:
        for index, asset in enumerate(review_assets[:40], start=1):
            metadata = asset.get("metadata") or {}
            caption = asset.get("caption") or ""
            findings = check_text(caption)
            finding_lines = [
                f"- [{finding.get('severity')}] {finding.get('rule_id')}: {finding.get('message')} Matches: {', '.join(finding.get('matches') or [])}"
                for finding in findings.get("findings", [])
            ] or ["- No obvious detector finding. Human review is still required."]
            lines.extend(
                [
                    f"### {index}. {metadata.get('topic') or asset.get('format') or 'Untitled asset'}",
                    "",
                    f"- Asset ID: {asset.get('id')}",
                    f"- Brief ID: {asset.get('brief_id') or 'n/a'}",
                    f"- Channel / format: {asset.get('channel')} / {asset.get('format')}",
                    f"- Review / safety: {asset.get('review_status')} / {asset.get('compliance_status')}",
                    f"- Media count: {len([url for url in asset.get('media_urls') or [] if url])}",
                    f"- Target signal: {metadata.get('target_signal') or 'n/a'}",
                    f"- Detector status: {findings.get('status')}",
                    f"- Detector recommendation: {findings.get('recommendation')}",
                    "",
                    "Detector findings:",
                    "",
                    *finding_lines,
                    "",
                    "Caption:",
                    "",
                    caption or "No caption available.",
                    "",
                    "Reviewer decision:",
                    "",
                    "- [ ] Safety Clear",
                    "- [ ] Approve",
                    "- [ ] Keep Pending / Rewrite",
                    "- [ ] Flag",
                    "",
                ]
            )
    else:
        lines.extend(["- No active assets need safety review.", ""])
    lines.extend(
        [
            *asset_review_decision_import_lines(),
            "## Approval Rule",
            "",
            "- Only assets marked Safety Clear and Approved can be queued.",
            "- Do not use this pack to bypass human review.",
            "- Keep Meta automation off until Meta Setup and Launch Evidence are green.",
            "",
        ]
    )
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-asset-safety-review.md"'},
    )


@app.get("/operations/asset-review-decisions.csv")
async def operations_asset_review_decisions_csv(_: None = Depends(require_access_token)):
    assets = await fetch_asset_list(200)
    active_assets = [asset for asset in assets if asset.get("review_status") != "rejected"]
    active_assets.sort(
        key=lambda asset: (
            asset.get("review_status") == "approved" and asset.get("compliance_status") == "clear",
            asset.get("created_at") or "",
        )
    )
    output = StringIO()
    fieldnames = [
        "asset_id",
        "brief_id",
        "topic",
        "channel",
        "format",
        "current_safety",
        "current_review",
        "detector_status",
        "detector_findings",
        "media_count",
        "target_signal",
        "caption",
        "recommended_action",
        "reviewer_safety_decision",
        "reviewer_review_decision",
        "reviewer_name",
        "review_notes",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for asset in active_assets:
        metadata = asset.get("metadata") or {}
        caption = asset.get("caption") or ""
        detector = check_text(caption)
        finding_text = []
        for finding in detector.get("findings", []):
            matches = "|".join(finding.get("matches") or [])
            finding_text.append(f"{finding.get('severity')}:{finding.get('rule_id')}({matches})")
        is_ready = asset.get("review_status") == "approved" and asset.get("compliance_status") == "clear"
        writer.writerow(
            {
                "asset_id": asset.get("id") or "",
                "brief_id": asset.get("brief_id") or "",
                "topic": metadata.get("topic") or "",
                "channel": asset.get("channel") or "",
                "format": asset.get("format") or "",
                "current_safety": asset.get("compliance_status") or "",
                "current_review": asset.get("review_status") or "",
                "detector_status": detector.get("status") or "",
                "detector_findings": "; ".join(finding_text) or "none",
                "media_count": len([url for url in asset.get("media_urls") or [] if url]),
                "target_signal": metadata.get("target_signal") or "",
                "caption": caption,
                "recommended_action": "Ready to queue" if is_ready else "Human review: mark Safety Clear + Approve only if reviewer agrees",
                "reviewer_safety_decision": "",
                "reviewer_review_decision": "",
                "reviewer_name": "",
                "review_notes": "",
            }
        )
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="drec-asset-review-decisions.csv"'},
    )


def normalize_review_safety_decision(value: str | None):
    text = (value or "").strip().lower().replace("_", " ").replace("-", " ")
    if not text:
        return None
    if text in {"clear", "safety clear", "safe", "approved clear", "yes", "y"}:
        return "clear"
    if text in {"pending", "keep pending", "rewrite", "needs work", "needs rewrite", "review"}:
        return "pending"
    if text in {"flag", "flagged", "unsafe", "block", "blocked", "no", "n"}:
        return "flagged"
    return "invalid"


def normalize_asset_review_decision(value: str | None):
    text = (value or "").strip().lower().replace("_", " ").replace("-", " ")
    if not text:
        return None
    if text in {"approve", "approved", "yes", "y"}:
        return "approved"
    if text in {"review", "needs work", "rewrite", "pending", "keep pending"}:
        return "review"
    if text in {"reject", "rejected", "no", "n"}:
        return "rejected"
    return "invalid"


async def decode_asset_review_decisions_csv(file: UploadFile):
    raw = await file.read()
    if len(raw) > 512_000:
        raise HTTPException(status_code=413, detail="Asset review decision CSV is too large. Keep imports below 512 KB.")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Asset review decision CSV must be UTF-8 text.") from exc


@app.post("/operations/import-asset-review-decisions")
async def import_asset_review_decisions(
    file: UploadFile = File(...),
    dry_run: bool = Form(True),
    session: dict = Depends(require_review_access),
):
    csv_text = await decode_asset_review_decisions_csv(file)
    reader = csv.DictReader(StringIO(csv_text))
    required = {"asset_id", "reviewer_safety_decision", "reviewer_review_decision"}
    headers = set(reader.fieldnames or [])
    if not required.issubset(headers):
        missing = sorted(required - headers)
        raise HTTPException(status_code=400, detail={"message": "Asset review decision CSV is missing required columns.", "missing": missing})

    planned = []
    imported = []
    skipped = []
    for index, row in enumerate(reader, start=2):
        asset_id = (row.get("asset_id") or "").strip()
        if not asset_id:
            skipped.append({"row": index, "reason": "Missing asset_id."})
            continue
        safety_decision = normalize_review_safety_decision(row.get("reviewer_safety_decision"))
        review_decision = normalize_asset_review_decision(row.get("reviewer_review_decision"))
        reviewer_name = (row.get("reviewer_name") or "").strip()
        notes = (row.get("review_notes") or "").strip()
        if safety_decision == "invalid" or review_decision == "invalid":
            skipped.append({"row": index, "asset_id": asset_id, "reason": "Decision must use safety clear/pending/flagged and review approved/review/rejected."})
            continue
        if safety_decision is None and review_decision is None and not notes:
            skipped.append({"row": index, "asset_id": asset_id, "reason": "No reviewer decision provided."})
            continue
        existing = await asset_by_id(asset_id)
        if existing is None:
            skipped.append({"row": index, "asset_id": asset_id, "reason": "Asset not found."})
            continue
        target_safety = safety_decision or existing.get("compliance_status")
        if review_decision == "approved" and target_safety != "clear":
            skipped.append({"row": index, "asset_id": asset_id, "reason": "Approval requires reviewer_safety_decision=clear or an already clear asset."})
            continue
        reason_parts = ["CSV reviewer decision import."]
        if reviewer_name:
            reason_parts.append(f"Reviewer: {reviewer_name}.")
        if notes:
            reason_parts.append(f"Notes: {notes}")
        reason = " ".join(reason_parts)
        plan = {
            "row": index,
            "asset_id": asset_id,
            "topic": row.get("topic") or (existing.get("metadata") or {}).get("topic") or "",
            "current_safety": existing.get("compliance_status") or "",
            "current_review": existing.get("review_status") or "",
            "target_safety": safety_decision or "",
            "target_review": review_decision or "",
            "reviewer_name": reviewer_name,
            "review_notes": notes,
        }
        if dry_run:
            planned.append(plan)
            continue
        applied = []
        if safety_decision is not None and safety_decision != existing.get("compliance_status"):
            await update_asset_compliance(asset_id, AssetComplianceIn(compliance_status=safety_decision, reason=reason), session)
            applied.append(f"safety:{safety_decision}")
        if review_decision is not None and review_decision != existing.get("review_status"):
            await update_asset_status(asset_id, AssetStatusIn(review_status=review_decision, reason=reason), session)
            applied.append(f"review:{review_decision}")
        if notes and not applied:
            await save_feedback(
                FeedbackIn(
                    module="asset_review_import",
                    ref_type="asset",
                    ref_id=asset_id,
                    action="edit",
                    reason=reason,
                    before_text=existing.get("caption"),
                    tags=["asset_review_import", "note_only", *audit_tags(session)],
                )
            )
            applied.append("note")
        imported.append({**plan, "applied": applied or ["no_change"]})
    return {
        "dry_run": dry_run,
        "planned_count": len(planned),
        "imported_count": len(imported),
        "skipped_count": len(skipped),
        "planned": planned,
        "imported": imported,
        "skipped": skipped,
        "message": (
            f"Previewed {len(planned)} asset review decision(s), {len(skipped)} skipped."
            if dry_run
            else f"Imported {len(imported)} asset review decision(s), {len(skipped)} skipped."
        ),
    }


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


def review_queue_state(item: dict):
    feedback = item.get("latest_feedback") or {}
    action = feedback.get("action")
    blockers = []
    if item.get("status") != "draft":
        blockers.append("Not in draft review queue.")
    if item.get("compliance_status") != "clear":
        blockers.append("Needs compliance clear before approval or scheduling.")
    if action == "approve" and item.get("compliance_status") == "clear":
        state = "ready_to_schedule"
    elif action == "reject":
        state = "rejected_feedback"
        blockers.append("Latest review rejected this item.")
    elif action == "regen":
        state = "needs_regen"
        blockers.append("Latest review requested regeneration.")
    elif item.get("compliance_status") != "clear":
        state = "blocked_safety"
    else:
        state = "needs_review"
        blockers.append("Needs human review approval.")
    return state, blockers


@app.get("/operations/review-queue.csv")
async def operations_review_queue_csv(_: None = Depends(require_access_token)):
    rows = await fetch_publish_queue_items(200)
    review_items = [item for item in rows if item.get("status") == "draft"]
    output = StringIO()
    fieldnames = [
        "queue_id",
        "asset_id",
        "review_state",
        "blockers",
        "latest_feedback",
        "latest_feedback_reason",
        "latest_feedback_at",
        "status",
        "compliance_status",
        "channel",
        "format",
        "planned_slot",
        "media_count",
        "media_urls",
        "caption",
        "created_at",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for item in review_items:
        feedback = item.get("latest_feedback") or {}
        state, blockers = review_queue_state(item)
        writer.writerow(
            {
                "queue_id": item.get("id") or "",
                "asset_id": item.get("asset_id") or "",
                "review_state": state,
                "blockers": "; ".join(blockers),
                "latest_feedback": feedback.get("action") or "",
                "latest_feedback_reason": feedback.get("reason") or "",
                "latest_feedback_at": feedback.get("created_at") or "",
                "status": item.get("status") or "",
                "compliance_status": item.get("compliance_status") or "",
                "channel": item.get("channel") or "",
                "format": item.get("format") or "",
                "planned_slot": item.get("planned_slot") or "",
                "media_count": len([url for url in item.get("media_urls") or [] if url]),
                "media_urls": "\n".join([url for url in item.get("media_urls") or [] if url]),
                "caption": item.get("caption") or "",
                "created_at": item.get("created_at") or "",
            }
        )
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="drec-review-queue.csv"'},
    )


def editorial_qa_flags(item: dict):
    caption = re.sub(r"\s+", " ", str(item.get("caption") or "")).strip()
    lower = caption.lower()
    flags = []
    if not caption:
        flags.append("Missing caption.")
    if len(caption) > 1800:
        flags.append("Caption is very long; consider tightening before publishing.")
    if len(caption) < 80:
        flags.append("Caption may be too thin for DREC educational value.")
    if not any(marker in caption for marker in ["？", "?", "：", ":", "✅", "👉"]):
        flags.append("Hook or structure may be unclear; add a clear opening question or frame.")
    if not any(term in lower for term in ["保存", "留言", "私讯", "预约", "consult", "comment", "save", "dm"]):
        flags.append("CTA is weak or missing.")
    if any(term in lower for term in ["治愈", "保证", "根治", "cure", "guarantee", "guaranteed"]):
        flags.append("High-risk promise language needs rewrite.")
    if item.get("format") in {"carousel", "single", "story", "reel"} and not [url for url in item.get("media_urls") or [] if url]:
        flags.append("No media attached; confirm visual/design production before scheduling.")
    if item.get("compliance_status") != "clear":
        flags.append("Compliance is not clear.")
    return flags


def editorial_qa_decision(item: dict, flags: list[str]):
    feedback = item.get("latest_feedback") or {}
    if item.get("status") != "draft":
        return "outside_review_queue"
    if item.get("compliance_status") != "clear":
        return "safety_first"
    if any("High-risk promise" in flag for flag in flags):
        return "rewrite_before_approval"
    if feedback.get("action") == "approve" and not flags:
        return "ready_to_schedule"
    if feedback.get("action") == "approve":
        return "approved_but_editorial_check_recommended"
    if feedback.get("action") == "regen":
        return "rewrite_requested"
    if feedback.get("action") == "reject":
        return "do_not_schedule"
    return "editor_review_needed"


def editorial_qa_item_lines(item: dict, index: int):
    feedback = item.get("latest_feedback") or {}
    flags = editorial_qa_flags(item)
    state, blockers = review_queue_state(item)
    decision = editorial_qa_decision(item, flags)
    return [
        f"### {index}. {item.get('channel')} / {item.get('format')} · {decision}",
        "",
        f"- Queue ID: {item.get('id')}",
        f"- Asset ID: {item.get('asset_id') or 'n/a'}",
        f"- Review state: {state}",
        f"- Safety: {item.get('compliance_status')}",
        f"- Latest feedback: {feedback.get('action') or 'none'}",
        f"- Latest feedback reason: {feedback.get('reason') or 'none'}",
        f"- Media count: {len([url for url in item.get('media_urls') or [] if url])}",
        f"- Blockers: {', '.join(blockers) or 'none'}",
        f"- Editorial flags: {', '.join(flags) or 'none'}",
        "",
        "Caption preview:",
        "",
        feedback_excerpt(item.get("caption"), 360) or "No caption.",
        "",
    ]


@app.get("/operations/editorial-qa-pack.md")
async def operations_editorial_qa_pack(_: None = Depends(require_access_token)):
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    rows = await fetch_publish_queue_items(200)
    review_items = [item for item in rows if item.get("status") == "draft"]
    qa_rows = []
    for item in review_items:
        flags = editorial_qa_flags(item)
        qa_rows.append({**item, "qa_flags": flags, "qa_decision": editorial_qa_decision(item, flags)})
    ready = [item for item in qa_rows if item.get("qa_decision") in {"ready_to_schedule", "approved_but_editorial_check_recommended"}]
    rewrite = [item for item in qa_rows if item.get("qa_decision") in {"rewrite_before_approval", "rewrite_requested", "safety_first"}]
    needs_review = [item for item in qa_rows if item.get("qa_decision") == "editor_review_needed"]
    lines = [
        "# DREC Content OS Editorial QA Pack",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this pack before approving or scheduling queued content. It is read-only and does not approve, schedule, queue, or publish records.",
        "",
        "## QA Rules",
        "",
        "- Safety/compliance beats style. Rewrite anything with high-risk promise language.",
        "- Keep DREC content educational, specific, and useful for Chinese-speaking adults around 50+.",
        "- Confirm the hook, body, CTA, and visual/media requirement before approval.",
        "- Do not schedule content without clear compliance, human approval, and a planned time.",
        "",
        "## Current Counts",
        "",
        f"- Draft queue items checked: {len(qa_rows)}",
        f"- Ready or near-ready: {len(ready)}",
        f"- Rewrite/safety-first: {len(rewrite)}",
        f"- Needs editor review: {len(needs_review)}",
        "",
        "## Ready Or Near-Ready",
        "",
    ]
    if ready:
        for index, item in enumerate(ready[:40], start=1):
            lines.extend(editorial_qa_item_lines(item, index))
    else:
        lines.extend(["- No draft queue items are editorially ready yet.", ""])
    lines.extend(["## Rewrite Or Safety-First", ""])
    if rewrite:
        for index, item in enumerate(rewrite[:40], start=1):
            lines.extend(editorial_qa_item_lines(item, index))
    else:
        lines.extend(["- No rewrite/safety-first draft items found.", ""])
    lines.extend(["## Needs Editor Review", ""])
    if needs_review:
        for index, item in enumerate(needs_review[:40], start=1):
            lines.extend(editorial_qa_item_lines(item, index))
    else:
        lines.extend(["- No unreviewed editorial draft items found.", ""])
    lines.extend(
        [
            "## Editor Checklist",
            "",
            "- [ ] Opening hook is specific and not fear-based.",
            "- [ ] Caption has one clear idea, not several competing ideas.",
            "- [ ] Medical wording avoids guaranteed outcomes or cure promises.",
            "- [ ] CTA asks for save/comment/consult without pressure.",
            "- [ ] Visual/media requirement is attached or assigned in the shot list.",
            "- [ ] Latest human feedback supports approval before scheduling.",
            "",
        ]
    )
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-editorial-qa-pack.md"'},
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
    oauth = setup.get("oauth_guide", {})
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
    oauth_setup_lines = [f"- {step}" for step in oauth.get("meta_app_setup", [])] or ["- No Meta OAuth setup steps available."]
    oauth_scope_lines = [f"- {scope}" for scope in oauth.get("required_scopes", [])] or ["- No Meta scopes listed."]
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
        *usability_markdown_lines(launch),
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
        "## Supabase RLS Hardening",
        "",
        f"- Status: {security.get('overall_status')}",
        f"- Service-role key: {security.get('service_role_key')}",
        "- Plan export: `/security/rls-hardening-plan.md`",
        "- Migration: `supabase/migrations/20260617040906_strict_server_only_rls.sql`",
        "- Rule: apply only after live smoke passes with `SUPABASE_SERVICE_ROLE_KEY` installed on Fly.",
        "",
        "Required secrets:",
        "",
        *secret_lines,
        "",
        "Command template:",
        "",
        *command_lines,
        "",
        "## Meta OAuth Guide",
        "",
        f"- Configured: {'yes' if oauth.get('configured') else 'no'}",
        f"- Redirect URI: {oauth.get('redirect_uri', '')}",
        f"- OAuth URL/template: {oauth.get('oauth_dialog_url') or oauth.get('oauth_dialog_url_template') or 'Unavailable'}",
        f"- State note: {oauth.get('state_note', '')}",
        "",
        "Required scopes:",
        "",
        *oauth_scope_lines,
        "",
        "Setup steps:",
        "",
        *oauth_setup_lines,
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
        "## Review-To-Schedule Pack",
        "",
        "- Export: `/operations/review-to-schedule-pack.md`",
        "- Purpose: shows queue-ready assets, review-approved queue items, handoff-ready scheduled items, and blockers in one read-only pack.",
        "- Rule: use it for operating guidance only; queueing, scheduling, and publishing still require the explicit gated actions.",
        "",
        *asset_review_decision_import_lines(),
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


@app.get("/kb/export.csv")
async def export_knowledge_entries(_: None = Depends(require_access_token)):
    items = await fetch_knowledge_entries(200)
    output = StringIO()
    fieldnames = ["id", "category", "title", "body", "tags", "created_at"]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for item in items:
        writer.writerow(
            {
                "id": item.get("id"),
                "category": item.get("category"),
                "title": item.get("title"),
                "body": item.get("body"),
                "tags": ", ".join(item.get("tags") or []),
                "created_at": item.get("created_at"),
            }
        )
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="drec-knowledge-base.csv"'},
    )


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
async def create_knowledge_entry(entry: KnowledgeEntryIn, _: None = Depends(require_admin_access)):
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
    return {"items": await fetch_content_brief_list()}


async def fetch_content_brief_list(limit: int = 100):
    bounded_limit = max(1, min(int(limit or 100), 200))
    rows = await fetch_rows(
        """
        select id, channel, format, pillar, funnel_stage, awareness_stage, topic,
               hook_primary, hook_alt1, hook_alt2, structure_beats, style_hint,
               cta_type, target_signal, language, compliance_notes, status, created_at
        from content_briefs
        order by created_at desc
        limit $1
        """,
        bounded_limit,
    )
    if not rows:
        rows = await supabase_rest.select(
            "content_briefs",
            {
                "select": "id,channel,format,pillar,funnel_stage,awareness_stage,topic,hook_primary,hook_alt1,hook_alt2,structure_beats,style_hint,cta_type,target_signal,language,compliance_notes,status,created_at",
                "order": "created_at.desc",
                "limit": str(bounded_limit),
            },
        )
    return rows


@app.get("/briefs/plan.csv")
async def content_briefs_plan_csv(_: None = Depends(require_access_token)):
    rows = await fetch_rows(
        """
        select id, channel, format, pillar, funnel_stage, awareness_stage, topic,
               hook_primary, hook_alt1, hook_alt2, style_hint, cta_type,
               target_signal, language, compliance_notes, status, created_at
        from content_briefs
        order by created_at desc
        limit 100
        """
    )
    if not rows and supabase_rest.configured():
        rows = await supabase_rest.select(
            "content_briefs",
            {
                "select": "id,channel,format,pillar,funnel_stage,awareness_stage,topic,hook_primary,hook_alt1,hook_alt2,style_hint,cta_type,target_signal,language,compliance_notes,status,created_at",
                "order": "created_at.desc",
                "limit": "100",
            },
        )
    output = StringIO()
    fieldnames = [
        "brief_id",
        "status",
        "language",
        "channel",
        "format",
        "pillar",
        "funnel_stage",
        "awareness_stage",
        "topic",
        "hook_primary",
        "hook_alt1",
        "hook_alt2",
        "style_hint",
        "cta_type",
        "target_signal",
        "compliance_notes",
        "created_at",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for item in rows:
        writer.writerow(
            {
                "brief_id": item.get("id") or "",
                "status": item.get("status") or "",
                "language": item.get("language") or "",
                "channel": item.get("channel") or "",
                "format": item.get("format") or "",
                "pillar": item.get("pillar") or "",
                "funnel_stage": item.get("funnel_stage") or "",
                "awareness_stage": item.get("awareness_stage") or "",
                "topic": item.get("topic") or "",
                "hook_primary": item.get("hook_primary") or "",
                "hook_alt1": item.get("hook_alt1") or "",
                "hook_alt2": item.get("hook_alt2") or "",
                "style_hint": item.get("style_hint") or "",
                "cta_type": item.get("cta_type") or "",
                "target_signal": item.get("target_signal") or "",
                "compliance_notes": item.get("compliance_notes") or "",
                "created_at": item.get("created_at") or "",
            }
        )
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="drec-weekly-plan.csv"'},
    )


@app.get("/briefs/asset-pack.md")
async def content_briefs_asset_pack(_: None = Depends(require_access_token)):
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    briefs = await fetch_content_brief_list(50)
    assets = await fetch_asset_list(200)
    assets_by_brief = {str(asset.get("brief_id")): asset for asset in assets if asset.get("brief_id")}
    unsaved = 0
    review_needed = 0
    ready_assets = 0
    brief_sections = []
    for index, brief in enumerate(briefs[:20], start=1):
        asset = assets_by_brief.get(str(brief.get("id")))
        metadata = (asset or {}).get("metadata") or {}
        if not asset and brief.get("status") != "archived":
            unsaved += 1
        if asset and asset_review_blockers(asset):
            review_needed += 1
        if asset and asset.get("review_status") == "approved" and asset.get("compliance_status") == "clear":
            ready_assets += 1
        action = "Open Weekly Plan and click Save Asset."
        if asset:
            blockers = asset_review_blockers(asset)
            action = "Approve and queue this asset." if not blockers and asset.get("review_status") == "approved" else "Open Assets and complete human safety review."
        if brief.get("status") == "archived":
            action = "Archived brief; restore only if this topic should return to production."
        brief_sections.extend(
            [
                f"### {index}. {brief.get('topic') or 'Untitled brief'}",
                "",
                f"- Brief ID: {brief.get('id')}",
                f"- Brief status: {brief.get('status')}",
                f"- Language: {brief.get('language')}",
                f"- Channel / format: {brief.get('channel')} / {brief.get('format')}",
                f"- Funnel / awareness: {brief.get('funnel_stage') or 'n/a'} / {brief.get('awareness_stage') or 'n/a'}",
                f"- Primary hook: {brief.get('hook_primary') or 'No hook'}",
                f"- Alternate hooks: {brief.get('hook_alt1') or 'n/a'} | {brief.get('hook_alt2') or 'n/a'}",
                f"- Target signal: {brief.get('target_signal') or 'n/a'}",
                f"- Compliance note: {brief.get('compliance_notes') or 'Education-only; human review required.'}",
                f"- Asset ID: {asset.get('id') if asset else 'not saved yet'}",
                f"- Asset review / safety: {asset.get('review_status') if asset else 'n/a'} / {asset.get('compliance_status') if asset else 'n/a'}",
                f"- Asset media count: {len(asset.get('media_urls') or []) if asset else 0}",
                f"- Creative style: {metadata.get('style_key') or brief.get('style_hint') or 'n/a'}",
                f"- Next action: {action}",
                "",
            ]
        )
    if not brief_sections:
        brief_sections = ["- No briefs found. Generate a weekly plan first.", ""]
    lines = [
        "# DREC Content OS Brief-To-Asset Pack",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this pack after weekly planning to turn briefs into reviewable draft assets. It is read-only and does not create or change records.",
        "",
        "## Production Summary",
        "",
        f"- Briefs scanned: {len(briefs[:20])}",
        f"- Unsaved active briefs: {unsaved}",
        f"- Assets needing review: {review_needed}",
        f"- Approved clear assets: {ready_assets}",
        "- Next action: Use Save All Assets, then open Assets for human safety review." if unsaved else "- Next action: Open Assets and finish review/queueing.",
        "",
        "## Brief Production Sheet",
        "",
        *brief_sections,
        "## Review Rules",
        "",
        "- Save assets only from active, non-archived briefs.",
        "- Treat generated captions, slides, and scripts as draft packages until human review is complete.",
        "- Mark Safety Clear only when the content is education-only and avoids personal diagnosis or treatment claims.",
        "- Queue only approved, safety-clear assets.",
        "- Keep Meta publishing manual or dry-run until Meta Setup and Launch Evidence say automation is ready.",
        "",
    ]
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-brief-to-asset-pack.md"'},
    )


@app.post("/briefs")
async def create_content_brief(brief: ContentBriefIn, _: None = Depends(require_review_access)):
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
    _: None = Depends(require_review_access),
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
async def archive_drafted_content_briefs(_: None = Depends(require_review_access)):
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
async def generate_weekly_plan(plan: WeeklyPlanIn, _: None = Depends(require_review_access)):
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
async def create_asset(asset: AssetIn, _: None = Depends(require_review_access)):
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
    session: dict = Depends(require_review_access),
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
                tags=["asset_review", update.review_status, *audit_tags(session)],
            )
        )
    return {"item": row or {**existing, "review_status": update.review_status}}


@app.patch("/assets/{asset_id}/compliance")
async def update_asset_compliance(
    asset_id: str,
    update: AssetComplianceIn,
    session: dict = Depends(require_review_access),
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
                tags=["asset_compliance", update.compliance_status, *audit_tags(session)],
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
async def queue_asset(asset_id: str, _: None = Depends(require_schedule_access)):
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
async def approve_clear_assets(limit: int = 20, _: None = Depends(require_review_access)):
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
async def queue_ready_assets(limit: int = 20, _: None = Depends(require_schedule_access)):
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
async def create_media_asset(media: MediaAssetIn, _: None = Depends(require_review_access)):
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
    _: None = Depends(require_review_access),
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
    _: None = Depends(require_review_access),
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
async def create_creative_draft(draft: CreativeDraftIn, _: None = Depends(require_review_access)):
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


def composer_brief(composer: ComposerPostIn, knowledge: dict):
    safe_points = [str(point).strip() for point in composer.points if str(point).strip()]
    hook_primary = safe_points[0] if safe_points else (
        f"关于「{composer.topic}」，很多人第一步就看错了。"
        if composer.language != "en"
        else f"Most people read {composer.topic} the wrong way first."
    )
    return ContentBriefIn(
        channel="organic",
        format=composer.format,
        pillar="metabolic_education",
        funnel_stage=composer.stage,
        awareness_stage="problem_aware" if composer.stage == "TOFU" else "solution_aware",
        topic=composer.topic,
        hook_primary=hook_primary,
        hook_alt1=safe_points[1] if len(safe_points) > 1 else None,
        hook_alt2=safe_points[2] if len(safe_points) > 2 else None,
        structure_beats={
            "opening": hook_primary,
            "body": safe_points or ["Explain the mechanism simply.", "Give one safe practical observation.", "Invite professional review."],
            "close": "Save and discuss with a clinician.",
            "composer": {
                "channel": composer.channel,
                "media_count": len(composer.media_urls),
                "style_key": composer.style_key,
                "target_signal": composer.target_signal,
            },
            "knowledge_context": {
                "entry_count": knowledge.get("entry_count", 0),
                "style_rules": (knowledge.get("style_rules") or [])[:3],
                "safety_rules": (knowledge.get("safety_rules") or [])[:3],
                "medical_terms": (knowledge.get("medical_terms") or [])[:3],
            },
        },
        style_hint=composer.style_key,
        cta_type=composer.cta_type or ("save_or_consult" if composer.stage != "BOFU" else "consult_interest"),
        target_signal=composer.target_signal or ("saves" if composer.format == "carousel" else "watch_time"),
        language=composer.language,
        compliance_notes=knowledge.get("brief_compliance_notes") or "Education only. Avoid guaranteed outcomes, diagnosis, or personal medical claims.",
    )


@app.post("/composer/draft-post")
async def compose_draft_post(
    composer: ComposerPostIn,
    dry_run: bool = False,
    _: None = Depends(require_review_access),
):
    knowledge = await active_knowledge_context()
    brief = composer_brief(composer, knowledge)
    creative_draft = CreativeDraftIn(
        channel=composer.channel,
        format=composer.format,
        stage=composer.stage,
        language=composer.language,
        topic=composer.topic,
        points=[str(point).strip() for point in composer.points if str(point).strip()],
        style_key=composer.style_key,
        target_signal=composer.target_signal,
    )
    creative = (await create_creative_draft(creative_draft)).get("item", {})
    compliance = creative.get("compliance") or check_text(creative.get("primary_caption") or "")
    if compliance.get("status") == "flagged":
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Compliance check blocked this composer draft.",
                "compliance": compliance,
            },
        )
    if dry_run:
        return {
            "mode": "dry_run",
            "brief": brief.model_dump(),
            "creative": creative,
            "item": None,
            "message": "Dry run only; no brief or asset saved.",
        }
    saved_brief = await insert_brief(brief)
    asset = AssetIn(
        brief_id=str(saved_brief.get("id")) if saved_brief.get("id") else None,
        channel=composer.channel,
        format=composer.format,
        caption=creative.get("primary_caption"),
        media_urls=composer.media_urls,
        metadata={
            "topic": composer.topic,
            "stage": composer.stage,
            "source": "composer_draft_post",
            "points": creative_draft.points,
            "style_key": creative.get("style_key") or composer.style_key,
            "target_signal": creative.get("target_signal") or composer.target_signal,
            "caption_variants": creative.get("caption_variants") or [],
            "slides": creative.get("slides") or [],
            "reel_script": creative.get("reel_script") or [],
            "creative": creative.get("metadata") or {},
            "composer": {
                "channel": composer.channel,
                "media_urls": composer.media_urls,
                "cta_type": brief.cta_type,
            },
        },
        compliance_status="clear" if compliance.get("status") == "clear" else "pending",
        review_status="draft",
    )
    saved_asset = await create_asset(asset)
    if saved_brief.get("id"):
        await update_content_brief_status(str(saved_brief.get("id")), ContentBriefStatusIn(status="drafted"))
        saved_brief = {**saved_brief, "status": "drafted"}
    return {
        "mode": "saved",
        "brief": saved_brief,
        "item": saved_asset.get("item"),
        "creative": creative,
        "reused": False,
        "message": "Composer draft saved as a linked brief and draft asset for review.",
    }


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
async def create_asset_from_brief(brief_id: str, _: None = Depends(require_review_access)):
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
async def create_assets_from_recent_briefs(limit: int = 5, _: None = Depends(require_review_access)):
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


def schedule_audit_item(severity, title, detail, action, items):
    return {
        "severity": severity,
        "title": title,
        "detail": detail,
        "action": action,
        "item_ids": [str(item.get("id") or "") for item in items],
        "channels": sorted({str(item.get("channel") or "") for item in items if item.get("channel")}),
        "planned_slots": [str(item.get("planned_slot") or "") for item in items],
    }


async def schedule_audit_payload():
    queue = await fetch_publish_queue_items(200)
    scheduled = [
        item
        for item in queue
        if item.get("status") in {"scheduled", "publishing"} or item.get("planned_slot")
    ]
    items = []
    by_exact_slot = {}
    parsed_rows = []
    for item in scheduled:
        planned = parse_datetime(item.get("planned_slot"))
        if item.get("status") == "scheduled" and not planned:
            items.append(
                schedule_audit_item(
                    "block",
                    "Scheduled item has no planned time",
                    "A scheduled item without a planned time cannot be used by handoff or Meta workers.",
                    "Set a planned publish time or move it back to draft.",
                    [item],
                )
            )
            continue
        if not planned:
            continue
        planned_utc = planned.astimezone(timezone.utc) if planned.tzinfo else planned.replace(tzinfo=timezone.utc)
        parsed_rows.append((item, planned_utc))
        exact_key = (item.get("channel") or "", planned_utc.replace(second=0, microsecond=0).isoformat())
        by_exact_slot.setdefault(exact_key, []).append(item)
        if item.get("status") == "scheduled" and is_overdue_scheduled_item(item):
            items.append(
                schedule_audit_item(
                    "warn",
                    "Scheduled item is overdue",
                    f"Planned time was {planned_utc.isoformat()}.",
                    "Publish and record the post ID, or reschedule/cancel this item.",
                    [item],
                )
            )
    for (channel, slot), slot_items in by_exact_slot.items():
        if len(slot_items) > 1:
            items.append(
                schedule_audit_item(
                    "block",
                    "Duplicate planned slot",
                    f"{len(slot_items)} {channel or 'channel'} items share {slot}.",
                    "Move all but one item to a suggested open slot before handoff or Meta dispatch.",
                    slot_items,
                )
            )
    sorted_rows = sorted(parsed_rows, key=lambda row: row[1])
    for index, (item, planned) in enumerate(sorted_rows):
        for other, other_planned in sorted_rows[index + 1 :]:
            if (other_planned - planned).total_seconds() > 90 * 60:
                break
            if item.get("channel") != other.get("channel"):
                continue
            if str(item.get("id")) == str(other.get("id")):
                continue
            delta = abs((other_planned - planned).total_seconds()) / 60
            if delta <= 90:
                items.append(
                    schedule_audit_item(
                        "warn",
                        "Near-slot channel conflict",
                        f"Two {item.get('channel') or 'channel'} items are {round(delta)} minute(s) apart.",
                        "Keep at least 90 minutes between same-channel posts unless intentionally testing.",
                        [item, other],
                    )
                )
    deduped = []
    seen = set()
    severity_order = {"block": 0, "warn": 1}
    for item in sorted(items, key=lambda row: (severity_order.get(row.get("severity"), 2), row.get("title", ""))):
        key = (item.get("severity"), item.get("title"), tuple(sorted(item.get("item_ids") or [])), tuple(item.get("planned_slots") or []))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return {
        "overall_status": "blocked" if any(item.get("severity") == "block" for item in deduped) else "needs_review" if deduped else "clear",
        "checked": {
            "queue_items": len(queue),
            "scheduled_or_planned": len(scheduled),
        },
        "block_count": sum(1 for item in deduped if item.get("severity") == "block"),
        "warn_count": sum(1 for item in deduped if item.get("severity") == "warn"),
        "items": deduped[:100],
        "next_step": "Fix blocked schedule conflicts first." if any(item.get("severity") == "block" for item in deduped) else "Review warning-level timing conflicts." if deduped else "No schedule conflicts found.",
    }


@app.get("/publish-queue/schedule-audit")
async def publish_queue_schedule_audit(_: None = Depends(require_access_token)):
    return await schedule_audit_payload()


@app.get("/publish-queue/schedule-audit.md")
async def publish_queue_schedule_audit_markdown(_: None = Depends(require_access_token)):
    audit = await schedule_audit_payload()
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# DREC Content OS Schedule Audit",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this before publishing handoff or Meta dry runs. It is read-only and does not reschedule, publish, or edit queue items.",
        "",
        "## Decision",
        "",
        f"- Status: {audit.get('overall_status')}",
        f"- Blocks: {audit.get('block_count', 0)}",
        f"- Warnings: {audit.get('warn_count', 0)}",
        f"- Scheduled/planned checked: {audit.get('checked', {}).get('scheduled_or_planned', 0)}",
        f"- Next step: {audit.get('next_step')}",
        "",
        "## Findings",
        "",
    ]
    if audit.get("items"):
        for item in audit.get("items", [])[:50]:
            lines.extend(
                [
                    f"### {item.get('severity', '').upper()} - {item.get('title')}",
                    "",
                    f"- Detail: {item.get('detail')}",
                    f"- Action: {item.get('action')}",
                    f"- Queue IDs: {', '.join(item.get('item_ids') or [])}",
                    f"- Channels: {', '.join(item.get('channels') or [])}",
                    f"- Planned slots: {', '.join(item.get('planned_slots') or [])}",
                    "",
                ]
            )
    else:
        lines.append("- No schedule conflicts found.")
    lines.extend(
        [
            "",
            "## Safe Scheduling Rules",
            "",
            "- Keep planned times separate from review approval.",
            "- Keep at least 90 minutes between same-channel posts unless intentionally testing.",
            "- Resolve overdue scheduled items before they distort handoff or learning.",
            "- Run Schedule Audit before Publishing Handoff and before Meta worker dry runs.",
        ]
    )
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-schedule-audit.md"'},
    )


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


def review_schedule_asset_lines(asset: dict, index: int):
    metadata = asset.get("metadata") or {}
    return [
        f"### {index}. {metadata.get('topic') or asset.get('format') or 'Untitled asset'}",
        "",
        f"- Asset ID: {asset.get('id')}",
        f"- Channel / format: {asset.get('channel')} / {asset.get('format')}",
        f"- Safety / review: {asset.get('compliance_status')} / {asset.get('review_status')}",
        f"- Media count: {len([url for url in asset.get('media_urls') or [] if url])}",
        f"- Action: Add to queue from Assets, or use Queue Ready Assets for the batch.",
        "",
    ]


def review_schedule_queue_lines(item: dict, index: int, label: str):
    feedback = item.get("latest_feedback") or {}
    if label.startswith("Handoff"):
        blockers = item.get("handoff_blockers") or queue_item_blockers(item)
    else:
        blockers = item.get("review_queue_blockers") or review_queue_state(item)[1]
    return [
        f"### {index}. {label}: {item.get('channel')} / {item.get('format')}",
        "",
        f"- Queue ID: {item.get('id')}",
        f"- Asset ID: {item.get('asset_id') or 'n/a'}",
        f"- Status: {item.get('status')}",
        f"- Safety: {item.get('compliance_status')}",
        f"- Planned: {item.get('planned_slot') or 'not scheduled'}",
        f"- Latest review: {feedback.get('action') or 'none'}",
        f"- Blockers: {', '.join(blockers) or 'none'}",
        f"- Caption preview: {feedback_excerpt(item.get('caption'), 180)}",
        "",
    ]


@app.get("/operations/review-to-schedule-pack.md")
async def operations_review_to_schedule_pack(_: None = Depends(require_access_token)):
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    assets = await fetch_asset_list(200)
    queue_items = await fetch_publish_queue_items(200)
    handoff = await publishing_handoff(None)
    active_queue_asset_ids = {
        str(item.get("asset_id"))
        for item in queue_items
        if item.get("asset_id") and item.get("status") in {"draft", "scheduled", "publishing"}
    }
    queue_ready_assets = [
        asset
        for asset in assets
        if asset.get("review_status") == "approved"
        and asset.get("compliance_status") == "clear"
        and str(asset.get("id")) not in active_queue_asset_ids
    ]
    ready_to_schedule = []
    queue_needs_review = []
    for item in queue_items:
        state, blockers = review_queue_state(item)
        enriched = {**item, "review_queue_state": state, "review_queue_blockers": blockers}
        if state == "ready_to_schedule":
            ready_to_schedule.append(enriched)
        elif item.get("status") == "draft":
            queue_needs_review.append(enriched)
    handoff_ready = handoff.get("ready_items") or []
    handoff_blocked = handoff.get("blocked_items") or handoff.get("needs_review") or []
    lines = [
        "# DREC Content OS Review-to-Schedule Pack",
        "",
        f"Generated: {generated_at}",
        "",
        "Use this pack after asset safety review to move content toward manual publishing handoff. It is read-only and does not queue, schedule, or publish records.",
        "",
        "## Safe Sequence",
        "",
        "1. Import or apply reviewer decisions only after human safety review.",
        "2. Queue approved, safety-clear assets.",
        "3. Review queued draft items and approve only compliance-clear captions.",
        "4. Schedule approved draft queue items into open MYT publishing slots.",
        "5. Build the publishing handoff and publish manually until Meta readiness is green.",
        "6. Record the Meta post ID or manual label after posting, then enter metrics.",
        "",
        "## Current Counts",
        "",
        f"- Queue-ready assets not yet queued: {len(queue_ready_assets)}",
        f"- Draft queue items ready to schedule: {len(ready_to_schedule)}",
        f"- Draft queue items needing review: {len(queue_needs_review)}",
        f"- Handoff-ready scheduled items: {len(handoff_ready)}",
        f"- Handoff blocked items: {len(handoff_blocked)}",
        "",
        "## Queue-Ready Assets",
        "",
    ]
    if queue_ready_assets:
        for index, asset in enumerate(queue_ready_assets[:40], start=1):
            lines.extend(review_schedule_asset_lines(asset, index))
    else:
        lines.extend(["- No approved safety-clear assets are waiting to be queued.", ""])
    lines.extend(["## Ready To Schedule", ""])
    if ready_to_schedule:
        for index, item in enumerate(ready_to_schedule[:40], start=1):
            lines.extend(review_schedule_queue_lines(item, index, "Ready To Schedule"))
    else:
        lines.extend(["- No draft queue items are review-approved and ready to schedule.", ""])
    lines.extend(["## Queue Items Needing Review", ""])
    if queue_needs_review:
        for index, item in enumerate(queue_needs_review[:40], start=1):
            lines.extend(review_schedule_queue_lines(item, index, "Needs Review"))
    else:
        lines.extend(["- No draft queue items are waiting for review.", ""])
    lines.extend(["## Handoff Ready", ""])
    if handoff_ready:
        for index, item in enumerate(handoff_ready[:40], start=1):
            lines.extend(review_schedule_queue_lines(item, index, "Handoff Ready"))
    else:
        lines.extend(["- No scheduled compliance-clear items are ready for handoff.", ""])
    lines.extend(["## Handoff Blocked", ""])
    if handoff_blocked:
        for index, item in enumerate(handoff_blocked[:40], start=1):
            lines.extend(review_schedule_queue_lines(item, index, "Handoff Blocked"))
    else:
        lines.extend(["- No handoff-blocked active items found.", ""])
    lines.extend(
        [
            "## Safety Rules",
            "",
            "- Do not queue assets unless review is approved and safety is clear.",
            "- Do not schedule queue items unless they are compliance-clear and human-approved.",
            "- Do not publish anything not listed as handoff-ready.",
            "- Keep real Meta automation off until Meta Setup, Launch Evidence, and security gates are green.",
            "",
        ]
    )
    return Response(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="drec-review-to-schedule-pack.md"'},
    )


@app.post("/compliance/check")
async def check_compliance(item: ComplianceCheckIn, _: None = Depends(require_access_token)):
    return check_text(item.text)


@app.post("/publish-queue")
async def create_publish_queue_item(item: PublishQueueIn, _: None = Depends(require_schedule_access)):
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
async def schedule_publish_queue_next_slot(item_id: str, _: None = Depends(require_schedule_access)):
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
    if existing.get("status") == "cancelled":
        raise HTTPException(status_code=422, detail="Cancelled items cannot be rescheduled. Create a new queue item instead.")
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
async def schedule_review_approved_queue(limit: int = 20, _: None = Depends(require_schedule_access)):
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
    _: None = Depends(require_schedule_access),
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
    _: None = Depends(require_schedule_access),
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
async def dispatch_facebook_item(dispatch: MetaDispatchIn, _: None = Depends(require_schedule_access)):
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
async def dispatch_instagram_item(dispatch: MetaDispatchIn, _: None = Depends(require_schedule_access)):
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
async def ingest_metric(metric: MetricIn, _: None = Depends(require_metrics_access)):
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


def metric_number(value, default=0):
    if value is None:
        return default
    text = str(value).strip()
    if text == "":
        return default
    try:
        return float(text)
    except ValueError:
        return default


def metric_int(value):
    return int(metric_number(value, 0))


async def decode_metrics_csv(file: UploadFile):
    raw = await file.read()
    if len(raw) > 512_000:
        raise HTTPException(status_code=413, detail="Metrics CSV is too large. Keep imports below 512 KB.")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Metrics CSV must be UTF-8 text.") from exc


@app.post("/metrics/import-csv")
async def import_metrics_csv(
    file: UploadFile = File(...),
    rollup: bool = Form(False),
    dry_run: bool = Form(False),
    _: None = Depends(require_metrics_access),
):
    csv_text = await decode_metrics_csv(file)
    reader = csv.DictReader(StringIO(csv_text))
    required = {"source", "external_post_id", "captured_at", "reach", "likes", "comments", "saves", "shares", "leads", "spend"}
    headers = set(reader.fieldnames or [])
    if not required.issubset(headers):
        missing = sorted(required - headers)
        raise HTTPException(status_code=400, detail={"message": "Metrics CSV is missing required columns.", "missing": missing})

    imported = []
    planned = []
    skipped = []
    outcomes = []
    allowed_sources = {"facebook", "instagram", "manual", "ads"}
    for index, row in enumerate(reader, start=2):
        row_type = (row.get("row_type") or "").strip().lower()
        if row_type in {"instructions", "sample"}:
            skipped.append({"row": index, "reason": f"Skipped {row_type} row."})
            continue
        external_post_id = (row.get("external_post_id") or "").strip()
        if not external_post_id:
            skipped.append({"row": index, "reason": "Missing external_post_id."})
            continue
        source = (row.get("source") or "manual").strip().lower()
        if source not in allowed_sources:
            skipped.append({"row": index, "external_post_id": external_post_id, "reason": "Source must be facebook, instagram, manual, or ads."})
            continue
        captured_at = parse_datetime(row.get("captured_at")) or datetime.utcnow()
        metric = MetricIn(
            source=source,
            external_post_id=external_post_id,
            captured_at=captured_at,
            metrics={
                "reach": metric_int(row.get("reach")),
                "likes": metric_int(row.get("likes")),
                "comments": metric_int(row.get("comments")),
                "saves": metric_int(row.get("saves")),
                "shares": metric_int(row.get("shares")),
                "leads": metric_int(row.get("leads")),
                "spend": metric_number(row.get("spend"), 0),
                "import_notes": (row.get("notes") or "").strip(),
            },
        )
        if dry_run:
            planned.append(
                {
                    "row": index,
                    "external_post_id": external_post_id,
                    "source": source,
                    "captured_at": captured_at.isoformat(),
                    "metrics": metric.metrics,
                    "rollup": bool(rollup),
                }
            )
            continue
        saved = await ingest_metric(metric)
        imported.append({"row": index, "external_post_id": external_post_id, "source": source, "item": saved.get("item")})
        if rollup:
            channel = (row.get("channel") or source).strip().lower()
            if channel not in {"facebook", "instagram", "manual"}:
                channel = "manual"
            fmt = (row.get("format") or "carousel").strip().lower()
            if fmt not in {"reel", "carousel", "single", "story"}:
                fmt = "carousel"
            funnel_stage = (row.get("funnel_stage") or "TOFU").strip().upper()
            if funnel_stage not in {"TOFU", "MOFU", "BOFU"}:
                funnel_stage = "TOFU"
            metric_window = (row.get("metric_window") or "7d").strip()
            if metric_window not in {"7d", "28d", "90d"}:
                metric_window = "7d"
            try:
                outcome = await rollup_metric_to_outcome(
                    MetricRollupIn(
                        external_post_id=external_post_id,
                        metric_window=metric_window,
                        format=fmt,
                        channel=channel,
                        funnel_stage=funnel_stage,
                        pillar="metabolic_education",
                    )
                )
                outcomes.append({"row": index, "external_post_id": external_post_id, "outcome": outcome.get("item")})
            except HTTPException as exc:
                skipped.append({"row": index, "external_post_id": external_post_id, "reason": f"Metric saved but rollup failed: {exc.detail}"})

    message = (
        f"Previewed {len(planned)} importable metric row(s), skipped {len(skipped)} row(s)."
        if dry_run
        else f"Imported {len(imported)} metric row(s), created {len(outcomes)} outcome(s), skipped {len(skipped)} row(s)."
    )
    return {
        "mode": "dry_run" if dry_run else "import",
        "planned_count": len(planned),
        "imported_count": len(imported),
        "outcome_count": len(outcomes),
        "skipped_count": len(skipped),
        "planned": planned,
        "imported": imported,
        "outcomes": outcomes,
        "skipped": skipped,
        "message": message,
    }


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
async def ingest_meta_metrics(request: MetaMetricsIn, _: None = Depends(require_metrics_access)):
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
    _: None = Depends(require_metrics_access),
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
async def rollup_metric_to_outcome(rollup: MetricRollupIn, _: None = Depends(require_metrics_access)):
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
async def create_outcome(outcome: OutcomeIn, _: None = Depends(require_metrics_access)):
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
async def capture_feedback(feedback: FeedbackIn, session: dict = Depends(require_review_access)):
    feedback.tags = [*feedback.tags, *audit_tags(session)]
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
async def create_learning_weight(weight: LearningWeightIn, _: None = Depends(require_metrics_access)):
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
async def revert_learning_weight(weight_id: str, _: None = Depends(require_metrics_access)):
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
