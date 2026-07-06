import { ledger } from "./fixtures.js";
import { normalizeHandle } from "./identity.js";
import { getMarketFeedSnapshot, marketFeedForTrade } from "./marketFeeds.js";

const FAILURE_STATUSES = new Set([
  "failed",
  "rejected",
  "quote_unavailable",
  "execution_not_enabled",
  "live_quote_required",
  "transaction_request_missing"
]);
const SUCCESS_STATUSES = new Set(["quoted", "requires_confirmation", "confirmed", "submitted", "settled", "completed"]);

export function getMarketIntelligence({ handle, settlementRail = "arc-testnet", limit = 50 } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const actions = ledger.defiActions
    .filter((action) => (
      (!normalized || action.handle === normalized)
      && (!settlementRail || action.request?.fromRail === settlementRail || action.request?.toRail === settlementRail)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 50);
  const routeStats = summarizeRoutes(actions);
  const perps = summarizePerps({ handle: normalized, settlementRail });
  const feeds = getMarketFeedSnapshot({ settlementRail });
  const regime = detectRegime({ routeStats, perps, feeds });
  const warnings = buildGlobalWarnings({ routeStats, perps, regime, feeds });

  return {
    ok: true,
    status: warnings.length ? "caution" : "healthy",
    settlementRail,
    handle: normalized,
    regime,
    feeds,
    routeStats,
    perps,
    warnings,
    recommendation: recommendationForRegime(regime),
    signer: {
      signerType: "read_only",
      backendSignerAllowed: false,
      operation: "get_market_intelligence"
    }
  };
}

export function analyzeRouteIntelligence({ handle, action = {}, simulation = null } = {}) {
  const market = getMarketIntelligence({
    handle,
    settlementRail: action.fromRail || action.settlementRail || "arc-testnet"
  });
  const key = routeKey(action);
  const route = market.routeStats.find((item) => item.key === key) || null;
  const feed = marketFeedForTrade({
    fromToken: action.fromToken,
    toToken: action.toToken,
    settlementRail: action.fromRail || action.settlementRail || "arc-testnet"
  });
  const warnings = [];

  if (route?.attempts >= 2 && route.failureRate >= 0.5) {
    warnings.push(`This route has failed ${route.failures}/${route.attempts} recent attempts. Last reason: ${route.lastFailureReason || "provider unavailable"}.`);
  }
  if (route?.quoteUnavailableCount > 0) {
    warnings.push(`Liquidity/quote availability has been unreliable for ${route.label}.`);
  }
  if (route?.averageFeeRatio >= 0.15) {
    warnings.push(`Recent fee trend for ${route.label} is high at about ${(route.averageFeeRatio * 100).toFixed(1)}% of notional.`);
  }
  if (!["risk_on", "neutral"].includes(market.regime.status)) {
    warnings.push(market.regime.reason);
  }
  warnings.push(...(feed.warnings || []));
  if (simulation?.recommendation === "do_not_execute") {
    warnings.push("Simulation already recommends not executing this action.");
  }

  return {
    ok: true,
    status: route?.failureRate >= 0.5 && route.attempts >= 2 ? "route_degraded" : market.status,
    routeKey: key,
    route,
    regime: market.regime,
    feed: feed.snapshot,
    warnings: unique(warnings),
    recommendation: routeRecommendation({ route, regime: market.regime, simulation, feed }),
    reason: routeFailureReason(route) || market.regime.reason
  };
}

export function applyRouteIntelligenceToSimulation(simulation, intelligence) {
  if (!simulation || !intelligence) return simulation;
  const warnings = unique([
    ...(simulation.warnings || []),
    ...(intelligence.warnings || [])
  ]);
  const recommendation = strongerRecommendation(simulation.recommendation, intelligence.recommendation);
  return {
    ...simulation,
    warnings,
    recommendation,
    marketIntelligence: {
      status: intelligence.status,
      routeKey: intelligence.routeKey,
      regime: intelligence.regime,
      feedRegime: intelligence.feed?.regime,
      recommendation: intelligence.recommendation,
      reason: intelligence.reason
    }
  };
}

export function shouldPauseStrategyForMarket({ handle, strategy = {}, portfolio = {} } = {}) {
  const market = getMarketIntelligence({
    handle,
    settlementRail: strategy.settlementRail || portfolio.settlementRail || "arc-testnet"
  });
  const degradedRoutes = market.routeStats.filter((route) => route.attempts >= 2 && route.failureRate >= 0.5);
  const highFeeRoutes = market.routeStats.filter((route) => route.averageFeeRatio >= 0.2);
  const shouldPause = market.regime.status === "stale_data"
    || market.regime.status === "low_liquidity"
    || market.regime.status === "high_fee"
    || market.regime.status === "high_volatility"
    || degradedRoutes.length >= 2
    || highFeeRoutes.length >= 2;

  return {
    ok: true,
    paused: shouldPause,
    market,
    reason: shouldPause
      ? `Strategy paused by market guard: ${market.regime.reason}`
      : "Market guard passed; strategy can produce a planning-only rebalance check.",
    nextAction: shouldPause ? "wait_for_better_market_or_override" : "run_strategy_plan"
  };
}

function summarizeRoutes(actions) {
  const groups = new Map();
  for (const action of actions) {
    const key = routeKey(action.request || action);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: routeLabel(action.request || action),
        type: action.type || action.request?.type || "trade",
        fromRail: action.request?.fromRail,
        toRail: action.request?.toRail,
        fromToken: action.request?.fromToken,
        toToken: action.request?.toToken,
        attempts: 0,
        successes: 0,
        failures: 0,
        quoteUnavailableCount: 0,
        executionBlockedCount: 0,
        feeRatios: [],
        feeUsd: [],
        recentReasons: [],
        lastStatus: null,
        lastAttemptAt: null
      });
    }

    const group = groups.get(key);
    const status = String(action.status || "").toLowerCase();
    group.attempts += 1;
    group.lastStatus = action.status || "unknown";
    group.lastAttemptAt = action.completedAt || action.failedAt || action.createdAt || group.lastAttemptAt;
    if (SUCCESS_STATUSES.has(status) || status === "execution_not_enabled") group.successes += 1;
    if (FAILURE_STATUSES.has(status) && status !== "execution_not_enabled") group.failures += 1;
    if (status === "quote_unavailable") group.quoteUnavailableCount += 1;
    if (status === "execution_not_enabled") group.executionBlockedCount += 1;

    const reason = action.failureReason || action.reason || action.lastExecutionError || action.execution?.reason || null;
    if (reason) group.recentReasons.push(reason);
    if (Number.isFinite(Number(action.simulation?.feeRatio))) group.feeRatios.push(Number(action.simulation.feeRatio));
    if (Number.isFinite(Number(action.simulation?.estimatedFeeUsd))) group.feeUsd.push(Number(action.simulation.estimatedFeeUsd));
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    failureRate: group.attempts ? round(group.failures / group.attempts, 4) : 0,
    successRate: group.attempts ? round(group.successes / group.attempts, 4) : 0,
    averageFeeRatio: average(group.feeRatios),
    averageFeeUsd: average(group.feeUsd),
    lastFailureReason: group.recentReasons[0] || null,
    recentReasons: group.recentReasons.slice(0, 3)
  }));
}

