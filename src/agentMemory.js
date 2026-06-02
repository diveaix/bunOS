import { ledger, users } from "./fixtures.js";
import { getWalletCapabilities, getWalletProfile } from "./walletAccounts.js";
import { buildPortfolioSnapshot } from "./portfolioBrain.js";

const MAX_RECENT_DECISIONS = 12;
const MAX_RECENT_FAILURES = 8;

export function buildAgentStateSnapshot({ handle, planned } = {}) {
  const profile = safe(() => getWalletProfile(handle), null);
  const capabilities = safe(() => getWalletCapabilities(handle), null);
  const normalizedHandle = profile?.handle || handle;
  const memory = getAgentMemory(normalizedHandle);
  const recentDefiActions = recentForHandle(ledger.defiActions, normalizedHandle, 8);
  const recentPayments = recentForHandle(ledger.payments, normalizedHandle, 6, (item) => (
    item.senderHandle === normalizedHandle || item.recipientHandle === normalizedHandle
  ));
  const recentApprovals = recentForHandle(ledger.approvals, normalizedHandle, 6);
  const recentPerps = recentForHandle(ledger.perpProposals, normalizedHandle, 6);
  const portfolio = safe(() => buildPortfolioSnapshot({ handle: normalizedHandle }), null);
  const recentFailures = [
    ...recentDefiActions.filter((item) => failedStatus(item.status)).map((item) => ({
      id: item.id,
      type: item.type,
      protocol: item.protocol,
      status: item.status,
      reason: item.failureReason || item.reason || item.lastExecutionError || null,
      at: item.failedAt || item.completedAt || item.createdAt
    })),
    ...(memory.recentFailures || [])
  ].slice(0, MAX_RECENT_FAILURES);

  return {
    ok: Boolean(profile),
    handle: normalizedHandle,
    riskProfile: memory.riskProfile || "balanced",
    wallet: profile ? {
      onboarded: Boolean(profile.onboarded),
      address: profile.walletAddress || null,
      balances: profile.balances || {},
      tokenBalances: profile.tokenBalances || {},
      rails: (profile.wallets || []).map((wallet) => ({
        rail: wallet.rail,
        address: wallet.address,
        hasWallet: Boolean(wallet.id && wallet.address)
      }))
    } : null,
    capabilities: capabilities?.capabilities || null,
    portfolio: portfolio ? {
      totalValueUsd: portfolio.totalValueUsd,
      exposure: portfolio.exposure,
      perps: portfolio.perps,
      pending: portfolio.pending,
      strategy: portfolio.strategy,
      risk: portfolio.risk
    } : null,
    memory,
    recent: {
      defiActions: summarizeRecentActions(recentDefiActions),
      payments: summarizeRecentPayments(recentPayments),
      approvals: recentApprovals.map((approval) => ({
        id: approval.id,
        kind: approval.kind,
        status: approval.status,
        targetId: approval.targetId,
        risk: approval.risk
      })),
      perpProposals: recentPerps.map((proposal) => ({
        id: proposal.id,
        symbol: proposal.symbol,
        side: proposal.side,
        status: proposal.status,
        riskScore: proposal.risk?.riskScore || null
      })),
      failures: recentFailures
    },
    currentIntent: {
      action: planned?.intent?.action || null,
      tool: planned?.plan?.tool || null,
      risk: planned?.plan?.risk || "unknown"
    }
  };
}

