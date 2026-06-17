import { readFile } from "node:fs/promises";

const files = {
  main: "apps/api/app/main.py",
  models: "apps/api/app/models.py",
  schema: "supabase/schema.sql",
  web: "apps/web/app.js",
  schedulerWorkflow: ".github/workflows/drec-scheduler-dry-run.yml",
  realMetricsWorkflow: ".github/workflows/drec-nightly-meta-metrics.yml",
  strictRlsMigration: "supabase/migrations/20260617040906_strict_server_only_rls.sql",
};

const requiredRoutes = [
  "GET /health",
  "GET /workflow/status",
  "GET /security/status",
  "GET /security/rls-hardening-plan.md",
  "GET /automation/status",
  "GET /operations/launch-readiness",
  "GET /operations/test-run-checklist",
  "POST /operations/scheduler-heartbeat",
  "GET /operations/scheduler-activation-pack.md",
  "GET /operations/launch-evidence.md",
  "GET /operations/first-test-kit.md",
  "GET /operations/test-run-tracker.md",
  "GET /operations/manual-cycle-qa.md",
  "GET /operations/daily-ops-checklist.md",
  "GET /operations/risk-audit",
  "GET /operations/snapshot.csv",
  "GET /operations/creative-pack.md",
  "GET /operations/media-shot-list.csv",
  "GET /operations/asset-review.csv",
  "GET /operations/asset-review-worklist.md",
  "GET /operations/asset-safety-review.md",
  "GET /operations/asset-review-decisions.csv",
  "POST /operations/import-asset-review-decisions",
  "GET /operations/review-log.md",
  "GET /operations/review-queue.csv",
  "GET /operations/review-to-schedule-pack.md",
  "GET /operations/learning-snapshot.csv",
  "GET /operations/metrics-template.csv",
  "GET /operations/metrics-closeout-pack.md",
  "GET /operations/weekly-cycle-pack.md",
  "GET /operations/publishing-run-sheet.md",
  "GET /operations/operator-pack.md",
  "GET /weekly-report.md",
  "GET /meta/readiness",
  "GET /meta/oauth-guide",
  "GET /meta/setup-checklist",
  "GET /meta/credential-intake-pack.md",
  "GET /kb/export.csv",
  "GET /kb/context",
  "GET /publish-queue/suggest-slot",
  "GET /publish-queue/calendar.ics",
  "GET /publish-queue/schedule.csv",
  "GET /briefs/plan.csv",
  "GET /briefs/asset-pack.md",
  "GET /metrics/published-source",
  "POST /metrics/import-csv",
  "POST /briefs/{brief_id}/draft-asset",
  "POST /briefs/draft-assets",
  "POST /briefs/archive-drafted",
  "POST /assets/approve-clear",
  "POST /assets/queue-ready",
  "POST /assets/{asset_id}/queue",
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
    name: "publishing schedule csv export",
    file: "main",
    text: "drec-publishing-schedule.csv",
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
    name: "scheduler pack UI action",
    file: "web",
    text: "download-scheduler-pack",
  },
  {
    name: "scheduler pack UI endpoint",
    file: "web",
    text: "/operations/scheduler-activation-pack.md",
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
    name: "review queue csv export",
    file: "main",
    text: "drec-review-queue.csv",
  },
  {
    name: "review to schedule pack export",
    file: "main",
    text: "drec-review-to-schedule-pack.md",
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
    name: "weekly cycle pack closeout rule",
    file: "main",
    text: "## Weekly Closeout Rule",
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
    name: "weekly report outcome insights",
    file: "main",
    text: "## Outcome Insights",
  },
  {
    name: "publishing run sheet export",
    file: "main",
    text: "drec-publishing-run-sheet.md",
  },
  {
    name: "publishing run sheet ready section",
    file: "main",
    text: "## Ready To Publish",
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
    name: "meta credential intake pack safety",
    file: "main",
    text: "It is a checklist and evidence sheet only",
  },
  {
    name: "knowledge context route",
    file: "main",
    text: "active_knowledge_context",
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
    name: "web rls plan action",
    file: "web",
    text: "download-rls-plan",
  },
  {
    name: "web rls plan endpoint",
    file: "web",
    text: "/security/rls-hardening-plan.md",
  },
  {
    name: "web automation gate card",
    file: "web",
    text: "automation-count",
  },
  {
    name: "web operations snapshot action",
    file: "web",
    text: "download-snapshot",
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
    name: "web asset review note action",
    file: "web",
    text: "data-copy-asset-review",
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
    name: "web review to schedule action",
    file: "web",
    text: "download-review-schedule-pack",
  },
  {
    name: "web review to schedule endpoint",
    file: "web",
    text: "/operations/review-to-schedule-pack.md",
  },
  {
    name: "web review log endpoint",
    file: "web",
    text: "/operations/review-log.md",
  },
  {
    name: "web review queue csv action",
    file: "web",
    text: "download-review-queue",
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
    name: "web publishing schedule csv endpoint",
    file: "web",
    text: "/publish-queue/schedule.csv",
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
    name: "web meta credential pack action",
    file: "web",
    text: "download-meta-intake",
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
    name: "github scheduler dry-run workflow",
    file: "schedulerWorkflow",
    text: "/jobs/meta-publishing?dry_run=true&channel=all",
  },
  {
    name: "github nightly metrics dry-run workflow",
    file: "schedulerWorkflow",
    text: "/jobs/nightly-meta-metrics?dry_run=true&limit=25&rollup=true",
  },
  {
    name: "github scheduler skips missing token",
    file: "schedulerWorkflow",
    text: "DREC_ACCESS_TOKEN is not configured. Skipping dry-run scheduler checks.",
  },
  {
    name: "github scheduler heartbeat",
    file: "schedulerWorkflow",
    text: "/operations/scheduler-heartbeat",
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

const routePattern = /@app\.(get|post|patch|delete)\("([^"]+)"/g;

function collectRoutes(source) {
  const routes = [];
  for (const match of source.matchAll(routePattern)) {
    routes.push(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return new Set(routes);
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

if (failures.length) {
  process.exit(1);
}
