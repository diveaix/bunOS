import { createPaymentIntent, createSocialBounty } from "./orchestrator.js";
import { confirmAction } from "./agentActions.js";
import { listAgentTools, planAgentActionWithModel, runAgentAction } from "./agentPlanner.js";
import {
  getArcPerpsPosition,
  getArcPerpsReadiness,
  getArcPerpsStatus,
  listArcPerpsPositions,
  openArcPerpPositionWithUserWallet,
  quoteArcPerpPosition,
  readArcPerpsOraclePrice,
  closeArcPerpPositionWithUserWallet,
  syncArcPerpsOracleFromHyperliquid
} from "./arcPerpsEngine.js";
import { listApprovals } from "./approvals.js";
import { getPaymentReceipt } from "./queries.js";
import {
  createWallet,
  fundWallet,
  getWalletCapabilities,
  getWalletProfile,
  syncWalletBalances
} from "./walletAccounts.js";
import {
  confirmDefiAction,
  getDefiActionReceipt,
  listDefiActions,
  listDefiRouteCapabilities,
  listDefiTools,
  listPerpMarkets,
  probeDefiRouteCapabilities,
  probeDefiRouteCapability,
  quoteDefiRoute
} from "./defiOrchestrator.js";
import { enqueueJob, runJob } from "./jobs.js";
import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  pauseAutomations,
  runAutomation,
  runDueAutomations,
  updateAutomation
} from "./automations.js";
import {
  awardAirdrop,
  createAirdrop,
  getAirdropReceipt,
  listAirdrops
} from "./airdrops.js";
import { refreshExecutionMonitor } from "./executionMonitor.js";
import { analyzePortfolio } from "./portfolioBrain.js";
import { listArcTradingPrimitives } from "./arcTradingPrimitives.js";
import {
  assessLiquidationRisk,
  listPerpIntelligence,
  listPerpProposals,
  proposePerpTrade
} from "./perpsAgent.js";
import {
  listCopyTradeProposals,
  proposeCopyTrade
} from "./socialTradingAgent.js";
import {
  estimateAppKitBridge,
  estimateAppKitSend,
  estimateAppKitSwap,
  executeAppKitBridge,
  executeAppKitSend,
  executeAppKitSwap,
  getAppKitReadiness,
  getAppKitUnifiedBalance,
  listAppKitCapabilities
} from "./appKitAgentTools.js";
import {
  createStrategyPolicy,
  listStrategyPolicies,
  planRebalanceStrategy,
  reduceRiskStrategy,
  runStrategyCheck
} from "./strategyAgent.js";
import { getMarketIntelligence } from "./marketIntelligence.js";
import { refreshMarketFeedSnapshot } from "./marketFeeds.js";
import {
  buildAgentMemoryReport
} from "./agentMemory.js";
import {
  createMandate,
  deleteMandate,
  listMandates,
  updateMandate
} from "./mandates.js";

