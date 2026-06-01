import { users } from "./fixtures.js";
import { normalizeHandle, resolveXHandle } from "./identity.js";
import { readOnlySigner } from "./signerPolicy.js";
import { getWalletProfile } from "./walletAccounts.js";
import { shouldPauseStrategyForMarket } from "./marketIntelligence.js";

const DEFAULT_RAIL = "arc-testnet";
const MIN_REBALANCE_USD = 0.5;

export function createStrategyPolicy({
  handle = "@sara",
  name,
  targetAllocations,
  settlementRail = DEFAULT_RAIL,
  allowedRails,
  preferredAssets,
  forbiddenAssets
} = {}) {
  const user = resolveXHandle(handle);
  const allocations = normalizeAllocations(targetAllocations);
  const now = new Date().toISOString();
  user.agentMemory ||= { riskProfile: user.policy?.riskProfile || "balanced", recentDecisions: [], recentFailures: [] };
  user.agentMemory.strategies ||= [];

  const strategy = {
    id: nextStrategyId(user),
    handle: user.handle,
    name: name || `Target ${allocationLabel(allocations)}`,
    type: "target_allocation",
    status: "active",
    settlementRail,
    targetAllocations: allocations,
    allowedRails: allowedRails || user.policy?.allowedSettlementRails || [settlementRail],
    preferredAssets: normalizeAssetArray(preferredAssets || Object.keys(allocations)),
    forbiddenAssets: normalizeAssetArray(forbiddenAssets || []),
    createdAt: now,
    updatedAt: now,
    lastCheck: null,
    history: []
  };

  user.agentMemory.defaultStrategyId = strategy.id;
  user.agentMemory.strategies.push(strategy);

  return {
    ok: true,
    status: "strategy_saved",
    strategy,
    signer: readOnlySigner({ operation: "create_strategy_policy" }),
    nextAction: "plan_rebalance_strategy"
  };
}

export function listStrategyPolicies({ handle, status, limit = 20 } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const rows = Array.from(users.values())
    .filter((user) => !normalized || user.handle === normalized)
    .flatMap((user) => user.agentMemory?.strategies || [])
    .filter((strategy) => !status || strategy.status === status)
    .slice()
    .reverse()
    .slice(0, Number(limit) || 20);

  return {
    ok: true,
    strategies: rows
  };
}

export function planRebalanceStrategy({
  handle = "@sara",
  strategyId,
  targetAllocations,
  settlementRail = DEFAULT_RAIL,
  maxSteps = 6
} = {}) {
  const user = resolveXHandle(handle);
  const strategy = resolveStrategy({ user, strategyId, targetAllocations, settlementRail });
  const wallet = getWalletProfile(user.handle);
  const portfolio = portfolioSnapshot({ wallet, settlementRail: strategy.settlementRail || settlementRail });
  const plan = buildRebalancePlan({ user, wallet, portfolio, strategy, maxSteps });
  rememberStrategyCheck({ user, strategy, plan });

  return {
    ok: true,
    status: plan.steps.length ? "plan_ready" : "in_range",
    strategy,
    portfolio,
    strategyPlan: plan,
    signer: readOnlySigner({ operation: "plan_rebalance_strategy" }),
    nextAction: plan.steps.length ? "review_plan_then_quote_steps" : "no_action_required"
  };
}

export function reduceRiskStrategy({
  handle = "@sara",
  settlementRail = DEFAULT_RAIL,
  stableTarget = 0.9
} = {}) {
  const target = {
    USDC: Math.max(0, Math.min(1, Number(stableTarget || 0.9))),
    EURC: 1 - Math.max(0, Math.min(1, Number(stableTarget || 0.9)))
  };
  return planRebalanceStrategy({
    handle,
    settlementRail,
    targetAllocations: target,
    maxSteps: 4
  });
}

