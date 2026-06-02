import { ledger } from "./fixtures.js";
import { createApproval } from "./approvals.js";
import { normalizeHandle, resolveXHandle } from "./identity.js";
import { nextDefiActionId, nextEventId } from "./ids.js";
import { evaluateDefiPolicy } from "./defiPolicy.js";
import { getLifiQuote } from "./lifiAdapter.js";
import { quoteCircleAppKitRoute } from "./appKitCircleAdapter.js";
import { searchPolymarketMarkets } from "./polymarketAdapter.js";
import { listHyperliquidMarkets } from "./hyperliquidAdapter.js";
import { listDefiProtocols } from "./defiProtocols.js";
import { getDefiExecutionReadiness } from "./defiExecution.js";
import { getWalletProfile } from "./walletAccounts.js";
import { enqueueJob, runJob } from "./jobs.js";
import { config } from "./config.js";
import { getSettlementRail } from "./settlement.js";
import { circleUserSigner, readOnlySigner, userWalletSigningRequired } from "./signerPolicy.js";
import { buildTradeSimulation } from "./tradeRisk.js";
import {
  analyzeRouteIntelligence,
  applyRouteIntelligenceToSimulation
} from "./marketIntelligence.js";
import { evaluateMandatesForAction } from "./mandates.js";
import {
  checkRouteCapability,
  listRouteCapabilities,
  probeDefaultRoutes,
  probeRouteCapability,
  routeCapabilityForUi
} from "./routeRegistry.js";

export function listDefiTools() {
  return {
    ...listDefiProtocols(),
    execution: getDefiExecutionReadiness(),
    routeCapabilities: routeCapabilityForUi()
  };
}

export function listDefiRouteCapabilities(args = {}) {
  return listRouteCapabilities(args);
}

export async function probeDefiRouteCapability(args = {}) {
  return await probeRouteCapability(args);
}

export async function probeDefiRouteCapabilities(args = {}) {
  return await probeDefaultRoutes(args);
}

