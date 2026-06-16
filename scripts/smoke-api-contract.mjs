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
  "GET /weekly-report.md",
  "GET /meta/readiness",
  "GET /publish-queue/suggest-slot",
  "GET /metrics/published-source",
  "POST /briefs/{brief_id}/draft-asset",
  "POST /briefs/draft-assets",
  "POST /assets/approve-clear",
  "POST /assets/queue-ready",
  "POST /assets/{asset_id}/queue",
  "PATCH /assets/{asset_id}/compliance",
  "POST /publish-queue/{item_id}/schedule-next",
  "POST /publish-queue/schedule-approved",
  "GET /publishing-handoff",
  "POST /publishing/facebook/dispatch",
  "POST /publishing/instagram/dispatch",
  "POST /metrics/meta/ingest",
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
    name: "planned time publish gate",
    file: "main",
    text: "Item needs a planned publish time before Meta dispatch.",
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
    name: "web bulk asset action",
    file: "web",
    text: "save-all-assets",
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
