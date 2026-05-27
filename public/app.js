const queryParams = new URLSearchParams(location.search);
const explicitHandle = queryParams.has("handle");
const authError = queryParams.get("auth_error");

const state = {
  currentHandle: queryParams.get("handle") || localStorage.getItem("arcpay:handle") || "",
  selectedRail: localStorage.getItem("arcpay:rail") || "arc-testnet",
  config: { providerMode: "mock", settlementRails: [], circle: {}, defi: {} },
  session: null,
  wallets: [],
  payments: [],
  approvals: [],
  defiActions: [],
  claims: [],
  funding: [],
  bridges: [],
  events: []
};

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  logoutButton: document.querySelector("#logoutButton"),
  handleSelect: document.querySelector("#handleSelect"),
  railSelect: document.querySelector("#railSelect"),
  createPanel: document.querySelector("#createPanel"),
  createWalletForm: document.querySelector("#createWalletForm"),
  connectCopy: document.querySelector("#connectCopy"),
  walletStatus: document.querySelector("#walletStatus"),
  walletBalance: document.querySelector("#walletBalance"),
  walletAddress: document.querySelector("#walletAddress"),
  walletAvatar: document.querySelector("#walletAvatar"),
  walletNetwork: document.querySelector("#walletNetwork"),
  receiveHandle: document.querySelector("#receiveHandle"),
  receiveAddress: document.querySelector("#receiveAddress"),
  receiveRail: document.querySelector("#receiveRail"),
  copyAddress: document.querySelector("#copyAddress"),
  xStatus: document.querySelector("#xStatus"),
  circleStatus: document.querySelector("#circleStatus"),
  settlementStatus: document.querySelector("#settlementStatus"),
  railNoteTitle: document.querySelector("#railNoteTitle"),
  railNoteCopy: document.querySelector("#railNoteCopy"),
  navRailLabel: document.querySelector("#navRailLabel"),
  fundForm: document.querySelector("#fundForm"),
  sendForm: document.querySelector("#sendForm"),
  bridgeForm: document.querySelector("#bridgeForm"),
  swapForm: document.querySelector("#swapForm"),
  railBalances: document.querySelector("#railBalances"),
  activityList: document.querySelector("#activityList"),
  toast: document.querySelector("#toast"),
  openFund: document.querySelector("#openFund"),
  openSend: document.querySelector("#openSend"),
  openReceive: document.querySelector("#openReceive"),
  openBridge: document.querySelector("#openBridge"),
  openSwap: document.querySelector("#openSwap")
};

/* ─── Hash-based Page Routing ────────────────────── */
function navigateTo(hash) {
  const page = hash.replace("#", "") || "assets";
  const viewId = page === "assets" ? "assetView" : `${page}View`;
  document.querySelectorAll(".page-view").forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.page === page);
  });
}

window.addEventListener("hashchange", () => navigateTo(location.hash));

/* ─── Event Listeners ────────────────────────────── */
els.refreshButton?.addEventListener("click", async () => {
  await syncCurrentWallet();
  await refresh();
  notify("Wallet refreshed");
});

els.logoutButton?.addEventListener("click", async () => {
  await post("/api/auth/logout", {}).catch(() => null);
  localStorage.removeItem("arcpay:handle");
  localStorage.setItem("arcpay:loggedOut", "1");
  state.session = null;
  state.currentHandle = "";
  notify("Logged out");
  await refresh();
});

els.railSelect?.addEventListener("change", () => {
  state.selectedRail = els.railSelect.value;
  localStorage.setItem("arcpay:rail", state.selectedRail);
  render();
});

els.createWalletForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (state.config.x?.authMode === "real") {
    const started = await post("/api/auth/x/start", { returnTo: "/wallet" });
    location.href = started.authUrl;
    return;
  }

  const handle = normalizeHandle(state.currentHandle || "@demo");
  await post("/api/auth/x/mock", { handle });
  state.currentHandle = handle;
  localStorage.setItem("arcpay:handle", handle);
  localStorage.removeItem("arcpay:loggedOut");
  notify("X connected and Circle wallets created");
  await refresh();
});

els.fundForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await post("/api/wallets/fund", {
    handle: state.currentHandle,
    amount: Number(form.get("amount")),
    source: form.get("source"),
    settlementRail: form.get("settlementRail") || state.selectedRail
  });
  closeAllModals();
  notify(form.get("source") === "circle_faucet" ? "Circle faucet requested" : "Funding instruction created");
  await refresh();
});