export async function quoteDefiRoute(input) {
  const user = resolveXHandle(input.handle || input.senderHandle || "@sara");
  const wallet = getWalletProfile(user.handle);
  const action = normalizeAction({
    ...input,
    handle: user.handle,
    type: input.type || (input.fromRail === input.toRail ? "swap" : "bridge"),
    protocol: config.defi.liveAdapters ? "circle-app-kit" : "lifi",
    amountUsd: Number(input.amount || input.amountUsd || 0)
  });
  let simulation = buildTradeSimulation({ user, wallet, action });
  let policy = evaluateDefiPolicy({ user, action, simulation });
  const record = createDefiAction({ user, action, policy });
  record.simulation = simulation;
  record.mandateCheck = evaluateMandatesForAction({
    handle: user.handle,
    action,
    simulation,
    type: action.type
  });

  if (!record.mandateCheck.approved) {
    record.status = "rejected";
    record.reason = record.mandateCheck.reason;
    attachMarketIntelligence({ user, record });
    record.completedAt = new Date().toISOString();
    recordEvent("defi_action_rejected_by_mandate", record);
    return {
      ok: false,
      action: record,
      policy,
      simulation: record.simulation,
      mandateCheck: record.mandateCheck,
      marketIntelligence: record.marketIntelligence,
      reason: record.mandateCheck.reason,
      nextAction: "review_mandates"
    };
  }

  if (!policy.approved) {
    record.status = "rejected";
    record.reason = policy.reason;
    attachMarketIntelligence({ user, record });
    record.completedAt = new Date().toISOString();
    recordEvent("defi_action_rejected", record);
    return { ok: false, action: record, policy, simulation: record.simulation, marketIntelligence: record.marketIntelligence, reason: policy.reason, nextAction: "adjust_trade_or_fund_wallet" };
  }

  const routeCapability = checkRouteCapability(action);
  record.routeCapability = routeCapability.route || {
    status: routeCapability.status,
    descriptor: routeCapability.descriptor
  };
  if (!routeCapability.ok) {
    record.status = "quote_unavailable";
    record.reason = routeCapability.reason;
    record.suggestions = routeCapability.suggestions;
    record.signer = userWalletSigningRequired({
      operation: record.type,
      settlementRail: action.fromRail,
      reason: "No live route is registered for this user action."
    });
    record.completedAt = new Date().toISOString();
    attachMarketIntelligence({ user, record });
    recordEvent("defi_action_route_capability_unavailable", record);
    return {
      ok: false,
      action: record,
      policy,
      simulation: record.simulation,
      routeCapability,
      marketIntelligence: record.marketIntelligence,
      reason: routeCapability.reason,
      suggestions: routeCapability.suggestions,
      nextAction: routeCapability.nextAction || "choose_supported_route"
    };
  }

  const fromAddress = input.fromAddress || walletForRail(wallet, action.fromRail)?.address || wallet.walletAddress;
  const toAddress = input.toAddress || walletForRail(wallet, action.toRail)?.address || fromAddress;
  let quote;
  try {
    quote = await getPreferredRouteQuote({ input: action, fromAddress, toAddress });
    record.protocol = quote.provider;
  } catch (error) {
    const routeHelp = buildRouteUnavailableHelp({ action, error });
    record.simulation = buildTradeSimulation({ user, wallet, action, providerError: error });
    record.status = "quote_unavailable";
    record.reason = routeHelp.reason;
    record.suggestions = routeHelp.suggestions;
    record.signer = userWalletSigningRequired({
      operation: record.type,
      settlementRail: action.fromRail,
      reason: "No executable route was returned by the live quote provider."
    });
    record.completedAt = new Date().toISOString();
    attachMarketIntelligence({ user, record });
    recordEvent("defi_action_quote_unavailable", record);
    return {
      ok: false,
      action: record,
      policy,
      simulation: record.simulation,
      marketIntelligence: record.marketIntelligence,
      reason: routeHelp.reason,
      providerError: error.message,
      suggestions: routeHelp.suggestions,
      nextAction: "choose_supported_route"
    };
  }

  const executionReadiness = getDefiExecutionReadiness();
  simulation = buildTradeSimulation({ user, wallet, action, quote });
  policy = evaluateDefiPolicy({ user, action, simulation });
  record.policy = policy;
  record.simulation = simulation;
  record.quote = quote;
  record.routeCapability = routeCapability.route || record.routeCapability;
  record.mandateCheck = evaluateMandatesForAction({
    handle: user.handle,
    action,
    simulation,
    quote,
    type: action.type
  });
  if (!record.mandateCheck.approved) {
    record.status = "rejected";
    record.reason = record.mandateCheck.reason;
    attachMarketIntelligence({ user, record });
    record.completedAt = new Date().toISOString();
    recordEvent("defi_action_rejected_by_mandate_after_quote", record);
    return {
      ok: false,
      action: record,
      policy,
      quote,
      simulation: record.simulation,
      mandateCheck: record.mandateCheck,
      marketIntelligence: record.marketIntelligence,
      reason: record.mandateCheck.reason,
      nextAction: "review_mandates"
    };
  }
  if (!policy.approved) {
    record.status = "rejected";
    record.reason = policy.reason;
    attachMarketIntelligence({ user, record });
    record.completedAt = new Date().toISOString();
    recordEvent("defi_action_rejected_after_simulation", record);
    return {
      ok: false,
      action: record,
      policy,
      quote,
      simulation: record.simulation,
      marketIntelligence: record.marketIntelligence,
      reason: policy.reason,
      nextAction: "adjust_trade_or_fund_wallet"
    };
  }

  record.status = policy.requiresConfirmation ? "requires_confirmation" : "quoted";
  record.executionReadiness = executionReadiness;
  record.signer = executionReadiness.ready
    ? circleUserSigner({
      operation: record.type,
      settlementRail: action.fromRail,
      executionStatus: quote.executable ? "configured" : "quote_not_executable"
    })
    : userWalletSigningRequired({
      operation: record.type,
      settlementRail: action.fromRail,
      reason: executionReadiness.blockers.join("; ")
    });
  record.completedAt = new Date().toISOString();
  attachMarketIntelligence({ user, record });
  if (policy.requiresConfirmation) {
    const approval = createApproval({
      handle: user.handle,
      kind: "defi_action",
      targetId: record.id,
      title: `${record.type} ${action.amountUsd} ${action.fromToken || "USDC"} via ${record.protocol}`,
      summary: `Agent produced a ${record.type} quote. Confirm before execution handoff.`,
      risk: "high",
      metadata: {
        protocol: record.protocol,
        type: record.type,
        fromRail: action.fromRail,
        toRail: action.toRail,
        amount: action.amountUsd,
        slippage: action.slippage
      }
    });
    record.approvalId = approval.id;
  }
  recordEvent("defi_action_quoted", record);

  if (!policy.requiresConfirmation && ["bridge", "swap"].includes(record.type)) {
    const execution = input.fast
      ? queueDefiActionExecution(record, { mode: "queued_fast" })
      : await autoExecuteDefiAction(record);
    return {
      ok: true,
      action: record,
      policy,
      quote,
      simulation: record.simulation,
      marketIntelligence: record.marketIntelligence,
      execution,
      fast: Boolean(input.fast),
      nextAction: input.fast
        ? "execution_queued"
        : execution.result?.execution?.status === "submitted" || record.status === "submitted"
        ? "reconcile_defi_action"
        : "display_receipt"
    };
  }

  return {
    ok: true,
    action: record,
    policy,
    quote,
    simulation: record.simulation,
    marketIntelligence: record.marketIntelligence,
    nextAction: policy.requiresConfirmation ? "confirm_defi_action" : "display_quote"
  };
}

