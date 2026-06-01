import { ledger, users } from "./fixtures.js";
import { normalizeHandle, resolveXHandle } from "./identity.js";
import { getWalletProfile } from "./walletAccounts.js";
import { readOnlySigner } from "./signerPolicy.js";

const STABLE_ASSETS = new Set(["USDC", "EURC", "USDT", "DAI"]);
const VOLATILE_ASSETS = new Set(["CIRBTC", "WBTC", "BTC", "WETH", "ETH", "NATIVE", "SOL"]);
const PENDING_STATUSES = new Set(["queued", "confirmed", "submitted", "pending", "requires_confirmation"]);
const FAILED_STATUSES = new Set(["failed", "rejected", "quote_unavailable", "execution_not_enabled", "user_wallet_signing_required"]);

export function analyzePortfolio({ handle = "@sara", settlementRail, includeRecommendations = true } = {}) {
  const user = resolveXHandle(handle);
  const snapshot = buildPortfolioSnapshot({ handle: user.handle, settlementRail });
  const recommendations = includeRecommendations ? buildPortfolioRecommendations({ user, snapshot }) : [];
  const primary = recommendations[0] || holdRecommendation(snapshot);

  return {
    ok: true,
    status: "portfolio_analyzed",
    handle: user.handle,
    portfolio: snapshot,
    recommendation: primary,
    recommendations,
    signer: readOnlySigner({ operation: "analyze_portfolio", settlementRail: settlementRail || "all" }),
    nextAction: primary.nextAction
  };
}

export function buildPortfolioSnapshot({ handle = "@sara", settlementRail } = {}) {
  const user = resolveXHandle(handle);
  const wallet = safe(() => getWalletProfile(user.handle), null);
  const rails = wallet?.balances || {};
  const railIds = settlementRail
    ? [settlementRail]
    : Array.from(new Set([...Object.keys(rails), ...Object.keys(wallet?.tokenBalances || {})]));
  const assets = collectAssets(wallet, railIds);
  const totalValueUsd = round(assets.reduce((sum, asset) => sum + asset.valueUsd, 0));
  const assetsByToken = groupAssetsByToken(assets, totalValueUsd);
  const valueByRail = Object.fromEntries(railIds.map((rail) => [
    rail,
    round(assets.filter((asset) => asset.rail === rail).reduce((sum, asset) => sum + asset.valueUsd, 0))
  ]));
  const exposure = exposureSummary({ assetsByToken, totalValueUsd });
  const perps = perpsExposure({ handle: user.handle, totalValueUsd });
  const pending = pendingActions({ handle: user.handle });
  const strategy = strategyDrift({ user, assetsByToken, totalValueUsd, settlementRail });
  const lastTrade = user.agentMemory?.lastTrade || null;

  return {
    handle: user.handle,
    generatedAt: new Date().toISOString(),
    settlementRail: settlementRail || "all",
    wallet: {
      onboarded: Boolean(wallet?.onboarded),
      address: wallet?.walletAddress || null
    },
    totalValueUsd,
    valueByRail,
    assets,
    assetsByToken,
    exposure,
    perps,
    idleCapital: {
      stableUsd: exposure.stableUsd,
      dominantStable: dominantStable(assetsByToken),
      note: exposure.stableWeight > 0.8 ? "Most capital is idle/stable." : "Capital is partly allocated beyond stables."
    },
    pending,
    strategy,
    lastTrade,
    risk: riskSummary({ exposure, perps, pending, strategy })
  };
}

function buildPortfolioRecommendations({ user, snapshot }) {
  const recommendations = [];

  if (!snapshot.wallet.onboarded) {
    recommendations.push(recommendation("connect_wallet", "high", "Create or connect a wallet before trading.", "create_wallet"));
    return recommendations;
  }

  if (snapshot.pending.count > 0) {
    recommendations.push(recommendation(
      "wait_for_pending_execution",
      "high",
      `${snapshot.pending.count} action(s) are still pending. Let them settle before stacking more risk.`,
      "refresh_execution_monitor"
    ));
  }

  if (snapshot.perps.activeNotionalUsd > snapshot.totalValueUsd * 0.5 && snapshot.totalValueUsd > 0) {
    recommendations.push(recommendation(
      "reduce_perps_exposure",
      "high",
      "Perps notional is large relative to wallet value. Avoid adding leverage until exposure falls.",
      "assess_liquidation_risk"
    ));
  }

  if (snapshot.exposure.volatileWeight > 0.45) {
    recommendations.push(recommendation(
      "reduce_volatile_exposure",
      "medium",
      "Volatile assets are a large share of the wallet. Consider shifting some exposure back to stables.",
      "reduce_risk_strategy"
    ));
  }

  if (snapshot.strategy?.status === "drifted") {
    recommendations.push(recommendation(
      "rebalance_to_strategy",
      "medium",
      `Portfolio drift is above threshold for ${snapshot.strategy.strategyName}. Review a rebalance plan before trading.`,
      "plan_rebalance_strategy"
    ));
  }

  if (!recommendations.length && snapshot.totalValueUsd > 0) {
    recommendations.push(holdRecommendation(snapshot));
  }

  if (!user.agentMemory?.strategies?.length && snapshot.totalValueUsd > 0) {
    recommendations.push(recommendation(
      "set_strategy_mandate",
      "low",
      "No standing allocation mandate is set. Add one if you want the agent to judge future trades against a target portfolio.",
      "create_strategy_policy"
    ));
  }

  return recommendations;
}