els.bridgeForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = await post("/api/defi/quote", {
    handle: state.currentHandle,
    type: "bridge",
    amount: Number(form.get("amount")),
    slippage: 0.005,
    fromRail: form.get("fromRail"),
    toRail: form.get("toRail"),
    fromToken: normalizeToken(form.get("fromToken")) || "USDC",
    toToken: normalizeToken(form.get("toToken")) || normalizeToken(form.get("fromToken")) || "USDC"
  });
  closeAllModals();
  notify(result.action?.status === "submitted" ? "Bridge submitted" : "Bridge route created");
  scheduleDefiFollowup(result);
  await syncCurrentWallet();
  await refresh();
});

els.sendForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = await post("/api/wallets/send", {
    senderHandle: state.currentHandle,
    recipientHandle: form.get("recipientHandle"),
    amount: Number(form.get("amount")),
    settlementRail: form.get("settlementRail") || state.selectedRail,
    memo: form.get("memo")
  });
  closeAllModals();
  await runWorkerOnce();
  notify(result.payment.status === "claimable" ? "Payment ready for claim" : "Payment processing");
  await refresh();
});

els.swapForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const settlementRail = form.get("fromRail") || state.selectedRail;
  const result = await post("/api/defi/quote", {
    handle: state.currentHandle,
    type: "swap",
    amount: Number(form.get("amount")),
    slippage: Number(form.get("slippage")),
    fromRail: settlementRail,
    toRail: settlementRail,
    fromToken: normalizeToken(form.get("fromToken")) || "USDC",
    toToken: normalizeToken(form.get("toToken")) || "EURC"
  });
  closeAllModals();
  notify(result.action?.status === "submitted" ? "Swap submitted" : "Swap route created");
  scheduleDefiFollowup(result);
  await syncCurrentWallet();
  await refresh();
});

els.copyAddress?.addEventListener("click", async () => {
  const wallet = currentWallet();
  if (!wallet?.walletAddress) return;
  await navigator.clipboard.writeText(walletForRail(wallet, state.selectedRail)?.address || wallet.walletAddress);
  notify("Wallet address copied");
});

els.openFund?.addEventListener("click", () => openModal("modalFund"));
els.openSend?.addEventListener("click", () => openModal("modalSend"));
els.openReceive?.addEventListener("click", () => openModal("modalReceive"));
els.openBridge?.addEventListener("click", () => openModal("modalBridge"));
els.openSwap?.addEventListener("click", () => openModal("modalSwap"));

document.querySelectorAll(".modal-backdrop").forEach((button) => button.addEventListener("click", closeAllModals));
document.querySelectorAll(".modal-close").forEach((button) => button.addEventListener("click", closeAllModals));

/* ─── Modal Helpers ──────────────────────────────── */
function openModal(id) {
  document.getElementById(id)?.classList.add("open");
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay.open").forEach((modal) => modal.classList.remove("open"));
}

/* ─── Data Refresh ───────────────────────────────── */
async function refresh() {
  const [appConfig, sessionData, walletData, ledger] = await Promise.all([
    fetchJson("/api/config"),
    fetchJson("/api/session"),
    fetchJson("/api/wallets"),
    fetchJson("/api/state")
  ]);

  state.config = appConfig;
  state.session = sessionData.session;
  state.wallets = walletData.wallets;
  state.payments = ledger.payments;
  state.claims = ledger.claims;
  state.funding = ledger.funding || [];
  state.bridges = ledger.bridges || [];
  state.events = ledger.events;

  const loggedOut = localStorage.getItem("arcpay:loggedOut") === "1" && !explicitHandle && !state.session?.handle;
  const realMode = state.config.providerMode === "real";
  const sessionHandle = normalizeHandle(state.session?.handle || "");
  const currentIsSession = state.currentHandle && sessionHandle && state.currentHandle === sessionHandle;
  const preferredHandle = chooseDefaultHandle();
  if (loggedOut) {
    state.currentHandle = "";
  } else if (realMode && state.currentHandle && !explicitHandle && !currentIsSession && !isLiveWallet(currentWallet())) {
    state.currentHandle = preferredHandle;
  } else if (!state.currentHandle || !state.wallets.some((wallet) => wallet.handle === state.currentHandle)) {
    state.currentHandle = preferredHandle;
  } else if (!explicitHandle && state.config.providerMode === "real" && !isLiveWallet(currentWallet())) {
    const liveWallet = state.wallets.find(isLiveWallet);
    state.currentHandle = liveWallet?.handle || sessionHandle || "";
  }
  if (state.currentHandle) {
    localStorage.setItem("arcpay:handle", state.currentHandle);
    localStorage.removeItem("arcpay:loggedOut");
  } else if (realMode) {
    localStorage.removeItem("arcpay:handle");
  }

  if (state.currentHandle && !state.wallets.some((wallet) => wallet.handle === state.currentHandle) && (!realMode || explicitHandle || currentIsSession)) {
    const profile = await fetchJson(`/api/wallet?handle=${encodeURIComponent(state.currentHandle)}`);
    state.wallets.push(profile.wallet);
  }

  if (state.currentHandle && currentWallet()?.onboarded) {
    await syncCurrentWallet({ silent: true });
  }

  if (state.currentHandle) {
    const [approvalData, defiData] = await Promise.all([
      fetchJson(`/api/approvals?handle=${encodeURIComponent(state.currentHandle)}&limit=25`),
      fetchJson(`/api/defi/actions?handle=${encodeURIComponent(state.currentHandle)}&limit=25`)
    ]);
    state.approvals = approvalData.approvals || [];
    state.defiActions = defiData.actions || [];
  } else {
    state.approvals = [];
    state.defiActions = [];
  }

  if (!state.config.settlementRails.some((rail) => rail.id === state.selectedRail)) {
    state.selectedRail = state.config.settlementRails[0]?.id || "arc-testnet";
  }

  render();
}