function attachMarketIntelligence({ user, record }) {
  const intelligence = analyzeRouteIntelligence({
    handle: user.handle,
    action: record.request,
    simulation: record.simulation
  });
  record.marketIntelligence = intelligence;
  record.simulation = applyRouteIntelligenceToSimulation(record.simulation, intelligence);
  return intelligence;
}

async function autoExecuteDefiAction(action) {
  action.status = "confirmed";
  action.confirmedAt = new Date().toISOString();
  action.nextAction = "execute_defi_action";
  recordEvent("defi_action_auto_confirmed", action);
  const queued = queueDefiActionExecution(action);
  const job = queued.job;
  return await runJob({ jobId: job.id });
}

function queueDefiActionExecution(action, { mode = "queued" } = {}) {
  action.status = "confirmed";
  action.confirmedAt ||= new Date().toISOString();
  action.nextAction = "execute_defi_action";
  recordEvent("defi_action_execution_queued", action);
  const job = enqueueJob({
    type: "execute_defi_action",
    payload: { actionId: action.id },
    idempotencyKey: `execute_defi_action:${action.id}`
  });
  action.executionJobId = job.id;
  return {
    ok: true,
    mode,
    job,
    nextAction: "run_execution_worker"
  };
}

export async function searchPredictionMarkets({ handle = "@sara", query, limit } = {}) {
  const user = resolveXHandle(handle);
  const action = normalizeAction({
    handle: user.handle,
    type: "polymarket_search",
    protocol: "polymarket",
    query,
    amountUsd: 0
  });
  const policy = evaluateDefiPolicy({ user, action });
  const record = createDefiAction({ user, action, policy });

  if (!policy.approved) {
    record.status = "rejected";
    record.reason = policy.reason;
    record.completedAt = new Date().toISOString();
    recordEvent("defi_action_rejected", record);
    return { ok: false, action: record, policy };
  }

  const result = await searchPolymarketMarkets({ query, limit });
  record.status = "completed";
  record.result = result;
  record.signer = readOnlySigner({ operation: "polymarket_search" });
  record.completedAt = new Date().toISOString();
  recordEvent("defi_action_completed", record);
  return { ok: true, action: record, ...result };
}