function summarizePerps({ handle, settlementRail }) {
  const proposals = ledger.perpProposals
    .filter((proposal) => (
      (!handle || proposal.handle === handle)
      && (!settlementRail || proposal.settlementRail === settlementRail)
    ))
    .slice()
    .reverse()
    .slice(0, 20);
  const elevated = proposals.filter((proposal) => Number(proposal.risk?.riskScore || 0) > 55);
  const averageLeverage = average(proposals.map((proposal) => Number(proposal.leverage || 0)).filter(Boolean));

  return {
    proposalCount: proposals.length,
    elevatedRiskCount: elevated.length,
    averageLeverage,
    lastProposal: proposals[0] ? {
      id: proposals[0].id,
      symbol: proposals[0].symbol,
      side: proposals[0].side,
      status: proposals[0].status,
      riskScore: proposals[0].risk?.riskScore || null
    } : null
  };
}

function detectRegime({ routeStats, perps, feeds }) {
  if (feeds?.regime?.status === "stale_data") {
    return {
      status: "stale_data",
      reason: feeds.regime.reason
    };
  }
  if (feeds?.regime?.status === "high_volatility") {
    return {
      status: "high_volatility",
      reason: feeds.regime.reason
    };
  }
  const attempts = routeStats.reduce((sum, route) => sum + route.attempts, 0);
  const failures = routeStats.reduce((sum, route) => sum + route.failures, 0);
  const quoteUnavailable = routeStats.reduce((sum, route) => sum + route.quoteUnavailableCount, 0);
  const highFee = routeStats.some((route) => route.averageFeeRatio >= 0.2);
  const degraded = attempts >= 3 && failures / attempts >= 0.5;

  if (quoteUnavailable >= 2 || routeStats.some((route) => route.quoteUnavailableCount >= 2)) {
    return {
      status: "low_liquidity",
      reason: "Recent route history shows repeated quote or liquidity failures."
    };
  }
  if (highFee) {
    return {
      status: "high_fee",
      reason: "Recent route history shows fees are elevated relative to trade size."
    };
  }
  if (degraded || perps.elevatedRiskCount >= 2) {
    return {
      status: "risk_off",
      reason: "Recent execution quality or leverage risk is degraded, so the agent should avoid forcing trades."
    };
  }
  if (attempts >= 2 && failures === 0) {
    return {
      status: "risk_on",
      reason: "Recent routes are clearing without failures."
    };
  }
  if (feeds?.regime?.status === "risk_off" || feeds?.regime?.status === "risk_on") {
    return feeds.regime;
  }
  return {
    status: "neutral",
    reason: "Not enough recent route history to call a strong regime."
  };
}

