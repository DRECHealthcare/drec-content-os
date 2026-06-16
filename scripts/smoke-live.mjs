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
      return Boolean(data.workflow?.next_action?.title) && Array.isArray(data.workflow?.steps);
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
    name: "Meta readiness",
    url: `${apiBase}/meta/readiness`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status) && Array.isArray(data.required_permissions);
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
    name: "Web shell",
    url: webBase,
    auth: false,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("DREC") && text.includes("workflow-next") && text.includes("copy-test-path") && text.includes("save-all-assets") && text.includes("approve-clear-assets") && text.includes("queue-ready-assets") && text.includes("schedule-approved-items");
    },
  },
  {
    name: "Web script",
    url: `${webBase}/app.js`,
    auth: false,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("/workflow/status") && text.includes("Existing queue item opened") && text.includes("function testPathText()") && text.includes("schedule-next") && text.includes("load-published-post") && text.includes("/briefs/draft-assets") && text.includes("/assets/queue-ready") && text.includes("/publish-queue/schedule-approved") && text.includes("data-handoff-published");
    },
  },
];

function headersFor(check) {
  if (!check.auth) return {};
  return accessToken ? { "X-DREC-Access-Token": accessToken } : {};
}

async function runCheck(check) {
  const res = await fetch(check.url, { headers: headersFor(check) });
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
