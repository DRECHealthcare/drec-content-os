import { readFile } from "node:fs/promises";

const files = {
  main: "apps/api/app/main.py",
  models: "apps/api/app/models.py",
  schema: "supabase/schema.sql",
  web: "apps/web/app.js",
  schedulerWorkflow: ".github/workflows/drec-scheduler-dry-run.yml",
};

const requiredRoutes = [
  "GET /health",
  "GET /workflow/status",
  "GET /security/status",
  "GET /automation/status",
  "GET /operations/launch-readiness",
  "GET /operations/test-run-checklist",
  "GET /operations/risk-audit",
  "GET /operations/snapshot.csv",
  "GET /operations/creative-pack.md",
  "GET /operations/review-log.md",
  "GET /operations/learning-snapshot.csv",
  "GET /operations/publishing-run-sheet.md",
  "GET /operations/operator-pack.md",
  "GET /weekly-report.md",
  "GET /meta/readiness",
  "GET /meta/setup-checklist",
  "GET /kb/context",
  "GET /publish-queue/suggest-slot",
  "GET /publish-queue/schedule.csv",
  "GET /metrics/published-source",
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
    name: "planned time publish gate",
    file: "main",
    text: "Item needs a planned publish time before Meta dispatch.",
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
    name: "automation readiness status",
    file: "main",
    text: "manual_safe_auto_blocked",
  },
  {
    name: "launch readiness status",
    file: "main",
    text: "launch_readiness_payload",
  },
  {
    name: "test run checklist route",
    file: "main",
    text: "test_run_checklist_payload",
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
    name: "meta setup checklist route",
    file: "main",
    text: "meta_setup_checklist",
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
    name: "web review log endpoint",
    file: "web",
    text: "/operations/review-log.md",
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
    name: "api scheduler github secret",
    file: "main",
    text: "required_github_secrets",
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