export function buildAgentMemoryReport({ handle = "@sara", limit = 8 } = {}) {
  const normalizedHandle = normalizeHandleLocal(handle);
  const profile = safe(() => getWalletProfile(normalizedHandle), null);
  const memory = getAgentMemory(normalizedHandle);
  const max = Math.max(1, Math.min(Number(limit) || 8, 25));
  const defiActions = recentForHandle(ledger.defiActions, normalizedHandle, max);
  const payments = recentForHandle(ledger.payments, normalizedHandle, max, (item) => (
    item.senderHandle === normalizedHandle || item.recipientHandle === normalizedHandle
  ));
  const approvals = recentForHandle(ledger.approvals, normalizedHandle, max);
  const perpProposals = recentForHandle(ledger.perpProposals, normalizedHandle, max);
  const automations = recentForHandle(ledger.automations, normalizedHandle, max);
  const openPerps = perpProposals.filter((proposal) => (
    proposal.positionId && ["submitted", "settled", "open"].includes(String(proposal.status || "").toLowerCase())
  ));
  const pendingActions = [
    ...approvals.filter((approval) => approval.status === "pending").map((approval) => ({
      kind: "approval",
      id: approval.id,
      targetId: approval.targetId,
      status: approval.status,
      label: approval.title || approval.kind
    })),
    ...defiActions.filter((action) => ["quoted", "confirmed", "submitted"].includes(String(action.status || "").toLowerCase())).map((action) => ({
      kind: action.type,
      id: action.id,
      status: action.status,
      label: describeDefiAction(action)
    })),
    ...automations.filter((automation) => automation.status === "active").map((automation) => ({
      kind: "automation",
      id: automation.id,
      status: automation.status,
      label: automation.name || automation.payload?.text || automation.kind,
      runs: automation.maxRuns ? `${automation.runCount || 0}/${automation.maxRuns}` : `${automation.runCount || 0}`
    }))
  ].slice(0, max);
  const lastTrade = deriveLastTrade({ memory, defiActions, perpProposals });
  const failures = [
    ...defiActions.filter((action) => failedStatus(action.status)).map((action) => ({
      id: action.id,
      kind: action.type,
      status: action.status,
      reason: action.failureReason || action.reason || action.lastExecutionError || null,
      at: action.failedAt || action.completedAt || action.createdAt || null
    })),
    ...perpProposals.filter((proposal) => failedStatus(proposal.status)).map((proposal) => ({
      id: proposal.id,
      kind: "perp",
      status: proposal.status,
      reason: proposal.failureReason || proposal.execution?.reason || null,
      at: proposal.executedAt || proposal.confirmedAt || proposal.createdAt || null
    })),
    ...(memory.recentFailures || [])
  ].slice(0, max);

  return {
    ok: Boolean(profile),
    handle: normalizedHandle,
    wallet: profile ? {
      address: profile.walletAddress || null,
      onboarded: Boolean(profile.onboarded),
      totalBalanceUsd: profile.balance || 0,
      rails: profile.wallets || []
    } : null,
    summary: summarizeMemory({ lastTrade, pendingActions, openPerps, failures, automations }),
    memory: {
      riskProfile: memory.riskProfile || "balanced",
      lastAction: memory.lastAction || null,
      lastTrade,
      recentDecisions: memory.recentDecisions || [],
      recentFailures: failures
    },
    recent: {
      trades: [
        ...summarizeRecentActions(defiActions),
        ...perpProposals.map((proposal) => ({
          id: proposal.id,
          type: "perp",
          status: proposal.status,
          symbol: proposal.symbol,
          side: proposal.side,
          collateralUsd: proposal.collateralUsd,
          leverage: proposal.leverage,
          positionId: proposal.positionId || null,
          txHash: proposal.txHash || proposal.execution?.txHash || null,
          reason: proposal.failureReason || proposal.execution?.reason || null
        }))
      ].slice(0, max),
      payments: summarizeRecentPayments(payments),
      approvals: approvals.map((approval) => ({
        id: approval.id,
        kind: approval.kind,
        status: approval.status,
        targetId: approval.targetId,
        title: approval.title,
        risk: approval.risk
      })),
      automations: automations.map((automation) => ({
        id: automation.id,
        name: automation.name,
        kind: automation.kind,
        status: automation.status,
        intervalMs: automation.intervalMs,
        maxRuns: automation.maxRuns || null,
        runCount: automation.runCount || 0,
        lastRunAt: automation.lastRunAt || null,
        nextRunAt: automation.nextRunAt || null,
        lastResult: automation.lastResult ? {
          status: automation.lastResult.status || (automation.lastResult.ok === false ? "failed" : "ok"),
          txHash: automation.lastResult.txHash || automation.lastResult.execution?.txHash || null,
          reason: automation.lastResult.reason || automation.lastResult.error || automation.lastError || null
        } : null
      })),
      openPerps,
      pendingActions,
      failures
    },
    nextAction: pendingActions.length ? "ask_about_pending_action_or_continue_monitoring" : "ready_for_next_instruction"
  };
}

