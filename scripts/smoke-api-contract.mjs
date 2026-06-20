import { readFile } from "node:fs/promises";

const files = {
  main: "apps/api/app/main.py",
  auth: "apps/api/app/auth.py",
  config: "apps/api/app/config.py",
  models: "apps/api/app/models.py",
  dockerfile: "apps/api/Dockerfile",
  schema: "supabase/schema.sql",
  web: "apps/web/app.js",
  styles: "apps/web/styles.css",
  schedulerWorkflow: ".github/workflows/drec-scheduler-dry-run.yml",
  realMetricsWorkflow: ".github/workflows/drec-nightly-meta-metrics.yml",
  strictRlsMigration: "supabase/migrations/20260617040906_strict_server_only_rls.sql",
};

const requiredRoutes = [
  "GET /health",
  "GET /ui-status",
  "GET /workflow/status",
  "GET /security/status",
  "GET /security/access-policy",
  "GET /security/access-control-pack.md",
  "GET /security/service-role-install-pack.md",
  "GET /security/rls-hardening-plan.md",
  "GET /automation/status",
  "GET /operations/launch-readiness",
  "GET /operations/test-run-checklist",
  "GET /operations/first-publish-readiness",
  "GET /operations/first-publish-readiness.md",
  "GET /operations/first-publish-readiness.zh.md",
  "GET /operations/first-publish-doctor-review-sheet.zh.md",
  "GET /operations/first-publish-media-pack.md",
  "GET /operations/first-publish-carousel-preview/{slide_number}.png",
  "GET /operations/first-publish-carousel-assets.zip",
  "GET /operations/first-publish-carousel-png-assets.zip",
  "GET /public/first-publish-assets/{asset_id}/slides/{slide_number}.png",
  "GET /operations/chinese-operator-center",
  "GET /operations/chinese-operator-center.md",
  "GET /notion/carousel-source",
  "GET /notion/carousel-intake-template.csv",
  "GET /notion/carousel-image-workflow.md",
  "GET /notion/connector-fallback-pack.md",
  "GET /notion/monthly-refresh-workbench",
  "GET /notion/monthly-refresh-workbench.md",
  "GET /notion/monthly-refresh-workbench.zh.md",
  "POST /notion/carousel-row/import",
  "POST /operations/first-publish-advance",
  "POST /operations/first-publish-attach-generated-media",
  "POST /operations/first-publish-approve-current-asset",
  "POST /operations/first-publish-approve-current-queue",
  "POST /operations/scheduler-heartbeat",
  "GET /operations/scheduler-activation-pack.md",
  "GET /operations/scheduler-health",
  "GET /operations/scheduler-health.md",
  "GET /operations/scheduler-recovery-pack",
  "GET /operations/scheduler-recovery-pack.md",
  "GET /operations/launch-evidence.md",
  "GET /operations/first-test-kit.md",
  "GET /operations/test-run-tracker.md",
  "GET /operations/cycle-command-center",
  "GET /operations/cycle-command-center.md",
  "GET /operations/cycle-evidence-ledger.csv",
  "GET /operations/external-setup-board",
  "GET /operations/external-setup-board.csv",
  "GET /operations/manual-cycle-qa.md",
  "GET /operations/daily-ops-checklist.md",
  "GET /operations/risk-audit",
  "GET /operations/snapshot.csv",
  "GET /operations/backup-recovery-pack.md",
  "GET /operations/pipeline-board.csv",
  "GET /operations/audit-trail.csv",
  "GET /operations/creative-pack.md",
  "GET /operations/media-shot-list.csv",
  "GET /operations/asset-review.csv",
  "GET /operations/asset-review-worklist.md",
  "GET /operations/asset-safety-review.md",
  "GET /operations/asset-review-session",
  "GET /operations/asset-review-session.md",
  "GET /operations/asset-review-session.zh.md",
  "GET /operations/doctor-approval-pack",
  "GET /operations/doctor-approval-request",
  "GET /operations/doctor-approval-request.md",
  "GET /operations/doctor-approval-pack.md",
  "GET /operations/doctor-review-bridge",
  "GET /operations/doctor-review-bridge.md",
  "GET /operations/doctor-review-bridge.zh.md",
  "GET /operations/doctor-send-queue.csv",
  "GET /operations/doctor-review-polish-pack",
  "GET /operations/doctor-review-polish-pack.md",
  "GET /operations/doctor-reply-inbox-pack",
  "GET /operations/doctor-reply-inbox-pack.md",
  "GET /operations/doctor-reply-inbox-pack.zh.md",
  "GET /operations/doctor-decision-worksheet.csv",
  "GET /operations/monthly-carousel-action-queue",
  "GET /operations/monthly-carousel-action-queue.zh.md",
  "GET /operations/monthly-carousel-action-queue.csv",
  "GET /operations/monthly-carousel-doctor-triage",
  "GET /operations/monthly-carousel-doctor-triage.zh.md",
  "GET /operations/monthly-carousel-doctor-triage.csv",
  "POST /operations/import-doctor-replies",
  "GET /operations/approval-cockpit",
  "GET /operations/approval-cockpit.md",
  "GET /operations/approval-cockpit.zh.md",
  "GET /operations/post-approval-production",
  "GET /operations/post-approval-production.md",
  "GET /operations/production-handoff-bridge",
  "GET /operations/production-handoff-bridge.md",
  "GET /operations/production-handoff-bridge.zh.md",
  "GET /operations/production-reply-inbox-pack",
  "GET /operations/production-reply-inbox-pack.md",
  "GET /operations/production-reply-inbox-pack.zh.md",
  "GET /operations/production-design-worksheet.csv",
  "GET /operations/pre-schedule-gate",
  "GET /operations/pre-schedule-gate.md",
  "GET /operations/asset-rewrite-pack",
  "GET /operations/asset-rewrite-pack.md",
  "GET /operations/first-cycle-handoff",
  "GET /operations/first-cycle-handoff.md",
  "GET /operations/first-cycle-handoff.zh.md",
  "GET /operations/first-cycle-sprint-pack",
  "GET /operations/first-cycle-sprint-pack.md",
  "GET /operations/first-cycle-sprint-pack.zh.md",
  "GET /operations/first-cycle-sprint-tracker.csv",
  "GET /operations/today-runbook",
  "GET /operations/today-runbook.md",
  "GET /operations/today-runbook.zh.md",
  "GET /operations/today-safe-operator-pack.zip",
  "GET /operations/asset-media-attachments.csv",
  "POST /operations/import-asset-media-attachments",
  "POST /operations/import-production-replies",
  "POST /operations/import-production-design-worksheet",
  "GET /operations/asset-review-decisions.csv",
  "POST /operations/import-asset-review-decisions",
  "GET /operations/review-log.md",
  "GET /operations/editorial-qa-pack.md",
  "GET /operations/review-queue.csv",
  "GET /operations/review-queue-decisions.csv",
  "POST /operations/import-review-queue-decisions",
  "GET /operations/review-to-schedule-pack.md",
  "GET /operations/review-to-schedule-pack.zh.md",
  "GET /operations/learning-snapshot.csv",
  "GET /learning/quarterly-memo",
  "GET /learning/quarterly-memo.md",
  "GET /learning/quarterly-memo.zh.md",
  "GET /operations/metrics-template.csv",
  "GET /operations/metrics-closeout-pack.md",
  "GET /operations/metrics-closeout-pack.zh.md",
  "GET /operations/publishing-closeout",
  "GET /operations/publishing-closeout.zh.md",
  "GET /operations/weekly-cycle-pack.md",
  "GET /operations/weekly-cycle-pack.zh.md",
  "GET /operations/publishing-run-sheet.md",
  "GET /operations/operator-pack.md",
  "GET /weekly-report.md",
  "GET /weekly-report.zh.md",
  "GET /meta/readiness",
  "GET /meta/oauth-guide",
  "GET /meta/setup-checklist",
  "GET /meta/activation-checklist.md",
  "GET /meta/credential-wizard",
  "GET /meta/credential-wizard.md",
  "GET /meta/credential-intake-pack.md",
  "GET /meta/preflight-audit",
  "GET /meta/preflight-audit.md",
  "GET /notifications/rail-readiness",
  "GET /notifications/whatsapp-approval-pack.md",
  "GET /kb/export.csv",
  "GET /kb/context",
  "GET /insights/sense-brief",
  "GET /insights/sense-brief.md",
  "GET /insights/ads-planning",
  "GET /insights/ads-planning.md",
  "GET /publish-queue/suggest-slot",
  "GET /publish-queue/schedule-audit",
  "GET /publish-queue/schedule-audit.md",
  "GET /publish-queue/calendar.ics",
  "GET /publish-queue/schedule.csv",
  "GET /publish-queue/schedule-worksheet.csv",
  "POST /publish-queue/import-schedule-worksheet",
  "GET /operations/publishing-handoff.zh.md",
  "GET /operations/post-publish-next-steps",
  "GET /operations/post-publish-next-steps.zh.md",
  "GET /operations/post-publish-metrics-template.csv",
  "GET /briefs/plan.csv",
  "GET /briefs/asset-pack.md",
  "GET /creative/style-library",
  "GET /creative/style-guide.md",
  "GET /templates/library",
  "GET /templates/static-render-pack.md",
  "GET /video/studio-readiness",
  "GET /video/sop-pack.md",
  "GET /video/manual-reel-handoff",
  "GET /video/manual-reel-handoff.zh.md",
  "GET /video/manual-reel-handoff.csv",
  "POST /composer/draft-post",
  "GET /metrics/published-source",
  "POST /metrics/import-csv",
  "POST /briefs/{brief_id}/draft-asset",
  "POST /briefs/draft-assets",
  "POST /briefs/archive-drafted",
  "POST /assets/approve-clear",
  "POST /assets/queue-ready",
  "GET /assets/{asset_id}/carousel-preview/{slide_number}.png",
  "GET /assets/{asset_id}/carousel-assets.zip",
  "GET /assets/{asset_id}/carousel-png-assets.zip",
  "POST /assets/{asset_id}/queue",
  "PATCH /assets/{asset_id}/caption",
  "PATCH /assets/{asset_id}/media",
  "POST /assets/apply-safe-rewrites",
  "PATCH /assets/{asset_id}/compliance",
  "POST /publish-queue/{item_id}/schedule-next",
  "POST /publish-queue/schedule-approved",
  "GET /publishing-handoff",
  "POST /publishing/facebook/dispatch",
  "POST /publishing/instagram/dispatch",
  "POST /jobs/meta-publishing",
  "POST /metrics/meta/ingest",
  "POST /jobs/nightly-meta-metrics",
];

