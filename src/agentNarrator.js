const FAILURE_STATUSES = new Set([
  "failed",
  "rejected",
  "position_not_found",
  "position_lookup_failed",
  "wallet_not_found",
  "user_wallet_signing_required",
  "execution_not_enabled",
  "quote_unavailable",
  "clarification_required",
  "not_configured"
]);

const MONITORING_STATUSES = new Set([
  "queued",
  "confirmed",
  "submitted",
  "pending",
  "execution_pending",
  "execution_queued"
]);

export function buildAgentNarrative({
  planned = {},
  result = {},
  execution = {},
  decision = {},
  state = {}
} = {}) {
  const intent = planned.intent || {};
  const plan = planned.plan || {};
  const status = String(execution.status || result.status || (execution.ok === false ? "failed" : "completed"));
  const normalizedStatus = status.toLowerCase();
  const tool = execution.tool || plan.tool || "unknown";
  const ok = execution.ok !== false && result.ok !== false && !FAILURE_STATUSES.has(normalizedStatus);
  const mode = responseMode({ ok, status: normalizedStatus, tool, result, plan });
  const details = actionDetails({ intent, result, execution, tool });
  const why = execution.reason || result.reason || result.error || decision.rationale || plan.reason || "";
  const whatChecked = checkedMessages(decision.checks);
  const warnings = Array.isArray(decision.warnings) ? decision.warnings.filter(Boolean).slice(0, 6) : [];
  const whatHappened = happenedText({ mode, status: normalizedStatus, details, why, tool, result, execution });
  const summary = summaryText({ mode, status: normalizedStatus, details, why, tool, result, execution });
  const receipt = buildReceipt({ result, execution });

  return {
    summary,
    mode,
    status,
    decision: {
      stance: decision.stance || mode,
      confidence: decision.confidence || "unknown",
      riskLevel: decision.riskLevel || "unknown"
    },
    whatChecked,
    whatHappened,
    why: why || "The agent evaluated the request against wallet, policy, signer, and route state.",
    nextAction: execution.nextAction || result.nextAction || planned.nextAction || decision.nextAction || "review_result",
    receipt,
    txHash: execution.txHash || result.txHash || receipt.txHash || null,
    warnings,
    context: {
      handle: state.handle || planned.handle || null,
      action: intent.action || execution.action || null,
      asset: details.asset || null,
      route: details.route || null
    }
  };
}

function responseMode({ ok, status, tool, result, plan }) {
  if (status === "clarification_required" || !plan.tool) return "clarifying";
  if (status === "requires_confirmation" || result.approval) return "needs_approval";
  if (!ok) {
    if (status === "quote_unavailable" || status === "position_not_found" || status === "rejected") return "refused";
    return "failed";
  }
  if (tool === "get_balance" || tool === "sync_circle_balances" || tool === "get_market_intelligence" || tool === "get_market_feed_snapshot" || tool === "analyze_portfolio" || tool.includes("strategy") || tool.includes("mandate")) {
    return "waiting";
  }
  if (tool === "answer_agent_question") return "waiting";
  if (status === "settled" || status === "completed" || Boolean(result.txHash)) return "executed";
  if (MONITORING_STATUSES.has(status)) return "monitoring";
  return "waiting";
}

function actionDetails({ intent, result, execution, tool }) {
  const action = result.action || {};
  const payment = result.payment || {};
  const proposal = result.proposal || {};
  const request = action.request || intent || {};
  const amount = request.amount ?? request.amountUsd ?? intent.amount ?? payment.amount ?? proposal.collateralUsd ?? null;
  const fromToken = request.fromToken || intent.fromToken || intent.asset || payment.asset || "USDC";
  const toToken = request.toToken || intent.toToken || null;
  const fromRail = request.fromRail || intent.fromRail || intent.settlementRail || payment.settlementRail || null;
  const toRail = request.toRail || intent.toRail || fromRail;
  const pair = toToken ? `${fromToken} to ${toToken}` : fromToken;
  const route = fromRail && toRail && fromRail !== toRail ? `${fromRail} to ${toRail}` : fromRail;

  return {
    amount,
    fromToken,
    toToken,
    asset: pair,
    route,
    recipient: intent.recipientHandle || payment.recipientHandle || null,
    positionId: execution.ids?.positionId || result.positionId || result.position?.id || null,
    tool
  };
}

function checkedMessages(checks = []) {
  if (!Array.isArray(checks)) return [];
  return checks
    .filter((item) => item && item.message)
    .slice(0, 6)
    .map((item) => ({
      status: item.ok === true ? "ok" : item.ok === false ? "blocked" : "watch",
      message: item.message
    }));
}

