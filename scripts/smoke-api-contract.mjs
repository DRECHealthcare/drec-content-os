import { readFile } from "node:fs/promises";

const files = {
  main: "apps/api/app/main.py",
  models: "apps/api/app/models.py",
  schema: "supabase/schema.sql",
  web: "apps/web/app.js",
};

const requiredRoutes = [
  "GET /health",
  "GET /workflow/status",
  "GET /security/status",
  "GET /automation/status",
  "GET /operations/risk-audit",
  "GET /operations/snapshot.csv",
  "GET /operations/operator-pack.md",
  "GET /weekly-report.md",
  "GET /meta/readiness",
  "GET /meta/setup-checklist",
  "GET /publish-queue/suggest-slot",
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
    name: "web learning topics helper",
    file: "web",
    text: "loadLearningTopicsIntoPlan",
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
    name: "web bulk approved scheduling action",
    file: "web",
    text: "schedule-approved-items",
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