const requiredSnippets = [
  {
    name: "asset queue approval gate",
    file: "main",
    text: 'asset.get("review_status") != "approved"',
  },
  {
    name: "api serves latest web ui",
    file: "main",
    text: 'app.mount("/ui", StaticFiles',
  },
  {
    name: "api ui status route",
    file: "main",
    text: "recommended_url",
  },
  {
    name: "api docker copies web ui",
    file: "dockerfile",
    text: "COPY apps/web ./web",
  },
  {
    name: "asset queue compliance gate",
    file: "main",
    text: 'asset.get("compliance_status") != "clear"',
  },
  {
    name: "asset queue idempotency",
    file: "main",
    text: "existing_queue_for_asset",
  },
  {
    name: "bulk clear asset approval",
    file: "main",
    text: "approve_clear_assets",
  },
  {
    name: "bulk ready asset queue",
    file: "main",
    text: "queue_ready_assets",
  },
  {
    name: "asset carousel png route",
    file: "main",
    text: "/assets/{asset_id}/carousel-png-assets.zip",
  },
  {
    name: "asset carousel preview route",
    file: "main",
    text: "/assets/{asset_id}/carousel-preview/{slide_number}.png",
  },
  {
    name: "asset carousel zip safety",
    file: "main",
    text: "This ZIP does not approve, attach, schedule, or publish anything.",
  },
  {
    name: "brief asset idempotency",
    file: "main",
    text: "existing_asset_for_brief",
  },
  {
    name: "bulk brief asset creation",
    file: "main",
    text: "create_assets_from_recent_briefs",
  },
  {
    name: "bulk drafted brief archive",
    file: "main",
    text: "archive_drafted_content_briefs",
  },
  {
    name: "weekly plan csv export",
    file: "main",
    text: "drec-weekly-plan.csv",
  },
  {
    name: "brief to asset pack route",
    file: "main",
    text: "content_briefs_asset_pack",
  },
  {
    name: "brief to asset pack export",
    file: "main",
    text: "drec-brief-to-asset-pack.md",
  },
  {
    name: "brief to asset pack review rules",
    file: "main",
    text: "## Review Rules",
  },
  {
    name: "creative style library route",
    file: "main",
    text: "creative_style_library",
  },
  {
    name: "creative style guide export",
    file: "main",
    text: "drec-creative-style-guide.md",
  },
  {
    name: "creative style library tokens",
    file: "main",
    text: "CREATIVE_BRAND_TOKENS",
  },
  {
    name: "composer linked draft route",
    file: "main",
    text: "compose_draft_post",
  },
  {
    name: "composer linked brief source",
    file: "main",
    text: "composer_draft_post",
  },
  {
    name: "composer dry run safety",
    file: "main",
    text: "Dry run only; no brief or asset saved.",
  },
  {
    name: "planned time publish gate",
    file: "main",
    text: "Item needs a planned publish time before Meta dispatch.",
  },
  {
    name: "cancelled item schedule guard",
    file: "main",
    text: "Cancelled items cannot be rescheduled",
  },
  {
    name: "cancelled item risk audit skip",
    file: "main",
    text: 'if status == "cancelled"',
  },
  {
    name: "cancelled item risk audit evidence",
    file: "main",
    text: "cancelled_queue",
  },
  {
    name: "overdue scheduled helper",
    file: "main",
    text: "is_overdue_scheduled_item",
  },
  {
    name: "overdue scheduled risk audit",
    file: "main",
    text: "Scheduled item is overdue",
  },
  {
    name: "overdue scheduled daily ops count",
    file: "main",
    text: "Overdue scheduled",
  },
  {
    name: "scheduled publishing job due gate",
    file: "main",
    text: "planned_slot <= $2",
  },
  {
    name: "scheduled publishing job lock",
    file: "main",
    text: "META_ENABLE_PUBLISHING_JOB=true",
  },
  {
    name: "handoff blocker reasons",
    file: "main",
    text: "handoff_blockers",
  },
  {
    name: "bulk review-approved scheduling",
    file: "main",
    text: "schedule_review_approved_queue",
  },
  {
    name: "schedule suggestion rotation",
    file: "main",
    text: "PUBLISH_SLOT_ROTATION",
  },
  {
    name: "publishing calendar export",
    file: "main",
    text: "drec-publishing-calendar.ics",
  },
  {
    name: "schedule audit route",
    file: "main",
    text: "publish_queue_schedule_audit",
  },
  {
    name: "schedule audit export",
    file: "main",
    text: "drec-schedule-audit.md",
  },
  {
    name: "schedule audit conflict rule",
    file: "main",
    text: "Duplicate planned slot",
  },
  {
    name: "publishing schedule csv export",
    file: "main",
    text: "drec-publishing-schedule.csv",
  },
  {
    name: "schedule worksheet csv export",
    file: "main",
    text: "drec-schedule-worksheet.csv",
  },
  {
    name: "schedule worksheet import route",
    file: "main",
    text: "import_schedule_worksheet",
  },
  {
    name: "schedule worksheet import safety",
    file: "main",
    text: "It does not publish, dispatch Meta requests, or record external post IDs.",
  },
  {
    name: "workflow readiness report",
    file: "main",
    text: "## Workflow Readiness",
  },
  {
    name: "security service role readiness",
    file: "main",
    text: "ready_for_rls_hardening",
  },
  {
    name: "security service role smoke evidence",
    file: "main",
    text: "latest_service_role_smoke",
  },
  {
    name: "security service role smoke gate",
    file: "main",
    text: "needs_service_role_smoke",
  },
  {
    name: "security service role smoke freshness",
    file: "main",
    text: "SERVICE_ROLE_SMOKE_RECENT_MINUTES",
  },
  {
    name: "security rls requires recent smoke",
    file: "main",
    text: "service_role_smoke.status=recent",
  },
  {
    name: "security access policy route",
    file: "main",
    text: "/security/access-policy",
  },
  {
    name: "security access control pack route",
    file: "main",
    text: "security_access_control_pack",
  },
  {
    name: "security access control actor rule",
    file: "main",
    text: "Actor name field",
  },
  {
    name: "security access control export",
    file: "main",
    text: "drec-access-control-pack.md",
  },
  {
    name: "security service role install pack route",
    file: "main",
    text: "security_service_role_install_pack",
  },
  {
    name: "security service role install pack export",
    file: "main",
    text: "drec-service-role-install-pack.md",
  },
  {
    name: "security service role install pack command",
    file: "main",
    text: "fly secrets set -a drec-content-os-api SUPABASE_SERVICE_ROLE_KEY",
  },
  {
    name: "security service role install pack hard stop",
    file: "main",
    text: "Do not paste the service-role key into chat, GitHub Actions logs, Vercel browser variables, screenshots, or Markdown files.",
  },
  {
    name: "role token auth compatibility",
    file: "config",
    text: "drec_viewer_token",
  },
  {
    name: "role token scope map",
    file: "auth",
    text: "ROLE_SCOPES",
  },
  {
    name: "role token scope enforcement helper",
    file: "auth",
    text: "require_scope",
  },
  {
    name: "role token enforced scopes payload",
    file: "auth",
    text: "enforced_scopes",
  },
  {
    name: "role token actor header",
    file: "auth",
    text: "x_drec_actor",
  },
  {
    name: "feedback audit tags",
    file: "main",
    text: "audit_tags",
  },
  {
    name: "review-scoped route",
    file: "main",
    text: "Depends(require_review_access)",
  },
  {
    name: "schedule-scoped route",
    file: "main",
    text: "Depends(require_schedule_access)",
  },
  {
    name: "metrics-scoped route",
    file: "main",
    text: "Depends(require_metrics_access)",
  },
  {
    name: "admin-scoped route",
    file: "main",
    text: "Depends(require_admin_access)",
  },
  {
    name: "security rls hardening plan route",
    file: "main",
    text: "rls-hardening-plan.md",
  },
  {
    name: "strict rls migration revokes browser access",
    file: "strictRlsMigration",
    text: "from anon, authenticated",
  },
  {
    name: "strict rls migration keeps service role",
    file: "strictRlsMigration",
    text: "to service_role",
  },
  {
    name: "automation readiness status",
    file: "main",
    text: "manual_safe_auto_blocked",
  },
  {
    name: "scheduler heartbeat status",
    file: "main",
    text: "latest_scheduler_heartbeat",
  },
  {
    name: "scheduler heartbeat six hour threshold",
    file: "main",
    text: "SCHEDULER_HEARTBEAT_RECENT_MINUTES = 6 * 60",
  },
  {
    name: "scheduler health uses heartbeat threshold constant",
    file: "main",
    text: "stale_after_minutes = SCHEDULER_HEARTBEAT_RECENT_MINUTES",
  },
  {
    name: "scheduler health overall status alias",
    file: "main",
    text: "\"overall_status\": current_status",
  },
  {
    name: "scheduler health next step field",
    file: "main",
    text: "\"next_step\": (",
  },
  {
    name: "scheduler heartbeat route",
    file: "main",
    text: "operations_scheduler_heartbeat",
  },
  {
    name: "scheduler activation pack route",
    file: "main",
    text: "operations_scheduler_activation_pack",
  },
  {
    name: "scheduler activation pack export",
    file: "main",
    text: "drec-scheduler-activation-pack.md",
  },
  {
    name: "scheduler activation pack safety",
    file: "main",
    text: "## Safety Rules",
  },
  {
    name: "scheduler health route",
    file: "main",
    text: "scheduler_health_payload",
  },
  {
    name: "scheduler health export",
    file: "main",
    text: "drec-scheduler-health-pack.md",
  },
  {
    name: "scheduler health no fake heartbeat",
    file: "main",
    text: "without recording a fake heartbeat",
  },
  {
    name: "scheduler recovery pack route",
    file: "main",
    text: "scheduler_recovery_pack_payload",
  },
  {
    name: "scheduler recovery pack export",
    file: "main",
    text: "drec-scheduler-recovery-pack.md",
  },
  {
    name: "scheduler recovery pack links",
    file: "main",
    text: "dry_run_workflow_url",
  },
  {
    name: "scheduler recovery no fake heartbeat",
    file: "main",
    text: "Run recovery from GitHub Actions, not by faking heartbeat evidence.",
  },
  {
    name: "scheduler pack UI action",
    file: "web",
    text: "download-scheduler-pack",
  },
  {
    name: "scheduler health UI action",
    file: "web",
    text: "download-scheduler-health",
  },
  {
    name: "scheduler recovery UI action",
    file: "web",
    text: "download-scheduler-recovery",
  },
  {
    name: "scheduler pack UI endpoint",
    file: "web",
    text: "/operations/scheduler-activation-pack.md",
  },
  {
    name: "scheduler health UI endpoint",
    file: "web",
    text: "/operations/scheduler-health.md",
  },
  {
    name: "scheduler recovery UI endpoint",
    file: "web",
    text: "/operations/scheduler-recovery-pack.md",
  },
  {
    name: "launch readiness status",
    file: "main",
    text: "launch_readiness_payload",
  },
  {
    name: "launch readiness usability scope",
    file: "main",
    text: "can_use_for_manual_ops",
  },
  {
    name: "workflow completion payload",
    file: "main",
    text: "build_completion_status",
  },
  {
    name: "workflow completion weighted method",
    file: "main",
    text: "weighted_operational_readiness",
  },
  {
    name: "workflow scheduled queue summary",
    file: "main",
    text: "\"scheduled_queue\": scheduled_queue",
  },
  {
    name: "workflow handoff next action after scheduling",
    file: "main",
    text: "Download today's safe pack",
  },
  {
    name: "workflow handoff no-publish safety",
    file: "main",
    text: "Do not publish or record a post ID until a human actually posts.",
  },
  {
    name: "notion carousel source payload",
    file: "main",
    text: "NOTION_CAROUSEL_SOURCE",
  },
  {
    name: "notion carousel monthly refresh rule",
    file: "main",
    text: "monthly_refresh_day",
  },
  {
    name: "notion connector csv fallback mode",
    file: "main",
    text: "csv_import_with_topic_id_dedupe",
  },
  {
    name: "notion connector fallback route",
    file: "main",
    text: "/notion/connector-fallback-pack.md",
  },
  {
    name: "notion connector plan limitation note",
    file: "main",
    text: "direct database row querying may require a Notion Enterprise plan with Notion AI",
  },
  {
    name: "notion carousel monthly refresh workbench payload",
    file: "main",
    text: "notion_monthly_refresh_workbench_payload",
  },
  {
    name: "notion carousel monthly refresh zh export",
    file: "main",
    text: "/notion/monthly-refresh-workbench.zh.md",
  },
  {
    name: "notion carousel monthly refresh operator checklist",
    file: "main",
    text: "operator_checklist",
  },
  {
    name: "notion carousel source route",
    file: "main",
    text: "/notion/carousel-source",
  },
  {
    name: "notion carousel import route",
    file: "main",
    text: "/notion/carousel-row/import",
  },
  {
    name: "notion carousel slide plan parser",
    file: "main",
    text: "parse_notion_carousel_slide_plan",
  },
  {
    name: "notion carousel slide one body guard",
    file: "main",
    text: "explanation = \"\" if slide_number == 1",
  },
  {
    name: "notion carousel imported asset slides",
    file: "main",
    text: "\"slides\": slides",
  },
  {
    name: "notion carousel existing brief creates missing asset",
    file: "main",
    text: "missing asset was created from the existing brief",
  },
  {
    name: "notion carousel save asset slide reuse",
    file: "main",
    text: "notion_slides_from_brief",
  },
  {
    name: "notion carousel safe caption helper",
    file: "main",
    text: "safe_notion_asset_caption",
  },
  {
    name: "notion carousel risky wording rewrite",
    file: "main",
    text: "(\"糖尿病逆转\", \"血糖管理与代谢改善\")",
  },
  {
    name: "test run checklist route",
    file: "main",
    text: "test_run_checklist_payload",
  },
  {
    name: "launch evidence export",
    file: "main",
    text: "drec-launch-evidence.md",
  },
  {
    name: "launch evidence usability section",
    file: "main",
    text: "## Can I Use It Now",
  },
  {
    name: "launch evidence action links",
    file: "main",
    text: "## Evidence Action Links",
  },
  {
    name: "launch evidence scheduler recovery link",
    file: "main",
    text: "- Scheduler recovery: `/operations/scheduler-recovery-pack.md`",
  },
  {
    name: "launch evidence meta preflight link",
    file: "main",
    text: "- Meta preflight: `/meta/preflight-audit.md`",
  },
  {
    name: "launch evidence rls plan link",
    file: "main",
    text: "- Supabase RLS plan: `/security/rls-hardening-plan.md`",
  },
  {
    name: "first test kit export",
    file: "main",
    text: "drec-first-test-kit.md",
  },
  {
    name: "first test kit sample metrics",
    file: "main",
    text: "## Sample Metric Entry After Manual Publishing",
  },
  {
    name: "first test kit action links",
    file: "main",
    text: "## First-Test Action Links",
  },
  {
    name: "first test kit doctor reply inbox link",
    file: "main",
    text: "- Doctor reply inbox: `/operations/doctor-reply-inbox-pack.md`",
  },
  {
    name: "first test kit production reply inbox link",
    file: "main",
    text: "- Production reply inbox: `/operations/production-reply-inbox-pack.md`",
  },
  {
    name: "first test kit launch evidence link",
    file: "main",
    text: "- Launch evidence: `/operations/launch-evidence.md`",
  },
  {
    name: "test run tracker export",
    file: "main",
    text: "drec-first-test-run-tracker.md",
  },
  {
    name: "test run tracker table",
    file: "main",
    text: "## Step Tracker",
  },
  {
    name: "test run tracker evidence links",
    file: "main",
    text: "## Evidence Source Links",
  },
  {
    name: "test run tracker production reply inbox link",
    file: "main",
    text: "- Production reply inbox: `/operations/production-reply-inbox-pack.md`",
  },
  {
    name: "test run tracker metrics closeout link",
    file: "main",
    text: "- Metrics closeout: `/operations/metrics-closeout-pack.md`",
  },
  {
    name: "cycle command center route",
    file: "main",
    text: "cycle_command_center_payload",
  },
  {
    name: "cycle command center export",
    file: "main",
    text: "drec-cycle-command-center.md",
  },
  {
    name: "cycle command center evidence",
    file: "main",
    text: "## Evidence To Collect",
  },
  {
    name: "cycle command center stop rules",
    file: "main",
    text: "## Stop Rules",
  },
  {
    name: "cycle command center UI action",
    file: "web",
    text: "download-cycle-command-center",
  },
  {
    name: "cycle command center UI endpoint",
    file: "web",
    text: "/operations/cycle-command-center.md",
  },
  {
    name: "cycle evidence ledger route",
    file: "main",
    text: "operations_cycle_evidence_ledger_csv",
  },
  {
    name: "cycle evidence ledger export",
    file: "main",
    text: "drec-cycle-evidence-ledger.csv",
  },
  {
    name: "cycle evidence ledger header",
    file: "main",
    text: "evidence_item",
  },
  {
    name: "cycle evidence ledger safety note",
    file: "main",
    text: "Ledger only. It does not approve, import, attach media, queue, schedule, publish, or send Meta requests.",
  },
  {
    name: "cycle evidence ledger UI action",
    file: "web",
    text: "download-cycle-evidence-ledger",
  },
  {
    name: "cycle evidence ledger UI endpoint",
    file: "web",
    text: "/operations/cycle-evidence-ledger.csv",
  },
  {
    name: "external setup board route",
    file: "main",
    text: "operations_external_setup_board_csv",
  },
  {
    name: "external setup board json route",
    file: "main",
    text: "operations_external_setup_board",
  },
  {
    name: "external setup board payload",
    file: "main",
    text: "external_setup_board_payload",
  },
  {
    name: "external setup board export",
    file: "main",
    text: "drec-external-setup-board.csv",
  },
  {
    name: "external setup board doctor row",
    file: "main",
    text: "Doctor approval batch",
  },
  {
    name: "external setup board safety note",
    file: "main",
    text: "External setup board only. It does not approve content, store secrets, change Fly/GitHub/Supabase/Meta settings, publish, or send Meta requests.",
  },
  {
    name: "external setup board UI action",
    file: "web",
    text: "download-external-setup-board",
  },
  {
    name: "external setup board UI endpoint",
    file: "web",
    text: "/operations/external-setup-board.csv",
  },
  {
    name: "external setup board UI loader",
    file: "web",
    text: "/operations/external-setup-board",
  },
  {
    name: "external setup board UI card",
    file: "web",
    text: "External Setup Board",
  },
  {
    name: "manual cycle qa export",
    file: "main",
    text: "drec-manual-cycle-qa.md",
  },
  {
    name: "manual cycle qa decision",
    file: "main",
    text: "## QA Decision",
  },
  {
    name: "manual cycle qa action links",
    file: "main",
    text: "## Current-Cycle Action Links",
  },
  {
    name: "manual cycle qa doctor reply inbox link",
    file: "main",
    text: "- Doctor reply inbox: `/operations/doctor-reply-inbox-pack.md`",
  },
  {
    name: "manual cycle qa production reply inbox link",
    file: "main",
    text: "- Production reply inbox: `/operations/production-reply-inbox-pack.md`",
  },
  {
    name: "daily ops checklist export",
    file: "main",
    text: "drec-daily-ops-checklist.md",
  },
  {
    name: "daily ops morning checks",
    file: "main",
    text: "## Morning Checks",
  },
  {
    name: "daily ops action links",
    file: "main",
    text: "## Current-Cycle Action Links",
  },
  {
    name: "daily ops doctor reply inbox link",
    file: "main",
    text: "- Doctor reply inbox: `/operations/doctor-reply-inbox-pack.md`",
  },
  {
    name: "daily ops production reply inbox link",
    file: "main",
    text: "- Production reply inbox: `/operations/production-reply-inbox-pack.md`",
  },
  {
    name: "daily ops scheduler recovery link",
    file: "main",
    text: "- Scheduler recovery: `/operations/scheduler-recovery-pack.md`",
  },
  {
    name: "operator pack test run checklist",
    file: "main",
    text: "## Manual Test Run Checklist",
  },
  {
    name: "content risk audit",
    file: "main",
    text: "content_risk_audit_payload",
  },
  {
    name: "operations snapshot export",
    file: "main",
    text: "drec-content-os-snapshot.csv",
  },
  {
    name: "backup recovery pack export",
    file: "main",
    text: "drec-backup-recovery-pack.md",
  },
  {
    name: "backup recovery required exports",
    file: "main",
    text: "## Required Exports",
  },
  {
    name: "backup recovery order",
    file: "main",
    text: "## Recovery Order",
  },
  {
    name: "backup degraded mode",
    file: "main",
    text: "## Degraded Mode",
  },
  {
    name: "pipeline board export",
    file: "main",
    text: "drec-content-pipeline-board.csv",
  },
  {
    name: "pipeline board status fields",
    file: "main",
    text: "pipeline_stage",
  },
  {
    name: "audit trail export",
    file: "main",
    text: "drec-audit-trail.csv",
  },
  {
    name: "audit trail actor fields",
    file: "main",
    text: '"role", "actor"',
  },
  {
    name: "creative pack export",
    file: "main",
    text: "drec-creative-pack.md",
  },
  {
    name: "creative pack production rules",
    file: "main",
    text: "## Production Rules",
  },
  {
    name: "media shot list export",
    file: "main",
    text: "drec-media-shot-list.csv",
  },
  {
    name: "media shot list rights check",
    file: "main",
    text: "Use only owned, licensed, stock-cleared, or patient-consented media",
  },
  {
    name: "asset review csv export",
    file: "main",
    text: "drec-asset-review.csv",
  },
  {
    name: "asset review worklist export",
    file: "main",
    text: "drec-asset-review-worklist.md",
  },
  {
    name: "asset safety review export",
    file: "main",
    text: "drec-asset-safety-review.md",
  },
  {
    name: "asset review session route",
    file: "main",
    text: "asset_review_session_payload",
  },
  {
    name: "asset review session export",
    file: "main",
    text: "drec-asset-review-session-pack.md",
  },
  {
    name: "asset review session chinese export",
    file: "main",
    text: "drec-asset-review-session-zh.md",
  },
  {
    name: "asset review session chinese safety",
    file: "main",
    text: "本文件只读，不会批准、入队、排程或发布任何内容",
  },
  {
    name: "doctor approval pack route",
    file: "main",
    text: "doctor_approval_pack_payload",
  },
  {
    name: "doctor approval pack export",
    file: "main",
    text: "drec-doctor-approval-pack.md",
  },
  {
    name: "doctor approval request route",
    file: "main",
    text: "doctor_approval_request_payload",
  },
  {
    name: "doctor approval request export",
    file: "main",
    text: "drec-doctor-approval-request.md",
  },
  {
    name: "doctor approval request safety",
    file: "main",
    text: "This request is read-only and does not approve, queue, schedule, publish, or send Meta requests.",
  },
  {
    name: "doctor review bridge route",
    file: "main",
    text: "doctor_review_bridge_payload",
  },
  {
    name: "doctor review bridge export",
    file: "main",
    text: "drec-doctor-review-bridge.md",
  },
  {
    name: "doctor review bridge chinese export",
    file: "main",
    text: "drec-doctor-review-bridge-zh.md",
  },
  {
    name: "doctor review bridge chinese safety",
    file: "main",
    text: "这个桥接包不会自动批准医疗内容，也不会触发发布。",
  },
  {
    name: "doctor review bridge send section",
    file: "main",
    text: "## Copy This To Doctor",
  },
  {
    name: "doctor review bridge safety",
    file: "main",
    text: "This bridge is read-only and does not approve, edit, attach media, queue, schedule, publish, or send Meta requests.",
  },
  {
    name: "doctor review bridge UI action",
    file: "web",
    text: "download-doctor-review-bridge",
  },
  {
    name: "doctor review bridge UI endpoint",
    file: "web",
    text: "/operations/doctor-review-bridge.md",
  },
  {
    name: "doctor review bridge chinese UI action",
    file: "web",
    text: "download-doctor-review-bridge-zh",
  },
  {
    name: "doctor review bridge chinese UI endpoint",
    file: "web",
    text: "/operations/doctor-review-bridge.zh.md",
  },
  {
    name: "doctor send queue route",
    file: "main",
    text: "operations_doctor_send_queue_csv",
  },
  {
    name: "doctor send queue export",
    file: "main",
    text: "drec-doctor-send-queue.csv",
  },
  {
    name: "doctor send queue tracking fields",
    file: "main",
    text: "reply_preview_result",
  },
  {
    name: "doctor send queue safety",
    file: "main",
    text: "Send queue only. It does not approve, import, attach media, queue, schedule, publish, or send Meta requests.",
  },
  {
    name: "doctor send queue UI action",
    file: "web",
    text: "download-doctor-send-queue",
  },
  {
    name: "doctor send queue UI endpoint",
    file: "web",
    text: "/operations/doctor-send-queue.csv",
  },
  {
    name: "doctor reply import route",
    file: "main",
    text: "import_doctor_replies",
  },
  {
    name: "doctor reply parser",
    file: "main",
    text: "parse_doctor_reply_blocks",
  },
  {
    name: "doctor reply polished copy parser",
    file: "main",
    text: "use_polished_copy",
  },
  {
    name: "doctor reply polished copy gate",
    file: "main",
    text: "Using polished copy requires Decision: approve and Safety: clear.",
  },
  {
    name: "doctor reply polished copy caption apply",
    file: "main",
    text: "caption:polished_copy",
  },
  {
    name: "doctor reply import safety",
    file: "main",
    text: "can apply polished copy only when the doctor explicitly says yes with Decision: approve and Safety: clear.",
  },
  {
    name: "doctor reply inbox chinese export",
    file: "main",
    text: "drec-doctor-reply-inbox-pack-zh.md",
  },
  {
    name: "doctor reply inbox chinese safety",
    file: "main",
    text: "导入医生回复不等于自动发布",
  },
  {
    name: "doctor approval pack safety",
    file: "main",
    text: "human_medical_review_only",
  },
  {
    name: "doctor decision worksheet export",
    file: "main",
    text: "drec-doctor-decision-worksheet.csv",
  },
  {
    name: "doctor decision worksheet checklist",
    file: "main",
    text: "doctor_check_no_guaranteed_outcome",
  },
  {
    name: "approval cockpit route",
    file: "main",
    text: "approval_cockpit_payload",
  },
  {
    name: "approval cockpit export",
    file: "main",
    text: "drec-approval-cockpit.md",
  },
  {
    name: "approval cockpit chinese export",
    file: "main",
    text: "drec-approval-cockpit-zh.md",
  },
  {
    name: "approval cockpit chinese safety",
    file: "main",
    text: "它只读，不会批准、进队列、排程、发布或发送 Meta 请求。",
  },
  {
    name: "approval cockpit safety",
    file: "main",
    text: "human_approval_only",
  },
  {
    name: "post approval production route",
    file: "main",
    text: "post_approval_production_payload",
  },
  {
    name: "post approval production export",
    file: "main",
    text: "drec-post-approval-production-pack.md",
  },
  {
    name: "post approval production safety",
    file: "main",
    text: "production_prep_only",
  },
  {
    name: "production handoff bridge route",
    file: "main",
    text: "production_handoff_bridge_payload",
  },
  {
    name: "production handoff bridge export",
    file: "main",
    text: "drec-production-handoff-bridge.md",
  },
  {
    name: "production handoff bridge chinese export",
    file: "main",
    text: "drec-production-handoff-bridge-zh.md",
  },
  {
    name: "production handoff bridge chinese safety",
    file: "main",
    text: "这个桥接包不会自动触发发布。",
  },
  {
    name: "production handoff bridge send section",
    file: "main",
    text: "## Copy This To Production",
  },
  {
    name: "production handoff bridge safety",
    file: "main",
    text: "This bridge is read-only and does not attach media, approve, queue, schedule, publish, or send Meta requests.",
  },
  {
    name: "production handoff bridge UI action",
    file: "web",
    text: "download-production-handoff-bridge",
  },
  {
    name: "production handoff bridge UI endpoint",
    file: "web",
    text: "/operations/production-handoff-bridge.md",
  },
  {
    name: "production handoff bridge chinese UI action",
    file: "web",
    text: "download-production-handoff-bridge-zh",
  },
  {
    name: "production handoff bridge chinese UI endpoint",
    file: "web",
    text: "/operations/production-handoff-bridge.zh.md",
  },
  {
    name: "production reply inbox pack route",
    file: "main",
    text: "production_reply_inbox_pack_payload",
  },
  {
    name: "production reply inbox pack export",
    file: "main",
    text: "drec-production-reply-inbox-pack.md",
  },
  {
    name: "production reply inbox chinese export",
    file: "main",
    text: "drec-production-reply-inbox-pack-zh.md",
  },
  {
    name: "production reply inbox chinese safety",
    file: "main",
    text: "导入制作回复后，仍需要队列审核、排程检查和 Meta dry run。",
  },
  {
    name: "production reply inbox pack safety",
    file: "main",
    text: "Production replies attach media/design URLs only after preview/import.",
  },
  {
    name: "production design worksheet route",
    file: "main",
    text: "production-design-worksheet.csv",
  },
  {
    name: "production design worksheet prompt",
    file: "main",
    text: "Clinic-safe Mandarin health education visual for DREC.",
  },
  {
    name: "production design worksheet safety",
    file: "main",
    text: "no diagnosis/prescription/guarantee claim",
  },
  {
    name: "pre schedule gate route",
    file: "main",
    text: "pre_schedule_gate_payload",
  },
  {
    name: "pre schedule gate export",
    file: "main",
    text: "drec-pre-schedule-gate.md",
  },
  {
    name: "pre schedule gate safety",
    file: "main",
    text: "read_only_schedule_readiness",
  },
  {
    name: "first publish readiness route",
    file: "main",
    text: "first_publish_readiness_payload",
  },
  {
    name: "first publish readiness asset helper",
    file: "main",
    text: "assets_ready_for_queue",
  },
  {
    name: "first publish readiness export",
    file: "main",
    text: "drec-first-publish-readiness.md",
  },
  {
    name: "first publish after approval plan payload",
    file: "main",
    text: "after_approval_plan",
  },
  {
    name: "first publish after approval plan safety",
    file: "main",
    text: "Require Decision: approve and Safety: clear before approving the first-publish asset.",
  },
  {
    name: "first publish media gate helper",
    file: "main",
    text: "first_publish_media_gate",
  },
  {
    name: "first publish media ready stage",
    file: "main",
    text: "\"media_ready\"",
  },
  {
    name: "first publish media design gate export",
    file: "main",
    text: "## Media/Design Gate",
  },
  {
    name: "first publish chinese readiness export",
    file: "main",
    text: "drec-first-publish-readiness-zh.md",
  },
  {
    name: "first publish doctor review sheet export",
    file: "main",
    text: "drec-first-publish-doctor-review-sheet-zh.md",
  },
  {
    name: "first publish doctor review sheet safety",
    file: "main",
    text: "本审核单只读，不会修改任何状态",
  },
  {
    name: "first publish media pack route",
    file: "main",
    text: "operations_first_publish_media_pack",
  },
  {
    name: "first publish carousel zip route",
    file: "main",
    text: "operations_first_publish_carousel_assets_zip",
  },
  {
    name: "first publish carousel png zip route",
    file: "main",
    text: "operations_first_publish_carousel_png_assets_zip",
  },
  {
    name: "first publish protected png preview route",
    file: "main",
    text: "operations_first_publish_carousel_preview_png",
  },
  {
    name: "first publish protected png preview safety",
    file: "main",
    text: "Preview only. This does not approve, attach, schedule, or publish.",
  },
  {
    name: "first publish media pack preview link",
    file: "main",
    text: "/operations/first-publish-carousel-preview/{slide_number}.png",
  },
  {
    name: "first publish media csv template",
    file: "main",
    text: "first_publish_media_attachment_csv",
  },
  {
    name: "first publish slide svg helper",
    file: "main",
    text: "first_publish_slide_svg",
  },
  {
    name: "first publish slide png helper",
    file: "main",
    text: "first_publish_slide_png",
  },
  {
    name: "first publish generated media urls helper",
    file: "main",
    text: "first_publish_generated_media_urls",
  },
  {
    name: "first publish public generated png route",
    file: "main",
    text: "public_first_publish_generated_slide_png",
  },
  {
    name: "first publish generated media attach route",
    file: "main",
    text: "operations_first_publish_attach_generated_media",
  },
  {
    name: "first publish approve current asset route",
    file: "main",
    text: "operations_first_publish_approve_current_asset",
  },
  {
    name: "first publish approve current asset compliance guard",
    file: "main",
    text: "Compliance check flagged this asset; revise or reject it before approval.",
  },
  {
    name: "first publish approve current asset separate gates",
    file: "main",
    text: "Media attachment, queueing, scheduling, and publishing remain separate gates.",
  },
  {
    name: "first publish approve current queue route",
    file: "main",
    text: "operations_first_publish_approve_current_queue",
  },
  {
    name: "first publish approve current queue media guard",
    file: "main",
    text: "Media/design URLs are required before queue review approval.",
  },
  {
    name: "first publish approve current queue separate gates",
    file: "main",
    text: "Scheduling and publishing remain separate gates.",
  },
  {
    name: "first publish generated media safety gate",
    file: "main",
    text: "Generated media URLs are available only after human approval and safety clear.",
  },
  {
    name: "first publish media pack safety",
    file: "main",
    text: "This ZIP does not approve, attach, schedule, or publish anything.",
  },
  {
    name: "first publish chinese markdown route",
    file: "main",
    text: "operations_first_publish_readiness_markdown_zh",
  },
  {
    name: "first publish chinese safety boundary",
    file: "main",
    text: "系统不会自动批准医疗内容",
  },
  {
    name: "first publish chinese queue csv template",
    file: "main",
    text: "下一条队列审核 CSV 模板",
  },
  {
    name: "first publish chinese schedule guidance",
    file: "main",
    text: "后续自动推进步骤",
  },
  {
    name: "first publish chinese media design section",
    file: "main",
    text: "## 媒体/设计准备",
  },
  {
    name: "first publish media safe advance action",
    file: "main",
    text: "attach_generated_media",
  },
  {
    name: "first publish chinese meta live lock",
    file: "main",
    text: "正式发布需要额外打开 META_ENABLE_PUBLISHING",
  },
  {
    name: "chinese operator center payload",
    file: "main",
    text: "chinese_operator_center_payload",
  },
  {
    name: "chinese operator center export",
    file: "main",
    text: "drec-chinese-operator-center.md",
  },
  {
    name: "chinese operator center read only safety",
    file: "main",
    text: "本中心只读，不会自动批准、排程、发布或修改 Meta 设置",
  },
  {
    name: "chinese operator center asset review link",
    file: "main",
    text: "/operations/asset-review-session.zh.md",
  },
  {
    name: "chinese operator center today runbook link",
    file: "main",
    text: "/operations/today-runbook.zh.md",
  },
  {
    name: "chinese operator center first cycle sprint link",
    file: "main",
    text: "/operations/first-cycle-sprint-pack.zh.md",
  },
  {
    name: "chinese operator center first cycle handoff link",
    file: "main",
    text: "/operations/first-cycle-handoff.zh.md",
  },
  {
    name: "chinese operator center doctor bridge link",
    file: "main",
    text: "/operations/doctor-review-bridge.zh.md",
  },
  {
    name: "chinese operator center doctor inbox link",
    file: "main",
    text: "/operations/doctor-reply-inbox-pack.zh.md",
  },
  {
    name: "chinese operator center approval cockpit link",
    file: "main",
    text: "/operations/approval-cockpit.zh.md",
  },
  {
    name: "chinese operator center production bridge link",
    file: "main",
    text: "/operations/production-handoff-bridge.zh.md",
  },
  {
    name: "chinese operator center production inbox link",
    file: "main",
    text: "/operations/production-reply-inbox-pack.zh.md",
  },
  {
    name: "chinese operator center schedule link",
    file: "main",
    text: "/operations/review-to-schedule-pack.zh.md",
  },
  {
    name: "chinese operator center publishing link",
    file: "main",
    text: "/operations/publishing-handoff.zh.md",
  },
  {
    name: "chinese operator center metrics link",
    file: "main",
    text: "/operations/metrics-closeout-pack.zh.md",
  },
  {
    name: "chinese operator center weekly cycle link",
    file: "main",
    text: "/operations/weekly-cycle-pack.zh.md",
  },
  {
    name: "chinese operator center weekly report link",
    file: "main",
    text: "/weekly-report.zh.md",
  },
  {
    name: "chinese operator center quarterly memo link",
    file: "main",
    text: "/learning/quarterly-memo.zh.md",
  },
  {
    name: "first publish readiness read only safety",
    file: "main",
    text: "This readiness pack is read-only.",
  },
  {
    name: "first publish next asset decision csv",
    file: "main",
    text: "next_asset_decision_csv",
  },
  {
    name: "first publish next queue decision csv",
    file: "main",
    text: "next_queue_decision_csv",
  },
  {
    name: "first publish decision csv shared fields",
    file: "main",
    text: "ASSET_REVIEW_DECISION_FIELDS",
  },
  {
    name: "first publish queue csv shared fields",
    file: "main",
    text: "REVIEW_QUEUE_DECISION_FIELDS",
  },
  {
    name: "first publish advance route",
    file: "main",
    text: "operations_first_publish_advance",
  },
  {
    name: "first publish advance no auto approve",
    file: "main",
    text: "This endpoint never approves assets or queue items.",
  },
  {
    name: "first publish advance generated media attach",
    file: "main",
    text: "Attached generated media URLs to the first approved clear asset.",
  },
  {
    name: "first publish advance generated media safety",
    file: "main",
    text: "It only attaches generated media to already approved clear assets",
  },
  {
    name: "first publish readiness meta blockers",
    file: "main",
    text: "facebook_blockers",
  },
  {
    name: "asset rewrite pack route",
    file: "main",
    text: "asset_rewrite_pack_payload",
  },
  {
    name: "asset rewrite pack export",
    file: "main",
    text: "drec-asset-safe-rewrite-pack.md",
  },
  {
    name: "asset rewrite pack safety",
    file: "main",
    text: "suggested_rewrite_only",
  },
  {
    name: "first cycle handoff route",
    file: "main",
    text: "first_cycle_handoff_payload",
  },
  {
    name: "first cycle handoff export",
    file: "main",
    text: "drec-first-cycle-handoff-pack.md",
  },
  {
    name: "first cycle handoff chinese export",
    file: "main",
    text: "drec-first-cycle-handoff-pack-zh.md",
  },
  {
    name: "first cycle handoff chinese safety",
    file: "main",
    text: "安全改写只改草稿文案，不等于批准。",
  },
  {
    name: "first cycle handoff safety",
    file: "main",
    text: "manual_safe_sequence",
  },
  {
    name: "first cycle handoff doctor reply inbox link",
    file: "main",
    text: "\"doctor_reply_inbox\": \"/operations/doctor-reply-inbox-pack.md\"",
  },
  {
    name: "first cycle handoff production reply inbox link",
    file: "main",
    text: "\"production_reply_inbox\": \"/operations/production-reply-inbox-pack.md\"",
  },
  {
    name: "first cycle handoff pre schedule gate link",
    file: "main",
    text: "\"pre_schedule_gate\": \"/operations/pre-schedule-gate.md\"",
  },
  {
    name: "first cycle handoff scheduler recovery link",
    file: "main",
    text: "\"scheduler_recovery\": \"/operations/scheduler-recovery-pack.md\"",
  },
  {
    name: "first cycle sprint pack route",
    file: "main",
    text: "first_cycle_sprint_pack_payload",
  },
  {
    name: "first cycle sprint chinese export",
    file: "main",
    text: "drec-first-cycle-sprint-pack-zh.md",
  },
  {
    name: "first cycle sprint chinese safety",
    file: "main",
    text: "本冲刺包只读，不会触发批准、素材导入、排程或发布。",
  },
  {
    name: "doctor review polish pack route",
    file: "main",
    text: "doctor_review_polish_pack_payload",
  },
  {
    name: "doctor review polish pack export",
    file: "main",
    text: "drec-doctor-review-polish-pack.md",
  },
  {
    name: "doctor review polish pack safety",
    file: "main",
    text: "This pack is read-only and suggested-copy only.",
  },
  {
    name: "doctor reply inbox pack route",
    file: "main",
    text: "doctor_reply_inbox_pack_payload",
  },
  {
    name: "doctor reply inbox pack export",
    file: "main",
    text: "drec-doctor-reply-inbox-pack.md",
  },
  {
    name: "doctor reply inbox pack safety",
    file: "main",
    text: "Preview is required before import.",
  },
  {
    name: "first cycle sprint pack export",
    file: "main",
    text: "drec-first-cycle-sprint-pack.md",
  },
  {
    name: "first cycle sprint pack safety",
    file: "main",
    text: "This sprint pack is read-only and does not approve, attach media, queue, schedule, publish, or send Meta requests.",
  },
  {
    name: "first cycle sprint doctor reply inbox link",
    file: "main",
    text: "\"doctor_reply_inbox\": \"/operations/doctor-reply-inbox-pack.md\"",
  },
  {
    name: "first cycle sprint production reply inbox link",
    file: "main",
    text: "\"production_reply_inbox\": \"/operations/production-reply-inbox-pack.md\"",
  },
  {
    name: "first cycle sprint tracker route",
    file: "main",
    text: "operations_first_cycle_sprint_tracker_csv",
  },
  {
    name: "first cycle sprint tracker export",
    file: "main",
    text: "drec-first-cycle-sprint-tracker.csv",
  },
  {
    name: "first cycle sprint tracker safety",
    file: "main",
    text: "Tracker only. Import doctor replies and production replies through the preview flows",
  },
  {
    name: "today runbook route",
    file: "main",
    text: "today_runbook_payload",
  },
  {
    name: "today runbook export",
    file: "main",
    text: "drec-today-runbook.md",
  },
  {
    name: "today runbook chinese export",
    file: "main",
    text: "drec-today-runbook-zh.md",
  },
  {
    name: "today runbook chinese sequence",
    file: "main",
    text: "推荐执行顺序",
  },
  {
    name: "today runbook safety",
    file: "main",
    text: "read_only_operator_sequence",
  },
  {
    name: "today runbook doctor polish link",
    file: "main",
    text: "\"doctor_review_polish\": \"/operations/doctor-review-polish-pack.md\"",
  },
  {
    name: "today runbook doctor reply inbox link",
    file: "main",
    text: "\"doctor_reply_inbox\": \"/operations/doctor-reply-inbox-pack.md\"",
  },
  {
    name: "today runbook production reply inbox link",
    file: "main",
    text: "\"production_reply_inbox\": \"/operations/production-reply-inbox-pack.md\"",
  },
  {
    name: "today runbook production bridge link",
    file: "main",
    text: "\"production_handoff_bridge\": \"/operations/production-handoff-bridge.md\"",
  },
  {
    name: "today runbook scheduler recovery link",
    file: "main",
    text: "\"scheduler_recovery\": \"/operations/scheduler-recovery-pack.md\"",
  },
  {
    name: "today runbook doctor bridge sequence",
    file: "main",
    text: "Use the doctor review bridge or polish pack to send review-ready Mandarin copy to the doctor.",
  },
  {
    name: "today runbook production bridge sequence",
    file: "main",
    text: "Use the production handoff bridge, production pack, and media attachment CSV for design/media URLs.",
  },
  {
    name: "today runbook reply inbox sequence",
    file: "main",
    text: "Use the doctor reply inbox pack to paste returned doctor decisions through preview before import.",
  },
  {
    name: "asset rewrite apply route",
    file: "main",
    text: "/assets/{asset_id}/caption",
  },
  {
    name: "asset media attach route",
    file: "main",
    text: "/assets/{asset_id}/media",
  },
  {
    name: "asset media attach safety",
    file: "main",
    text: "Human approval, queueing, scheduling, and publishing remain separate gates.",
  },
  {
    name: "asset media attachment csv export",
    file: "main",
    text: "drec-asset-media-attachments.csv",
  },
  {
    name: "asset media attachment import route",
    file: "main",
    text: "import_asset_media_attachments",
  },
  {
    name: "production reply import route",
    file: "main",
    text: "import_production_replies",
  },
  {
    name: "production reply parser",
    file: "main",
    text: "parse_production_reply_blocks",
  },
  {
    name: "production reply import safety",
    file: "main",
    text: "It does not approve assets, queue, schedule, publish, or send Meta requests.",
  },
  {
    name: "production design worksheet import route",
    file: "main",
    text: "import_production_design_worksheet",
  },
  {
    name: "asset media attachment import dry run",
    file: "main",
    text: "Previewed {len(planned)} {source_label} row(s)",
  },
  {
    name: "asset media attachment import safety",
    file: "main",
    text: "Importing media/design URLs does not approve assets.",
  },
  {
    name: "asset rewrite apply audit",
    file: "main",
    text: "Safe caption rewrite applied; human approval still required.",
  },
  {
    name: "asset rewrite bulk audit",
    file: "main",
    text: "Bulk safe rewrite applied; human approval still required.",
  },
  {
    name: "asset review decisions export",
    file: "main",
    text: "drec-asset-review-decisions.csv",
  },
  {
    name: "asset review decisions human fields",
    file: "main",
    text: "reviewer_safety_decision",
  },
  {
    name: "asset review decisions import route",
    file: "main",
    text: "import_asset_review_decisions",
  },
  {
    name: "asset review decisions import dry run",
    file: "main",
    text: "Previewed {len(planned)} asset review decision(s)",
  },
  {
    name: "asset review decisions safety approval guard",
    file: "main",
    text: "Approval requires reviewer_safety_decision=clear",
  },
  {
    name: "asset review decision import pack section",
    file: "main",
    text: "## Review Decision CSV Import",
  },
  {
    name: "asset safety review checklist",
    file: "main",
    text: "## Human Review Checklist",
  },
  {
    name: "asset review worklist sections",
    file: "main",
    text: "## Briefs To Save As Assets",
  },
  {
    name: "review log export",
    file: "main",
    text: "drec-review-log.md",
  },
  {
    name: "review log audit trail",
    file: "main",
    text: "## Recent Decisions",
  },
  {
    name: "editorial qa pack export",
    file: "main",
    text: "drec-editorial-qa-pack.md",
  },
  {
    name: "editorial qa pack rules",
    file: "main",
    text: "## QA Rules",
  },
  {
    name: "review queue csv export",
    file: "main",
    text: "drec-review-queue.csv",
  },
  {
    name: "review queue decisions export",
    file: "main",
    text: "drec-review-queue-decisions.csv",
  },
  {
    name: "review queue decisions import route",
    file: "main",
    text: "import_review_queue_decisions",
  },
  {
    name: "review queue decisions safety",
    file: "main",
    text: "Importing queue review decisions does not schedule or publish items.",
  },
  {
    name: "review to schedule pack export",
    file: "main",
    text: "drec-review-to-schedule-pack.md",
  },
  {
    name: "review to schedule chinese pack export",
    file: "main",
    text: "drec-review-to-schedule-pack-zh.md",
  },
  {
    name: "review to schedule chinese safety",
    file: "main",
    text: "本文件只读，不会自动批准、排程、发布或发送 Meta 请求",
  },
  {
    name: "review to schedule safe sequence",
    file: "main",
    text: "## Safe Sequence",
  },
  {
    name: "review to schedule operator pack section",
    file: "main",
    text: "## Review-To-Schedule Pack",
  },
  {
    name: "learning snapshot export",
    file: "main",
    text: "drec-learning-snapshot.csv",
  },
  {
    name: "learning snapshot raw metrics",
    file: "main",
    text: "raw_metric",
  },
  {
    name: "quarterly memo route",
    file: "main",
    text: "learning_quarterly_memo",
  },
  {
    name: "quarterly memo export",
    file: "main",
    text: "drec-quarterly-learning-memo.md",
  },
  {
    name: "chinese quarterly memo export",
    file: "main",
    text: "drec-quarterly-learning-memo-zh.md",
  },
  {
    name: "chinese quarterly memo title",
    file: "main",
    text: "# DREC 中文季度学习备忘录",
  },
  {
    name: "quarterly memo posting heat",
    file: "main",
    text: "## Posting-Time Heat",
  },
  {
    name: "chinese quarterly memo posting heat",
    file: "main",
    text: "## 发布时间热度",
  },
  {
    name: "weekly cycle pack route",
    file: "main",
    text: "operations_weekly_cycle_pack",
  },
  {
    name: "weekly cycle pack export",
    file: "main",
    text: "drec-weekly-cycle-pack.md",
  },
  {
    name: "chinese weekly cycle pack export",
    file: "main",
    text: "drec-weekly-cycle-pack-zh.md",
  },
  {
    name: "chinese weekly cycle pack title",
    file: "main",
    text: "# DREC 中文每周循环包",
  },
  {
    name: "chinese weekly cycle pack closeout rule",
    file: "main",
    text: "## 每周收尾规则",
  },
  {
    name: "weekly cycle pack closeout rule",
    file: "main",
    text: "## Weekly Closeout Rule",
  },
  {
    name: "weekly cycle pack handoff links",
    file: "main",
    text: "## Current-Cycle Handoff Links",
  },
  {
    name: "weekly cycle pack doctor reply inbox link",
    file: "main",
    text: "- Doctor reply inbox: `/operations/doctor-reply-inbox-pack.md`",
  },
  {
    name: "weekly cycle pack production reply inbox link",
    file: "main",
    text: "- Production reply inbox: `/operations/production-reply-inbox-pack.md`",
  },
  {
    name: "daily ops blocked handoff fallback",
    file: "main",
    text: 'handoff.get("blocked_items") or handoff.get("needs_review")',
  },
  {
    name: "web weekly cycle pack action",
    file: "web",
    text: "download-weekly-cycle-pack",
  },
  {
    name: "web weekly cycle pack endpoint",
    file: "web",
    text: "/operations/weekly-cycle-pack.md",
  },
  {
    name: "web chinese weekly cycle pack action",
    file: "web",
    text: "download-weekly-cycle-pack-zh",
  },
  {
    name: "web chinese weekly cycle pack endpoint",
    file: "web",
    text: "/operations/weekly-cycle-pack.zh.md",
  },
  {
    name: "metrics template export",
    file: "main",
    text: "drec-metrics-template.csv",
  },
  {
    name: "metrics closeout pack export",
    file: "main",
    text: "drec-metrics-closeout-pack.md",
  },
  {
    name: "metrics closeout chinese pack export",
    file: "main",
    text: "drec-metrics-closeout-pack-zh.md",
  },
  {
    name: "metrics closeout chinese safety",
    file: "main",
    text: "本文件只读，不会导入数据、创建 outcome 或改变学习权重",
  },
  {
    name: "metrics closeout sequence",
    file: "main",
    text: "## Closeout Sequence",
  },
  {
    name: "metrics template instructions row",
    file: "main",
    text: "row_type",
  },
  {
    name: "metrics csv import route",
    file: "main",
    text: "import_metrics_csv",
  },
  {
    name: "metrics csv import dry run",
    file: "main",
    text: "Previewed {len(planned)} importable metric row(s)",
  },
  {
    name: "metrics csv import rollup",
    file: "main",
    text: "Imported {len(imported)} metric row(s)",
  },
  {
    name: "outcome insights aggregation",
    file: "main",
    text: "outcome_insights",
  },
  {
    name: "suggested learning weights payload",
    file: "main",
    text: "suggested_learning_weights",
  },
  {
    name: "suggested learning weights helper",
    file: "main",
    text: "suggested_learning_weights_from_insights",
  },
  {
    name: "suggested learning weights safety",
    file: "main",
    text: "Reversible planning weight only. It does not approve content, schedule, publish, or change Meta settings.",
  },
  {
    name: "weekly report outcome insights",
    file: "main",
    text: "## Outcome Insights",
  },
  {
    name: "chinese weekly report export",
    file: "main",
    text: "drec-weekly-report-zh.md",
  },
  {
    name: "chinese weekly report title",
    file: "main",
    text: "# DREC 中文每周运营报告",
  },
  {
    name: "chinese weekly report read only rule",
    file: "main",
    text: "本报告只读，不会改变学习权重、创建内容或触发发布。",
  },
  {
    name: "chinese weekly report next topics",
    file: "main",
    text: "## 推荐下一周内容主题",
  },
  {
    name: "publishing run sheet export",
    file: "main",
    text: "drec-publishing-run-sheet.md",
  },
  {
    name: "publishing handoff chinese export",
    file: "main",
    text: "drec-publishing-handoff-zh.md",
  },
  {
    name: "publishing handoff chinese safety",
    file: "main",
    text: "本文件只读，不会发布、不会排程、不会修改队列",
  },
  {
    name: "publishing run sheet ready section",
    file: "main",
    text: "## Ready To Publish",
  },
  {
    name: "publishing run sheet action links",
    file: "main",
    text: "## Current-Cycle Action Links",
  },
  {
    name: "publishing run sheet doctor reply inbox link",
    file: "main",
    text: "- Doctor reply inbox: `/operations/doctor-reply-inbox-pack.md`",
  },
  {
    name: "publishing run sheet production reply inbox link",
    file: "main",
    text: "- Production reply inbox: `/operations/production-reply-inbox-pack.md`",
  },
  {
    name: "publishing run sheet metrics closeout link",
    file: "main",
    text: "- Metrics closeout: `/operations/metrics-closeout-pack.md`",
  },
  {
    name: "operator pack export",
    file: "main",
    text: "drec-operator-pack.md",
  },
  {
    name: "operator pack usability section",
    file: "main",
    text: "usability_markdown_lines(launch)",
  },
  {
    name: "operator pack action links",
    file: "main",
    text: "## Current-Cycle Action Links",
  },
  {
    name: "operator pack doctor reply inbox link",
    file: "main",
    text: "- Doctor reply inbox: `/operations/doctor-reply-inbox-pack.md`",
  },
  {
    name: "operator pack production reply inbox link",
    file: "main",
    text: "- Production reply inbox: `/operations/production-reply-inbox-pack.md`",
  },
  {
    name: "operator pack scheduler recovery link",
    file: "main",
    text: "- Scheduler recovery: `/operations/scheduler-recovery-pack.md`",
  },
  {
    name: "operator pack meta oauth section",
    file: "main",
    text: "## Meta OAuth Guide",
  },
  {
    name: "operator pack rls section",
    file: "main",
    text: "## Supabase RLS Hardening",
  },
  {
    name: "meta setup checklist route",
    file: "main",
    text: "meta_setup_checklist",
  },
  {
    name: "meta oauth guide route",
    file: "main",
    text: "meta_oauth_guide",
  },
  {
    name: "meta oauth dialog url",
    file: "main",
    text: "dialog/oauth",
  },
  {
    name: "meta credential intake pack route",
    file: "main",
    text: "meta_credential_intake_pack",
  },
  {
    name: "meta preflight audit route",
    file: "main",
    text: "meta_preflight_audit",
  },
  {
    name: "meta preflight audit export",
    file: "main",
    text: "drec-meta-preflight-audit.md",
  },
  {
    name: "meta preflight audit read only safety",
    file: "main",
    text: "does not enable live switches",
  },
  {
    name: "meta page token functional fallback",
    file: "main",
    text: "permission_proof_status",
  },
  {
    name: "meta direct page token fallback message",
    file: "main",
    text: "Page token can access the configured Facebook Page",
  },
  {
    name: "meta graph post retry helper",
    file: "main",
    text: "meta_post_with_retry",
  },
  {
    name: "facebook photo publish endpoint support",
    file: "main",
    text: "endpoint = \"photos\" if media_urls else \"feed\"",
  },
  {
    name: "instagram container status wait",
    file: "main",
    text: "wait_for_instagram_container",
  },
  {
    name: "instagram finished status requirement",
    file: "main",
    text: "status_code == \"FINISHED\"",
  },
  {
    name: "meta credential wizard route",
    file: "main",
    text: "meta_credential_wizard",
  },
  {
    name: "meta credential wizard worksheet",
    file: "main",
    text: "drec-meta-credential-wizard.md",
  },
  {
    name: "meta credential wizard safety",
    file: "main",
    text: "must not contain real secret values",
  },
  {
    name: "meta credential intake pack safety",
    file: "main",
    text: "It is a checklist and evidence sheet only",
  },
  {
    name: "notification rail route",
    file: "main",
    text: "notification_rail_readiness",
  },
  {
    name: "whatsapp approval pack route",
    file: "main",
    text: "whatsapp_approval_pack",
  },
  {
    name: "notification rail no auto approve",
    file: "main",
    text: "Never auto-approve content from a WhatsApp reply",
  },
  {
    name: "web notify rail action",
    file: "web",
    text: "refresh-notify-rail",
  },
  {
    name: "web whatsapp pack action",
    file: "web",
    text: "download-whatsapp-pack",
  },
  {
    name: "web notification rail endpoint",
    file: "web",
    text: "/notifications/rail-readiness",
  },
  {
    name: "web whatsapp pack endpoint",
    file: "web",
    text: "/notifications/whatsapp-approval-pack.md",
  },
  {
    name: "knowledge context route",
    file: "main",
    text: "active_knowledge_context",
  },
  {
    name: "insight sense brief route",
    file: "main",
    text: "insight_sense_brief",
  },
  {
    name: "insight sense brief export",
    file: "main",
    text: "drec-sense-brief.md",
  },
  {
    name: "insight competitor guardrail",
    file: "main",
    text: "Competitor and ad signals are inspiration only",
  },
  {
    name: "ads planning route",
    file: "main",
    text: "ads_planning_pre_meta",
  },
  {
    name: "ads planning export",
    file: "main",
    text: "drec-ads-planning-pack.md",
  },
  {
    name: "ads no auto spend rule",
    file: "main",
    text: "The AI never changes spend or publishes ads.",
  },
  {
    name: "web insight inbox screen",
    file: "web",
    text: "Insight Inbox",
  },
  {
    name: "web sense brief endpoint",
    file: "web",
    text: "/insights/sense-brief",
  },
  {
    name: "web sense brief download endpoint",
    file: "web",
    text: "/insights/sense-brief.md",
  },
  {
    name: "web ads planning action",
    file: "web",
    text: "download-ads-planning",
  },
  {
    name: "web ads planning endpoint",
    file: "web",
    text: "/insights/ads-planning",
  },
  {
    name: "web ads planning download endpoint",
    file: "web",
    text: "/insights/ads-planning.md",
  },
  {
    name: "weekly plan uses knowledge context",
    file: "main",
    text: '"knowledge_context": knowledge',
  },
  {
    name: "creative draft stores knowledge context",
    file: "main",
    text: '"knowledge_context": knowledge',
  },
  {
    name: "nightly metrics job lock",
    file: "main",
    text: "META_ENABLE_METRICS_JOB=true",
  },
  {
    name: "asset compliance model",
    file: "models",
    text: "class AssetComplianceIn",
  },
  {
    name: "queue status schema guard",
    file: "schema",
    text: "status in ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled')",
  },
  {
    name: "web workflow endpoint",
    file: "web",
    text: 'fetchJson("/workflow/status")',
  },
  {
    name: "web dashboard status helper",
    file: "web",
    text: "countByStatus",
  },
  {
    name: "web launch readiness card",
    file: "web",
    text: "launch-count",
  },
  {
    name: "web can-use readiness card",
    file: "web",
    text: "Can I Use It?",
  },
  {
    name: "web launch readiness endpoint",
    file: "web",
    text: "/operations/launch-readiness",
  },
  {
    name: "web test run checklist endpoint",
    file: "web",
    text: "/operations/test-run-checklist",
  },
  {
    name: "web test run screen jump",
    file: "web",
    text: "data-test-run-screen",
  },
  {
    name: "web inline token input",
    file: "web",
    text: "token-input",
  },
  {
    name: "web actor input",
    file: "web",
    text: "actor-input",
  },
  {
    name: "web actor auth header",
    file: "web",
    text: "X-DREC-Actor",
  },
  {
    name: "web session token storage",
    file: "web",
    text: "sessionStorage.setItem(tokenKey",
  },
  {
    name: "web token clear action",
    file: "web",
    text: "clearAccessToken",
  },
  {
    name: "web token panel refresh",
    file: "web",
    text: "saveAccessTokenFromPanel",
  },
  {
    name: "web security gate card",
    file: "web",
    text: "security-count",
  },
  {
    name: "web security gate smoke summary",
    file: "web",
    text: "securityGateSummary",
  },
  {
    name: "web security gate service role smoke copy",
    file: "web",
    text: "需运行 service-role smoke",
  },
  {
    name: "web security gate missing key copy",
    file: "web",
    text: "缺 service-role key",
  },
  {
    name: "web rls plan action",
    file: "web",
    text: "download-rls-plan",
  },
  {
    name: "web service role pack action",
    file: "web",
    text: "download-service-role-pack",
  },
  {
    name: "web access pack action",
    file: "web",
    text: "download-access-pack",
  },
  {
    name: "web access pack endpoint",
    file: "web",
    text: "/security/access-control-pack.md",
  },
  {
    name: "web rls plan endpoint",
    file: "web",
    text: "/security/rls-hardening-plan.md",
  },
  {
    name: "web service role pack endpoint",
    file: "web",
    text: "/security/service-role-install-pack.md",
  },
  {
    name: "web automation gate card",
    file: "web",
    text: "automation-count",
  },
  {
    name: "web project completion card",
    file: "web",
    text: "data-project-completion",
  },
  {
    name: "web notion carousel source card",
    file: "web",
    text: "data-notion-carousel-source",
  },
  {
    name: "web dashboard notion refresh card",
    file: "web",
    text: "data-dashboard-notion-refresh-status",
  },
  {
    name: "web dashboard notion refresh action",
    file: "web",
    text: "download-dashboard-notion-refresh",
  },
  {
    name: "web dashboard monthly action queue card",
    file: "web",
    text: "data-dashboard-monthly-action-queue",
  },
  {
    name: "web dashboard monthly action queue action",
    file: "web",
    text: "download-dashboard-monthly-action-queue",
  },
  {
    name: "web dashboard monthly doctor review action",
    file: "web",
    text: "download-dashboard-monthly-doctor-review",
  },
  {
    name: "web dashboard monthly doctor triage action",
    file: "web",
    text: "data-download-dashboard-monthly-doctor-triage",
  },
  {
    name: "web monthly doctor triage action",
    file: "web",
    text: "download-monthly-carousel-doctor-triage",
  },
  {
    name: "monthly carousel doctor triage route",
    file: "main",
    text: "monthly_carousel_doctor_triage_payload",
  },
  {
    name: "monthly carousel doctor triage safety",
    file: "main",
    text: "No item is approved by default",
  },
  {
    name: "monthly carousel doctor triage endpoint",
    file: "main",
    text: "/operations/monthly-carousel-doctor-triage.zh.md",
  },
  {
    name: "web dashboard monthly png action",
    file: "web",
    text: "download-dashboard-monthly-png-assets",
  },
  {
    name: "web dashboard monthly doctor worksheet action",
    file: "web",
    text: "download-dashboard-monthly-doctor-worksheet",
  },
  {
    name: "web dashboard doctor reply fill action",
    file: "web",
    text: "fill-dashboard-doctor-reply-template",
  },
  {
    name: "web dashboard doctor reply safe preview action",
    file: "web",
    text: "preview-dashboard-doctor-reply-safe",
  },
  {
    name: "web dashboard doctor reply safe import action",
    file: "web",
    text: "import-dashboard-doctor-reply-safe",
  },
  {
    name: "web dashboard doctor reply safe intake helper",
    file: "web",
    text: "importDoctorRepliesAndSafeAdvance",
  },
  {
    name: "web dashboard doctor reply inbox endpoint",
    file: "web",
    text: "/operations/doctor-reply-inbox-pack",
  },
  {
    name: "web dashboard monthly production worksheet action",
    file: "web",
    text: "download-dashboard-monthly-production-worksheet",
  },
  {
    name: "web dashboard monthly production qa action",
    file: "web",
    text: "download-dashboard-monthly-production-qa",
  },
  {
    name: "web dashboard production reply fill action",
    file: "web",
    text: "fill-dashboard-production-reply-template",
  },
  {
    name: "web dashboard production reply inbox endpoint",
    file: "web",
    text: "/operations/production-reply-inbox-pack",
  },
  {
    name: "web dashboard monthly queue readiness action",
    file: "web",
    text: "download-dashboard-monthly-queue-readiness",
  },
  {
    name: "web dashboard monthly queue execution action",
    file: "web",
    text: "download-dashboard-monthly-queue-execution",
  },
  {
    name: "web dashboard monthly queue preview action",
    file: "web",
    text: "preview-dashboard-monthly-queue-ready",
  },
  {
    name: "web dashboard monthly queue run action",
    file: "web",
    text: "run-dashboard-monthly-queue-ready",
  },
  {
    name: "web dashboard monthly safe advance preview action",
    file: "web",
    text: "preview-dashboard-monthly-safe-advance",
  },
  {
    name: "web dashboard monthly safe advance run action",
    file: "web",
    text: "run-dashboard-monthly-safe-advance",
  },
  {
    name: "web dashboard monthly queue readiness endpoint",
    file: "web",
    text: "/operations/monthly-carousel-queue-readiness.zh.md",
  },
  {
    name: "web dashboard monthly queue execution endpoint",
    file: "web",
    text: "/operations/monthly-carousel-queue-execution-pack.zh.md",
  },
  {
    name: "web dashboard monthly schedule worksheet action",
    file: "web",
    text: "download-dashboard-monthly-schedule-worksheet",
  },
  {
    name: "web dashboard monthly schedule pack action",
    file: "web",
    text: "download-dashboard-monthly-schedule-pack",
  },
  {
    name: "web dashboard schedule audit action",
    file: "web",
    text: "download-dashboard-schedule-audit",
  },
  {
    name: "web dashboard monthly publishing handoff action",
    file: "web",
    text: "download-dashboard-monthly-publishing-handoff",
  },
  {
    name: "web dashboard monthly metrics template action",
    file: "web",
    text: "download-dashboard-monthly-metrics-template",
  },
  {
    name: "web dashboard monthly metrics pack action",
    file: "web",
    text: "download-dashboard-monthly-metrics-pack",
  },
  {
    name: "web dashboard monthly learning closeout action",
    file: "web",
    text: "download-dashboard-monthly-learning-closeout",
  },
  {
    name: "web dashboard monthly learning csv action",
    file: "web",
    text: "download-dashboard-monthly-learning-csv",
  },
  {
    name: "web dashboard monthly next plan handback action",
    file: "web",
    text: "download-dashboard-monthly-next-plan-handback",
  },
  {
    name: "web dashboard monthly next plan csv action",
    file: "web",
    text: "download-dashboard-monthly-next-plan-csv",
  },
  {
    name: "web notion carousel source action",
    file: "web",
    text: "refresh-notion-carousel-source",
  },
  {
    name: "web notion monthly refresh action",
    file: "web",
    text: "download-notion-monthly-refresh",
  },
  {
    name: "web notion monthly refresh endpoint",
    file: "web",
    text: "/notion/monthly-refresh-workbench.zh.md",
  },
  {
    name: "web notion carousel workflow endpoint",
    file: "web",
    text: "/notion/carousel-image-workflow.md",
  },
  {
    name: "web notion connector fallback action",
    file: "web",
    text: "download-notion-connector-fallback",
  },
  {
    name: "web notion connector fallback endpoint",
    file: "web",
    text: "/notion/connector-fallback-pack.md",
  },
  {
    name: "web notion carousel template endpoint",
    file: "web",
    text: "/notion/carousel-intake-template.csv",
  },
  {
    name: "web access role card",
    file: "web",
    text: "access-role-count",
  },
  {
    name: "web access policy endpoint",
    file: "web",
    text: "/security/access-policy",
  },
  {
    name: "web operations snapshot action",
    file: "web",
    text: "download-snapshot",
  },
  {
    name: "web backup pack action",
    file: "web",
    text: "download-backup-pack",
  },
  {
    name: "web backup pack endpoint",
    file: "web",
    text: "/operations/backup-recovery-pack.md",
  },
  {
    name: "web pipeline board action",
    file: "web",
    text: "download-pipeline-board",
  },
  {
    name: "web pipeline board endpoint",
    file: "web",
    text: "/operations/pipeline-board.csv",
  },
  {
    name: "web audit trail action",
    file: "web",
    text: "download-audit-trail",
  },
  {
    name: "web audit trail endpoint",
    file: "web",
    text: "/operations/audit-trail.csv",
  },
  {
    name: "web launch evidence action",
    file: "web",
    text: "download-launch-evidence",
  },
  {
    name: "web first test kit action",
    file: "web",
    text: "download-first-test-kit",
  },
  {
    name: "web test run tracker action",
    file: "web",
    text: "download-test-run-tracker",
  },
  {
    name: "web manual cycle qa action",
    file: "web",
    text: "download-manual-cycle-qa",
  },
  {
    name: "web daily ops action",
    file: "web",
    text: "download-daily-ops",
  },
  {
    name: "web daily ops endpoint",
    file: "web",
    text: "/operations/daily-ops-checklist.md",
  },
  {
    name: "web first test kit endpoint",
    file: "web",
    text: "/operations/first-test-kit.md",
  },
  {
    name: "web test run tracker endpoint",
    file: "web",
    text: "/operations/test-run-tracker.md",
  },
  {
    name: "web manual cycle qa endpoint",
    file: "web",
    text: "/operations/manual-cycle-qa.md",
  },
  {
    name: "web launch evidence endpoint",
    file: "web",
    text: "/operations/launch-evidence.md",
  },
  {
    name: "web content risk audit action",
    file: "web",
    text: "run-risk-audit",
  },
  {
    name: "web operator pack action",
    file: "web",
    text: "download-operator-pack",
  },
  {
    name: "web queue reuse message",
    file: "web",
    text: "Existing queue item opened.",
  },
  {
    name: "web test path helper",
    file: "web",
    text: "function testPathText()",
  },
  {
    name: "web live next test helper",
    file: "web",
    text: "function testRunNextStepText()",
  },
  {
    name: "web copy live next test step action",
    file: "web",
    text: "copy-next-test-step",
  },
  {
    name: "web test path published step",
    file: "web",
    text: "Record Published: After manual posting",
  },
  {
    name: "web test path rollup step",
    file: "web",
    text: "Save & Roll Up: Add metrics",
  },
  {
    name: "web learning topics handoff",
    file: "web",
    text: "use-topics-weekly-plan",
  },
  {
    name: "web weekly plan csv action",
    file: "web",
    text: "download-plan-csv",
  },
  {
    name: "web brief asset pack action",
    file: "web",
    text: "download-brief-asset-pack",
  },
  {
    name: "web brief asset pack endpoint",
    file: "web",
    text: "/briefs/asset-pack.md",
  },
  {
    name: "web composer linked draft endpoint",
    file: "web",
    text: "/composer/draft-post",
  },
  {
    name: "web creative studio screen",
    file: "web",
    text: "Creative Studio",
  },
  {
    name: "web creative style library endpoint",
    file: "web",
    text: "/creative/style-library",
  },
  {
    name: "web creative style guide endpoint",
    file: "web",
    text: "/creative/style-guide.md",
  },
  {
    name: "template studio library route",
    file: "main",
    text: "template_studio_library",
  },
  {
    name: "template static render pack export",
    file: "main",
    text: "drec-static-render-pack.md",
  },
  {
    name: "template render safety rule",
    file: "main",
    text: "Keep text editable until final QA",
  },
  {
    name: "web template studio screen",
    file: "web",
    text: "Template Studio",
  },
  {
    name: "web template library endpoint",
    file: "web",
    text: "/templates/library",
  },
  {
    name: "web static render pack endpoint",
    file: "web",
    text: "/templates/static-render-pack.md",
  },
  {
    name: "video studio readiness route",
    file: "main",
    text: "video_studio_readiness",
  },
  {
    name: "video sop pack export",
    file: "main",
    text: "drec-video-studio-sop-pack.md",
  },
  {
    name: "video automation future lock",
    file: "main",
    text: "DREC Cut automation remains off",
  },
  {
    name: "web video studio screen",
    file: "web",
    text: "Video Studio",
  },
  {
    name: "web video readiness endpoint",
    file: "web",
    text: "/video/studio-readiness",
  },
  {
    name: "web video sop endpoint",
    file: "web",
    text: "/video/sop-pack.md",
  },
  {
    name: "web manual reel handoff endpoint",
    file: "web",
    text: "/video/manual-reel-handoff.zh.md",
  },
  {
    name: "web manual reel handoff csv endpoint",
    file: "web",
    text: "/video/manual-reel-handoff.csv",
  },
  {
    name: "web composer target signal",
    file: "web",
    text: "target_signal",
  },
  {
    name: "web weekly plan csv endpoint",
    file: "web",
    text: "/briefs/plan.csv",
  },
  {
    name: "web weekly report download action",
    file: "web",
    text: "download-weekly-report",
  },
  {
    name: "web weekly report download endpoint",
    file: "web",
    text: "/weekly-report.md",
  },
  {
    name: "web chinese weekly report download action",
    file: "web",
    text: "download-weekly-report-zh",
  },
  {
    name: "web chinese weekly report endpoint",
    file: "web",
    text: "/weekly-report.zh.md",
  },
  {
    name: "web learning snapshot action",
    file: "web",
    text: "download-learning-snapshot",
  },
  {
    name: "web learning snapshot endpoint",
    file: "web",
    text: "/operations/learning-snapshot.csv",
  },
  {
    name: "web quarterly memo action",
    file: "web",
    text: "download-quarterly-memo",
  },
  {
    name: "web quarterly memo endpoint",
    file: "web",
    text: "/learning/quarterly-memo.md",
  },
  {
    name: "web chinese quarterly memo action",
    file: "web",
    text: "download-quarterly-memo-zh",
  },
  {
    name: "web chinese quarterly memo endpoint",
    file: "web",
    text: "/learning/quarterly-memo.zh.md",
  },
  {
    name: "web quarterly memo loader",
    file: "web",
    text: "/learning/quarterly-memo",
  },
  {
    name: "web suggested learning weights card",
    file: "web",
    text: "Suggested Learning Weights",
  },
  {
    name: "web suggested learning weights action",
    file: "web",
    text: "data-create-learning-suggestion",
  },
  {
    name: "web suggested learning weights state",
    file: "web",
    text: "latestLearningWeightSuggestions",
  },
  {
    name: "web suggested learning weights source",
    file: "web",
    text: "suggested_from_outcome_signal",
  },
  {
    name: "api accepts suggested learning weight source",
    file: "models",
    text: "\"suggested_from_outcome_signal\"",
  },
  {
    name: "api accepts outcome channel weight dimension",
    file: "models",
    text: "\"channel\"",
  },
  {
    name: "api accepts outcome funnel stage weight dimension",
    file: "models",
    text: "\"funnel_stage\"",
  },
  {
    name: "api accepts outcome audience weight dimension",
    file: "models",
    text: "\"audience_label\"",
  },
  {
    name: "web metrics template action",
    file: "web",
    text: "download-metrics-template",
  },
  {
    name: "web metrics closeout action",
    file: "web",
    text: "download-metrics-closeout",
  },
  {
    name: "web metrics closeout endpoint",
    file: "web",
    text: "/operations/metrics-closeout-pack.md",
  },
  {
    name: "web metrics closeout chinese action",
    file: "web",
    text: "download-metrics-closeout-zh",
  },
  {
    name: "web metrics closeout chinese endpoint",
    file: "web",
    text: "/operations/metrics-closeout-pack.zh.md",
  },
  {
    name: "web publishing closeout action",
    file: "web",
    text: "download-publishing-closeout-zh",
  },
  {
    name: "web publishing closeout endpoint",
    file: "web",
    text: "/operations/publishing-closeout",
  },
  {
    name: "web post-publish next steps action",
    file: "web",
    text: "download-post-publish-next-steps",
  },
  {
    name: "web post-publish next steps endpoint",
    file: "web",
    text: "/operations/post-publish-next-steps.zh.md",
  },
  {
    name: "web post-publish metrics template action",
    file: "web",
    text: "download-post-publish-metrics-template",
  },
  {
    name: "web post-publish metrics template endpoint",
    file: "web",
    text: "/operations/post-publish-metrics-template.csv",
  },
  {
    name: "web simple operator publishing handoff action",
    file: "web",
    text: "data-simple-download-handoff",
  },
  {
    name: "web simple operator today safe pack action",
    file: "web",
    text: "data-simple-download-today-pack",
  },
  {
    name: "web simple operator today safe pack endpoint",
    file: "web",
    text: "/operations/today-safe-operator-pack.zip",
  },
  {
    name: "today safe pack includes service role guide",
    file: "main",
    text: "08-service-role-install-pack.md",
  },
  {
    name: "today safe pack service role blocker copy",
    file: "main",
    text: "解除 93% 卡点",
  },
  {
    name: "today safe pack includes completion audit",
    file: "main",
    text: "09-project-completion-audit.json",
  },
  {
    name: "today safe pack includes unblock board",
    file: "main",
    text: "10-project-unblock-board.json",
  },
  {
    name: "web simple operator today safe pack copy",
    file: "web",
    text: "下载今日安全包",
  },
  {
    name: "web simple operator safe action center copy",
    file: "web",
    text: "安全操作中心",
  },
  {
    name: "web simple operator no auto meta publish copy",
    file: "web",
    text: "系统不会自动发到 Facebook / Instagram",
  },
  {
    name: "web simple operator scheduled queue fallback",
    file: "web",
    text: "loopScheduledQueue",
  },
  {
    name: "web simple operator reel handoff action",
    file: "web",
    text: "data-simple-download-reel",
  },
  {
    name: "web simple operator post-publish action",
    file: "web",
    text: "data-simple-download-post-publish",
  },
  {
    name: "web simple operator post metrics action",
    file: "web",
    text: "data-simple-download-post-metrics",
  },
  {
    name: "web simple operator reel handoff endpoint",
    file: "web",
    text: "/video/manual-reel-handoff.zh.md",
  },
  {
    name: "web manual publish record label",
    file: "web",
    text: "记录人工发布",
  },
  {
    name: "web manual publish prompt safety copy",
    file: "web",
    text: "这里不会自动发帖",
  },
  {
    name: "web publishing closeout renderer",
    file: "web",
    text: "renderPublishingCloseout",
  },
  {
    name: "web metrics template endpoint",
    file: "web",
    text: "/operations/metrics-template.csv",
  },
  {
    name: "web learning topics helper",
    file: "web",
    text: "loadLearningTopicsIntoPlan",
  },
  {
    name: "web outcome insights card",
    file: "web",
    text: "Outcome Insights",
  },
  {
    name: "web suggested slot action",
    file: "web",
    text: "schedule-next",
  },
  {
    name: "web queue cancel action",
    file: "web",
    text: "data-cancel-queue-item",
  },
  {
    name: "web queue cancel handler",
    file: "web",
    text: "cancelQueueItem",
  },
  {
    name: "web first publish readiness card",
    file: "web",
    text: "first-publish-readiness",
  },
  {
    name: "web first publish next action card",
    file: "web",
    text: "First Publish Next Action",
  },
  {
    name: "web first publish doctor review copy",
    file: "web",
    text: "data-copy-first-asset-review",
  },
  {
    name: "web first publish doctor reply fill",
    file: "web",
    text: "data-fill-first-doctor-reply",
  },
  {
    name: "web first publish approve current asset action",
    file: "web",
    text: "data-approve-current-first-asset",
  },
  {
    name: "web first publish approve current asset endpoint",
    file: "web",
    text: "/operations/first-publish-approve-current-asset?dry_run=false",
  },
  {
    name: "web first publish approve current asset phrase gate",
    file: "web",
    text: "Decision: approve",
  },
  {
    name: "web first publish approve current queue action",
    file: "web",
    text: "data-approve-current-first-queue",
  },
  {
    name: "web first publish approve current queue endpoint",
    file: "web",
    text: "/operations/first-publish-approve-current-queue?dry_run=false",
  },
  {
    name: "web first publish approve current queue phrase gate",
    file: "web",
    text: "reviewer_action=approve",
  },
  {
    name: "web first publish approval phrase helper",
    file: "web",
    text: "requireFirstPublishPhrase",
  },
  {
    name: "web first publish doctor reply template",
    file: "web",
    text: "firstPublishDoctorReplyTemplate",
  },
  {
    name: "web first publish chinese doctor review text",
    file: "web",
    text: "DREC 首次发布医生/人工审核请求",
  },
  {
    name: "web first publish success standard",
    file: "web",
    text: "Safety: clear + Decision: approve",
  },
  {
    name: "web first publish media stage translation",
    file: "web",
    text: "媒体/设计素材已准备好",
  },
  {
    name: "web first publish media pack action",
    file: "web",
    text: "data-download-first-media-pack",
  },
  {
    name: "web first publish carousel zip action",
    file: "web",
    text: "data-download-first-carousel-zip",
  },
  {
    name: "web first publish carousel png zip action",
    file: "web",
    text: "data-download-first-carousel-png-zip",
  },
  {
    name: "web first publish attach generated media action",
    file: "web",
    text: "data-attach-first-generated-media",
  },
  {
    name: "web first publish attach generated media endpoint",
    file: "web",
    text: "/operations/first-publish-attach-generated-media?dry_run=false",
  },
  {
    name: "web first publish attach generated media chinese",
    file: "web",
    text: "挂载生成图片链接",
  },
  {
    name: "web first publish preview card",
    file: "web",
    text: "First Publish Image Preview",
  },
  {
    name: "web first publish preview endpoint",
    file: "web",
    text: "/operations/first-publish-carousel-preview/",
  },
  {
    name: "web first publish preview blob auth",
    file: "web",
    text: "URL.createObjectURL(await response.blob())",
  },
  {
    name: "web first publish preview styling",
    file: "styles",
    text: "first-publish-preview-grid",
  },
  {
    name: "web first publish media pack endpoint",
    file: "web",
    text: "/operations/first-publish-media-pack.md",
  },
  {
    name: "web first publish carousel zip endpoint",
    file: "web",
    text: "/operations/first-publish-carousel-assets.zip",
  },
  {
    name: "web first publish carousel png zip endpoint",
    file: "web",
    text: "/operations/first-publish-carousel-png-assets.zip",
  },
  {
    name: "web first publish readiness loader",
    file: "web",
    text: "loadFirstPublishReadiness",
  },
  {
    name: "web first publish readiness action",
    file: "web",
    text: "download-first-publish-readiness",
  },
  {
    name: "web first publish chinese readiness action",
    file: "web",
    text: "download-first-publish-readiness-zh",
  },
  {
    name: "web first publish chinese readiness endpoint",
    file: "web",
    text: "/operations/first-publish-readiness.zh.md",
  },
  {
    name: "web first publish doctor review sheet action",
    file: "web",
    text: "data-download-first-doctor-review-sheet",
  },
  {
    name: "web first publish doctor review sheet endpoint",
    file: "web",
    text: "/operations/first-publish-doctor-review-sheet.zh.md",
  },
  {
    name: "web first publish approval workbench card",
    file: "web",
    text: "data-first-publish-approval-workbench",
  },
  {
    name: "web first publish approval workbench safety",
    file: "web",
    text: "Do not approve, queue, schedule, or publish without explicit human safety clearance.",
  },
  {
    name: "web first publish after approval route",
    file: "web",
    text: "data-first-publish-after-approval-route",
  },
  {
    name: "web first publish after approval route title",
    file: "web",
    text: "After Approval Route",
  },
  {
    name: "web chinese operator center action",
    file: "web",
    text: "download-chinese-operator-center",
  },
  {
    name: "web chinese operator center endpoint",
    file: "web",
    text: "/operations/chinese-operator-center.md",
  },
  {
    name: "web first publish readiness endpoint",
    file: "web",
    text: "/operations/first-publish-readiness",
  },
  {
    name: "web first publish decision csv copy",
    file: "web",
    text: "data-copy-first-asset-decision",
  },
  {
    name: "web first publish decision csv fill",
    file: "web",
    text: "data-fill-first-asset-decision",
  },
  {
    name: "web first publish queue decision csv copy",
    file: "web",
    text: "data-copy-first-queue-decision",
  },
  {
    name: "web first publish queue decision csv fill",
    file: "web",
    text: "data-fill-first-queue-decision",
  },
  {
    name: "web first publish advance action",
    file: "web",
    text: "data-advance-first-publish",
  },
  {
    name: "web first publish advance endpoint",
    file: "web",
    text: "/operations/first-publish-advance",
  },
  {
    name: "web chinese language toggle",
    file: "web",
    text: "language-toggle",
  },
  {
    name: "web chinese language storage",
    file: "web",
    text: "DREC_UI_LANGUAGE",
  },
  {
    name: "web chinese title map",
    file: "web",
    text: "titleMapZh",
  },
  {
    name: "web chinese first publish translation",
    file: "web",
    text: "首次发布准备",
  },
  {
    name: "web chinese schedule approved translation",
    file: "web",
    text: "排程已审核内容",
  },
  {
    name: "web chinese meta dry run translation",
    file: "web",
    text: "测试自动发布任务",
  },
  {
    name: "web chinese meta setup controls translation",
    file: "web",
    text: "下载凭证向导",
  },
  {
    name: "web chinese scheduler controls translation",
    file: "web",
    text: "下载中文发布交接包",
  },
  {
    name: "web chinese learning controls translation",
    file: "web",
    text: "把主题放回每周计划",
  },
  {
    name: "web chinese knowledge controls translation",
    file: "web",
    text: "新增知识记录",
  },
  {
    name: "web chinese form label translation",
    file: "web",
    text: "translateDirectTextNodes",
  },
  {
    name: "web chinese placeholder translation",
    file: "web",
    text: "setPlaceholderIfMapped",
  },
  {
    name: "web chinese doctor workflow translation",
    file: "web",
    text: "下载医生审批包",
  },
  {
    name: "web chinese metrics workflow translation",
    file: "web",
    text: "保存原始数据",
  },
  {
    name: "web published metrics helper",
    file: "web",
    text: "load-published-post",
  },
  {
    name: "web save and rollup metrics action",
    file: "web",
    text: "save-rollup-metric",
  },
  {
    name: "web bulk asset action",
    file: "web",
    text: "save-all-assets",
  },
  {
    name: "web drafted brief archive action",
    file: "web",
    text: "archive-drafted-briefs",
  },
  {
    name: "web bulk asset review action",
    file: "web",
    text: "approve-clear-assets",
  },
  {
    name: "web bulk asset queue action",
    file: "web",
    text: "queue-ready-assets",
  },
  {
    name: "web asset carousel png action",
    file: "web",
    text: "data-download-asset-carousel-png",
  },
  {
    name: "web asset carousel svg action",
    file: "web",
    text: "data-download-asset-carousel-svg",
  },
  {
    name: "web asset carousel png endpoint",
    file: "web",
    text: "/carousel-png-assets.zip",
  },
  {
    name: "web creative pack action",
    file: "web",
    text: "download-creative-pack",
  },
  {
    name: "web creative pack endpoint",
    file: "web",
    text: "/operations/creative-pack.md",
  },
  {
    name: "web media shot list action",
    file: "web",
    text: "download-media-shot-list",
  },
  {
    name: "web media shot list endpoint",
    file: "web",
    text: "/operations/media-shot-list.csv",
  },
  {
    name: "web asset review csv action",
    file: "web",
    text: "download-asset-review",
  },
  {
    name: "web asset worklist action",
    file: "web",
    text: "download-asset-worklist",
  },
  {
    name: "web asset safety review action",
    file: "web",
    text: "download-asset-safety-review",
  },
  {
    name: "web asset review session action",
    file: "web",
    text: "download-asset-review-session",
  },
  {
    name: "web asset review session chinese action",
    file: "web",
    text: "download-asset-review-session-zh",
  },
  {
    name: "web asset review session chinese endpoint",
    file: "web",
    text: "/operations/asset-review-session.zh.md",
  },
  {
    name: "web doctor approval pack action",
    file: "web",
    text: "download-doctor-approval-pack",
  },
  {
    name: "web doctor approval pack endpoint",
    file: "web",
    text: "/operations/doctor-approval-pack.md",
  },
  {
    name: "web doctor approval request action",
    file: "web",
    text: "download-doctor-approval-request",
  },
  {
    name: "web doctor approval request endpoint",
    file: "web",
    text: "/operations/doctor-approval-request.md",
  },
  {
    name: "web doctor reply text input",
    file: "web",
    text: "doctor-reply-text",
  },
  {
    name: "web doctor reply polished copy preview",
    file: "web",
    text: "caption_update",
  },
  {
    name: "web doctor reply preview action",
    file: "web",
    text: "preview-doctor-replies",
  },
  {
    name: "web doctor reply import action",
    file: "web",
    text: "import-doctor-replies",
  },
  {
    name: "web doctor reply import endpoint",
    file: "web",
    text: "/operations/import-doctor-replies",
  },
  {
    name: "web doctor decision worksheet action",
    file: "web",
    text: "download-doctor-decision-worksheet",
  },
  {
    name: "web doctor decision worksheet endpoint",
    file: "web",
    text: "/operations/doctor-decision-worksheet.csv",
  },
  {
    name: "web asset review session loader",
    file: "web",
    text: "loadAssetReviewSession",
  },
  {
    name: "web approval cockpit action",
    file: "web",
    text: "download-approval-cockpit",
  },
  {
    name: "web approval cockpit loader",
    file: "web",
    text: "loadApprovalCockpit",
  },
  {
    name: "web approval cockpit endpoint",
    file: "web",
    text: "/operations/approval-cockpit",
  },
  {
    name: "web approval cockpit chinese action",
    file: "web",
    text: "download-approval-cockpit-zh",
  },
  {
    name: "web approval cockpit chinese endpoint",
    file: "web",
    text: "/operations/approval-cockpit.zh.md",
  },
  {
    name: "web post approval production action",
    file: "web",
    text: "download-post-approval-production",
  },
  {
    name: "web production design worksheet action",
    file: "web",
    text: "download-production-design-worksheet",
  },
  {
    name: "web production reply inbox action",
    file: "web",
    text: "download-production-reply-inbox",
  },
  {
    name: "web production reply inbox endpoint",
    file: "web",
    text: "/operations/production-reply-inbox-pack.md",
  },
  {
    name: "web production reply inbox chinese action",
    file: "web",
    text: "download-production-reply-inbox-zh",
  },
  {
    name: "web production reply inbox chinese endpoint",
    file: "web",
    text: "/operations/production-reply-inbox-pack.zh.md",
  },
  {
    name: "web production design worksheet preview action",
    file: "web",
    text: "preview-production-design-worksheet",
  },
  {
    name: "web production design worksheet import action",
    file: "web",
    text: "import-production-design-worksheet",
  },
  {
    name: "web post approval production loader",
    file: "web",
    text: "loadPostApprovalProduction",
  },
  {
    name: "web post approval production design copy",
    file: "web",
    text: "data-copy-production-design",
  },
  {
    name: "web post approval production design batch copy",
    file: "web",
    text: "data-copy-production-design-all",
  },
  {
    name: "web post approval production batch helper",
    file: "web",
    text: "productionBatchText",
  },
  {
    name: "web post approval production endpoint",
    file: "web",
    text: "/operations/post-approval-production",
  },
  {
    name: "web production design worksheet endpoint",
    file: "web",
    text: "/operations/production-design-worksheet.csv",
  },
  {
    name: "web production design worksheet import endpoint",
    file: "web",
    text: "/operations/import-production-design-worksheet",
  },
  {
    name: "web asset rewrite pack action",
    file: "web",
    text: "download-asset-rewrite-pack",
  },
  {
    name: "web asset rewrite pack loader",
    file: "web",
    text: "loadAssetRewritePack",
  },
  {
    name: "web first cycle handoff action",
    file: "web",
    text: "download-first-cycle-handoff",
  },
  {
    name: "web first cycle handoff chinese action",
    file: "web",
    text: "download-first-cycle-handoff-zh",
  },
  {
    name: "web first cycle handoff chinese endpoint",
    file: "web",
    text: "/operations/first-cycle-handoff.zh.md",
  },
  {
    name: "web first cycle sprint action",
    file: "web",
    text: "download-first-cycle-sprint-pack",
  },
  {
    name: "web first cycle sprint chinese action",
    file: "web",
    text: "download-first-cycle-sprint-pack-zh",
  },
  {
    name: "web first cycle sprint chinese endpoint",
    file: "web",
    text: "/operations/first-cycle-sprint-pack.zh.md",
  },
  {
    name: "web doctor review polish action",
    file: "web",
    text: "download-doctor-review-polish",
  },
  {
    name: "web doctor reply inbox action",
    file: "web",
    text: "download-doctor-reply-inbox",
  },
  {
    name: "web doctor reply inbox endpoint",
    file: "web",
    text: "/operations/doctor-reply-inbox-pack.md",
  },
  {
    name: "web doctor reply inbox chinese action",
    file: "web",
    text: "download-doctor-reply-inbox-zh",
  },
  {
    name: "web doctor reply inbox chinese endpoint",
    file: "web",
    text: "/operations/doctor-reply-inbox-pack.zh.md",
  },
  {
    name: "web doctor reply inbox board",
    file: "web",
    text: "doctor-reply-inbox",
  },
  {
    name: "web doctor reply inbox loader",
    file: "web",
    text: "loadDoctorReplyInboxPack",
  },
  {
    name: "web doctor reply inbox api endpoint",
    file: "web",
    text: "/operations/doctor-reply-inbox-pack",
  },
  {
    name: "web doctor reply inbox copy",
    file: "web",
    text: "data-copy-doctor-inbox-reply",
  },
  {
    name: "web doctor reply inbox batch copy",
    file: "web",
    text: "data-copy-doctor-inbox-all",
  },
  {
    name: "web doctor reply inbox batch helper",
    file: "web",
    text: "doctorInboxBatchText",
  },
  {
    name: "web doctor review polish board",
    file: "web",
    text: "doctor-review-polish",
  },
  {
    name: "web doctor send queue board",
    file: "web",
    text: "doctor-send-queue",
  },
  {
    name: "web doctor send queue loader",
    file: "web",
    text: "loadDoctorSendQueue",
  },
  {
    name: "web doctor send queue endpoint",
    file: "web",
    text: "/operations/doctor-review-bridge",
  },
  {
    name: "web doctor send queue copy",
    file: "web",
    text: "data-copy-doctor-send",
  },
  {
    name: "web doctor full message copy",
    file: "web",
    text: "data-copy-doctor-full-message",
  },
  {
    name: "web doctor paste-back copy",
    file: "web",
    text: "data-copy-doctor-paste-back",
  },
  {
    name: "web doctor reply template copy",
    file: "web",
    text: "data-copy-doctor-reply-template",
  },
  {
    name: "web doctor send queue batch copy",
    file: "web",
    text: "data-copy-doctor-send-all",
  },
  {
    name: "web doctor send queue batch helper",
    file: "web",
    text: "doctorSendBatchText",
  },
  {
    name: "web doctor bridge full message state",
    file: "web",
    text: "latestDoctorFullMessage",
  },
  {
    name: "web doctor bridge paste-back state",
    file: "web",
    text: "latestDoctorPasteBackTemplate",
  },
  {
    name: "web doctor review polish loader",
    file: "web",
    text: "loadDoctorReviewPolishPack",
  },
  {
    name: "web doctor review polish endpoint",
    file: "web",
    text: "/operations/doctor-review-polish-pack",
  },
  {
    name: "web doctor review polish copy",
    file: "web",
    text: "data-copy-doctor-polish",
  },
  {
    name: "web doctor review polish batch copy",
    file: "web",
    text: "data-copy-doctor-polish-all",
  },
  {
    name: "web doctor review polish batch helper",
    file: "web",
    text: "doctorPolishBatchText",
  },
  {
    name: "web doctor review polish batch safety",
    file: "web",
    text: "This copied text does not approve, attach media, queue, schedule, publish, or send Meta requests.",
  },
  {
    name: "web first cycle sprint tracker action",
    file: "web",
    text: "download-first-cycle-sprint-tracker",
  },
  {
    name: "web first cycle sprint endpoint",
    file: "web",
    text: "/operations/first-cycle-sprint-pack.md",
  },
  {
    name: "web first cycle sprint tracker endpoint",
    file: "web",
    text: "/operations/first-cycle-sprint-tracker.csv",
  },
  {
    name: "web first cycle sprint board",
    file: "web",
    text: "first-cycle-sprint",
  },
  {
    name: "web first cycle sprint loader",
    file: "web",
    text: "loadFirstCycleSprintPack",
  },
  {
    name: "web first cycle sprint renderer",
    file: "web",
    text: "renderFirstCycleSprintPack",
  },
  {
    name: "web first cycle sprint api endpoint",
    file: "web",
    text: "/operations/first-cycle-sprint-pack",
  },
  {
    name: "web first cycle sprint doctor copy",
    file: "web",
    text: "data-copy-sprint-doctor",
  },
  {
    name: "web first cycle sprint production copy",
    file: "web",
    text: "data-copy-sprint-production",
  },
  {
    name: "web first cycle sprint doctor batch copy",
    file: "web",
    text: "data-copy-sprint-doctor-all",
  },
  {
    name: "web first cycle sprint production batch copy",
    file: "web",
    text: "data-copy-sprint-production-all",
  },
  {
    name: "web first cycle sprint batch helper",
    file: "web",
    text: "sprintBatchText",
  },
  {
    name: "web first cycle handoff loader",
    file: "web",
    text: "loadFirstCycleHandoff",
  },
  {
    name: "web first cycle handoff endpoint",
    file: "web",
    text: "/operations/first-cycle-handoff",
  },
  {
    name: "web today runbook action",
    file: "web",
    text: "download-today-runbook",
  },
  {
    name: "web today runbook endpoint",
    file: "web",
    text: "/operations/today-runbook.md",
  },
  {
    name: "web today runbook chinese action",
    file: "web",
    text: "download-today-runbook-zh",
  },
  {
    name: "web today runbook chinese endpoint",
    file: "web",
    text: "/operations/today-runbook.zh.md",
  },
  {
    name: "web asset rewrite apply action",
    file: "web",
    text: "data-apply-asset-rewrite",
  },
  {
    name: "web asset rewrite apply endpoint",
    file: "web",
    text: "/caption",
  },
  {
    name: "web asset rewrite bulk action",
    file: "web",
    text: "data-apply-all-safe-rewrites",
  },
  {
    name: "web asset rewrite bulk endpoint",
    file: "web",
    text: "/assets/apply-safe-rewrites",
  },
  {
    name: "web asset review decisions action",
    file: "web",
    text: "download-asset-review-decisions",
  },
  {
    name: "web asset review decisions preview action",
    file: "web",
    text: "preview-asset-review-decisions",
  },
  {
    name: "web asset review decisions paste input",
    file: "web",
    text: "asset-review-decisions-text",
  },
  {
    name: "web asset review decisions paste preview action",
    file: "web",
    text: "preview-asset-review-decisions-text",
  },
  {
    name: "web asset review decisions paste import action",
    file: "web",
    text: "import-asset-review-decisions-text",
  },
  {
    name: "web asset review decisions import action",
    file: "web",
    text: "import-asset-review-decisions",
  },
  {
    name: "web asset review decisions import endpoint",
    file: "web",
    text: "/operations/import-asset-review-decisions",
  },
  {
    name: "web asset media attachments download action",
    file: "web",
    text: "download-asset-media-attachments",
  },
  {
    name: "web asset media attachments preview action",
    file: "web",
    text: "preview-asset-media-attachments",
  },
  {
    name: "web production reply text input",
    file: "web",
    text: "production-reply-text",
  },
  {
    name: "web production reply preview action",
    file: "web",
    text: "preview-production-replies",
  },
  {
    name: "web production reply import action",
    file: "web",
    text: "import-production-replies",
  },
  {
    name: "web production reply import endpoint",
    file: "web",
    text: "/operations/import-production-replies",
  },
  {
    name: "web asset media attachments import action",
    file: "web",
    text: "import-asset-media-attachments",
  },
  {
    name: "web asset media attachments import endpoint",
    file: "web",
    text: "/operations/import-asset-media-attachments",
  },
  {
    name: "web asset media attachments preview renderer",
    file: "web",
    text: "renderAssetMediaAttachmentPreview",
  },
  {
    name: "web asset review note action",
    file: "web",
    text: "data-copy-asset-review",
  },
  {
    name: "web next asset review card",
    file: "web",
    text: "asset-next-review",
  },
  {
    name: "web next asset review copy action",
    file: "web",
    text: "data-copy-next-asset-review",
  },
  {
    name: "web next asset review decision csv action",
    file: "web",
    text: "data-copy-next-asset-decision",
  },
  {
    name: "web next asset review fill decision csv action",
    file: "web",
    text: "data-fill-next-asset-decision",
  },
  {
    name: "web next asset review fill decision csv message",
    file: "web",
    text: "Decision CSV template filled",
  },
  {
    name: "web asset review decision csv helper",
    file: "web",
    text: "assetReviewDecisionCsvText",
  },
  {
    name: "web next asset review jump action",
    file: "web",
    text: "data-jump-next-asset-review",
  },
  {
    name: "web next asset review renderer",
    file: "web",
    text: "renderNextAssetReview",
  },
  {
    name: "web asset media attach action",
    file: "web",
    text: "data-attach-asset-media",
  },
  {
    name: "web asset media attach endpoint",
    file: "web",
    text: "/media",
  },
  {
    name: "web asset review note text",
    file: "web",
    text: "DREC Asset Safety Review Note",
  },
  {
    name: "web asset review csv endpoint",
    file: "web",
    text: "/operations/asset-review.csv",
  },
  {
    name: "web asset worklist endpoint",
    file: "web",
    text: "/operations/asset-review-worklist.md",
  },
  {
    name: "web asset safety review endpoint",
    file: "web",
    text: "/operations/asset-safety-review.md",
  },
  {
    name: "web asset review session endpoint",
    file: "web",
    text: "/operations/asset-review-session",
  },
  {
    name: "web asset rewrite pack endpoint",
    file: "web",
    text: "/operations/asset-rewrite-pack",
  },
  {
    name: "web asset review decisions endpoint",
    file: "web",
    text: "/operations/asset-review-decisions.csv",
  },
  {
    name: "web bulk approved scheduling action",
    file: "web",
    text: "schedule-approved-items",
  },
  {
    name: "web review log action",
    file: "web",
    text: "download-review-log",
  },
  {
    name: "web editorial qa action",
    file: "web",
    text: "download-editorial-qa",
  },
  {
    name: "web review to schedule action",
    file: "web",
    text: "download-review-schedule-pack",
  },
  {
    name: "web pre schedule gate action",
    file: "web",
    text: "download-pre-schedule-gate",
  },
  {
    name: "web pre schedule gate loader",
    file: "web",
    text: "loadPreScheduleGate",
  },
  {
    name: "web pre schedule gate endpoint",
    file: "web",
    text: "/operations/pre-schedule-gate",
  },
  {
    name: "web review to schedule endpoint",
    file: "web",
    text: "/operations/review-to-schedule-pack.md",
  },
  {
    name: "web review to schedule chinese action",
    file: "web",
    text: "download-review-schedule-pack-zh",
  },
  {
    name: "web review to schedule chinese endpoint",
    file: "web",
    text: "/operations/review-to-schedule-pack.zh.md",
  },
  {
    name: "web review log endpoint",
    file: "web",
    text: "/operations/review-log.md",
  },
  {
    name: "web editorial qa endpoint",
    file: "web",
    text: "/operations/editorial-qa-pack.md",
  },
  {
    name: "web review queue csv action",
    file: "web",
    text: "download-review-queue",
  },
  {
    name: "web review queue decisions action",
    file: "web",
    text: "download-review-queue-decisions",
  },
  {
    name: "web review queue decisions preview action",
    file: "web",
    text: "preview-review-queue-decisions",
  },
  {
    name: "web review queue decisions import action",
    file: "web",
    text: "import-review-queue-decisions",
  },
  {
    name: "web review queue decisions paste input",
    file: "web",
    text: "review-queue-decisions-text",
  },
  {
    name: "web review queue decisions paste preview",
    file: "web",
    text: "preview-review-queue-decisions-text",
  },
  {
    name: "web review queue decisions paste import",
    file: "web",
    text: "import-review-queue-decisions-text",
  },
  {
    name: "web review queue decisions import endpoint",
    file: "web",
    text: "/operations/import-review-queue-decisions",
  },
  {
    name: "web review queue decisions preview renderer",
    file: "web",
    text: "renderReviewQueueDecisionPreview",
  },
  {
    name: "web review queue csv endpoint",
    file: "web",
    text: "/operations/review-queue.csv",
  },
  {
    name: "web publishing run sheet action",
    file: "web",
    text: "download-run-sheet",
  },
  {
    name: "web publishing run sheet endpoint",
    file: "web",
    text: "/operations/publishing-run-sheet.md",
  },
  {
    name: "web publishing calendar action",
    file: "web",
    text: "download-calendar",
  },
  {
    name: "web publishing calendar endpoint",
    file: "web",
    text: "/publish-queue/calendar.ics",
  },
  {
    name: "web publishing schedule csv action",
    file: "web",
    text: "download-schedule-csv",
  },
  {
    name: "web schedule worksheet action",
    file: "web",
    text: "download-schedule-worksheet",
  },
  {
    name: "web schedule worksheet preview action",
    file: "web",
    text: "preview-schedule-worksheet",
  },
  {
    name: "web schedule worksheet import action",
    file: "web",
    text: "import-schedule-worksheet",
  },
  {
    name: "web schedule audit action",
    file: "web",
    text: "download-schedule-audit",
  },
  {
    name: "web schedule audit endpoint",
    file: "web",
    text: "/publish-queue/schedule-audit.md",
  },
  {
    name: "web publishing schedule csv endpoint",
    file: "web",
    text: "/publish-queue/schedule.csv",
  },
  {
    name: "web schedule worksheet endpoint",
    file: "web",
    text: "/publish-queue/schedule-worksheet.csv",
  },
  {
    name: "web schedule worksheet import endpoint",
    file: "web",
    text: "/publish-queue/import-schedule-worksheet",
  },
  {
    name: "web review queue filter",
    file: "web",
    text: "needsReviewQueue",
  },
  {
    name: "web handoff published action",
    file: "web",
    text: "data-handoff-published",
  },
  {
    name: "web handoff blockers",
    file: "web",
    text: "handoff_blockers",
  },
  {
    name: "web publishing handoff chinese action",
    file: "web",
    text: "download-publishing-handoff-zh",
  },
  {
    name: "web publishing handoff chinese endpoint",
    file: "web",
    text: "/operations/publishing-handoff.zh.md",
  },
  {
    name: "web scheduled publishing job action",
    file: "web",
    text: "dry-run-meta-publishing",
  },
  {
    name: "web metrics csv import action",
    file: "web",
    text: "import-metrics-csv",
  },
  {
    name: "web metrics csv preview action",
    file: "web",
    text: "preview-metrics-csv",
  },
  {
    name: "web metrics csv preview panel",
    file: "web",
    text: "metrics-import-preview",
  },
  {
    name: "web metrics csv preview renderer",
    file: "web",
    text: "renderMetricsImportPreview",
  },
  {
    name: "web metrics csv import endpoint",
    file: "web",
    text: "/metrics/import-csv",
  },
  {
    name: "web scheduled publishing job endpoint",
    file: "web",
    text: "/jobs/meta-publishing?dry_run=true&channel=all",
  },
  {
    name: "web meta setup checklist",
    file: "web",
    text: "/meta/setup-checklist",
  },
  {
    name: "web meta setup copy action",
    file: "web",
    text: "copy-meta-setup",
  },
  {
    name: "web meta oauth copy action",
    file: "web",
    text: "copy-meta-oauth",
  },
  {
    name: "web meta credential wizard action",
    file: "web",
    text: "download-meta-wizard",
  },
  {
    name: "web meta credential wizard endpoint",
    file: "web",
    text: "/meta/credential-wizard.md",
  },
  {
    name: "web meta credential pack action",
    file: "web",
    text: "download-meta-intake",
  },
  {
    name: "web meta activation checklist action",
    file: "web",
    text: "download-meta-activation",
  },
  {
    name: "web meta activation checklist endpoint",
    file: "web",
    text: "/meta/activation-checklist.md",
  },
  {
    name: "web meta preflight action",
    file: "web",
    text: "download-meta-preflight",
  },
  {
    name: "web meta preflight endpoint",
    file: "web",
    text: "/meta/preflight-audit.md",
  },
  {
    name: "web meta activation switchboard",
    file: "web",
    text: "Meta Activation Switchboard",
  },
  {
    name: "web meta credential pack endpoint",
    file: "web",
    text: "/meta/credential-intake-pack.md",
  },
  {
    name: "web visible meta oauth url",
    file: "web",
    text: "meta-oauth-url",
  },
  {
    name: "web visible meta setup commands",
    file: "web",
    text: "meta-setup-commands",
  },
  {
    name: "web knowledge context display",
    file: "web",
    text: "Active Knowledge Context",
  },
  {
    name: "web knowledge base csv action",
    file: "web",
    text: "download-kb-csv",
  },
  {
    name: "web knowledge base csv endpoint",
    file: "web",
    text: "/kb/export.csv",
  },
  {
    name: "web knowledge context endpoint",
    file: "web",
    text: "/kb/context",
  },
  {
    name: "web github scheduler setup",
    file: "web",
    text: "GitHub Scheduler Setup",
  },
  {
    name: "api scheduler setup payload",
    file: "main",
    text: "scheduler_setup",
  },
  {
    name: "api nightly metrics scheduler payload",
    file: "main",
    text: "nightly_metrics_scheduler",
  },
  {
    name: "api meta activation switchboard payload",
    file: "main",
    text: "activation_switchboard",
  },
  {
    name: "api meta activation checklist route",
    file: "main",
    text: "drec-meta-activation-checklist.md",
  },
  {
    name: "api scheduler github secret",
    file: "main",
    text: "required_github_secrets",
  },
  {
    name: "api scheduler heartbeat mode",
    file: "main",
    text: "safe_mode",
  },
  {
    name: "web scheduler heartbeat detail",
    file: "web",
    text: "schedulerHeartbeat.detail",
  },
  {
    name: "web nightly metrics scheduler card",
    file: "web",
    text: "Nightly Metrics Scheduler",
  },
  {
    name: "web nightly metrics scheduler switch",
    file: "web",
    text: "DREC_ENABLE_REAL_META_METRICS=true",
  },
  {
    name: "operator pack scheduler setup",
    file: "main",
    text: "## GitHub Scheduler Setup",
  },
  {
    name: "github scheduler self-check workflow",
    file: "schedulerWorkflow",
    text: "/operations/scheduler-dry-run-self-check?record_heartbeat=true",
  },
  {
    name: "github scheduler self-check publishing dry run",
    file: "main",
    text: "publishing = await meta_publishing_job(channel=\"all\", dry_run=True)",
  },
  {
    name: "github scheduler self-check metrics dry run",
    file: "main",
    text: "metrics = await nightly_meta_metrics_job(dry_run=True, limit=25, rollup=True)",
  },
  {
    name: "github scheduler skips missing token",
    file: "schedulerWorkflow",
    text: "DREC_ACCESS_TOKEN is not configured. Skipping dry-run scheduler checks.",
  },
  {
    name: "github scheduler self-check heartbeat",
    file: "schedulerWorkflow",
    text: "record_heartbeat=true",
  },
  {
    name: "real metrics workflow job",
    file: "realMetricsWorkflow",
    text: "/jobs/nightly-meta-metrics?dry_run=${DREC_METRICS_DRY_RUN}&limit=25&rollup=true",
  },
  {
    name: "real metrics workflow default dry run",
    file: "realMetricsWorkflow",
    text: "DREC_ENABLE_REAL_META_METRICS || 'false'",
  },
  {
    name: "real metrics workflow live readiness check",
    file: "realMetricsWorkflow",
    text: "/meta/readiness",
  },
  {
    name: "real metrics workflow live heartbeat",
    file: "realMetricsWorkflow",
    text: "workflow=drec-nightly-meta-metrics&mode=${DREC_METRICS_MODE}",
  },
];