export async function listPerpMarkets({ handle = "@sara", limit } = {}) {
  const user = resolveXHandle(handle);
  const action = normalizeAction({
    handle: user.handle,
    type: "hyperliquid_markets",
    protocol: "hyperliquid",
    amountUsd: 0
  });
  const policy = evaluateDefiPolicy({ user, action });
  const record = createDefiAction({ user, action, policy });

  if (!policy.approved) {
    record.status = "rejected";
    record.reason = policy.reason;
    record.completedAt = new Date().toISOString();
    recordEvent("defi_action_rejected", record);
    return { ok: false, action: record, policy };
  }

  const result = await listHyperliquidMarkets({ limit });
  record.status = "completed";
  record.result = result;
  record.signer = readOnlySigner({ operation: "hyperliquid_markets" });
  record.completedAt = new Date().toISOString();
  recordEvent("defi_action_completed", record);
  return { ok: true, action: record, ...result };
}

export function listDefiActions({ handle, status, limit = 50 } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const actions = ledger.defiActions
    .filter((action) => (
      (!normalized || action.handle === normalized)
      && (!status || action.status === status)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 50);

  return { ok: true, actions };
}

export function getDefiActionReceipt({ actionId, host, protocol = "http" } = {}) {
  const action = ledger.defiActions.find((item) => item.id === actionId);
  if (!action) {
    throw new Error("DeFi action not found");
  }

  const executionJob = action.executionJobId
    ? ledger.jobs.find((job) => job.id === action.executionJobId) || null
    : null;
  const receiptAction = actionForReceipt(action, executionJob);
  const events = ledger.events.filter((event) => event.defiActionId === action.id);
  const approval = action.approvalId
    ? ledger.approvals.find((item) => item.id === action.approvalId) || null
    : null;
  const txHash = receiptAction.txHash || receiptAction.execution?.txHash || null;
  const rail = safeRail(receiptAction.request?.fromRail);

  return {
    ok: true,
    receipt: {
      action: receiptAction,
      approval,
      execution: receiptAction.execution || null,
      executionJob: executionJob ? publicJobSnapshot(executionJob) : null,
      simulation: receiptAction.simulation || null,
      marketIntelligence: receiptAction.marketIntelligence || null,
      txHash,
      explorerUrl: txHash && rail?.explorerBaseUrl ? `${rail.explorerBaseUrl}${txHash}` : null,
      publicUrl: host ? `${protocol}://${host}/defi/actions/${action.id}` : null,
      timeline: buildDefiTimeline(receiptAction, events),
      nextAction: nextActionForDefiAction(receiptAction)
    }
  };
}

function actionForReceipt(action, executionJob) {
  if (!executionJob) return action;

  if (action.status === "confirmed" && executionJob.status === "failed") {
    return {
      ...action,
      status: "failed",
      failedAt: executionJob.updatedAt,
      failureReason: executionJob.lastError || action.failureReason || "Execution job failed",
      execution: {
        ...(action.execution || {}),
        ok: false,
        status: "failed",
        provider: action.protocol || action.execution?.provider || "unknown",
        mode: action.execution?.mode || "real",
        backendSignerAllowed: false,
        reason: executionJob.lastError || action.failureReason || "Execution job failed",
        jobId: executionJob.id,
        attempts: executionJob.attempts
      }
    };
  }

  if (action.status === "confirmed" && executionJob.lastError) {
    return {
      ...action,
      lastExecutionError: executionJob.lastError,
      lastExecutionAttemptAt: executionJob.updatedAt,
      nextAction: executionJob.status === "queued" ? "retry_execution_worker" : action.nextAction
    };
  }

  return action;
}

function publicJobSnapshot(job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: job.runAfter,
    lastError: job.lastError,
    updatedAt: job.updatedAt
  };
}

