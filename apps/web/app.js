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

loadLoopStatus();
loadKb();
updateTokenButton();