/* ─── Render Pipeline ────────────────────────────── */
function render() {
  const wallet = currentWallet();
  renderConfig();
  renderAccountSwitcher();
  renderRailSwitcher();
  renderWallet(wallet);
  renderRailBalances(wallet);
  renderActivity(wallet);
}

function renderAccountSwitcher() {
  if (els.handleSelect) {
    els.handleSelect.innerHTML = state.wallets
      .map((wallet) => `<option value="${esc(wallet.handle)}">${esc(wallet.handle)}</option>`)
      .join("");
    els.handleSelect.value = state.currentHandle;
  }
}

function renderConfig() {
  const labels = state.config.settlementRails.map((rail) => rail.label);
  if (els.settlementStatus) els.settlementStatus.textContent = labels.join(" + ") || "No rails";
  if (els.navRailLabel) els.navRailLabel.textContent = currentRail()?.label || state.selectedRail;
  if (els.connectCopy) {
    els.connectCopy.textContent = state.config.x?.authMode === "real"
      ? "Connect with real X OAuth. Circle wallets are provisioned after authorization."
      : "Local X auth is simulated until the app is on HTTPS, but Circle/AppKit execution can still use real configured wallets.";
  }
}

function renderRailSwitcher() {
  const options = state.config.settlementRails
    .map((rail) => `<option value="${esc(rail.id)}">${esc(rail.label)}</option>`)
    .join("");

  document.querySelectorAll("[data-rail-options]").forEach((select) => {
    select.innerHTML = options;
  });

  if (els.railSelect) {
    els.railSelect.innerHTML = options;
    els.railSelect.value = state.selectedRail;
  }
  syncRailControls();
}

function renderWallet(wallet) {
  const hasWallet = Boolean(wallet?.onboarded);
  const chainWallet = walletForRail(wallet, state.selectedRail);
  const address = chainWallet?.address || wallet?.walletAddress || "Connect X";
  const totalBalance = Number(wallet?.balance ?? railTokenTotal(wallet, state.selectedRail));

  els.walletAddress.textContent = compactAddress(address);
  els.walletBalance.textContent = money(totalBalance);
  els.createPanel.classList.toggle("is-hidden", hasWallet);
  if (els.receiveHandle) els.receiveHandle.textContent = wallet?.handle || state.currentHandle || "Connect X";
  if (els.receiveAddress) els.receiveAddress.textContent = address;
  if (els.receiveRail) els.receiveRail.textContent = currentRail()?.label || state.selectedRail;
}

function renderRailBalances(wallet) {
  if (!wallet?.onboarded) {
    els.railBalances.innerHTML = empty("No wallet yet", "Connect an X handle to provision Circle wallets.");
    return;
  }
  els.railBalances.innerHTML = state.config.settlementRails.map((rail) => {
    const tokens = tokensForRail(wallet, rail.id);
    const total = railTokenTotal(wallet, rail.id);
    const tokenSummary = tokens
      .filter((token) => Number(token.amount || 0) > 0)
      .map((token) => `${formatTokenAmount(token.amount)} ${esc(token.symbol)}`)
      .join(" · ") || "No tokens";
    const tokenRows = tokens
      .filter((token) => Number(token.amount || 0) > 0)
      .map((token) => `<small>${formatTokenAmount(token.amount)} ${esc(token.symbol)}</small>`)
      .join("") || "<small>0 USDC</small>";
    return `
      <div class="asset-item">
        <div class="asset-icon">${esc(shortRail(rail.id))}</div>
        <div class="asset-info">
          <div class="asset-name">${esc(rail.label)}</div>
          <div class="asset-sub">${tokenSummary}</div>
        </div>
        <div class="asset-value">
          <strong class="asset-usd">${money(total)}</strong>
          ${tokenRows}
        </div>
      </div>
    `;
  }).join("");
}

