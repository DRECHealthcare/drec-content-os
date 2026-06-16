const apiBase = window.DREC_API_BASE_URL || localStorage.getItem("DREC_API_BASE_URL") || "https://drec-content-os-api.fly.dev";
const tokenKey = "DREC_ACCESS_TOKEN";
let currentDraft = null;
let editingQueueItem = null;

const titleMap = {
  dashboard: "Dashboard",
  plan: "Weekly Plan",
  compose: "Create A Post",
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
    if (screen === "plan") loadBriefs();
    if (screen === "assets") Promise.all([loadAssets(), loadMediaAssets()]);
    if (screen === "outcomes") loadOutcomes();
    if (screen === "learning") loadLearningSummary();
    if (screen === "scheduler" || screen === "review") loadPublishQueue();
    if (screen === "meta") loadMetaReadiness();
  });
});

function showScreen(screen) {
  const button = document.querySelector(`nav button[data-screen="${screen}"]`);
  if (button) button.click();
}

function accessToken() {
  return localStorage.getItem(tokenKey) || "";
}

function storeAccessTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("access_token");
  if (!token) return;
  localStorage.setItem(tokenKey, token.trim());
  params.delete("access_token");
  const cleanQuery = params.toString();
  const cleanUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", cleanUrl);
}

function updateTokenButton() {
  const button = document.getElementById("token-button");
  button.textContent = accessToken() ? "Access set" : "Set access";
}

function promptForToken() {
  const token = window.prompt("Enter DREC Content OS access token", accessToken());
  if (token === null) return;
  localStorage.setItem(tokenKey, token.trim());
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
}

document.getElementById("token-button").addEventListener("click", promptForToken);

