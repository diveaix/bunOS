import { createHash } from "node:crypto";
import { createApproval } from "./approvals.js";
import { ledger, users } from "./fixtures.js";
import { nextEventId, nextTokenLaunchId } from "./ids.js";
import { normalizeHandle } from "./identity.js";
import { circleUserSigner } from "./signerPolicy.js";

const DEFAULT_TRADING_FEE_BPS = 100;
const DEFAULT_AGENT_FEE_SHARE_BPS = 8000;
const DEFAULT_COMPUTE_USD_PER_DAY = 5;

export const launchpadArchitecture = {
  version: "0.1.0",
  status: "execution_layer_ready",
  chain: {
    id: "arc-testnet",
    name: "Arc Testnet",
    chainId: 5042002,
    nativeGas: "USDC",
    tokenStandard: "ERC-20 compatible launch token",
    settlementAsset: "USDC"
  },
  positioning: {
    product: "Autonomous token launchpad on Arc",
    primarySurface: "Launchpad",
    supportingSurfaces: ["Terminal", "Agents", "Wallet"],
    narrative: "Agents and humans can create, fund, launch, and monitor Arc-native token markets through policy-gated launch flows."
  },
  lifecycle: [
    {
      id: "draft",
      label: "Draft",
      owner: "creator_or_agent",
      description: "Collect token metadata, supply, allocation, liquidity budget, launch timing, and agent policy."
    },
    {
      id: "risk_review",
      label: "Risk Review",
      owner: "policy_engine",
      description: "Validate metadata, budgets, supply math, slippage, liquidity minimums, and autonomous execution limits."
    },
    {
      id: "token_deploy",
      label: "Token Deploy",
      owner: "launch_factory",
      description: "Deploy the launch token on Arc through a deterministic factory with recorded salt, owner, supply, and metadata hash."
    },
    {
      id: "liquidity_seed",
      label: "Liquidity Seed",
      owner: "liquidity_router",
      description: "Pair launch tokens with USDC, create or join the preferred pool, seed initial liquidity, and lock launch liquidity."
    },
    {
      id: "go_live",
      label: "Go Live",
      owner: "launch_controller",
      description: "Open trading, publish receipt pages, enable agent monitoring, and start scheduled liquidity and market checks."
    },
    {
      id: "operate",
      label: "Operate",
      owner: "agent_runtime",
      description: "Agents monitor pool depth, holders, route quality, failed executions, treasury balances, and pending approvals."
    }
  ],
  contracts: [
    {
      name: "ArcLaunchToken",
      responsibility: "Minimal ERC-20 launch token with capped supply, metadata hash, and factory-controlled initial mint."
    },
    {
      name: "ArcLaunchFactory",
      responsibility: "Creates launch records, deploys tokens, records launch parameters, and emits canonical launch events."
    },
    {
      name: "ArcLaunchController",
      responsibility: "Moves launches through reviewed states, enforces launch windows, and coordinates liquidity seeding."
    },
    {
      name: "ArcLiquidityLocker",
      responsibility: "Locks LP positions or launch-owned liquidity for a configured duration to reduce rug risk."
    },
    {
      name: "ArcAgentPolicyVault",
      responsibility: "Stores per-launch agent permissions, spend limits, allowed actions, and emergency pause state."
    }
  ],
  liquidity: {
    baseAsset: "USDC",
    minimumSeedUsd: 25,
    defaultSeedUsd: 100,
    supportedPoolTypes: ["constant_product_pool", "launch_owned_liquidity"],
    preferredFlow: [
      "Agent or creator funds launch escrow with USDC.",
      "Factory deploys token and mints launch allocation.",
      "Controller transfers token allocation and USDC to the liquidity router.",
      "Router creates or seeds TOKEN/USDC pool.",
      "LP receipt is locked in ArcLiquidityLocker.",
      "Receipt URL and pool telemetry are exposed to humans, agents, and MCP clients."
    ],
    safeguards: [
      "Require minimum USDC seed before go-live.",
      "Quote pool creation and price impact before execution.",
      "Lock configured launch liquidity before public trading starts.",
      "Block agent liquidity removal unless explicit policy allows it.",
      "Emit receipts for token deploy, liquidity seed, lock, and go-live actions."
    ]
  },
  selfFunding: {
    model: "agent_token_fees_fund_compute",
    feeAsset: "USDC",
    defaultTradingFeeBps: DEFAULT_TRADING_FEE_BPS,
    defaultAgentFeeShareBps: DEFAULT_AGENT_FEE_SHARE_BPS,
    defaultComputeUsdPerDay: DEFAULT_COMPUTE_USD_PER_DAY,
    flow: [
      "Trading volume generates TOKEN/USDC fees.",
      "Agent fee share accrues to the launch treasury.",
      "The agent claims fees into compute credits.",
      "Runtime, API, MCP, and automation spend burns compute credits.",
      "Runway is exposed to humans, SDK clients, and autonomous agents."
    ],
    currentAdapter: "deterministic_local_fee_accrual",
    futureAdapter: "arc_pool_fee_reader"
  },
  agentAutonomy: {
    defaultMode: "policy_gated_autonomous",
    allowedWithoutHumanApproval: [
      "draft_launch",
      "simulate_launch",
      "read_launch_status",
      "monitor_pool",
      "publish_receipt",
      "run_scheduled_health_check"
    ],
    requiresPolicyGrant: [
      "deploy_token",
      "seed_liquidity",
      "open_trading",
      "increase_liquidity",
      "start_launch_automation"
    ],
    blockedByDefault: [
      "withdraw_locked_liquidity",
      "change_token_owner",
      "mint_extra_supply",
      "disable_receipts",
      "raise_spend_limit"
    ],
    policyInputs: [
      "creatorHandle",
      "maxBudgetUsd",
      "maxSlippage",
      "allowedRails",
      "liquidityLockDays",
      "launchWindow",
      "emergencyPauseHandle"
    ]
  },
  api: {
    current: [
      "GET /api/launchpad/architecture",
      "POST /api/launchpad/plan",
      "POST /api/launchpad/launches",
      "GET /api/launchpad/launches",
      "GET /api/launchpad/launches/:id",
      "POST /api/launchpad/launches/:id/deploy-token",
      "POST /api/launchpad/launches/:id/seed-liquidity",
      "POST /api/launchpad/launches/:id/go-live",
      "POST /api/launchpad/launches/:id/agent-policy",
      "GET /api/launchpad/launches/:id/receipt",
      "GET /api/launchpad/launches/:id/monitor",
      "GET /api/launchpad/launches/:id/fees",
      "POST /api/launchpad/launches/:id/fees/accrue",
      "POST /api/launchpad/launches/:id/fees/claim",
      "GET /api/launchpad/treasury",
      "POST /api/launchpad/treasury/spend",
      "GET /api/launchpad/feed"
    ],
    planned: [
      "POST /api/launchpad/launches/:id/dex-adapter"
    ]
  },
  sdk: {
    current: [
      "launchpadArchitecture()",
      "planTokenLaunch(args)",
      "createTokenLaunch(args)",
      "deployLaunchToken(launchId)",
      "seedLaunchLiquidity(launchId)",
      "openLaunchTrading(launchId)",
      "getLaunch(launchId)",
      "listLaunches(filter)",
      "updateLaunchAgentPolicy(launchId)",
      "getLaunchReceipt(launchId)",
      "monitorLaunch(launchId)",
      "getLaunchFees(launchId)",
      "accrueLaunchFees(launchId, args)",
      "claimLaunchFees(launchId, args)",
      "getAgentTreasury(filter)",
      "spendAgentCompute(args)",
      "listLaunchFeed(filter)"
    ]
  },
  mcp: {
    current: [
      "get_launchpad_architecture",
      "plan_token_launch",
      "create_token_launch",
      "deploy_launch_token",
      "seed_launch_liquidity",
      "open_launch_trading",
      "update_launch_agent_policy",
      "get_token_launch",
      "list_token_launches",
      "get_launch_receipt",
      "monitor_launch",
      "get_launch_fees",
      "accrue_launch_fees",
      "claim_launch_fees",
      "get_agent_treasury",
      "spend_agent_compute",
      "list_launch_feed"
    ],
    plannedTools: [
      "connect_launch_dex_adapter"
    ]
  },
  phases: [
    {
      id: "phase_1",
      label: "Planning and Receipts",
      status: "complete",
      deliverables: ["architecture endpoint", "SDK helpers", "launch plan simulator", "persistent launch receipts"]
    },
    {
      id: "phase_2",
      label: "Contracts",
      status: "complete",
      deliverables: ["token contract", "factory", "controller", "liquidity locker", "agent policy vault"]
    },
    {
      id: "phase_3",
      label: "Liquidity Execution",
      status: "local_adapter_ready",
      deliverables: ["launch-owned liquidity adapter", "creator USDC debit", "pool receipt", "liquidity lock receipt"]
    },
    {
      id: "phase_4",
      label: "Agent Autonomy",
      status: "complete",
      deliverables: ["MCP launch tools", "policy grants", "idempotent agent execution", "launch monitors"]
    },
    {
      id: "phase_5",
      label: "Self-Funding",
      status: "complete",
      deliverables: ["fee accrual", "agent treasury", "compute credits", "runway telemetry", "fee/treasury MCP tools"]
    }
  ]
};

