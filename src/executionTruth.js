const FINAL_PHASES = new Set(["settled", "failed", "expired", "claimable", "needs_user_signature"]);

export function buildExecutionTruth({
  kind = "action",
  status,
  rawStatus,
  tool,
  actionType,
  txHash,
  explorerUrl,
  receiptUrl,
  reason,
  nextAction,
  job,
  route,
  amount,
  asset,
  handle,
  terminal
} = {}) {
  const phase = normalizePhase(status || rawStatus);
  const label = labelForKind(kind, actionType, tool);
  const cleanReason = publicReason(reason);
  const message = messageForPhase({
    phase,
    label,
    route,
    txHash,
    reason: cleanReason,
    nextAction
  });

  return dropUndefined({
    kind,
    label,
    phase,
    status: phase,
    rawStatus: rawStatus || status || null,
    terminal: terminal ?? FINAL_PHASES.has(phase),
    message,
    txHash: validTx(txHash) ? txHash : null,
    explorerUrl: validTx(txHash) ? explorerUrl || null : null,
    receiptUrl: receiptUrl || null,
    reason: cleanReason || null,
    nextAction: humanNextAction(nextAction, phase),
    target: route || null,
    amount: amount || null,
    asset: asset || null,
    handle: handle || null,
    job: job ? {
      id: job.id,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      runAfter: job.runAfter || null
    } : null
  });
}

export function truthFromAgentPayload(payload = {}) {
  const execution = payload.execution || {};
  const result = payload.result || {};
  const action = result.action || result.receipt?.action || {};
  const payment = result.payment || {};
  const proposal = result.proposal || {};
  const request = action.request || payload.planned?.intent || {};
  const kind = execution.ids?.paymentId || payment.id
    ? "payment"
    : execution.ids?.actionId || action.id
    ? "defi_action"
    : execution.ids?.proposalId || proposal.id
    ? "perp"
    : execution.tool || payload.planned?.plan?.tool || "action";

  return buildExecutionTruth({
    kind,
    status: payload.executionMonitor?.lifecycle || execution.status || payload.status || result.status || action.status || payment.status || proposal.status,
    rawStatus: execution.status || action.status || payment.status || proposal.status,
    tool: execution.tool || payload.planned?.plan?.tool,
    actionType: action.type || (proposal.symbol ? "perp" : request.action),
    txHash: execution.txHash || payload.txHash || action.txHash || action.execution?.txHash || payment.transfer?.txHash || proposal.txHash || proposal.execution?.txHash,
    explorerUrl: execution.explorerUrl || payload.explorerUrl || action.explorerUrl || action.execution?.explorerUrl || payment.transfer?.explorerUrl || proposal.execution?.explorerUrl,
    receiptUrl: execution.receiptUrl || payload.receiptUrl || result.receipt?.publicUrl || action.publicUrl,
    reason: execution.reason || payload.reason || result.reason || action.reason || action.failureReason || proposal.failureReason,
    nextAction: execution.nextAction || payload.nextAction || result.nextAction || action.nextAction,
    route: routeFromRequest(request, action.type),
    amount: request.amountUsd || request.amount || payment.amount || proposal.collateralUsd,
    asset: request.fromToken || request.asset || payment.asset || proposal.symbol,
    handle: payload.planned?.handle || action.handle || payment.senderHandle || proposal.handle
  });
}

function normalizePhase(status) {
  const value = String(status || "").toLowerCase();
  if (["settled", "completed", "claimed"].includes(value)) return "settled";
  if (["failed", "rejected", "quote_unavailable", "position_not_found", "execution_failed"].includes(value)) return "failed";
  if (["requires_confirmation", "needs_user_signature", "user_wallet_signing_required"].includes(value)) return "needs_user_signature";
  if (["submitted", "running"].includes(value)) return "submitted";
  if (["queued", "confirmed", "approved", "execution_queued", "execution_pending"].includes(value)) return "queued";
  if (["quoted", "pending", "planned"].includes(value)) return value;
  if (["claimable", "expired"].includes(value)) return value;
  return value || "planned";
}