async function fetchJson(path, options) {
  const token = accessToken();
  const res = await fetch(`${apiBase}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-DREC-Access-Token": token } : {}),
    },
    ...options,
  });
  if (res.status === 401) {
    throw new Error("Access token required");
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchForm(path, formData) {
  const token = accessToken();
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      ...(token ? { "X-DREC-Access-Token": token } : {}),
    },
    body: formData,
  });
  if (res.status === 401) {
    throw new Error("Access token required");
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchText(path) {
  const token = accessToken();
  const res = await fetch(`${apiBase}${path}`, {
    headers: {
      ...(token ? { "X-DREC-Access-Token": token } : {}),
    },
  });
  if (res.status === 401) {
    throw new Error("Access token required");
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
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
    const scheduled = queueTotal(loop.queue);
    document.getElementById("queue-count").textContent = `${scheduled} queue item(s)`;
    document.getElementById("brief-count").textContent = `${loop.brief_count || 0} brief(s)`;
    document.getElementById("asset-count").textContent = `${loop.asset_count || 0} asset(s)`;
    document.getElementById("media-count").textContent = `${loop.media_count || 0} media item(s)`;
    document.getElementById("outcome-count").textContent = `${loop.outcome_count || 0} performance record(s)`;
    renderWorkflowNext(data.workflow || loop);
  } catch {
    const message = accessToken() ? "API access failed" : "Set access token";
    document.getElementById("queue-count").textContent = message;
    document.getElementById("brief-count").textContent = message;
    document.getElementById("asset-count").textContent = message;
    document.getElementById("media-count").textContent = message;
    document.getElementById("outcome-count").textContent = message;
    const workflow = document.getElementById("workflow-next");
    if (workflow) workflow.innerHTML = `<p class="status-note">${escapeHtml(message)}</p>`;
  }
}

async function loadKb() {
  const container = document.getElementById("kb-items");
  try {
    const data = await fetchJson("/kb");
    container.innerHTML = data.items.map((item) => `
      <div class="kb-item">
        <strong>${item.title}</strong><br>
        <small>${item.category}</small>
        <p>${item.body}</p>
      </div>
    `).join("");
  } catch {
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

async function loadLearningSummary() {
  const container = document.getElementById("learning-summary");
  if (!container) return;
  try {
    const data = await fetchJson("/learning-summary");
    const briefs = data.recent_briefs || [];
    const outcomes = data.recent_outcomes || [];
    const weights = data.weights || [];
    const planTopics = data.plan_recommendations?.topics || [];
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
    `;
  } catch {
    container.innerHTML = '<p class="status-note">Set the access token to load learning signals.</p>';
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
        <button type="button" data-copy-asset="${escapeHtml(item.id)}">Copy Package</button>
        <button type="button" data-queue-asset="${escapeHtml(item.id)}" ${canQueue ? "" : "disabled"}>Add To Queue</button>
      </div>
    </article>
  `;
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

async function loadAssets() {
  const container = document.getElementById("asset-items");
  if (!container) return;
  try {
    const data = await fetchJson("/assets");
    const items = data.items || [];
    container.dataset.assets = JSON.stringify(items);
    container.innerHTML = items.length
      ? items.map(assetCard).join("")
      : '<p class="status-note">No saved assets yet. Save one from Create Post.</p>';
  } catch {
    container.innerHTML = '<p class="status-note">Set the access token to load assets.</p>';
  }
}

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
    await Promise.all([loadAssets(), loadPublishQueue(), loadLoopStatus(), loadLearningSummary()]);
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
  const canQuickSchedule = mode === "queue" && item.status !== "published" && item.compliance_status === "clear";
  const canEdit = item.status !== "published";
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
        <span>${escapeHtml(compliance?.status || "unchecked")}</span>
      </div>
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
  } catch {
    const message = '<p class="status-note">Set the access token to load the publish queue.</p>';
    queueContainer.dataset.items = "[]";
    reviewContainer.dataset.items = "[]";
    queueContainer.innerHTML = message;
    reviewContainer.innerHTML = message;
    renderWeekSchedule([]);
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
  const form = new FormData(event.currentTarget);
  const payload = {
    title: form.get("title"),
    category: form.get("category"),
    body: form.get("body"),
    tags: [],
  };
  await fetchJson("/kb", { method: "POST", body: JSON.stringify(payload) });
  event.currentTarget.reset();
  await Promise.all([loadKb(), loadLoopStatus()]);
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
    await Promise.all([loadBriefs(), loadAssets(), loadLoopStatus(), loadLearningSummary()]);
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
      await Promise.all([loadBriefs(), loadAssets(), loadLoopStatus(), loadLearningSummary()]);
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
  };
  draft.caption = draftCaption(draft);
  currentDraft = draft;
  const queueButton = document.getElementById("queue-draft");
  const saveAssetButton = document.getElementById("save-asset");
  queueButton.disabled = true;
  saveAssetButton.disabled = true;
  try {
    const creative = await fetchJson("/creative/draft", {
      method: "POST",
      body: JSON.stringify({
        channel: draft.channel,
        format: draft.format,
        stage: draft.stage,
        language: draft.language,
        topic: draft.topic,
        points: draft.points,
        style_key: draft.format === "reel" ? "reel_script_v1" : "edu_carousel_navy",
      }),
    });
    const packageItem = creative.item || {};
    draft.caption = packageItem.primary_caption || draft.caption;
    draft.captionVariants = packageItem.caption_variants || [draft.caption];
    draft.slides = packageItem.slides || [];
    draft.reelScript = packageItem.reel_script || [];
    draft.creativeMetadata = packageItem.metadata || {};
    draft.styleKey = packageItem.style_key || null;
    draft.targetSignal = packageItem.target_signal || null;
    const compliance = packageItem.compliance || await checkCaptionSafety(draft.caption);
    renderDraft(draft, compliance);
    queueButton.disabled = compliance.status === "flagged";
    saveAssetButton.disabled = compliance.status === "flagged";
  } catch {
    renderDraft(draft, null);
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
  const captionBox = document.getElementById("draft-caption");
  const caption = captionBox ? captionBox.value : currentDraft.caption;
  const compliance = await checkCaptionSafety(caption);
  currentDraft.caption = caption;
  renderDraft(currentDraft, compliance);
  if (compliance.status === "flagged") {
    document.getElementById("save-asset").disabled = true;
    return;
  }
  const data = await fetchJson("/assets", {
    method: "POST",
    body: JSON.stringify({
      channel: currentDraft.channel,
      format: currentDraft.format,
      caption,
      media_urls: currentDraft.mediaUrls || [],
      metadata: {
        stage: currentDraft.stage,
        topic: currentDraft.topic,
        points: currentDraft.points,
        style_key: currentDraft.styleKey,
        target_signal: currentDraft.targetSignal,
        caption_variants: currentDraft.captionVariants || [],
        slides: currentDraft.slides || [],
        reel_script: currentDraft.reelScript || [],
        creative: currentDraft.creativeMetadata || {},
      },
      compliance_status: compliance.status === "clear" ? "clear" : "pending",
      review_status: "draft",
    }),
  });
  currentDraft.assetId = data.item?.id || null;
  await Promise.all([loadAssets(), loadLoopStatus()]);
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
  await fetchJson("/publish-queue", {
    method: "POST",
    body: JSON.stringify({
      asset_id: currentDraft.assetId || null,
      channel: currentDraft.channel,
      format: currentDraft.format,
      caption,
      media_urls: currentDraft.mediaUrls || [],
      planned_slot: null,
      compliance_status: compliance.status === "clear" ? "clear" : "pending",
    }),
  });
  document.getElementById("queue-draft").disabled = true;
  await Promise.all([loadPublishQueue(), loadLoopStatus()]);
});

document.getElementById("asset-items").addEventListener("click", async (event) => {
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
      await Promise.all([loadAssets(), loadLoopStatus(), loadLearningSummary()]);
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
      await Promise.all([loadAssets(), loadLoopStatus(), loadLearningSummary()]);
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
  await loadMetaReadiness();
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

document.getElementById("use-topics-weekly-plan").addEventListener("click", async () => {
  await loadLearningTopicsIntoPlan(document.getElementById("weight-message"), { openPlan: true });
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
loadKb();
loadBriefs();
loadAssets();
loadMediaAssets();
loadLearningSummary();
loadPublishQueue();
loadMetaReadiness();
loadOutcomes();
updateTokenButton();