export function getLaunchpadArchitecture() {
  return {
    ok: true,
    architecture: launchpadArchitecture
  };
}

export function planTokenLaunch(input = {}) {
  const token = {
    name: cleanText(input.name || input.tokenName || "Example Arc Token", 80),
    symbol: cleanSymbol(input.symbol || "ARCX"),
    totalSupply: positiveNumber(input.totalSupply, 1_000_000),
    creatorHandle: normalizeHandle(input.creatorHandle || input.handle || "@sara")
  };
  const liquiditySeedUsd = positiveNumber(input.liquiditySeedUsd || input.seedUsd, launchpadArchitecture.liquidity.defaultSeedUsd);
  const lockDays = positiveNumber(input.liquidityLockDays || input.lockDays, 90);
  const maxSlippage = positiveNumber(input.maxSlippage, 0.01);

  const warnings = [];
  if (liquiditySeedUsd < launchpadArchitecture.liquidity.minimumSeedUsd) {
    warnings.push(`Liquidity seed is below the recommended minimum of $${launchpadArchitecture.liquidity.minimumSeedUsd}.`);
  }
  if (lockDays < 30) {
    warnings.push("Liquidity lock is shorter than 30 days.");
  }
  if (maxSlippage > 0.05) {
    warnings.push("Max slippage is above 5%.");
  }

  const launchId = `launch_plan_${token.symbol.toLowerCase()}_${Date.now()}`;
  return {
    ok: true,
    status: "plan_only",
    launchId,
    token,
    chain: launchpadArchitecture.chain,
    liquidity: {
      baseAsset: "USDC",
      seedUsd: liquiditySeedUsd,
      lockDays,
      maxSlippage,
      poolType: input.poolType || "constant_product_pool"
    },
    agentPolicy: {
      mode: input.agentMode || launchpadArchitecture.agentAutonomy.defaultMode,
      maxBudgetUsd: positiveNumber(input.maxBudgetUsd, liquiditySeedUsd),
      allowedActions: launchpadArchitecture.agentAutonomy.allowedWithoutHumanApproval,
      requiresPolicyGrant: launchpadArchitecture.agentAutonomy.requiresPolicyGrant
    },
    steps: launchpadArchitecture.lifecycle,
    warnings,
    nextActions: [
      "Create a persistent launch draft.",
      "Deploy the launch token through the deterministic Arc launch factory adapter.",
      "Seed TOKEN/USDC launch-owned liquidity and lock it.",
      "Open trading and publish the launch receipt."
    ]
  };
}

