const state = {
  session: null,
  apiKeys: [],
  lastCreatedApiKey: null
};

const els = {
  createApiKey: document.querySelector("#createApiKey"),
  signinButton: document.querySelector("#signinButton"),
  signinPanel: document.querySelector("#signinPanel"),
  newApiKeyPanel: document.querySelector("#newApiKeyPanel"),
  apiKeyList: document.querySelector("#apiKeyList"),
  mcpConfigSnippet: document.querySelector("#mcpConfigSnippet"),
  mcpUrlPrompt: document.querySelector("#mcpUrlPrompt"),
  logoutButton: document.querySelector("#logoutButton"),
  toast: document.querySelector("#toast")
};

els.signinButton?.addEventListener("click", async () => {
  const started = await post("/api/auth/x/start", { returnTo: "/api-keys" });
  location.href = started.authUrl;
});

els.logoutButton?.addEventListener("click", async () => {
  await post("/api/auth/logout", {}).catch(() => null);
  state.session = null;
  state.apiKeys = [];
  state.lastCreatedApiKey = null;
  notify("Logged out");
  render();
});

els.createApiKey?.addEventListener("click", async () => {
  const result = await post("/api/api-keys", {
    name: `MCP key ${new Date().toLocaleDateString()}`
  });
  state.lastCreatedApiKey = result.secret;
  state.apiKeys = [result.apiKey, ...state.apiKeys.filter((key) => key.id !== result.apiKey.id)];
  notify("MCP API key created");
  render();
});

async function refresh() {
  const sessionData = await fetchJson("/api/session");
  state.session = sessionData.session;
  if (state.session?.handle) {
    state.apiKeys = (await fetchJson("/api/api-keys")).apiKeys || [];
  } else {
    state.apiKeys = [];
    state.lastCreatedApiKey = null;
  }
  render();
}

function render() {
  const signedIn = Boolean(state.session?.handle);
  els.signinPanel?.classList.toggle("is-hidden", signedIn);
  if (els.createApiKey) els.createApiKey.disabled = !signedIn;
  renderConfigSnippet();
  renderNewKey();
  renderKeyList();
}

function renderConfigSnippet() {
  const mcpUrl = `${location.origin}/mcp`;
  const config = {
    mcpServers: {
      bunos: {
        url: mcpUrl,
        headers: {
          Authorization: "Bearer bunos_mcp_..."
        }
      }
    }
  };
  els.mcpConfigSnippet.textContent = JSON.stringify(config, null, 2);
  els.mcpUrlPrompt.textContent = [
    "Use this MCP URL in any MCP client:",
    mcpUrl,
    "",
    "Authorization header:",
    "Bearer bunos_mcp_..."
  ].join("\n");
}

function renderNewKey() {
  els.newApiKeyPanel.classList.toggle("is-hidden", !state.lastCreatedApiKey);
  els.newApiKeyPanel.innerHTML = state.lastCreatedApiKey ? `
    <span class="panel-kicker">Copy once</span>
    <strong>Your new MCP API key</strong>
    <code>${esc(state.lastCreatedApiKey)}</code>
    <button type="button" class="secondary-action compact-button" data-copy-secret>Copy key</button>
  ` : "";

  document.querySelector("[data-copy-secret]")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(state.lastCreatedApiKey || "");
    notify("API key copied");
  });
}

function renderKeyList() {
  if (!state.session?.handle) {
    els.apiKeyList.innerHTML = empty("Sign in first", "Connect X to create an MCP API key for your wallet.");
    return;
  }

  els.apiKeyList.innerHTML = state.apiKeys.length
    ? state.apiKeys.map((key) => `
      <div class="api-key-item">
        <div>
          <strong>${esc(key.name)}</strong>
          <span>${esc(key.prefix)}...${esc(key.last4)} · created ${esc(formatDate(key.createdAt))}</span>
          <small>${key.lastUsedAt ? `Last used ${esc(formatDate(key.lastUsedAt))}` : "Not used yet"}</small>
        </div>
        <button type="button" class="secondary-action compact-button" data-revoke-key="${esc(key.id)}">Revoke</button>
      </div>
    `).join("")
    : empty("No keys yet", "Create a key to connect this wallet to Claude, Cursor, or any MCP client.");

  document.querySelectorAll("[data-revoke-key]").forEach((button) => {
    button.addEventListener("click", async () => {
      const keyId = button.dataset.revokeKey;
      await del(`/api/api-keys/${encodeURIComponent(keyId)}`);
      state.apiKeys = state.apiKeys.filter((key) => key.id !== keyId);
      notify("API key revoked");
      render();
    });
  });
}

async function fetchJson(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "Request failed");
  return data;
}

async function post(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "Request failed");
  return data;
}

async function del(path) {
  const response = await fetch(path, { method: "DELETE" });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "Request failed");
  return data;
}

function empty(title, body) {
  return `<div class="empty-state"><strong>${esc(title)}</strong><span>${esc(body)}</span></div>`;
}

function notify(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function formatDate(value) {
  if (!value) return "Just now";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

refresh().catch((error) => notify(error.message));