function buildReceipt({ result = {}, execution = {} }) {
  const ids = execution.ids || {};
  return {
    url: execution.receiptUrl || result.publicUrl || result.receipt?.publicUrl || null,
    actionId: ids.actionId || result.action?.id || result.receipt?.action?.id || null,
    paymentId: ids.paymentId || result.payment?.id || null,
    approvalId: ids.approvalId || result.approval?.id || result.action?.approvalId || result.payment?.approvalId || result.proposal?.approvalId || null,
    proposalId: ids.proposalId || result.proposal?.id || null,
    positionId: ids.positionId || result.positionId || result.position?.id || null,
    txHash: execution.txHash || result.txHash || result.action?.txHash || result.payment?.transfer?.txHash || null
  };
}

function summaryText({ mode, status, details, why, tool, result, execution }) {
  const actionLabel = humanActionLabel(tool, result);
  const amountText = details.amount ? `${details.amount} ${details.fromToken}` : details.fromToken;
  const routeText = details.route ? ` on ${details.route}` : "";
  const tx = execution.txHash ? ` Tx: ${execution.txHash}.` : "";

  if (mode === "clarifying") {
    return "I need one more detail before I can trade. Tell me the asset, amount, route, or action you want, and I will check it before touching funds.";
  }

  if (tool === "quote_defi_route" && mode !== "executed" && mode !== "monitoring" && mode !== "needs_approval") {
    const request = details.toToken ? `${amountText} to ${details.toToken}` : amountText;
    if (status === "execution_not_enabled") {
      return `I found a ${actionLabel} route for ${request}${routeText}, but I did not execute it because live execution is not enabled or the provider cannot submit from the user wallet yet. No funds moved.`;
    }
    return `I am not taking this ${actionLabel} for ${request}${routeText}. I checked the live route and policy, but the route is not tradable right now: ${cleanReason(why)} No funds moved.`;
  }

  if (tool === "close_arc_perp_user_position" && mode !== "executed" && mode !== "monitoring") {
    if (status === "position_not_found") {
      return "I checked your open ArcPerps positions and did not find a matching position to close. Nothing was closed.";
    }
    if (status === "user_wallet_signing_required") {
      return `I reached the close-position path, but I cannot submit the close without the user's Circle wallet signing path. No backend signer touched the position.`;
    }
    return `I could not close the perp position: ${cleanReason(why)} No position was changed.`;
  }

  if (mode === "needs_approval") {
    return `I prepared the ${actionLabel}, but it needs your approval before anything moves.`;
  }

  if (tool === "list_route_capabilities" || Array.isArray(result.routes)) {
    return readOnlySummary({ tool, result, details });
  }

  if (mode === "executed") {
    return `Executed the ${actionLabel}.${tx || " I have a completed receipt for this action."}`;
  }

  if (mode === "monitoring") {
    return `I queued the ${actionLabel} and I am monitoring it for final settlement.${tx}`;
  }

  if (mode === "waiting") {
    return readOnlySummary({ tool, result, details }) || `I checked the request and there is no trade to execute right now.`;
  }

  return `I could not complete that action: ${cleanReason(why)} No funds moved unless a submitted transaction hash is shown.`;
}

function happenedText({ mode, status, details, why, tool, result, execution }) {
  if (mode === "clarifying") return "The request did not map to a safe executable trading action.";
  if (mode === "executed") return execution.txHash ? "The provider returned an on-chain transaction hash." : "The action reached a completed state.";
  if (mode === "monitoring") return "The action is queued or submitted and still needs receipt follow-through.";
  if (mode === "needs_approval") return "The agent created a prepared action that must be approved before execution.";
  if (tool === "quote_defi_route" && status === "execution_not_enabled") return "A quote/action was created, but execution stopped at the provider/user-wallet boundary.";
  if (tool === "close_arc_perp_user_position" && status === "user_wallet_signing_required") return "The close request was blocked before submission because user-wallet signing is not available.";
  if (tool === "close_arc_perp_user_position" && status === "position_not_found") return "No matching open position was found.";
  if (tool === "list_route_capabilities") return "The agent checked the live route registry.";
  if (result.wallet) return "Wallet state was read and returned.";
  if (tool === "pause_automations") return `The agent paused ${Number(result.paused || 0)} active automation(s).`;
  if (tool === "pause_automation") return "The automation was paused.";
  if (tool === "resume_automation") return "The automation was resumed.";
  if (tool === "delete_automation") return "The automation was deleted.";
  if (tool === "create_automation") return "A new automation was created.";
  return why || `The ${humanActionLabel(tool, result)} finished with status ${status}.`;
}