function renderActivity(wallet) {
  const handle = wallet?.handle || state.currentHandle;
  const items = state.payments.filter((p) => p.senderHandle === handle || p.recipientHandle === handle).reverse();
  const actions = state.defiActions.map((action) => renderDefiActionItem(action)).join("");
  const payments = items.map((p) => renderPaymentItem(p, handle)).join("");
  els.activityList.innerHTML = actions || payments
    ? `${actions}${payments}`
    : empty("No activity yet", "Bridge, swap, or send USDC to see live activity here.");
  bindPaymentButtons();
}

function renderPaymentItem(payment, handle) {
  const out = payment.senderHandle === handle;
  return `<div class="activity-item"><span>${out ? "Sent" : "Received"}</span> <strong>${formatNumber(payment.amount)}</strong></div>`;
}

function bindPaymentButtons() {
  document.querySelectorAll("[data-confirm]").forEach((button) => {
    button.addEventListener("click", async () => {
      await post(`/api/payments/${button.dataset.confirm}/confirm`, {});
      await runWorkerOnce();
      notify("Payment approved");
      await refresh();
    });
  });
  document.querySelectorAll("[data-confirm-approval]").forEach((button) => {
    button.addEventListener("click", async () => {
      await post("/api/actions/confirm", {
        approvalId: button.dataset.confirmApproval,
        handle: state.currentHandle
      });
      await runWorkerOnce();
      notify("Action approved");
      await refresh();
    });
  });
}

function renderDefiActionItem(action) {
  const approval = state.approvals.find((item) => item.id === action.approvalId);
  const needsApproval = approval?.status === "pending";
  const provider = action.quote?.provider || action.protocol || "policy";
  const amount = action.request?.amount || action.request?.amountUsd || 0;
  const rails = [action.request?.fromRail, action.request?.toRail].filter(Boolean).map(shortRail).join(" -> ");
  const tokenRoute = action.type === "swap"
    ? `${action.request?.fromToken || "USDC"} -> ${action.request?.toToken || ""}`.trim()
    : `${action.request?.fromToken || "USDC"}${action.request?.toToken && action.request.toToken !== action.request.fromToken ? ` -> ${action.request.toToken}` : ""}`;
  const reason = action.reason || action.signer?.reason || "";
  return `
    <div class="activity-item">
      <span>${esc(actionLabel(action))} · ${esc(provider)} · ${esc(statusLabel(action.status))}</span>
      <strong>${formatNumber(amount)} ${esc(tokenRoute)} ${rails ? esc(rails) : ""}</strong>
      ${reason ? `<small>${esc(reason)}</small>` : ""}
      ${needsApproval ? `<button type="button" class="inline-action" data-confirm-approval="${esc(approval.id)}">Approve</button>` : ""}
    </div>
  `;
}

/* ─── Helpers ────────────────────────────────────── */
function currentWallet() {
  return state.wallets.find((wallet) => wallet.handle === state.currentHandle);
}

function chooseDefaultHandle() {
  const sessionHandle = normalizeHandle(state.session?.handle || "");
  if (sessionHandle && sessionHandle !== "@") return sessionHandle;
  const liveWallet = state.wallets.find(isLiveWallet);
  if (liveWallet) return liveWallet.handle;
  if (state.config.providerMode === "real") return "";
  return state.wallets.find((wallet) => wallet.onboarded)?.handle || state.wallets[0]?.handle || "@sara";
}

function isLiveWallet(wallet) {
  return Boolean(wallet?.wallets?.some((item) => item.id && !String(item.id).startsWith("wallet_")));
}

function currentRail() {
  return state.config.settlementRails.find((rail) => rail.id === state.selectedRail);
}

function walletForRail(wallet, id) {
  return wallet?.wallets?.find((item) => item.rail === id);
}

function tokensForRail(wallet, railId) {
  const tokens = wallet?.tokenBalances?.[railId];
  if (Array.isArray(tokens) && tokens.length) return tokens;
  return [{
    symbol: "USDC",
    amount: Number(wallet?.balances?.[railId] || 0),
    valueUsd: Number(wallet?.balances?.[railId] || 0)
  }];
}