function holdRecommendation(snapshot) {
  return recommendation(
    "hold",
    "low",
    snapshot.totalValueUsd > 0
      ? "No urgent trade is needed. Portfolio risk is inside the current guardrails, so holding is reasonable."
      : "No funded assets were found. Fund the wallet before trading.",
    snapshot.totalValueUsd > 0 ? "monitor_portfolio" : "fund_wallet"
  );
}

function collectAssets(wallet, railIds) {
  if (!wallet) return [];
  return railIds.flatMap((rail) => {
    const tokens = Array.isArray(wallet.tokenBalances?.[rail])
      ? wallet.tokenBalances[rail]
      : [{ symbol: "USDC", amount: wallet.balances?.[rail] || 0, valueUsd: wallet.balances?.[rail] || 0 }];
    return tokens.map((token) => ({
      rail,
      symbol: normalizeSymbol(token.symbol),
      amount: Number(token.amount || 0),
      valueUsd: knownValueUsd(token),
      tokenAddress: token.tokenAddress || null
    })).filter((asset) => asset.amount > 0 || asset.valueUsd > 0);
  });
}

function groupAssetsByToken(assets, totalValueUsd) {
  const grouped = {};
  for (const asset of assets) {
    grouped[asset.symbol] ||= {
      symbol: asset.symbol,
      amount: 0,
      valueUsd: 0,
      rails: {}
    };
    grouped[asset.symbol].amount = roundToken(grouped[asset.symbol].amount + asset.amount);
    grouped[asset.symbol].valueUsd = round(grouped[asset.symbol].valueUsd + asset.valueUsd);
    grouped[asset.symbol].rails[asset.rail] = round((grouped[asset.symbol].rails[asset.rail] || 0) + asset.valueUsd);
  }
  for (const asset of Object.values(grouped)) {
    asset.weight = totalValueUsd > 0 ? round(asset.valueUsd / totalValueUsd, 6) : 0;
    asset.class = assetClass(asset.symbol);
  }
  return grouped;
}

function exposureSummary({ assetsByToken, totalValueUsd }) {
  const values = Object.values(assetsByToken || {});
  const stableUsd = round(values.filter((asset) => asset.class === "stable").reduce((sum, asset) => sum + asset.valueUsd, 0));
  const volatileUsd = round(values.filter((asset) => asset.class === "volatile").reduce((sum, asset) => sum + asset.valueUsd, 0));
  const otherUsd = round(Math.max(0, totalValueUsd - stableUsd - volatileUsd));
  return {
    stableUsd,
    volatileUsd,
    otherUsd,
    stableWeight: totalValueUsd > 0 ? round(stableUsd / totalValueUsd, 6) : 0,
    volatileWeight: totalValueUsd > 0 ? round(volatileUsd / totalValueUsd, 6) : 0,
    otherWeight: totalValueUsd > 0 ? round(otherUsd / totalValueUsd, 6) : 0
  };
}

function perpsExposure({ handle, totalValueUsd }) {
  const proposals = ledger.perpProposals
    .filter((proposal) => proposal.handle === normalizeHandle(handle))
    .slice()
    .reverse();
  const active = proposals.filter((proposal) => ["confirmed", "submitted", "settled"].includes(String(proposal.status || "").toLowerCase()));
  const pending = proposals.filter((proposal) => ["requires_confirmation", "confirmed"].includes(String(proposal.status || "").toLowerCase()));
  const activeNotionalUsd = round(active.reduce((sum, proposal) => sum + Number(proposal.notionalUsd || 0), 0));
  return {
    activeCount: active.length,
    pendingCount: pending.length,
    activeNotionalUsd,
    notionalToWallet: totalValueUsd > 0 ? round(activeNotionalUsd / totalValueUsd, 6) : 0,
    recent: proposals.slice(0, 5).map((proposal) => ({
      id: proposal.id,
      symbol: proposal.symbol,
      side: proposal.side,
      status: proposal.status,
      notionalUsd: proposal.notionalUsd,
      riskScore: proposal.risk?.riskScore || null
    }))
  };
}