export const mcpTools = [
  {
    name: "plan_agent_action",
    description: "Plan a natural-language agent request into a strict allowlisted tool call with signer and risk metadata. Does not execute.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        text: { type: "string" },
        defaultSettlementRail: { type: "string" },
        source: { type: "string" }
      },
      required: ["text"]
    }
  },
  {
    name: "run_agent_action",
    description: "Plan a natural-language agent request, then execute only the safe allowlisted backend step. Money-moving actions remain approval/user-wallet gated.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        text: { type: "string" },
        defaultSettlementRail: { type: "string" },
        source: { type: "string" },
        postId: { type: "string" },
        idempotencyKey: { type: "string" }
      },
      required: ["text"]
    }
  },
  {
    name: "get_agent_memory",
    description: "Read the agent's wallet memory: recent trades, perps, pending approvals, active automations, failures, and last known action.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        limit: { type: "number" }
      },
      required: ["handle"]
    }
  },
  {
    name: "list_agent_tools",
    description: "List tools the AI agent planner is allowed to call.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "list_arc_trading_primitives",
    description: "List the real Arc trading primitives exposed by bunOS: swaps, bridges, perps, airdrops, bounties, and automations, including provider readiness and signer policy.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "create_airdrop",
    description: "Create a USDC airdrop from a user's Circle wallet to fixed X handles or a social winner set. Known recipients distribute through payment jobs; social airdrops wait for award_airdrop.",
    inputSchema: {
      type: "object",
      properties: {
        senderHandle: { type: "string" },
        recipients: { type: "array", items: { type: "string" } },
        amount: { type: "number" },
        amountPerRecipient: { type: "number" },
        maxRecipients: { type: "number" },
        postId: { type: "string" },
        rule: { type: "string" },
        settlementRail: { type: "string" },
        memo: { type: "string" }
      },
      required: ["senderHandle"]
    }
  },
  {
    name: "award_airdrop",
    description: "Award a social airdrop to the selected X handles. Each winner is paid through the same policy-gated Circle user-wallet payment path.",
    inputSchema: {
      type: "object",
      properties: {
        airdropId: { type: "string" },
        winnerHandles: { type: "array", items: { type: "string" } },
        recipients: { type: "array", items: { type: "string" } }
      },
      required: ["airdropId"]
    }
  },
  {
    name: "list_airdrops",
    description: "List USDC airdrop campaigns and distribution state.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        status: { type: "string" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "get_airdrop_receipt",
    description: "Get an airdrop receipt with approval, distribution payments, timeline, and public URL.",
    inputSchema: {
      type: "object",
      properties: {
        airdropId: { type: "string" },
        host: { type: "string" },
        protocol: { type: "string" }
      },
      required: ["airdropId"]
    }
  },
  {
    name: "create_automation",
    description: "Create a recurring automation for balance sync, agent prompt execution, or DeFi action reconciliation. Automations run through the same user-wallet and policy-gated paths as terminal actions.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        name: { type: "string" },
        kind: { type: "string", enum: ["sync_circle_balances", "run_agent_action", "reconcile_defi_action", "run_strategy_check"] },
        prompt: { type: "string" },
        text: { type: "string" },
        actionId: { type: "string" },
        intervalMinutes: { type: "number" },
        everyMinutes: { type: "number" },
        defaultSettlementRail: { type: "string" },
        status: { type: "string" },
        nextRunAt: { type: "string" }
      },
      required: ["handle"]
    }
  },
  {
    name: "create_strategy_policy",
    description: "Create a portfolio target-allocation strategy for a user's Arc wallet. This stores policy only; it does not execute trades.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        name: { type: "string" },
        targetAllocations: { type: "object" },
        settlementRail: { type: "string" },
        allowedRails: { type: "array", items: { type: "string" } },
        preferredAssets: { type: "array", items: { type: "string" } },
        forbiddenAssets: { type: "array", items: { type: "string" } }
      },
      required: ["handle", "targetAllocations"]
    }
  },
  {
    name: "list_strategy_policies",
    description: "List stored target-allocation strategies for a user.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        status: { type: "string" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "plan_rebalance_strategy",
    description: "Build a policy-aware rebalance plan from wallet balances and a strategy. Returns planned quote steps only; does not execute swaps.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        strategyId: { type: "string" },
        targetAllocations: { type: "object" },
        settlementRail: { type: "string" },
        maxSteps: { type: "number" }
      },
      required: ["handle"]
    }
  },
  {
    name: "reduce_risk_strategy",
    description: "Create a planning-only risk reduction rebalance toward stable assets.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        settlementRail: { type: "string" },
        stableTarget: { type: "number" }
      },
      required: ["handle"]
    }
  },
  {
    name: "run_strategy_check",
    description: "Run a strategy drift check for automations. It returns a plan and never executes trades automatically.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        strategyId: { type: "string" },
        settlementRail: { type: "string" }
      },
      required: ["handle"]
    }
  },
  {
    name: "get_market_intelligence",
    description: "Summarize route health, recent swap/bridge failure reasons, fee trends, liquidity warnings, and the current simple market regime for a user's Arc wallet.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        settlementRail: { type: "string" },
        limit: { type: "number" }
      },
      required: ["handle"]
    }
  },
  {
    name: "list_automations",
    description: "List active or paused user automations.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        status: { type: "string" },
        kind: { type: "string" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "get_market_feed_snapshot",
    description: "Refresh external token/perps market feeds and return prices, freshness, liquidity, and regime labels. Read-only; unavailable feeds are marked stale/unavailable.",
    inputSchema: {
      type: "object",
      properties: {
        assets: { type: "array", items: { type: "string" } },
        settlementRail: { type: "string" },
        force: { type: "boolean" }
      }
    }
  },
  {
    name: "create_mandate",
    description: "Save a persistent standing trading rule for a user's agent. Mandates are enforced before swaps, bridges, and perp proposals.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        text: { type: "string" },
        kind: { type: "string" },
        rules: { type: "object" }
      },
      required: ["handle"]
    }
  },
  {
    name: "list_mandates",
    description: "List the user's active or historical standing trading rules.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        status: { type: "string" },
        limit: { type: "number" }
      },
      required: ["handle"]
    }
  },
  {
    name: "update_mandate",
    description: "Update a standing trading rule by mandate id.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        mandateId: { type: "string" },
        text: { type: "string" },
        rules: { type: "object" },
        status: { type: "string" }
      },
      required: ["handle", "mandateId"]
    }
  },
  {
    name: "delete_mandate",
    description: "Delete a standing trading rule so it is no longer enforced.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        mandateId: { type: "string" }
      },
      required: ["handle", "mandateId"]
    }
  },
  {
    name: "run_automation",
    description: "Run one automation immediately.",
    inputSchema: {
      type: "object",
      properties: {
        automationId: { type: "string" }
      },
      required: ["automationId"]
    }
  },
  {
    name: "run_due_automations",
    description: "Run all due active automations now, up to a limit.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" }
      }
    }
  },
  {
    name: "pause_automation",
    description: "Pause a recurring automation.",
    inputSchema: {
      type: "object",
      properties: {
        automationId: { type: "string" }
      },
      required: ["automationId"]
    }
  },
  {
    name: "pause_automations",
    description: "Bulk-pause recurring automations, optionally filtered by handle, kind, or current status.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        kind: { type: "string" },
        status: { type: "string", default: "active" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "resume_automation",
    description: "Resume a paused automation.",
    inputSchema: {
      type: "object",
      properties: {
        automationId: { type: "string" }
      },
      required: ["automationId"]
    }
  },
  {
    name: "delete_automation",
    description: "Delete a recurring automation.",
    inputSchema: {
      type: "object",
      properties: {
        automationId: { type: "string" }
      },
      required: ["automationId"]
    }
  },
  {
    name: "create_wallet",
    description: "Create or load a Circle wallet set for an X handle on Arc.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        settlementRails: { type: "array", items: { type: "string" } }
      },
      required: ["handle"]
    }
  },
  {
    name: "get_balance",
    description: "Read a user's Circle wallet balances across bunOS settlement rails.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" }
      },
      required: ["handle"]
    }
  },
  {
    name: "analyze_portfolio",
    description: "Analyze a user's portfolio across rails, tokens, perps exposure, pending actions, strategy drift, and recommended next action. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        settlementRail: { type: "string" },
        includeRecommendations: { type: "boolean" }
      },
      required: ["handle"]
    }
  },
  {
    name: "get_wallet_capabilities",
    description: "Show which actions can execute from a user's Circle wallet and which require a future user-owned signing adapter.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" }
      },
      required: ["handle"]
    }
  },
  {
    name: "sync_circle_balances",
    description: "Refresh a user's real Circle wallet token balances into the bunOS ledger.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" }
      },
      required: ["handle"]
    }
  },
  {
    name: "request_testnet_usdc",
    description: "Request real Circle faucet testnet USDC/native gas for a user's testnet wallet.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        amount: { type: "number" },
        settlementRail: { type: "string" }
      },
      required: ["handle"]
    }
  },
  {
    name: "send_usdc",
    description: "Send USDC from one X handle to another through policy checks and Arc/Circle settlement.",
    inputSchema: {
      type: "object",
      properties: {
        senderHandle: { type: "string" },
        recipientHandle: { type: "string" },
        amount: { type: "number" },
        settlementRail: { type: "string" },
        memo: { type: "string" }
      },
      required: ["senderHandle", "recipientHandle", "amount"]
    }
  },
  {
    name: "bridge_usdc",
    description: "Create a policy-checked USDC bridge quote between configured rails. Real execution waits for a user-owned signing adapter.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        amount: { type: "number" },
        fromRail: { type: "string" },
        toRail: { type: "string" }
      },
      required: ["handle", "amount", "fromRail", "toRail"]
    }
  },
  {
    name: "demo_bridge_arc_to_base",
    description: "Judge-friendly demo helper: create/load the user's wallets and produce an Arc Testnet to Base Sepolia bridge quote with approval metadata. It never auto-confirms or spends.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        amount: { type: "number" },
        slippage: { type: "number" }
      },
      required: ["handle"]
    }
  },
  {
    name: "quote_swap",
    description: "Create a policy-checked swap quote and pending approval. Execution is confirmation-gated.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        amount: { type: "number" },
        settlementRail: { type: "string" },
        fromToken: { type: "string" },
        toToken: { type: "string" },
        slippage: { type: "number" }
      },
      required: ["handle", "amount"]
    }
  },
  {
    name: "list_approvals",
    description: "List pending or completed approvals for payment, DeFi, social trading, and perps actions.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        status: { type: "string" },
        kind: { type: "string" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "confirm_action",
    description: "Confirm a pending approval and execute the appropriate payment, DeFi handoff, copy proposal, or perp proposal.",
    inputSchema: {
      type: "object",
      properties: {
        approvalId: { type: "string" },
        handle: { type: "string" }
      },
      required: ["approvalId"]
    }
  },
  {
    name: "get_receipt",
    description: "Get a payment receipt and timeline for an bunOS action.",
    inputSchema: {
      type: "object",
      properties: {
        paymentId: { type: "string" }
      },
      required: ["paymentId"]
    }
  },
  {
    name: "propose_copy_trade",
    description: "Create an AI-selected copy-trading allocation proposal from social trader signals.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        traderHandle: { type: "string" },
        capitalUsd: { type: "number" },
        riskProfile: { type: "string" },
        settlementRail: { type: "string" }
      },
      required: ["handle", "traderHandle", "capitalUsd"]
    }
  },
  {
    name: "list_copy_trade_proposals",
    description: "List social copy-trading proposals and their approval state.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        status: { type: "string" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "list_perp_intelligence",
    description: "List perp market intelligence with funding bias, risk regime, and suggested leverage caps.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "assess_liquidation_risk",
    description: "Assess liquidation risk for a proposed leveraged perp position.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        symbol: { type: "string" },
        side: { type: "string", enum: ["long", "short"] },
        collateralUsd: { type: "number" },
        leverage: { type: "number" },
        entryPrice: { type: "number" }
      },
      required: ["handle", "symbol", "side", "collateralUsd", "leverage"]
    }
  },
  {
    name: "propose_perp_trade",
    description: "Create a confirmation-gated perp trade proposal with liquidation and stop-loss analysis.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        symbol: { type: "string" },
        side: { type: "string", enum: ["long", "short"] },
        collateralUsd: { type: "number" },
        leverage: { type: "number" },
        entryPrice: { type: "number" },
        settlementRail: { type: "string" }
      },
      required: ["handle", "symbol", "side", "collateralUsd", "leverage"]
    }
  },
  {
    name: "list_perp_proposals",
    description: "List perp trade proposals and their approval state.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        status: { type: "string" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "arc_perps_readiness",
    description: "Check whether ArcPerps Lite contracts are configured. User execution is proposal-gated; backend signer execution is not exposed.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "arc_perps_status",
    description: "Read ArcPerps Lite vault, optional user address allowance/margin, liquidity, and risk status.",
    inputSchema: {
      type: "object",
      properties: {
        ownerAddress: { type: "string" }
      }
    }
  },
  {
    name: "quote_arc_perp_position",
    description: "Quote an Arc-settled perp position using deployed oracle price or a supplied mark price.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        side: { type: "string", enum: ["long", "short"] },
        marginUsd: { type: "number" },
        leverage: { type: "number" },
        markPrice: { type: "number" }
      },
      required: ["symbol", "side", "marginUsd", "leverage"]
    }
  },
  {
    name: "read_arc_perps_oracle_price",
    description: "Read a deployed ArcPerps oracle price for a symbol.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string" }
      },
      required: ["symbol"]
    }
  },
  {
    name: "get_arc_perps_position",
    description: "Read an ArcPerps position by id with mark price, liquidation price, and current PnL when deployed.",
    inputSchema: {
      type: "object",
      properties: {
        positionId: { type: "number" }
      },
      required: ["positionId"]
    }
  },
  {
    name: "list_arc_perps_positions",
    description: "List recent ArcPerps positions from the deployed vault.",
    inputSchema: {
      type: "object",
      properties: {
        ownerAddress: { type: "string" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "open_arc_perp_user_position",
    description: "Open an ArcPerps position through the user's Circle Arc wallet. Never uses ARC_SETTLEMENT_PRIVATE_KEY for user funds.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        symbol: { type: "string" },
        side: { type: "string", enum: ["long", "short"] },
        marginUsd: { type: "number" },
        leverage: { type: "number" },
        idempotencyKey: { type: "string" }
      },
      required: ["handle", "symbol", "side", "marginUsd", "leverage"]
    }
  },
  {
    name: "close_arc_perp_user_position",
    description: "Close an ArcPerps position through the user's Circle Arc wallet. Never uses ARC_SETTLEMENT_PRIVATE_KEY for user funds.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        positionId: { type: "number" },
        idempotencyKey: { type: "string" }
      },
      required: ["handle", "positionId"]
    }
  },
  {
    name: "sync_arc_perps_oracle",
    description: "Sync ArcPerps oracle prices from live Hyperliquid market data using the protocol admin signer. This does not move user funds.",
    inputSchema: {
      type: "object",
      properties: {
        symbols: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "appkit_readiness",
    description: "Check Arc App Kit readiness, execution gates, supported chains, and configured Arc rails.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "list_appkit_capabilities",
    description: "List the MCP tools backed by Arc App Kit: send, bridge, swap, and unified balance.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "appkit_estimate_send",
    description: "User-owned AppKit send placeholder. Returns user-wallet-signing-required; never uses a backend signer.",
    inputSchema: {
      type: "object",
      properties: {
        settlementRail: { type: "string" },
        recipientAddress: { type: "string" },
        recipientHandle: { type: "string" },
        amount: { type: "number" },
        token: { type: "string" }
      },
      required: ["amount"]
    }
  },
  {
    name: "appkit_send_usdc",
    description: "User-owned AppKit send placeholder. Use send_usdc for Circle user-wallet transfers until a user AppKit adapter is configured.",
    inputSchema: {
      type: "object",
      properties: {
        settlementRail: { type: "string" },
        recipientAddress: { type: "string" },
        recipientHandle: { type: "string" },
        amount: { type: "number" },
        refId: { type: "string" }
      },
      required: ["amount"]
    }
  },
  {
    name: "appkit_estimate_bridge",
    description: "Estimate a Circle AppKit USDC bridge from a user Circle wallet. Never uses the backend signer.",
    inputSchema: {
      type: "object",
      properties: {
        fromRail: { type: "string" },
        toRail: { type: "string" },
        recipientAddress: { type: "string" },
        recipientHandle: { type: "string" },
        amount: { type: "number" },
        useForwarder: { type: "boolean" }
      },
      required: ["amount"]
    }
  },
  {
    name: "appkit_bridge_usdc",
    description: "Execute a Circle AppKit USDC bridge from a user Circle wallet when APPKIT_EXECUTION_ENABLED=1. Never uses the backend signer.",
    inputSchema: {
      type: "object",
      properties: {
        fromRail: { type: "string" },
        toRail: { type: "string" },
        recipientAddress: { type: "string" },
        recipientHandle: { type: "string" },
        amount: { type: "number" },
        useForwarder: { type: "boolean" },
        refId: { type: "string" }
      },
      required: ["amount"]
    }
  },
  {
    name: "appkit_estimate_swap",
    description: "Estimate a Circle AppKit same-chain swap from a user Circle wallet. Never uses the backend signer.",
    inputSchema: {
      type: "object",
      properties: {
        settlementRail: { type: "string" },
        tokenIn: { type: "string" },
        tokenOut: { type: "string" },
        amount: { type: "number" },
        amountIn: { type: "number" },
        slippage: { type: "number" },
        slippageBps: { type: "number" }
      },
      required: ["tokenOut", "amount"]
    }
  },
  {
    name: "appkit_swap",
    description: "Execute a Circle AppKit same-chain swap from a user Circle wallet when APPKIT_EXECUTION_ENABLED=1. Never uses the backend signer.",
    inputSchema: {
      type: "object",
      properties: {
        settlementRail: { type: "string" },
        tokenIn: { type: "string" },
        tokenOut: { type: "string" },
        amount: { type: "number" },
        amountIn: { type: "number" },
        slippage: { type: "number" },
        slippageBps: { type: "number" }
      },
      required: ["tokenOut", "amount"]
    }
  },
  {
    name: "appkit_unified_balance",
    description: "User-owned AppKit unified balance placeholder. Use get_balance/sync_circle_balances for Circle user wallets.",
    inputSchema: {
      type: "object",
      properties: {
        settlementRail: { type: "string" },
        token: { type: "string" },
        chains: { type: "array", items: { type: "string" } },
        includePending: { type: "boolean" }
      }
    }
  },
  {
    name: "resolve_x_handle",
    description: "Resolve an X handle into an bunOS payment identity.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" }
      },
      required: ["handle"]
    }
  },
  {
    name: "create_payment_intent",
    description: "Create a policy-checked USDC payment to an X handle.",
    inputSchema: {
      type: "object",
      properties: {
        senderHandle: { type: "string" },
        recipientHandle: { type: "string" },
        amount: { type: "number" },
        asset: { type: "string", enum: ["USDC"] },
        memo: { type: "string" }
      },
      required: ["senderHandle", "recipientHandle", "amount"]
    }
  },
  {
    name: "create_social_bounty",
    description: "Create a USDC bounty for the first valid commenter on an X post.",
    inputSchema: {
      type: "object",
      properties: {
        senderHandle: { type: "string" },
        postId: { type: "string" },
        amount: { type: "number" },
        asset: { type: "string", enum: ["USDC"] },
        rule: { type: "string", enum: ["first_valid_commenter"] }
      },
      required: ["senderHandle", "postId", "amount"]
    }
  },
  {
    name: "list_defi_tools",
    description: "List bunOS DeFi tool adapters and their risk/execution status.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "list_route_capabilities",
    description: "List live and unavailable swap/bridge route capabilities. Agents should check this before asking for a swap or bridge.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string" },
        fromRail: { type: "string" },
        toRail: { type: "string" },
        status: { type: "string" },
        includeHidden: { type: "boolean" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "probe_route_capability",
    description: "Run a live AppKit quote probe for one route and update the route capability registry.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        type: { type: "string", enum: ["swap", "bridge"] },
        fromRail: { type: "string" },
        toRail: { type: "string" },
        fromToken: { type: "string" },
        toToken: { type: "string" },
        amount: { type: "number" }
      },
      required: ["type", "fromRail", "toRail", "fromToken", "toToken"]
    }
  },
  {
    name: "probe_route_capabilities",
    description: "Probe the default route registry and update live/unavailable statuses.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        amount: { type: "number" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "quote_defi_route",
    description: "Create a policy-checked bridge or swap quote. This does not execute the transaction.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        fromRail: { type: "string" },
        toRail: { type: "string" },
        amount: { type: "number" },
        fromToken: { type: "string" },
        toToken: { type: "string" },
        slippage: { type: "number" }
      },
      required: ["handle", "fromRail", "toRail", "amount"]
    }
  },
  {
    name: "confirm_defi_action",
    description: "Confirm a previously quoted DeFi action and queue the execution handoff. This does not bypass policy.",
    inputSchema: {
      type: "object",
      properties: {
        actionId: { type: "string" },
        handle: { type: "string" }
      },
      required: ["actionId", "handle"]
    }
  },
  {
    name: "list_defi_actions",
    description: "List policy-gated DeFi bridge/swap actions and their current execution status.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        status: { type: "string" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "reconcile_defi_action",
    description: "Poll/update a submitted bridge or swap action through the configured user-wallet execution provider.",
    inputSchema: {
      type: "object",
      properties: {
        actionId: { type: "string" }
      },
      required: ["actionId"]
    }
  },
  {
    name: "get_defi_action_receipt",
    description: "Get a DeFi action receipt with approval, execution, timeline, tx hash, and public receipt URL.",
    inputSchema: {
      type: "object",
      properties: {
        actionId: { type: "string" },
        host: { type: "string" },
        protocol: { type: "string" }
      },
      required: ["actionId"]
    }
  },
  {
    name: "refresh_execution_monitor",
    description: "Refresh a payment, DeFi action, or perp proposal lifecycle and return settled/failed/monitoring status with tx hash when available.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["payment", "defi_action", "perp_proposal"] },
        id: { type: "string" },
        runWorker: { type: "boolean" },
        host: { type: "string" },
        protocol: { type: "string" }
      },
      required: ["kind", "id"]
    }
  },
  {
    name: "list_perp_markets",
    description: "List Hyperliquid market data. Read-only; no order placement.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        limit: { type: "number" }
      }
    }
  }
];