export async function confirmDefiAction({ actionId, handle } = {}) {
  const action = ledger.defiActions.find((item) => item.id === actionId);
  if (!action) {
    throw new Error("DeFi action not found");
  }

  if (handle && action.handle !== normalizeHandle(handle)) {
    throw new Error("DeFi action does not belong to this handle");
  }

  if (["confirmed", "execution_not_enabled", "submitted", "settled"].includes(action.status)) {
    return { ok: true, action, skipped: true };
  }

  if (action.status !== "requires_confirmation" && action.status !== "quoted") {
    throw new Error(`DeFi action cannot be confirmed from status: ${action.status}`);
  }

  if (!action.policy?.approved) {
    throw new Error(action.policy?.reason || "DeFi action policy rejected");
  }

  action.status = "confirmed";
  action.confirmedAt = new Date().toISOString();
  action.signer ||= userWalletSigningRequired({
    operation: action.type,
    settlementRail: action.request?.fromRail,
    reason: "Confirmed DeFi action is waiting for a user-owned signing adapter."
  });
  const job = enqueueJob({
    type: "execute_defi_action",
    payload: { actionId: action.id },
    idempotencyKey: `execute_defi_action:${action.id}`
  });
  action.executionJobId = job.id;
  action.nextAction = "execution_provider_pending";
  recordEvent("defi_action_confirmed", action);

  return {
    ok: true,
    action,
    job,
    nextAction: "execution_provider_pending"
  };
}

function createDefiAction({ user, action, policy }) {
  const record = {
    id: nextDefiActionId(),
    handle: user.handle,
    type: action.type,
    protocol: action.protocol,
    status: "created",
    request: action,
    policy,
    createdAt: new Date().toISOString()
  };
  ledger.defiActions.push(record);
  recordEvent("defi_action_created", record);
  return record;
}

function buildRouteUnavailableHelp({ action, error }) {
  const pair = `${action.fromToken || "USDC"} -> ${action.toToken || "USDC"}`;
  const route = action.type === "bridge"
    ? `${action.fromRail} -> ${action.toRail}`
    : action.fromRail;
  const providerReason = error?.message || "No provider returned a route";
  const suggestions = action.type === "swap"
    ? [
      "Try a token contract address for a pair with known Arc liquidity.",
      "Try a larger test amount; some providers reject tiny routes.",
      "Use bridge 1 USDC from arc to base if you need a currently proven live route."
    ]
    : [
      "Try bridge 1 USDC from arc to base.",
      "Check that both source and destination wallets are funded and supported."
    ];

  return {
    reason: `No live ${action.type} route is currently available for ${pair} on ${route}. Provider details: ${providerReason}`,
    suggestions
  };
}

function normalizeAction(action) {
  const fromRail = action.fromRail || action.settlementRail || "arc-testnet";
  const toRail = action.toRail || (action.type === "swap" ? fromRail : "base-sepolia");
  const fromToken = normalizeRouteToken(action.fromToken || "USDC");
  return {
    ...action,
    fromRail,
    toRail,
    amountUsd: Number(action.amountUsd || action.amount || 0),
    fromToken,
    toToken: normalizeRouteToken(action.toToken || (action.type === "swap" ? "EURC" : fromToken)),
    slippage: action.slippage === undefined ? undefined : Number(action.slippage)
  };
}

function normalizeRouteToken(token) {
  const raw = String(token || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(raw)) return raw;
  const value = raw.toUpperCase();
  if (value === "ETH") return "WETH";
  if (value === "CIRBTC") return "cirBTC";
  return value;
}