function buildGlobalWarnings({ routeStats, perps, regime, feeds }) {
  const warnings = [];
  if (regime.status !== "risk_on" && regime.status !== "neutral") warnings.push(regime.reason);
  const degraded = routeStats.find((route) => route.attempts >= 2 && route.failureRate >= 0.5);
  if (degraded) warnings.push(`${degraded.label} has a ${(degraded.failureRate * 100).toFixed(0)}% recent failure rate.`);
  const highFee = routeStats.find((route) => route.averageFeeRatio >= 0.15);
  if (highFee) warnings.push(`${highFee.label} has recent average fees near ${(highFee.averageFeeRatio * 100).toFixed(1)}%.`);
  if (perps.elevatedRiskCount) warnings.push(`${perps.elevatedRiskCount} recent perp proposal(s) are elevated risk.`);
  if (feeds?.warnings?.length) warnings.push(...feeds.warnings);
  return unique(warnings).slice(0, 5);
}

function routeRecommendation({ route, regime, simulation, feed }) {
  if (simulation?.blockers?.length) return "hold_or_adjust";
  if (feed?.snapshot?.regime?.status === "stale_data" && feed.snapshot.freshness?.error) return "wait_for_fresh_market_data";
  if (feed?.snapshot?.regime?.status === "high_volatility") return "reduce_size_or_wait";
  if (route?.attempts >= 2 && route.failureRate >= 0.5) return "avoid_route";
  if (route?.averageFeeRatio >= 0.2) return "wait_or_increase_size";
  if (regime.status === "low_liquidity") return "try_later_or_choose_deeper_pair";
  if (regime.status === "high_fee") return "wait_or_batch";
  if (regime.status === "risk_off") return "reduce_risk";
  if (regime.status === "stale_data" && feed?.snapshot?.freshness?.error) return "wait_for_fresh_market_data";
  if (regime.status === "high_volatility") return "reduce_size_or_wait";
  return "route_acceptable";
}

function recommendationForRegime(regime) {
  if (regime.status === "low_liquidity") return "prefer_hold_or_deeper_routes";
  if (regime.status === "high_fee") return "avoid_small_routes";
  if (regime.status === "risk_off") return "reduce_risk_or_wait";
  if (regime.status === "stale_data") return "wait_for_fresh_market_data";
  if (regime.status === "high_volatility") return "reduce_size_or_wait";
  if (regime.status === "risk_on") return "routes_look_clear";
  return "collect_more_route_history";
}

function routeFailureReason(route) {
  if (!route) return null;
  if (route.lastFailureReason) return route.lastFailureReason;
  if (route.quoteUnavailableCount) return "The provider recently returned no quote for this route.";
  if (route.executionBlockedCount) return "Execution was blocked by provider or environment readiness.";
  return null;
}

function routeKey(action = {}) {
  return [
    action.type || "trade",
    action.fromRail || action.settlementRail || "arc-testnet",
    action.toRail || action.settlementRail || action.fromRail || "arc-testnet",
    tokenKey(action.fromToken || "USDC"),
    tokenKey(action.toToken || action.fromToken || "USDC")
  ].join(":");
}

function routeLabel(action = {}) {
  const type = action.type || "trade";
  const fromToken = action.fromToken || "USDC";
  const toToken = action.toToken || action.fromToken || "USDC";
  const fromRail = action.fromRail || action.settlementRail || "arc-testnet";
  const toRail = action.toRail || fromRail;
  return type === "bridge"
    ? `${fromToken} ${fromRail} -> ${toRail}`
    : `${fromToken} -> ${toToken} on ${fromRail}`;
}

function strongerRecommendation(current, next) {
  const rank = {
    execute: 0,
    route_acceptable: 0,
    execute_with_caution: 1,
    route_is_possible_but_uneconomical: 2,
    wait_or_batch: 2,
    wait_or_increase_size: 2,
    wait_for_fresh_market_data: 2,
    reduce_size_or_wait: 3,
    try_later_or_choose_deeper_pair: 3,
    reduce_risk: 3,
    avoid_route: 4,
    hold_or_adjust: 4,
    do_not_execute: 5
  };
  return (rank[next] ?? 0) > (rank[current] ?? 0) ? next : current;
}

function tokenKey(token) {
  return String(token || "").toUpperCase();
}

function average(values) {
  const filtered = values.map(Number).filter((value) => Number.isFinite(value));
  if (!filtered.length) return 0;
  return round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length, 6);
}

function round(value, decimals = 6) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