export async function callMcpTool(tool, args) {
  if (tool === "plan_agent_action") {
    return await planAgentActionWithModel(args);
  }

  if (tool === "run_agent_action") {
    return await runAgentAction(args);
  }

  if (tool === "list_agent_tools") {
    return listAgentTools();
  }

  if (tool === "get_agent_memory") {
    return buildAgentMemoryReport(args);
  }

  if (tool === "list_arc_trading_primitives") {
    return listArcTradingPrimitives();
  }

  if (tool === "create_airdrop") {
    return await createAirdrop({
      ...args,
      source: "agent-mcp"
    });
  }

  if (tool === "award_airdrop") {
    return await awardAirdrop(args);
  }

  if (tool === "list_airdrops") {
    return listAirdrops(args);
  }

  if (tool === "get_airdrop_receipt") {
    return getAirdropReceipt(args);
  }

  if (tool === "create_automation") {
    return createAutomation(args);
  }

  if (tool === "create_strategy_policy") {
    return createStrategyPolicy(args);
  }

  if (tool === "list_strategy_policies") {
    return listStrategyPolicies(args);
  }

  if (tool === "plan_rebalance_strategy") {
    return planRebalanceStrategy(args);
  }

  if (tool === "reduce_risk_strategy") {
    return reduceRiskStrategy(args);
  }

  if (tool === "run_strategy_check") {
    return runStrategyCheck(args);
  }

  if (tool === "get_market_intelligence") {
    return getMarketIntelligence(args);
  }

  if (tool === "get_market_feed_snapshot") {
    return await refreshMarketFeedSnapshot(args);
  }

  if (tool === "create_mandate") {
    return createMandate({ ...args, source: "mcp" });
  }

  if (tool === "list_mandates") {
    return listMandates(args);
  }

  if (tool === "update_mandate") {
    return updateMandate(args);
  }

  if (tool === "delete_mandate") {
    return deleteMandate(args);
  }

  if (tool === "list_automations") {
    return listAutomations(args);
  }

  if (tool === "run_automation") {
    return await runAutomation(args);
  }

  if (tool === "run_due_automations") {
    return await runDueAutomations(args);
  }

  if (tool === "pause_automation") {
    return updateAutomation({ automationId: args.automationId, status: "paused" });
  }

  if (tool === "pause_automations") {
    return pauseAutomations(args);
  }

  if (tool === "resume_automation") {
    return updateAutomation({ automationId: args.automationId, status: "active" });
  }

  if (tool === "delete_automation") {
    return deleteAutomation(args);
  }

  if (tool === "create_wallet") {
    return await createWallet(args);
  }

  if (tool === "get_balance") {
    return { ok: true, wallet: getWalletProfile(args.handle) };
  }

  if (tool === "analyze_portfolio") {
    return analyzePortfolio(args);
  }

  if (tool === "get_wallet_capabilities") {
    return getWalletCapabilities(args.handle);
  }

  if (tool === "sync_circle_balances") {
    return await syncWalletBalances(args);
  }

  if (tool === "request_testnet_usdc") {
    return await fundWallet({
      handle: args.handle,
      amount: args.amount || 10,
      source: "circle_faucet",
      settlementRail: args.settlementRail || "arc-testnet"
    });
  }

  if (tool === "send_usdc") {
    return await createPaymentIntent({
      senderHandle: args.senderHandle,
      recipientHandle: args.recipientHandle,
      amount: args.amount,
      asset: "USDC",
      settlementRail: args.settlementRail,
      memo: args.memo || "",
      source: "agent-mcp"
    });
  }

  if (tool === "bridge_usdc") {
    return await quoteDefiRoute({
      handle: args.handle,
      type: "bridge",
      fromRail: args.fromRail,
      toRail: args.toRail,
      amount: args.amount,
      fromToken: "USDC",
      toToken: "USDC",
      slippage: args.slippage
    });
  }

  if (tool === "demo_bridge_arc_to_base") {
    const handle = args.handle || "@sara";
    const amount = Number(args.amount || 5);
    const wallet = await createWallet({
      handle,
      settlementRails: ["arc-testnet", "base-sepolia"]
    });
    if (Number(wallet.wallet?.balances?.["arc-testnet"] || 0) < amount + 0.25) {
      await fundWallet({
        handle,
        amount: amount + 1,
        source: "mcp_demo_prefund",
        settlementRail: "arc-testnet"
      });
    }
    const quote = await quoteDefiRoute({
      handle,
      type: "bridge",
      fromRail: "arc-testnet",
      toRail: "base-sepolia",
      amount,
      fromToken: "USDC",
      toToken: "USDC",
      slippage: args.slippage ?? 0.005,
      source: "mcp-demo"
    });

    return {
      ok: quote.ok,
      demo: "arc_to_base_sepolia_bridge",
      backendSignerAllowed: false,
      wallet: getWalletProfile(handle),
      quote,
      approvalId: quote.action?.approvalId || null,
      nextAction: quote.ok
        ? "Call confirm_defi_action with the returned actionId/approvalId when the user approves."
        : quote.nextAction || "choose_supported_route"
    };
  }

  if (tool === "quote_swap") {
    const rail = args.settlementRail || "arc-testnet";
    return await quoteDefiRoute({
      handle: args.handle,
      type: "swap",
      fromRail: rail,
      toRail: rail,
      amount: args.amount,
      fromToken: args.fromToken || "USDC",
      toToken: args.toToken || "EURC",
      slippage: args.slippage
    });
  }

  if (tool === "list_approvals") {
    return listApprovals(args);
  }

  if (tool === "confirm_action") {
    return await confirmAction(args);
  }

  if (tool === "get_receipt") {
    return getPaymentReceipt({ paymentId: args.paymentId });
  }

  if (tool === "propose_copy_trade") {
    return proposeCopyTrade(args);
  }

  if (tool === "list_copy_trade_proposals") {
    return listCopyTradeProposals(args);
  }

  if (tool === "list_perp_intelligence") {
    return await listPerpIntelligence(args);
  }

  if (tool === "assess_liquidation_risk") {
    return assessLiquidationRisk(args);
  }

  if (tool === "propose_perp_trade") {
    return proposePerpTrade(args);
  }

  if (tool === "list_perp_proposals") {
    return listPerpProposals(args);
  }

  if (tool === "arc_perps_readiness") {
    return getArcPerpsReadiness();
  }

  if (tool === "arc_perps_status") {
    return await getArcPerpsStatus(args);
  }

  if (tool === "quote_arc_perp_position") {
    return await quoteArcPerpPosition(args);
  }

  if (tool === "read_arc_perps_oracle_price") {
    return await readArcPerpsOraclePrice(args);
  }

  if ([
    "set_arc_perps_oracle_price",
    "set_arc_perps_market",
    "approve_arc_perps_usdc",
    "deposit_arc_perps_margin",
    "withdraw_arc_perps_margin",
    "provide_arc_perps_liquidity",
    "open_arc_perp_position",
    "close_arc_perp_position"
  ].includes(tool)) {
    return backendSignerDisabled(tool);
  }

  if (tool === "get_arc_perps_position") {
    return await getArcPerpsPosition(args);
  }

  if (tool === "list_arc_perps_positions") {
    return await listArcPerpsPositions(args);
  }

  if (tool === "open_arc_perp_user_position") {
    return await openArcPerpPositionWithUserWallet(args);
  }

  if (tool === "close_arc_perp_user_position") {
    return await closeArcPerpPositionWithUserWallet(args);
  }

  if (tool === "sync_arc_perps_oracle") {
    return await syncArcPerpsOracleFromHyperliquid(args);
  }

  if (tool === "appkit_readiness") {
    return await getAppKitReadiness();
  }

  if (tool === "list_appkit_capabilities") {
    return await listAppKitCapabilities();
  }

  if (tool === "appkit_estimate_send") {
    return await estimateAppKitSend(args);
  }

  if (tool === "appkit_send_usdc") {
    return await executeAppKitSend(args);
  }

  if (tool === "appkit_estimate_bridge") {
    return await estimateAppKitBridge(args);
  }

  if (tool === "appkit_bridge_usdc") {
    return await executeAppKitBridge(args);
  }

  if (tool === "appkit_estimate_swap") {
    return await estimateAppKitSwap(args);
  }

  if (tool === "appkit_swap") {
    return await executeAppKitSwap(args);
  }

  if (tool === "appkit_unified_balance") {
    return await getAppKitUnifiedBalance(args);
  }

  if (tool === "create_payment_intent") {
    return await createPaymentIntent({
      ...args,
      source: "grok-mcp"
    });
  }

  if (tool === "create_social_bounty") {
    return await createSocialBounty({
      ...args,
      source: "grok-mcp"
    });
  }

  if (tool === "resolve_x_handle") {
    return {
      ok: true,
      message: "Use /api/identity/resolve in the product API; this tool is advertised for Grok discovery."
    };
  }

  if (tool === "list_defi_tools") {
    return listDefiTools();
  }

  if (tool === "list_route_capabilities") {
    return listDefiRouteCapabilities(args);
  }

  if (tool === "probe_route_capability") {
    return await probeDefiRouteCapability(args);
  }

  if (tool === "probe_route_capabilities") {
    return await probeDefiRouteCapabilities(args);
  }

  if (tool === "quote_defi_route") {
    return await quoteDefiRoute(args);
  }

  if (tool === "confirm_defi_action") {
    return await confirmDefiAction(args);
  }

  if (tool === "list_defi_actions") {
    return listDefiActions(args);
  }

  if (tool === "reconcile_defi_action") {
    const job = enqueueJob({
      type: "reconcile_defi_action",
      payload: { actionId: args.actionId },
      idempotencyKey: `reconcile_defi_action:${args.actionId}:mcp:${Date.now()}`
    });
    return await runJob({ jobId: job.id });
  }

  if (tool === "get_defi_action_receipt") {
    return getDefiActionReceipt({
      actionId: args.actionId,
      host: args.host,
      protocol: args.protocol || "http"
    });
  }

  if (tool === "refresh_execution_monitor") {
    return await refreshExecutionMonitor({
      ...args,
      runWorker: args.runWorker !== false
    });
  }

  if (tool === "list_perp_markets") {
    return await listPerpMarkets(args);
  }

  throw new Error(`Unknown MCP tool: ${tool}`);
}

function backendSignerDisabled(tool) {
  return {
    ok: false,
    tool,
    status: "user_wallet_signing_required",
    backendSignerAllowed: false,
    message: "This signer-backed tool was removed from the MCP/agent execution surface. Build a user-owned Circle/AppKit signing path before enabling live execution."
  };
}