function railTokenTotal(wallet, railId) {
  return tokensForRail(wallet, railId).reduce((sum, token) => (
    sum + Number(token.valueUsd ?? token.amount ?? 0)
  ), 0);
}

function syncRailControls() {
  document.querySelectorAll("[data-rail-options]").forEach((select) => {
    if (select.name === "toRail" && select.closest("#bridgeForm") && state.config.settlementRails.length > 1) {
      select.value = state.config.settlementRails.find((rail) => rail.id !== state.selectedRail)?.id || state.selectedRail;
      return;
    }
    select.value = state.selectedRail;
  });
}

async function fetchJson(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || data.event?.reason || "Request failed");
  return data;
}

async function fetchStatusJson(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function post(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || data.event?.reason || data.nextAction || "Request failed");
  return data;
}

async function runWorkerOnce() {
  try {
    await post("/api/jobs/run-due", { limit: 10 });
  } catch {
    // Refresh will still show queued or failed status.
  }
}

async function runJobOnce(jobId) {
  if (!jobId) return null;
  try {
    return await post(`/api/jobs/${encodeURIComponent(jobId)}/run`, {});
  } catch {
    return null;
  }
}

function scheduleDefiFollowup(result) {
  const reconcileJobId = result?.execution?.result?.reconcileJobId
    || result?.execution?.job?.result?.reconcileJobId
    || result?.action?.reconcileJobId;

  [16_000, 45_000].forEach((delay) => {
    window.setTimeout(async () => {
      if (reconcileJobId) {
        await runJobOnce(reconcileJobId);
      } else {
        await runWorkerOnce();
      }
      await syncCurrentWallet({ silent: true });
      await refresh();
    }, delay);
  });
}

async function syncCurrentWallet({ silent = false } = {}) {
  if (!state.currentHandle) return null;
  const wallet = currentWallet();
  if (wallet && !wallet.onboarded) return null;

  try {
    const synced = await post("/api/wallets/sync-balances", { handle: state.currentHandle });
    if (synced.wallet) upsertWallet(synced.wallet);
    return synced;
  } catch (error) {
    if (!silent) notify(error.message);
    return null;
  }
}

function upsertWallet(wallet) {
  const index = state.wallets.findIndex((item) => item.handle === wallet.handle);
  if (index >= 0) {
    state.wallets[index] = wallet;
  } else {
    state.wallets.push(wallet);
  }
}

function notify(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function empty(title, body) {
  return `<div class="empty-state"><strong>${esc(title)}</strong><span>${esc(body)}</span></div>`;
}

function actionLabel(action) {
  const labels = {
    bridge: "Bridge quote",
    swap: "Swap quote",
    polymarket_search: "Market search",
    hyperliquid_markets: "Perp discovery"
  };
  return labels[action.type] || action.type;
}

function normalizeHandle(handle) {
  const trimmed = String(handle || "").trim();
  return trimmed.startsWith("@") ? trimmed.toLowerCase() : `@${trimmed.toLowerCase()}`;
}

function normalizeToken(value) {
  const token = String(value || "").trim();
  if (!token) return "";
  if (token.toUpperCase() === "CIRBTC") return "cirBTC";
  return /^0x[a-fA-F0-9]{40}$/.test(token) ? token : token.toUpperCase();
}

function money(value) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value || 0));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function formatTokenAmount(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  });
}

function compactNumber(value) {
  const number = Number(value || 0);
  if (!number) return "n/a";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(number);
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

function compactAddress(address) {
  if (!address || address.length < 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortRail(id) {
  return id === "arc-testnet" ? "ARC" : id.slice(0, 4).toUpperCase();
}

function statusLabel(status) {
  return {
    queued: "Processing",
    submitted: "Settling",
    settled: "Settled",
    failed: "Failed",
    claimable: "Waiting",
    claimed: "Claimed",
    unclaimed: "Ready to claim",
    requires_confirmation: "Needs review",
    confirmed: "Confirmed",
    pending: "Pending",
    approved: "Approved",
    execution_not_enabled: "Execution pending",
    completed: "Completed",
    received: "Received",
    parsed: "Parsed",
    parse_failed: "Parse failed",
    quoted: "Quoted",
    watching_replies: "Watching",
    rejected: "Rejected"
  }[status] || status;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ─── Boot ───────────────────────────────────────── */
refresh()
  .then(() => navigateTo(location.hash))
  .then(() => {
    if (authError) {
      notify(authError);
      history.replaceState({}, "", location.pathname + location.hash);
    }
  })
  .catch((error) => notify(error.message));