export function createTokenLaunch(input = {}) {
  const replay = idempotentReplay(input.idempotencyKey);
  if (replay) return replay;

  const plan = planTokenLaunch(input);
  const now = new Date().toISOString();
  const launch = {
    id: nextTokenLaunchId(),
    status: "draft",
    stage: "draft",
    creatorHandle: plan.token.creatorHandle,
    token: plan.token,
    chain: plan.chain,
    liquidity: {
      ...plan.liquidity,
      status: "not_seeded",
      seededAt: null,
      poolAddress: null,
      lockId: null,
      lpReceiptId: null
    },
    agentPolicy: {
      ...plan.agentPolicy,
      grants: normalizeLaunchGrants(input.grants || input.allowedActions),
      blockedActions: launchpadArchitecture.agentAutonomy.blockedByDefault,
      updatedAt: now
    },
    fees: buildInitialFeeState(input),
    signer: circleUserSigner({
      operation: "create_token_launch",
      settlementRail: plan.chain.id,
      requiresUserApproval: false,
      executionStatus: "planned"
    }),
    deployment: null,
    receipts: [],
    monitors: [],
    warnings: plan.warnings,
    nextActions: ["deploy_token", "seed_liquidity", "open_trading"],
    createdAt: now,
    updatedAt: now
  };

  ledger.tokenLaunches ||= [];
  ledger.tokenLaunches.push(launch);
  recordLaunchEvent("token_launch_created", launch);
  rememberIdempotent(input.idempotencyKey, { ok: true, launch });
  return { ok: true, launch };
}

