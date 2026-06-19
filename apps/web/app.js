const apiBase = window.DREC_API_BASE_URL || localStorage.getItem("DREC_API_BASE_URL") || "https://drec-content-os-api.fly.dev";
const tokenKey = "DREC_ACCESS_TOKEN";
const actorKey = "DREC_ACTOR";
const rememberTokenKey = "DREC_REMEMBER_ACCESS_TOKEN";
let currentDraft = null;
let editingQueueItem = null;
let latestMetaSetupCommands = [];
let latestMetaOAuthUrl = "";
let latestSprintItems = [];
let latestDoctorSendItems = [];
let latestDoctorReplyItems = [];
let latestDoctorPolishItems = [];
let latestProductionItems = [];
let latestLearningWeightSuggestions = [];
let latestDoctorFullMessage = "";
let latestDoctorPasteBackTemplate = "";
let latestTestRunChecklist = null;

const titleMap = {
  dashboard: "Dashboard",
  insights: "Insight Inbox",
  plan: "Weekly Plan",
  compose: "Create A Post",
  creative: "Creative Studio",
  templates: "Template Studio",
  video: "Video Studio",
  assets: "Assets",
  review: "Review Queue",
  scheduler: "Scheduler",
  meta: "Meta Setup",
  outcomes: "Performance",
  learning: "Insights & Learning",
  kb: "Knowledge Base",
};

document.querySelectorAll("nav button").forEach((button) => {
  button.addEventListener("click", () => {
    const screen = button.dataset.screen;
    document.querySelectorAll("nav button").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".screen").forEach((item) => item.classList.toggle("active", item.id === screen));
    document.getElementById("title").textContent = titleMap[screen] || screen;
    if (screen === "insights") loadSenseBrief();
    if (screen === "insights") loadAdsPlanning();
    if (screen === "plan") loadBriefs();
    if (screen === "creative") loadStyleLibrary();
    if (screen === "templates") loadTemplateStudio();
    if (screen === "video") loadVideoStudio();
    if (screen === "assets") Promise.all([loadAssets(), loadMediaAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadAssetReviewSession(), loadAssetRewritePack()]);
    if (screen === "outcomes") loadOutcomes();
    if (screen === "learning") {
      loadLearningSummary();
      loadQuarterlyMemo();
    }
    if (screen === "scheduler" || screen === "review") Promise.all([loadPublishQueue(), loadPreScheduleGate()]);
    if (screen === "meta") Promise.all([loadMetaReadiness(), loadMetaSetupChecklist(), loadNotifyRail()]);
  });
});

function showScreen(screen) {
  const button = document.querySelector(`nav button[data-screen="${screen}"]`);
  if (button) button.click();
}

function accessToken() {
  return sessionStorage.getItem(tokenKey) || localStorage.getItem(tokenKey) || "";
}

function accessActor() {
  return sessionStorage.getItem(actorKey) || localStorage.getItem(actorKey) || "";
}

function authHeaders(includeJson = false) {
  const token = accessToken();
  const actor = accessActor();
  return {
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
    ...(token ? { "X-DREC-Access-Token": token } : {}),
    ...(actor ? { "X-DREC-Actor": actor } : {}),
  };
}

function storeAccessTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("access_token");
  if (!token) return;
  sessionStorage.setItem(tokenKey, token.trim());
  params.delete("access_token");
  const cleanQuery = params.toString();
  const cleanUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", cleanUrl);
}

function updateTokenButton() {
  const button = document.getElementById("token-button");
  button.textContent = accessToken() ? "Access set" : "Set access";
}

function refreshProtectedData() {
  updateTokenButton();
  loadLoopStatus();
  loadKb();
  loadBriefs();
  loadAssets();
  loadMediaAssets();
  loadOutcomes();
  loadLearningSummary();
  loadPublishQueue();
  loadMetaReadiness();
  loadMetaSetupChecklist();
  loadLaunchReadiness();
  loadAccessPolicy();
}

function showTokenPanel() {
  const panel = document.getElementById("token-panel");
  const input = document.getElementById("token-input");
  const actor = document.getElementById("actor-input");
  const remember = document.getElementById("token-remember");
  panel.hidden = !panel.hidden;
  input.value = accessToken();
  actor.value = accessActor();
  remember.checked = localStorage.getItem(rememberTokenKey) === "true" && Boolean(localStorage.getItem(tokenKey));
  if (!panel.hidden) input.focus();
}

function saveAccessTokenFromPanel() {
  const panel = document.getElementById("token-panel");
  const input = document.getElementById("token-input");
  const actor = document.getElementById("actor-input");
  const remember = document.getElementById("token-remember");
  const token = input.value;
  const actorName = actor.value.trim();
  sessionStorage.setItem(tokenKey, token.trim());
  sessionStorage.setItem(actorKey, actorName);
  if (remember.checked) {
    localStorage.setItem(tokenKey, token.trim());
    localStorage.setItem(actorKey, actorName);
    localStorage.setItem(rememberTokenKey, "true");
  } else {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(actorKey);
    localStorage.removeItem(rememberTokenKey);
  }
  panel.hidden = true;
  refreshProtectedData();
}

function clearAccessToken() {
  sessionStorage.removeItem(tokenKey);
  sessionStorage.removeItem(actorKey);
  localStorage.removeItem(tokenKey);
  localStorage.removeItem(actorKey);
  localStorage.removeItem(rememberTokenKey);
  document.getElementById("token-input").value = "";
  document.getElementById("actor-input").value = "";
  document.getElementById("token-remember").checked = false;
  refreshProtectedData();
}

document.getElementById("token-button").addEventListener("click", showTokenPanel);
document.getElementById("token-save").addEventListener("click", saveAccessTokenFromPanel);
document.getElementById("token-clear").addEventListener("click", clearAccessToken);
document.getElementById("token-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveAccessTokenFromPanel();
  if (event.key === "Escape") document.getElementById("token-panel").hidden = true;
});