export function runStrategyCheck({ handle = "@sara", strategyId, settlementRail = DEFAULT_RAIL } = {}) {
  const result = planRebalanceStrategy({ handle, strategyId, settlementRail });
  const marketGuard = shouldPauseStrategyForMarket({
    handle,
    strategy: result.strategy,
    portfolio: result.portfolio
  });
  if (marketGuard.paused) {
    result.strategyPlan = {
      ...result.strategyPlan,
      status: "paused_by_market",
      warnings: [
        ...(result.strategyPlan.warnings || []),
        marketGuard.reason
      ],
      nextAction: marketGuard.nextAction
    };
    return {
      ...result,
      status: "paused_by_market",
      marketGuard,
      automationSafe: true,
      executed: false,
      reason: marketGuard.reason,
      nextAction: marketGuard.nextAction
    };
  }
  return {
    ...result,
    marketGuard,
    status: result.strategyPlan.steps.length ? "action_required" : "in_range",
    automationSafe: true,
    executed: false,
    reason: result.strategyPlan.steps.length
      ? "Strategy drift detected. The automation produced a plan only; quote or execute steps explicitly."
      : "Strategy is within drift threshold. No trade was executed."
  };
}

function buildRebalancePlan({ portfolio, strategy, maxSteps }) {
  const total = Number(portfolio.totalValueUsd || 0);
  const targets = strategy.targetAllocations || {};
  const current = portfolio.assetsBySymbol;
  const drifts = Object.entries(targets).map(([symbol, weight]) => {
    const currentValue = Number(current[symbol]?.valueUsd || 0);
    const targetValue = total * Number(weight || 0);
    return {
      symbol,
      currentValueUsd: round(currentValue),
      targetValueUsd: round(targetValue),
      deltaUsd: round(targetValue - currentValue),
      currentWeight: total > 0 ? round(currentValue / total, 6) : 0,
      targetWeight: Number(weight)
    };
  });

  const over = drifts
    .filter((item) => item.deltaUsd < -MIN_REBALANCE_USD)
    .sort((a, b) => a.deltaUsd - b.deltaUsd);
  const under = drifts
    .filter((item) => item.deltaUsd > MIN_REBALANCE_USD)
    .sort((a, b) => b.deltaUsd - a.deltaUsd);
  const steps = [];

  for (const need of under) {
    const source = over.find((item) => item.symbol !== need.symbol && Math.abs(item.deltaUsd) >= MIN_REBALANCE_USD);
    if (!source) break;
    const amount = round(Math.min(need.deltaUsd, Math.abs(source.deltaUsd)));
    source.deltaUsd = round(source.deltaUsd + amount);
    need.deltaUsd = round(need.deltaUsd - amount);
    steps.push({
      id: `step_${steps.length + 1}`,
      type: "swap",
      fromToken: source.symbol,
      toToken: need.symbol,
      amountUsd: amount,
      settlementRail: strategy.settlementRail,
      tool: "quote_defi_route",
      arguments: {
        type: "swap",
        fromRail: strategy.settlementRail,
        toRail: strategy.settlementRail,
        amount,
        fromToken: source.symbol,
        toToken: need.symbol
      },
      status: "planned"
    });
    if (steps.length >= Number(maxSteps || 6)) break;
  }

  return {
    id: `plan_${Date.now().toString(36)}`,
    type: "rebalance",
    status: steps.length ? "requires_review" : "in_range",
    totalValueUsd: total,
    drift: drifts,
    steps,
    warnings: buildPlanWarnings({ portfolio, strategy, steps }),
    nextAction: steps.length ? "quote_first_step" : "monitor_strategy"
  };
}

function buildPlanWarnings({ portfolio, strategy, steps }) {
  const warnings = [];
  if (!portfolio.totalValueUsd) {
    warnings.push("No known USD-valued assets were found on this rail.");
  }
  const missing = Object.keys(strategy.targetAllocations || {}).filter((symbol) => !portfolio.assetsBySymbol[symbol]);
  if (missing.length) {
    warnings.push(`Target assets not currently held: ${missing.join(", ")}.`);
  }
  if (steps.some((step) => step.amountUsd <= 2)) {
    warnings.push("Some rebalance steps are small; route fees may make them uneconomical.");
  }
  if (!steps.length && portfolio.totalValueUsd) {
    warnings.push("Portfolio is already within the current rebalance threshold.");
  }
  return warnings;
}

function portfolioSnapshot({ wallet, settlementRail }) {
  const tokens = Array.isArray(wallet.tokenBalances?.[settlementRail])
    ? wallet.tokenBalances[settlementRail]
    : [{ symbol: "USDC", amount: wallet.balances?.[settlementRail] || 0, valueUsd: wallet.balances?.[settlementRail] || 0 }];
  const assets = tokens
    .map((token) => ({
      symbol: normalizeToken(token.symbol),
      amount: Number(token.amount || 0),
      valueUsd: knownValueUsd(token),
      tokenAddress: token.tokenAddress || null
    }))
    .filter((token) => Number(token.amount || 0) > 0 || Number(token.valueUsd || 0) > 0);
  const totalValueUsd = round(assets.reduce((sum, token) => sum + Number(token.valueUsd || 0), 0));
  const assetsBySymbol = Object.fromEntries(assets.map((asset) => [asset.symbol, {
    ...asset,
    weight: totalValueUsd > 0 ? round(asset.valueUsd / totalValueUsd, 6) : 0
  }]));

  return {
    settlementRail,
    totalValueUsd,
    assets,
    assetsBySymbol
  };
}

