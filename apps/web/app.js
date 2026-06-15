const apiBase = window.DREC_API_BASE_URL || localStorage.getItem("DREC_API_BASE_URL") || "http://localhost:8080";

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

async function fetchJson(path, options) {
  const res = await fetch(`${apiBase}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
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
    document.getElementById("queue-count").textContent = "API not connected yet";
    document.getElementById("kb-count").textContent = "API not connected yet";
    document.getElementById("feedback-count").textContent = "API not connected yet";
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
    container.innerHTML = '<p class="muted">Connect the API to load knowledge entries.</p>';
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
