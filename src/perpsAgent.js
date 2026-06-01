import { createApproval } from "./approvals.js";
import { enqueueJob } from "./jobs.js";
import { ledger } from "./fixtures.js";
import { normalizeHandle, resolveXHandle } from "./identity.js";
import { nextEventId, nextPerpProposalId } from "./ids.js";
import { listHyperliquidMarkets } from "./hyperliquidAdapter.js";
import { readOnlySigner, userWalletSigningRequired } from "./signerPolicy.js";
import { getMarketFeedSnapshot } from "./marketFeeds.js";
import { evaluateMandatesForAction } from "./mandates.js";

const fallbackPrices = {
  BTC: 100000,
  ETH: 3500,
  SOL: 165
};

export async function listPerpIntelligence({ handle = "@sara", limit = 5 } = {}) {
  const user = resolveXHandle(handle);
  const markets = await listHyperliquidMarkets({ limit });
  const enriched = (markets.markets || []).map((market) => ({
    ...market,
    fundingBias: fundingBias(market.symbol),
    riskRegime: riskRegime(market.symbol),
    suggestedMaxLeverage: suggestedMaxLeverage(market.symbol)
  }));

  recordEvent("perp_intelligence_listed", {
    handle: user.handle,
    marketCount: enriched.length
  });

  return {
    ok: true,
    provider: markets.provider,
    mode: markets.mode,
    markets: enriched,
    signer: readOnlySigner({ operation: "list_perp_intelligence" })
  };
}

export function assessLiquidationRisk({
  handle = "@sara",
  symbol = "BTC",
  side = "long",
  collateralUsd,
  leverage = 2,
  entryPrice
} = {}) {
  const user = resolveXHandle(handle);
  const collateral = Number(collateralUsd || 0);
  const lev = Number(leverage || 1);
  const feed = getMarketFeedSnapshot({ assets: [symbol === "BTC" ? "cirBTC" : symbol === "ETH" ? "WETH" : symbol], settlementRail: "arc-testnet" });
  const feedSymbol = symbol === "BTC" ? "cirBTC" : symbol === "ETH" ? "WETH" : symbol;
  const feedPrice = feed.prices?.[feedSymbol]?.priceUsd;
  const perpMarket = feed.perps?.markets?.find((market) => market.symbol === symbol);
  const price = Number(entryPrice || perpMarket?.markPrice || feedPrice || fallbackPrices[symbol] || 1000);

  if (!Number.isFinite(collateral) || collateral <= 0) {
    throw new Error("Collateral must be greater than zero");
  }

  if (!Number.isFinite(lev) || lev < 1) {
    throw new Error("Leverage must be at least 1");
  }

  const moveToLiquidation = 1 / lev * 0.88;
  const liquidationPrice = side === "short"
    ? price * (1 + moveToLiquidation)
    : price * (1 - moveToLiquidation);
  const riskScore = Math.min(100, Math.round(lev * 12 + (collateral > 100 ? 8 : 0)));
  const bufferPct = Math.abs(price - liquidationPrice) / price;

  const assessment = {
    handle: user.handle,
    symbol,
    side,
    collateralUsd: collateral,
    leverage: lev,
    notionalUsd: Math.round(collateral * lev * 100) / 100,
    entryPrice: price,
    marketContext: {
      priceSource: entryPrice ? "user_input" : perpMarket?.markPrice ? "hyperliquid_mark" : feedPrice ? "market_feed" : "fallback_reference",
      feedFreshness: feed.freshness?.status || "unknown",
      regime: feed.regime?.status || "unknown",
      funding: perpMarket?.funding ?? null,
      openInterest: perpMarket?.openInterest ?? null
    },
    liquidationPrice: Math.round(liquidationPrice * 100) / 100,
    liquidationBufferPct: Math.round(bufferPct * 10000) / 100,
    riskScore,
    recommendation: riskScore > 55
      ? "Reduce leverage or increase collateral before opening."
      : "Leverage is inside demo risk policy with stop-loss required."
  };

  recordEvent("perp_liquidation_risk_assessed", {
    handle: user.handle,
    symbol,
    side,
    riskScore
  });

  return {
    ok: true,
    assessment,
    signer: readOnlySigner({ operation: "assess_liquidation_risk", settlementRail: "arc-testnet" })
  };
}