function pendingActions({ handle }) {
  const normalized = normalizeHandle(handle);
  const defi = ledger.defiActions.filter((action) => action.handle === normalized && PENDING_STATUSES.has(String(action.status || "").toLowerCase()));
  const payments = ledger.payments.filter((payment) => (
    (payment.senderHandle === normalized || payment.recipientHandle === normalized)
    && PENDING_STATUSES.has(String(payment.status || "").toLowerCase())
  ));
  const approvals = ledger.approvals.filter((approval) => approval.handle === normalized && approval.status === "pending");
  const failed = [
    ...ledger.defiActions.filter((action) => action.handle === normalized && FAILED_STATUSES.has(String(action.status || "").toLowerCase())),
    ...ledger.payments.filter((payment) => payment.senderHandle === normalized && FAILED_STATUSES.has(String(payment.status || "").toLowerCase()))
  ].slice(-5);
  const items = [
    ...defi.map((action) => ({ kind: "defi_action", id: action.id, status: action.status, label: `${action.type} ${action.request?.fromToken || "asset"}` })),
    ...payments.map((payment) => ({ kind: "payment", id: payment.id, status: payment.status, label: `${payment.amount} ${payment.asset || "USDC"} to ${payment.recipientHandle}` })),
    ...approvals.map((approval) => ({ kind: "approval", id: approval.id, status: approval.status, label: approval.title || approval.kind }))
  ];
  return {
    count: items.length,
    items: items.slice(0, 10),
    failures: failed.map((item) => ({
      kind: item.type ? "defi_action" : "payment",
      id: item.id,
      status: item.status,
      reason: item.failureReason || item.reason || item.lastExecutionError || null
    }))
  };
}

function strategyDrift({ user, assetsByToken, totalValueUsd, settlementRail }) {
  const strategy = (user.agentMemory?.strategies || []).find((item) => item.status === "active" && (!settlementRail || item.settlementRail === settlementRail))
    || (user.agentMemory?.strategies || []).find((item) => item.status === "active");
  if (!strategy) {
    return {
      status: "no_strategy",
      reason: "No active allocation mandate found.",
      drift: []
    };
  }
  const drift = Object.entries(strategy.targetAllocations || {}).map(([symbol, weight]) => {
    const normalized = normalizeSymbol(symbol);
    const currentValueUsd = Number(assetsByToken[normalized]?.valueUsd || 0);
    const currentWeight = totalValueUsd > 0 ? currentValueUsd / totalValueUsd : 0;
    return {
      symbol: normalized,
      targetWeight: Number(weight || 0),
      currentWeight: round(currentWeight, 6),
      deltaWeight: round(currentWeight - Number(weight || 0), 6),
      deltaUsd: round(currentValueUsd - totalValueUsd * Number(weight || 0))
    };
  });
  const maxDrift = drift.reduce((max, item) => Math.max(max, Math.abs(item.deltaWeight)), 0);
  return {
    status: maxDrift > 0.1 ? "drifted" : "in_range",
    strategyId: strategy.id,
    strategyName: strategy.name,
    maxDrift: round(maxDrift, 6),
    drift
  };
}

function riskSummary({ exposure, perps, pending, strategy }) {
  const warnings = [];
  if (exposure.volatileWeight > 0.45) warnings.push("High volatile exposure.");
  if (perps.notionalToWallet > 0.5) warnings.push("Perps notional is high relative to wallet value.");
  if (pending.count) warnings.push(`${pending.count} pending action(s) need follow-through.`);
  if (strategy.status === "drifted") warnings.push("Portfolio has drifted from its active strategy.");
  return {
    level: warnings.length >= 2 ? "high" : warnings.length ? "medium" : "low",
    warnings
  };
}

function recommendation(type, priority, reason, nextAction) {
  return { type, priority, reason, nextAction };
}

function assetClass(symbol) {
  const normalized = normalizeSymbol(symbol);
  const key = normalized.toUpperCase();
  if (STABLE_ASSETS.has(key)) return "stable";
  if (VOLATILE_ASSETS.has(key)) return "volatile";
  return "other";
}

function dominantStable(assetsByToken) {
  return Object.values(assetsByToken || {})
    .filter((asset) => asset.class === "stable")
    .sort((a, b) => b.valueUsd - a.valueUsd)[0]?.symbol || null;
}

function normalizeSymbol(symbol) {
  const value = String(symbol || "USDC").trim();
  if (value.toUpperCase() === "CIRBTC") return "cirBTC";
  return value.toUpperCase();
}

function knownValueUsd(token) {
  if (Number.isFinite(Number(token.valueUsd))) return round(Number(token.valueUsd));
  if (Number.isFinite(Number(token.amountUsd))) return round(Number(token.amountUsd));
  if (Number.isFinite(Number(token.amount))) return round(Number(token.amount));
  return 0;
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(Number(value || 0) * factor) / factor;
}

function roundToken(value) {
  return Math.round(Number(value || 0) * 1e8) / 1e8;
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