export function listTokenLaunches({ creatorHandle, status, limit = 50 } = {}) {
  const normalized = creatorHandle ? normalizeHandle(creatorHandle) : null;
  const launches = (ledger.tokenLaunches || [])
    .filter((launch) => (
      (!normalized || launch.creatorHandle === normalized)
      && (!status || launch.status === status)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 50)
    .map(publicLaunch);
  return { ok: true, launches };
}

export function getTokenLaunch({ launchId } = {}) {
  return { ok: true, launch: publicLaunch(requireLaunch(launchId)) };
}

export function listLaunchFeed({ status = "live", creatorHandle, limit = 25 } = {}) {
  const normalized = creatorHandle ? normalizeHandle(creatorHandle) : null;
  const launches = (ledger.tokenLaunches || [])
    .filter((launch) => !status || launch.status === status)
    .filter((launch) => !normalized || launch.creatorHandle === normalized)
    .slice()
    .reverse()
    .slice(0, Number(limit) || 25)
    .map((launch) => {
      const fees = publicFees(ensureLaunchFunding(launch));
      return {
        id: launch.id,
        status: launch.status,
        creatorHandle: launch.creatorHandle,
        token: launch.token,
        chain: launch.chain,
        market: launch.market || null,
        liquidity: {
          seedUsd: launch.liquidity?.seedUsd || 0,
          lockStatus: launch.liquidity?.lockId ? "locked" : "not_locked",
          lockExpiresAt: launch.liquidity?.lockExpiresAt || null,
          poolAddress: launch.liquidity?.poolAddress || null
        },
        fees: {
          grossFeesUsd: fees.grossFeesUsd,
          agentFeesAccruedUsd: fees.agentFeesAccruedUsd,
          claimableUsd: fees.claimableUsd,
          computeCreditsUsd: fees.computeCreditsUsd,
          runwayDays: fees.runwayDays
        },
        risk: {
          liquidityLocked: Boolean(launch.liquidity?.lockId),
          backendSignerAllowed: false
        },
        updatedAt: launch.updatedAt
      };
    });
  return { ok: true, launches };
}

export function deployLaunchToken({ launchId, handle, idempotencyKey } = {}) {
  const replay = idempotentReplay(idempotencyKey);
  if (replay) return replay;

  const launch = requireLaunch(launchId);
  assertLaunchActor(launch, handle);
  if (launch.deployment?.tokenAddress) {
    return { ok: true, launch: publicLaunch(launch), idempotentReplay: true };
  }
  if (!["draft", "reviewed"].includes(launch.status)) {
    throw new Error(`Launch cannot deploy from status ${launch.status}`);
  }
  assertGrant(launch, "deploy_token");

  const salt = stableHex(["token", launch.id, launch.token.symbol], 32);
  const tokenAddress = addressFrom(["ArcLaunchToken", launch.id, launch.token.symbol]);
  const factoryAddress = addressFrom(["ArcLaunchFactory", "local", launch.chain.id]);
  const txHash = txHashFrom(["deploy", launch.id, tokenAddress]);
  const now = new Date().toISOString();

  launch.status = "token_deployed";
  launch.stage = "token_deploy";
  launch.deployment = {
    tokenAddress,
    factoryAddress,
    salt,
    txHash,
    metadataHash: stableHex(["metadata", launch.id, launch.token.name, launch.token.symbol], 32),
    deployedAt: now,
    mode: "deterministic_local_arc_deploy",
    contract: "ArcLaunchToken"
  };
  launch.receipts.push(receipt("token_deployed", launch, {
    txHash,
    tokenAddress,
    factoryAddress
  }));
  touch(launch);
  recordLaunchEvent("token_launch_deployed", launch, { txHash, tokenAddress });
  const result = { ok: true, launch: publicLaunch(launch), txHash, tokenAddress };
  rememberIdempotent(idempotencyKey, result);
  return result;
}

export function seedLaunchLiquidity({ launchId, handle, idempotencyKey, amountUsd } = {}) {
  const replay = idempotentReplay(idempotencyKey);
  if (replay) return replay;

  const launch = requireLaunch(launchId);
  assertLaunchActor(launch, handle);
  if (launch.status === "liquidity_seeded" || launch.status === "live") {
    return { ok: true, launch: publicLaunch(launch), idempotentReplay: true };
  }
  if (launch.status !== "token_deployed") {
    throw new Error("Deploy the launch token before seeding liquidity.");
  }
  assertGrant(launch, "seed_liquidity");

  const seedUsd = Number(amountUsd || launch.liquidity.seedUsd);
  if (seedUsd < launchpadArchitecture.liquidity.minimumSeedUsd) {
    throw new Error(`Liquidity seed must be at least $${launchpadArchitecture.liquidity.minimumSeedUsd}.`);
  }
  debitCreatorBalance(launch.creatorHandle, seedUsd, launch.chain.id);

  const poolAddress = addressFrom(["ArcLaunchPool", launch.id, launch.deployment.tokenAddress, "USDC"]);
  const lockId = `lock_${stableHex(["liquidity", launch.id], 8)}`;
  const lpReceiptId = `lp_${stableHex(["lp", launch.id], 8)}`;
  const txHash = txHashFrom(["seed", launch.id, poolAddress, seedUsd]);
  const now = new Date().toISOString();

  launch.status = "liquidity_seeded";
  launch.stage = "liquidity_seed";
  launch.liquidity = {
    ...launch.liquidity,
    seedUsd,
    status: "seeded",
    poolAddress,
    lockId,
    lpReceiptId,
    seededAt: now,
    txHash,
    adapter: "launch_owned_liquidity_local",
    lockExpiresAt: new Date(Date.now() + Number(launch.liquidity.lockDays || 90) * 24 * 60 * 60_000).toISOString()
  };
  launch.receipts.push(receipt("liquidity_seeded", launch, {
    txHash,
    poolAddress,
    lockId,
    lpReceiptId,
    seedUsd
  }));
  touch(launch);
  recordLaunchEvent("token_launch_liquidity_seeded", launch, { txHash, poolAddress, seedUsd });
  const result = { ok: true, launch: publicLaunch(launch), txHash, poolAddress, lockId };
  rememberIdempotent(idempotencyKey, result);
  return result;
}

export function openLaunchTrading({ launchId, handle, idempotencyKey } = {}) {
  const replay = idempotentReplay(idempotencyKey);
  if (replay) return replay;

  const launch = requireLaunch(launchId);
  assertLaunchActor(launch, handle);
  if (launch.status === "live") {
    return { ok: true, launch: publicLaunch(launch), idempotentReplay: true };
  }
  if (launch.status !== "liquidity_seeded") {
    throw new Error("Seed and lock liquidity before opening trading.");
  }
  assertGrant(launch, "open_trading");

  const txHash = txHashFrom(["go-live", launch.id, launch.liquidity.poolAddress]);
  launch.status = "live";
  launch.stage = "go_live";
  launch.liveAt = new Date().toISOString();
  launch.market = {
    pair: `${launch.token.symbol}/USDC`,
    poolAddress: launch.liquidity.poolAddress,
    explorerUrl: explorerUrl(txHash),
    status: "live"
  };
  launch.receipts.push(receipt("trading_opened", launch, {
    txHash,
    poolAddress: launch.liquidity.poolAddress,
    pair: launch.market.pair
  }));
  touch(launch);
  recordLaunchEvent("token_launch_trading_opened", launch, { txHash, poolAddress: launch.liquidity.poolAddress });
  const result = { ok: true, launch: publicLaunch(launch), txHash, market: launch.market };
  rememberIdempotent(idempotencyKey, result);
  return result;
}

export function updateLaunchAgentPolicy({ launchId, handle, grants, maxBudgetUsd, maxSlippage, liquidityLockDays } = {}) {
  const launch = requireLaunch(launchId);
  assertLaunchActor(launch, handle);
  launch.agentPolicy = {
    ...launch.agentPolicy,
    ...(grants ? { grants: normalizeLaunchGrants(grants) } : {}),
    ...(maxBudgetUsd ? { maxBudgetUsd: Number(maxBudgetUsd) } : {}),
    ...(maxSlippage ? { maxSlippage: Number(maxSlippage) } : {}),
    updatedAt: new Date().toISOString()
  };
  if (liquidityLockDays) {
    launch.liquidity.lockDays = Number(liquidityLockDays);
  }
  touch(launch);
  recordLaunchEvent("token_launch_policy_updated", launch, { grants: launch.agentPolicy.grants });
  return { ok: true, launch: publicLaunch(launch) };
}

export function monitorLaunch({ launchId } = {}) {
  const launch = requireLaunch(launchId);
  const fees = publicFees(ensureLaunchFunding(launch));
  const monitor = {
    ok: true,
    launchId: launch.id,
    status: launch.status,
    pair: launch.market?.pair || `${launch.token.symbol}/USDC`,
    poolAddress: launch.liquidity.poolAddress,
    liquiditySeedUsd: launch.liquidity.seedUsd,
    lockStatus: launch.liquidity.lockId ? "locked" : "not_locked",
    lockExpiresAt: launch.liquidity.lockExpiresAt || null,
    routeHealth: launch.status === "live" ? "local_pool_ready" : "not_live",
    treasury: {
      claimableUsd: fees.claimableUsd,
      computeCreditsUsd: fees.computeCreditsUsd,
      runwayDays: fees.runwayDays,
      status: fees.runwayDays > 0 ? "funded" : "unfunded"
    },
    warnings: launchWarnings(launch),
    nextAction: nextLaunchAction(launch),
    checkedAt: new Date().toISOString()
  };
  launch.monitors ||= [];
  launch.monitors.push(monitor);
  touch(launch);
  return { ok: true, monitor, launch: publicLaunch(launch) };
}

export function getLaunchFees({ launchId } = {}) {
  const launch = requireLaunch(launchId);
  return {
    ok: true,
    launchId: launch.id,
    creatorHandle: launch.creatorHandle,
    token: launch.token,
    fees: publicFees(ensureLaunchFunding(launch))
  };
}

export function accrueLaunchFees({ launchId, handle, volumeUsd, feeUsd, source = "simulated_trade", idempotencyKey } = {}) {
  const replay = idempotentReplay(idempotencyKey);
  if (replay) return replay;

  const launch = requireLaunch(launchId);
  if (handle) assertLaunchActor(launch, handle);
  if (launch.status !== "live") {
    throw new Error("Launch must be live before fees can accrue.");
  }
  const fees = ensureLaunchFunding(launch);
  const volume = positiveNumber(volumeUsd, 0);
  const grossFee = feeUsd !== undefined
    ? positiveNumber(feeUsd, 0)
    : roundUsd(volume * Number(fees.tradingFeeBps || DEFAULT_TRADING_FEE_BPS) / 10_000);
  assertPositiveAmount(grossFee, "Fee amount");
  const agentFee = roundUsd(grossFee * Number(fees.agentFeeShareBps || DEFAULT_AGENT_FEE_SHARE_BPS) / 10_000);
  const protocolFee = roundUsd(grossFee - agentFee);
  const event = feeEvent("fee_accrued", launch, {
    volumeUsd: volume,
    grossFeeUsd: grossFee,
    agentFeeUsd: agentFee,
    protocolFeeUsd: protocolFee,
    source
  });

  fees.totalVolumeUsd = roundUsd(Number(fees.totalVolumeUsd || 0) + volume);
  fees.grossFeesUsd = roundUsd(Number(fees.grossFeesUsd || 0) + grossFee);
  fees.agentFeesAccruedUsd = roundUsd(Number(fees.agentFeesAccruedUsd || 0) + agentFee);
  fees.protocolFeesUsd = roundUsd(Number(fees.protocolFeesUsd || 0) + protocolFee);
  fees.claimableUsd = roundUsd(Number(fees.claimableUsd || 0) + agentFee);
  fees.events.push(event);
  fees.updatedAt = event.at;
  launch.receipts.push(receipt("fees_accrued", launch, {
    grossFeeUsd: grossFee,
    agentFeeUsd: agentFee,
    source
  }));
  touch(launch);
  recordLaunchEvent("token_launch_fees_accrued", launch, {
    volumeUsd: volume,
    grossFeeUsd: grossFee,
    agentFeeUsd: agentFee
  });
  const result = {
    ok: true,
    launch: publicLaunch(launch),
    event,
    fees: publicFees(fees),
    treasury: getAgentTreasury({ handle: launch.creatorHandle }).treasury
  };
  rememberIdempotent(idempotencyKey, result);
  return result;
}

export function claimLaunchFees({ launchId, handle, amountUsd, destination = "compute_credits", idempotencyKey } = {}) {
  const replay = idempotentReplay(idempotencyKey);
  if (replay) return replay;

  const launch = requireLaunch(launchId);
  assertLaunchActor(launch, handle);
  const fees = ensureLaunchFunding(launch);
  const claimable = Number(fees.claimableUsd || 0);
  if (claimable <= 0) {
    throw new Error("No launch fees are claimable yet.");
  }
  const amount = amountUsd === undefined ? claimable : Math.min(positiveNumber(amountUsd, 0), claimable);
  assertPositiveAmount(amount, "Claim amount");
  const target = String(destination || "compute_credits");
  const event = feeEvent("fees_claimed", launch, {
    amountUsd: amount,
    destination: target
  });

  fees.claimableUsd = roundUsd(claimable - amount);
  fees.claimedUsd = roundUsd(Number(fees.claimedUsd || 0) + amount);
  if (target === "wallet") {
    creditCreatorBalance(launch.creatorHandle, amount, launch.chain.id);
  } else {
    fees.computeCreditsUsd = roundUsd(Number(fees.computeCreditsUsd || 0) + amount);
  }
  fees.events.push(event);
  fees.updatedAt = event.at;
  launch.receipts.push(receipt("fees_claimed", launch, {
    amountUsd: amount,
    destination: target
  }));
  touch(launch);
  recordLaunchEvent("token_launch_fees_claimed", launch, {
    amountUsd: amount,
    destination: target
  });
  const result = {
    ok: true,
    launch: publicLaunch(launch),
    event,
    fees: publicFees(fees),
    treasury: getAgentTreasury({ handle: launch.creatorHandle }).treasury
  };
  rememberIdempotent(idempotencyKey, result);
  return result;
}

export function spendAgentCompute({ handle, launchId, amountUsd, purpose = "agent_runtime", idempotencyKey } = {}) {
  const replay = idempotentReplay(idempotencyKey);
  if (replay) return replay;

  const normalized = normalizeHandle(handle || "@sara");
  const amount = positiveNumber(amountUsd, 0);
  assertPositiveAmount(amount, "Compute spend");
  const launches = (ledger.tokenLaunches || [])
    .filter((launch) => launch.creatorHandle === normalized)
    .filter((launch) => !launchId || launch.id === launchId);
  if (!launches.length) {
    throw new Error("No token launch treasury found for this agent.");
  }
  const available = roundUsd(launches.reduce((sum, launch) => (
    sum + Number(ensureLaunchFunding(launch).computeCreditsUsd || 0)
  ), 0));
  if (available < amount) {
    throw new Error("Insufficient compute credits in agent treasury.");
  }

  let remaining = amount;
  const spendEvents = [];
  for (const launch of launches) {
    if (remaining <= 0) break;
    const fees = ensureLaunchFunding(launch);
    const spend = Math.min(Number(fees.computeCreditsUsd || 0), remaining);
    if (spend <= 0) continue;
    const event = feeEvent("compute_spent", launch, {
      amountUsd: roundUsd(spend),
      purpose
    });
    fees.computeCreditsUsd = roundUsd(Number(fees.computeCreditsUsd || 0) - spend);
    fees.spentUsd = roundUsd(Number(fees.spentUsd || 0) + spend);
    fees.events.push(event);
    fees.updatedAt = event.at;
    launch.receipts.push(receipt("compute_spent", launch, {
      amountUsd: roundUsd(spend),
      purpose
    }));
    touch(launch);
    recordLaunchEvent("agent_compute_spent", launch, {
      amountUsd: roundUsd(spend),
      purpose
    });
    spendEvents.push(event);
    remaining = roundUsd(remaining - spend);
  }

  const result = {
    ok: true,
    handle: normalized,
    amountUsd: amount,
    purpose,
    events: spendEvents,
    treasury: getAgentTreasury({ handle: normalized }).treasury
  };
  rememberIdempotent(idempotencyKey, result);
  return result;
}

export function getAgentTreasury({ handle = "@sara", limit = 25 } = {}) {
  const normalized = normalizeHandle(handle);
  const launches = (ledger.tokenLaunches || [])
    .filter((launch) => launch.creatorHandle === normalized)
    .map((launch) => publicLaunch(launch));
  const treasury = aggregateTreasury(normalized, launches);
  return {
    ok: true,
    treasury: {
      ...treasury,
      launches: launches
        .slice()
        .sort((a, b) => Number(b.fees?.availableForComputeUsd || 0) - Number(a.fees?.availableForComputeUsd || 0))
        .slice(0, Number(limit) || 25)
        .map((launch) => ({
          id: launch.id,
          status: launch.status,
          token: launch.token,
          market: launch.market || null,
          fees: launch.fees
        }))
    }
  };
}

export function getLaunchReceipt({ launchId, host, protocol = "http" } = {}) {
  const launch = requireLaunch(launchId);
  const origin = host ? `${protocol}://${host}` : "";
  return {
    ok: true,
    receipt: {
      id: `receipt_${launch.id}`,
      publicUrl: origin ? `${origin}/launchpad/${encodeURIComponent(launch.id)}` : null,
      launch: publicLaunch(launch),
      timeline: launch.receipts || [],
      latest: launch.receipts?.at(-1) || null,
      fees: publicFees(ensureLaunchFunding(launch)),
      security: {
        backendSignerAllowed: false,
        liquidityLocked: Boolean(launch.liquidity.lockId),
        agentPolicy: launch.agentPolicy
      }
    }
  };
}

export function ensureLaunchApproval({ launch, action, risk = "high" }) {
  return createApproval({
    handle: launch.creatorHandle,
    kind: `token_launch_${action}`,
    targetId: launch.id,
    title: `Approve ${action.replaceAll("_", " ")} for ${launch.token.symbol}`,
    summary: `Allow bunOS to run ${action.replaceAll("_", " ")} for ${launch.token.symbol} on ${launch.chain.name}.`,
    risk,
    metadata: {
      launchId: launch.id,
      action,
      token: launch.token,
      liquidity: launch.liquidity
    }
  });
}

function cleanText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function requireLaunch(launchId) {
  const launch = (ledger.tokenLaunches || []).find((item) => item.id === launchId);
  if (!launch) throw new Error("Token launch not found");
  return launch;
}

function publicLaunch(launch) {
  const fees = publicFees(ensureLaunchFunding(launch));
  return {
    ...launch,
    fees,
    receipts: launch.receipts || [],
    monitors: (launch.monitors || []).slice(-5)
  };
}

function assertLaunchActor(launch, handle) {
  const actor = normalizeHandle(handle || launch.creatorHandle);
  if (actor !== launch.creatorHandle) {
    throw new Error("Launch action does not belong to this handle");
  }
}

function assertGrant(launch, action) {
  if (launch.agentPolicy?.grants?.includes(action) || launch.agentPolicy?.grants?.includes("all")) {
    return true;
  }
  const approval = ensureLaunchApproval({ launch, action });
  const error = new Error(`${action} requires a launch policy grant or approval.`);
  error.status = 409;
  error.approval = approval;
  throw error;
}

function normalizeLaunchGrants(grants) {
  const values = Array.isArray(grants) ? grants : String(grants || "").split(",");
  const clean = values.map((item) => String(item).trim()).filter(Boolean);
  return clean.length ? clean : ["deploy_token", "seed_liquidity", "open_trading"];
}

function debitCreatorBalance(handle, amount, rail) {
  const user = users.get(normalizeHandle(handle));
  if (!user) throw new Error("Launch creator not found");
  user.balances ||= {};
  const current = Number(user.balances[rail] || 0);
  if (current < Number(amount)) {
    throw new Error("Insufficient USDC balance for launch liquidity seed");
  }
  user.balances[rail] = roundUsd(current - Number(amount));
  user.balance = roundUsd(Object.values(user.balances).reduce((sum, value) => sum + Number(value || 0), 0));
}

function creditCreatorBalance(handle, amount, rail) {
  const user = users.get(normalizeHandle(handle));
  if (!user) throw new Error("Launch creator not found");
  user.balances ||= {};
  user.balances[rail] = roundUsd(Number(user.balances[rail] || 0) + Number(amount));
  user.balance = roundUsd(Object.values(user.balances).reduce((sum, value) => sum + Number(value || 0), 0));
}

function buildInitialFeeState(input = {}) {
  const now = new Date().toISOString();
  return {
    asset: "USDC",
    adapter: launchpadArchitecture.selfFunding.currentAdapter,
    tradingFeeBps: positiveNumber(input.tradingFeeBps, DEFAULT_TRADING_FEE_BPS),
    agentFeeShareBps: positiveNumber(input.agentFeeShareBps, DEFAULT_AGENT_FEE_SHARE_BPS),
    computeUsdPerDay: positiveNumber(input.computeUsdPerDay, DEFAULT_COMPUTE_USD_PER_DAY),
    totalVolumeUsd: 0,
    grossFeesUsd: 0,
    agentFeesAccruedUsd: 0,
    protocolFeesUsd: 0,
    claimableUsd: 0,
    claimedUsd: 0,
    computeCreditsUsd: 0,
    spentUsd: 0,
    events: [],
    createdAt: now,
    updatedAt: now
  };
}

function ensureLaunchFunding(launch) {
  launch.fees ||= buildInitialFeeState();
  launch.fees.asset ||= "USDC";
  launch.fees.adapter ||= launchpadArchitecture.selfFunding.currentAdapter;
  launch.fees.tradingFeeBps ||= DEFAULT_TRADING_FEE_BPS;
  launch.fees.agentFeeShareBps ||= DEFAULT_AGENT_FEE_SHARE_BPS;
  launch.fees.computeUsdPerDay ||= DEFAULT_COMPUTE_USD_PER_DAY;
  launch.fees.totalVolumeUsd ||= 0;
  launch.fees.grossFeesUsd ||= 0;
  launch.fees.agentFeesAccruedUsd ||= 0;
  launch.fees.protocolFeesUsd ||= 0;
  launch.fees.claimableUsd ||= 0;
  launch.fees.claimedUsd ||= 0;
  launch.fees.computeCreditsUsd ||= 0;
  launch.fees.spentUsd ||= 0;
  launch.fees.events ||= [];
  launch.fees.createdAt ||= launch.createdAt || new Date().toISOString();
  launch.fees.updatedAt ||= launch.updatedAt || launch.fees.createdAt;
  return launch.fees;
}

function publicFees(fees) {
  const computeUsdPerDay = Number(fees.computeUsdPerDay || DEFAULT_COMPUTE_USD_PER_DAY);
  const computeCreditsUsd = roundUsd(fees.computeCreditsUsd);
  const claimableUsd = roundUsd(fees.claimableUsd);
  const availableForComputeUsd = roundUsd(computeCreditsUsd + claimableUsd);
  return {
    asset: fees.asset || "USDC",
    adapter: fees.adapter || launchpadArchitecture.selfFunding.currentAdapter,
    tradingFeeBps: Number(fees.tradingFeeBps || DEFAULT_TRADING_FEE_BPS),
    agentFeeShareBps: Number(fees.agentFeeShareBps || DEFAULT_AGENT_FEE_SHARE_BPS),
    computeUsdPerDay,
    totalVolumeUsd: roundUsd(fees.totalVolumeUsd),
    grossFeesUsd: roundUsd(fees.grossFeesUsd),
    agentFeesAccruedUsd: roundUsd(fees.agentFeesAccruedUsd),
    protocolFeesUsd: roundUsd(fees.protocolFeesUsd),
    claimableUsd,
    claimedUsd: roundUsd(fees.claimedUsd),
    computeCreditsUsd,
    spentUsd: roundUsd(fees.spentUsd),
    availableForComputeUsd,
    runwayDays: computeUsdPerDay > 0 ? roundUsd(availableForComputeUsd / computeUsdPerDay) : 0,
    status: availableForComputeUsd > 0 ? "self_funding" : "not_funded",
    events: (fees.events || []).slice(-12),
    updatedAt: fees.updatedAt || null
  };
}

function aggregateTreasury(handle, launches) {
  const totals = launches.reduce((sum, launch) => {
    const fees = publicFees(ensureLaunchFunding(launch));
    return {
      totalVolumeUsd: sum.totalVolumeUsd + fees.totalVolumeUsd,
      grossFeesUsd: sum.grossFeesUsd + fees.grossFeesUsd,
      agentFeesAccruedUsd: sum.agentFeesAccruedUsd + fees.agentFeesAccruedUsd,
      protocolFeesUsd: sum.protocolFeesUsd + fees.protocolFeesUsd,
      claimableUsd: sum.claimableUsd + fees.claimableUsd,
      claimedUsd: sum.claimedUsd + fees.claimedUsd,
      computeCreditsUsd: sum.computeCreditsUsd + fees.computeCreditsUsd,
      spentUsd: sum.spentUsd + fees.spentUsd,
      computeUsdPerDay: Math.max(sum.computeUsdPerDay, fees.computeUsdPerDay || DEFAULT_COMPUTE_USD_PER_DAY)
    };
  }, {
    totalVolumeUsd: 0,
    grossFeesUsd: 0,
    agentFeesAccruedUsd: 0,
    protocolFeesUsd: 0,
    claimableUsd: 0,
    claimedUsd: 0,
    computeCreditsUsd: 0,
    spentUsd: 0,
    computeUsdPerDay: DEFAULT_COMPUTE_USD_PER_DAY
  });
  const computeUsdPerDay = Number(totals.computeUsdPerDay || DEFAULT_COMPUTE_USD_PER_DAY);
  const availableForComputeUsd = roundUsd(totals.computeCreditsUsd + totals.claimableUsd);
  return {
    handle,
    asset: "USDC",
    launchCount: launches.length,
    liveLaunchCount: launches.filter((launch) => launch.status === "live").length,
    totalVolumeUsd: roundUsd(totals.totalVolumeUsd),
    grossFeesUsd: roundUsd(totals.grossFeesUsd),
    agentFeesAccruedUsd: roundUsd(totals.agentFeesAccruedUsd),
    protocolFeesUsd: roundUsd(totals.protocolFeesUsd),
    claimableUsd: roundUsd(totals.claimableUsd),
    claimedUsd: roundUsd(totals.claimedUsd),
    computeCreditsUsd: roundUsd(totals.computeCreditsUsd),
    spentUsd: roundUsd(totals.spentUsd),
    availableForComputeUsd,
    computeUsdPerDay,
    runwayDays: computeUsdPerDay > 0 ? roundUsd(availableForComputeUsd / computeUsdPerDay) : 0,
    status: availableForComputeUsd > 0 ? "self_funding" : "not_funded",
    updatedAt: new Date().toISOString()
  };
}

function feeEvent(type, launch, data = {}) {
  return {
    id: `fee_${stableHex([type, launch.id, Date.now(), JSON.stringify(data)], 8)}`,
    type,
    at: new Date().toISOString(),
    launchId: launch.id,
    tokenSymbol: launch.token.symbol,
    ...data
  };
}

function assertPositiveAmount(amount, label) {
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }
}