export function proposePerpTrade({
  handle = "@sara",
  symbol = "BTC",
  side = "long",
  collateralUsd,
  leverage = 2,
  entryPrice,
  settlementRail = "arc-testnet",
  source = "dashboard",
  postId,
  idempotencyKey
} = {}) {
  const user = resolveXHandle(handle);
  if (!user.onboarded) {
    throw new Error("User must create a wallet before perps trading");
  }

  if (idempotencyKey) {
    const existing = ledger.perpProposals.find((item) => item.idempotencyKey === idempotencyKey);
    if (existing) {
      return { ok: true, proposal: existing, approval: ledger.approvals.find((item) => item.id === existing.approvalId), idempotentReplay: true };
    }
  }

  const risk = assessLiquidationRisk({ handle: user.handle, symbol, side, collateralUsd, leverage, entryPrice }).assessment;
  const mandateCheck = evaluateMandatesForAction({
    handle: user.handle,
    action: {
      type: "perp",
      symbol,
      side,
      collateralUsd: risk.collateralUsd,
      amountUsd: risk.collateralUsd,
      leverage: risk.leverage,
      settlementRail
    },
    risk,
    type: "perp"
  });
  if (!mandateCheck.approved) {
    recordEvent("perp_trade_rejected_by_mandate", {
      handle: user.handle,
      symbol,
      side,
      leverage,
      reason: mandateCheck.reason
    });
    return {
      ok: false,
      status: "rejected",
      reason: mandateCheck.reason,
      mandateCheck,
      risk,
      signer: readOnlySigner({ operation: "propose_perp_trade" }),
      nextAction: "review_mandates"
    };
  }
  const proposal = {
    id: nextPerpProposalId(),
    handle: user.handle,
    symbol,
    side,
    collateralUsd: risk.collateralUsd,
    leverage: risk.leverage,
    notionalUsd: risk.notionalUsd,
    settlementRail,
    status: "requires_confirmation",
    signer: userWalletSigningRequired({
      operation: "open_perp_position",
      settlementRail,
      reason: "ArcPerps execution needs a user-owned signing adapter; backend signer execution is disabled."
    }),
    mandateCheck,
    risk,
    stopLoss: suggestedStopLoss(risk),
    takeProfit: suggestedTakeProfit(risk),
    source,
    postId: postId || null,
    idempotencyKey: idempotencyKey || null,
    createdAt: new Date().toISOString()
  };
  ledger.perpProposals.push(proposal);

  const approval = createApproval({
    handle: user.handle,
    kind: "perp_trade",
    targetId: proposal.id,
    title: `${side.toUpperCase()} ${symbol} perp at ${leverage}x`,
    summary: `AI proposes ${risk.notionalUsd} USDC notional with liquidation buffer ${risk.liquidationBufferPct}%.`,
    risk: risk.riskScore > 55 ? "high" : "medium",
    metadata: {
      symbol,
      side,
      collateralUsd: risk.collateralUsd,
      leverage,
      settlementRail
    }
  });
  proposal.approvalId = approval.id;

  recordEvent("perp_trade_proposed", {
    handle: user.handle,
    proposalId: proposal.id,
    symbol,
    side,
    leverage
  });

  return { ok: true, proposal, approval, mandateCheck };
}

export function listPerpProposals({ handle, status, limit = 50 } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const proposals = ledger.perpProposals
    .filter((proposal) => (
      (!normalized || proposal.handle === normalized)
      && (!status || proposal.status === status)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 50);

  return { ok: true, proposals };
}

export function confirmPerpProposal({ proposalId } = {}) {
  const proposal = ledger.perpProposals.find((item) => item.id === proposalId);
  if (!proposal) {
    throw new Error("Perp proposal not found");
  }

  proposal.status = "confirmed";
  proposal.confirmedAt = new Date().toISOString();
  const job = enqueueJob({
    type: "execute_perp_proposal",
    payload: { proposalId: proposal.id },
    idempotencyKey: `execute_perp_proposal:${proposal.id}`
  });
  proposal.execution = {
    mode: "queued",
    jobId: job.id,
    backendSignerAllowed: false,
    reason: "Confirmed proposal queued, but execution requires a user-owned signing adapter."
  };
  recordEvent("perp_trade_confirmed", {
    handle: proposal.handle,
    proposalId: proposal.id,
    symbol: proposal.symbol,
    side: proposal.side,
    jobId: job.id
  });
  return { ok: true, proposal, job };
}

function suggestedStopLoss(risk) {
  const distance = risk.side === "short" ? 1.025 : 0.975;
  return Math.round(risk.entryPrice * distance * 100) / 100;
}

function suggestedTakeProfit(risk) {
  const distance = risk.side === "short" ? 0.94 : 1.06;
  return Math.round(risk.entryPrice * distance * 100) / 100;
}

function fundingBias(symbol) {
  return symbol === "BTC" ? "crowded-long" : symbol === "ETH" ? "neutral" : "thin-liquidity";
}

function riskRegime(symbol) {
  return symbol === "BTC" || symbol === "ETH" ? "normal" : "elevated";
}

function suggestedMaxLeverage(symbol) {
  return symbol === "BTC" ? 3 : symbol === "ETH" ? 2.5 : 2;
}

function recordEvent(type, event) {
  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type,
    ...event
  });
}