function resolveStrategy({ user, strategyId, targetAllocations, settlementRail }) {
  if (targetAllocations) {
    return {
      id: "adhoc_strategy",
      handle: user.handle,
      name: `Ad hoc ${allocationLabel(normalizeAllocations(targetAllocations))}`,
      type: "target_allocation",
      status: "adhoc",
      settlementRail,
      targetAllocations: normalizeAllocations(targetAllocations),
      allowedRails: [settlementRail],
      preferredAssets: Object.keys(targetAllocations),
      forbiddenAssets: []
    };
  }

  const strategies = user.agentMemory?.strategies || [];
  const strategy = strategies.find((item) => item.id === strategyId)
    || strategies.find((item) => item.id === user.agentMemory?.defaultStrategyId)
    || strategies.find((item) => item.status === "active");
  if (!strategy) {
    throw new Error("No strategy policy found. Create one first, e.g. keep 70% USDC, 20% EURC, 10% cirBTC.");
  }
  return strategy;
}

function rememberStrategyCheck({ user, strategy, plan }) {
  const now = new Date().toISOString();
  if (strategy.status !== "adhoc") {
    strategy.lastCheck = {
      at: now,
      status: plan.status,
      steps: plan.steps.length,
      totalValueUsd: plan.totalValueUsd
    };
    strategy.updatedAt = now;
    strategy.history ||= [];
    strategy.history.unshift({
      at: now,
      planId: plan.id,
      status: plan.status,
      steps: plan.steps.length,
      nextAction: plan.nextAction
    });
    strategy.history = strategy.history.slice(0, 20);
  }
  user.agentMemory ||= {};
  user.agentMemory.lastStrategyPlan = {
    at: now,
    strategyId: strategy.id,
    status: plan.status,
    steps: plan.steps.length,
    nextAction: plan.nextAction
  };
}

function normalizeAllocations(input) {
  const entries = Array.isArray(input)
    ? input.map((item) => [item.symbol || item.asset, item.weight ?? item.percent ?? item.allocation])
    : Object.entries(input || {});
  const normalized = Object.fromEntries(entries.map(([symbol, value]) => [
    normalizeToken(symbol),
    normalizeWeight(value)
  ]).filter(([symbol, value]) => symbol && value > 0));
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new Error("Strategy target allocations are required");
  if (Math.abs(total - 1) > 0.02) {
    throw new Error(`Strategy allocations must add up to 100%; got ${(total * 100).toFixed(2)}%`);
  }
  return Object.fromEntries(Object.entries(normalized).map(([symbol, value]) => [symbol, round(value, 6)]));
}

function normalizeWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number > 1 ? number / 100 : number;
}

function normalizeAssetArray(values) {
  return (Array.isArray(values) ? values : String(values || "").split(","))
    .map(normalizeToken)
    .filter(Boolean);
}

function nextStrategyId(user) {
  const existing = user.agentMemory?.strategies || [];
  return `strat_${String(existing.length + 1).padStart(4, "0")}`;
}

function allocationLabel(allocations) {
  return Object.entries(allocations)
    .map(([symbol, weight]) => `${Math.round(Number(weight) * 100)}% ${symbol}`)
    .join(", ");
}

function knownValueUsd(token) {
  if (token.valueUsd !== null && token.valueUsd !== undefined) return round(Number(token.valueUsd || 0));
  const symbol = normalizeToken(token.symbol);
  if (["USDC", "EURC", "USDT"].includes(symbol)) return round(Number(token.amount || 0));
  return 0;
}

function normalizeToken(symbol) {
  const value = String(symbol || "").trim();
  if (!value) return "";
  if (/^0x[a-fA-F0-9]{40}$/.test(value)) return value;
  if (value.toUpperCase() === "CIRBTC") return "cirBTC";
  return value.toUpperCase();
}

function round(value, decimals = 6) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}
