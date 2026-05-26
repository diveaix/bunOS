import { getArcReadiness } from "./arcRpc.js";
import { getArcPerpsReadiness } from "./arcPerpsEngine.js";
import { getCircleReadiness } from "./circleProvider.js";
import { config } from "./config.js";
import { getXReplyReadiness } from "./xReplyPoster.js";

export async function getBuildPreflight() {
  const [arc, arcPerps] = await Promise.all([
    getArcReadiness().catch((error) => ({ ok: false, error: error.message })),
    Promise.resolve(getArcPerpsReadiness())
  ]);
  const circle = getCircleReadiness();
  const xReply = getXReplyReadiness();
  const checks = [
    check("arc_rpc", "Arc RPC", arc.ok, true, arc.ok ? `chain ${arc.chainId}` : arc.error || "not ready"),
    check("circle_wallets", "Circle wallets", circle.ready, true, circle.ready ? "configured" : circle.message),
    check("circle_transfers", "Circle transfer provider", config.transferProvider === "circle" && circle.ready, true, `provider=${config.transferProvider}`),
    check("x_auth", "X auth", true, config.x.authMode === "real" && Boolean(config.x.clientId && config.x.redirectUri.startsWith("https://")), config.x.authMode),
    check("x_webhook", "X webhook", true, Boolean(config.webhookSecret), config.webhookSecret ? "signed" : "unsigned local"),
    check("x_reply", "X bot replies", true, xReply.ready, xReply.status),
    check("arc_perps", "ArcPerps read/quote", arcPerps.ok, true, arcPerps.ok ? "contracts configured; user-owned execution pending" : arcPerps.missing.join(", "))
  ];

  const blockers = checks.filter((item) => !item.localOk);
  const launchBlockers = checks.filter((item) => !item.launchOk);
  return {
    ok: blockers.length === 0,
    localReadyPct: estimateCompletion(checks, "localOk"),
    launchReadyPct: estimateCompletion(checks, "launchOk"),
    checks,
    blockers,
    launchBlockers,
    nextActions: nextActions({ checks, circle, arcPerps })
  };
}

function check(id, label, localOk, launchOk, detail) {
  return {
    id,
    label,
    ok: Boolean(localOk),
    localOk: Boolean(localOk),
    launchOk: Boolean(launchOk),
    detail
  };
}

function estimateCompletion(checks, key) {
  const weights = {
    arc_rpc: 15,
    circle_wallets: 18,
    circle_transfers: 18,
    x_auth: 12,
    x_webhook: 10,
    x_reply: 8,
    arc_perps: 19
  };
  return checks.reduce((sum, item) => sum + (item[key] ? weights[item.id] || 0 : 0), 0);
}

function nextActions({ checks, circle, arcPerps }) {
  const actions = [];
  if (!circle.ready) {
    actions.push("Finish Circle env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_SET_ID, CIRCLE_WALLETS_ENABLED=1");
  }
  if (config.transferProvider !== "circle") {
    actions.push("Set TRANSFER_PROVIDER=circle for real Circle transfers");
  }
  if (config.x.authMode !== "real") {
    actions.push("Deploy to HTTPS, then set X_AUTH_MODE=real and X OAuth callback envs");
  }
  if (!config.webhookSecret) {
    actions.push("Set X_WEBHOOK_SECRET before using a public webhook endpoint");
  }
  const xReply = getXReplyReadiness();
  if (!xReply.ready) {
    actions.push("Enable X bot replies: set X_REPLY_ENABLED=1, X_BOT_ACCESS_TOKEN, and include tweet.write in X_SCOPES");
  }
  if (arcPerps.ok) {
    actions.push("Build user-owned ArcPerps execution: Circle contract execution or delegated AppKit adapter; backend signer path is disabled");
  }
  if (!actions.length && checks.every((item) => item.ok)) {
    actions.push("Run the judge flow end to end: X webhook -> receipt -> approval -> real settlement");
  }
  return actions;
}