const forbiddenSnippets = [
  {
    name: "project board stale review-to-schedule link",
    file: "main",
    text: "/operations/review-to-schedule-pack-zh.md",
  },
];

const routePattern = /@app\.(get|post|patch|delete)\("([^"]+)"/g;

function collectRoutes(source) {
  const routes = [];
  for (const match of source.matchAll(routePattern)) {
    routes.push(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return new Set(routes);
}

function collectInternalMarkdownLinks(source) {
  const links = new Set();
  const linkPattern = /\/(?:operations|notion|learning)[A-Za-z0-9_./-]*\.zh\.md|\/weekly-report\.zh\.md/g;
  for (const match of source.matchAll(linkPattern)) {
    links.add(match[0]);
  }
  return links;
}

function pass(name, detail = "ok") {
  console.log(`PASS ${name}: ${detail}`);
}

function fail(name, detail) {
  console.log(`FAIL ${name}: ${detail}`);
  return { name, detail };
}

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, path]) => [key, await readFile(path, "utf8")]),
  ),
);

const failures = [];
const routes = collectRoutes(sources.main);
for (const route of requiredRoutes) {
  if (routes.has(route)) {
    pass(route);
  } else {
    failures.push(fail(route, "missing route"));
  }
}

for (const check of requiredSnippets) {
  if (sources[check.file].includes(check.text)) {
    pass(check.name);
  } else {
    failures.push(fail(check.name, "missing expected code"));
  }
}

for (const check of forbiddenSnippets) {
  if (sources[check.file].includes(check.text)) {
    failures.push(fail(check.name, "forbidden stale code present"));
  } else {
    pass(check.name);
  }
}

const linkedMarkdownRoutes = new Set([
  ...collectInternalMarkdownLinks(sources.main),
  ...collectInternalMarkdownLinks(sources.web),
]);
for (const link of [...linkedMarkdownRoutes].sort()) {
  const route = `GET ${link}`;
  if (routes.has(route)) {
    pass(`internal markdown link ${link}`);
  } else {
    failures.push(fail(`internal markdown link ${link}`, "missing matching GET route"));
  }
}

if (failures.length) {
  process.exit(1);
}
