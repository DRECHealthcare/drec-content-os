const apiBase = window.DREC_API_BASE_URL || localStorage.getItem("DREC_API_BASE_URL") || "https://drec-content-os-api.fly.dev";
const tokenKey = "DREC_ACCESS_TOKEN";
let currentDraft = null;

const titleMap = {
  dashboard: "Dashboard",
  plan: "Weekly Plan",
  compose: "Create A Post",
  review: "Review Queue",
  scheduler: "Scheduler",
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
    if (screen === "outcomes") loadOutcomes();
    if (screen === "learning") loadLearningSummary();
    if (screen === "scheduler" || screen === "review") loadPublishQueue();
  });
});

function showScreen(screen) {
  const button = document.querySelector(`nav button[data-screen="${screen}"]`);
  if (button) button.click();
}

function accessToken() {
  return localStorage.getItem(tokenKey) || "";
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
  loadOutcomes();
  loadLearningSummary();
  loadPublishQueue();
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

function splitLines(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
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

function defaultPointsForBrief(brief) {
  const beats = brief.structure_beats || {};
  if (Array.isArray(beats.body) && beats.body.length) return beats.body;
  return [
    brief.hook_primary || `Explain ${brief.topic} simply.`,
    brief.target_signal || "Give one practical observation.",
    brief.compliance_notes || "Keep it educational and invite professional review.",
  ];
}

async function loadLoopStatus() {
  try {
    const data = await fetchJson("/loop-status");
    const scheduled = data.queue?.reduce((sum, item) => sum + item.count, 0) || 0;
    document.getElementById("queue-count").textContent = `${scheduled} queue item(s)`;
    document.getElementById("brief-count").textContent = `${data.brief_count || 0} brief(s)`;
    document.getElementById("kb-count").textContent = `${data.kb_count} knowledge item(s)`;
    document.getElementById("outcome-count").textContent = `${data.outcome_count || 0} performance record(s)`;
  } catch {
    const message = accessToken() ? "API access failed" : "Set access token";
    document.getElementById("queue-count").textContent = message;
    document.getElementById("brief-count").textContent = message;
    document.getElementById("kb-count").textContent = message;
    document.getElementById("outcome-count").textContent = message;
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
        <button type="button" data-draft-brief="${escapeHtml(item.id)}">Draft</button>
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

async function loadLearningSummary() {
  const container = document.getElementById("learning-summary");
  if (!container) return;
  try {
    const data = await fetchJson("/learning-summary");
    const briefs = data.recent_briefs || [];
    const outcomes = data.recent_outcomes || [];
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
        <h3>Recent Results</h3>
        <ul>
          ${outcomes.length ? outcomes.map((outcome) => `<li><strong>${escapeHtml(outcome.metric_window || "7d")}</strong> ${escapeHtml(outcome.post_id || "")} · score ${escapeHtml(outcome.score ?? "n/a")} · saves ${escapeHtml(outcome.saves ?? 0)}</li>`).join("") : "<li>No performance records yet.</li>"}
        </ul>
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
  const actions = mode === "review" ? `
    <div class="queue-actions">
      <button type="button" data-feedback="approve" data-id="${escapeHtml(item.id)}" ${canApprove ? "" : "disabled"}>Approve</button>
      <button type="button" data-feedback="edit" data-id="${escapeHtml(item.id)}">Edit</button>
      <button type="button" data-feedback="regen" data-id="${escapeHtml(item.id)}">Regen</button>
      <button type="button" data-feedback="reject" data-id="${escapeHtml(item.id)}">Reject</button>
    </div>
  ` : "";
  return `
    <article class="queue-item">
      <div class="queue-meta">
        <span>${escapeHtml(item.channel)}</span>
        <span>${escapeHtml(item.format)}</span>
        <span>${escapeHtml(item.status || "draft")}</span>
        <span>${escapeHtml(item.compliance_status || "pending")}</span>
      </div>
      <p>${escapeHtml(item.caption)}</p>
      <small>${formatDate(item.planned_slot)} · ${mediaCount} media URL(s)</small>
      ${actions}
    </article>
  `;
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
      <textarea id="draft-caption">${escapeHtml(draft.caption)}</textarea>
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
    const queueMarkup = items.length
      ? items.map((item) => queueCard(item, "queue")).join("")
      : '<p class="status-note">No queue items yet.</p>';
    const reviewMarkup = items.length
      ? items.map((item) => queueCard(item, "review")).join("")
      : '<p class="status-note">No content waiting for review.</p>';
    queueContainer.innerHTML = queueMarkup;
    reviewContainer.innerHTML = reviewMarkup;
  } catch {
    const message = '<p class="status-note">Set the access token to load the publish queue.</p>';
    queueContainer.innerHTML = message;
    reviewContainer.innerHTML = message;
  }
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

document.getElementById("brief-items").addEventListener("click", (event) => {
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
  showScreen("compose");
});

document.getElementById("compose-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const points = splitLines(form.get("points"));
  const draft = {
    channel: form.get("channel"),
    format: form.get("format"),
    stage: form.get("stage"),
    language: form.get("language"),
    topic: form.get("topic"),
    points,
  };
  draft.caption = draftCaption(draft);
  currentDraft = draft;
  const queueButton = document.getElementById("queue-draft");
  queueButton.disabled = true;
  try {
    const compliance = await checkCaptionSafety(draft.caption);
    renderDraft(draft, compliance);
    queueButton.disabled = compliance.status === "flagged";
  } catch {
    renderDraft(draft, null);
  }
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
      channel: currentDraft.channel,
      format: currentDraft.format,
      caption,
      media_urls: [],
      planned_slot: null,
      compliance_status: compliance.status === "clear" ? "clear" : "pending",
    }),
  });
  document.getElementById("queue-draft").disabled = true;
  await Promise.all([loadPublishQueue(), loadLoopStatus()]);
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
    message.textContent = "Adding item...";
    await fetchJson("/publish-queue", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    message.textContent = "Queue item added.";
    await Promise.all([loadPublishQueue(), loadLoopStatus()]);
  } catch (error) {
    message.textContent = error.message === "Access token required" ? "Set the access token first." : "Could not add queue item.";
  }
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

document.getElementById("review-items").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-feedback]");
  if (!button) return;
  const action = button.dataset.feedback;
  const id = button.dataset.id;
  button.disabled = true;
  button.textContent = "Saving";
  const statusMap = {
    approve: "scheduled",
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
        reason: `Review action: ${action}`,
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
    button.textContent = action;
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

loadLoopStatus();
loadKb();
loadBriefs();
loadLearningSummary();
loadPublishQueue();
loadOutcomes();
updateTokenButton();