function readOnlySummary({ tool, result, details }) {
  if (tool === "answer_agent_question" || result.answer) {
    return result.answer || "I answered that without moving funds.";
  }
  if (tool === "get_balance" || tool === "sync_circle_balances") {
    const total = result.wallet?.balance ?? result.wallet?.totalBalanceUsd;
    return total !== undefined
      ? `I checked the wallet. Current synced value is about US$${Number(total).toFixed(2)}.`
      : "I checked the wallet balance.";
  }
  if (tool === "get_market_intelligence" || result.regime || result.routeStats) {
    const regime = result.regime?.status || result.status || "neutral";
    return `I checked market and route conditions. Current regime: ${regime}.`;
  }
  if (tool === "get_market_feed_snapshot" || result.prices || result.freshness) {
    const regime = result.regime?.status || "unknown";
    const freshness = result.freshness?.status || "unknown";
    return `I refreshed market feeds. Regime is ${regime}; data freshness is ${freshness}.`;
  }
  if (tool === "list_route_capabilities" || Array.isArray(result.routes)) {
    const live = (result.routes || []).filter((route) => route.status === "live");
    if (live.length) {
      return `I checked live routes. Available now: ${live.slice(0, 4).map((route) => route.type === "bridge" ? `${route.fromToken} ${route.fromRail}->${route.toRail}` : `${route.fromToken}->${route.toToken} on ${route.fromRail}`).join(", ")}.`;
    }
    return "I checked the route registry. No live routes match that filter right now.";
  }
  if (tool === "analyze_portfolio" || result.portfolio) {
    const total = Number(result.portfolio?.totalValueUsd || 0);
    const recommendation = result.recommendation?.reason || "Portfolio reviewed.";
    return `I analyzed the portfolio. Current known value is about US$${total.toFixed(2)}. ${recommendation}`;
  }
  if (tool.includes("strategy") || result.strategyPlan || result.strategy) {
    return "I reviewed the strategy state and returned the next portfolio action.";
  }
  if (tool.includes("mandate") || result.mandate || result.mandates) {
    if (result.mandate) return `I saved or updated mandate ${result.mandate.id}. It will be enforced before future trades.`;
    return `I checked standing trading mandates. ${result.activeCount || 0} active rule(s) are currently enforced.`;
  }
  if (tool === "pause_automations") {
    const paused = Number(result.paused || 0);
    return paused > 0
      ? `I stopped ${paused} active automation${paused === 1 ? "" : "s"}. They are paused now, so they will not run again until you resume them.`
      : "I checked your automations. Nothing was running, so there was nothing to stop.";
  }
  if (tool === "pause_automation" && result.automation) {
    return `I paused automation ${result.automation.id}. It will not run again until you resume it.`;
  }
  if (tool === "resume_automation" && result.automation) {
    return `I resumed automation ${result.automation.id}.`;
  }
  if (tool === "delete_automation" && result.automation) {
    return `I deleted automation ${result.automation.id}.`;
  }
  if (tool === "create_automation" && result.automation) {
    const every = result.automation.intervalMinutes ? ` every ${result.automation.intervalMinutes} minute${result.automation.intervalMinutes === 1 ? "" : "s"}` : "";
    const runs = result.automation.maxRuns ? ` for ${result.automation.maxRuns} run${result.automation.maxRuns === 1 ? "" : "s"}` : "";
    return `I created automation ${result.automation.id}${every}${runs}.`;
  }
  if (tool === "send_usdc" && result.payment) {
    return `I created the payment to ${details.recipient || "the recipient"} and it is waiting on the configured transfer path.`;
  }
  return "";
}

function humanActionLabel(tool, result = {}) {
  if (tool === "quote_defi_route") return result.action?.type === "bridge" ? "bridge" : "swap";
  if (tool === "send_usdc") return "payment";
  if (tool === "create_airdrop" || tool === "award_airdrop") return "distribution";
  if (tool === "close_arc_perp_user_position") return "perp close";
  if (tool === "propose_arc_perp_trade" || tool === "propose_perp_trade") return "perp trade";
  if (tool === "confirm_action") return "approval";
  if (tool === "get_balance") return "balance check";
  if (tool === "get_market_intelligence") return "market check";
  if (tool === "get_market_feed_snapshot") return "market feed refresh";
  if (tool === "list_route_capabilities") return "route registry check";
  if (tool === "create_mandate") return "mandate creation";
  if (tool === "list_mandates") return "mandate review";
  if (tool === "update_mandate") return "mandate update";
  if (tool === "delete_mandate") return "mandate deletion";
  if (tool === "pause_automations") return "automation pause";
  if (tool === "pause_automation") return "automation pause";
  if (tool === "resume_automation") return "automation resume";
  if (tool === "delete_automation") return "automation deletion";
  if (tool === "create_automation") return "automation creation";
  return "action";
}

function cleanReason(reason) {
  const value = String(reason || "").trim();
  if (!value) return "the provider did not return an executable route.";
  if (/no live .*route|no available quotes|quote_unavailable|provider could not return|server error|fallback/i.test(value)) {
    return "there is no working route for that trade right now. This usually means the pair has low liquidity, the route provider is down, or the asset is not supported yet.";
  }
  if (/insufficient|not enough|balance/i.test(value)) {
    return "the wallet does not have enough spendable balance for this action.";
  }
  const cleaned = value
    .replace(/Provider details:.*/i, "")
    .replace(/AppKit:.*/i, "")
    .replace(/LI\.FI fallback:.*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const finalText = cleaned || "the route is not available right now.";
  return finalText.endsWith(".") ? finalText : `${finalText}.`;
}