export function buildAgentDecision({ planned, result = {}, execution = {}, state = null } = {}) {
  const status = String(execution.status || result.status || "").toLowerCase();
  const ok = execution.ok !== false && result.ok !== false && !failedStatus(status);
  const stance = decideStance({ planned, result, execution, status, ok });
  const objective = describeObjective(planned);
  const checks = buildChecks({ planned, result, execution, state });
  const warnings = buildWarnings({ planned, result, execution, state, status });
  const confidence = decisionConfidence({ planned, result, execution, warnings });
  const rationale = decisionRationale({ planned, result, execution, status, ok, warnings });

  return {
    id: `decision_${Date.now().toString(36)}`,
    mode: "arc_trading_agent",
    stance,
    objective,
    riskLevel: planned?.plan?.risk || "unknown",
    confidence,
    checks,
    warnings,
    rationale,
    nextAction: execution.nextAction || result.nextAction || planned?.nextAction || "review_result"
  };
}

export function rememberAgentExecution({ handle, planned, result = {}, execution = {}, decision = {} } = {}) {
  const memory = getAgentMemory(handle);
  const now = new Date().toISOString();
  const actionId = execution.ids?.actionId || result.action?.id || result.receipt?.action?.id || null;
  const paymentId = execution.ids?.paymentId || result.payment?.id || null;
  const proposalId = execution.ids?.proposalId || result.proposal?.id || null;
  const positionId = execution.ids?.positionId || result.positionId || result.position?.id || null;
  const status = execution.status || result.status || result.action?.status || result.payment?.status || "unknown";

  memory.lastAction = {
    at: now,
    text: planned?.text || null,
    tool: planned?.plan?.tool || null,
    intent: planned?.intent?.action || null,
    status,
    actionId,
    paymentId,
    proposalId,
    positionId,
    txHash: execution.txHash || result.txHash || null,
    reason: execution.reason || result.reason || result.error || null
  };

  if (["quote_defi_route", "propose_perp_trade", "close_arc_perp_user_position"].includes(planned?.plan?.tool)) {
    memory.lastTrade = {
      ...memory.lastAction,
      symbol: planned?.plan?.arguments?.symbol || planned?.intent?.symbol || null,
      side: planned?.plan?.arguments?.side || planned?.intent?.side || null,
      fromToken: planned?.plan?.arguments?.fromToken || planned?.intent?.fromToken || null,
      toToken: planned?.plan?.arguments?.toToken || planned?.intent?.toToken || null
    };
  }

  memory.recentDecisions = [
    {
      at: now,
      id: decision.id,
      stance: decision.stance,
      objective: decision.objective,
      status,
      nextAction: decision.nextAction,
      actionId,
      txHash: execution.txHash || null
    },
    ...(memory.recentDecisions || [])
  ].slice(0, MAX_RECENT_DECISIONS);

  if (execution.ok === false || result.ok === false || failedStatus(status)) {
    memory.recentFailures = [
      {
        at: now,
        tool: planned?.plan?.tool || null,
        status,
        reason: execution.reason || result.reason || result.error || result.action?.failureReason || "Action failed",
        actionId
      },
      ...(memory.recentFailures || [])
    ].slice(0, MAX_RECENT_FAILURES);
  }

  return memory;
}

export function getAgentMemory(handle) {
  const user = users.get(handle);
  if (!user) {
    return {
      riskProfile: "balanced",
      recentDecisions: [],
      recentFailures: []
    };
  }

  user.agentMemory ||= {
    riskProfile: user.policy?.riskProfile || "balanced",
    recentDecisions: [],
    recentFailures: []
  };

  return user.agentMemory;
}