function receipt(type, launch, data = {}) {
  return {
    id: `lrec_${stableHex([type, launch.id, Date.now()], 8)}`,
    type,
    at: new Date().toISOString(),
    launchId: launch.id,
    status: launch.status,
    ...data,
    explorerUrl: data.txHash ? explorerUrl(data.txHash) : null
  };
}

function touch(launch) {
  launch.updatedAt = new Date().toISOString();
}

function recordLaunchEvent(type, launch, extra = {}) {
  ledger.events.push({
    id: nextEventId(),
    type,
    at: new Date().toISOString(),
    handle: launch.creatorHandle,
    launchId: launch.id,
    status: launch.status,
    tokenSymbol: launch.token.symbol,
    ...extra
  });
}

function nextLaunchAction(launch) {
  if (launch.status === "draft" || launch.status === "reviewed") return "deploy_token";
  if (launch.status === "token_deployed") return "seed_liquidity";
  if (launch.status === "liquidity_seeded") return "open_trading";
  if (launch.status === "live") return "monitor_launch";
  return "review_launch";
}

function launchWarnings(launch) {
  const warnings = [...(launch.warnings || [])];
  if (!launch.deployment?.tokenAddress) warnings.push("Token has not been deployed.");
  if (!launch.liquidity?.lockId) warnings.push("Launch liquidity is not locked.");
  if (launch.status !== "live") warnings.push("Trading is not open yet.");
  return warnings;
}

function idempotentReplay(key) {
  if (!key) return null;
  return ledger.idempotency?.get(key)?.result || null;
}

function rememberIdempotent(key, result) {
  if (!key) return result;
  ledger.idempotency ||= new Map();
  ledger.idempotency.set(key, {
    result,
    createdAt: new Date().toISOString()
  });
  return result;
}

function addressFrom(parts) {
  return `0x${stableHex(parts, 20)}`;
}

function txHashFrom(parts) {
  return `0x${stableHex(parts, 32)}`;
}

function stableHex(parts, bytes) {
  return createHash("sha256").update(parts.map((part) => String(part || "")).join("|")).digest("hex").slice(0, bytes * 2);
}

function explorerUrl(txHash) {
  return `https://testnet.arcscan.app/tx/${txHash}`;
}

function roundUsd(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function cleanSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return symbol || "ARCX";
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
