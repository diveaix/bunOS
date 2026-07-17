export async function fetchJson(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.event?.reason || "Request failed");
  }
  return data;
}

export async function post(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.event?.reason || data.nextAction || "Request failed");
  }
  return data;
}

export async function del(path) {
  const response = await fetch(path, { method: "DELETE" });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

export async function requestJson(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function money(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function formatTokenAmount(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

export function formatDate(value) {
  if (!value) return "Just now";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function compactAddress(address) {
  if (!address || address.length < 14) return address || "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function compactHash(hash) {
  if (!hash || hash.length < 18) return hash || "";
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

export function shortRail(id) {
  return id === "arc-testnet" ? "ARC" : (id || "").slice(0, 4).toUpperCase();
}

export function normalizeHandle(handle) {
  const trimmed = String(handle || "").trim();
  return trimmed.startsWith("@") ? trimmed.toLowerCase() : `@${trimmed.toLowerCase()}`;
}

export function normalizeToken(value) {
  const token = String(value || "").trim();
  if (!token) return "";
  if (token.toUpperCase() === "CIRBTC") return "cirBTC";
  return /^0x[a-fA-F0-9]{40}$/.test(token) ? token : token.toUpperCase();
}

export function statusLabel(status) {
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
    rejected: "Rejected",
  }[status] || status;
}

export function isLiveWallet(wallet) {
  return Boolean(wallet?.wallets?.some((item) => item.id && !String(item.id).startsWith("wallet_")));
}