async function getPreferredRouteQuote({ input, fromAddress, toAddress }) {
  const shouldPreferAppKit = config.defi.liveAdapters && input.protocol !== "lifi" && supportsCircleAppKitRoute(input);
  if (shouldPreferAppKit) {
    const appKitSkipReason = circleAppKitSkipReason(input);
    if (appKitSkipReason) {
      try {
        const lifi = await getLifiRouteQuote({ input, fromAddress, toAddress });
        return {
          ...lifi,
          fallback: {
            attemptedProvider: "circle-app-kit",
            reason: appKitSkipReason
          }
        };
      } catch (lifiError) {
        throw new Error(`LI.FI fallback: ${lifiError.message}; Circle AppKit: ${appKitSkipReason}`);
      }
    }

    try {
      return await quoteCircleAppKitRoute({
        ...input,
        fromAddress,
        toAddress,
        recipientAddress: toAddress
      });
    } catch (appKitError) {
      try {
        const lifi = await getLifiRouteQuote({ input, fromAddress, toAddress });
        return {
          ...lifi,
          fallback: {
            attemptedProvider: "circle-app-kit",
            reason: appKitError.message
          }
        };
      } catch (lifiError) {
        throw new Error(`AppKit: ${appKitError.message}; LI.FI fallback: ${lifiError.message}`);
      }
    }
  }

  return getLifiRouteQuote({ input, fromAddress, toAddress });
}

function supportsCircleAppKitRoute(input) {
  if (input.type !== "bridge") return true;
  const fromToken = canonicalTokenKey(input.fromToken || "USDC");
  const toToken = canonicalTokenKey(input.toToken || fromToken);
  return fromToken === "USDC" && toToken === "USDC";
}

function circleAppKitSkipReason(input) {
  if (input.type === "swap" && !config.appKit.kitKey) {
    return "Circle AppKit swaps require APPKIT_KIT_KEY=KIT_KEY:<keyId>:<keySecret>. Add a Circle Kit Key to enable the AppKit swap provider.";
  }
  return null;
}

function canonicalTokenKey(token) {
  return String(token || "").toUpperCase();
}

async function getLifiRouteQuote({ input, fromAddress, toAddress }) {
  if (!fromAddress) {
    throw new Error(`No Circle wallet address found for ${input.handle || "this user"} on ${input.fromRail}`);
  }

  return await getLifiQuote({
    fromRail: input.fromRail,
    toRail: input.toRail,
    fromToken: input.fromToken || "USDC",
    toToken: input.toToken || "USDC",
    amount: input.amount,
    fromAddress,
    toAddress,
    slippage: input.slippage
  });
}

function walletForRail(wallet, rail) {
  return wallet.wallets?.find((item) => item.rail === rail);
}

function recordEvent(type, action) {
  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type,
    defiActionId: action.id,
    handle: action.handle,
    protocol: action.protocol,
    actionType: action.type,
    status: action.status
  });
}

function buildDefiTimeline(action, events) {
  const timeline = [
    { type: "created", at: action.createdAt, label: "Action created" },
    { type: "quoted", at: action.completedAt, label: "Quote created" },
    { type: "confirmed", at: action.confirmedAt, label: "User approved" },
    { type: "submitted", at: action.execution?.submissions?.[0]?.submittedAt, label: "Execution submitted" },
    { type: "reconciled", at: action.reconciledAt, label: "Provider status checked" },
    { type: "settled", at: action.settledAt, label: "Execution settled" },
    { type: "failed", at: action.failedAt, label: action.failureReason || "Execution failed" }
  ];

  for (const event of events) {
    timeline.push({ type: event.type, at: event.at, label: event.type });
  }

  return timeline
    .filter((item) => item.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

function nextActionForDefiAction(action) {
  if (action.status === "requires_confirmation") return "confirm_defi_action";
  if (action.status === "confirmed") return "run_execution_worker";
  if (action.status === "submitted") return "reconcile_defi_action";
  if (action.status === "execution_not_enabled") return "enable_live_defi_execution";
  if (action.status === "failed") return "review_failed_execution";
  return "none";
}

function safeRail(id) {
  try {
    return id ? getSettlementRail(id) : null;
  } catch {
    return null;
  }
}