function messageForPhase({ phase, label, route, txHash, reason, nextAction }) {
  const target = route ? ` for ${route}` : "";
  if (phase === "settled") return txHash ? `Done. ${label} finished on-chain.` : `Done. ${label} is complete.`;
  if (phase === "submitted") return txHash ? `${label} was submitted on-chain. I am watching settlement.` : `${label} was submitted. I am watching settlement.`;
  if (phase === "queued") return `${label} is queued${target}. I am waiting for execution to finish.`;
  if (phase === "needs_user_signature") return `${label} is ready, but it needs your wallet approval before anything moves.`;
  if (phase === "quoted") return `${label} has a route${target}. Review it before anything moves.`;
  if (phase === "failed") return `I could not complete ${label.toLowerCase()}${target}. ${reason || "The provider did not return a safe executable result."}`;
  if (phase === "claimable") return `${label} is waiting for the recipient to claim it.`;
  if (phase === "expired") return `${label} expired before completion.`;
  return nextAction ? `${label} is ${phase}. Next: ${humanNextAction(nextAction, phase)}.` : `${label} is ${phase}.`;
}

function labelForKind(kind, actionType, tool) {
  const action = String(actionType || "").toLowerCase();
  if (action === "swap") return "Swap";
  if (action === "bridge") return "Bridge";
  if (String(kind).includes("payment")) return "Payment";
  if (String(kind).includes("perp") || String(tool).includes("perp")) return "Perp trade";
  if (String(kind).includes("automation")) return "Automation";
  if (String(kind).includes("defi")) return "Trade";
  return "Action";
}

function routeFromRequest(request = {}, actionType) {
  if (!request || typeof request !== "object") return null;
  const amount = request.amountUsd || request.amount;
  const fromToken = request.fromToken || request.asset || "USDC";
  const toToken = request.toToken;
  const fromRail = humanRail(request.fromRail || request.settlementRail);
  const toRail = humanRail(request.toRail);
  if (actionType === "bridge" || (request.fromRail && request.toRail && request.fromRail !== request.toRail)) {
    return `${amount || "some"} ${fromToken} from ${fromRail || "Arc"} to ${toRail || "another rail"}`;
  }
  if (toToken) return `${amount || "some"} ${fromToken} to ${toToken} on ${fromRail || "Arc"}`;
  return null;
}

function humanRail(rail) {
  const value = String(rail || "").toLowerCase();
  if (value === "arc" || value === "arc-testnet") return "Arc";
  if (value === "base" || value === "base-sepolia") return "Base Sepolia";
  return rail || "";
}

function humanNextAction(nextAction, phase) {
  const value = String(nextAction || "");
  if (!value || value === "none") return phase === "failed" ? "Try a supported route or lower the amount." : null;
  if (value === "choose_supported_route") return "Try a live route.";
  if (value === "adjust_trade_or_fund_wallet") return "Add funds or lower the amount.";
  if (value === "monitor_receipt" || value === "refresh_execution_monitor") return "Wait for the final receipt.";
  if (value === "approve_action" || value === "approve_or_connect_user_wallet") return "Approve in your wallet.";
  return value.replaceAll("_", " ");
}

function publicReason(reason) {
  return String(reason || "")
    .replace(/Provider details:.*/i, "")
    .replace(/AppKit:.*/i, "")
    .replace(/LI\.FI fallback:.*/i, "")
    .replace(/KIT_KEY:[A-Za-z0-9:_-]+/g, "configured kit key")
    .replace(/0x[a-fA-F0-9]{64}/g, "transaction hash")
    .replace(/\s+/g, " ")
    .trim();
}

function validTx(txHash) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(txHash || ""));
}

function dropUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
