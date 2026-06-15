const apiBase = window.DREC_API_BASE_URL || localStorage.getItem("DREC_API_BASE_URL") || "https://drec-content-os-api.fly.dev";
const tokenKey = "DREC_ACCESS_TOKEN";

const titleMap = {
  dashboard: "Dashboard",
  plan: "Weekly Plan",
  compose: "Create A Post",
  review: "Review Queue",
  scheduler: "Scheduler",
  learning: "Insights & Learning",
  kb: "Knowledge Base",
};

document.querySelectorAll("nav button").forEach((button) => {
  button.addEventListener("click", () => {
    const screen = button.dataset.screen;
    document.querySelectorAll("nav button").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".screen").forEach((item) => item.classList.toggle("active", item.id === screen));
    document.getElementById("title").textContent = titleMap[screen] || screen;
    if (screen === "scheduler" || screen === "review") loadPublishQueue();
  });
});

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

async function loadLoopStatus() {
  try {
    const data = await fetchJson("/loop-status");
    const scheduled = data.queue?.reduce((sum, item) => sum + item.count, 0) || 0;
    document.getElementById("queue-count").textContent = `${scheduled} queue item(s)`;
    document.getElementById("kb-count").textContent = `${data.kb_count} knowledge item(s)`;
    document.getElementById("feedback-count").textContent = `${data.feedback_count} feedback signal(s)`;
  } catch {
    const message = accessToken() ? "API access failed" : "Set access token";
    document.getElementById("queue-count").textContent = message;
    document.getElementById("kb-count").textContent = message;
    document.getElementById("feedback-count").textContent = message;
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

loadLoopStatus();
loadKb();
loadPublishQueue();
updateTokenButton();