function buildChecks({ planned, result, execution, state }) {
  const walletReady = Boolean(state?.wallet?.onboarded);
  const checks = [
    check("wallet", walletReady, walletReady ? "Wallet is connected." : "Wallet is not connected."),
    check("signer", planned?.signer?.backendSignerAllowed === false, "Backend signer is not used for this user action."),
    check("policy", planned?.policy?.backendSignerAllowed === false, planned?.policy?.reason || planned?.plan?.reason || "Policy checked."),
  ];

  if (planned?.plan?.tool === "quote_defi_route") {
    checks.push(check("route", result.ok !== false, result.ok === false ? result.reason || result.error || "No route returned." : "Route provider returned a decision."));
  }

  if (state?.portfolio) {
    checks.push(check(
      "portfolio",
      state.portfolio.risk?.level === "high" ? null : true,
      `Portfolio value US$${state.portfolio.totalValueUsd || 0}; risk ${state.portfolio.risk?.level || "unknown"}.`
    ));
  }

  const simulation = result.simulation || result.action?.simulation;
  if (simulation) {
    checks.push(check(
      "trade_simulation",
      simulation.ok !== false,
      simulation.ok === false
        ? simulation.blockers?.[0] || "Trade simulation blocked execution."
        : simulation.recommendation || "Trade simulation passed."
    ));
    if (simulation.sourceBalance?.known) {
      checks.push(check(
        "source_balance",
        Number(simulation.sourceBalance.amount || 0) >= Number(simulation.requiredSourceAmount || 0),
        `${simulation.sourceBalance.amount} ${simulation.sourceBalance.token} available; about ${simulation.requiredSourceAmount} required.`
      ));
    }
  }

  const market = result.marketIntelligence || result.action?.marketIntelligence || result.receipt?.marketIntelligence || result.marketGuard?.market;
  if (market) {
    const marketStatus = `${market.status || ""} ${market.regime?.status || ""}`.toLowerCase();
    const ok = !/\b(route_degraded|low_liquidity|high_fee|risk_off)\b/.test(marketStatus);
    checks.push(check(
      "market_intelligence",
      ok ? true : null,
      market.reason || market.regime?.reason || market.recommendation || "Market intelligence checked."
    ));
  }

  const mandateCheck = result.mandateCheck || result.action?.mandateCheck || result.proposal?.mandateCheck;
  if (mandateCheck) {
    checks.push(check(
      "mandates",
      mandateCheck.approved,
      mandateCheck.approved
        ? mandateCheck.reason || "Standing mandates passed."
        : mandateCheck.violations?.[0]?.reason || mandateCheck.reason || "Standing mandate blocked execution."
    ));
  }

  const feeds = result.feeds || result.marketFeed || result.marketIntelligence?.feeds || result.action?.marketIntelligence?.feed;
  if (feeds) {
    const feedStatus = feeds.freshness?.status || feeds.regime?.status || "unknown";
    checks.push(check(
      "market_feeds",
      feedStatus === "fresh" || feedStatus === "reference" ? true : null,
      feeds.freshness?.reason || feeds.regime?.reason || `Market feed status: ${feedStatus}.`
    ));
  }

  if (execution.txHash) {
    checks.push(check("settlement", true, `On-chain tx available: ${execution.txHash}`));
  } else if (["submitted", "confirmed"].includes(String(execution.status || result.action?.status || "").toLowerCase())) {
    checks.push(check("settlement", null, "Execution is still being monitored."));
  }

  return checks;
}

