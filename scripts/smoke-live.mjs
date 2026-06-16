const apiBase = process.env.DREC_API_BASE_URL || "https://drec-content-os-api.fly.dev";
const webBase = process.env.DREC_WEB_URL || "https://drec-content-os.vercel.app";
const accessToken = process.env.DREC_ACCESS_TOKEN || "";

const checks = [
  {
    name: "API health",
    url: `${apiBase}/health`,
    auth: false,
    validate: async (res) => {
      const data = await res.json();
      return data.ok === true && data.supabase_rest === "configured";
    },
  },
  {
    name: "Workflow status",
    url: `${apiBase}/workflow/status`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.workflow?.next_action?.title) && Array.isArray(data.workflow?.steps) && Boolean(data.security?.overall_status) && Boolean(data.automation?.overall_status);
    },
  },
  {
    name: "Security status",
    url: `${apiBase}/security/status`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status) && Array.isArray(data.checks) && data.direct_browser_supabase === "disabled_by_design";
    },
  },
  {
    name: "Weekly report",
    url: `${apiBase}/weekly-report.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("## Workflow Readiness") && text.includes("Queue-ready assets");
    },
  },
  {
    name: "Automation status",
    url: `${apiBase}/automation/status`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status) && Array.isArray(data.gates) && Object.prototype.hasOwnProperty.call(data.summary || {}, "ready_assets");
    },
  },
  {
    name: "Launch readiness",
    url: `${apiBase}/operations/launch-readiness`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status) && Array.isArray(data.stages) && Object.prototype.hasOwnProperty.call(data.summary || {}, "ready_assets");
    },
  },
  {
    name: "Test run checklist",
    url: `${apiBase}/operations/test-run-checklist`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status) && Array.isArray(data.steps) && data.steps.some((step) => step.key === "handoff");
    },
  },
  {
    name: "Content risk audit",
    url: `${apiBase}/operations/risk-audit`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status) && Array.isArray(data.items) && Object.prototype.hasOwnProperty.call(data.checked || {}, "assets");
    },
  },
  {
    name: "Operations snapshot",
    url: `${apiBase}/operations/snapshot.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("record_type,id,status,channel,format,title,created_at,detail") && text.includes("automation_gate");
    },
  },
  {
    name: "Operator pack",
    url: `${apiBase}/operations/operator-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Operator Pack") && text.includes("## Launch Readiness") && text.includes("## Content Risk Audit") && text.includes("## Publishing Handoff") && text.includes("## Weekly Operating Report");
    },
  },
  {
    name: "Meta readiness",
    url: `${apiBase}/meta/readiness`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status) && Array.isArray(data.required_permissions);
    },
  },
  {
    name: "Meta setup checklist",
    url: `${apiBase}/meta/setup-checklist`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Array.isArray(data.steps) && Array.isArray(data.setup_commands) && data.required_secrets?.includes("META_PAGE_ACCESS_TOKEN");
    },
  },
  {
    name: "Knowledge context",
    url: `${apiBase}/kb/context`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Object.prototype.hasOwnProperty.call(data, "entry_count") && Array.isArray(data.safety_rules) && Array.isArray(data.style_rules);
    },
  },
  {
    name: "Schedule suggestion",
    url: `${apiBase}/publish-queue/suggest-slot?channel=facebook`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.suggested_slot) && data.timezone === "Asia/Kuala_Lumpur";
    },
  },
  {
    name: "Published metrics source",
    url: `${apiBase}/metrics/published-source?limit=5`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Array.isArray(data.items) && Object.prototype.hasOwnProperty.call(data, "latest");
    },
  },
  {
    name: "Publishing job dry run",
    url: `${apiBase}/jobs/meta-publishing?dry_run=true&channel=all`,
    method: "POST",
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.job?.name === "meta-publishing" && data.job?.due_only === true && Array.isArray(data.results);
    },
  },
  {
    name: "Nightly metrics dry run",
    url: `${apiBase}/jobs/nightly-meta-metrics?dry_run=true&limit=5&rollup=true`,
    method: "POST",
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.mode === "dry_run" && data.job?.name === "nightly-meta-metrics" && Array.isArray(data.planned_requests);
    },
  },
  {
    name: "Web shell",
    url: webBase,
    auth: false,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("DREC") && text.includes("workflow-next") && text.includes("launch-count") && text.includes("token-input") && text.includes("copy-test-path") && text.includes("run-risk-audit") && text.includes("download-snapshot") && text.includes("download-operator-pack") && text.includes("Ready Assets") && text.includes("Learning Loop") && text.includes("Security Gate") && text.includes("Automation Gate") && text.includes("Record Published") && text.includes("Save & Roll Up") && text.includes("Use Topics In Weekly Plan") && text.includes("save-all-assets") && text.includes("archive-drafted-briefs") && text.includes("approve-clear-assets") && text.includes("queue-ready-assets") && text.includes("schedule-approved-items") && text.includes("kb-context") && text.includes("copy-meta-setup") && text.includes("dry-run-meta-publishing");
    },
  },
  {
    name: "Web script",
    url: `${webBase}/app.js`,
    auth: false,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("/workflow/status") && text.includes("/operations/launch-readiness") && text.includes("/operations/test-run-checklist") && text.includes("data-test-run-screen") && text.includes("/operations/risk-audit") && text.includes("/operations/snapshot.csv") && text.includes("/operations/operator-pack.md") && text.includes("Existing queue item opened") && text.includes("function testPathText()") && text.includes("saveAccessTokenFromPanel") && text.includes("countByStatus") && text.includes("security-count") && text.includes("automation-count") && text.includes("Record Published: After manual posting") && text.includes("Save & Roll Up: Add metrics") && text.includes("Use Topics: Send learning recommendations") && text.includes("loadLearningTopicsIntoPlan") && text.includes("needsReviewQueue") && text.includes("handoff_blockers") && text.includes("schedule-next") && text.includes("load-published-post") && text.includes("save-rollup-metric") && text.includes("/kb/context") && text.includes("Active Knowledge Context") && text.includes("/briefs/draft-assets") && text.includes("/briefs/archive-drafted") && text.includes("/assets/queue-ready") && text.includes("/publish-queue/schedule-approved") && text.includes("data-handoff-published") && text.includes("/meta/setup-checklist") && text.includes("meta-setup-commands") && text.includes("GitHub Scheduler Setup") && text.includes("scheduler_setup") && text.includes("/jobs/meta-publishing?dry_run=true&channel=all");
    },
  },
];

function headersFor(check) {
  if (!check.auth) return {};
  return accessToken ? { "X-DREC-Access-Token": accessToken } : {};
}

async function runCheck(check) {
  const res = await fetch(check.url, { method: check.method || "GET", headers: headersFor(check) });
  if (!res.ok) {
    return { ok: false, name: check.name, detail: `${res.status} ${res.statusText}` };
  }
  const valid = await check.validate(res);
  return {
    ok: valid,
    name: check.name,
    detail: valid ? "ok" : "unexpected response",
  };
}

if (!accessToken) {
  console.error("DREC_ACCESS_TOKEN is required for protected API checks.");
  process.exit(2);
}

const results = [];
for (const check of checks) {
  try {
    results.push(await runCheck(check));
  } catch (error) {
    results.push({ ok: false, name: check.name, detail: error.message });
  }
}

for (const result of results) {
  const mark = result.ok ? "PASS" : "FAIL";
  console.log(`${mark} ${result.name}: ${result.detail}`);
}

const failed = results.filter((result) => !result.ok);
if (failed.length) {
  process.exit(1);
}