async function fetchJson(path, options) {
  const res = await fetch(`${apiBase}${path}`, {
    headers: authHeaders(true),
    ...options,
  });
  if (res.status === 401) {
    throw new Error("Access token required");
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchForm(path, formData) {
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: authHeaders(false),
    body: formData,
  });
  if (res.status === 401) {
    throw new Error("Access token required");
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchText(path) {
  const res = await fetch(`${apiBase}${path}`, {
    headers: authHeaders(false),
  });
  if (res.status === 401) {
    throw new Error("Access token required");
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

async function downloadProtectedFile(path, filename, type) {
  const res = await fetch(`${apiBase}${path}`, {
    headers: authHeaders(false),
  });
  if (res.status === 401) {
    throw new Error("Access token required");
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(new Blob([blob], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function formatDate(value) {
  if (!value) return "No planned time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No planned time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function nextScheduleInputValue() {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return formatDatetimeLocal(date.toISOString());
}

function formatDatetimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function splitLines(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function queueFilterValues() {
  return {
    status: document.getElementById("queue-status-filter")?.value || "all",
    channel: document.getElementById("queue-channel-filter")?.value || "all",
  };
}

function filterQueueItems(items) {
  const filters = queueFilterValues();
  return items.filter((item) => {
    const statusMatch = filters.status === "all" || item.status === filters.status;
    const channelMatch = filters.channel === "all" || item.channel === filters.channel;
    return statusMatch && channelMatch;
  });
}

function mediaList(urls) {
  const items = Array.isArray(urls) ? urls.filter(Boolean) : [];
  if (!items.length) return "";
  return `
    <div class="media-list">
      <strong>Media URLs</strong>
      ${items.map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`).join("")}
    </div>
  `;
}

function draftCaption({ topic, points, stage, language, format }) {
  const pointLines = points.map((point, index) => `${index + 1}. ${point}`);
  if (language === "en") {
    return [
      `A practical way to think about ${topic}:`,
      "",
      ...pointLines,
      "",
      stage === "BOFU"
        ? "This is general education, not medical advice. If this relates to your own health, speak with a qualified clinician before changing treatment."
        : "This is general education, not a diagnosis or treatment plan.",
      "",
      format === "reel" ? "Save this before your next health check." : "Save this as a reference for your next health conversation.",
    ].join("\n");
  }

  const intro = language === "mixed"
    ? `关于 ${topic}，可以这样理解：`
    : `关于「${topic}」，可以这样理解：`;
  return [
    intro,
    "",
    ...pointLines,
    "",
    stage === "BOFU"
      ? "以上是一般健康教育，不是个人诊断或治疗建议。如与你的健康状况有关，请先咨询合格医生再调整药物、饮食或治疗。"
      : "以上是一般健康教育，不等于个人诊断或治疗方案。",
    "",
    format === "reel" ? "先收藏，下一次复诊或体检前再看。" : "可以收藏起来，下一次和医生讨论时参考。",
  ].join("\n");
}

function slidePreview(slides) {
  if (!slides?.length) return "";
  return `
    <div class="creative-preview">
      ${slides.map((slide) => `
        <article class="mini-slide">
          <span>${escapeHtml(slide.slide || "")}/6</span>
          <strong>${escapeHtml(slide.title || "")}</strong>
          <p>${escapeHtml(slide.body || "")}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function reelPreview(script) {
  if (!script?.length) return "";
  return `
    <div class="script-preview">
      ${script.map((beat) => `
        <div>
          <strong>${escapeHtml(beat.time || "")} · ${escapeHtml(beat.beat || "")}</strong>
          <p>${escapeHtml(beat.line || "")}</p>
        </div>
      `).join("")}
    </div>
  `;
}

function defaultPointsForBrief(brief) {
  const beats = brief.structure_beats || {};
  if (Array.isArray(beats.body) && beats.body.length) return beats.body;
  return [
    brief.hook_primary || `Explain ${brief.topic} simply.`,
    brief.target_signal || "Give one practical observation.",
    brief.compliance_notes || "Keep it educational and invite professional review.",
  ];
}

function queueTotal(queue) {
  return Array.isArray(queue) ? queue.reduce((sum, item) => sum + Number(item.count || 0), 0) : 0;
}

function countByStatus(rows, key, value) {
  const row = Array.isArray(rows) ? rows.find((item) => item[key] === value) : null;
  return Number(row?.count || 0);
}

function needsReviewQueue(item) {
  return item.status === "draft";
}

function workflowSteps(data) {
  const totalQueue = queueTotal(data.queue);
  const briefCount = Number(data.brief_count || 0);
  const assetCount = Number(data.asset_count || 0);
  const mediaCount = Number(data.media_count || 0);
  const outcomeCount = Number(data.outcome_count || 0);
  const steps = [];

  if (!briefCount) {
    steps.push({
      state: "open",
      title: "Generate this week's briefs",
      body: "Start from Weekly Plan so the system has topics, formats, hooks, and safety notes.",
      screen: "plan",
      action: "Open Weekly Plan",
    });
  } else {
    steps.push({
      state: "done",
      title: "Weekly briefs ready",
      body: `${briefCount} brief(s) are available for drafting.`,
      screen: "plan",
      action: "View Briefs",
    });
  }

  if (!assetCount) {
    steps.push({
      state: briefCount ? "open" : "locked",
      title: "Save one brief as an asset",
      body: "Use Save Asset on a brief to create a reusable caption package with slides or script notes.",
      screen: "plan",
      action: "Save Asset",
    });
  } else {
    steps.push({
      state: "done",
      title: "Draft assets ready",
      body: `${assetCount} asset(s) are saved for review and queueing.`,
      screen: "assets",
      action: "Review Assets",
    });
  }

  if (!totalQueue) {
    steps.push({
      state: assetCount ? "open" : "locked",
      title: "Add an asset to the queue",
      body: "Move one clear asset into Review Queue before scheduling.",
      screen: "assets",
      action: "Open Assets",
    });
  } else {
    steps.push({
      state: "done",
      title: "Queue has content",
      body: `${totalQueue} item(s) are waiting in the publishing workflow.`,
      screen: "review",
      action: "Review Queue",
    });
  }

  steps.push({
    state: totalQueue ? "open" : "locked",
    title: "Review and schedule",
    body: "Approve safe content, choose a planned publish time, then build the manual handoff.",
    screen: totalQueue ? "review" : "scheduler",
    action: totalQueue ? "Open Review" : "Open Scheduler",
  });

  steps.push({
    state: outcomeCount ? "done" : "open",
    title: "Record performance",
    body: outcomeCount
      ? `${outcomeCount} result(s) are feeding the learning loop.`
      : "After a post is published, add results so future topics improve.",
    screen: "outcomes",
    action: "Open Performance",
  });

  if (!mediaCount) {
    steps.push({
      state: "open",
      title: "Optional: add approved media",
      body: "Register owned or approved images/videos before using media-heavy posts.",
      screen: "assets",
      action: "Add Media",
      optional: true,
    });
  }

  return steps;
}

function testPathText() {
  return [
    "DREC Content OS Test Path",
    "",
    "1. Save Asset: Open Weekly Plan and save one brief as an asset.",
    "2. Safety Clear: Open Assets, mark the asset Safety Clear, then Approve.",
    "3. Add To Queue: Add that approved clear asset to the publishing queue.",
    "4. Review Approve: Open Review Queue and approve the queue item.",
    "5. Schedule: Open Scheduler, choose a planned time, and save the item.",
    "6. Build Handoff: Generate the handoff copy and check it lists one ready item.",
    "7. Record Published: After manual posting, paste the Meta post ID from the handoff ready item.",
    "8. Save & Roll Up: Add metrics under Performance, then save and roll them into learning.",
    "9. Build Report: Open Learning and build the weekly report.",
    "10. Use Topics: Send learning recommendations back into Weekly Plan.",
    "11. Meta Setup: Keep Meta in dry-run mode until real credentials and permissions are approved.",
  ].join("\n");
}

function testRunNextStepText() {
  const data = latestTestRunChecklist || {};
  const next = data.next_step || data.workflow_next_action || {};
  const label = next.label || next.title || "Follow the first open step";
  const detail = next.detail || next.body || "";
  const screen = next.screen ? `Screen: ${next.screen}` : "";
  const action = next.action ? `Action: ${next.action}` : "";
  return [
    "DREC Content OS Next Test Step",
    "",
    `Next: ${label}`,
    detail,
    screen,
    action,
    "",
    "Safety: Do not approve, queue, schedule, publish, or connect Meta unless the visible gate says the item is ready.",
  ].filter(Boolean).join("\n");
}

function renderTestRunChecklist(data) {
  const list = document.getElementById("test-path-list");
  const message = document.getElementById("test-path-message");
  if (!list || !message) return;
  latestTestRunChecklist = data;
  const steps = data.steps || [];
  const next = data.next_step || {};
  message.textContent = `${data.overall_status || "manual_cycle_in_progress"} · ${data.done_count || 0}/${data.total_required || 0} required steps done · Next: ${next.label || "Follow the first open step"}`;
  if (!steps.length) return;
  list.innerHTML = steps.map((step) => `
    <li class="test-path-step ${escapeHtml(step.status || "open")}">
      <button type="button" data-test-run-screen="${escapeHtml(step.screen || "dashboard")}">
        <strong>${escapeHtml(step.label || "")}</strong>
        <span>${escapeHtml(step.status || "open")} · ${escapeHtml(step.detail || "")}</span>
      </button>
    </li>
  `).join("");
}

async function loadTestRunChecklist() {
  const list = document.getElementById("test-path-list");
  if (!list) return;
  try {
    const data = await fetchJson("/operations/test-run-checklist");
    renderTestRunChecklist(data);
  } catch (error) {
    const message = document.getElementById("test-path-message");
    if (message) message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not load the live test checklist.";
  }
}

function renderWorkflowNext(data) {
  const container = document.getElementById("workflow-next");
  if (!container) return;
  const steps = data.steps || workflowSteps(data);
  const firstOpen = data.next_action || steps.find((step) => step.state === "open" && !step.optional) || steps.find((step) => step.state === "open") || steps[0];
  container.innerHTML = `
    <article class="workflow-primary ${escapeHtml(firstOpen.state)}">
      <div>
        <strong>${escapeHtml(firstOpen.title)}</strong>
        <p>${escapeHtml(firstOpen.body)}</p>
      </div>
      <button type="button" data-workflow-screen="${escapeHtml(firstOpen.screen)}">${escapeHtml(firstOpen.action)}</button>
    </article>
    <div class="workflow-steps">
      ${steps.map((step) => `
        <button type="button" class="workflow-step ${escapeHtml(step.state)}" data-workflow-screen="${escapeHtml(step.screen)}">
          <span>${escapeHtml(step.state)}</span>
          <strong>${escapeHtml(step.title)}</strong>
          <small>${escapeHtml(step.body)}</small>
        </button>
      `).join("")}
    </div>
  `;
}

async function loadLoopStatus() {
  try {
    const data = await fetchJson("/workflow/status");
    const loop = data.loop || data;
    const totalQueue = queueTotal(loop.queue);
    const draftQueue = countByStatus(loop.queue, "status", "draft");
    const scheduledQueue = countByStatus(loop.queue, "status", "scheduled");
    const publishedQueue = countByStatus(loop.queue, "status", "published");
    const workflowSummary = data.workflow?.summary || {};
    const security = data.security || {};
    const automation = data.automation || {};
    const readyAssets = Number(workflowSummary.queue_ready_asset_count || 0);
    const totalAssets = Number(workflowSummary.asset_count || loop.asset_count || 0);
    document.getElementById("queue-count").textContent = `${totalQueue} total · ${draftQueue} review · ${scheduledQueue} handoff · ${publishedQueue} published`;
    document.getElementById("brief-count").textContent = `${loop.brief_count || 0} brief(s)`;
    document.getElementById("asset-count").textContent = `${readyAssets} ready of ${totalAssets} asset(s)`;
    document.getElementById("media-count").textContent = `${loop.media_count || 0} media item(s)`;
    document.getElementById("outcome-count").textContent = `${loop.outcome_count || 0} outcome(s) · ${loop.weight_count || 0} active weight(s)`;
    document.getElementById("security-count").textContent = security.rls_hardening_ready ? "RLS hardening ready" : "Needs service-role key";
    document.getElementById("automation-count").textContent = `${automation.ready_count || 0} ready · ${automation.blocked_count || 0} blocked`;
    renderWorkflowNext(data.workflow || loop);
    loadLaunchReadiness();
    loadTestRunChecklist();
  } catch {
    const message = accessToken() ? "API access failed" : "Set access token";
    document.getElementById("queue-count").textContent = message;
    document.getElementById("brief-count").textContent = message;
    document.getElementById("asset-count").textContent = message;
    document.getElementById("media-count").textContent = message;
    document.getElementById("outcome-count").textContent = message;
    document.getElementById("launch-count").textContent = message;
    document.getElementById("security-count").textContent = message;
    document.getElementById("automation-count").textContent = message;
    const workflow = document.getElementById("workflow-next");
    if (workflow) workflow.innerHTML = `<p class="status-note">${escapeHtml(message)}</p>`;
  }
}

function renderLaunchReadiness(data) {
  const container = document.getElementById("launch-readiness");
  if (!container) return;
  document.getElementById("launch-count").textContent = data.overall_status || "Unknown";
  const stages = data.stages || [];
  const blockers = data.external_blockers || [];
  const setupRows = data.external_setup_rows || [];
  const usability = data.usability || {};
  const safeScope = usability.safe_test_scope || [];
  const notReadyScope = usability.not_ready_scope || [];
  container.innerHTML = `
    <article class="learning-card wide-learning launch-use-card ${data.can_auto_publish ? "ready" : data.can_test_now ? "testing" : "blocked"}">
      <h3>Can I Use It?</h3>
      <p>${escapeHtml(usability.label || "Checking readiness")}</p>
      <small>${escapeHtml(usability.detail || data.next_step || "")}</small>
      ${safeScope.length ? `
        <div class="launch-scope">
          <strong>Safe now</strong>
          <ul>${safeScope.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      ` : ""}
      ${notReadyScope.length ? `
        <div class="launch-scope">
          <strong>Not yet</strong>
          <ul>${notReadyScope.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      ` : ""}
    </article>
    <article class="learning-card wide-learning">
      <h3>Launch Readiness</h3>
      <p>${escapeHtml(data.overall_status || "unknown")}</p>
      <small>${escapeHtml(data.next_step || "")}</small>
      ${blockers.length ? `<ul>${blockers.map((blocker) => `<li>${escapeHtml(blocker)}</li>`).join("")}</ul>` : ""}
    </article>
    <article class="learning-card wide-learning">
      <h3>Launch Stages</h3>
      <ul>
        ${stages.map((stage) => `<li><strong>${escapeHtml(stage.status)}</strong> ${escapeHtml(stage.label)} · ${escapeHtml(stage.detail)}</li>`).join("")}
      </ul>
    </article>
    ${setupRows.length ? `
      <article class="learning-card wide-learning">
        <h3>External Setup Board</h3>
        <ul>
          ${setupRows.map((row) => `
            <li>
              <strong>${escapeHtml(row.blocking === "yes" ? "blocked" : "ready")}</strong>
              ${escapeHtml(row.setup_item || "Setup item")} · ${escapeHtml(row.current_status || "unknown")}
              <small>${escapeHtml(row.next_action || "")}</small>
            </li>
          `).join("")}
        </ul>
      </article>
    ` : ""}
  `;
}

async function loadLaunchReadiness() {
  const container = document.getElementById("launch-readiness");
  if (!container) return;
  try {
    const [data, setupBoard] = await Promise.all([
      fetchJson("/operations/launch-readiness"),
      fetchJson("/operations/external-setup-board").catch(() => ({ rows: [] })),
    ]);
    data.external_setup_rows = setupBoard.rows || [];
    renderLaunchReadiness(data);
  } catch {
    document.getElementById("launch-count").textContent = accessToken() ? "API access failed" : "Set access token";
    container.innerHTML = "";
  }
}

async function loadAccessPolicy() {
  const target = document.getElementById("access-role-count");
  if (!target) return;
  try {
    const data = await fetchJson("/security/access-policy");
    const roles = data.configured_roles || [];
    const actor = data.current_actor ? ` · ${data.current_actor}` : "";
    target.textContent = `${data.current_role || "unknown"}${actor} · ${data.mode || "token"} · ${roles.length ? roles.join("/") : "admin only"}`;
  } catch {
    target.textContent = accessToken() ? "Access check failed" : "Set access token";
  }
}

async function loadKb() {
  const container = document.getElementById("kb-items");
  const contextContainer = document.getElementById("kb-context");
  try {
    const [data, context] = await Promise.all([fetchJson("/kb"), fetchJson("/kb/context")]);
    if (contextContainer) {
      const categories = context.categories || {};
      contextContainer.innerHTML = `
        <article class="learning-card wide-learning">
          <h3>Active Knowledge Context</h3>
          <p>${Number(context.entry_count || 0)} entries loaded into planning and drafting.</p>
          <small>${Object.entries(categories).map(([key, count]) => `${escapeHtml(key)} ${Number(count)}`).join(" · ")}</small>
        </article>
        <article class="learning-card wide-learning">
          <h3>Style Rules</h3>
          <ul>${(context.style_rules || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>DREC educational, calm, evidence-led, Mandarin-first.</li>"}</ul>
        </article>
        <article class="learning-card wide-learning">
          <h3>Safety Rules</h3>
          <ul>${(context.safety_rules || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>Education only. Avoid guaranteed outcomes, diagnosis, or personal medical claims.</li>"}</ul>
        </article>
      `;
    }
    container.innerHTML = data.items.map((item) => `
      <div class="kb-item">
        <strong>${item.title}</strong><br>
        <small>${item.category}</small>
        <p>${item.body}</p>
      </div>
    `).join("");
  } catch {
    if (contextContainer) contextContainer.innerHTML = "";
    container.innerHTML = '<p class="status-note">Set the access token to load knowledge entries.</p>';
  }
}

function briefCard(item) {
  const status = item.status || "draft";
  const secondaryAction = status === "archived"
    ? `<button type="button" data-brief-status="${escapeHtml(item.id)}" data-status="draft">Restore</button>`
    : `<button type="button" data-brief-status="${escapeHtml(item.id)}" data-status="archived">Archive</button>`;
  return `
    <article class="brief-item">
      <div class="queue-meta">
        <span>${escapeHtml(item.format || "carousel")}</span>
        <span>${escapeHtml(item.funnel_stage || "TOFU")}</span>
        <span>${escapeHtml(item.language || "zh")}</span>
        <span>${escapeHtml(item.status || "draft")}</span>
      </div>
      <strong>${escapeHtml(item.topic)}</strong>
      <p>${escapeHtml(item.hook_primary || "No hook yet.")}</p>
      <small>${escapeHtml(item.compliance_notes || "Education-only brief.")}</small>
      <div class="queue-actions">
        <button type="button" data-draft-brief="${escapeHtml(item.id)}" ${status === "archived" ? "disabled" : ""}>Draft</button>
        <button type="button" data-draft-asset-brief="${escapeHtml(item.id)}" ${status === "archived" ? "disabled" : ""}>Save Asset</button>
        ${status !== "drafted" && status !== "archived" ? `<button type="button" data-brief-status="${escapeHtml(item.id)}" data-status="drafted">Mark Drafted</button>` : ""}
        ${secondaryAction}
      </div>
    </article>
  `;
}

async function loadBriefs() {
  const container = document.getElementById("brief-items");
  if (!container) return;
  try {
    const data = await fetchJson("/briefs");
    const items = data.items || [];
    container.dataset.briefs = JSON.stringify(items);
    container.innerHTML = items.length
      ? items.map(briefCard).join("")
      : "<p class=\"status-note\">No content briefs yet. Generate this week's plan to start.</p>";
  } catch {
    container.innerHTML = '<p class="status-note">Set the access token to load weekly briefs.</p>';
  }
}

function countRows(items, labelKey) {
  if (!items.length) return "<li>No signals yet.</li>";
  return items.map((item) => `<li><strong>${escapeHtml(item[labelKey] || "unknown")}</strong> ${Number(item.count || 0)}</li>`).join("");
}

function statusList(items, labelKey = "label") {
  if (!items?.length) return "<li>No checks available.</li>";
  return items.map((item) => `
    <li>
      <strong>${escapeHtml(item.status || (item.configured ? "ready" : "missing"))}</strong>
      ${escapeHtml(item[labelKey] || item.key || item.channel || "")}
    </li>
  `).join("");
}

function renderMetaReadiness(data) {
  const container = document.getElementById("meta-readiness");
  const token = data.token_check || {};
  container.innerHTML = `
    <article class="learning-card wide-learning">
      <h3>Status</h3>
      <p>${escapeHtml(data.overall_status || "not_connected")} · ${escapeHtml(data.mode || "manual_handoff")} · Graph ${escapeHtml(data.graph_version || "")}</p>
    </article>
    <article class="learning-card">
      <h3>Credentials</h3>
      <ul>${statusList(data.env_checks || [])}</ul>
    </article>
    <article class="learning-card">
      <h3>Token Check</h3>
      <p>${escapeHtml(token.message || "No token check yet.")}</p>
      <ul>
        <li><strong>${escapeHtml(token.status || "missing")}</strong> Page token</li>
        ${(token.missing_permissions || []).map((permission) => `<li><strong>missing</strong> ${escapeHtml(permission)}</li>`).join("")}
      </ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Channels</h3>
      <ul>${(data.channels || []).map((channel) => `<li><strong>${escapeHtml(channel.status)}</strong> ${escapeHtml(channel.channel)} · ${escapeHtml(channel.next_step)}</li>`).join("")}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Safe Sequence</h3>
      <ul>${(data.safe_sequence || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>
    </article>
  `;
}

function renderMetaSetupChecklist(data) {
  const container = document.getElementById("meta-setup-checklist");
  latestMetaSetupCommands = data.setup_commands || [];
  const oauth = data.oauth_guide || {};
  latestMetaOAuthUrl = oauth.oauth_dialog_url || oauth.oauth_dialog_url_template || "";
  const scheduler = data.scheduler_setup || {};
  const nightlyScheduler = data.nightly_metrics_scheduler || {};
  const githubSecrets = scheduler.required_github_secrets || [];
  const githubVariables = scheduler.optional_github_variables || [];
  const schedulerSteps = scheduler.steps || [];
  const schedulerHeartbeat = scheduler.heartbeat || {};
  const nightlySteps = nightlyScheduler.steps || [];
  const switchboard = data.activation_switchboard || [];
  const liveSequence = data.live_sequence || [];
  container.innerHTML = `
    <article class="learning-card wide-learning">
      <h3>Credential Setup Checklist</h3>
      <p>${escapeHtml(data.overall_status || "needs_setup")}</p>
      <ul>${(data.steps || []).map((step) => `<li><strong>${escapeHtml(step.status)}</strong> ${escapeHtml(step.label)} · ${escapeHtml(step.detail)}</li>`).join("")}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Required Secrets</h3>
      <ul>${(data.required_secrets || []).map((secret) => `<li>${escapeHtml(secret)}</li>`).join("")}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Setup Commands</h3>
      <pre id="meta-setup-commands">${escapeHtml(latestMetaSetupCommands.join("\n"))}</pre>
    </article>
    <article class="learning-card wide-learning">
      <h3>Meta OAuth Guide</h3>
      <p>${oauth.configured ? "OAuth URL is ready to copy." : "Add META_APP_ID to generate a live OAuth URL. The template below shows the required redirect and scopes."}</p>
      <small>Redirect URI: ${escapeHtml(oauth.redirect_uri || "")}</small>
      <ul>
        <li><strong>Graph</strong> ${escapeHtml(oauth.graph_version || "")}</li>
        <li><strong>Scopes</strong> ${escapeHtml((oauth.required_scopes || []).join(", "))}</li>
      </ul>
      <pre id="meta-oauth-url">${escapeHtml(latestMetaOAuthUrl || "OAuth guide unavailable.")}</pre>
      <ol>${(oauth.meta_app_setup || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
      <p>${escapeHtml(oauth.server_side_exchange?.warning || "Keep app secrets server-side.")}</p>
    </article>
    <article class="learning-card wide-learning">
      <h3>GitHub Scheduler Setup</h3>
      <p>${escapeHtml(scheduler.status || "not_checked")}</p>
      <small>${escapeHtml(scheduler.workflow_file || ".github/workflows/drec-scheduler-dry-run.yml")}</small>
      <p>${escapeHtml(schedulerHeartbeat.detail || "Run the workflow once to record the first scheduler heartbeat.")}</p>
      <ul>
        <li><strong>Required secret</strong> ${escapeHtml(githubSecrets.join(", ") || "None")}</li>
        <li><strong>Optional variable</strong> ${escapeHtml(githubVariables.join(", ") || "None")}</li>
        <li><strong>API URL</strong> ${escapeHtml(scheduler.default_api_base_url || API_BASE)}</li>
      </ul>
      <ol>${schedulerSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
      <p>${escapeHtml(scheduler.safety || "")}</p>
    </article>
    <article class="learning-card wide-learning">
      <h3>Nightly Metrics Scheduler</h3>
      <p>${escapeHtml(nightlyScheduler.status || "not_checked")}</p>
      <small>${escapeHtml(nightlyScheduler.workflow_file || ".github/workflows/drec-nightly-meta-metrics.yml")}</small>
      <ul>
        <li><strong>Schedule</strong> ${escapeHtml(nightlyScheduler.schedule || "daily 02:30 Asia/Kuala_Lumpur")}</li>
        <li><strong>Default</strong> ${escapeHtml(nightlyScheduler.default_mode || "dry_run")}</li>
        <li><strong>GitHub switch</strong> ${escapeHtml(nightlyScheduler.live_enable_github_variable || "DREC_ENABLE_REAL_META_METRICS=true")}</li>
        <li><strong>Fly switch</strong> ${escapeHtml(nightlyScheduler.live_enable_fly_secret || "META_ENABLE_METRICS_JOB=true")}</li>
      </ul>
      <ol>${nightlySteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
      <p>${escapeHtml(nightlyScheduler.safety || "")}</p>
    </article>
    <article class="learning-card wide-learning">
      <h3>Meta Activation Switchboard</h3>
      <p>${data.live_ready ? "Ready for controlled live test sequence." : "Keep live Meta workers locked."}</p>
      <ul>${switchboard.map((item) => `<li><strong>${escapeHtml(item.status)}</strong> ${escapeHtml(item.label)} · ${escapeHtml(item.detail)}</li>`).join("")}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>First Live Sequence</h3>
      <ol>${liveSequence.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
    </article>
    <article class="learning-card wide-learning">
      <h3>Safety Notes</h3>
      <ul>${(data.notes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
    </article>
  `;
}

async function loadMetaReadiness() {
  const container = document.getElementById("meta-readiness");
  if (!container) return;
  try {
    const data = await fetchJson("/meta/readiness");
    renderMetaReadiness(data);
    document.getElementById("meta-message").textContent = "Meta readiness checked.";
  } catch (error) {
    container.innerHTML = '<p class="status-note">Set the access token to check Meta readiness.</p>';
    document.getElementById("meta-message").textContent = error.message === "Access token required" ? "Set the access token first." : "Could not check Meta readiness.";
  }
}

async function loadMetaSetupChecklist() {
  const container = document.getElementById("meta-setup-checklist");
  if (!container) return;
  try {
    const data = await fetchJson("/meta/setup-checklist");
    renderMetaSetupChecklist(data);
  } catch (error) {
    latestMetaSetupCommands = [];
    container.innerHTML = '<p class="status-note">Set the access token to load the setup checklist.</p>';
  }
}

function renderNotifyRail(data) {
  const container = document.getElementById("notify-rail");
  if (!container) return;
  const alerts = data.alerts || [];
  const webhook = data.webhook_templates || {};
  const roleCounts = data.role_counts || {};
  const urgencyCounts = data.urgency_counts || {};
  container.innerHTML = `
    <article class="learning-card">
      <h3>Notify Rail</h3>
      <p>${escapeHtml(data.overall_status || "not_checked")}</p>
      <small>${escapeHtml(data.send_status || "manual_pack_only")}</small>
    </article>
    <article class="learning-card">
      <h3>Alerts</h3>
      <p>${Number(data.alert_count || 0)} waiting</p>
      <small>High: ${Number(urgencyCounts.high || 0)} · Medium: ${Number(urgencyCounts.medium || 0)} · Low: ${Number(urgencyCounts.low || 0)}</small>
    </article>
    <article class="learning-card">
      <h3>Roles</h3>
      <ul>${Object.entries(roleCounts).length ? Object.entries(roleCounts).map(([role, count]) => `<li><strong>${escapeHtml(role)}</strong> ${Number(count || 0)}</li>`).join("") : "<li>No role alerts.</li>"}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>n8n Webhook</h3>
      <p>${escapeHtml(webhook.n8n_event_name || "drec.notification.digest")} · ${escapeHtml(webhook.method || "POST")}</p>
      <small>Future Fly secret: ${escapeHtml(webhook.future_env_secret || "DREC_NOTIFY_WEBHOOK_URL")}</small>
      <p>${escapeHtml(webhook.auth || "Use a private shared token before live sending.")}</p>
    </article>
    <article class="learning-card wide-learning">
      <h3>Approval Rules</h3>
      <ul>${(data.approval_rules || []).map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Message Queue</h3>
      ${alerts.length ? alerts.slice(0, 10).map((alert) => `
        <div class="queue-mini">
          <strong>${escapeHtml(alert.title || "Alert")}</strong>
          <span>${escapeHtml(alert.role || "")} · ${escapeHtml(alert.urgency || "")} · ${escapeHtml(alert.screen || "")}</span>
          <p>${escapeHtml(alert.detail || "")}</p>
          <small>${escapeHtml(alert.action || "")}</small>
        </div>
      `).join("") : '<p class="status-note">No alerts waiting right now.</p>'}
    </article>
  `;
}

async function loadNotifyRail() {
  const container = document.getElementById("notify-rail");
  if (!container) return;
  try {
    const data = await fetchJson("/notifications/rail-readiness");
    renderNotifyRail(data);
  } catch (error) {
    container.innerHTML = '<p class="status-note">Set the access token to load Notify Rail.</p>';
  }
}

function renderMetaMetricsDryRun(data) {
  const container = document.getElementById("meta-metrics-result");
  const planned = data.planned_requests || [];
  const blockers = data.blockers || [];
  container.innerHTML = `
    <div class="handoff-summary">
      <article class="learning-card">
        <h3>Metrics Mode</h3>
        <p>${escapeHtml(data.mode || "dry_run")}</p>
      </article>
      <article class="learning-card">
        <h3>Ready</h3>
        <p>${data.ready ? "Ready for gated ingestion" : "Blocked"}</p>
      </article>
    </div>
    <article class="learning-card wide-learning">
      <h3>Planned Requests</h3>
      <ul>
        ${planned.length ? planned.map((item) => `<li><strong>${escapeHtml(item.channel)}</strong> ${escapeHtml(item.external_post_id)} · ${escapeHtml(item.endpoint?.params?.metric || "")}</li>`).join("") : "<li>No published Meta post IDs found.</li>"}
      </ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Blockers</h3>
      <ul>${blockers.length ? blockers.map((blocker) => `<li>${escapeHtml(blocker)}</li>`).join("") : "<li>No blockers in dry run.</li>"}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Safety</h3>
      <ul>${(data.safety || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>
    </article>
  `;
}

function renderRiskAudit(data) {
  const container = document.getElementById("risk-audit-result");
  if (!container) return;
  const items = data.items || [];
  const checked = data.checked || {};
  container.innerHTML = `
    <article class="learning-card wide-learning">
      <h3>Content Risk Audit</h3>
      <p>${escapeHtml(data.overall_status || "unknown")} · ${Number(data.block_count || 0)} block · ${Number(data.warn_count || 0)} warn</p>
      <small>Checked ${Number(checked.assets || 0)} assets, ${Number(checked.queue || 0)} queue items, ${Number(checked.media || 0)} media assets, ${Number(checked.automation_gates || 0)} automation gates.</small>
      <p>${escapeHtml(data.next_step || "")}</p>
    </article>
    <article class="learning-card wide-learning">
      <h3>Top Risks</h3>
      <ul>
        ${items.length ? items.slice(0, 12).map((item) => `
          <li>
            <strong>${escapeHtml(item.severity)}</strong>
            ${escapeHtml(item.kind)} ${escapeHtml(item.channel || item.format || "")} · ${escapeHtml(item.title)}
            <br><small>${escapeHtml(item.action)}</small>
          </li>
        `).join("") : "<li>No content risk items found.</li>"}
      </ul>
    </article>
  `;
}

function renderBrandTokens(tokens) {
  const container = document.getElementById("brand-token-board");
  if (!container) return;
  const entries = Object.entries(tokens || {});
  container.innerHTML = entries.length
    ? entries.map(([name, value]) => `
      <article class="learning-card">
        <h3>${escapeHtml(name.replaceAll("_", " "))}</h3>
        <div class="style-swatch" style="background:${escapeHtml(value)}"></div>
        <p><code>${escapeHtml(value)}</code></p>
      </article>
    `).join("")
    : '<p class="status-note">No brand tokens found.</p>';
}

function renderStyleLibrary(data) {
  const container = document.getElementById("style-library");
  if (!container) return;
  const styles = data.styles || [];
  const styleRules = data.style_rules || [];
  const safetyRules = data.safety_rules || [];
  container.innerHTML = `
    ${styles.length ? styles.map((style) => {
      const signal = style.learning_signal || {};
      return `
        <article class="learning-card wide-learning">
          <h3>${escapeHtml(style.name || style.key)}</h3>
          <p>${escapeHtml(style.best_for || "")}</p>
          <small>${escapeHtml((style.formats || []).join(" · "))}</small>
          <div class="summary-row">
            <span>Weight: ${escapeHtml(style.current_weight ?? "not set")}</span>
            <span>Outcomes: ${escapeHtml(signal.count || 0)}</span>
            <span>Avg score: ${escapeHtml(signal.avg_score ?? "n/a")}</span>
          </div>
          <div class="palette-row">
            ${(style.palette || []).map((color) => `<i style="background:${escapeHtml(color)}" title="${escapeHtml(color)}"></i>`).join("")}
          </div>
          <ul>${(style.rules || []).map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul>
          <small>${escapeHtml(style.recommendation || "")}</small>
        </article>
      `;
    }).join("") : '<p class="status-note">No styles found.</p>'}
    <article class="learning-card wide-learning">
      <h3>Active KB Style Rules</h3>
      <ul>${styleRules.length ? styleRules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("") : "<li>DREC educational, calm, evidence-led, Mandarin-first.</li>"}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Safety Rules</h3>
      <ul>${safetyRules.length ? safetyRules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("") : "<li>Education only. Avoid guaranteed outcomes, diagnosis, and personal medical claims.</li>"}</ul>
    </article>
  `;
}

async function loadStyleLibrary() {
  const message = document.getElementById("creative-message");
  try {
    const data = await fetchJson("/creative/style-library");
    renderBrandTokens(data.brand_tokens || {});
    renderStyleLibrary(data);
    if (message) message.textContent = data.next_step || "Style library loaded.";
  } catch (error) {
    document.getElementById("brand-token-board").innerHTML = "";
    document.getElementById("style-library").innerHTML = '<p class="status-note">Set the access token to load Creative Studio.</p>';
    if (message) message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not load Creative Studio.";
  }
}

function renderSenseBrief(data) {
  const readiness = document.getElementById("sense-readiness");
  const topicsContainer = document.getElementById("sense-topics");
  const signalsContainer = document.getElementById("sense-signals");
  if (!readiness || !topicsContainer || !signalsContainer) return;
  const missing = data.missing_categories || [];
  const guardrails = data.guardrails || [];
  readiness.innerHTML = `
    <article class="learning-card">
      <h3>Sense Signals</h3>
      <p>${Number(data.signal_count || 0)} captured</p>
      <small>${escapeHtml(data.phase || "")}</small>
    </article>
    <article class="learning-card">
      <h3>Input Gaps</h3>
      <p>${missing.length ? escapeHtml(missing.join(" · ")) : "Complete"}</p>
      <small>Ads, competitors, audience, observations, ideas</small>
    </article>
    <article class="learning-card">
      <h3>Learning</h3>
      <p>${Number(data.outcome_insights?.sample_size || 0)} outcome(s)</p>
      <small>${escapeHtml(data.outcome_insights?.summary || "")}</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>Guardrails</h3>
      <ul>${guardrails.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul>
    </article>
  `;
  const topics = data.planning_topics || [];
  topicsContainer.innerHTML = topics.length
    ? topics.map((topic, index) => `
      <article class="learning-card">
        <h3>Topic ${index + 1}</h3>
        <p>${escapeHtml(topic)}</p>
      </article>
    `).join("")
    : '<p class="status-note">No planning topics yet. Add audience, competitor, ads, observation, or idea entries to Knowledge Base.</p>';
  const groups = data.signals_by_category || {};
  const categoryOrder = data.input_categories || Object.keys(groups);
  const sections = [];
  categoryOrder.forEach((category) => {
    const signals = groups[category] || [];
    sections.push(`
      <article class="queue-item">
        <div>
          <strong>${escapeHtml(category)}</strong>
          <span>${signals.length} signal(s)</span>
        </div>
        ${signals.length ? signals.slice(0, 6).map((signal) => `
          <p><strong>${escapeHtml(signal.title || "Signal")}</strong>: ${escapeHtml(signal.summary || "")}</p>
          <small>${escapeHtml(signal.recommendation || "")}</small>
        `).join("") : '<p class="status-note">No signals captured yet.</p>'}
      </article>
    `);
  });
  signalsContainer.innerHTML = sections.join("");
}

async function loadSenseBrief() {
  const message = document.getElementById("sense-message");
  try {
    const data = await fetchJson("/insights/sense-brief");
    renderSenseBrief(data);
    if (message) message.textContent = data.next_step || "Sense Brief loaded.";
  } catch (error) {
    const readiness = document.getElementById("sense-readiness");
    const topics = document.getElementById("sense-topics");
    const signals = document.getElementById("sense-signals");
    if (readiness) readiness.innerHTML = "";
    if (topics) topics.innerHTML = "";
    if (signals) signals.innerHTML = '<p class="status-note">Set the access token to load Insight Inbox.</p>';
    if (message) message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not load Sense Brief.";
  }
}

function renderAdsPlanning(data) {
  const container = document.getElementById("ads-planning");
  if (!container) return;
  const candidates = data.candidate_tests || [];
  const targets = data.cpl_targets || [];
  const rules = data.budget_rules || [];
  const handoff = data.media_buyer_handoff || [];
  container.innerHTML = `
    <article class="learning-card">
      <h3>Mode</h3>
      <p>${escapeHtml(data.mode || "manual_planning_only")}</p>
      <small>${escapeHtml(data.phase || "ads_planning_pre_meta")}</small>
    </article>
    <article class="learning-card">
      <h3>Tests</h3>
      <p>${escapeHtml(candidates.length)} candidate(s)</p>
      <small>Manual Ads Manager only</small>
    </article>
    <article class="learning-card">
      <h3>CPL Targets</h3>
      <p>${targets.length ? targets.map((target) => escapeHtml(`${target.title}: ${target.target_cpl}`)).join("<br>") : "No CPL target found"}</p>
      <small>Store targets in Knowledge Base</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>Candidate Tests</h3>
      <ul>${candidates.length ? candidates.slice(0, 6).map((item) => `<li><strong>${escapeHtml(item.angle)}</strong><br><small>${escapeHtml(item.audience)} · ${escapeHtml(item.success_metric)}</small></li>`).join("") : "<li>Add audience, competitor, ads, or idea entries to Knowledge Base.</li>"}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Budget Rules</h3>
      <ul>${rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Media Buyer Handoff</h3>
      <ul>${handoff.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <p>${escapeHtml(data.next_step || "")}</p>
    </article>
  `;
}

async function loadAdsPlanning() {
  const container = document.getElementById("ads-planning");
  const message = document.getElementById("sense-message");
  if (!container) return;
  try {
    const data = await fetchJson("/insights/ads-planning");
    renderAdsPlanning(data);
  } catch (error) {
    container.innerHTML = '<p class="status-note">Set the access token to load Ads Planning.</p>';
    if (message && error.message !== "Access token required") message.textContent = "Could not load Ads Planning.";
  }
}

function renderTemplateStudio(data) {
  const readiness = document.getElementById("template-readiness");
  const library = document.getElementById("template-library");
  const jobsContainer = document.getElementById("template-jobs");
  if (!readiness || !library || !jobsContainer) return;
  const rules = data.render_rules || [];
  const checklist = data.qa_checklist || [];
  readiness.innerHTML = `
    <article class="learning-card">
      <h3>Render Ready</h3>
      <p>${escapeHtml(data.render_ready_count || 0)} / ${escapeHtml(data.static_asset_count || 0)} static assets</p>
      <small>${escapeHtml(data.render_engine_status || "")}</small>
    </article>
    <article class="learning-card">
      <h3>Templates</h3>
      <p>${escapeHtml(data.template_count || 0)} layout option(s)</p>
      <small>${escapeHtml(data.phase || "")}</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>Render Rules</h3>
      <ul>${rules.length ? rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("") : "<li>Use DREC brand tokens and final human QA.</li>"}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>QA Checklist</h3>
      <ul>${checklist.length ? checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>Check copy, readability, and compliance before scheduling.</li>"}</ul>
    </article>
  `;
  const templates = data.templates || [];
  library.innerHTML = templates.length
    ? templates.map((template) => `
      <article class="learning-card wide-learning">
        <h3>${escapeHtml(template.name || template.key)}</h3>
        <p>${escapeHtml(template.best_for || "")}</p>
        <small>${escapeHtml((template.formats || []).join(" · "))} · ${escapeHtml(template.canvas || "")}</small>
        <div class="summary-row">
          ${(template.slots || []).map((slot) => `<span>${escapeHtml(slot.replaceAll("_", " "))}</span>`).join("")}
        </div>
        <ul>${(template.rules || []).map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul>
      </article>
    `).join("")
    : '<p class="status-note">No templates found.</p>';
  const jobs = data.jobs || [];
  jobsContainer.innerHTML = jobs.length
    ? jobs.map((job) => {
      const blockers = job.blockers || [];
      return `
        <article class="queue-item">
          <div>
            <strong>${escapeHtml(job.topic || "Static asset")}</strong>
            <span>${escapeHtml(job.format || "")} · ${escapeHtml(job.template_name || job.template_key || "")}</span>
          </div>
          <div class="summary-row">
            <span>Review: ${escapeHtml(job.review_status || "")}</span>
            <span>Safety: ${escapeHtml(job.compliance_status || "")}</span>
            <span>Canvas: ${escapeHtml(job.canvas || "")}</span>
            <span>Frames: ${escapeHtml(job.frame_count || 0)}</span>
          </div>
          <p>${escapeHtml(job.next_step || "")}</p>
          <ul>${blockers.length ? blockers.map((blocker) => `<li>${escapeHtml(blocker)}</li>`).join("") : "<li>Ready for static template render handoff.</li>"}</ul>
        </article>
      `;
    }).join("")
    : '<p class="status-note">No static assets yet. Generate or save a carousel, single, or story asset first.</p>';
}

async function loadTemplateStudio() {
  const message = document.getElementById("template-message");
  try {
    const data = await fetchJson("/templates/library");
    renderTemplateStudio(data);
    if (message) message.textContent = data.next_step || "Template Studio loaded.";
  } catch (error) {
    const readiness = document.getElementById("template-readiness");
    const library = document.getElementById("template-library");
    const jobs = document.getElementById("template-jobs");
    if (readiness) readiness.innerHTML = "";
    if (library) library.innerHTML = "";
    if (jobs) jobs.innerHTML = '<p class="status-note">Set the access token to load Template Studio.</p>';
    if (message) message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not load Template Studio.";
  }
}

function renderVideoStudio(data) {
  const readiness = document.getElementById("video-readiness");
  const jobsContainer = document.getElementById("video-jobs");
  if (!readiness || !jobsContainer) return;
  const modules = data.sop_modules || [];
  const hardStops = data.hard_stop_rules || [];
  const specs = data.export_specs || {};
  readiness.innerHTML = `
    <article class="learning-card">
      <h3>Manual Ready</h3>
      <p>${escapeHtml(data.manual_edit_ready_count || 0)} / ${escapeHtml(data.reel_asset_count || 0)} reel assets</p>
      <small>${escapeHtml(data.overall_status || "")}</small>
    </article>
    <article class="learning-card">
      <h3>DREC Cut</h3>
      <p>${escapeHtml(data.automation_status || "not_built_yet")}</p>
      <small>${escapeHtml(data.phase || "")}</small>
    </article>
    <article class="learning-card">
      <h3>Approved Video</h3>
      <p>${escapeHtml(data.approved_video_media_count || 0)} media item(s)</p>
      <small>Use only approved footage for handoff.</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>SOP Checklist</h3>
      <ul>${modules.length ? modules.map((item) => `<li><strong>${escapeHtml(item.name)}</strong>: ${escapeHtml(item.check)}</li>`).join("") : "<li>No SOP modules found.</li>"}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Hard Stop Rules</h3>
      <ul>${hardStops.length ? hardStops.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("") : "<li>Human review required before publishing.</li>"}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Export Specs</h3>
      <ul>${Object.entries(specs).map(([key, value]) => `<li><strong>${escapeHtml(key.replaceAll("_", " "))}</strong>: ${escapeHtml(value)}</li>`).join("")}</ul>
    </article>
  `;
  const jobs = data.jobs || [];
  jobsContainer.innerHTML = jobs.length
    ? jobs.map((job) => {
      const blockers = job.blockers || [];
      return `
        <article class="queue-item">
          <div>
            <strong>${escapeHtml(job.topic || "Reel asset")}</strong>
            <span>${escapeHtml(job.channel || "organic")} · ${escapeHtml(job.style_key || "reel_script_v1")}</span>
          </div>
          <div class="summary-row">
            <span>Review: ${escapeHtml(job.review_status || "")}</span>
            <span>Safety: ${escapeHtml(job.compliance_status || "")}</span>
            <span>Script: ${escapeHtml(job.script_beats || 0)} beats</span>
            <span>Media: ${escapeHtml(job.media_count || 0)}</span>
          </div>
          <p>${escapeHtml(job.next_step || "")}</p>
          <ul>${blockers.length ? blockers.map((blocker) => `<li>${escapeHtml(blocker)}</li>`).join("") : "<li>Ready for manual edit handoff.</li>"}</ul>
        </article>
      `;
    }).join("")
    : '<p class="status-note">No reel assets yet. Create a reel draft first.</p>';
}

async function loadVideoStudio() {
  const message = document.getElementById("video-message");
  try {
    const data = await fetchJson("/video/studio-readiness");
    renderVideoStudio(data);
    if (message) message.textContent = data.next_step || "Video Studio loaded.";
  } catch (error) {
    const readiness = document.getElementById("video-readiness");
    const jobs = document.getElementById("video-jobs");
    if (readiness) readiness.innerHTML = "";
    if (jobs) jobs.innerHTML = '<p class="status-note">Set the access token to load Video Studio.</p>';
    if (message) message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not load Video Studio.";
  }
}

async function loadLearningSummary() {
  const container = document.getElementById("learning-summary");
  if (!container) return;
  try {
    const data = await fetchJson("/learning-summary");
    const briefs = data.recent_briefs || [];
    const outcomes = data.recent_outcomes || [];
    const weights = data.weights || [];
    const planTopics = data.plan_recommendations?.topics || [];
    const insights = data.outcome_insights || {};
    const topSignals = insights.top_signals || [];
    const suggestions = data.suggested_learning_weights || [];
    latestLearningWeightSuggestions = suggestions;
    container.innerHTML = `
      <article class="learning-card wide-learning">
        <h3>Next Best Move</h3>
        <p>${escapeHtml(data.recommendation)}</p>
      </article>
      <article class="learning-card">
        <h3>Queue</h3>
        <ul>${countRows(data.queue || [], "status")}</ul>
      </article>
      <article class="learning-card">
        <h3>Feedback</h3>
        <ul>${countRows(data.feedback || [], "action")}</ul>
      </article>
      <article class="learning-card wide-learning">
        <h3>Recent Briefs</h3>
        <ul>
          ${briefs.length ? briefs.map((brief) => `<li><strong>${escapeHtml(brief.format || "brief")}</strong> ${escapeHtml(brief.topic || "")}</li>`).join("") : "<li>No briefs yet.</li>"}
        </ul>
      </article>
      <article class="learning-card wide-learning">
        <h3>Next Plan Topics</h3>
        <ul>
          ${planTopics.length ? planTopics.map((topic) => `<li>${escapeHtml(topic)}</li>`).join("") : "<li>No recommendations yet.</li>"}
        </ul>
      </article>
      <article class="learning-card wide-learning">
        <h3>Recent Results</h3>
        <ul>
          ${outcomes.length ? outcomes.map((outcome) => `<li><strong>${escapeHtml(outcome.metric_window || "7d")}</strong> ${escapeHtml(outcome.post_id || "")} · score ${escapeHtml(outcome.score ?? "n/a")} · saves ${escapeHtml(outcome.saves ?? 0)}</li>`).join("") : "<li>No performance records yet.</li>"}
        </ul>
      </article>
      <article class="learning-card wide-learning">
        <h3>Outcome Insights</h3>
        <p>${escapeHtml(insights.summary || "No outcome insights yet.")}</p>
        <ul>
          ${topSignals.length ? topSignals.map((item) => `<li><strong>${escapeHtml(item.label || `${item.dimension}: ${item.key}`)}</strong> · avg score ${escapeHtml(item.avg_score ?? "n/a")} · saves ${escapeHtml(item.saves_total ?? 0)} · shares ${escapeHtml(item.shares_total ?? 0)}<br><small>${escapeHtml(item.recommendation || "")}</small></li>`).join("") : "<li>Record more outcomes to compare formats, channels, pillars, and audiences.</li>"}
        </ul>
      </article>
      <article class="learning-card wide-learning">
        <h3>Active Learning Weights</h3>
        <div class="weight-list">
          ${weights.length ? weights.map((weight) => `
            <div class="weight-row">
              <span><strong>${escapeHtml(weight.dimension)}</strong> ${escapeHtml(weight.key)}</span>
              <span>${escapeHtml(weight.previous_value ?? "base")} → ${escapeHtml(weight.value)}</span>
              <small>${escapeHtml(weight.reason || weight.source || "learning signal")}</small>
              <button type="button" data-revert-weight="${escapeHtml(weight.id)}">Revert</button>
            </div>
          `).join("") : "<p>No active learning weights yet.</p>"}
        </div>
      </article>
      <article class="learning-card wide-learning">
        <h3>Suggested Learning Weights</h3>
        <div class="weight-list">
          ${suggestions.length ? suggestions.map((weight, index) => `
            <div class="weight-row">
              <span><strong>${escapeHtml(weight.dimension)}</strong> ${escapeHtml(weight.key)}</span>
              <span>${escapeHtml(weight.previous_value ?? "base")} → ${escapeHtml(weight.value)}</span>
              <small>${escapeHtml(weight.reason || weight.safe_use_note || "Planning guidance only.")}</small>
              <button type="button" data-create-learning-suggestion="${escapeHtml(index)}">Log Weight</button>
            </div>
          `).join("") : "<p>No suggested weights yet. Record outcomes first, or active weights already cover the top signals.</p>"}
        </div>
      </article>
    `;
  } catch {
    container.innerHTML = '<p class="status-note">Set the access token to load learning signals.</p>';
  }
}

function renderQuarterlyMemo(data) {
  const container = document.getElementById("quarterly-memo");
  if (!container) return;
  const summary = data.summary || {};
  const slots = data.top_slots || data.posting_time_heatmap || [];
  const signals = data.outcome_insights?.top_signals || [];
  const actions = data.next_actions || [];
  const weights = data.learning_weights || [];
  container.innerHTML = `
    <article class="learning-card wide-learning">
      <h3>Quarterly Self-Review</h3>
      <p>${escapeHtml(data.period || "Current quarter")} · ${escapeHtml(data.range?.timezone || "Asia/Kuala_Lumpur")}</p>
    </article>
    <article class="learning-card">
      <h3>Loop Evidence</h3>
      <ul>
        <li>Posts: ${escapeHtml(summary.scheduled_or_drafted_posts ?? 0)}</li>
        <li>Published IDs: ${escapeHtml(summary.published_posts ?? 0)}</li>
        <li>Outcomes: ${escapeHtml(summary.outcomes ?? 0)}</li>
        <li>Weights: ${escapeHtml(summary.active_learning_weights ?? 0)} active</li>
      </ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Posting-Time Heat</h3>
      <ul>
        ${slots.length ? slots.slice(0, 6).map((slot) => `<li><strong>${escapeHtml(slot.slot)}</strong> · posts ${escapeHtml(slot.post_count ?? 0)} · published ${escapeHtml(slot.published_count ?? 0)} · avg score ${escapeHtml(slot.avg_score ?? "n/a")}<br><small>${escapeHtml(slot.confidence || "directional")}</small></li>`).join("") : "<li>No planned or published slots yet.</li>"}
      </ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Quarterly Signals</h3>
      <ul>
        ${signals.length ? signals.slice(0, 6).map((signal) => `<li><strong>${escapeHtml(signal.label || `${signal.dimension}: ${signal.key}`)}</strong> · avg score ${escapeHtml(signal.avg_score ?? "n/a")} · saves ${escapeHtml(signal.saves_total ?? 0)}<br><small>${escapeHtml(signal.recommendation || "")}</small></li>`).join("") : "<li>No measured outcome signals yet.</li>"}
      </ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Weight-Change Log</h3>
      <ul>
        ${weights.length ? weights.slice(0, 6).map((weight) => `<li><strong>${escapeHtml(weight.dimension)}</strong> ${escapeHtml(weight.key)} · ${escapeHtml(weight.previous_value ?? "base")} → ${escapeHtml(weight.value)}<br><small>${escapeHtml(weight.reason || weight.source || "learning signal")}</small></li>`).join("") : "<li>No learning-weight changes this quarter.</li>"}
      </ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Next-Quarter Actions</h3>
      <ul>
        ${actions.length ? actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>Keep approval mandatory and run another full manual cycle.</li>"}
      </ul>
    </article>
  `;
}

async function loadQuarterlyMemo() {
  const container = document.getElementById("quarterly-memo");
  if (!container) return;
  try {
    const data = await fetchJson("/learning/quarterly-memo");
    renderQuarterlyMemo(data);
  } catch (error) {
    container.innerHTML = '<p class="status-note">Set the access token to load the quarterly memo.</p>';
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.max(0, Math.trunc(number));
}

function outcomeCard(item) {
  return `
    <article class="queue-item">
      <div class="queue-meta">
        <span>${escapeHtml(item.channel || "manual")}</span>
        <span>${escapeHtml(item.format || "post")}</span>
        <span>${escapeHtml(item.funnel_stage || "stage")}</span>
        <span>${escapeHtml(item.metric_window || "7d")}</span>
      </div>
      <p><strong>${escapeHtml(item.post_id)}</strong></p>
      <small>
        score ${escapeHtml(item.score ?? "n/a")} · saves ${escapeHtml(item.saves ?? 0)} · shares ${escapeHtml(item.shares ?? 0)} · CPL ${escapeHtml(item.cpl ?? "n/a")}
      </small>
      ${item.vs_plan_note ? `<p>${escapeHtml(item.vs_plan_note)}</p>` : ""}
    </article>
  `;
}

function handoffItem(item) {
  const canRecordPublished = item.status === "scheduled" && item.compliance_status === "clear";
  const publishedAction = canRecordPublished
    ? `<div class="queue-actions"><button type="button" data-handoff-published="${escapeHtml(item.id)}">Record Published</button></div>`
    : "";
  const blockers = Array.isArray(item.handoff_blockers) ? item.handoff_blockers : [];
  const blockerList = blockers.length
    ? `<ul class="feedback-note">${blockers.map((blocker) => `<li>${escapeHtml(blocker)}</li>`).join("")}</ul>`
    : "";
  return `
    <article class="queue-item">
      <div class="queue-meta">
        <span>${escapeHtml(item.channel)}</span>
        <span>${escapeHtml(item.format)}</span>
        <span>${escapeHtml(item.status)}</span>
        <span>${escapeHtml(item.compliance_status)}</span>
      </div>
      <small>${formatDate(item.planned_slot)}</small>
      <p>${escapeHtml(item.caption)}</p>
      ${blockerList}
      ${publishedAction}
    </article>
  `;
}

function captionVariantPreview(variants) {
  const items = Array.isArray(variants) ? variants.filter(Boolean) : [];
  if (!items.length) return "";
  return `
    <div class="media-list">
      <strong>Caption Variants</strong>
      ${items.map((caption, index) => `<small>Variant ${index + 1}: ${escapeHtml(caption).slice(0, 220)}${caption.length > 220 ? "..." : ""}</small>`).join("")}
    </div>
  `;
}

function assetPackageText(asset) {
  const metadata = asset.metadata || {};
  const lines = [
    "DREC Draft Asset Package",
    "",
    `Channel: ${asset.channel || "facebook"}`,
    `Format: ${asset.format || "post"}`,
    `Compliance: ${asset.compliance_status || "pending"}`,
    `Review: ${asset.review_status || "draft"}`,
    `Topic: ${metadata.topic || ""}`,
    "",
    "Caption:",
    asset.caption || "",
  ];
  const variants = Array.isArray(metadata.caption_variants) ? metadata.caption_variants : [];
  if (variants.length) {
    lines.push("", "Caption Variants:");
    variants.forEach((caption, index) => lines.push(`Variant ${index + 1}:`, caption || ""));
  }
  const slides = Array.isArray(metadata.slides) ? metadata.slides : [];
  if (slides.length) {
    lines.push("", "Slides:");
    slides.forEach((slide) => lines.push(`${slide.slide || ""}. ${slide.title || ""}`, slide.body || ""));
  }
  const script = Array.isArray(metadata.reel_script) ? metadata.reel_script : [];
  if (script.length) {
    lines.push("", "Reel Script:");
    script.forEach((beat) => lines.push(`${beat.time || ""} · ${beat.beat || ""}`, beat.line || ""));
  }
  const media = Array.isArray(asset.media_urls) ? asset.media_urls.filter(Boolean) : [];
  if (media.length) {
    lines.push("", "Media URLs:", ...media);
  }
  return lines.join("\n");
}

function assetReviewNoteText(asset) {
  const metadata = asset.metadata || {};
  const media = Array.isArray(asset.media_urls) ? asset.media_urls.filter(Boolean) : [];
  return [
    "DREC Asset Safety Review Note",
    "",
    `Asset ID: ${asset.id || ""}`,
    `Brief ID: ${asset.brief_id || ""}`,
    `Topic: ${metadata.topic || ""}`,
    `Channel / Format: ${asset.channel || "facebook"} / ${asset.format || "post"}`,
    `Current Safety / Review: ${asset.compliance_status || "pending"} / ${asset.review_status || "draft"}`,
    `Media Count: ${media.length}`,
    "",
    "Reviewer checklist:",
    "- General education only; no diagnosis or personal treatment instruction.",
    "- No guarantee of reversal, cure, weight loss, lab improvement, or outcome.",
    "- Does not imply the viewer has a condition.",
    "- Media rights are owned, licensed, or explicitly approved.",
    "- If unsure, keep Safety Pending or Safety Flag and rewrite before queueing.",
    "",
    "Caption under review:",
    asset.caption || "",
    "",
    "Decision:",
    "[ ] Safety Clear",
    "[ ] Approve",
    "[ ] Keep Pending / Rewrite",
    "[ ] Flag",
  ].join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function assetReviewDecisionCsvText(asset) {
  const metadata = asset.metadata || {};
  const media = Array.isArray(asset.media_urls) ? asset.media_urls.filter(Boolean) : [];
  const header = [
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
  ];
  const row = [
    asset.id || "",
    asset.brief_id || "",
    metadata.topic || "",
    asset.channel || "",
    asset.format || "",
    asset.compliance_status || "",
    asset.review_status || "",
    "review_required",
    "use reviewer judgment",
    media.length,
    metadata.target_signal || "",
    asset.caption || "",
    asset.compliance_status === "clear" ? "Reviewer may approve only after human agreement" : "Set safety decision before approval",
    "",
    "",
    "",
    "",
  ];
  return `${header.join(",")}\n${row.map(csvCell).join(",")}`;
}

function assetCard(item) {
  const mediaCount = Array.isArray(item.media_urls) ? item.media_urls.length : 0;
  const canQueue = item.review_status === "approved" && item.compliance_status === "clear";
  const metadata = item.metadata || {};
  const queueNote = canQueue
    ? "Ready for queue."
    : item.compliance_status !== "clear"
      ? "Queue requires a clear safety check."
      : item.review_status === "rejected"
        ? "Rejected assets cannot enter the queue."
        : "Approve this asset before adding it to the queue.";
  return `
    <article class="queue-item">
      <div class="queue-meta">
        <span>${escapeHtml(item.channel || "facebook")}</span>
        <span>${escapeHtml(item.format || "post")}</span>
        <span>${escapeHtml(item.compliance_status || "pending")}</span>
        <span>${escapeHtml(item.review_status || "draft")}</span>
      </div>
      <p>${escapeHtml(item.caption || "No caption yet.")}</p>
      <small>${mediaCount} media URL(s) · ${escapeHtml(queueNote)}</small>
      ${mediaList(item.media_urls)}
      ${captionVariantPreview(metadata.caption_variants)}
      ${slidePreview(metadata.slides)}
      ${reelPreview(metadata.reel_script)}
      <div class="queue-actions">
        <button type="button" data-asset-compliance="clear" data-id="${escapeHtml(item.id)}">Safety Clear</button>
        <button type="button" data-asset-compliance="pending" data-id="${escapeHtml(item.id)}">Safety Pending</button>
        <button type="button" data-asset-compliance="flagged" data-id="${escapeHtml(item.id)}">Safety Flag</button>
        <button type="button" data-asset-status="approved" data-id="${escapeHtml(item.id)}">Approve</button>
        <button type="button" data-asset-status="review" data-id="${escapeHtml(item.id)}">Needs Work</button>
        <button type="button" data-asset-status="rejected" data-id="${escapeHtml(item.id)}">Reject</button>
        <button type="button" data-attach-asset-media="${escapeHtml(item.id)}">Attach Media</button>
        <button type="button" data-copy-asset-review="${escapeHtml(item.id)}">Copy Review Note</button>
        <button type="button" data-copy-asset="${escapeHtml(item.id)}">Copy Package</button>
        <button type="button" data-queue-asset="${escapeHtml(item.id)}" ${canQueue ? "" : "disabled"}>Add To Queue</button>
      </div>
    </article>
  `;
}

function assetNeedsReview(item) {
  return item.review_status !== "approved" || item.compliance_status !== "clear";
}

function renderNextAssetReview(items) {
  const container = document.getElementById("asset-next-review");
  if (!container) return;
  const next = (items || []).find(assetNeedsReview);
  if (!next) {
    container.innerHTML = `
      <article class="learning-card wide-learning ready">
        <h3>Next Asset Review</h3>
        <p>All draft assets currently visible are approved and safety clear.</p>
        <small>Use Queue Ready Assets when you are ready to move them into review queue.</small>
      </article>
    `;
    return;
  }
  const metadata = next.metadata || {};
  const topic = metadata.topic || "Untitled asset";
  const blocker = next.compliance_status !== "clear"
    ? "Safety must be clear before queueing."
    : "Approval is required before queueing.";
  container.innerHTML = `
    <article class="learning-card wide-learning">
      <h3>Next Asset Review</h3>
      <p>${escapeHtml(topic)}</p>
      <small>${escapeHtml(blocker)} Current: ${escapeHtml(next.compliance_status || "pending")} / ${escapeHtml(next.review_status || "draft")}</small>
      <div class="learning-actions">
        <button type="button" data-copy-next-asset-review="${escapeHtml(next.id)}">Copy Review Note</button>
        <button type="button" data-copy-next-asset-decision="${escapeHtml(next.id)}">Copy Decision CSV</button>
        <button type="button" data-jump-next-asset-review>Jump To Asset</button>
      </div>
    </article>
  `;
}

function storedAssetById(assetId) {
  const items = JSON.parse(document.getElementById("asset-items")?.dataset.assets || "[]");
  return items.find((item) => item.id === assetId);
}

function mediaAssetCard(item) {
  const source = item.source_url || "";
  const sourceMarkup = source.startsWith("http")
    ? `<a class="media-link" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">${escapeHtml(source)}</a>`
    : `<small>${escapeHtml(source)}</small>`;
  return `
    <article class="queue-item">
      <div class="queue-meta">
        <span>${escapeHtml(item.media_type || "media")}</span>
        <span>${escapeHtml(item.rights_status || "unknown")}</span>
        <span>${escapeHtml(item.approval_status || "needs_review")}</span>
      </div>
      <p><strong>${escapeHtml(item.title || "Untitled media")}</strong></p>
      ${sourceMarkup}
      ${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ""}
      ${Array.isArray(item.tags) && item.tags.length ? `<small>${item.tags.map((tag) => `#${escapeHtml(tag)}`).join(" ")}</small>` : ""}
      <div class="queue-actions">
        <button type="button" data-media-status="approved" data-id="${escapeHtml(item.id)}">Approve</button>
        <button type="button" data-media-status="needs_review" data-id="${escapeHtml(item.id)}">Review</button>
        <button type="button" data-media-status="blocked" data-id="${escapeHtml(item.id)}">Block</button>
        <button type="button" data-media-link="${escapeHtml(item.id)}">Get Link</button>
      </div>
    </article>
  `;
}

async function loadMediaAssets() {
  const container = document.getElementById("media-items");
  if (!container) return;
  try {
    const data = await fetchJson("/media-assets");
    const items = data.items || [];
    container.dataset.mediaAssets = JSON.stringify(items);
    container.innerHTML = items.length
      ? items.map(mediaAssetCard).join("")
      : '<p class="status-note">No registered media yet. Add approved media URLs here before publishing.</p>';
  } catch {
    container.innerHTML = '<p class="status-note">Set the access token to load media.</p>';
  }
}

document.getElementById("media-items").addEventListener("click", async (event) => {
  const statusButton = event.target.closest("[data-media-status]");
  if (statusButton) {
    const status = statusButton.dataset.mediaStatus;
    const defaultReason = {
      approved: "Media approved for DREC publishing use.",
      needs_review: "Media needs review before publishing.",
      blocked: "Media blocked from publishing use.",
    }[status] || "Media status updated.";
    let reason = defaultReason;
    if (status !== "approved") {
      const entered = window.prompt("Add a media review note.", defaultReason);
      if (entered === null) return;
      reason = entered.trim() || defaultReason;
    }
    const originalText = statusButton.textContent;
    const message = document.getElementById("media-message");
    statusButton.disabled = true;
    statusButton.textContent = "Saving";
    try {
      await fetchJson(`/media-assets/${statusButton.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ approval_status: status, reason }),
      });
      message.textContent = "Media status updated.";
      await Promise.all([loadMediaAssets(), loadLoopStatus()]);
    } catch (error) {
      message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not update media status.";
      statusButton.disabled = false;
      statusButton.textContent = originalText;
    }
    return;
  }
  const button = event.target.closest("[data-media-link]");
  if (!button) return;
  const message = document.getElementById("media-message");
  button.disabled = true;
  button.textContent = "Getting";
  try {
    const data = await fetchJson(`/media-assets/${button.dataset.mediaLink}/signed-url`, { method: "POST" });
    if (data.url) {
      window.open(data.url, "_blank", "noopener,noreferrer");
      message.textContent = data.expires_in ? "Private link opened. It expires in 1 hour." : "Media link opened.";
    } else {
      message.textContent = "No media link is available.";
    }
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not create media link.";
  } finally {
    button.disabled = false;
    button.textContent = "Get Link";
  }
});

document.getElementById("approve-clear-assets").addEventListener("click", async (event) => {
  await runAssetBatchAction(event.currentTarget, "/assets/approve-clear?limit=20", "Approve clear assets");
});

document.getElementById("queue-ready-assets").addEventListener("click", async (event) => {
  await runAssetBatchAction(event.currentTarget, "/assets/queue-ready?limit=20", "Queue ready assets");
  showScreen("review");
});

document.getElementById("asset-next-review")?.addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-copy-next-asset-review]");
  const decisionButton = event.target.closest("[data-copy-next-asset-decision]");
  const jumpButton = event.target.closest("[data-jump-next-asset-review]");
  if (!copyButton && !decisionButton && !jumpButton) return;
  const message = document.getElementById("media-message");
  const assetId = copyButton?.dataset.copyNextAssetReview
    || decisionButton?.dataset.copyNextAssetDecision
    || document.querySelector("[data-copy-next-asset-review]")?.dataset.copyNextAssetReview;
  if (!assetId) return;
  if (jumpButton) {
    const target = document.querySelector(`[data-copy-asset-review="${CSS.escape(assetId)}"]`);
    if (target) {
      target.closest(".queue-item")?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (message) message.textContent = "Next asset review item shown.";
    }
    return;
  }
  const asset = storedAssetById(assetId);
  if (!asset) return;
  try {
    await navigator.clipboard.writeText(decisionButton ? assetReviewDecisionCsvText(asset) : assetReviewNoteText(asset));
    if (message) message.textContent = decisionButton ? "Next asset decision CSV copied." : "Next asset review note copied.";
  } catch {
    if (message) message.textContent = "Could not copy review content. Use Download Safety Review or Review Decisions instead.";
  }
});

async function loadAssets() {
  const container = document.getElementById("asset-items");
  if (!container) return;
  try {
    const data = await fetchJson("/assets");
    const items = data.items || [];
    container.dataset.assets = JSON.stringify(items);
    renderNextAssetReview(items);
    container.innerHTML = items.length
      ? items.map(assetCard).join("")
      : '<p class="status-note">No saved assets yet. Save one from Create Post.</p>';
  } catch {
    renderNextAssetReview([]);
    container.innerHTML = '<p class="status-note">Set the access token to load assets.</p>';
  }
}

function doctorPolishText(item) {
  return [
    `Doctor polish review: ${item.topic || "Untitled asset"}`,
    `Asset ID: ${item.asset_id || ""}`,
    `Channel / format: ${item.channel || ""} / ${item.format || ""}`,
    "",
    "Suggested polished copy:",
    item.suggested_review_copy || "No polished copy available.",
    "",
    "Safety notes:",
    ...(item.why_this_is_safer || ["Doctor review still required."]).map((note) => `- ${note}`),
    "",
    "Reply format:",
    item.doctor_reply_template || "",
  ].join("\n");
}

function doctorPolishBatchText(items) {
  return [
    "DREC Doctor Polish Review Batch",
    `Items: ${items.length}`,
    "Please review the polished Mandarin copy below. Approve only if the medical meaning is safe, educational, non-diagnostic, and non-guaranteed.",
    "If approved, reply with Decision: approve, Safety: clear, and Use polished copy: yes for each Asset ID.",
    "This copied text does not approve, attach media, queue, schedule, publish, or send Meta requests.",
    "",
    ...items.map((item, index) => [
      `--- ${index + 1} / ${items.length} ---`,
      doctorPolishText(item),
    ].join("\n")),
  ].join("\n\n");
}

function doctorSendText(item) {
  return [
    `Doctor review: ${item.topic || "Untitled asset"}`,
    `Asset ID: ${item.asset_id || ""}`,
    `Channel / format: ${item.channel || ""} / ${item.format || ""}`,
    "",
    "Copy to review:",
    item.copy_to_review || "No copy available.",
    "",
    "Reply format:",
    item.reply_template || "",
    "",
    "Safe use rule:",
    item.safe_use_rule || "Only import approval when Decision: approve and Safety: clear are explicit.",
  ].join("\n");
}

function doctorReplyTemplateText(item) {
  return item.reply_template || [
    `Asset ID: ${item.asset_id || ""}`,
    "Decision: approve / changes_needed / reject",
    "Safety: clear / needs_edit / unsafe",
    "Notes:",
  ].join("\n");
}

function doctorSendBatchText(items) {
  return [
    "DREC Doctor Send Queue",
    `Items: ${items.length}`,
    "Please review the copy below. Approve only if the medical meaning is safe, educational, non-diagnostic, and non-guaranteed.",
    "Reply with Decision: approve and Safety: clear only when the asset is safe to move forward.",
    "This copied text does not approve, attach media, queue, schedule, publish, or send Meta requests.",
    "",
    ...items.map((item, index) => [
      `--- ${index + 1} / ${items.length} ---`,
      doctorSendText(item),
    ].join("\n")),
  ].join("\n\n");
}

function renderDoctorSendQueue(data) {
  const container = document.getElementById("doctor-send-queue");
  if (!container) return;
  const items = data.bridge_items || [];
  latestDoctorSendItems = items;
  latestDoctorFullMessage = data.full_doctor_message || "";
  latestDoctorPasteBackTemplate = data.paste_back_template || "";
  const itemCards = items.map((item, index) => `
    <article class="learning-card sprint-item-card">
      <h4>${index + 1}. ${escapeHtml(item.topic || "Untitled asset")}</h4>
      <small>${escapeHtml(item.channel || "channel")} / ${escapeHtml(item.format || "format")} · ${escapeHtml(item.asset_id || "")}</small>
      <p>${escapeHtml((item.copy_to_review || "").slice(0, 260))}${(item.copy_to_review || "").length > 260 ? "..." : ""}</p>
      <div class="learning-actions">
        <button type="button" data-copy-doctor-send="${escapeHtml(item.asset_id || "")}">Copy Doctor</button>
        <button type="button" data-copy-doctor-reply-template="${escapeHtml(item.asset_id || "")}">Copy Reply</button>
      </div>
    </article>
  `).join("");
  container.innerHTML = `
    <article class="learning-card">
      <h3>Doctor Send Queue</h3>
      <p>${escapeHtml(data.bridge_item_count || items.length)}</p>
      <small>${escapeHtml(data.mode || "manual_doctor_review")}</small>
    </article>
    <article class="learning-card">
      <h3>Review Status</h3>
      <p>${escapeHtml(data.ready_for_review || 0)}</p>
      <small>doctor approval required</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>Copy To Doctor</h3>
      <p>${escapeHtml(data.paste_back_template || "Copy the review text, then paste back the doctor's explicit decision and safety status.")}</p>
      <div class="learning-actions sprint-bulk-actions">
        <button type="button" data-copy-doctor-full-message>Copy Full Message</button>
        <button type="button" data-copy-doctor-paste-back>Copy Paste-Back</button>
        <button type="button" data-copy-doctor-send-all>Copy Item Batch</button>
      </div>
      <div class="sprint-board">${itemCards || '<p class="status-note">No doctor send items are ready yet.</p>'}</div>
    </article>
  `;
}

async function loadDoctorSendQueue() {
  const container = document.getElementById("doctor-send-queue");
  if (!container) return;
  try {
    const data = await fetchJson("/operations/doctor-review-bridge");
    renderDoctorSendQueue(data);
  } catch (error) {
    container.innerHTML = '<p class="status-note">Set the access token to load the doctor send queue.</p>';
  }
}

function doctorInboxReplyText(item) {
  return [
    `Doctor reply template: ${item.topic || "Untitled asset"}`,
    `Asset ID: ${item.asset_id || ""}`,
    `Channel / format: ${item.channel || ""} / ${item.format || ""}`,
    "",
    item.reply_template || "No reply template available.",
    "",
    "Safe approval rule:",
    item.safe_approval_rule || "Approve only with Decision: approve and Safety: clear.",
    "",
    "Polished copy rule:",
    item.polished_copy_rule || "Use polished copy only when explicitly approved.",
  ].join("\n");
}

function doctorInboxBatchText(items) {
  return [
    "DREC Doctor Reply Inbox Templates",
    `Items: ${items.length}`,
    "Paste returned doctor blocks into Doctor Reply Text, preview first, then import only approved clear replies.",
    "This copied text does not approve, edit, queue, schedule, publish, or send Meta requests.",
    "",
    ...items.map((item, index) => [
      `--- ${index + 1} / ${items.length} ---`,
      doctorInboxReplyText(item),
    ].join("\n")),
  ].join("\n\n");
}

function renderDoctorReplyInboxPack(data) {
  const container = document.getElementById("doctor-reply-inbox");
  if (!container) return;
  const items = data.reply_items || [];
  latestDoctorReplyItems = items;
  const itemCards = items.map((item, index) => `
    <article class="learning-card sprint-item-card">
      <h4>${index + 1}. ${escapeHtml(item.topic || "Untitled asset")}</h4>
      <small>${escapeHtml(item.channel || "channel")} / ${escapeHtml(item.format || "format")} · ${escapeHtml(item.asset_id || "")}</small>
      <p>${escapeHtml((item.reply_template || "").slice(0, 220))}${(item.reply_template || "").length > 220 ? "..." : ""}</p>
      <div class="learning-actions">
        <button type="button" data-copy-doctor-inbox-reply="${escapeHtml(item.asset_id || "")}">Copy Reply</button>
      </div>
    </article>
  `).join("");
  container.innerHTML = `
    <article class="learning-card">
      <h3>Doctor Reply Inbox</h3>
      <p>${escapeHtml(data.reply_block_count || items.length)}</p>
      <small>${escapeHtml(data.mode || "preview_before_import")}</small>
    </article>
    <article class="learning-card">
      <h3>Ready For Review</h3>
      <p>${escapeHtml(data.ready_for_review || 0)}</p>
      <small>preview before import</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>Paste-Back Templates</h3>
      <p>${escapeHtml(data.next_step || "Copy reply templates, paste returned doctor replies into Doctor Reply Text, preview, then import.")}</p>
      <div class="learning-actions sprint-bulk-actions">
        <button type="button" data-copy-doctor-inbox-all>Copy All Replies</button>
      </div>
      <div class="sprint-board">${itemCards || '<p class="status-note">No doctor reply templates are ready yet.</p>'}</div>
    </article>
  `;
}

async function loadDoctorReplyInboxPack() {
  const container = document.getElementById("doctor-reply-inbox");
  if (!container) return;
  try {
    const data = await fetchJson("/operations/doctor-reply-inbox-pack");
    renderDoctorReplyInboxPack(data);
  } catch (error) {
    container.innerHTML = '<p class="status-note">Set the access token to load the doctor reply inbox.</p>';
  }
}

function renderDoctorReviewPolishPack(data) {
  const container = document.getElementById("doctor-review-polish");
  if (!container) return;
  const items = data.polish_items || [];
  latestDoctorPolishItems = items;
  const itemCards = items.slice(0, 5).map((item, index) => `
    <article class="learning-card sprint-item-card">
      <h4>${index + 1}. ${escapeHtml(item.topic || "Untitled asset")}</h4>
      <small>${escapeHtml(item.channel || "channel")} / ${escapeHtml(item.format || "format")} · ${escapeHtml(item.asset_id || "")}</small>
      <p>${escapeHtml((item.suggested_review_copy || "").slice(0, 260))}${(item.suggested_review_copy || "").length > 260 ? "..." : ""}</p>
      <div class="learning-actions">
        <button type="button" data-copy-doctor-polish="${escapeHtml(item.asset_id || "")}">Copy Polish</button>
      </div>
    </article>
  `).join("");
  container.innerHTML = `
    <article class="learning-card">
      <h3>Doctor Polish</h3>
      <p>${escapeHtml(data.polish_count || 0)} suggestions</p>
      <small>${escapeHtml(data.mode || "suggested_copy_only")}</small>
    </article>
    <article class="learning-card">
      <h3>Ready Copy</h3>
      <p>${escapeHtml(data.ready_for_review || 0)}</p>
      <small>doctor review still required</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>Review-Ready Mandarin</h3>
      <p>${escapeHtml(data.next_step || "Copy one polished item into the doctor review request.")}</p>
      <div class="learning-actions sprint-bulk-actions">
        <button type="button" data-copy-doctor-polish-all>Copy All Polish</button>
      </div>
      <div class="sprint-board">${itemCards || '<p class="status-note">No polish suggestions are ready yet.</p>'}</div>
    </article>
  `;
}

async function loadDoctorReviewPolishPack() {
  const container = document.getElementById("doctor-review-polish");
  if (!container) return;
  try {
    const data = await fetchJson("/operations/doctor-review-polish-pack");
    renderDoctorReviewPolishPack(data);
  } catch (error) {
    container.innerHTML = '<p class="status-note">Set the access token to load doctor polish suggestions.</p>';
  }
}

function sprintDoctorText(item) {
  return [
    `Review: ${item.topic || "Untitled asset"}`,
    `Asset ID: ${item.asset_id || ""}`,
    `Channel / format: ${item.channel || ""} / ${item.format || ""}`,
    "",
    "Copy to review:",
    item.copy_to_review || "No copy available.",
    "",
    "Reply format:",
    item.doctor_reply_template || "",
  ].join("\n");
}

function sprintProductionText(item) {
  return [
    `Production: ${item.topic || "Untitled asset"}`,
    `Asset ID: ${item.asset_id || ""}`,
    `Channel / format: ${item.channel || ""} / ${item.format || ""}`,
    "",
    `Task: ${item.production_task || "Prepare production media after doctor approval."}`,
    `Visual direction: ${item.visual_direction || "Use safe DREC educational visual treatment."}`,
    `Template: ${item.template_suggestion || "Use the matching Template Studio layout."}`,
    `Rights check: ${item.rights_check || "Use only approved/licensed/owned/patient-consented media."}`,
    "",
    "Reply format:",
    item.production_reply_template || "",
  ].join("\n");
}

function sprintBatchText(items, formatter, label) {
  return [
    `DREC First Cycle ${label}`,
    `Items: ${items.length}`,
    "Use preview/import in DREC Content OS after replies are returned. This text does not approve, attach media, queue, schedule, publish, or send Meta requests.",
    "",
    ...items.map((item, index) => [
      `--- ${index + 1} / ${items.length} ---`,
      formatter(item),
    ].join("\n")),
  ].join("\n\n");
}

function renderFirstCycleSprintPack(data) {
  const container = document.getElementById("first-cycle-sprint");
  if (!container) return;
  const items = data.sprint_items || [];
  latestSprintItems = items;
  const itemCards = items.map((item, index) => `
    <article class="learning-card sprint-item-card">
      <h4>${index + 1}. ${escapeHtml(item.topic || "Untitled asset")}</h4>
      <small>${escapeHtml(item.channel || "channel")} / ${escapeHtml(item.format || "format")} · ${escapeHtml(item.asset_id || "")}</small>
      <p>${escapeHtml((item.copy_to_review || "").slice(0, 220))}${(item.copy_to_review || "").length > 220 ? "..." : ""}</p>
      <div class="learning-actions">
        <button type="button" data-copy-sprint-doctor="${escapeHtml(item.asset_id || "")}">Copy Doctor</button>
        <button type="button" data-copy-sprint-production="${escapeHtml(item.asset_id || "")}">Copy Production</button>
      </div>
    </article>
  `).join("");
  container.innerHTML = `
    <article class="learning-card">
      <h3>Sprint Board</h3>
      <p>${escapeHtml(items.length)} items</p>
      <small>${escapeHtml(data.mode || "manual_safe_sprint")}</small>
    </article>
    <article class="learning-card">
      <h3>Doctor Review</h3>
      <p>${escapeHtml(data.ready_for_doctor_review || 0)}</p>
      <small>copy request text below</small>
    </article>
    <article class="learning-card">
      <h3>Needs Media</h3>
      <p>${escapeHtml(data.needs_media || 0)}</p>
      <small>after doctor approval</small>
    </article>
    <article class="learning-card">
      <h3>Ready To Schedule</h3>
      <p>${escapeHtml(data.ready_to_schedule || 0)}</p>
      <small>must pass approval and media gates</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>Copy Sprint Messages</h3>
      <div class="learning-actions sprint-bulk-actions">
        <button type="button" data-copy-sprint-doctor-all>Copy All Doctor</button>
        <button type="button" data-copy-sprint-production-all>Copy All Production</button>
      </div>
      <div class="sprint-board">${itemCards || '<p class="status-note">No sprint items are ready yet.</p>'}</div>
    </article>
  `;
}

async function loadFirstCycleSprintPack() {
  const container = document.getElementById("first-cycle-sprint");
  if (!container) return;
  try {
    const data = await fetchJson("/operations/first-cycle-sprint-pack");
    renderFirstCycleSprintPack(data);
  } catch (error) {
    container.innerHTML = '<p class="status-note">Set the access token to load the sprint board.</p>';
  }
}

function renderFirstCycleHandoff(data) {
  const container = document.getElementById("first-cycle-handoff");
  if (!container) return;
  const summary = data.summary || {};
  const stages = data.stages || [];
  const recommended = data.recommended_step || {};
  container.innerHTML = `
    <article class="learning-card">
      <h3>First Cycle</h3>
      <p>${escapeHtml(recommended.label || "Review next step")}</p>
      <small>${escapeHtml(recommended.status || data.mode || "manual_safe_sequence")}</small>
    </article>
    <article class="learning-card">
      <h3>Safe Rewrites</h3>
      <p>${escapeHtml(summary.safe_rewrite_candidates || 0)}</p>
      <small>before human approval</small>
    </article>
    <article class="learning-card">
      <h3>Ready To Queue</h3>
      <p>${escapeHtml(summary.ready_to_queue || 0)}</p>
      <small>approved and clear</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>Manual Sequence</h3>
      <ul>${stages.length ? stages.map((stage) => `<li><strong>${escapeHtml(stage.label || "")}</strong> · ${escapeHtml(stage.status || "")}<br><small>${escapeHtml(stage.action || stage.detail || "")}</small></li>`).join("") : "<li>No first-cycle guidance available.</li>"}</ul>
    </article>
  `;
}

async function loadFirstCycleHandoff() {
  const container = document.getElementById("first-cycle-handoff");
  if (!container) return;
  try {
    const data = await fetchJson("/operations/first-cycle-handoff");
    renderFirstCycleHandoff(data);
  } catch (error) {
    container.innerHTML = '<p class="status-note">Set the access token to load the first cycle handoff.</p>';
  }
}

function renderApprovalCockpit(data) {
  const container = document.getElementById("approval-cockpit");
  if (!container) return;
  const items = data.approval_items || [];
  const first = data.recommended_first_asset || {};
  container.innerHTML = `
    <article class="learning-card">
      <h3>Approval Cockpit</h3>
      <p>${escapeHtml(data.ready_count || 0)} ready</p>
      <small>${escapeHtml(data.mode || "human_approval_only")}</small>
    </article>
    <article class="learning-card">
      <h3>First Review</h3>
      <p>${escapeHtml(first.format || "none")}</p>
      <small>${escapeHtml(first.topic || "No ready asset")}</small>
    </article>
    <article class="learning-card">
      <h3>Blocked</h3>
      <p>${escapeHtml(data.blocked_count || 0)}</p>
      <small>needs edit or review decision</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>Approval Shortlist</h3>
      <ul>${items.length ? items.slice(0, 5).map((item) => `<li><strong>${escapeHtml(item.topic || "Untitled asset")}</strong> · score ${escapeHtml(item.approval_score || 0)} · ${escapeHtml(item.approval_status || "")}<br><small>${escapeHtml(item.media_gap || item.next_step || "")}</small></li>`).join("") : "<li>No approval candidates found.</li>"}</ul>
    </article>
  `;
}

async function loadApprovalCockpit() {
  const container = document.getElementById("approval-cockpit");
  if (!container) return;
  try {
    const data = await fetchJson("/operations/approval-cockpit");
    renderApprovalCockpit(data);
  } catch (error) {
    container.innerHTML = '<p class="status-note">Set the access token to load the approval cockpit.</p>';
  }
}

function productionDesignText(item) {
  return [
    item.designer_handoff || `DREC Production Handoff\n\nAsset ID: ${item.asset_id || ""}`,
    "",
    "Approved-caption context:",
    item.caption_preview || "No caption preview available.",
    "",
    "Return format:",
    `Asset ID: ${item.asset_id || ""}`,
    "Media URLs: https://...",
    "Visual QA: passed / pending / needs_work",
    "Rights: owned / licensed / approved stock / patient consent",
    "Notes:",
  ].join("\n");
}

function productionBatchText(items) {
  return [
    "DREC Production Design Batch",
    `Items: ${items.length}`,
    "Use this only after doctor approval. This text does not approve, attach media, queue, schedule, publish, or send Meta requests.",
    "",
    ...items.map((item, index) => [
      `--- ${index + 1} / ${items.length} ---`,
      productionDesignText(item),
    ].join("\n")),
  ].join("\n\n");
}

function renderPostApprovalProduction(data) {
  const container = document.getElementById("post-approval-production");
  if (!container) return;
  const items = data.production_items || [];
  latestProductionItems = items;
  const first = items[0] || {};
  const itemCards = items.slice(0, 5).map((item, index) => `
    <article class="learning-card sprint-item-card">
      <h4>${index + 1}. ${escapeHtml(item.topic || "Untitled asset")}</h4>
      <small>${escapeHtml(item.stage || "")} · ${escapeHtml(item.channel || "channel")} / ${escapeHtml(item.format || "format")}</small>
      <p>${escapeHtml(item.media_task || item.media_gap || "")}</p>
      <div class="learning-actions">
        <button type="button" data-copy-production-design="${escapeHtml(item.asset_id || "")}">Copy Design</button>
      </div>
    </article>
  `).join("");
  container.innerHTML = `
    <article class="learning-card">
      <h3>Production Pack</h3>
      <p>${escapeHtml(data.needs_media_count || 0)} need media</p>
      <small>${escapeHtml(data.mode || "production_prep_only")}</small>
    </article>
    <article class="learning-card">
      <h3>After Approval</h3>
      <p>${escapeHtml(data.approved_ready_count || 0)}</p>
      <small>approved and ready for design checks</small>
    </article>
    <article class="learning-card">
      <h3>Next Handoff</h3>
      <p>${escapeHtml(first.format || "none")}</p>
      <small>${escapeHtml(first.topic || "No production item")}</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>Design And Media Tasks</h3>
      <div class="learning-actions sprint-bulk-actions">
        <button type="button" data-copy-production-design-all>Copy All Design</button>
      </div>
      <div class="sprint-board">${itemCards || '<p class="status-note">Finish human approval first.</p>'}</div>
    </article>
  `;
}

async function loadPostApprovalProduction() {
  const container = document.getElementById("post-approval-production");
  if (!container) return;
  try {
    const data = await fetchJson("/operations/post-approval-production");
    renderPostApprovalProduction(data);
  } catch (error) {
    container.innerHTML = '<p class="status-note">Set the access token to load the production pack.</p>';
  }
}

function renderAssetReviewSession(data) {
  const container = document.getElementById("asset-review-session");
  if (!container) return;
  const items = data.session_items || [];
  const rules = data.decision_rules || [];
  container.innerHTML = `
    <article class="learning-card">
      <h3>Review Session</h3>
      <p>${escapeHtml(data.active_asset_count || 0)} active asset(s)</p>
      <small>${escapeHtml(data.mode || "human_review_required")}</small>
    </article>
    <article class="learning-card">
      <h3>Can Approve</h3>
      <p>${escapeHtml(data.can_approve_count || 0)}</p>
      <small>after human checklist</small>
    </article>
    <article class="learning-card">
      <h3>Ready To Queue</h3>
      <p>${escapeHtml(data.ready_to_queue_count || 0)}</p>
      <small>approved + Safety Clear</small>
    </article>
    <article class="learning-card">
      <h3>Needs Rewrite</h3>
      <p>${escapeHtml(data.needs_rewrite_count || 0)}</p>
      <small>detector or reviewer block</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>Next Review Items</h3>
      <ul>${items.length ? items.slice(0, 6).map((item) => `<li><strong>${escapeHtml(item.topic || "Untitled asset")}</strong> · ${escapeHtml(item.recommended_decision || "")}<br><small>${escapeHtml(item.next_step || "")}</small></li>`).join("") : "<li>No active assets found.</li>"}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Decision Rules</h3>
      <ul>${rules.length ? rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("") : "<li>Human review required before queueing.</li>"}</ul>
      <p>${escapeHtml(data.next_step || "")}</p>
    </article>
  `;
}

async function loadAssetReviewSession() {
  const container = document.getElementById("asset-review-session");
  if (!container) return;
  try {
    const data = await fetchJson("/operations/asset-review-session");
    renderAssetReviewSession(data);
  } catch (error) {
    container.innerHTML = '<p class="status-note">Set the access token to load the asset review session.</p>';
  }
}

function renderAssetRewritePack(data) {
  const container = document.getElementById("asset-rewrite-pack");
  if (!container) return;
  const items = data.rewrite_items || [];
  const rules = data.rules || [];
  container.dataset.rewriteItems = JSON.stringify(items);
  container.innerHTML = `
    <article class="learning-card">
      <h3>Rewrite Pack</h3>
      <p>${escapeHtml(data.rewrite_count || 0)} suggestion(s)</p>
      <small>${escapeHtml(data.mode || "suggested_rewrite_only")}</small>
    </article>
    <article class="learning-card">
      <h3>Cleaner After Rewrite</h3>
      <p>${escapeHtml(data.clear_after_rewrite_count || 0)}</p>
      <small>still needs human approval</small>
      ${data.clear_after_rewrite_count ? '<button type="button" data-apply-all-safe-rewrites>Apply All Safe Rewrites</button>' : ""}
    </article>
    <article class="learning-card">
      <h3>Still Needs Review</h3>
      <p>${escapeHtml(data.still_needs_review_count || 0)}</p>
      <small>rewrite or reviewer attention</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>Suggested Caption Fixes</h3>
      <ul>${items.length ? items.slice(0, 5).map((item) => `<li><strong>${escapeHtml(item.topic || "Untitled asset")}</strong> · ${escapeHtml(item.before_status || "")} → ${escapeHtml(item.after_status || "")}<br><small>${escapeHtml(item.next_step || "")}</small><br><button type="button" data-apply-asset-rewrite="${escapeHtml(item.asset_id || "")}">Apply Rewrite</button></li>`).join("") : "<li>No rewrite candidates found.</li>"}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Rewrite Rules</h3>
      <ul>${rules.length ? rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("") : "<li>Human review required before applying rewrites.</li>"}</ul>
      <p>${escapeHtml(data.next_step || "")}</p>
    </article>
  `;
}

async function loadAssetRewritePack() {
  const container = document.getElementById("asset-rewrite-pack");
  if (!container) return;
  try {
    const data = await fetchJson("/operations/asset-rewrite-pack");
    renderAssetRewritePack(data);
  } catch (error) {
    container.innerHTML = '<p class="status-note">Set the access token to load the rewrite pack.</p>';
  }
}

document.getElementById("asset-rewrite-pack")?.addEventListener("click", async (event) => {
  const allButton = event.target.closest("[data-apply-all-safe-rewrites]");
  const container = document.getElementById("asset-rewrite-pack");
  const message = document.getElementById("media-message");
  if (allButton) {
    const confirmed = window.confirm("Apply all clear safe rewrites? Assets will still need human approval before queueing.");
    if (!confirmed) return;
    const originalText = allButton.textContent;
    allButton.disabled = true;
    allButton.textContent = "Applying";
    try {
      const data = await fetchJson("/assets/apply-safe-rewrites", { method: "POST" });
      message.textContent = data.message || "Safe rewrites applied. Human approval is still required.";
      await Promise.all([loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadAssetReviewSession(), loadAssetRewritePack(), loadLoopStatus(), loadLearningSummary()]);
    } catch (error) {
      message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not apply safe rewrites.";
      allButton.disabled = false;
      allButton.textContent = originalText;
    }
    return;
  }
  const button = event.target.closest("[data-apply-asset-rewrite]");
  if (!button) return;
  const items = JSON.parse(container.dataset.rewriteItems || "[]");
  const item = items.find((entry) => entry.asset_id === button.dataset.applyAssetRewrite);
  if (!item?.suggested_caption) {
    message.textContent = "Rewrite suggestion not found.";
    return;
  }
  const confirmed = window.confirm("Apply this suggested caption to the asset? It will still need human approval before queueing.");
  if (!confirmed) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Applying";
  try {
    const data = await fetchJson(`/assets/${button.dataset.applyAssetRewrite}/caption`, {
      method: "PATCH",
      body: JSON.stringify({
        caption: item.suggested_caption,
        reason: "Applied safe rewrite suggestion; human approval still required.",
      }),
    });
    message.textContent = data.message || "Rewrite applied. Human approval is still required.";
    await Promise.all([loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadAssetReviewSession(), loadAssetRewritePack(), loadLoopStatus(), loadLearningSummary()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not apply rewrite.";
    button.disabled = false;
    button.textContent = originalText;
  }
});

async function runAssetBatchAction(button, path, label) {
  const message = document.getElementById("media-message");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Working";
  message.textContent = `${label}...`;
  try {
    const data = await fetchJson(path, { method: "POST" });
    const summary = [
      data.approved !== undefined ? `${data.approved} approved` : null,
      data.queued !== undefined ? `${data.queued} queued` : null,
      data.reused !== undefined ? `${data.reused} reused` : null,
      data.already_approved !== undefined ? `${data.already_approved} already approved` : null,
      `${data.skipped || 0} skipped`,
    ].filter(Boolean).join(", ");
    message.textContent = `${label} complete: ${summary}.`;
    await Promise.all([loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadAssetReviewSession(), loadAssetRewritePack(), loadPublishQueue(), loadLoopStatus(), loadLearningSummary()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : `${label} failed.`;
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function recordPublishedItem(itemId, button, options = {}) {
  const postId = window.prompt("Paste the Meta post ID after you publish this item.");
  if (!postId || !postId.trim()) return;
  const message = document.getElementById("queue-message");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Saving";
  try {
    await fetchJson(`/publish-queue/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "published", external_post_id: postId.trim() }),
    });
    await Promise.all([loadPublishQueue(), loadLoopStatus(), loadMetaReadiness()]);
    if (options.refreshHandoff) {
      const data = await fetchJson("/publishing-handoff");
      renderHandoff(data);
    }
    message.textContent = "Published item recorded.";
  } catch {
    button.disabled = false;
    button.textContent = originalText;
    message.textContent = "Could not record published item.";
  }
}

function renderHandoff(data) {
  const container = document.getElementById("handoff-result");
  const ready = data.ready_items || [];
  const needsReview = data.needs_review || [];
  container.innerHTML = `
    <div class="handoff-summary">
      <article class="learning-card">
        <h3>Ready To Publish</h3>
        <p>${Number(data.ready_count || 0)} item(s)</p>
      </article>
      <article class="learning-card">
        <h3>Needs Review</h3>
        <p>${Number(data.blocked_count || 0)} item(s)</p>
      </article>
    </div>
    <div class="learning-card">
      <h3>Checklist</h3>
      <ul>${(data.checklist || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
    <div class="learning-card wide-learning">
      <h3>Copy Package</h3>
      <textarea id="handoff-copy-text" readonly>${escapeHtml(data.handoff_text || "")}</textarea>
      <div class="queue-actions">
        <button type="button" data-copy-handoff>Copy Handoff</button>
      </div>
    </div>
    <h3 class="handoff-heading">Ready Items</h3>
    ${ready.length ? ready.map(handoffItem).join("") : '<p class="status-note">No scheduled compliance-clear items yet.</p>'}
    <h3 class="handoff-heading">Needs Review</h3>
    ${needsReview.length ? needsReview.map(handoffItem).join("") : '<p class="status-note">Nothing blocked right now.</p>'}
  `;
}

function renderScheduleWorksheetPreview(data) {
  const container = document.getElementById("schedule-worksheet-preview");
  if (!container) return;
  const rows = data.planned || data.imported || [];
  const skipped = data.skipped || [];
  container.innerHTML = `
    <article class="insight-card">
      <strong>${data.dry_run ? "Schedule Worksheet Preview" : "Schedule Worksheet Import"}</strong>
      <small>${rows.length} row(s) ready · ${skipped.length} skipped</small>
      ${rows.length ? `
        <ul>${rows.slice(0, 10).map((row) => `
          <li>
            <strong>${escapeHtml(row.channel || "channel")} / ${escapeHtml(row.format || "format")}</strong>
            ${escapeHtml(formatDate(row.planned_slot) || row.planned_slot_myt || "")}
            ${row.scheduler_name ? ` · ${escapeHtml(row.scheduler_name)}` : ""}
          </li>
        `).join("")}</ul>
      ` : ""}
      ${skipped.length ? `
        <h4>Skipped Rows</h4>
        <ul>${skipped.slice(0, 10).map((row) => `<li><strong>Row ${escapeHtml(row.row || "")}</strong> ${escapeHtml(row.queue_id || "")}${row.queue_id ? " · " : ""}${escapeHtml(row.reason || "")}</li>`).join("")}</ul>
      ` : ""}
      ${Array.isArray(data.safety) && data.safety.length ? `
        <h4>Safety</h4>
        <ul>${data.safety.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      ` : ""}
    </article>
  `;
}

function renderMetaPublishingJobDryRun(data) {
  const container = document.getElementById("meta-publishing-result");
  const results = data.results || [];
  container.innerHTML = `
    <div class="handoff-summary">
      <article class="learning-card">
        <h3>Publishing Job</h3>
        <p>${escapeHtml(data.job?.name || "meta-publishing")} · ${data.job?.due_only ? "due posts only" : "all scheduled posts"}</p>
      </article>
      <article class="learning-card">
        <h3>Ready Channels</h3>
        <p>${Number(data.ready_count || 0)} ready</p>
      </article>
    </div>
    <article class="learning-card wide-learning">
      <h3>Channel Dry Run</h3>
      <ul>
        ${results.length ? results.map((item) => `
          <li>
            <strong>${escapeHtml(item.channel || "unknown")}</strong>
            ${item.ready ? "ready" : "blocked"}
            ${item.item?.planned_slot ? ` · due ${formatDate(item.item.planned_slot)}` : ""}
          </li>
        `).join("") : "<li>No publishing job results yet.</li>"}
      </ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Blockers</h3>
      <ul>
        ${results.flatMap((item) => item.blockers || []).length
          ? results.flatMap((item) => (item.blockers || []).map((blocker) => `<li><strong>${escapeHtml(item.channel || "unknown")}</strong> ${escapeHtml(blocker)}</li>`)).join("")
          : "<li>No blockers in dry run.</li>"}
      </ul>
    </article>
  `;
}

function renderFacebookDispatch(data) {
  const container = document.getElementById("handoff-result");
  const blockers = data.blockers || [];
  const item = data.item || {};
  container.innerHTML = `
    <div class="handoff-summary">
      <article class="learning-card">
        <h3>Worker Mode</h3>
        <p>${escapeHtml(data.mode || "dry_run")}</p>
      </article>
      <article class="learning-card">
        <h3>Ready</h3>
        <p>${data.ready ? "Ready for gated test" : "Blocked"}</p>
      </article>
    </div>
    <article class="learning-card wide-learning">
      <h3>Selected Item</h3>
      <p>${item.id ? escapeHtml(item.caption || "") : "No eligible Facebook item selected."}</p>
      ${item.id ? `<small>${escapeHtml(item.id)} · ${escapeHtml(item.status)} · ${escapeHtml(item.compliance_status)}</small>` : ""}
    </article>
    <article class="learning-card wide-learning">
      <h3>Blockers</h3>
      <ul>${blockers.length ? blockers.map((blocker) => `<li>${escapeHtml(blocker)}</li>`).join("") : "<li>No blockers in dry run.</li>"}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Safety</h3>
      <ul>${(data.safety || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>
    </article>
  `;
}

function renderInstagramDispatch(data) {
  const container = document.getElementById("handoff-result");
  const blockers = data.blockers || [];
  const item = data.item || {};
  const planned = data.planned_requests || [];
  container.innerHTML = `
    <div class="handoff-summary">
      <article class="learning-card">
        <h3>Worker Mode</h3>
        <p>${escapeHtml(data.mode || "dry_run")}</p>
      </article>
      <article class="learning-card">
        <h3>Ready</h3>
        <p>${data.ready ? "Ready for gated test" : "Blocked"}</p>
      </article>
    </div>
    <article class="learning-card wide-learning">
      <h3>Selected Item</h3>
      <p>${item.id ? escapeHtml(item.caption || "") : "No eligible Instagram item selected."}</p>
      ${item.id ? `<small>${escapeHtml(item.id)} · ${escapeHtml(item.status)} · ${escapeHtml(item.compliance_status)}</small>` : ""}
    </article>
    <article class="learning-card wide-learning">
      <h3>Planned Requests</h3>
      <ul>
        ${planned.length ? planned.map((step) => `<li><strong>${escapeHtml(step.step)}</strong> ${escapeHtml(step.url || "")}</li>`).join("") : "<li>No Instagram request plan yet.</li>"}
      </ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Blockers</h3>
      <ul>${blockers.length ? blockers.map((blocker) => `<li>${escapeHtml(blocker)}</li>`).join("") : "<li>No blockers in dry run.</li>"}</ul>
    </article>
    <article class="learning-card wide-learning">
      <h3>Safety</h3>
      <ul>${(data.safety || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>
    </article>
  `;
}

async function loadOutcomes() {
  const container = document.getElementById("outcome-items");
  if (!container) return;
  try {
    const data = await fetchJson("/outcomes");
    const items = data.items || [];
    container.innerHTML = items.length
      ? items.map(outcomeCard).join("")
      : '<p class="status-note">No performance records yet.</p>';
  } catch {
    container.innerHTML = '<p class="status-note">Set the access token to load performance records.</p>';
  }
}

function queueCard(item, mode) {
  const mediaCount = Array.isArray(item.media_urls) ? item.media_urls.length : 0;
  const canApprove = item.compliance_status === "clear";
  const canMarkPublished = mode === "queue" && item.status === "scheduled" && item.compliance_status === "clear";
  const activeQueueItem = !["published", "cancelled"].includes(item.status);
  const canQuickSchedule = mode === "queue" && activeQueueItem && item.compliance_status === "clear";
  const canEdit = activeQueueItem;
  const canCancel = mode === "queue" && ["draft", "scheduled", "failed"].includes(item.status || "draft");
  const feedback = item.latest_feedback || null;
  const reviewApproved = feedback?.action === "approve" && item.status === "draft";
  const displayStatus = reviewApproved ? "approved" : item.status || "draft";
  const postIdLine = item.external_post_id
    ? `<small>Meta ID: ${escapeHtml(item.external_post_id)}</small>`
    : "";
  const reviewReadyLine = reviewApproved
    ? '<small class="feedback-note">Ready to schedule. Choose a planned time before handoff or Meta dispatch.</small>'
    : "";
  const feedbackLine = feedback
    ? `<small class="feedback-note">Latest review: ${escapeHtml(feedback.action || "note")}${feedback.reason ? ` · ${escapeHtml(feedback.reason)}` : ""}</small>`
    : "";
  const actions = mode === "review" ? `
    <div class="queue-actions">
      <button type="button" data-feedback="approve" data-id="${escapeHtml(item.id)}" ${canApprove ? "" : "disabled"}>Approve</button>
      <button type="button" data-edit-queue="${escapeHtml(item.id)}" ${canEdit ? "" : "disabled"}>Edit Item</button>
      <button type="button" data-schedule-next="${escapeHtml(item.id)}" ${reviewApproved && canApprove ? "" : "disabled"}>Suggest Slot</button>
      <button type="button" data-feedback="regen" data-id="${escapeHtml(item.id)}">Regen</button>
      <button type="button" data-feedback="reject" data-id="${escapeHtml(item.id)}">Reject</button>
    </div>
  ` : `
    <div class="queue-actions">
      <button type="button" data-edit-queue="${escapeHtml(item.id)}" ${canEdit ? "" : "disabled"}>Edit Item</button>
      <button type="button" data-schedule-next="${escapeHtml(item.id)}" ${canQuickSchedule ? "" : "disabled"}>Suggest Slot</button>
      <button type="button" data-mark-published="${escapeHtml(item.id)}" ${canMarkPublished ? "" : "disabled"}>Mark Published</button>
      <button type="button" data-cancel-queue-item="${escapeHtml(item.id)}" ${canCancel ? "" : "disabled"}>Cancel Item</button>
    </div>
  `;
  return `
    <article class="queue-item">
      <div class="queue-meta">
        <span>${escapeHtml(item.channel)}</span>
        <span>${escapeHtml(item.format)}</span>
        <span>${escapeHtml(displayStatus)}</span>
        <span>${escapeHtml(item.compliance_status || "pending")}</span>
      </div>
      <p>${escapeHtml(item.caption)}</p>
      <small>${formatDate(item.planned_slot)} · ${mediaCount} media URL(s)</small>
      ${postIdLine}
      ${reviewReadyLine}
      ${feedbackLine}
      ${actions}
    </article>
  `;
}

function renderWeekSchedule(items) {
  const container = document.getElementById("week-schedule");
  if (!container) return;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const scheduled = items
    .filter((item) => {
      if (!item.planned_slot) return false;
      const date = new Date(item.planned_slot);
      return !Number.isNaN(date.getTime()) && date >= start && date < end;
    })
    .sort((a, b) => new Date(a.planned_slot) - new Date(b.planned_slot));
  if (!scheduled.length) {
    container.innerHTML = '<p class="status-note">No filtered items planned for the next 7 days.</p>';
    return;
  }
  const groups = scheduled.reduce((acc, item) => {
    const day = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(item.planned_slot));
    acc[day] = acc[day] || [];
    acc[day].push(item);
    return acc;
  }, {});
  container.innerHTML = Object.entries(groups).map(([day, dayItems]) => `
    <section class="week-day">
      <h3>${escapeHtml(day)}</h3>
      ${dayItems.map((item) => `
        <button type="button" data-edit-queue="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.channel)} · ${escapeHtml(item.format)}</strong>
          <span>${formatDate(item.planned_slot)}</span>
        </button>
      `).join("")}
    </section>
  `).join("");
}

async function scheduleNextQueueSlot(button, messageElement) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Scheduling";
  try {
    const data = await fetchJson(`/publish-queue/${button.dataset.scheduleNext}/schedule-next`, { method: "POST" });
    const slot = data.suggestion?.suggested_slot || data.item?.planned_slot;
    messageElement.textContent = slot
      ? `Scheduled for ${formatDate(slot)}.`
      : "Item scheduled.";
    await Promise.all([loadPublishQueue(), loadLoopStatus()]);
  } catch (error) {
    messageElement.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not suggest a slot.";
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function cancelQueueItem(itemId, button) {
  const message = document.getElementById("queue-message");
  const reason = window.prompt("Why should this queue item be cancelled?", "Cancelled from Scheduler before publishing.");
  if (reason === null) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Cancelling";
  try {
    await fetchJson("/feedback", {
      method: "POST",
      body: JSON.stringify({
        module: "scheduler",
        ref_type: "publish_queue",
        ref_id: itemId,
        action: "reject",
        reason: reason.trim() || "Cancelled from Scheduler before publishing.",
        tags: ["web_scheduler", "cancelled"],
      }),
    });
    await fetchJson(`/publish-queue/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled", planned_slot_changed: true, planned_slot: null }),
    });
    message.textContent = "Queue item cancelled and removed from active handoff.";
    await Promise.all([loadPublishQueue(), loadLoopStatus()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not cancel queue item.";
    button.disabled = false;
    button.textContent = originalText;
  }
}

function renderCompliance(result) {
  const container = document.getElementById("compliance-result");
  if (!result) {
    container.innerHTML = "";
    return;
  }
  const findings = result.findings || [];
  const rows = findings.length
    ? findings.map((finding) => `
      <li>
        <strong>${escapeHtml(finding.severity)}</strong>
        ${escapeHtml(finding.message)}
      </li>
    `).join("")
    : "<li>No obvious issue found.</li>";
  container.innerHTML = `
    <div class="compliance-box ${escapeHtml(result.status)}">
      <strong>${escapeHtml(result.status)}</strong>
      <p>${escapeHtml(result.recommendation)}</p>
      <ul>${rows}</ul>
    </div>
  `;
}

async function checkCaptionSafety(caption) {
  const result = await fetchJson("/compliance/check", {
    method: "POST",
    body: JSON.stringify({ text: caption }),
  });
  renderCompliance(result);
  return result;
}

function renderDraft(draft, compliance) {
  const container = document.getElementById("compose-result");
  const findings = compliance?.findings || [];
  const findingText = findings.length
    ? findings.map((finding) => `<li><strong>${escapeHtml(finding.severity)}</strong> ${escapeHtml(finding.message)}</li>`).join("")
    : "<li>No obvious issue found.</li>";
  container.innerHTML = `
    <div class="draft-card">
      <div class="queue-meta">
        <span>${escapeHtml(draft.channel)}</span>
        <span>${escapeHtml(draft.format)}</span>
        <span>${escapeHtml(draft.stage)}</span>
        ${draft.assetId ? `<span>asset saved</span>` : ""}
        <span>${escapeHtml(compliance?.status || "unchecked")}</span>
      </div>
      ${draft.briefId || draft.assetId ? `
        <p class="status-note">${draft.briefId ? `Brief ${escapeHtml(draft.briefId)}` : ""}${draft.briefId && draft.assetId ? " · " : ""}${draft.assetId ? `Asset ${escapeHtml(draft.assetId)}` : ""}</p>
      ` : ""}
      ${draft.captionVariants?.length > 1 ? `
        <div class="caption-variants">
          <strong>Caption variants</strong>
          ${draft.captionVariants.map((caption, index) => `
            <button type="button" data-caption-variant="${index}">Use ${index === 0 ? "A" : "B"}</button>
          `).join("")}
        </div>
      ` : ""}
      <textarea id="draft-caption">${escapeHtml(draft.caption)}</textarea>
      ${mediaList(draft.mediaUrls)}
      ${slidePreview(draft.slides)}
      ${reelPreview(draft.reelScript)}
      <div class="compliance-box ${escapeHtml(compliance?.status || "pending")}">
        <strong>${escapeHtml(compliance?.status || "pending")}</strong>
        <p>${escapeHtml(compliance?.recommendation || "Run safety check before queueing.")}</p>
        <ul>${findingText}</ul>
      </div>
    </div>
  `;
}

async function loadPublishQueue() {
  const queueContainer = document.getElementById("queue-items");
  const reviewContainer = document.getElementById("review-items");
  try {
    const data = await fetchJson("/publish-queue");
    const items = data.items || [];
    const filteredItems = filterQueueItems(items);
    const reviewItems = items.filter(needsReviewQueue);
    const queueMarkup = filteredItems.length
      ? filteredItems.map((item) => queueCard(item, "queue")).join("")
      : '<p class="status-note">No queue items yet.</p>';
    const reviewMarkup = reviewItems.length
      ? reviewItems.map((item) => queueCard(item, "review")).join("")
      : '<p class="status-note">No content waiting for review.</p>';
    queueContainer.dataset.items = JSON.stringify(items);
    reviewContainer.dataset.items = JSON.stringify(reviewItems);
    queueContainer.innerHTML = queueMarkup;
    reviewContainer.innerHTML = reviewMarkup;
    renderWeekSchedule(filteredItems);
    loadPreScheduleGate();
  } catch {
    const message = '<p class="status-note">Set the access token to load the publish queue.</p>';
    queueContainer.dataset.items = "[]";
    reviewContainer.dataset.items = "[]";
    queueContainer.innerHTML = message;
    reviewContainer.innerHTML = message;
    renderWeekSchedule([]);
    const gateContainer = document.getElementById("pre-schedule-gate");
    if (gateContainer) gateContainer.innerHTML = message;
  }
}

function renderPreScheduleGate(data) {
  const container = document.getElementById("pre-schedule-gate");
  if (!container) return;
  const items = data.gate_items || [];
  container.innerHTML = `
    <article class="learning-card">
      <h3>Pre-Schedule Gate</h3>
      <p>${escapeHtml(data.ready_to_schedule_count || 0)} ready</p>
      <small>${escapeHtml(data.mode || "read_only_schedule_readiness")}</small>
    </article>
    <article class="learning-card">
      <h3>Blocked</h3>
      <p>${escapeHtml(data.blocked_count || 0)}</p>
      <small>fix before scheduling</small>
    </article>
    <article class="learning-card">
      <h3>Needs Design</h3>
      <p>${escapeHtml(data.post_approval_needs_media_count || 0)}</p>
      <small>after asset approval</small>
    </article>
    <article class="learning-card wide-learning">
      <h3>Schedule Readiness</h3>
      <ul>${items.length ? items.slice(0, 5).map((item) => `<li><strong>${escapeHtml(item.channel || "unknown")} / ${escapeHtml(item.format || "unknown")}</strong> · ${escapeHtml(item.gate_status || "")}<br><small>${escapeHtml((item.blockers || []).join("; ") || item.next_step || "")}</small></li>`).join("") : "<li>No queue items yet. Approve and queue assets first.</li>"}</ul>
    </article>
  `;
}

async function loadPreScheduleGate() {
  const container = document.getElementById("pre-schedule-gate");
  if (!container) return;
  try {
    const data = await fetchJson("/operations/pre-schedule-gate");
    renderPreScheduleGate(data);
  } catch {
    container.innerHTML = '<p class="status-note">Set the access token to load the pre-schedule gate.</p>';
  }
}

function resetQueueEdit() {
  editingQueueItem = null;
  const form = document.getElementById("queue-form");
  form.reset();
  document.getElementById("queue-submit").textContent = "Add To Queue";
  document.getElementById("cancel-queue-edit").hidden = true;
}

function startQueueEdit(id) {
  const queueItems = JSON.parse(document.getElementById("queue-items").dataset.items || "[]");
  const reviewItems = JSON.parse(document.getElementById("review-items").dataset.items || "[]");
  const item = [...queueItems, ...reviewItems].find((entry) => entry.id === id);
  if (!item) return;
  editingQueueItem = item;
  const form = document.getElementById("queue-form");
  form.elements.channel.value = item.channel || "facebook";
  form.elements.format.value = item.format || "single";
  form.elements.planned_slot.value = formatDatetimeLocal(item.planned_slot);
  form.elements.compliance_status.value = item.compliance_status || "pending";
  form.elements.caption.value = item.caption || "";
  form.elements.media_urls.value = (item.media_urls || []).join("\n");
  document.getElementById("queue-submit").textContent = "Update Item";
  document.getElementById("cancel-queue-edit").hidden = false;
  document.getElementById("queue-message").textContent = "Editing queued item. Save will re-check safety.";
  showScreen("scheduler");
}

document.getElementById("kb-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.getElementById("kb-message");
  const form = new FormData(event.currentTarget);
  const payload = {
    title: form.get("title"),
    category: form.get("category"),
    body: form.get("body"),
    tags: [],
  };
  if (message) message.textContent = "Saving knowledge entry...";
  await fetchJson("/kb", { method: "POST", body: JSON.stringify(payload) });
  event.currentTarget.reset();
  await Promise.all([loadKb(), loadLoopStatus()]);
  if (message) message.textContent = "Knowledge entry saved.";
});

document.getElementById("download-kb-csv")?.addEventListener("click", async () => {
  const message = document.getElementById("kb-message");
  try {
    await downloadProtectedFile("/kb/export.csv", "drec-knowledge-base.csv", "text/csv");
    if (message) message.textContent = "Knowledge Base CSV downloaded.";
  } catch (error) {
    if (message) message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download Knowledge Base CSV.";
  }
});

document.getElementById("workflow-next").addEventListener("click", (event) => {
  const button = event.target.closest("[data-workflow-screen]");
  if (!button) return;
  showScreen(button.dataset.workflowScreen);
});

document.getElementById("refresh-workflow").addEventListener("click", async () => {
  const button = document.getElementById("refresh-workflow");
  button.disabled = true;
  button.textContent = "Refreshing";
  await loadLoopStatus();
  button.disabled = false;
  button.textContent = "Refresh";
});

document.getElementById("copy-test-path")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await navigator.clipboard.writeText(testPathText());
    message.textContent = "Test path copied.";
  } catch {
    message.textContent = "Could not copy automatically. Use the visible checklist.";
  }
});

document.getElementById("copy-next-test-step")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await navigator.clipboard.writeText(testRunNextStepText());
    message.textContent = "Next test step copied.";
  } catch {
    message.textContent = "Could not copy automatically. Use the visible next step.";
  }
});

document.getElementById("test-path-list")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-test-run-screen]");
  if (!button) return;
  showScreen(button.dataset.testRunScreen);
});

document.getElementById("run-risk-audit")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  message.textContent = "Running content risk audit...";
  try {
    const data = await fetchJson("/operations/risk-audit");
    renderRiskAudit(data);
    message.textContent = data.overall_status === "clear" ? "Risk audit clear." : "Risk audit found items to review.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not run risk audit.";
  }
});

document.getElementById("download-snapshot")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/operations/snapshot.csv", "drec-content-os-snapshot.csv", "text/csv");
    message.textContent = "Operations snapshot downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download snapshot.";
  }
});

document.getElementById("download-backup-pack")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/operations/backup-recovery-pack.md", "drec-backup-recovery-pack.md", "text/markdown");
    message.textContent = "Backup recovery pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download backup pack.";
  }
});

document.getElementById("download-pipeline-board")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/operations/pipeline-board.csv", "drec-content-pipeline-board.csv", "text/csv");
    message.textContent = "Pipeline board downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download pipeline board.";
  }
});

document.getElementById("download-audit-trail")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/operations/audit-trail.csv", "drec-audit-trail.csv", "text/csv");
    message.textContent = "Audit trail downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download audit trail.";
  }
});

document.getElementById("download-launch-evidence")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/operations/launch-evidence.md", "drec-launch-evidence.md", "text/markdown");
    message.textContent = "Launch evidence downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download launch evidence.";
  }
});

document.getElementById("download-first-test-kit")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/operations/first-test-kit.md", "drec-first-test-kit.md", "text/markdown");
    message.textContent = "First test kit downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download first test kit.";
  }
});

document.getElementById("download-test-run-tracker")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/operations/test-run-tracker.md", "drec-first-test-run-tracker.md", "text/markdown");
    message.textContent = "Test tracker downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download test tracker.";
  }
});

document.getElementById("download-manual-cycle-qa")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/operations/manual-cycle-qa.md", "drec-manual-cycle-qa.md", "text/markdown");
    message.textContent = "Manual QA report downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download manual QA report.";
  }
});

document.getElementById("download-access-pack")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/security/access-control-pack.md", "drec-access-control-pack.md", "text/markdown");
    message.textContent = "Access control pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download access control pack.";
  }
});

document.getElementById("download-service-role-pack")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/security/service-role-install-pack.md", "drec-service-role-install-pack.md", "text/markdown");
    message.textContent = "Service role install pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download service role install pack.";
  }
});

document.getElementById("download-rls-plan")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/security/rls-hardening-plan.md", "drec-rls-hardening-plan.md", "text/markdown");
    message.textContent = "RLS hardening plan downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download RLS hardening plan.";
  }
});

document.getElementById("download-daily-ops")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/operations/daily-ops-checklist.md", "drec-daily-ops-checklist.md", "text/markdown");
    message.textContent = "Daily ops checklist downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download daily ops checklist.";
  }
});

document.getElementById("download-cycle-command-center")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/operations/cycle-command-center.md", "drec-cycle-command-center.md", "text/markdown");
    message.textContent = "Cycle command center downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download cycle command center.";
  }
});

document.getElementById("download-cycle-evidence-ledger")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/operations/cycle-evidence-ledger.csv", "drec-cycle-evidence-ledger.csv", "text/csv");
    message.textContent = "Cycle evidence ledger downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download cycle evidence ledger.";
  }
});

document.getElementById("download-external-setup-board")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/operations/external-setup-board.csv", "drec-external-setup-board.csv", "text/csv");
    message.textContent = "External setup board downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download external setup board.";
  }
});

document.getElementById("download-operator-pack")?.addEventListener("click", async () => {
  const message = document.getElementById("test-path-message");
  try {
    await downloadProtectedFile("/operations/operator-pack.md", "drec-operator-pack.md", "text/markdown");
    message.textContent = "Operator pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download operator pack.";
  }
});

document.getElementById("download-creative-pack")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/creative-pack.md", "drec-creative-pack.md", "text/markdown");
    message.textContent = "Creative pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download creative pack.";
  }
});

document.getElementById("download-media-shot-list")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/media-shot-list.csv", "drec-media-shot-list.csv", "text/csv");
    message.textContent = "Media shot list downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download media shot list.";
  }
});

document.getElementById("download-asset-review")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/asset-review.csv", "drec-asset-review.csv", "text/csv");
    message.textContent = "Asset review CSV downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download asset review CSV.";
  }
});

document.getElementById("download-asset-review-decisions")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/asset-review-decisions.csv", "drec-asset-review-decisions.csv", "text/csv");
    message.textContent = "Asset review decision CSV downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download asset review decisions.";
  }
});

document.getElementById("download-asset-media-attachments")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/asset-media-attachments.csv", "drec-asset-media-attachments.csv", "text/csv");
    message.textContent = "Asset media attachments CSV downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download asset media attachments.";
  }
});

document.getElementById("download-asset-worklist")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/asset-review-worklist.md", "drec-asset-review-worklist.md", "text/markdown");
    message.textContent = "Asset worklist downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download asset worklist.";
  }
});

document.getElementById("download-asset-safety-review")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/asset-safety-review.md", "drec-asset-safety-review.md", "text/markdown");
    message.textContent = "Asset safety review pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download asset safety review.";
  }
});

document.getElementById("download-asset-review-session")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/asset-review-session.md", "drec-asset-review-session-pack.md", "text/markdown");
    message.textContent = "Asset review session pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download asset review session.";
  }
});

document.getElementById("download-doctor-approval-pack")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/doctor-approval-pack.md", "drec-doctor-approval-pack.md", "text/markdown");
    message.textContent = "Doctor approval pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download doctor approval pack.";
  }
});

document.getElementById("download-doctor-approval-request")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/doctor-approval-request.md", "drec-doctor-approval-request.md", "text/markdown");
    message.textContent = "Doctor approval request downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download doctor approval request.";
  }
});

document.getElementById("download-doctor-review-bridge")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/doctor-review-bridge.md", "drec-doctor-review-bridge.md", "text/markdown");
    message.textContent = "Doctor review bridge downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download doctor review bridge.";
  }
});

document.getElementById("download-doctor-send-queue")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/doctor-send-queue.csv", "drec-doctor-send-queue.csv", "text/csv");
    message.textContent = "Doctor send queue downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download doctor send queue.";
  }
});

document.getElementById("download-doctor-review-polish")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/doctor-review-polish-pack.md", "drec-doctor-review-polish-pack.md", "text/markdown");
    message.textContent = "Doctor review polish pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download doctor review polish pack.";
  }
});

document.getElementById("download-doctor-reply-inbox")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/doctor-reply-inbox-pack.md", "drec-doctor-reply-inbox-pack.md", "text/markdown");
    message.textContent = "Doctor reply inbox pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download doctor reply inbox pack.";
  }
});

document.getElementById("download-doctor-decision-worksheet")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/doctor-decision-worksheet.csv", "drec-doctor-decision-worksheet.csv", "text/csv");
    message.textContent = "Doctor decision worksheet downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download doctor decision worksheet.";
  }
});

document.getElementById("download-approval-cockpit")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/approval-cockpit.md", "drec-approval-cockpit.md", "text/markdown");
    message.textContent = "Approval cockpit downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download approval cockpit.";
  }
});

document.getElementById("download-asset-rewrite-pack")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/asset-rewrite-pack.md", "drec-asset-safe-rewrite-pack.md", "text/markdown");
    message.textContent = "Asset rewrite pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download asset rewrite pack.";
  }
});

document.getElementById("download-first-cycle-sprint-pack")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/first-cycle-sprint-pack.md", "drec-first-cycle-sprint-pack.md", "text/markdown");
    message.textContent = "First cycle sprint pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download first cycle sprint pack.";
  }
});

document.getElementById("download-first-cycle-sprint-tracker")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/first-cycle-sprint-tracker.csv", "drec-first-cycle-sprint-tracker.csv", "text/csv");
    message.textContent = "First cycle sprint tracker downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download first cycle sprint tracker.";
  }
});

document.getElementById("download-first-cycle-handoff")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/first-cycle-handoff.md", "drec-first-cycle-handoff-pack.md", "text/markdown");
    message.textContent = "First cycle handoff pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download first cycle handoff.";
  }
});

document.getElementById("download-today-runbook")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/today-runbook.md", "drec-today-runbook.md", "text/markdown");
    message.textContent = "Today runbook downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download today runbook.";
  }
});

async function downloadPreScheduleGate(messageElement) {
  try {
    await downloadProtectedFile("/operations/pre-schedule-gate.md", "drec-pre-schedule-gate.md", "text/markdown");
    if (messageElement) messageElement.textContent = "Pre-schedule gate downloaded.";
  } catch (error) {
    if (messageElement) messageElement.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download pre-schedule gate.";
  }
}

document.getElementById("download-post-approval-production")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/post-approval-production.md", "drec-post-approval-production-pack.md", "text/markdown");
    message.textContent = "Post-approval production pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download production pack.";
  }
});

document.getElementById("download-production-handoff-bridge")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/production-handoff-bridge.md", "drec-production-handoff-bridge.md", "text/markdown");
    message.textContent = "Production handoff bridge downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download production handoff bridge.";
  }
});

document.getElementById("download-production-reply-inbox")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/production-reply-inbox-pack.md", "drec-production-reply-inbox-pack.md", "text/markdown");
    message.textContent = "Production reply inbox pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download production reply inbox pack.";
  }
});

document.getElementById("download-production-design-worksheet")?.addEventListener("click", async () => {
  const message = document.getElementById("media-message");
  try {
    await downloadProtectedFile("/operations/production-design-worksheet.csv", "drec-production-design-worksheet.csv", "text/csv");
    message.textContent = "Production design worksheet downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download design worksheet.";
  }
});

document.getElementById("download-pre-schedule-gate")?.addEventListener("click", async () => {
  await downloadPreScheduleGate(document.getElementById("queue-message"));
});

document.getElementById("download-scheduler-pre-schedule-gate")?.addEventListener("click", async () => {
  await downloadPreScheduleGate(document.getElementById("queue-message"));
});

document.getElementById("refresh-style-library")?.addEventListener("click", async () => {
  const button = document.getElementById("refresh-style-library");
  button.disabled = true;
  button.textContent = "Refreshing";
  await loadStyleLibrary();
  button.disabled = false;
  button.textContent = "Refresh Styles";
});

document.getElementById("download-style-guide")?.addEventListener("click", async () => {
  const message = document.getElementById("creative-message");
  try {
    await downloadProtectedFile("/creative/style-guide.md", "drec-creative-style-guide.md", "text/markdown");
    if (message) message.textContent = "Creative style guide downloaded.";
  } catch (error) {
    if (message) message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download Creative Style Guide.";
  }
});

document.getElementById("refresh-sense-brief")?.addEventListener("click", async () => {
  const button = document.getElementById("refresh-sense-brief");
  button.disabled = true;
  button.textContent = "Refreshing";
  await Promise.all([loadSenseBrief(), loadAdsPlanning()]);
  button.disabled = false;
  button.textContent = "Refresh Sense Brief";
});

document.getElementById("download-sense-brief")?.addEventListener("click", async () => {
  const message = document.getElementById("sense-message");
  try {
    await downloadProtectedFile("/insights/sense-brief.md", "drec-sense-brief.md", "text/markdown");
    if (message) message.textContent = "Sense Brief downloaded.";
  } catch (error) {
    if (message) message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download Sense Brief.";
  }
});

document.getElementById("refresh-ads-planning")?.addEventListener("click", async () => {
  const button = document.getElementById("refresh-ads-planning");
  button.disabled = true;
  button.textContent = "Refreshing";
  await loadAdsPlanning();
  button.disabled = false;
  button.textContent = "Refresh Ads Plan";
});

document.getElementById("download-ads-planning")?.addEventListener("click", async () => {
  const message = document.getElementById("sense-message");
  try {
    await downloadProtectedFile("/insights/ads-planning.md", "drec-ads-planning-pack.md", "text/markdown");
    if (message) message.textContent = "Ads Planning Pack downloaded.";
  } catch (error) {
    if (message) message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download Ads Planning Pack.";
  }
});

document.getElementById("refresh-template-studio")?.addEventListener("click", async () => {
  const button = document.getElementById("refresh-template-studio");
  button.disabled = true;
  button.textContent = "Refreshing";
  await loadTemplateStudio();
  button.disabled = false;
  button.textContent = "Refresh Templates";
});

document.getElementById("download-static-render-pack")?.addEventListener("click", async () => {
  const message = document.getElementById("template-message");
  try {
    await downloadProtectedFile("/templates/static-render-pack.md", "drec-static-render-pack.md", "text/markdown");
    if (message) message.textContent = "Static render pack downloaded.";
  } catch (error) {
    if (message) message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download Static Render Pack.";
  }
});

document.getElementById("refresh-video-studio")?.addEventListener("click", async () => {
  const button = document.getElementById("refresh-video-studio");
  button.disabled = true;
  button.textContent = "Refreshing";
  await loadVideoStudio();
  button.disabled = false;
  button.textContent = "Refresh Video Studio";
});

document.getElementById("download-video-sop")?.addEventListener("click", async () => {
  const message = document.getElementById("video-message");
  try {
    await downloadProtectedFile("/video/sop-pack.md", "drec-video-studio-sop-pack.md", "text/markdown");
    if (message) message.textContent = "Video SOP pack downloaded.";
  } catch (error) {
    if (message) message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download Video SOP Pack.";
  }
});

function renderAssetReviewDecisionPreview(data) {
  const container = document.getElementById("asset-review-decision-preview");
  if (!container) return;
  const rows = data.planned || data.imported || [];
  const skipped = data.skipped || [];
  container.innerHTML = `
    <article class="insight-card">
      <strong>${data.dry_run ? "Review Decision Preview" : "Review Decision Import"}</strong>
      <small>${rows.length} row(s) ready · ${skipped.length} skipped</small>
      ${rows.length ? `
        <ul>${rows.slice(0, 10).map((row) => `
          <li>
            <strong>${escapeHtml(row.topic || row.asset_id || "")}</strong>
            ${escapeHtml(row.target_safety || "no safety change")} / ${escapeHtml(row.target_review || "no review change")}
            ${row.caption_update && row.caption_update !== "none" ? ` · ${escapeHtml(row.caption_update)}` : ""}
            ${Array.isArray(row.applied) && row.applied.length ? ` · ${escapeHtml(row.applied.join(", "))}` : ""}
          </li>
        `).join("")}</ul>
      ` : ""}
      ${skipped.length ? `
        <h4>Skipped Rows</h4>
        <ul>${skipped.slice(0, 10).map((row) => `<li><strong>Row ${escapeHtml(row.row || "")}</strong> ${escapeHtml(row.asset_id || "")}${row.asset_id ? " · " : ""}${escapeHtml(row.reason || "")}</li>`).join("")}</ul>
      ` : ""}
    </article>
  `;
}

function renderAssetMediaAttachmentPreview(data) {
  const container = document.getElementById("asset-media-attachment-preview");
  if (!container) return;
  const rows = data.planned || data.imported || [];
  const skipped = data.skipped || [];
  container.innerHTML = `
    <article class="insight-card">
      <strong>${data.dry_run ? "Media Attachment Preview" : "Media Attachment Import"}</strong>
      <small>${rows.length} row(s) ready · ${skipped.length} skipped</small>
      ${rows.length ? `
        <ul>${rows.slice(0, 10).map((row) => `
          <li>
            <strong>${escapeHtml(row.topic || row.asset_id || "")}</strong>
            ${escapeHtml(row.new_media_count || 0)} media URL(s)
            ${row.visual_qa_status ? ` · ${escapeHtml(row.visual_qa_status)}` : ""}
            ${row.synced_queue_count ? ` · ${escapeHtml(row.synced_queue_count)} queue sync` : ""}
          </li>
        `).join("")}</ul>
      ` : ""}
      ${skipped.length ? `
        <h4>Skipped Rows</h4>
        <ul>${skipped.slice(0, 10).map((row) => `<li><strong>Row ${escapeHtml(row.row || "")}</strong> ${escapeHtml(row.asset_id || "")}${row.asset_id ? " · " : ""}${escapeHtml(row.reason || "")}</li>`).join("")}</ul>
      ` : ""}
      ${Array.isArray(data.safety) && data.safety.length ? `
        <h4>Safety</h4>
        <ul>${data.safety.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      ` : ""}
    </article>
  `;
}

async function uploadAssetReviewDecisions({ dryRun }) {
  const message = document.getElementById("media-message");
  const fileInput = document.getElementById("asset-review-decisions-file");
  const file = fileInput?.files?.[0];
  if (!file) {
    message.textContent = "Choose a review decision CSV first.";
    return;
  }
  const body = new FormData();
  body.append("file", file);
  body.append("dry_run", dryRun ? "true" : "false");
  message.textContent = dryRun ? "Previewing review decisions..." : "Importing review decisions...";
  try {
    const data = await fetchForm("/operations/import-asset-review-decisions", body);
    if (!dryRun) fileInput.value = "";
    message.textContent = data.message || (dryRun ? "Review decisions previewed." : "Review decisions imported.");
    renderAssetReviewDecisionPreview(data);
    if (!dryRun) await Promise.all([loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadAssetReviewSession(), loadAssetRewritePack(), loadLoopStatus(), loadLearningSummary()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : dryRun ? "Could not preview review decisions." : "Could not import review decisions.";
  }
}

async function importDoctorReplies({ dryRun }) {
  const message = document.getElementById("media-message");
  const textInput = document.getElementById("doctor-reply-text");
  const reviewerInput = document.getElementById("doctor-reply-reviewer");
  const replyText = textInput?.value?.trim() || "";
  if (!replyText) {
    message.textContent = "Paste the doctor reply text first.";
    return;
  }
  message.textContent = dryRun ? "Previewing doctor reply..." : "Importing doctor reply...";
  try {
    const data = await fetchJson("/operations/import-doctor-replies", {
      method: "POST",
      body: JSON.stringify({
        reply_text: replyText,
        dry_run: dryRun,
        reviewer_name: reviewerInput?.value?.trim() || "",
      }),
    });
    if (!dryRun) textInput.value = "";
    message.textContent = data.message || (dryRun ? "Doctor reply previewed." : "Doctor reply imported.");
    renderAssetReviewDecisionPreview(data);
    if (!dryRun) await Promise.all([loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadAssetReviewSession(), loadAssetRewritePack(), loadLoopStatus(), loadLearningSummary()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : dryRun ? "Could not preview doctor reply." : "Could not import doctor reply.";
  }
}

async function uploadAssetMediaAttachments({ dryRun }) {
  const message = document.getElementById("media-message");
  const fileInput = document.getElementById("asset-media-attachments-file");
  const file = fileInput?.files?.[0];
  if (!file) {
    message.textContent = "Choose a media attachment CSV first.";
    return;
  }
  const body = new FormData();
  body.append("file", file);
  body.append("dry_run", dryRun ? "true" : "false");
  message.textContent = dryRun ? "Previewing media attachments..." : "Importing media attachments...";
  try {
    const data = await fetchForm("/operations/import-asset-media-attachments", body);
    if (!dryRun) fileInput.value = "";
    message.textContent = data.message || (dryRun ? "Media attachments previewed." : "Media attachments imported.");
    renderAssetMediaAttachmentPreview(data);
    if (!dryRun) await Promise.all([loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadPreScheduleGate(), loadLoopStatus()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : dryRun ? "Could not preview media attachments." : "Could not import media attachments.";
  }
}

async function importProductionReplies({ dryRun }) {
  const message = document.getElementById("media-message");
  const textInput = document.getElementById("production-reply-text");
  const producerInput = document.getElementById("production-reply-producer");
  const replyText = textInput?.value?.trim() || "";
  if (!replyText) {
    message.textContent = "Paste the production reply text first.";
    return;
  }
  message.textContent = dryRun ? "Previewing production reply..." : "Importing production reply...";
  try {
    const data = await fetchJson("/operations/import-production-replies", {
      method: "POST",
      body: JSON.stringify({
        reply_text: replyText,
        dry_run: dryRun,
        producer_name: producerInput?.value?.trim() || "",
      }),
    });
    if (!dryRun) textInput.value = "";
    message.textContent = data.message || (dryRun ? "Production reply previewed." : "Production reply imported.");
    renderAssetMediaAttachmentPreview(data);
    if (!dryRun) await Promise.all([loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadPreScheduleGate(), loadLoopStatus()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : dryRun ? "Could not preview production reply." : "Could not import production reply.";
  }
}

async function uploadProductionDesignWorksheet({ dryRun }) {
  const message = document.getElementById("media-message");
  const fileInput = document.getElementById("production-design-worksheet-file");
  const file = fileInput?.files?.[0];
  if (!file) {
    message.textContent = "Choose a production design worksheet CSV first.";
    return;
  }
  const body = new FormData();
  body.append("file", file);
  body.append("dry_run", dryRun ? "true" : "false");
  message.textContent = dryRun ? "Previewing design worksheet..." : "Importing design worksheet...";
  try {
    const data = await fetchForm("/operations/import-production-design-worksheet", body);
    if (!dryRun) fileInput.value = "";
    message.textContent = data.message || (dryRun ? "Design worksheet previewed." : "Design worksheet imported.");
    renderAssetMediaAttachmentPreview(data);
    if (!dryRun) await Promise.all([loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadPreScheduleGate(), loadLoopStatus()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : dryRun ? "Could not preview design worksheet." : "Could not import design worksheet.";
  }
}

document.getElementById("preview-asset-review-decisions")?.addEventListener("click", async () => {
  await uploadAssetReviewDecisions({ dryRun: true });
});

document.getElementById("import-asset-review-decisions")?.addEventListener("click", async () => {
  await uploadAssetReviewDecisions({ dryRun: false });
});

document.getElementById("preview-doctor-replies")?.addEventListener("click", async () => {
  await importDoctorReplies({ dryRun: true });
});

document.getElementById("import-doctor-replies")?.addEventListener("click", async () => {
  await importDoctorReplies({ dryRun: false });
});

document.getElementById("preview-asset-media-attachments")?.addEventListener("click", async () => {
  await uploadAssetMediaAttachments({ dryRun: true });
});

document.getElementById("import-asset-media-attachments")?.addEventListener("click", async () => {
  await uploadAssetMediaAttachments({ dryRun: false });
});

document.getElementById("preview-production-replies")?.addEventListener("click", async () => {
  await importProductionReplies({ dryRun: true });
});

document.getElementById("import-production-replies")?.addEventListener("click", async () => {
  await importProductionReplies({ dryRun: false });
});

document.getElementById("preview-production-design-worksheet")?.addEventListener("click", async () => {
  await uploadProductionDesignWorksheet({ dryRun: true });
});

document.getElementById("import-production-design-worksheet")?.addEventListener("click", async () => {
  await uploadProductionDesignWorksheet({ dryRun: false });
});

document.getElementById("plan-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.getElementById("plan-message");
  const form = new FormData(event.currentTarget);
  const payload = {
    language: form.get("language"),
    count: Number(form.get("count")) || 5,
    topics: splitLines(form.get("topics")),
  };
  message.textContent = "Generating weekly plan...";
  try {
    await fetchJson("/weekly-plan/generate", { method: "POST", body: JSON.stringify(payload) });
    message.textContent = "Weekly plan generated.";
    await Promise.all([loadBriefs(), loadLoopStatus()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not generate weekly plan.";
  }
});

async function loadLearningTopicsIntoPlan(message, options = {}) {
  const form = document.getElementById("plan-form");
  const data = new FormData(form);
  const language = data.get("language") || "zh";
  const count = Number(data.get("count")) || 5;
  message.textContent = "Loading learning topics...";
  try {
    const recommendation = await fetchJson(`/weekly-plan/recommendations?language=${encodeURIComponent(language)}&count=${encodeURIComponent(count)}`);
    form.elements.topics.value = (recommendation.topics || []).join("\n");
    const signals = recommendation.signals || {};
    if (options.openPlan) showScreen("plan");
    message.textContent = `Loaded ${recommendation.topics?.length || 0} topic(s) from ${signals.outcome_count || 0} result(s) and ${signals.weight_count || 0} active weight(s).`;
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not load learning topics.";
  }
}

document.getElementById("load-learning-topics").addEventListener("click", async () => {
  await loadLearningTopicsIntoPlan(document.getElementById("plan-message"));
});

document.getElementById("download-plan-csv")?.addEventListener("click", async () => {
  const message = document.getElementById("plan-message");
  message.textContent = "Preparing plan CSV...";
  try {
    await downloadProtectedFile("/briefs/plan.csv", "drec-weekly-plan.csv", "text/csv");
    message.textContent = "Weekly plan CSV downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download plan CSV.";
  }
});

document.getElementById("download-brief-asset-pack")?.addEventListener("click", async () => {
  const message = document.getElementById("plan-message");
  message.textContent = "Preparing brief-to-asset pack...";
  try {
    await downloadProtectedFile("/briefs/asset-pack.md", "drec-brief-to-asset-pack.md", "text/markdown");
    message.textContent = "Brief-to-asset pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download brief-to-asset pack.";
  }
});

document.getElementById("save-all-assets").addEventListener("click", async () => {
  const button = document.getElementById("save-all-assets");
  const message = document.getElementById("plan-message");
  const form = document.getElementById("plan-form");
  const limit = Number(new FormData(form).get("count")) || 5;
  button.disabled = true;
  button.textContent = "Saving";
  message.textContent = "Saving weekly briefs as draft assets...";
  try {
    const data = await fetchJson(`/briefs/draft-assets?limit=${encodeURIComponent(limit)}`, { method: "POST" });
    message.textContent = `Assets ready: ${data.created || 0} created, ${data.reused || 0} reused, ${data.skipped || 0} skipped.`;
    await Promise.all([loadBriefs(), loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadAssetReviewSession(), loadAssetRewritePack(), loadLoopStatus(), loadLearningSummary()]);
    if ((data.created || data.reused || 0) > 0) showScreen("assets");
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not save all draft assets.";
  } finally {
    button.disabled = false;
    button.textContent = "Save All Assets";
  }
});

document.getElementById("archive-drafted-briefs").addEventListener("click", async () => {
  const button = document.getElementById("archive-drafted-briefs");
  const message = document.getElementById("plan-message");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Archiving";
  message.textContent = "Archiving drafted briefs...";
  try {
    const data = await fetchJson("/briefs/archive-drafted", { method: "POST" });
    message.textContent = `Archived ${data.archived || 0} drafted brief(s).`;
    await Promise.all([loadBriefs(), loadLoopStatus(), loadLearningSummary()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not archive drafted briefs.";
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

async function updateBriefStatus(id, status) {
  await fetchJson(`/briefs/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

document.getElementById("brief-items").addEventListener("click", async (event) => {
  const statusButton = event.target.closest("[data-brief-status]");
  if (statusButton) {
    const originalText = statusButton.textContent;
    statusButton.disabled = true;
    statusButton.textContent = "Saving";
    try {
      await updateBriefStatus(statusButton.dataset.briefStatus, statusButton.dataset.status);
      await Promise.all([loadBriefs(), loadLoopStatus(), loadLearningSummary()]);
    } catch {
      statusButton.disabled = false;
      statusButton.textContent = originalText;
    }
    return;
  }
  const assetButton = event.target.closest("[data-draft-asset-brief]");
  if (assetButton) {
    const originalText = assetButton.textContent;
    assetButton.disabled = true;
    assetButton.textContent = "Saving";
    try {
      const data = await fetchJson(`/briefs/${assetButton.dataset.draftAssetBrief}/draft-asset`, { method: "POST" });
      document.getElementById("plan-message").textContent = data.reused ? "Existing draft asset opened." : "Draft asset saved.";
      await Promise.all([loadBriefs(), loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadAssetReviewSession(), loadAssetRewritePack(), loadLoopStatus(), loadLearningSummary()]);
      showScreen("assets");
    } catch (error) {
      document.getElementById("plan-message").textContent = error.message === "Access token required" ? "Set the access token first." : "Could not save draft asset.";
      assetButton.disabled = false;
      assetButton.textContent = originalText;
    }
    return;
  }
  const button = event.target.closest("[data-draft-brief]");
  if (!button) return;
  const items = JSON.parse(document.getElementById("brief-items").dataset.briefs || "[]");
  const brief = items.find((item) => item.id === button.dataset.draftBrief);
  if (!brief) return;
  const form = document.getElementById("compose-form");
  form.elements.channel.value = "facebook";
  form.elements.format.value = brief.format || "carousel";
  form.elements.stage.value = brief.funnel_stage || "TOFU";
  form.elements.language.value = brief.language || "zh";
  form.elements.style_key.value = brief.style_hint || (brief.format === "reel" ? "reel_script_v1" : "edu_carousel_navy");
  form.elements.target_signal.value = brief.target_signal || "";
  form.elements.topic.value = brief.topic || "";
  form.elements.points.value = defaultPointsForBrief(brief).join("\n");
  try {
    await updateBriefStatus(brief.id, "drafted");
    await loadBriefs();
  } catch {
    document.getElementById("plan-message").textContent = "Draft opened, but brief status was not updated.";
  }
  showScreen("compose");
});

document.getElementById("media-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.getElementById("media-message");
  const form = new FormData(event.currentTarget);
  const file = form.get("file");
  const tags = String(form.get("tags") || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (file?.size) {
    form.set("tags", tags.join(","));
    message.textContent = "Uploading media...";
    try {
      await fetchForm("/media-assets/upload", form);
      event.currentTarget.reset();
      message.textContent = "Media uploaded and registered.";
      await Promise.all([loadMediaAssets(), loadLoopStatus()]);
    } catch (error) {
      message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not upload media.";
    }
    return;
  }
  if (!form.get("source_url")) {
    message.textContent = "Add a source URL or choose a file to upload.";
    return;
  }
  const payload = {
    title: form.get("title"),
    source_url: form.get("source_url"),
    media_type: form.get("media_type"),
    rights_status: form.get("rights_status"),
    approval_status: form.get("approval_status"),
    notes: form.get("notes") || null,
    tags,
    metadata: {},
  };
  message.textContent = "Registering media...";
  try {
    await fetchJson("/media-assets", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    message.textContent = "Media registered.";
    await Promise.all([loadMediaAssets(), loadLoopStatus()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not register media.";
  }
});

document.getElementById("compose-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const points = splitLines(form.get("points"));
  const mediaUrls = splitLines(form.get("media_urls"));
  const draft = {
    channel: form.get("channel"),
    format: form.get("format"),
    stage: form.get("stage"),
    language: form.get("language"),
    topic: form.get("topic"),
    points,
    mediaUrls,
    styleKey: form.get("style_key") || (form.get("format") === "reel" ? "reel_script_v1" : "edu_carousel_navy"),
    targetSignal: form.get("target_signal") || null,
  };
  draft.caption = draftCaption(draft);
  currentDraft = draft;
  const queueButton = document.getElementById("queue-draft");
  const saveAssetButton = document.getElementById("save-asset");
  queueButton.disabled = true;
  saveAssetButton.disabled = true;
  try {
    const response = await fetchJson("/composer/draft-post", {
      method: "POST",
      body: JSON.stringify({
        channel: draft.channel,
        format: draft.format,
        stage: draft.stage,
        language: draft.language,
        topic: draft.topic,
        points: draft.points,
        media_urls: draft.mediaUrls,
        style_key: draft.styleKey,
        target_signal: draft.targetSignal,
      }),
    });
    const creative = { item: response.creative || {} };
    const packageItem = creative.item || {};
    draft.caption = packageItem.primary_caption || draft.caption;
    draft.captionVariants = packageItem.caption_variants || [draft.caption];
    draft.slides = packageItem.slides || [];
    draft.reelScript = packageItem.reel_script || [];
    draft.creativeMetadata = packageItem.metadata || {};
    draft.styleKey = packageItem.style_key || null;
    draft.targetSignal = packageItem.target_signal || null;
    draft.briefId = response.brief?.id || null;
    draft.assetId = response.item?.id || null;
    const compliance = packageItem.compliance || await checkCaptionSafety(draft.caption);
    renderDraft(draft, compliance);
    saveAssetButton.disabled = !draft.assetId;
    queueButton.disabled = !draft.assetId || compliance.status === "flagged";
    await Promise.all([loadBriefs(), loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadAssetReviewSession(), loadAssetRewritePack(), loadLoopStatus(), loadLearningSummary()]);
  } catch (error) {
    renderDraft(draft, null);
    document.getElementById("compose-result").insertAdjacentHTML(
      "beforeend",
      `<p class="status-note">${escapeHtml(error.message === "Access token required" ? "Set the access token first." : "Could not save composer draft.")}</p>`
    );
  }
});

document.getElementById("compose-result").addEventListener("click", (event) => {
  const button = event.target.closest("[data-caption-variant]");
  if (!button || !currentDraft) return;
  const index = Number(button.dataset.captionVariant);
  const caption = currentDraft.captionVariants?.[index];
  if (!caption) return;
  currentDraft.caption = caption;
  const captionBox = document.getElementById("draft-caption");
  if (captionBox) captionBox.value = caption;
});

document.getElementById("save-asset").addEventListener("click", async () => {
  if (!currentDraft) return;
  await Promise.all([loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadAssetReviewSession(), loadAssetRewritePack(), loadLoopStatus()]);
  showScreen("assets");
});

document.getElementById("queue-draft").addEventListener("click", async () => {
  if (!currentDraft) return;
  const captionBox = document.getElementById("draft-caption");
  const caption = captionBox ? captionBox.value : currentDraft.caption;
  const compliance = await checkCaptionSafety(caption);
  currentDraft.caption = caption;
  renderDraft(currentDraft, compliance);
  if (compliance.status === "flagged") {
    document.getElementById("queue-draft").disabled = true;
    return;
  }
  if (!currentDraft.assetId) return;
  try {
    await fetchJson(`/assets/${currentDraft.assetId}/queue`, { method: "POST" });
    document.getElementById("queue-draft").disabled = true;
    await Promise.all([loadPublishQueue(), loadLoopStatus()]);
    showScreen("review");
  } catch (error) {
    document.getElementById("compose-result").insertAdjacentHTML("beforeend", `<p class="status-note">${escapeHtml(error.message || "Approve the asset and clear compliance before queueing.")}</p>`);
  }
});

document.getElementById("asset-items").addEventListener("click", async (event) => {
  const attachMediaButton = event.target.closest("[data-attach-asset-media]");
  if (attachMediaButton) {
    const message = document.getElementById("media-message");
    const items = JSON.parse(document.getElementById("asset-items").dataset.assets || "[]");
    const asset = items.find((item) => item.id === attachMediaButton.dataset.attachAssetMedia);
    const currentMedia = Array.isArray(asset?.media_urls) ? asset.media_urls.filter(Boolean).join("\n") : "";
    const mediaInput = window.prompt("Paste approved design/media URL(s), one per line.", currentMedia);
    if (mediaInput === null) return;
    const mediaUrls = splitLines(mediaInput);
    if (!mediaUrls.length) {
      message.textContent = "Add at least one media or design URL.";
      return;
    }
    const rightsNote = window.prompt("Add a short rights / visual QA note.", "Approved for DREC use; visual QA pending.");
    if (rightsNote === null) return;
    const originalText = attachMediaButton.textContent;
    attachMediaButton.disabled = true;
    attachMediaButton.textContent = "Saving";
    try {
      const data = await fetchJson(`/assets/${attachMediaButton.dataset.attachAssetMedia}/media`, {
        method: "PATCH",
        body: JSON.stringify({
          media_urls: mediaUrls,
          rights_note: rightsNote.trim() || "Approved for DREC use; visual QA pending.",
          visual_qa_status: "pending",
          reason: "Attached approved media/design URL for production handoff.",
          sync_draft_queue: true,
        }),
      });
      message.textContent = data.message || "Media/design attached.";
      await Promise.all([loadAssets(), loadPostApprovalProduction(), loadPreScheduleGate(), loadPublishQueue(), loadLoopStatus()]);
    } catch (error) {
      message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not attach media/design.";
      attachMediaButton.disabled = false;
      attachMediaButton.textContent = originalText;
    }
    return;
  }
  const reviewNoteButton = event.target.closest("[data-copy-asset-review]");
  if (reviewNoteButton) {
    const message = document.getElementById("media-message");
    const asset = storedAssetById(reviewNoteButton.dataset.copyAssetReview);
    if (!asset) return;
    try {
      await navigator.clipboard.writeText(assetReviewNoteText(asset));
      message.textContent = "Asset review note copied.";
    } catch {
      message.textContent = "Could not copy review note. Use Download Safety Review instead.";
    }
    return;
  }
  const copyButton = event.target.closest("[data-copy-asset]");
  if (copyButton) {
    const message = document.getElementById("media-message");
    const items = JSON.parse(document.getElementById("asset-items").dataset.assets || "[]");
    const asset = items.find((item) => item.id === copyButton.dataset.copyAsset);
    if (!asset) return;
    try {
      await navigator.clipboard.writeText(assetPackageText(asset));
      message.textContent = "Draft asset package copied.";
    } catch {
      message.textContent = "Could not copy package. Open the asset and copy manually.";
    }
    return;
  }
  const complianceButton = event.target.closest("[data-asset-compliance]");
  if (complianceButton) {
    const status = complianceButton.dataset.assetCompliance;
    const defaultReason = {
      clear: "Asset safety reviewed and cleared for queueing.",
      pending: "Asset needs additional safety review before queueing.",
      flagged: "Asset blocked by safety review.",
    }[status] || "Asset safety status updated.";
    let reason = defaultReason;
    if (status !== "clear") {
      const entered = window.prompt("Add the safety review reason.", defaultReason);
      if (entered === null) return;
      reason = entered.trim() || defaultReason;
    }
    const originalText = complianceButton.textContent;
    complianceButton.disabled = true;
    complianceButton.textContent = "Saving";
    try {
      await fetchJson(`/assets/${complianceButton.dataset.id}/compliance`, {
        method: "PATCH",
        body: JSON.stringify({ compliance_status: status, reason }),
      });
      await Promise.all([loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadAssetReviewSession(), loadAssetRewritePack(), loadLoopStatus(), loadLearningSummary()]);
    } catch {
      complianceButton.disabled = false;
      complianceButton.textContent = originalText;
    }
    return;
  }
  const statusButton = event.target.closest("[data-asset-status]");
  if (statusButton) {
    const status = statusButton.dataset.assetStatus;
    const defaultReason = {
      approved: "Asset approved for queueing.",
      review: "Asset needs more work before queueing.",
      rejected: "Asset rejected during library review.",
    }[status] || "Asset status updated.";
    let reason = defaultReason;
    if (status !== "approved") {
      const entered = window.prompt("Add an asset review reason.", defaultReason);
      if (entered === null) return;
      reason = entered.trim() || defaultReason;
    }
    const originalText = statusButton.textContent;
    statusButton.disabled = true;
    statusButton.textContent = "Saving";
    try {
      await fetchJson(`/assets/${statusButton.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify({ review_status: status, reason }),
      });
      await Promise.all([loadAssets(), loadDoctorSendQueue(), loadDoctorReplyInboxPack(), loadDoctorReviewPolishPack(), loadFirstCycleSprintPack(), loadFirstCycleHandoff(), loadApprovalCockpit(), loadPostApprovalProduction(), loadAssetReviewSession(), loadAssetRewritePack(), loadLoopStatus(), loadLearningSummary()]);
    } catch {
      statusButton.disabled = false;
      statusButton.textContent = originalText;
    }
    return;
  }
  const button = event.target.closest("[data-queue-asset]");
  if (!button) return;
  const items = JSON.parse(document.getElementById("asset-items").dataset.assets || "[]");
  const asset = items.find((item) => item.id === button.dataset.queueAsset);
  if (!asset) return;
  button.disabled = true;
  button.textContent = "Adding";
  try {
    const data = await fetchJson(`/assets/${button.dataset.queueAsset}/queue`, { method: "POST" });
    document.getElementById("media-message").textContent = data.reused ? "Existing queue item opened." : "Asset added to queue.";
    await Promise.all([loadPublishQueue(), loadLoopStatus()]);
    showScreen("review");
  } catch (error) {
    document.getElementById("media-message").textContent = error.message === "Access token required" ? "Set the access token first." : "Could not add asset to queue.";
    button.disabled = false;
    button.textContent = "Add To Queue";
  }
});

document.getElementById("queue-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.getElementById("queue-message");
  const form = new FormData(event.currentTarget);
  const plannedSlot = form.get("planned_slot");
  const mediaUrls = String(form.get("media_urls") || "")
    .split("\n")
    .map((url) => url.trim())
    .filter(Boolean);
  const payload = {
    channel: form.get("channel"),
    format: form.get("format"),
    caption: form.get("caption"),
    media_urls: mediaUrls,
    planned_slot: plannedSlot ? new Date(plannedSlot).toISOString() : null,
    compliance_status: form.get("compliance_status"),
  };
  message.textContent = "Checking safety...";
  try {
    const compliance = await checkCaptionSafety(payload.caption);
    if (compliance.status === "flagged") {
      message.textContent = "Blocked by safety check. Please rewrite before queueing.";
      return;
    }
    if (compliance.status === "pending") {
      payload.compliance_status = "pending";
    }
    if (editingQueueItem) {
      message.textContent = "Updating item...";
      await fetchJson(`/publish-queue/${editingQueueItem.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...payload,
          status: editingQueueItem.status || "draft",
          planned_slot_changed: true,
        }),
      });
      resetQueueEdit();
      message.textContent = "Queue item updated.";
    } else {
      message.textContent = "Adding item...";
      await fetchJson("/publish-queue", { method: "POST", body: JSON.stringify(payload) });
      event.currentTarget.reset();
      message.textContent = "Queue item added.";
    }
    await Promise.all([loadPublishQueue(), loadLoopStatus()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not save queue item.";
  }
});

document.getElementById("cancel-queue-edit").addEventListener("click", () => {
  resetQueueEdit();
  document.getElementById("queue-message").textContent = "Edit cancelled.";
});

document.addEventListener("click", async (event) => {
  const productionDesignAllButton = event.target.closest("[data-copy-production-design-all]");
  if (productionDesignAllButton) {
    const message = document.getElementById("media-message") || document.getElementById("asset-message");
    if (!latestProductionItems.length) {
      if (message) message.textContent = "No production items to copy yet.";
      return;
    }
    const original = productionDesignAllButton.textContent;
    productionDesignAllButton.disabled = true;
    productionDesignAllButton.textContent = "Copying";
    try {
      await navigator.clipboard.writeText(productionBatchText(latestProductionItems));
      if (message) message.textContent = "All production design text copied.";
    } catch {
      if (message) message.textContent = "Browser blocked clipboard copy. Download the production pack instead.";
    } finally {
      productionDesignAllButton.disabled = false;
      productionDesignAllButton.textContent = original;
    }
    return;
  }

  const productionDesignButton = event.target.closest("[data-copy-production-design]");
  if (productionDesignButton) {
    const assetId = productionDesignButton.dataset.copyProductionDesign || "";
    const item = latestProductionItems.find((candidate) => candidate.asset_id === assetId);
    const message = document.getElementById("media-message") || document.getElementById("asset-message");
    if (!item) {
      if (message) message.textContent = "Production item not found. Refresh Assets and try again.";
      return;
    }
    const original = productionDesignButton.textContent;
    productionDesignButton.disabled = true;
    productionDesignButton.textContent = "Copying";
    try {
      await navigator.clipboard.writeText(productionDesignText(item));
      if (message) message.textContent = "Production design text copied.";
    } catch {
      if (message) message.textContent = "Browser blocked clipboard copy. Download the production pack instead.";
    } finally {
      productionDesignButton.disabled = false;
      productionDesignButton.textContent = original;
    }
    return;
  }

  const doctorSendAllButton = event.target.closest("[data-copy-doctor-send-all]");
  if (doctorSendAllButton) {
    const message = document.getElementById("media-message") || document.getElementById("asset-message");
    if (!latestDoctorSendItems.length) {
      if (message) message.textContent = "No doctor send items to copy yet.";
      return;
    }
    const original = doctorSendAllButton.textContent;
    doctorSendAllButton.disabled = true;
    doctorSendAllButton.textContent = "Copying";
    try {
      await navigator.clipboard.writeText(doctorSendBatchText(latestDoctorSendItems));
      if (message) message.textContent = "All doctor send queue text copied.";
    } catch {
      if (message) message.textContent = "Browser blocked clipboard copy. Download the send queue instead.";
    } finally {
      doctorSendAllButton.disabled = false;
      doctorSendAllButton.textContent = original;
    }
    return;
  }

  const doctorFullMessageButton = event.target.closest("[data-copy-doctor-full-message]");
  const doctorPasteBackButton = event.target.closest("[data-copy-doctor-paste-back]");
  const doctorBridgeButton = doctorFullMessageButton || doctorPasteBackButton;
  if (doctorBridgeButton) {
    const message = document.getElementById("media-message") || document.getElementById("asset-message");
    const text = doctorFullMessageButton ? latestDoctorFullMessage : latestDoctorPasteBackTemplate;
    if (!text) {
      if (message) message.textContent = doctorFullMessageButton ? "No full doctor message to copy yet." : "No paste-back template to copy yet.";
      return;
    }
    const original = doctorBridgeButton.textContent;
    doctorBridgeButton.disabled = true;
    doctorBridgeButton.textContent = "Copying";
    try {
      await navigator.clipboard.writeText(text);
      if (message) message.textContent = doctorFullMessageButton ? "Full doctor message copied." : "Doctor paste-back template copied.";
    } catch {
      if (message) message.textContent = "Browser blocked clipboard copy. Download the doctor bridge instead.";
    } finally {
      doctorBridgeButton.disabled = false;
      doctorBridgeButton.textContent = original;
    }
    return;
  }

  const doctorSendButton = event.target.closest("[data-copy-doctor-send]");
  const doctorReplyTemplateButton = event.target.closest("[data-copy-doctor-reply-template]");
  const doctorQueueButton = doctorSendButton || doctorReplyTemplateButton;
  if (doctorQueueButton) {
    const assetId = doctorSendButton?.dataset.copyDoctorSend || doctorReplyTemplateButton?.dataset.copyDoctorReplyTemplate || "";
    const item = latestDoctorSendItems.find((candidate) => candidate.asset_id === assetId);
    const message = document.getElementById("media-message") || document.getElementById("asset-message");
    if (!item) {
      if (message) message.textContent = "Doctor send item not found. Refresh Assets and try again.";
      return;
    }
    const original = doctorQueueButton.textContent;
    doctorQueueButton.disabled = true;
    doctorQueueButton.textContent = "Copying";
    try {
      await navigator.clipboard.writeText(doctorSendButton ? doctorSendText(item) : doctorReplyTemplateText(item));
      if (message) message.textContent = doctorSendButton ? "Doctor review text copied." : "Doctor reply template copied.";
    } catch {
      if (message) message.textContent = "Browser blocked clipboard copy. Download the send queue instead.";
    } finally {
      doctorQueueButton.disabled = false;
      doctorQueueButton.textContent = original;
    }
    return;
  }

  const doctorInboxAllButton = event.target.closest("[data-copy-doctor-inbox-all]");
  if (doctorInboxAllButton) {
    const message = document.getElementById("media-message") || document.getElementById("asset-message");
    if (!latestDoctorReplyItems.length) {
      if (message) message.textContent = "No doctor reply templates to copy yet.";
      return;
    }
    const original = doctorInboxAllButton.textContent;
    doctorInboxAllButton.disabled = true;
    doctorInboxAllButton.textContent = "Copying";
    try {
      await navigator.clipboard.writeText(doctorInboxBatchText(latestDoctorReplyItems));
      if (message) message.textContent = "All doctor reply inbox templates copied.";
    } catch {
      if (message) message.textContent = "Browser blocked clipboard copy. Download the reply inbox instead.";
    } finally {
      doctorInboxAllButton.disabled = false;
      doctorInboxAllButton.textContent = original;
    }
    return;
  }

  const doctorInboxReplyButton = event.target.closest("[data-copy-doctor-inbox-reply]");
  if (doctorInboxReplyButton) {
    const assetId = doctorInboxReplyButton.dataset.copyDoctorInboxReply || "";
    const item = latestDoctorReplyItems.find((candidate) => candidate.asset_id === assetId);
    const message = document.getElementById("media-message") || document.getElementById("asset-message");
    if (!item) {
      if (message) message.textContent = "Doctor reply template not found. Refresh Assets and try again.";
      return;
    }
    const original = doctorInboxReplyButton.textContent;
    doctorInboxReplyButton.disabled = true;
    doctorInboxReplyButton.textContent = "Copying";
    try {
      await navigator.clipboard.writeText(doctorInboxReplyText(item));
      if (message) message.textContent = "Doctor reply inbox template copied.";
    } catch {
      if (message) message.textContent = "Browser blocked clipboard copy. Download the reply inbox instead.";
    } finally {
      doctorInboxReplyButton.disabled = false;
      doctorInboxReplyButton.textContent = original;
    }
    return;
  }

  const polishAllButton = event.target.closest("[data-copy-doctor-polish-all]");
  if (polishAllButton) {
    const message = document.getElementById("media-message") || document.getElementById("asset-message");
    if (!latestDoctorPolishItems.length) {
      if (message) message.textContent = "No doctor polish items to copy yet.";
      return;
    }
    const original = polishAllButton.textContent;
    polishAllButton.disabled = true;
    polishAllButton.textContent = "Copying";
    try {
      await navigator.clipboard.writeText(doctorPolishBatchText(latestDoctorPolishItems));
      if (message) message.textContent = "All doctor polish review text copied.";
    } catch {
      if (message) message.textContent = "Browser blocked clipboard copy. Download the polish pack instead.";
    } finally {
      polishAllButton.disabled = false;
      polishAllButton.textContent = original;
    }
    return;
  }

  const polishButton = event.target.closest("[data-copy-doctor-polish]");
  if (polishButton) {
    const assetId = polishButton.dataset.copyDoctorPolish || "";
    const item = latestDoctorPolishItems.find((candidate) => candidate.asset_id === assetId);
    const message = document.getElementById("media-message") || document.getElementById("asset-message");
    if (!item) {
      if (message) message.textContent = "Polish item not found. Refresh Assets and try again.";
      return;
    }
    const original = polishButton.textContent;
    polishButton.disabled = true;
    polishButton.textContent = "Copying";
    try {
      await navigator.clipboard.writeText(doctorPolishText(item));
      if (message) message.textContent = "Doctor polish text copied.";
    } catch {
      if (message) message.textContent = "Browser blocked clipboard copy. Download the polish pack instead.";
    } finally {
      polishButton.disabled = false;
      polishButton.textContent = original;
    }
    return;
  }

  const doctorAllButton = event.target.closest("[data-copy-sprint-doctor-all]");
  const productionAllButton = event.target.closest("[data-copy-sprint-production-all]");
  if (doctorAllButton || productionAllButton) {
    const button = doctorAllButton || productionAllButton;
    const message = document.getElementById("media-message") || document.getElementById("asset-message");
    if (!latestSprintItems.length) {
      if (message) message.textContent = "No sprint items to copy yet.";
      return;
    }
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Copying";
    const text = doctorAllButton
      ? sprintBatchText(latestSprintItems, sprintDoctorText, "Doctor Review Batch")
      : sprintBatchText(latestSprintItems, sprintProductionText, "Production Batch");
    try {
      await navigator.clipboard.writeText(text);
      if (message) message.textContent = doctorAllButton ? "All doctor review text copied." : "All production task text copied.";
    } catch {
      if (message) message.textContent = "Browser blocked clipboard copy. Download the sprint pack instead.";
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
    return;
  }

  const doctorButton = event.target.closest("[data-copy-sprint-doctor]");
  const productionButton = event.target.closest("[data-copy-sprint-production]");
  const button = doctorButton || productionButton;
  if (!button) return;
  const assetId = doctorButton?.dataset.copySprintDoctor || productionButton?.dataset.copySprintProduction || "";
  const item = latestSprintItems.find((candidate) => candidate.asset_id === assetId);
  const message = document.getElementById("media-message") || document.getElementById("asset-message");
  if (!item) {
    if (message) message.textContent = "Sprint item not found. Refresh Assets and try again.";
    return;
  }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Copying";
  const text = doctorButton ? sprintDoctorText(item) : sprintProductionText(item);
  try {
    await navigator.clipboard.writeText(text);
    if (message) message.textContent = doctorButton ? "Doctor review text copied." : "Production task text copied.";
  } catch {
    if (message) message.textContent = "Browser blocked clipboard copy. Open the sprint pack download and copy manually.";
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

document.getElementById("handoff-result").addEventListener("click", async (event) => {
  const publishButton = event.target.closest("[data-handoff-published]");
  if (publishButton) {
    await recordPublishedItem(publishButton.dataset.handoffPublished, publishButton, { refreshHandoff: true });
    return;
  }
  const button = event.target.closest("[data-copy-handoff]");
  if (!button) return;
  const box = document.getElementById("handoff-copy-text");
  const message = document.getElementById("queue-message");
  if (!box?.value) {
    message.textContent = "No handoff text to copy yet.";
    return;
  }
  button.disabled = true;
  button.textContent = "Copying";
  try {
    await navigator.clipboard.writeText(box.value);
    message.textContent = "Publishing handoff copied.";
  } catch {
    box.select();
    message.textContent = "Select the handoff text and copy it manually.";
  } finally {
    button.disabled = false;
    button.textContent = "Copy Handoff";
  }
});

document.getElementById("queue-status-filter").addEventListener("change", loadPublishQueue);
document.getElementById("queue-channel-filter").addEventListener("change", loadPublishQueue);

document.getElementById("week-schedule").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-queue]");
  if (!button) return;
  startQueueEdit(button.dataset.editQueue);
});

document.getElementById("queue-items").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-queue]");
  if (editButton) {
    startQueueEdit(editButton.dataset.editQueue);
    return;
  }
  const scheduleButton = event.target.closest("[data-schedule-next]");
  if (scheduleButton) {
    await scheduleNextQueueSlot(scheduleButton, document.getElementById("queue-message"));
    return;
  }
  const cancelButton = event.target.closest("[data-cancel-queue-item]");
  if (cancelButton) {
    await cancelQueueItem(cancelButton.dataset.cancelQueueItem, cancelButton);
    return;
  }
  const button = event.target.closest("[data-mark-published]");
  if (!button) return;
  await recordPublishedItem(button.dataset.markPublished, button);
});

document.getElementById("check-compliance").addEventListener("click", async () => {
  const form = document.getElementById("queue-form");
  const message = document.getElementById("queue-message");
  const caption = new FormData(form).get("caption");
  if (!caption) {
    message.textContent = "Add a caption first.";
    return;
  }
  message.textContent = "Checking safety...";
  try {
    await checkCaptionSafety(caption);
    message.textContent = "Safety check complete.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Safety check failed.";
  }
});

document.getElementById("build-handoff").addEventListener("click", async () => {
  const message = document.getElementById("queue-message");
  message.textContent = "Building handoff...";
  try {
    const data = await fetchJson("/publishing-handoff");
    renderHandoff(data);
    message.textContent = "Handoff ready.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not build handoff.";
  }
});

document.getElementById("download-calendar").addEventListener("click", async () => {
  const message = document.getElementById("queue-message");
  message.textContent = "Preparing calendar...";
  try {
    const text = await fetchText("/publish-queue/calendar.ics");
    const blob = new Blob([text], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "drec-publishing-calendar.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    message.textContent = "Publishing calendar downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download calendar.";
  }
});

document.getElementById("download-run-sheet")?.addEventListener("click", async () => {
  const message = document.getElementById("queue-message");
  message.textContent = "Preparing run sheet...";
  try {
    await downloadProtectedFile("/operations/publishing-run-sheet.md", "drec-publishing-run-sheet.md", "text/markdown");
    message.textContent = "Publishing run sheet downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download run sheet.";
  }
});

document.getElementById("download-schedule-csv")?.addEventListener("click", async () => {
  const message = document.getElementById("queue-message");
  message.textContent = "Preparing schedule CSV...";
  try {
    await downloadProtectedFile("/publish-queue/schedule.csv", "drec-publishing-schedule.csv", "text/csv");
    message.textContent = "Publishing schedule CSV downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download schedule CSV.";
  }
});

document.getElementById("download-schedule-worksheet")?.addEventListener("click", async () => {
  const message = document.getElementById("queue-message");
  message.textContent = "Preparing schedule worksheet...";
  try {
    await downloadProtectedFile("/publish-queue/schedule-worksheet.csv", "drec-schedule-worksheet.csv", "text/csv");
    message.textContent = "Schedule worksheet downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download schedule worksheet.";
  }
});

async function uploadScheduleWorksheet({ dryRun }) {
  const message = document.getElementById("queue-message");
  const fileInput = document.getElementById("schedule-worksheet-file");
  const file = fileInput?.files?.[0];
  if (!file) {
    message.textContent = "Choose a schedule worksheet CSV first.";
    return;
  }
  const body = new FormData();
  body.append("file", file);
  body.append("dry_run", dryRun ? "true" : "false");
  message.textContent = dryRun ? "Previewing schedule worksheet..." : "Importing schedule worksheet...";
  try {
    const data = await fetchForm("/publish-queue/import-schedule-worksheet", body);
    if (!dryRun) fileInput.value = "";
    message.textContent = data.message || (dryRun ? "Schedule worksheet previewed." : "Schedule worksheet imported.");
    renderScheduleWorksheetPreview(data);
    if (!dryRun) await Promise.all([loadPublishQueue(), loadPreScheduleGate(), loadLoopStatus()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : dryRun ? "Could not preview schedule worksheet." : "Could not import schedule worksheet.";
  }
}

document.getElementById("preview-schedule-worksheet")?.addEventListener("click", async () => {
  await uploadScheduleWorksheet({ dryRun: true });
});

document.getElementById("import-schedule-worksheet")?.addEventListener("click", async () => {
  await uploadScheduleWorksheet({ dryRun: false });
});

document.getElementById("download-schedule-audit")?.addEventListener("click", async () => {
  const message = document.getElementById("queue-message");
  message.textContent = "Preparing schedule audit...";
  try {
    await downloadProtectedFile("/publish-queue/schedule-audit.md", "drec-schedule-audit.md", "text/markdown");
    message.textContent = "Schedule audit downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download schedule audit.";
  }
});

document.getElementById("dry-run-facebook").addEventListener("click", async () => {
  const message = document.getElementById("queue-message");
  message.textContent = "Checking Facebook worker...";
  try {
    const data = await fetchJson("/publishing/facebook/dispatch", {
      method: "POST",
      body: JSON.stringify({ dry_run: true }),
    });
    renderFacebookDispatch(data);
    message.textContent = data.ready ? "Facebook worker dry run is ready." : "Facebook worker dry run is blocked.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not dry run Facebook worker.";
  }
});

document.getElementById("dry-run-instagram").addEventListener("click", async () => {
  const message = document.getElementById("queue-message");
  message.textContent = "Checking Instagram worker...";
  try {
    const data = await fetchJson("/publishing/instagram/dispatch", {
      method: "POST",
      body: JSON.stringify({ dry_run: true }),
    });
    renderInstagramDispatch(data);
    message.textContent = data.ready ? "Instagram worker dry run is ready." : "Instagram worker dry run is blocked.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not dry run Instagram worker.";
  }
});

document.getElementById("refresh-meta").addEventListener("click", async () => {
  const message = document.getElementById("meta-message");
  message.textContent = "Checking Meta readiness...";
  await Promise.all([loadMetaReadiness(), loadMetaSetupChecklist()]);
});

document.getElementById("copy-meta-setup").addEventListener("click", async () => {
  const message = document.getElementById("meta-message");
  if (!latestMetaSetupCommands.length) {
    message.textContent = "Load the setup checklist first.";
    return;
  }
  try {
    await navigator.clipboard.writeText(latestMetaSetupCommands.join("\n"));
    message.textContent = "Setup command template copied.";
  } catch {
    message.textContent = "Could not copy automatically. Use the visible setup command template.";
  }
});

document.getElementById("copy-meta-oauth").addEventListener("click", async () => {
  const message = document.getElementById("meta-message");
  if (!latestMetaOAuthUrl) {
    message.textContent = "Load the Meta setup checklist first.";
    return;
  }
  try {
    await navigator.clipboard.writeText(latestMetaOAuthUrl);
    message.textContent = latestMetaOAuthUrl.includes("{META_APP_ID}") ? "OAuth URL template copied." : "OAuth URL copied.";
  } catch {
    message.textContent = "Could not copy automatically. Use the visible OAuth URL.";
  }
});

document.getElementById("download-meta-wizard").addEventListener("click", async () => {
  const message = document.getElementById("meta-message");
  try {
    await downloadProtectedFile("/meta/credential-wizard.md", "drec-meta-credential-wizard.md", "text/markdown");
    message.textContent = "Meta credential wizard downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download Meta credential wizard.";
  }
});

document.getElementById("download-meta-intake").addEventListener("click", async () => {
  const message = document.getElementById("meta-message");
  try {
    await downloadProtectedFile("/meta/credential-intake-pack.md", "drec-meta-credential-intake-pack.md", "text/markdown");
    message.textContent = "Meta credential pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download Meta credential pack.";
  }
});

document.getElementById("download-meta-activation").addEventListener("click", async () => {
  const message = document.getElementById("meta-message");
  try {
    await downloadProtectedFile("/meta/activation-checklist.md", "drec-meta-activation-checklist.md", "text/markdown");
    message.textContent = "Meta activation checklist downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download Meta activation checklist.";
  }
});

document.getElementById("download-meta-preflight").addEventListener("click", async () => {
  const message = document.getElementById("meta-message");
  try {
    await downloadProtectedFile("/meta/preflight-audit.md", "drec-meta-preflight-audit.md", "text/markdown");
    message.textContent = "Meta preflight audit downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download Meta preflight audit.";
  }
});

document.getElementById("download-scheduler-pack").addEventListener("click", async () => {
  const message = document.getElementById("meta-message");
  try {
    await downloadProtectedFile("/operations/scheduler-activation-pack.md", "drec-scheduler-activation-pack.md", "text/markdown");
    message.textContent = "Scheduler activation pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download scheduler pack.";
  }
});

document.getElementById("download-scheduler-health").addEventListener("click", async () => {
  const message = document.getElementById("meta-message");
  try {
    await downloadProtectedFile("/operations/scheduler-health.md", "drec-scheduler-health-pack.md", "text/markdown");
    message.textContent = "Scheduler health pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download scheduler health pack.";
  }
});

document.getElementById("refresh-notify-rail")?.addEventListener("click", async () => {
  const button = document.getElementById("refresh-notify-rail");
  const message = document.getElementById("meta-message");
  button.disabled = true;
  button.textContent = "Refreshing";
  try {
    await loadNotifyRail();
    message.textContent = "Notify Rail refreshed.";
  } finally {
    button.disabled = false;
    button.textContent = "Refresh Notify Rail";
  }
});

document.getElementById("download-whatsapp-pack")?.addEventListener("click", async () => {
  const message = document.getElementById("meta-message");
  try {
    await downloadProtectedFile("/notifications/whatsapp-approval-pack.md", "drec-whatsapp-approval-rail-pack.md", "text/markdown");
    message.textContent = "WhatsApp approval rail pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download WhatsApp approval rail pack.";
  }
});

document.getElementById("download-scheduler-recovery").addEventListener("click", async () => {
  const message = document.getElementById("meta-message");
  try {
    await downloadProtectedFile("/operations/scheduler-recovery-pack.md", "drec-scheduler-recovery-pack.md", "text/markdown");
    message.textContent = "Scheduler recovery pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download scheduler recovery pack.";
  }
});

document.getElementById("dry-run-meta-publishing").addEventListener("click", async () => {
  const message = document.getElementById("meta-message");
  message.textContent = "Checking scheduled publishing job...";
  try {
    const data = await fetchJson("/jobs/meta-publishing?dry_run=true&channel=all", {
      method: "POST",
    });
    renderMetaPublishingJobDryRun(data);
    message.textContent = data.ready_count ? "Publishing job dry run has ready due item(s)." : "Publishing job dry run is blocked or has no due posts.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not dry run scheduled publishing.";
  }
});

document.getElementById("dry-run-meta-metrics").addEventListener("click", async () => {
  const message = document.getElementById("meta-message");
  message.textContent = "Checking Meta metrics worker...";
  try {
    const data = await fetchJson("/metrics/meta/ingest", {
      method: "POST",
      body: JSON.stringify({ dry_run: true, limit: 10, rollup: false }),
    });
    renderMetaMetricsDryRun(data);
    message.textContent = data.ready ? "Meta metrics dry run is ready." : "Meta metrics dry run is blocked.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not dry run Meta metrics.";
  }
});

document.getElementById("schedule-approved-items").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const originalText = button.textContent;
  const message = document.getElementById("queue-message");
  button.disabled = true;
  button.textContent = "Scheduling";
  message.textContent = "Scheduling review-approved items...";
  try {
    const data = await fetchJson("/publish-queue/schedule-approved?limit=20", { method: "POST" });
    message.textContent = `Schedule approved complete: ${data.scheduled || 0} scheduled, ${data.already_scheduled || 0} already scheduled, ${data.skipped || 0} skipped.`;
    await Promise.all([loadPublishQueue(), loadLoopStatus()]);
    showScreen("scheduler");
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not schedule approved items.";
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

document.getElementById("download-review-log")?.addEventListener("click", async () => {
  const message = document.getElementById("queue-message");
  try {
    await downloadProtectedFile("/operations/review-log.md", "drec-review-log.md", "text/markdown");
    message.textContent = "Review log downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download review log.";
  }
});

document.getElementById("download-editorial-qa")?.addEventListener("click", async () => {
  const message = document.getElementById("queue-message");
  try {
    await downloadProtectedFile("/operations/editorial-qa-pack.md", "drec-editorial-qa-pack.md", "text/markdown");
    message.textContent = "Editorial QA pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download editorial QA pack.";
  }
});

document.getElementById("download-review-schedule-pack")?.addEventListener("click", async () => {
  const message = document.getElementById("queue-message");
  try {
    await downloadProtectedFile("/operations/review-to-schedule-pack.md", "drec-review-to-schedule-pack.md", "text/markdown");
    message.textContent = "Review-to-schedule pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download review-to-schedule pack.";
  }
});

document.getElementById("download-review-queue")?.addEventListener("click", async () => {
  const message = document.getElementById("queue-message");
  try {
    await downloadProtectedFile("/operations/review-queue.csv", "drec-review-queue.csv", "text/csv");
    message.textContent = "Review queue CSV downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download review queue CSV.";
  }
});

document.getElementById("download-review-queue-decisions")?.addEventListener("click", async () => {
  const message = document.getElementById("queue-message");
  try {
    await downloadProtectedFile("/operations/review-queue-decisions.csv", "drec-review-queue-decisions.csv", "text/csv");
    message.textContent = "Review queue decisions CSV downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download review queue decisions.";
  }
});

function renderReviewQueueDecisionPreview(data) {
  const container = document.getElementById("review-queue-decision-preview");
  if (!container) return;
  const rows = data.planned || data.imported || [];
  const skipped = data.skipped || [];
  container.innerHTML = `
    <article class="insight-card">
      <strong>${data.dry_run ? "Queue Decision Preview" : "Queue Decision Import"}</strong>
      <small>${rows.length} row(s) ready · ${skipped.length} skipped</small>
      ${rows.length ? `
        <ul>${rows.slice(0, 10).map((row) => `
          <li>
            <strong>${escapeHtml(row.channel || "")} / ${escapeHtml(row.format || "")}</strong>
            ${escapeHtml(row.reviewer_action || "")}
            ${row.feedback_id ? ` · feedback ${escapeHtml(row.feedback_id)}` : ""}
          </li>
        `).join("")}</ul>
      ` : ""}
      ${skipped.length ? `
        <h4>Skipped Rows</h4>
        <ul>${skipped.slice(0, 10).map((row) => `<li><strong>Row ${escapeHtml(row.row || "")}</strong> ${escapeHtml(row.queue_id || "")}${row.queue_id ? " · " : ""}${escapeHtml(row.reason || "")}</li>`).join("")}</ul>
      ` : ""}
      ${Array.isArray(data.safety) && data.safety.length ? `
        <h4>Safety</h4>
        <ul>${data.safety.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      ` : ""}
    </article>
  `;
}

async function uploadReviewQueueDecisions({ dryRun }) {
  const message = document.getElementById("queue-message");
  const fileInput = document.getElementById("review-queue-decisions-file");
  const file = fileInput?.files?.[0];
  if (!file) {
    message.textContent = "Choose a review queue decision CSV first.";
    return;
  }
  const body = new FormData();
  body.append("file", file);
  body.append("dry_run", dryRun ? "true" : "false");
  message.textContent = dryRun ? "Previewing queue decisions..." : "Importing queue decisions...";
  try {
    const data = await fetchForm("/operations/import-review-queue-decisions", body);
    if (!dryRun) fileInput.value = "";
    message.textContent = data.message || (dryRun ? "Queue decisions previewed." : "Queue decisions imported.");
    renderReviewQueueDecisionPreview(data);
    if (!dryRun) await Promise.all([loadPublishQueue(), loadPreScheduleGate(), loadLoopStatus()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : dryRun ? "Could not preview queue decisions." : "Could not import queue decisions.";
  }
}

document.getElementById("preview-review-queue-decisions")?.addEventListener("click", async () => {
  await uploadReviewQueueDecisions({ dryRun: true });
});

document.getElementById("import-review-queue-decisions")?.addEventListener("click", async () => {
  await uploadReviewQueueDecisions({ dryRun: false });
});

document.getElementById("review-items").addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-queue]");
  if (editButton) {
    startQueueEdit(editButton.dataset.editQueue);
    return;
  }
  const scheduleButton = event.target.closest("[data-schedule-next]");
  if (scheduleButton) {
    await scheduleNextQueueSlot(scheduleButton, document.getElementById("queue-message"));
    showScreen("scheduler");
    return;
  }
  const button = event.target.closest("[data-feedback]");
  if (!button) return;
  const action = button.dataset.feedback;
  const id = button.dataset.id;
  const originalText = button.textContent;
  const items = JSON.parse(document.getElementById("review-items").dataset.items || "[]");
  const item = items.find((entry) => entry.id === id) || {};
  const defaultReason = {
    approve: "Approved for scheduling after a planned time is selected.",
    regen: "Needs a stronger draft before publishing.",
    reject: "Rejected during content review.",
  }[action] || `Review action: ${action}`;
  let reason = defaultReason;
  if (action === "regen" || action === "reject") {
    const entered = window.prompt("Add the review reason so the system can learn from it.", defaultReason);
    if (entered === null) return;
    reason = entered.trim() || defaultReason;
  }
  button.disabled = true;
  button.textContent = "Saving";
  const statusMap = {
    approve: "draft",
    edit: "draft",
    regen: "draft",
    reject: "cancelled",
  };
  try {
    await fetchJson("/feedback", {
      method: "POST",
      body: JSON.stringify({
        module: "review_queue",
        ref_type: "publish_queue",
        ref_id: id,
        action,
        reason,
        before_text: item.caption || null,
        tags: ["web_review"],
      }),
    });
    await fetchJson(`/publish-queue/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: statusMap[action] || "draft" }),
    });
    await Promise.all([loadPublishQueue(), loadLoopStatus()]);
  } catch {
    button.disabled = false;
    button.textContent = originalText;
  }
});

document.getElementById("learning-summary").addEventListener("click", async (event) => {
  const suggestionButton = event.target.closest("[data-create-learning-suggestion]");
  if (suggestionButton) {
    const message = document.getElementById("weight-message");
    const index = Number(suggestionButton.dataset.createLearningSuggestion);
    const suggestion = latestLearningWeightSuggestions[index];
    if (!suggestion) {
      if (message) message.textContent = "Learning suggestion not found. Refresh Learning and try again.";
      return;
    }
    suggestionButton.disabled = true;
    suggestionButton.textContent = "Logging";
    try {
      await fetchJson("/learning-weights", {
        method: "POST",
        body: JSON.stringify({
          dimension: suggestion.dimension,
          key: suggestion.key,
          value: Number(suggestion.value),
          previous_value: suggestion.previous_value ?? null,
          reason: suggestion.reason || suggestion.safe_use_note || null,
          source: suggestion.source || "suggested_from_outcome_signal",
        }),
      });
      if (message) message.textContent = "Suggested learning weight logged.";
      await Promise.all([loadLearningSummary(), loadLoopStatus(), loadQuarterlyMemo()]);
    } catch (error) {
      if (message) message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not log suggested learning weight.";
      suggestionButton.disabled = false;
      suggestionButton.textContent = "Log Weight";
    }
    return;
  }

  const button = event.target.closest("[data-revert-weight]");
  if (!button) return;
  button.disabled = true;
  button.textContent = "Reverting";
  try {
    await fetchJson(`/learning-weights/${button.dataset.revertWeight}/revert`, { method: "PATCH" });
    await Promise.all([loadLearningSummary(), loadLoopStatus()]);
  } catch {
    button.disabled = false;
    button.textContent = "Revert";
  }
});

document.getElementById("build-weekly-report").addEventListener("click", async () => {
  const message = document.getElementById("weight-message");
  const reportBox = document.getElementById("weekly-report-text");
  const copyButton = document.getElementById("copy-weekly-report");
  message.textContent = "Building weekly report...";
  try {
    const report = await fetchText("/weekly-report.md");
    reportBox.value = report;
    copyButton.disabled = !report;
    message.textContent = "Weekly report ready.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not build weekly report.";
  }
});

document.getElementById("copy-weekly-report").addEventListener("click", async () => {
  const message = document.getElementById("weight-message");
  const reportBox = document.getElementById("weekly-report-text");
  if (!reportBox.value) {
    message.textContent = "Build the report first.";
    return;
  }
  try {
    await navigator.clipboard.writeText(reportBox.value);
    message.textContent = "Weekly report copied.";
  } catch {
    reportBox.select();
    message.textContent = "Select the report text and copy it manually.";
  }
});

document.getElementById("download-weekly-report")?.addEventListener("click", async () => {
  const message = document.getElementById("weight-message");
  try {
    await downloadProtectedFile("/weekly-report.md", "drec-weekly-report.md", "text/markdown");
    message.textContent = "Weekly report downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download weekly report.";
  }
});

document.getElementById("download-weekly-cycle-pack")?.addEventListener("click", async () => {
  const message = document.getElementById("weight-message");
  try {
    await downloadProtectedFile("/operations/weekly-cycle-pack.md", "drec-weekly-cycle-pack.md", "text/markdown");
    message.textContent = "Weekly cycle pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download cycle pack.";
  }
});

document.getElementById("use-topics-weekly-plan").addEventListener("click", async () => {
  await loadLearningTopicsIntoPlan(document.getElementById("weight-message"), { openPlan: true });
});

document.getElementById("download-learning-snapshot")?.addEventListener("click", async () => {
  const message = document.getElementById("weight-message");
  try {
    await downloadProtectedFile("/operations/learning-snapshot.csv", "drec-learning-snapshot.csv", "text/csv");
    message.textContent = "Learning snapshot downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download learning snapshot.";
  }
});

document.getElementById("refresh-quarterly-memo")?.addEventListener("click", async () => {
  const message = document.getElementById("weight-message");
  message.textContent = "Refreshing quarterly memo...";
  await loadQuarterlyMemo();
  message.textContent = "Quarterly memo refreshed.";
});

document.getElementById("download-quarterly-memo")?.addEventListener("click", async () => {
  const message = document.getElementById("weight-message");
  try {
    await downloadProtectedFile("/learning/quarterly-memo.md", "drec-quarterly-learning-memo.md", "text/markdown");
    message.textContent = "Quarterly memo downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download quarterly memo.";
  }
});

document.getElementById("download-metrics-template")?.addEventListener("click", async () => {
  const message = document.getElementById("metric-message");
  try {
    await downloadProtectedFile("/operations/metrics-template.csv", "drec-metrics-template.csv", "text/csv");
    message.textContent = "Metrics template downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download metrics template.";
  }
});

document.getElementById("download-metrics-closeout")?.addEventListener("click", async () => {
  const message = document.getElementById("metric-message");
  try {
    await downloadProtectedFile("/operations/metrics-closeout-pack.md", "drec-metrics-closeout-pack.md", "text/markdown");
    message.textContent = "Metrics closeout pack downloaded.";
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not download metrics closeout pack.";
  }
});

function renderMetricsImportPreview(data) {
  const container = document.getElementById("metrics-import-preview");
  if (!container) return;
  const planned = data.planned || [];
  const imported = data.imported || [];
  const skipped = data.skipped || [];
  const visibleRows = planned.length ? planned : imported;
  container.innerHTML = `
    <article class="learning-card wide-learning">
      <h3>Metrics CSV Check</h3>
      <p>${escapeHtml(data.message || "No CSV check has run yet.")}</p>
      <small>${escapeHtml(data.mode === "dry_run" ? "Preview only. No records were written." : "Import completed. Refresh Learning for updated outcomes.")}</small>
      <div class="summary-row">
        <span>Ready/imported: ${escapeHtml(data.mode === "dry_run" ? data.planned_count || 0 : data.imported_count || 0)}</span>
        <span>Outcomes: ${escapeHtml(data.outcome_count || 0)}</span>
        <span>Skipped: ${escapeHtml(data.skipped_count || 0)}</span>
      </div>
      ${visibleRows.length ? `
        <h4>${data.mode === "dry_run" ? "Importable Rows" : "Imported Rows"}</h4>
        <ul>${visibleRows.slice(0, 8).map((row) => `<li><strong>Row ${escapeHtml(row.row || "")}</strong> ${escapeHtml(row.source || "")} · ${escapeHtml(row.external_post_id || "")}</li>`).join("")}</ul>
      ` : ""}
      ${skipped.length ? `
        <h4>Skipped Rows</h4>
        <ul>${skipped.slice(0, 8).map((row) => `<li><strong>Row ${escapeHtml(row.row || "")}</strong> ${escapeHtml(row.external_post_id || "")}${row.external_post_id ? " · " : ""}${escapeHtml(row.reason || "")}</li>`).join("")}</ul>
      ` : ""}
    </article>
  `;
}

async function uploadMetricsCsv({ dryRun }) {
  const message = document.getElementById("metric-message");
  const fileInput = document.getElementById("metrics-csv-file");
  const rollup = document.getElementById("metrics-import-rollup")?.checked;
  const file = fileInput?.files?.[0];
  if (!file) {
    message.textContent = "Choose a metrics CSV first.";
    return;
  }
  const body = new FormData();
  body.append("file", file);
  body.append("rollup", rollup ? "true" : "false");
  body.append("dry_run", dryRun ? "true" : "false");
  message.textContent = dryRun ? "Previewing metrics CSV..." : "Importing metrics CSV...";
  try {
    const data = await fetchForm("/metrics/import-csv", body);
    if (!dryRun) fileInput.value = "";
    message.textContent = data.message || `Imported ${data.imported_count || 0} metric row(s).`;
    renderMetricsImportPreview(data);
    if (!dryRun) await Promise.all([loadOutcomes(), loadLoopStatus(), loadLearningSummary()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : dryRun ? "Could not preview metrics CSV." : "Could not import metrics CSV.";
  }
}

document.getElementById("preview-metrics-csv")?.addEventListener("click", async () => {
  await uploadMetricsCsv({ dryRun: true });
});

document.getElementById("import-metrics-csv")?.addEventListener("click", async () => {
  await uploadMetricsCsv({ dryRun: false });
});

document.getElementById("weight-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.getElementById("weight-message");
  const form = new FormData(event.currentTarget);
  const previous = numberOrNull(form.get("previous_value"));
  const payload = {
    dimension: form.get("dimension"),
    key: form.get("key"),
    value: Number(form.get("value")),
    previous_value: previous,
    reason: form.get("reason") || null,
    source: "manual",
  };
  message.textContent = "Logging learning...";
  try {
    await fetchJson("/learning-weights", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    message.textContent = "Learning logged.";
    await Promise.all([loadLearningSummary(), loadLoopStatus()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not log learning.";
  }
});

function metricPayloadFromForm(form) {
  const capturedAt = form.get("captured_at");
  const metrics = {
    reach: integerOrNull(form.get("reach")) || 0,
    likes: integerOrNull(form.get("likes")) || 0,
    comments: integerOrNull(form.get("comments")) || 0,
    saves: integerOrNull(form.get("saves")) || 0,
    shares: integerOrNull(form.get("shares")) || 0,
    leads: integerOrNull(form.get("leads")) || 0,
    spend: numberOrNull(form.get("spend")) || 0,
  };
  return {
    source: form.get("source"),
    external_post_id: form.get("external_post_id"),
    captured_at: capturedAt ? new Date(capturedAt).toISOString() : new Date().toISOString(),
    metrics,
  };
}

function prefillPerformanceFromQueueItem(item) {
  const metricForm = document.getElementById("metric-form");
  const outcomeForm = document.getElementById("outcome-form");
  const source = item.channel === "instagram" ? "instagram" : "facebook";
  const postId = item.external_post_id || "";
  const publishedAt = item.updated_at || item.planned_slot || item.created_at || "";
  metricForm.elements.source.value = source;
  metricForm.elements.external_post_id.value = postId;
  metricForm.elements.captured_at.value = formatDatetimeLocal(new Date().toISOString());
  outcomeForm.elements.channel.value = source;
  outcomeForm.elements.format.value = item.format || "carousel";
  outcomeForm.elements.post_id.value = postId;
  outcomeForm.elements.published_at.value = formatDatetimeLocal(publishedAt);
  outcomeForm.elements.vs_plan_note.value = item.caption
    ? `Manual metrics entered for ${source} ${item.format || "post"}. Review whether this caption angle should be repeated: ${item.caption.slice(0, 160)}`
    : "";
}

async function saveRawMetricFromCurrentForm() {
  const metricForm = document.getElementById("metric-form");
  const payload = metricPayloadFromForm(new FormData(metricForm));
  await fetchJson("/metrics", { method: "POST", body: JSON.stringify(payload) });
  return payload;
}

async function rollupLatestMetricFromCurrentForm() {
  const form = new FormData(document.getElementById("metric-form"));
  const postId = form.get("external_post_id");
  return fetchJson("/metrics/rollup", {
    method: "POST",
    body: JSON.stringify({
      external_post_id: postId || null,
      metric_window: "7d",
      format: document.querySelector("#outcome-form [name='format']")?.value || null,
      channel: form.get("source") === "ads" ? "manual" : form.get("source"),
      pillar: "metabolic_education",
    }),
  });
}

document.getElementById("load-published-post").addEventListener("click", async () => {
  const message = document.getElementById("metric-message");
  message.textContent = "Loading latest published post...";
  try {
    const data = await fetchJson("/metrics/published-source?limit=10");
    if (!data.latest) {
      message.textContent = data.message || "No published post with a Meta ID is ready for metrics.";
      return;
    }
    prefillPerformanceFromQueueItem(data.latest);
    message.textContent = `Loaded ${data.latest.channel} post ${data.latest.external_post_id}. Add metrics, then save or roll up.`;
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not load a published post.";
  }
});

document.getElementById("metric-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.getElementById("metric-message");
  message.textContent = "Saving raw metrics...";
  try {
    await saveRawMetricFromCurrentForm();
    message.textContent = "Raw metrics saved.";
    await loadLoopStatus();
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not save raw metrics.";
  }
});

document.getElementById("save-rollup-metric").addEventListener("click", async () => {
  const message = document.getElementById("metric-message");
  const button = document.getElementById("save-rollup-metric");
  const originalText = button.textContent;
  message.textContent = "Saving metrics and creating outcome...";
  button.disabled = true;
  button.textContent = "Working";
  try {
    await saveRawMetricFromCurrentForm();
    await rollupLatestMetricFromCurrentForm();
    message.textContent = "Metrics saved and outcome created.";
    await Promise.all([loadOutcomes(), loadLoopStatus(), loadLearningSummary()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not save and roll up metrics.";
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

document.getElementById("rollup-metric").addEventListener("click", async () => {
  const message = document.getElementById("metric-message");
  message.textContent = "Rolling metrics into outcome...";
  try {
    await rollupLatestMetricFromCurrentForm();
    message.textContent = "Outcome created from latest metrics.";
    await Promise.all([loadOutcomes(), loadLoopStatus(), loadLearningSummary()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not roll up metrics.";
  }
});

document.getElementById("outcome-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.getElementById("outcome-message");
  const form = new FormData(event.currentTarget);
  const publishedAt = form.get("published_at");
  const payload = {
    post_id: form.get("post_id"),
    pillar: "metabolic_education",
    funnel_stage: form.get("funnel_stage"),
    format: form.get("format"),
    channel: form.get("channel"),
    published_at: publishedAt ? new Date(publishedAt).toISOString() : null,
    metric_window: form.get("metric_window"),
    score: numberOrNull(form.get("score")),
    watch_metric: null,
    shares: integerOrNull(form.get("shares")),
    saves: integerOrNull(form.get("saves")),
    cpl: numberOrNull(form.get("cpl")),
    vs_plan_note: form.get("vs_plan_note") || null,
  };
  message.textContent = "Saving result...";
  try {
    await fetchJson("/outcomes", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    message.textContent = "Result saved.";
    await Promise.all([loadOutcomes(), loadLoopStatus(), loadLearningSummary()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not save result.";
  }
});

storeAccessTokenFromUrl();
loadLoopStatus();
loadLaunchReadiness();
loadKb();
loadBriefs();
loadAssets();
loadDoctorSendQueue();
loadDoctorReplyInboxPack();
loadDoctorReviewPolishPack();
loadFirstCycleSprintPack();
loadFirstCycleHandoff();
loadApprovalCockpit();
loadPostApprovalProduction();
loadAssetReviewSession();
loadAssetRewritePack();
loadMediaAssets();
loadLearningSummary();
loadQuarterlyMemo();
loadPublishQueue();
loadPreScheduleGate();
loadMetaReadiness();
loadMetaSetupChecklist();
loadOutcomes();
loadAccessPolicy();
loadAdsPlanning();
updateTokenButton();