function buildWarnings({ planned, result, execution, state, status }) {
  const warnings = [];
  const args = planned?.plan?.arguments || {};
  const amount = Number(args.amount || args.amountUsd || planned?.intent?.amount || 0);
  const tool = planned?.plan?.tool;

  if (tool === "quote_defi_route" && planned?.intent?.action === "quote_bridge" && amount > 0 && amount <= 2) {
    warnings.push("Small bridges can be uneconomical because bridge/forwarder fees can be large relative to the amount.");
  }

  const sameToolFailure = state?.recent?.failures?.find((failure) => failure.type === args.type || failure.tool === tool);
  if (sameToolFailure?.reason) {
    warnings.push(`Recent similar action failed: ${sameToolFailure.reason}`);
  }

  const reason = execution.reason || result.reason || result.error || result.action?.failureReason || result.action?.lastExecutionError;
  if (failedStatus(status) && reason) {
    warnings.push(reason);
  }

  const simulation = result.simulation || result.action?.simulation;
  if (simulation?.warnings?.length) {
    warnings.push(...simulation.warnings);
  }
  if (simulation?.blockers?.length) {
    warnings.push(...simulation.blockers);
  }

  const market = result.marketIntelligence || result.action?.marketIntelligence || result.receipt?.marketIntelligence || result.marketGuard?.market;
  if (market?.warnings?.length) {
    warnings.push(...market.warnings);
  }
  if (market?.reason && !warnings.includes(market.reason)) {
    warnings.push(market.reason);
  }

  const mandateCheck = result.mandateCheck || result.action?.mandateCheck || result.proposal?.mandateCheck;
  if (mandateCheck?.violations?.length) {
    warnings.push(...mandateCheck.violations.map((violation) => violation.reason));
  }
  if (mandateCheck?.warnings?.length) {
    warnings.push(...mandateCheck.warnings);
  }

  const feeds = result.feeds || result.marketFeed || result.marketIntelligence?.feeds || result.action?.marketIntelligence?.feed;
  if (feeds?.warnings?.length) {
    warnings.push(...feeds.warnings);
  }
  if (feeds?.regime?.status && !["risk_on", "neutral"].includes(feeds.regime.status)) {
    warnings.push(feeds.regime.reason);
  }

  if (state?.portfolio?.risk?.warnings?.length) {
    warnings.push(...state.portfolio.risk.warnings);
  }
  if (state?.portfolio?.pending?.count > 0 && ["quote_defi_route", "propose_perp_trade", "send_usdc"].includes(tool)) {
    warnings.push(`${state.portfolio.pending.count} pending portfolio action(s) are still waiting for final status.`);
  }

  return Array.from(new Set(warnings)).slice(0, 5);
}

function decisionRationale({ planned, result, execution, status, ok, warnings }) {
  if (!ok) {
    return execution.reason || result.reason || result.error || result.action?.failureReason || "The action failed a policy, route, wallet, or execution check.";
  }
  if (execution.txHash) return "The requested action reached on-chain execution and returned a transaction hash.";
  if (result.simulation?.blockers?.length) return result.simulation.blockers[0];
  if (result.simulation?.warnings?.length) return `The route exists, but the trade-quality check found: ${result.simulation.warnings[0]}`;
  if (result.marketGuard?.paused) return result.marketGuard.reason;
  if (result.marketIntelligence?.recommendation && result.marketIntelligence.recommendation !== "route_acceptable") {
    return `Market intelligence recommends ${result.marketIntelligence.recommendation}: ${result.marketIntelligence.reason || result.marketIntelligence.regime?.reason || "route quality changed"}`;
  }
  if (status === "confirmed") return "The route was accepted and queued; the agent is monitoring execution.";
  if (status === "submitted") return "The transaction was submitted and still needs settlement confirmation.";
  if (warnings.length) return "The action is possible, but the agent found trade-quality warnings.";
  return planned?.plan?.reason || "The action passed wallet, policy, and signer checks.";
}

function decisionConfidence({ planned, result, execution, warnings }) {
  if (execution.ok === false || result.ok === false) return "low";
  if (execution.txHash) return "high";
  if (warnings.length) return "medium";
  if (String(planned?.parser || "").includes("model")) return "medium";
  return "high";
}

function decideStance({ planned, result, execution, status, ok }) {
  if (!planned?.plan?.tool) return "clarify";
  if (!ok) return "refuse_or_failed";
  if (status === "requires_confirmation") return "needs_approval";
  if (["confirmed", "submitted"].includes(status)) return "monitor";
  if (execution.txHash || status === "settled") return "executed";
  if (planned.plan.tool === "quote_defi_route") return "trade_decision";
  return "inform";
}

function describeObjective(planned) {
  const intent = planned?.intent || {};
  if (intent.action === "quote_swap") return `Swap ${intent.amount || "some"} ${intent.fromToken || "USDC"} to ${intent.toToken || "target asset"} on ${intent.settlementRail || intent.fromRail || "Arc"}.`;
  if (intent.action === "quote_bridge") return `Bridge ${intent.amount || "some"} ${intent.fromToken || intent.asset || "USDC"} from ${intent.fromRail || "Arc"} to ${intent.toRail || "destination rail"}.`;
  if (intent.action === "propose_perp_trade") return `Prepare a ${intent.side || ""} ${intent.symbol || "perp"} trade with risk controls.`;
  if (intent.action === "send_payment") return `Send ${intent.amount || "some"} USDC to ${intent.recipientHandle || "recipient"}.`;
  return planned?.plan?.tool ? `Run ${planned.plan.tool}.` : "Clarify the user's trading intent.";
}

