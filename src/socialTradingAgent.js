import { createApproval } from "./approvals.js";
import { ledger } from "./fixtures.js";
import { normalizeHandle, resolveXHandle } from "./identity.js";
import { nextCopyTradeProposalId, nextEventId } from "./ids.js";
import { readOnlySigner, userWalletSigningRequired } from "./signerPolicy.js";

const traderProfiles = [
  {
    handle: "@macro_mira",
    style: "macro",
    sharpe: 1.8,
    maxDrawdown: 0.11,
    hitRate: 0.58,
    signalQuality: 0.84,
    staleSignalRate: 0.09,
    recentSignal: "Risk-on rotation, ETH beta preferred over majors."
  },
  {
    handle: "@perp_ren",
    style: "perps",
    sharpe: 1.35,
    maxDrawdown: 0.18,
    hitRate: 0.54,
    signalQuality: 0.76,
    staleSignalRate: 0.16,
    recentSignal: "BTC funding elevated, wait for reset before long."
  },
  {
    handle: "@stable_sia",
    style: "yield",
    sharpe: 1.12,
    maxDrawdown: 0.05,
    hitRate: 0.63,
    signalQuality: 0.72,
    staleSignalRate: 0.04,
    recentSignal: "Keep dry powder in USDC until volatility compresses."
  }
];

export function rankSocialTraders({ handle = "@sara", riskProfile = "balanced", limit = 5 } = {}) {
  const user = resolveXHandle(handle);
  const ranked = traderProfiles
    .map((trader) => ({
      ...trader,
      score: scoreTrader(trader, riskProfile),
      suggestedWeight: suggestedWeight(trader, riskProfile)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(limit) || 5);

  recordEvent("social_traders_ranked", {
    handle: user.handle,
    riskProfile,
    traderCount: ranked.length
  });

  return {
    ok: true,
    handle: user.handle,
    riskProfile,
    traders: ranked,
    decision: "Prefer traders with risk-adjusted returns, low drawdown, and fresh signals.",
    signer: readOnlySigner({ operation: "rank_social_traders" })
  };
}

export function proposeCopyTrade({
  handle = "@sara",
  traderHandle,
  capitalUsd,
  riskProfile = "balanced",
  settlementRail = "arc-testnet"
} = {}) {
  const user = resolveXHandle(handle);
  if (!user.onboarded) {
    throw new Error("User must create a wallet before copy trading");
  }

  const trader = traderProfiles.find((item) => item.handle === normalizeHandle(traderHandle))
    || traderProfiles[0];
  const capital = Number(capitalUsd || 0);
  if (!Number.isFinite(capital) || capital <= 0) {
    throw new Error("Capital must be greater than zero");
  }

  const allocation = Math.round(capital * suggestedWeight(trader, riskProfile) * 100) / 100;
  const proposal = {
    id: nextCopyTradeProposalId(),
    handle: user.handle,
    traderHandle: trader.handle,
    riskProfile,
    capitalUsd: capital,
    suggestedAllocationUsd: allocation,
    settlementRail,
    status: "requires_confirmation",
    signer: userWalletSigningRequired({
      operation: "copy_trade_allocation",
      settlementRail,
      reason: "Live copy-trade execution requires user-owned swap/perp adapters."
    }),
    rationale: [
      `Score ${scoreTrader(trader, riskProfile).toFixed(2)} from Sharpe ${trader.sharpe}.`,
      `Max drawdown ${(trader.maxDrawdown * 100).toFixed(1)}% caps allocation.`,
      `Recent signal: ${trader.recentSignal}`
    ],
    createdAt: new Date().toISOString()
  };
  ledger.copyTradeProposals.push(proposal);
  const approval = createApproval({
    handle: user.handle,
    kind: "copy_trade",
    targetId: proposal.id,
    title: `Copy ${trader.handle} with ${allocation} USDC`,
    summary: `AI selected allocation from ${capital} USDC based on risk-adjusted social signals.`,
    risk: trader.maxDrawdown > 0.15 ? "high" : "medium",
    metadata: {
      traderHandle: trader.handle,
      capitalUsd: capital,
      suggestedAllocationUsd: allocation,
      settlementRail
    }
  });
  proposal.approvalId = approval.id;

  recordEvent("copy_trade_proposed", {
    handle: user.handle,
    proposalId: proposal.id,
    traderHandle: trader.handle,
    suggestedAllocationUsd: allocation
  });

  return { ok: true, proposal, approval };
}

export function listCopyTradeProposals({ handle, status, limit = 50 } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const proposals = ledger.copyTradeProposals
    .filter((proposal) => (
      (!normalized || proposal.handle === normalized)
      && (!status || proposal.status === status)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 50);

  return { ok: true, proposals };
}

export function confirmCopyTradeProposal({ proposalId } = {}) {
  const proposal = ledger.copyTradeProposals.find((item) => item.id === proposalId);
  if (!proposal) {
    throw new Error("Copy trade proposal not found");
  }

  proposal.status = "confirmed";
  proposal.confirmedAt = new Date().toISOString();
  proposal.execution = {
    mode: "dry-run",
    backendSignerAllowed: false,
    reason: "Live copy execution requires configured user-owned swap/perp adapters and user approval policy."
  };
  recordEvent("copy_trade_confirmed", {
    handle: proposal.handle,
    proposalId: proposal.id,
    traderHandle: proposal.traderHandle
  });
  return { ok: true, proposal };
}

function scoreTrader(trader, riskProfile) {
  const drawdownPenalty = riskProfile === "conservative" ? 2.4 : riskProfile === "aggressive" ? 1.1 : 1.7;
  const stalePenalty = riskProfile === "aggressive" ? 0.4 : 0.8;
  return trader.sharpe + trader.signalQuality + trader.hitRate - trader.maxDrawdown * drawdownPenalty - trader.staleSignalRate * stalePenalty;
}

function suggestedWeight(trader, riskProfile) {
  const base = riskProfile === "conservative" ? 0.22 : riskProfile === "aggressive" ? 0.48 : 0.34;
  const penalty = trader.maxDrawdown > 0.15 ? 0.72 : 1;
  return Math.round(base * penalty * 100) / 100;
}

function recordEvent(type, event) {
  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type,
    ...event
  });
}