function summarizeRecentActions(actions) {
  return actions.map((action) => ({
    id: action.id,
    type: action.type,
    protocol: action.protocol,
    status: action.status,
    fromRail: action.request?.fromRail,
    toRail: action.request?.toRail,
    fromToken: action.request?.fromToken,
    toToken: action.request?.toToken,
    amount: action.request?.amount || action.request?.amountUsd,
    reason: action.failureReason || action.reason || action.lastExecutionError || null
  }));
}

function summarizeRecentPayments(payments) {
  return payments.map((payment) => ({
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    settlementRail: payment.settlementRail,
    senderHandle: payment.senderHandle,
    recipientHandle: payment.recipientHandle
  }));
}

function recentForHandle(rows = [], handle, limit, predicate) {
  return rows
    .filter((row) => predicate ? predicate(row) : row.handle === handle)
    .slice()
    .reverse()
    .slice(0, limit);
}

function failedStatus(status) {
  return ["failed", "rejected", "quote_unavailable", "execution_not_enabled", "wallet_not_found", "position_not_found"].includes(String(status || "").toLowerCase());
}

function deriveLastTrade({ memory, defiActions, perpProposals }) {
  const candidates = [
    ...defiActions.map((action) => ({
      at: action.completedAt || action.confirmedAt || action.createdAt || "",
      id: action.id,
      type: action.type,
      status: action.status,
      fromToken: action.request?.fromToken,
      toToken: action.request?.toToken,
      amount: action.request?.amount || action.request?.amountUsd,
      txHash: action.txHash || action.execution?.txHash || null,
      reason: action.failureReason || action.reason || action.lastExecutionError || null
    })),
    ...perpProposals.map((proposal) => ({
      at: proposal.executedAt || proposal.confirmedAt || proposal.createdAt || "",
      id: proposal.id,
      type: "perp",
      status: proposal.status,
      symbol: proposal.symbol,
      side: proposal.side,
      amount: proposal.collateralUsd,
      leverage: proposal.leverage,
      positionId: proposal.positionId || null,
      txHash: proposal.txHash || proposal.execution?.txHash || null,
      reason: proposal.failureReason || proposal.execution?.reason || null
    })),
    memory.lastTrade ? { ...memory.lastTrade, at: memory.lastTrade.at || "" } : null
  ].filter(Boolean);
  candidates.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());
  return candidates[0] || null;
}

function summarizeMemory({ lastTrade, pendingActions, openPerps, failures, automations }) {
  if (lastTrade) {
    return `Last trade: ${lastTrade.type || lastTrade.tool} ${lastTrade.status || "unknown"}${lastTrade.txHash ? " with an on-chain transaction." : "."}`;
  }
  if (pendingActions.length) {
    return `There are ${pendingActions.length} pending action(s) to watch or approve.`;
  }
  if (openPerps.length) {
    return `There are ${openPerps.length} recent open perp position(s) in memory.`;
  }
  if (failures.length) {
    return `No recent successful trade found. Last issue: ${failures[0].reason || failures[0].status}.`;
  }
  const activeAutomations = automations.filter((automation) => automation.status === "active").length;
  if (activeAutomations) {
    return `${activeAutomations} automation(s) are active.`;
  }
  return "No recent trading activity is recorded for this wallet yet.";
}

function describeDefiAction(action) {
  const req = action.request || {};
  if (action.type === "bridge") return `Bridge ${req.amount || req.amountUsd || "some"} ${req.fromToken || "USDC"} from ${req.fromRail || "Arc"} to ${req.toRail || "destination"}`;
  if (action.type === "swap") return `Swap ${req.amount || req.amountUsd || "some"} ${req.fromToken || "USDC"} to ${req.toToken || "token"}`;
  return action.type || "DeFi action";
}

function normalizeHandleLocal(handle) {
  const value = String(handle || "").trim().toLowerCase();
  return value.startsWith("@") ? value : `@${value}`;
}

function check(name, ok, message) {
  return {
    name,
    ok,
    message
  };
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
