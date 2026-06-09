import { parseSocialCommand } from "./intent.js";
import { createPaymentIntent, createSocialBounty } from "./orchestrator.js";
import { confirmAction } from "./agentActions.js";
import {
  closeArcPerpPositionWithUserWallet,
  getArcPerpsPosition,
  getArcPerpsReadiness,
  getArcPerpsStatus,
  listArcPerpsPositions,
  quoteArcPerpPosition,
  readArcPerpsOraclePrice
} from "./arcPerpsEngine.js";
import { listApprovals } from "./approvals.js";
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
  confirmDefiAction,
  getDefiActionReceipt,
  listDefiActions,
  listDefiRouteCapabilities,
  listDefiTools,
  listPerpMarkets,
  quoteDefiRoute
} from "./defiOrchestrator.js";
import { resolveXHandle } from "./identity.js";
import { enqueueJob, runJob } from "./jobs.js";
import { getPaymentReceipt, resolveIdentity } from "./queries.js";
import {
  assessLiquidationRisk,
  listPerpIntelligence,
  listPerpProposals,
  proposePerpTrade
} from "./perpsAgent.js";
import { listCopyTradeProposals, proposeCopyTrade } from "./socialTradingAgent.js";
import {
  fundWallet,
  getWalletCapabilities,
  getWalletProfile,
  syncWalletBalances
} from "./walletAccounts.js";
import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  runAutomation,
  runDueAutomations,
  pauseAutomations,
  updateAutomation
} from "./automations.js";
import {
  awardAirdrop,
  createAirdrop,
  getAirdropReceipt,
  listAirdrops
} from "./airdrops.js";
import { listArcTradingPrimitives } from "./arcTradingPrimitives.js";
import { circleUserSigner, readOnlySigner, userWalletSigningRequired } from "./signerPolicy.js";
import { composeExecutionReplyWithModel, getAgentModelReadiness, planIntentWithModel } from "./modelPlanner.js";
import {
  buildAgentDecision,
  buildAgentMemoryReport,
  buildAgentStateSnapshot,
  rememberAgentExecution
} from "./agentMemory.js";
import { buildAgentNarrative } from "./agentNarrator.js";
import { recordAgentDecisionEvent } from "./agentObservability.js";
import {
  createStrategyPolicy,
  listStrategyPolicies,
  planRebalanceStrategy,
  reduceRiskStrategy,
  runStrategyCheck
} from "./strategyAgent.js";
import { getMarketIntelligence } from "./marketIntelligence.js";
import { executionMonitorFromAgentResult } from "./executionMonitor.js";
import { observeAgentExecution } from "./agentHarness.js";
import { analyzePortfolio } from "./portfolioBrain.js";
import { refreshMarketFeedSnapshot } from "./marketFeeds.js";
import { ledger } from "./fixtures.js";
import {
  createMandate,
  deleteMandate,
  listMandates,
  parseMandateText,
  updateMandate
} from "./mandates.js";
import { config } from "./config.js";
import {
  buildAgentContext,
  resolveContextualIntent,
  summarizeAgentContextForModel
} from "./agentContext.js";
import {
  cancelAgentWorkingTask,
  publicAgentWorkingMemory
} from "./agentWorkingMemory.js";
import {
  assertAgentPlanContract,
  validateAgentPlanContract
} from "./agentPlanGuard.js";
import {
  cancelAgentWorkflow,
  createAndRunAgentWorkflow,
  resumeAgentWorkflowsForExecutionTarget,
  getAgentWorkflow,
  listAgentWorkflows,
  runDueAgentWorkflows,
  runAgentWorkflow
} from "./agentWorkflow.js";

const ALLOWED_TOOLS = new Set([
  "get_balance",
  "answer_agent_question",
  "cancel_agent_task",
  "create_agent_workflow",
  "resume_agent_workflow",
  "get_agent_workflow",
  "list_agent_workflows",
  "cancel_agent_workflow",
  "get_agent_memory",
  "get_wallet_capabilities",
  "sync_circle_balances",
  "request_testnet_usdc",
  "send_usdc",
  "create_social_bounty",
  "create_airdrop",
  "award_airdrop",
  "list_airdrops",
  "get_airdrop_receipt",
  "list_arc_trading_primitives",
  "list_approvals",
  "confirm_action",
  "get_receipt",
  "propose_copy_trade",
  "list_copy_trade_proposals",
  "list_perp_intelligence",
  "assess_liquidation_risk",
  "quote_defi_route",
  "propose_perp_trade",
  "list_perp_proposals",
  "arc_perps_readiness",
  "arc_perps_status",
  "quote_arc_perp_position",
  "read_arc_perps_oracle_price",
  "get_arc_perps_position",
  "list_arc_perps_positions",
  "close_arc_perp_user_position",
  "appkit_readiness",
  "list_appkit_capabilities",
  "appkit_estimate_send",
  "appkit_send_usdc",
  "appkit_estimate_bridge",
  "appkit_bridge_usdc",
  "appkit_estimate_swap",
  "appkit_swap",
  "appkit_unified_balance",
  "resolve_x_handle",
  "list_defi_tools",
  "list_route_capabilities",
  "list_defi_actions",
  "confirm_defi_action",
  "reconcile_defi_action",
  "get_defi_action_receipt",
  "list_perp_markets",
  "get_market_intelligence",
  "get_market_feed_snapshot",
  "analyze_portfolio",
  "create_strategy_policy",
  "list_strategy_policies",
  "plan_rebalance_strategy",
  "reduce_risk_strategy",
  "run_strategy_check",
  "create_mandate",
  "list_mandates",
  "update_mandate",
  "delete_mandate",
  "create_automation",
  "list_automations",
  "run_automation",
  "run_due_automations",
  "pause_automations",
  "pause_automation",
  "resume_automation",
  "delete_automation"
]);

const TOKEN_PATTERN = "(?:0x[a-fA-F0-9]{40}|[a-zA-Z][a-zA-Z0-9]{1,20})";
const AMOUNT_PATTERN = "(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|a|an)";
const TOKEN_BRIDGE_PATTERN = new RegExp(`(?:bridge|move)\\s+\\$?(${AMOUNT_PATTERN})\\s+(${TOKEN_PATTERN})\\s+from\\s+(arc|base|arc-testnet|base-sepolia)\\s+(?:to|onto)\\s+(arc|base|arc-testnet|base-sepolia)`, "i");
const BRIDGE_PATTERN = new RegExp(`(?:bridge|move|send)\\s+\\$?(${AMOUNT_PATTERN})\\s*(?:usdc)?\\s+(?:from\\s+)?(arc|base|arc-testnet|base-sepolia)?\\s*(?:to|onto)\\s+(arc|base|arc-testnet|base-sepolia)`, "i");
const SOURCE_SWAP_PATTERN = new RegExp(`(?:swap|convert)\\s+\\$?(${AMOUNT_PATTERN})\\s+(?:of\\s+)?(${TOKEN_PATTERN})\\s+(?:to|into|for)\\s+(${TOKEN_PATTERN})(?:\\s+(?:on|from|in)\\s+(arc|base|arc-testnet|base-sepolia))?`, "i");
const SWAP_PATTERN = new RegExp(`(?:swap|convert)\\s+\\$?(${AMOUNT_PATTERN})\\s*(?:usdc)?\\s+(?:to|into|for)\\s+(${TOKEN_PATTERN})(?:\\s+(?:on|from|in)\\s+(arc|base|arc-testnet|base-sepolia))?`, "i");
const BUY_PATTERN = new RegExp(`buy\\s+\\$?(${AMOUNT_PATTERN})\\s*(?:of\\s+)?(${TOKEN_PATTERN})(?:\\s+(?:with|using)\\s+usdc)?(?:\\s+(?:on|from|in)\\s+(arc|base|arc-testnet|base-sepolia))?`, "i");
const NATURAL_SWAP_PATTERN = new RegExp(`(?:turn|change|trade|convert|swap)\\s+(?:my\\s+)?\\$?(${AMOUNT_PATTERN})\\s+(?:of\\s+)?(${TOKEN_PATTERN})\\s+(?:to|into|for)\\s+(?:some\\s+)?(${TOKEN_PATTERN})(?:\\s+(?:on|from|in|over)\\s+(arc|base|arc-testnet|base-sepolia))?`, "i");
const TARGET_SWAP_PATTERN = new RegExp(`(?:(?:buy|get|grab)(?:\\s+me)?|give\\s+me|i\\s+want|i\\s+need|need|want)\\s+(?:some\\s+)?(${TOKEN_PATTERN})\\s+(?:with|using|for)\\s+\\$?(${AMOUNT_PATTERN})\\s+(?:of\\s+)?(${TOKEN_PATTERN})(?:\\s+(?:on|from|in|over)\\s+(arc|base|arc-testnet|base-sepolia))?`, "i");
const NATURAL_BRIDGE_PATTERN = new RegExp(`(?:bridge|move|transfer|send|put)\\s+\\$?(${AMOUNT_PATTERN})\\s*(?:of\\s+)?(${TOKEN_PATTERN})?\\s*(?:over\\s+)?(?:to|onto|on)\\s+(arc|base|arc-testnet|base-sepolia)(?:\\s+from\\s+(arc|base|arc-testnet|base-sepolia))?`, "i");
const COPY_TRADE_PATTERN = /(?:copy\s*trade|copy|follow)\s+(@[a-zA-Z0-9_]{1,15})\s+(?:with|using|for)\s+\$?(\d+(?:\.\d+)?)/i;
const AIRDROP_FIXED_PATTERN = /(?:airdrop|drop)\s+\$?(\d+(?:\.\d+)?)\s*(?:usdc)?\s+(?:each\s+)?(?:to\s+)?((?:@[a-zA-Z0-9_]{1,15}(?:[,\s]+|$)){1,})/i;
const AIRDROP_SOCIAL_PATTERN = /(?:airdrop|drop)\s+\$?(\d+(?:\.\d+)?)\s*(?:usdc)?\s+(?:each\s+)?(?:to|for)\s+(?:the\s+)?first\s+(\d{1,5})\s+(?:comments?|replies?|commenters?|repliers?)(?:\s+(?:on|for)\s+(?:post|tweet)\s+([a-zA-Z0-9_:-]+))?/i;
const LIQUIDATION_RISK_PATTERN = /(?:assess|check|calculate)?\s*(?:liquidation|liq)\s*(?:risk)?\s+(?:for\s+)?([a-zA-Z]{2,12})\s+(long|short)\s+\$?(\d+(?:\.\d+)?)\s*(?:at|with)?\s*(\d+(?:\.\d+)?)x/i;
const ARC_PERP_QUOTE_PATTERN = /(?:quote\s+)?(?:arc\s+)?perp\s+([a-zA-Z]{2,12})\s+(long|short)\s+\$?(\d+(?:\.\d+)?)\s*(?:at|with)?\s*(\d+(?:\.\d+)?)x/i;
const CLOSE_PERP_PATTERN = /(?:close|exit|flatten)\s+(?:(?:my|the)\s+)?(?:(last|latest|current)\s+)?(?:(?:arc\s+)?perp|position|trade)?(?:\s+#?(\d+))?(?:\s+([a-zA-Z]{2,12}))?(?:\s+(long|short))?/i;
const INVALID_SWAP_TOKENS = new Set(["ARC", "BASE", "FROM", "IN", "ON", "TO"]);

export function listAgentTools() {
  return {
    ok: true,
    tools: Array.from(ALLOWED_TOOLS),
    backendSignerAllowed: false,
    model: getAgentModelReadiness()
  };
}

export function planAgentAction({
  handle = "@sara",
  text,
  defaultSettlementRail = "arc-testnet",
  source = "agent",
  conversation = []
} = {}) {
  if (!text || typeof text !== "string") {
    throw new Error("Agent text is required");
  }

  const user = resolveXHandle(handle);
  const capabilities = getWalletCapabilities(user.handle);
  const parsed = parseWithFallbacks(text, defaultSettlementRail, conversation);
  const plan = planFromIntent({
    intent: parsed.intent,
    handle: user.handle,
    defaultSettlementRail,
    source
  });

  assertAllowedTool(plan.tool);

  return finalizePlanned({
    ok: true,
    source,
    handle: user.handle,
    text,
    parser: parsed.parser,
    intent: parsed.intent,
    plan,
    signer: plan.signer,
    policy: {
      backendSignerAllowed: false,
      requiresConfirmation: plan.requiresConfirmation,
      canExecuteNow: plan.canExecuteNow,
      reason: plan.reason
    },
    walletCapabilities: capabilities.capabilities,
    nextAction: plan.canExecuteNow ? "call_tool_after_policy_check" : "show_plan_or_request_user_confirmation"
  });
}

export function planAgentIntent({
  handle = "@sara",
  intent,
  defaultSettlementRail = "arc-testnet",
  source = "agent_workflow",
  text = null
} = {}) {
  const user = resolveXHandle(handle);
  const capabilities = getWalletCapabilities(user.handle);
  const plan = planFromIntent({
    intent,
    handle: user.handle,
    defaultSettlementRail,
    source
  });
  assertAllowedTool(plan.tool);
  return finalizePlanned({
    ok: true,
    source,
    handle: user.handle,
    text: text || describeWorkflowIntent(intent),
    parser: "workflow_step",
    intent,
    plan,
    signer: plan.signer,
    policy: {
      backendSignerAllowed: false,
      requiresConfirmation: plan.requiresConfirmation,
      canExecuteNow: plan.canExecuteNow,
      reason: plan.reason
    },
    walletCapabilities: capabilities.capabilities,
    nextAction: plan.canExecuteNow ? "call_tool_after_policy_check" : "show_plan_or_request_user_confirmation"
  });
}

export async function planAgentActionWithModel({
  handle = "@sara",
  text,
  defaultSettlementRail = "arc-testnet",
  source = "agent",
  useModel,
  conversation = []
} = {}) {
  const deterministic = planAgentAction({ handle, text, defaultSettlementRail, source, conversation });
  const context = buildAgentContext({
    handle: deterministic.handle || handle,
    text,
    conversation,
    deterministic,
    defaultSettlementRail
  });
  const modelContext = summarizeAgentContextForModel(context);
  const contextMeta = modelContext.contextMeta;
  const contextualIntent = resolveContextualIntent({ text, context });
  const contextualOverride = contextualIntent?.action === "tool_call"
    && contextualIntent.tool === "cancel_agent_task";
  const pendingAction = context.workingMemory?.pendingClarification?.draft?.action || null;
  const contextualAction = contextualIntent?.pending?.draft?.action || contextualIntent?.action || null;
  const deterministicAction = deterministic.intent?.pending?.draft?.action || deterministic.intent?.action || null;
  const contextualContinuation = Boolean(
    pendingAction
    && contextualAction === pendingAction
    && (!deterministic.plan.tool || deterministicAction === pendingAction)
  );
  if ((!deterministic.plan.tool || contextualOverride || contextualContinuation) && contextualIntent) {
    try {
      const user = resolveXHandle(handle);
      const capabilities = getWalletCapabilities(user.handle);
      const plan = planFromIntent({
        intent: contextualIntent,
        handle: user.handle,
        defaultSettlementRail,
        source
      });
      assertAllowedTool(plan.tool);

      return finalizePlanned({
        ok: true,
        source,
        handle: user.handle,
        text,
        parser: "agent_context",
        intent: contextualIntent,
        plan,
        signer: plan.signer,
        policy: {
          backendSignerAllowed: false,
          requiresConfirmation: plan.requiresConfirmation,
          canExecuteNow: plan.canExecuteNow,
          reason: plan.reason
        },
        walletCapabilities: capabilities.capabilities,
        contextMeta,
        model: {
          ...getAgentModelReadiness(),
          role: "context_fast_path",
          error: null
        },
        nextAction: plan.canExecuteNow ? "call_tool_after_policy_check" : "show_plan_or_request_user_confirmation"
      });
    } catch {
      // Fall through to the model or deterministic clarification.
    }
  }
  const modelAllowed = useModel !== false && source !== "automation";
  const shouldPreferModel = modelAllowed && shouldUseModelBeforeDeterministic(deterministic);
  if (!shouldPreferModel && (!modelAllowed || deterministic.plan.tool)) {
    return finalizePlanned({
      ...upgradeTerminalPlan(deterministic),
      contextMeta,
      model: {
        ...getAgentModelReadiness(),
        role: modelAllowed ? "deterministic_fast_path" : "disabled_for_source",
        error: null
      }
    });
  }

  let modelIntent = null;
  let modelError = null;
  try {
    modelIntent = await planIntentWithModel({
      text,
      defaultSettlementRail,
      context: modelContext
    });
  } catch (error) {
    modelError = error.message;
  }

  if (modelIntent) {
    try {
      const user = resolveXHandle(handle);
      const capabilities = getWalletCapabilities(user.handle);
      const plan = planFromIntent({
        intent: modelIntent,
        handle: user.handle,
        defaultSettlementRail,
        source
      });
      assertAllowedTool(plan.tool);

      return finalizePlanned({
        ok: true,
        source,
        handle: user.handle,
        text,
        parser: "model_primary",
        intent: modelIntent,
        plan,
        signer: plan.signer,
        policy: {
          backendSignerAllowed: false,
          requiresConfirmation: plan.requiresConfirmation,
          canExecuteNow: plan.canExecuteNow,
          reason: plan.reason
        },
        walletCapabilities: capabilities.capabilities,
        contextMeta,
        model: {
          ...getAgentModelReadiness(),
          role: "primary_intent_planner"
        },
        nextAction: plan.canExecuteNow ? "call_tool_after_policy_check" : "show_plan_or_request_user_confirmation"
      });
    } catch (error) {
      modelError = error.message;
    }
  }

  return finalizePlanned({
    ...upgradeTerminalPlan(deterministic),
    contextMeta,
    model: {
      ...getAgentModelReadiness(),
      role: "fallback_or_unavailable",
      error: modelError
    }
  });
}

export async function runAgentAction({
  handle = "@sara",
  text,
  defaultSettlementRail = "arc-testnet",
  source = "agent",
  postId,
  idempotencyKey,
  fast = false,
  useModel,
  conversation = []
} = {}) {
  const startedAt = Date.now();
  const planned = await planAgentActionWithModel({
    handle,
    text,
    defaultSettlementRail,
    source,
    useModel,
    conversation
  });
  const plannedAt = Date.now();
  const agentState = buildAgentStateSnapshot({
    handle: planned.handle,
    planned
  });
  const contradictionBlock = contradictionBlockForPlan(planned);

  if (!planned.plan.tool) {
    const execution = buildAgentExecutionReport({
      planned,
      result: {
        ok: false,
        status: "clarification_required",
        reason: planned.plan.reason,
        nextAction: "ask_for_clarification"
      }
    });
    const decision = buildAgentDecision({ planned, execution, state: agentState });
    const narrative = buildAgentNarrative({
      planned,
      result: {
        ok: false,
        status: "clarification_required",
        reason: planned.plan.reason,
        nextAction: "ask_for_clarification"
      },
      execution,
      decision,
      state: agentState
    });
    rememberAgentExecution({ handle: planned.handle, planned, execution, decision });
    recordAgentDecisionEvent({
      handle: planned.handle,
      source,
      planned,
      result: {
        ok: false,
        status: "clarification_required",
        reason: planned.plan.reason
      },
      execution,
      decision,
      narrative,
      timing: {
        planningMs: plannedAt - startedAt,
        executionMs: 0,
        totalMs: Date.now() - startedAt,
        fast
      }
    });
    return {
      ok: false,
      planned,
      agentState,
      decision,
      narrative,
      status: "clarification_required",
      clarification: planned.plan.reason,
      signer: planned.signer,
      execution,
      reason: execution.reason,
      summary: narrative.summary,
      whatChecked: narrative.whatChecked,
      whatHappened: narrative.whatHappened,
      why: narrative.why,
      warnings: narrative.warnings,
      receipt: narrative.receipt,
      nextAction: "ask_for_clarification"
    };
  }

  if (contradictionBlock) {
    const result = {
      ok: false,
      status: "context_conflict",
      reason: contradictionBlock.reason,
      nextAction: "refresh_or_clarify_before_execution"
    };
    const execution = buildAgentExecutionReport({ planned, result });
    const decision = buildAgentDecision({ planned, result, execution, state: agentState });
    const narrative = buildAgentNarrative({
      planned,
      result,
      execution,
      decision,
      state: agentState
    });
    narrative.summary = contradictionBlock.summary;
    narrative.nextAction = "refresh_or_clarify_before_execution";
    rememberAgentExecution({ handle: planned.handle, planned, result, execution, decision });
    recordAgentDecisionEvent({
      handle: planned.handle,
      source,
      planned,
      result,
      execution,
      decision,
      narrative,
      timing: {
        planningMs: plannedAt - startedAt,
        executionMs: 0,
        totalMs: Date.now() - startedAt,
        fast
      }
    });
    return {
      ok: false,
      planned,
      agentState,
      decision,
      narrative,
      status: result.status,
      execution,
      reason: result.reason,
      summary: narrative.summary,
      whatChecked: narrative.whatChecked,
      whatHappened: narrative.whatHappened,
      why: narrative.why,
      warnings: narrative.warnings,
      receipt: narrative.receipt,
      nextAction: result.nextAction
    };
  }

  let result;
  try {
    result = await executeAgentPlan({
      planned,
      handle: planned.handle,
      source,
      postId,
      idempotencyKey,
      fast
    });
  } catch (error) {
    result = {
      ok: false,
      status: "failed",
      error: error.message,
      reason: narrateAgentFailure({ planned, error })
    };
  }
  const finishedAt = Date.now();
  const initialExecution = buildAgentExecutionReport({ planned, result });
  const observed = await observeAgentExecution({
    planned,
    result,
    execution: initialExecution
  });
  const execution = observed.execution;
  const decision = buildAgentDecision({
    planned,
    result,
    execution,
    state: agentState
  });
  const agentMemory = rememberAgentExecution({
    handle: planned.handle,
    planned,
    result,
    execution,
    decision
  });
  const narrative = buildAgentNarrative({
    planned,
    result,
    execution,
    decision,
    state: agentState
  });
  if (shouldUseModelNarrator({ planned, result, execution })) {
    const modelReply = await composeExecutionReplyWithModel({
      text,
      planned,
      result,
      execution,
      decision,
      narrative,
      state: agentState
    });
    if (modelReply?.summary) {
      narrative.summary = modelReply.summary;
      narrative.nextAction = modelReply.nextAction || narrative.nextAction;
      narrative.model = modelReply.model;
    }
  }
  const executionMonitor = observed.monitor || executionMonitorFromAgentResult({ result, execution });
  const timing = {
    planningMs: plannedAt - startedAt,
    executionMs: finishedAt - plannedAt,
    totalMs: finishedAt - startedAt,
    fast: Boolean(fast)
  };
  recordAgentDecisionEvent({
    handle: planned.handle,
    source,
    planned,
    result,
    execution,
    decision,
    narrative,
    timing
  });

  return {
    ok: execution.ok,
    status: execution.status,
    reason: execution.reason,
    planned,
    agentState,
    decision,
    narrative,
    agentMemory,
    result,
    execution,
    executionMonitor,
    harness: observed.trace,
    signer: result.payment?.signer || result.action?.signer || result.proposal?.signer || planned.signer,
    txHash: execution.txHash,
    explorerUrl: execution.explorerUrl,
    receiptUrl: execution.receiptUrl,
    summary: narrative.summary,
    whatChecked: narrative.whatChecked,
    whatHappened: narrative.whatHappened,
    why: narrative.why,
    warnings: narrative.warnings,
    receipt: narrative.receipt,
    nextAction: execution.nextAction || result.nextAction || planned.nextAction,
    timing
  };
}

export async function executeAgentPlan({ planned, handle, source = "agent", postId, idempotencyKey, fast = false } = {}) {
  const plan = planned?.plan;
  if (!plan?.tool) {
    throw new Error("Agent plan is missing a tool");
  }
  assertAgentPlanContract({ planned });
  assertAllowedTool(plan.tool);
  const args = plan.arguments || {};

  if (plan.tool === "send_usdc") {
    return await createPaymentIntent({
      ...args,
      senderHandle: handle,
      idempotencyKey,
      source
    });
  }

  if (plan.tool === "create_social_bounty") {
    return await createSocialBounty({
      ...args,
      senderHandle: handle,
      postId: postId || args.postId,
      idempotencyKey,
      source
    });
  }

  if (plan.tool === "create_airdrop") {
    return await createAirdrop({
      ...args,
      senderHandle: args.senderHandle || handle,
      postId: postId || args.postId,
      idempotencyKey,
      source
    });
  }

  if (plan.tool === "award_airdrop") {
    return await awardAirdrop(args);
  }

  if (plan.tool === "list_airdrops") {
    return listAirdrops(args);
  }

  if (plan.tool === "get_airdrop_receipt") {
    return getAirdropReceipt(args);
  }

  if (plan.tool === "list_arc_trading_primitives") {
    return listArcTradingPrimitives();
  }

  if (plan.tool === "quote_defi_route") {
    return await quoteDefiRoute({
      ...args,
      handle,
      idempotencyKey,
      source,
      fast
    });
  }

  if (plan.tool === "propose_perp_trade") {
    return proposePerpTrade({
      ...args,
      handle,
      postId,
      idempotencyKey,
      source
    });
  }

  if (plan.tool === "get_wallet_capabilities") {
    return getWalletCapabilities(args.handle || handle);
  }

  if (plan.tool === "get_agent_memory") {
    return buildAgentMemoryReport({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "answer_agent_question") {
    return answerAgentQuestion({
      ...args,
      handle: args.handle || handle,
      defaultSettlementRail: args.defaultSettlementRail || "arc-testnet"
    });
  }

  if (plan.tool === "cancel_agent_task") {
    return cancelAgentWorkingTask(handle);
  }

  if (plan.tool === "create_agent_workflow") {
    return await createAndRunAgentWorkflow({
      handle: args.handle || handle,
      goal: args.goal,
      steps: args.steps,
      source,
      planStep: async (intent) => planAgentIntent({
        handle: args.handle || handle,
        intent,
        defaultSettlementRail: args.defaultSettlementRail || "arc-testnet",
        source: "agent_workflow"
      }),
      executeStep: async (stepPlan) => await executeAgentPlan({
        planned: stepPlan,
        handle: args.handle || handle,
        source: "agent_workflow",
        idempotencyKey: `${idempotencyKey || "workflow"}:${stepPlan.plan.tool}:${Date.now()}`,
        fast
      })
    });
  }

  if (plan.tool === "resume_agent_workflow") {
    return await runAgentWorkflow({
      workflowId: args.workflowId,
      handle: args.handle || handle,
      planStep: async (intent) => planAgentIntent({
        handle: args.handle || handle,
        intent,
        defaultSettlementRail: args.defaultSettlementRail || "arc-testnet",
        source: "agent_workflow"
      }),
      executeStep: async (stepPlan) => await executeAgentPlan({
        planned: stepPlan,
        handle: args.handle || handle,
        source: "agent_workflow",
        idempotencyKey: `${idempotencyKey || args.workflowId}:${stepPlan.plan.tool}:${Date.now()}`,
        fast
      })
    });
  }

  if (plan.tool === "get_agent_workflow") {
    return {
      ok: true,
      status: "answered",
      workflow: getAgentWorkflow({
        workflowId: args.workflowId,
        handle: args.handle || handle
      })
    };
  }

  if (plan.tool === "list_agent_workflows") {
    return listAgentWorkflows({
      handle: args.handle || handle,
      status: args.status,
      limit: args.limit
    });
  }

  if (plan.tool === "cancel_agent_workflow") {
    return cancelAgentWorkflow({
      workflowId: args.workflowId,
      handle: args.handle || handle
    });
  }

  if (plan.tool === "get_balance") {
    return { ok: true, wallet: getWalletProfile(args.handle || handle) };
  }

  if (plan.tool === "sync_circle_balances") {
    return await syncWalletBalances({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "request_testnet_usdc") {
    return await fundWallet({
      handle: args.handle || handle,
      amount: args.amount || 10,
      source: "circle_faucet",
      settlementRail: args.settlementRail || "arc-testnet"
    });
  }

  if (plan.tool === "list_approvals") {
    return listApprovals(args);
  }

  if (plan.tool === "confirm_action") {
    return await confirmAction({
      ...args,
      approvalId: resolveApprovalId({ handle: args.handle || handle, approvalId: args.approvalId }),
      handle: args.handle || handle
    });
  }

  if (plan.tool === "get_receipt") {
    return getPaymentReceipt(args);
  }

  if (plan.tool === "propose_copy_trade") {
    return proposeCopyTrade(args);
  }

  if (plan.tool === "list_copy_trade_proposals") {
    return listCopyTradeProposals(args);
  }

  if (plan.tool === "list_perp_intelligence") {
    return await listPerpIntelligence(args);
  }

  if (plan.tool === "assess_liquidation_risk") {
    return assessLiquidationRisk(args);
  }

  if (plan.tool === "list_perp_proposals") {
    return listPerpProposals(args);
  }

  if (plan.tool === "arc_perps_readiness") {
    const readiness = getArcPerpsReadiness();
    return {
      ok: true,
      status: readiness.ok ? "ready" : "not_configured",
      readiness,
      reason: readiness.ok ? "ArcPerps contracts are configured." : `ArcPerps contracts are not configured: ${readiness.missing.join(", ")}`,
      nextAction: readiness.ok ? "inspect_arc_perps_status" : "configure_arc_perps_contracts"
    };
  }

  if (plan.tool === "arc_perps_status") {
    const status = await getArcPerpsStatus(args);
    return {
      ok: true,
      status: status.ok ? "ready" : "not_configured",
      arcPerps: status,
      reason: status.ok ? "ArcPerps status loaded." : `ArcPerps contracts are not configured: ${status.missing?.join(", ") || "missing configuration"}`,
      nextAction: status.ok ? "review_status" : "configure_arc_perps_contracts"
    };
  }

  if (plan.tool === "quote_arc_perp_position") {
    return await quoteArcPerpPosition(args);
  }

  if (plan.tool === "read_arc_perps_oracle_price") {
    return await readArcPerpsOraclePrice(args);
  }

  if (plan.tool === "get_arc_perps_position") {
    return await getArcPerpsPosition(args);
  }

  if (plan.tool === "list_arc_perps_positions") {
    return await listArcPerpsPositions(args);
  }

  if (plan.tool === "close_arc_perp_user_position") {
    const closeArgs = await resolveClosePerpPositionArgs({ handle, args });
    if (closeArgs.ok === false) return closeArgs;
    const result = await closeArcPerpPositionWithUserWallet({
      ...args,
      ...closeArgs,
      handle: args.handle || handle,
      idempotencyKey
    });
    if (result && result.ok === false) {
      result.target ||= {
        positionId: closeArgs.positionId,
        position: closeArgs.memory?.position || null,
        resolvedFrom: closeArgs.memory?.resolvedFrom || args.positionRef || null
      };
    }
    return result;
  }

  if (plan.tool === "appkit_readiness") {
    return await getAppKitReadiness();
  }

  if (plan.tool === "list_appkit_capabilities") {
    return await listAppKitCapabilities();
  }

  if (plan.tool === "appkit_estimate_send") {
    return await estimateAppKitSend(args);
  }

  if (plan.tool === "appkit_send_usdc") {
    return await executeAppKitSend(args);
  }

  if (plan.tool === "appkit_estimate_bridge") {
    return await estimateAppKitBridge(args);
  }

  if (plan.tool === "appkit_bridge_usdc") {
    return await executeAppKitBridge(args);
  }

  if (plan.tool === "appkit_estimate_swap") {
    return await estimateAppKitSwap(args);
  }

  if (plan.tool === "appkit_swap") {
    return await executeAppKitSwap(args);
  }

  if (plan.tool === "appkit_unified_balance") {
    return await getAppKitUnifiedBalance(args);
  }

  if (plan.tool === "resolve_x_handle") {
    return resolveIdentity(args);
  }

  if (plan.tool === "list_defi_tools") {
    return listDefiTools();
  }

  if (plan.tool === "list_route_capabilities") {
    return listDefiRouteCapabilities(args);
  }

  if (plan.tool === "list_defi_actions") {
    return listDefiActions(args);
  }

  if (plan.tool === "confirm_defi_action") {
    return await confirmDefiAction({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "reconcile_defi_action") {
    const actionId = resolveDefiActionId({
      handle,
      actionId: args.actionId,
      type: args.type
    });
    const job = enqueueJob({
      type: "reconcile_defi_action",
      payload: { actionId },
      idempotencyKey: `terminal_reconcile_defi_action:${actionId}:${Date.now()}`
    });
    return await runJob({ jobId: job.id });
  }

  if (plan.tool === "get_defi_action_receipt") {
    return getDefiActionReceipt({
      ...args,
      actionId: resolveDefiActionId({
        handle,
        actionId: args.actionId,
        type: args.type
      })
    });
  }

  if (plan.tool === "list_perp_markets") {
    return await listPerpMarkets(args);
  }

  if (plan.tool === "get_market_intelligence") {
    if (args.refresh) {
      await refreshMarketFeedSnapshot({
        settlementRail: args.settlementRail || "arc-testnet",
        force: true
      });
    }
    return getMarketIntelligence({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "get_market_feed_snapshot") {
    return await refreshMarketFeedSnapshot({
      assets: args.assets,
      settlementRail: args.settlementRail || "arc-testnet",
      force: args.force !== false
    });
  }

  if (plan.tool === "analyze_portfolio") {
    return analyzePortfolio({
      ...args,
      handle: args.handle || handle,
      includeRecommendations: args.includeRecommendations !== false
    });
  }

  if (plan.tool === "create_mandate") {
    return createMandate({ ...args, handle: args.handle || handle, source });
  }

  if (plan.tool === "list_mandates") {
    return listMandates({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "update_mandate") {
    return updateMandate({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "delete_mandate") {
    return deleteMandate({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "create_automation") {
    return createAutomation({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "list_automations") {
    return listAutomations({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "run_automation") {
    return await runAutomation(args);
  }

  if (plan.tool === "run_due_automations") {
    return await runDueAutomations(args);
  }

  if (plan.tool === "pause_automations") {
    return pauseAutomations({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "pause_automation") {
    return updateAutomation({ automationId: args.automationId, status: "paused" });
  }

  if (plan.tool === "resume_automation") {
    return updateAutomation({ automationId: args.automationId, status: "active" });
  }

  if (plan.tool === "delete_automation") {
    return deleteAutomation(args);
  }

  if (plan.tool === "create_strategy_policy") {
    return createStrategyPolicy({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "list_strategy_policies") {
    return listStrategyPolicies({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "plan_rebalance_strategy") {
    return planRebalanceStrategy({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "reduce_risk_strategy") {
    return reduceRiskStrategy({ ...args, handle: args.handle || handle });
  }

  if (plan.tool === "run_strategy_check") {
    return runStrategyCheck({ ...args, handle: args.handle || handle });
  }

  throw new Error(`Agent runner cannot execute tool: ${plan.tool}`);
}

function parseWithFallbacks(text, defaultSettlementRail, conversation = [], allowWorkflow = true) {
  if (allowWorkflow) {
    const workflow = parseWorkflowIntent(text, defaultSettlementRail);
    if (workflow) return { parser: "deterministic_workflow", intent: workflow };
  }
  const conversational = parseConversationalIntent(text, defaultSettlementRail, conversation);
  if (conversational) {
    return {
      parser: "conversation_intent",
      intent: conversational
    };
  }

  try {
    const socialIntent = parseSocialCommand(text);
    if (socialIntent.action !== "clarify") {
      return {
        parser: "deterministic_social_command",
        intent: socialIntent
      };
    }
  } catch {
    // Fall through to the terminal-specific command parsers.
  }

  try {
    const tool = parseToolCommand(text, defaultSettlementRail);
    if (tool) return { parser: "deterministic_tool_command", intent: tool };

    const bridge = parseBridge(text, defaultSettlementRail);
    if (bridge) return { parser: "deterministic_bridge", intent: bridge };

    const swap = parseSwap(text, defaultSettlementRail);
    if (swap) return { parser: "deterministic_swap", intent: swap };
  } catch {
    return {
      parser: "clarification_required",
      intent: {
        action: "clarify",
        question: "I understood the command type, but one of the values looked invalid. Can you restate it with amount, asset, and rail?"
      }
    };
  }

  return {
    parser: "clarification_required",
    intent: {
      action: "clarify",
      question: "Do you want to send USDC, bridge/swap, check balances, inspect approvals, use AppKit, or work with perps/copy-trading proposals?"
    }
  };
}

export async function resumeAgentWorkflowsFromMonitor({
  kind,
  id,
  handle,
  defaultSettlementRail = "arc-testnet",
  source = "execution_monitor",
  fast = true
} = {}) {
  return await resumeAgentWorkflowsForExecutionTarget({
    kind,
    id,
    handle,
    planStep: async (intent, workflow) => planAgentIntent({
      handle: workflow.handle,
      intent,
      defaultSettlementRail,
      source: "agent_workflow"
    }),
    executeStep: async (stepPlan, workflow) => await executeAgentPlan({
      planned: stepPlan,
      handle: workflow.handle,
      source,
      idempotencyKey: `${workflow.id}:${kind}:${id}:${stepPlan.plan.tool}`,
      fast
    })
  });
}

export async function runDueAgentWorkflowsFromWorker({
  limit = 10,
  defaultSettlementRail = "arc-testnet",
  source = "workflow_worker",
  fast = true
} = {}) {
  return await runDueAgentWorkflows({
    limit,
    planStep: async (intent, workflow) => planAgentIntent({
      handle: workflow.handle,
      intent,
      defaultSettlementRail,
      source: "agent_workflow"
    }),
    executeStep: async (stepPlan, workflow) => await executeAgentPlan({
      planned: stepPlan,
      handle: workflow.handle,
      source,
      idempotencyKey: `${workflow.id}:due:${workflow.currentStepIndex}:${stepPlan.plan.tool}`,
      fast
    })
  });
}

function parseWorkflowIntent(text, defaultSettlementRail) {
  const raw = String(text || "").trim();
  const parts = raw.split(/\s+(?:and\s+then|then|after\s+that)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return null;
  const intents = [];
  for (const part of parts) {
    const parsed = parseWithFallbacks(part, defaultSettlementRail, [], false);
    if (!parsed.intent || parsed.intent.action === "clarify") return null;
    if (parsed.intent.action === "tool_call" && [
      "create_agent_workflow",
      "resume_agent_workflow",
      "cancel_agent_workflow"
    ].includes(parsed.intent.tool)) return null;
    intents.push(parsed.intent);
  }
  return {
    action: "tool_call",
    tool: "create_agent_workflow",
    arguments: {
      goal: raw,
      steps: intents,
      defaultSettlementRail
    }
  };
}

function parseConversationalIntent(text, defaultSettlementRail, conversation = []) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();
  if (!raw) return null;

  const lastTopic = inferLastTopic(conversation);

  if (/^(?:how|what)\s+(?:do|can)\s+i\s+(?:use|do)\s+(?:this|it)\??$/.test(lower)
    || /^how\s+to\s+use\s+(?:this|it)\??$/.test(lower)
    || /^how\s+does\s+(?:this|it)\s+work\??$/.test(lower)) {
    return toolIntent("answer_agent_question", {
      questionKind: "how_to",
      topic: lastTopic || "agent",
      question: raw,
      defaultSettlementRail
    });
  }

  if (/\bwhat\b.*\bautomations?\b.*\b(can|could|available|support|run|do)\b/.test(lower)
    || /\bwhat\b.*\b(can|could)\b.*\bautomations?\b/.test(lower)
    || /^what automations can you run\??$/.test(lower)) {
    return toolIntent("answer_agent_question", {
      questionKind: "automation_capabilities",
      topic: "automation",
      question: raw,
      defaultSettlementRail
    });
  }

  if (/\b(?:why|what happened|how come)\b[\s\S]{0,80}\bautomations?\b[\s\S]{0,80}\b(?:paused|stopped|failed|not running|did not run|didn't run)\b/.test(lower)
    || /\bautomations?\b[\s\S]{0,80}\b(?:why|what happened|status|paused|stopped|failed|not running|did not run|didn't run)\b/.test(lower)
    || /^why\s+was\s+(?:the\s+)?automation\s+paused\??$/.test(lower)) {
    return toolIntent("answer_agent_question", {
      questionKind: "automation_status",
      topic: "automation",
      question: raw,
      defaultSettlementRail
    });
  }

  if (/\bwhat\b.*\b(tokens?|coins?|assets?|pairs?)\b.*\b(can|could|support|swap|bridge|trade)\b/.test(lower)
    || /\bwhat\b.*\b(can|could)\b.*\b(swap|bridge|trade)\b/.test(lower)
    || /\bwhich\b.*\b(tokens?|coins?|assets?|pairs?|routes?)\b.*\b(live|available|supported|tradable|routable)\b/.test(lower)) {
    return toolIntent("answer_agent_question", {
      questionKind: /\bbridge\b/.test(lower) ? "bridge_capabilities" : "swap_capabilities",
      topic: /\bbridge\b/.test(lower) ? "bridge" : "swap",
      question: raw,
      defaultSettlementRail
    });
  }

  if (/^(?:what\s+(?:can|do)\s+you\s+(?:do|support)|help|help me|how do i use bunos|how do i use the agent)(?:\s+(?:bro|man|mate|please|pls))?\??$/.test(lower)) {
    return toolIntent("answer_agent_question", {
      questionKind: "agent_capabilities",
      topic: "agent",
      question: raw,
      defaultSettlementRail
    });
  }

  return null;
}

function parseBridge(text, defaultSettlementRail) {
  const normalizedText = normalizeTradingLanguage(text);
  const tokenMatch = normalizedText.match(TOKEN_BRIDGE_PATTERN);
  if (tokenMatch) {
    const token = normalizeSwapToken(tokenMatch[2]);
    const amount = parseAmountValue(tokenMatch[1]);
    const fromRail = normalizeRail(tokenMatch[3]) || defaultSettlementRail;
    const toRail = normalizeRail(tokenMatch[4]);
    if (!amount || !token || !toRail || fromRail === toRail) return null;
    return {
      action: "quote_bridge",
      amount,
      asset: token,
      fromToken: token,
      toToken: token,
      fromRail,
      toRail
    };
  }

  const naturalMatch = normalizedText.match(NATURAL_BRIDGE_PATTERN);
  if (naturalMatch) {
    const amount = parseAmountValue(naturalMatch[1]);
    const toRail = normalizeRail(naturalMatch[3]);
    const fromRail = normalizeRail(naturalMatch[4]) || defaultSettlementRail;
    const token = normalizeSwapToken(naturalMatch[2] || "USDC");
    if (!amount || !token || !toRail || fromRail === toRail) return null;
    return {
      action: "quote_bridge",
      amount,
      asset: token,
      fromToken: token,
      toToken: token,
      fromRail,
      toRail
    };
  }

  const match = normalizedText.match(BRIDGE_PATTERN);
  if (!match) return null;
  const amount = parseAmountValue(match[1]);
  const fromRail = normalizeRail(match[2]) || defaultSettlementRail;
  const toRail = normalizeRail(match[3]);
  if (!amount || !toRail || fromRail === toRail) return null;
  return {
    action: "quote_bridge",
    amount,
    asset: "USDC",
    fromToken: "USDC",
    toToken: "USDC",
    fromRail,
    toRail
  };
}

function parseSwap(text, defaultSettlementRail) {
  const normalizedText = normalizeTradingLanguage(text);
  const naturalMatch = normalizedText.match(NATURAL_SWAP_PATTERN);
  if (naturalMatch) {
    return buildSwapIntent({
      amount: naturalMatch[1],
      fromToken: naturalMatch[2],
      toToken: naturalMatch[3],
      settlementRail: naturalMatch[4],
      defaultSettlementRail
    });
  }

  const targetMatch = normalizedText.match(TARGET_SWAP_PATTERN);
  if (targetMatch) {
    return buildSwapIntent({
      amount: targetMatch[2],
      fromToken: targetMatch[3],
      toToken: targetMatch[1],
      settlementRail: targetMatch[4],
      defaultSettlementRail
    });
  }

  const sourceMatch = normalizedText.match(SOURCE_SWAP_PATTERN);
  if (sourceMatch) {
    return buildSwapIntent({
      amount: sourceMatch[1],
      fromToken: sourceMatch[2],
      toToken: sourceMatch[3],
      settlementRail: sourceMatch[4],
      defaultSettlementRail
    });
  }

  const match = normalizedText.match(SWAP_PATTERN) || normalizedText.match(BUY_PATTERN);
  if (!match) return null;
  return buildSwapIntent({
    amount: match[1],
    fromToken: "USDC",
    toToken: match[2],
    settlementRail: match[3],
    defaultSettlementRail
  });
}

function buildSwapIntent({ amount, fromToken, toToken, settlementRail, defaultSettlementRail }) {
  const normalizedAmount = parseAmountValue(amount);
  const normalizedFromToken = normalizeSwapToken(fromToken);
  const normalizedToToken = normalizeSwapToken(toToken);
  if (!normalizedAmount || !normalizedFromToken || !normalizedToToken || normalizedFromToken === normalizedToToken) return null;
  const normalizedRail = normalizeRail(settlementRail) || defaultSettlementRail;
  if (!isSupportedSwapPair({ settlementRail: normalizedRail, fromToken: normalizedFromToken, toToken: normalizedToToken })) {
    return {
      action: "clarify",
      question: "Tell me a valid swap pair and rail. Try: swap $20 EURC to USDC on arc, or use token contract addresses for less common assets."
    };
  }
  return {
    action: "quote_swap",
    amount: normalizedAmount,
    fromToken: normalizedFromToken,
    toToken: normalizedToToken,
    settlementRail: normalizedRail
  };
}

function parseToolCommand(text, defaultSettlementRail) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();

  const targetAllocations = parseTargetAllocations(raw);
  const mandateId = raw.match(/\b(mandate_[a-zA-Z0-9_:-]+)\b/i)?.[1];
  if (mandateId && /\b(delete|remove|disable|cancel)\b/.test(lower)) {
    return toolIntent("delete_mandate", { mandateId });
  }
  if (mandateId && /\b(update|change|edit)\b/.test(lower)) {
    const textAfterId = raw.slice(raw.toLowerCase().indexOf(mandateId.toLowerCase()) + mandateId.length).replace(/^\s*(?:to|as|:|-)\s*/i, "").trim();
    return toolIntent("update_mandate", {
      mandateId,
      ...(textAfterId ? { text: textAfterId } : {})
    });
  }
  if (/\b(mandates?|standing rules?|trading rules?|risk rules?)\b/.test(lower) && /\b(list|show|current|status)\b/.test(lower)) {
    return toolIntent("list_mandates", { limit: extractLimit(raw) || 10 });
  }
  const mandate = parseMandateText(raw);
  if (mandate && /\b(remember|rule|mandate|never|do not|don't|only|allow|allowed|max|maximum|limit|dca|keep me|close perps if|stop[-\s]?loss|take[-\s]?profit)\b/.test(lower)) {
    return toolIntent("create_mandate", {
      text: raw,
      kind: mandate.kind,
      rules: mandate.rules
    });
  }

  const workflowId = raw.match(/\b(workflow_[a-zA-Z0-9_:-]+)\b/i)?.[1];
  if (workflowId && /\b(cancel|stop|drop)\b/.test(lower)) {
    return toolIntent("cancel_agent_workflow", { workflowId });
  }
  if (workflowId && /\b(resume|continue|run|proceed)\b/.test(lower)) {
    return toolIntent("resume_agent_workflow", { workflowId });
  }
  if (workflowId) {
    return toolIntent("get_agent_workflow", { workflowId });
  }
  if (/\b(list|show|current|recent)\b.*\b(workflows?|multi[-\s]?step tasks?)\b/.test(lower)) {
    return toolIntent("list_agent_workflows", { limit: extractLimit(raw) || 10 });
  }

  const automationId = raw.match(/\b(auto_[a-zA-Z0-9_:-]+)\b/i)?.[1];
  if (/\b(?:pause|stop|disable|close|cancel|turn\s+off|shut\s+down|kill)\b[\s\S]{0,80}\b(?:all|every|active|running)\b[\s\S]{0,80}\b(?:automations?|scheduled tasks?|recurring tasks?|schedules?)\b/.test(lower)
    || /\b(?:all|every|active|running)\b[\s\S]{0,80}\b(?:automations?|scheduled tasks?|recurring tasks?|schedules?)\b[\s\S]{0,80}\b(?:pause|stop|disable|close|cancel|turn\s+off|shut\s+down|kill)\b/.test(lower)) {
    return toolIntent("pause_automations", {
      status: "active",
      limit: extractLimit(raw) || 100000
    });
  }
  if (automationId && /\b(delete|remove|cancel)\b/.test(lower)) {
    return toolIntent("delete_automation", { automationId });
  }
  if (automationId && /\b(pause|stop|disable)\b/.test(lower)) {
    return toolIntent("pause_automation", { automationId });
  }
  if (automationId && /\b(resume|start|enable)\b/.test(lower)) {
    return toolIntent("resume_automation", { automationId });
  }
  if (automationId && /\b(run|execute|trigger)\b/.test(lower)) {
    return toolIntent("run_automation", { automationId });
  }
  if (/^(?:list|show|current|status)\s+(?:my\s+)?(?:automations?|scheduled tasks?|recurring tasks?)\b/.test(lower)
    || /^(?:automations?|scheduled tasks?|recurring tasks?)\s+(?:list|status|current|update)\b/.test(lower)
    || /^(?:automation|scheduled task|recurring task)\s+update\??$/.test(lower)
    || /^what(?:'s| is)?\s+(?:my\s+)?(?:automation|scheduled task|recurring task)\s+(?:doing|status)\??$/.test(lower)) {
    return toolIntent("list_automations", { limit: extractLimit(raw) || 10 });
  }
  if (/\b(run|execute|trigger)\b.*\bdue\b.*\b(automations?|scheduled tasks?)\b|\bdue\b.*\b(automations?|scheduled tasks?)\b/.test(lower)) {
    return toolIntent("run_due_automations", { limit: extractLimit(raw) || 20 });
  }
  if (isAutomationRequest(raw)) {
    return toolIntent("create_automation", {
      text: raw,
      ...extractAutomationSchedule(raw),
      defaultSettlementRail
    });
  }

  if (/\b(analy[sz]e|review|what should i do|am i overexposed|overexposed|changed since last trade|portfolio brain|portfolio intelligence)\b/.test(lower)
    && /\b(portfolio|wallet|bags?|exposure|trade)\b/.test(lower)) {
    return toolIntent("analyze_portfolio", {
      settlementRail: extractRail(raw) || undefined
    });
  }

  if (/\b(bridge|swap|defi)\b.*\b(status|receipt|tx|transaction|what happened|update)\b|\b(status|receipt|tx|transaction|what happened|update)\b.*\b(bridge|swap|defi)\b/i.test(raw)) {
    const type = /\bbridge\b/i.test(raw) ? "bridge" : /\bswap\b/i.test(raw) ? "swap" : undefined;
    return toolIntent("get_defi_action_receipt", { actionId: "__latest__", type });
  }

  if (/\b(show|list|read|check|open)\s+(my\s+|the\s+)?(agent\s+|wallet\s+)?memory\b/.test(lower)) {
    return toolIntent("get_agent_memory", { limit: extractLimit(raw) || 8 });
  }

  if (/\b(memory|remember|last trade|recent trades?|trade history|what happened|what did you do|what are you doing|what happened with|status update|catch me up|recap)\b/.test(lower)
    && /\b(agent|wallet|trade|trades?|swap|bridge|perp|position|automation|actions?|history|last|recent|you)\b/.test(lower)) {
    return toolIntent("get_agent_memory", { limit: extractLimit(raw) || 8 });
  }
  if (/\b(perp|position)\b.*\b(status|update|receipt|what happened)\b|\b(status|update|receipt|what happened)\b.*\b(perp|position)\b/.test(lower)) {
    return toolIntent("get_agent_memory", { limit: extractLimit(raw) || 8 });
  }

  if (targetAllocations && /\b(keep|target|allocate|allocation|portfolio|strategy)\b/.test(lower)) {
    return toolIntent("create_strategy_policy", {
      targetAllocations,
      settlementRail: extractRail(raw) || defaultSettlementRail
    });
  }

  if (/\b(rebalance|balance)\b.*\b(wallet|portfolio|strategy|bags?)\b|\b(wallet|portfolio|strategy|bags?)\b.*\brebalance\b/.test(lower)) {
    return toolIntent("plan_rebalance_strategy", {
      settlementRail: extractRail(raw) || defaultSettlementRail
    });
  }

  if (/\b(reduce risk|de-risk|derisk|risk off|move to stables?|protect portfolio)\b/.test(lower)) {
    return toolIntent("reduce_risk_strategy", {
      settlementRail: extractRail(raw) || defaultSettlementRail
    });
  }

  if (/\b(strategy|strategies|allocation policy|target allocations?)\b/.test(lower) && /\b(list|show|current|status)\b/.test(lower)) {
    return toolIntent("list_strategy_policies", { limit: extractLimit(raw) || 10 });
  }

  if (/\b(sync|refresh)\b.*\bbalances?\b|\bbalances?\b.*\b(sync|refresh)\b/.test(lower)) {
    return toolIntent("sync_circle_balances");
  }

  if (/\b(balance|balances|wallet)\b/.test(lower) && !/\bcapabilit|what can/.test(lower)) {
    return toolIntent("get_balance");
  }

  if (/\bcapabilit|what can my wallet do|wallet status/.test(lower)) {
    return toolIntent("get_wallet_capabilities");
  }

  if (/\bfaucet|testnet usdc|request.*usdc/.test(lower)) {
    return toolIntent("request_testnet_usdc", {
      amount: extractAmount(raw) || 10,
      settlementRail: extractRail(raw) || defaultSettlementRail
    });
  }

  const fixedAirdrop = raw.match(AIRDROP_FIXED_PATTERN);
  if (fixedAirdrop) {
    return toolIntent("create_airdrop", {
      amountPerRecipient: Number(fixedAirdrop[1]),
      recipients: extractHandles(fixedAirdrop[2]),
      settlementRail: extractRail(raw) || defaultSettlementRail
    });
  }

  const socialAirdrop = raw.match(AIRDROP_SOCIAL_PATTERN);
  if (socialAirdrop) {
    return toolIntent("create_airdrop", {
      amountPerRecipient: Number(socialAirdrop[1]),
      maxRecipients: Number(socialAirdrop[2]),
      postId: socialAirdrop[3] || undefined,
      rule: "first_commenters",
      settlementRail: extractRail(raw) || defaultSettlementRail
    });
  }

  const airdropId = raw.match(/\b(air_[a-zA-Z0-9_:-]+)\b/i)?.[1];
  if (airdropId && /\b(award|send|pay|distribute)\b/i.test(raw)) {
    return toolIntent("award_airdrop", {
      airdropId,
      winnerHandles: extractHandles(raw)
    });
  }
  if (airdropId && /\breceipt|status|tx|transaction\b/i.test(raw)) {
    return toolIntent("get_airdrop_receipt", { airdropId });
  }
  if (/\bairdrops?\b/.test(lower) && /\b(list|show|status|recent)\b/.test(lower)) {
    return toolIntent("list_airdrops", { limit: extractLimit(raw) || 10 });
  }

  if (/\bapproval|pending approval|confirmations?\b/.test(lower) && !/\b(confirm|approve|execute)\b/.test(lower)) {
    return toolIntent("list_approvals", { limit: extractLimit(raw) || 10 });
  }

  const approvalId = raw.match(/\b(appr_[a-zA-Z0-9_:-]+)\b/i)?.[1];
  if (approvalId && /\b(confirm|approve|execute)\b/i.test(raw)) {
    return toolIntent("confirm_action", { approvalId });
  }
  if (/^(approve|approved|confirm|confirmed|execute|yes|yeah|yep|go|go ahead|do it|run it)$/i.test(raw)) {
    return toolIntent("confirm_action", { approvalId: "__latest_pending__" });
  }

  const paymentId = raw.match(/\b(pay_[a-zA-Z0-9_:-]+)\b/i)?.[1];
  if (paymentId && /\breceipt|status|tx|transaction\b/i.test(raw)) {
    return toolIntent("get_receipt", { paymentId });
  }

  const defiActionId = raw.match(/\b(defi_[a-zA-Z0-9_:-]+)\b/i)?.[1];
  if (defiActionId && /\breconcile|poll|update\b/i.test(raw)) {
    return toolIntent("reconcile_defi_action", { actionId: defiActionId });
  }
  if (defiActionId && /\breceipt|status|tx|transaction\b/i.test(raw)) {
    return toolIntent("get_defi_action_receipt", { actionId: defiActionId });
  }
  if (/\btrade\b.*\b(status|receipt|tx|transaction|what happened|update)\b|\b(status|receipt|tx|transaction|what happened|update)\b.*\btrade\b/i.test(raw)) {
    const type = /\bbridge\b/i.test(raw) ? "bridge" : /\bswap\b/i.test(raw) ? "swap" : undefined;
    return toolIntent("get_defi_action_receipt", { actionId: "__latest__", type });
  }
  if (/\b(bridge|swap|defi|trade)\b.*\b(reconcile|poll|refresh|check again)\b|\b(reconcile|poll|refresh|check again)\b.*\b(bridge|swap|defi|trade)\b/i.test(raw)) {
    const type = /\bbridge\b/i.test(raw) ? "bridge" : /\bswap\b/i.test(raw) ? "swap" : undefined;
    return toolIntent("reconcile_defi_action", { actionId: "__latest__", type });
  }

  const copy = raw.match(COPY_TRADE_PATTERN);
  if (copy) {
    return toolIntent("propose_copy_trade", {
      traderHandle: copy[1],
      capitalUsd: Number(copy[2]),
      settlementRail: defaultSettlementRail
    });
  }
  if (/\bcopy\b.*\bproposal|copy trade proposals?/.test(lower)) {
    return toolIntent("list_copy_trade_proposals", { limit: extractLimit(raw) || 10 });
  }

  const liq = raw.match(LIQUIDATION_RISK_PATTERN);
  if (liq) {
    return toolIntent("assess_liquidation_risk", {
      symbol: liq[1].toUpperCase(),
      side: liq[2].toLowerCase(),
      collateralUsd: Number(liq[3]),
      leverage: Number(liq[4])
    });
  }

    const arcPerpQuote = raw.match(ARC_PERP_QUOTE_PATTERN);
  if (arcPerpQuote) {
    return toolIntent("quote_arc_perp_position", {
      symbol: arcPerpQuote[1].toUpperCase(),
      side: arcPerpQuote[2].toLowerCase(),
      marginUsd: Number(arcPerpQuote[3]),
      leverage: Number(arcPerpQuote[4])
    });
  }

  if (/\b(perp|hyperliquid)\b.*\bmarkets?\b|\bmarkets?\b.*\b(perp|hyperliquid)\b/.test(lower)) {
    return toolIntent("list_perp_markets", { limit: extractLimit(raw) || 10 });
  }
  if (/\bperp intelligence|funding rates?/.test(lower)) {
    return toolIntent("list_perp_intelligence", { limit: extractLimit(raw) || 10 });
  }
  if (/\b(market intelligence|route health|route history|why.*route.*fail|why.*swap.*fail|why.*bridge.*fail|market regime)\b/.test(lower)) {
    return toolIntent("get_market_intelligence", {
      settlementRail: extractRail(raw) || defaultSettlementRail,
      limit: extractLimit(raw) || 20
    });
  }
  if (/\b(market feeds?|price feeds?|token prices?|price context|fresh market data)\b/.test(lower)) {
    return toolIntent("get_market_feed_snapshot", {
      settlementRail: extractRail(raw) || defaultSettlementRail
    });
  }
  if (/\bperp proposals?\b/.test(lower)) {
    return toolIntent("list_perp_proposals", { limit: extractLimit(raw) || 10 });
  }

  if (/\barc\b.*\bperps?\b.*\breadiness|\barc_perps_readiness\b/.test(lower)) {
    return toolIntent("arc_perps_readiness");
  }
  if (/\barc\b.*\bperps?\b.*\bstatus|\barc_perps_status\b/.test(lower)) {
    return toolIntent("arc_perps_status");
  }
  if (/\boracle\b.*\bprice\b|\bprice\b.*\boracle\b/.test(lower)) {
    return toolIntent("read_arc_perps_oracle_price", { symbol: extractSymbol(raw) || "BTC" });
  }
  const closePerp = parseClosePerp(raw);
  if (closePerp) {
    return toolIntent("close_arc_perp_user_position", closePerp);
  }
  if (/\barc\b.*\bperps?\b.*\bpositions?\b/.test(lower)) {
    const positionId = raw.match(/\bposition\s+#?(\d+)\b/i)?.[1];
    if (positionId) return toolIntent("get_arc_perps_position", { positionId: Number(positionId) });
    return toolIntent("list_arc_perps_positions", { limit: extractLimit(raw) || 10 });
  }

  if (/\bapp\s*kit\b.*\breadiness|\bappkit\b.*\breadiness|\bappkit_readiness\b/.test(lower)) {
    return toolIntent("appkit_readiness");
  }
  if (/\bapp\s*kit\b.*\bcapabilit|\bappkit\b.*\bcapabilit/.test(lower)) {
    return toolIntent("list_appkit_capabilities");
  }
  if (/\bapp\s*kit\b|\bappkit\b/.test(lower)) {
    if (/\bestimate\b.*\bbridge\b/.test(lower)) {
      return toolIntent("appkit_estimate_bridge", appKitBridgeArgs(raw, defaultSettlementRail));
    }
    if (/\bbridge\b/.test(lower)) {
      return toolIntent("appkit_bridge_usdc", appKitBridgeArgs(raw, defaultSettlementRail));
    }
    if (/\bestimate\b.*\bswap\b/.test(lower)) {
      return toolIntent("appkit_estimate_swap", appKitSwapArgs(raw, defaultSettlementRail));
    }
    if (/\bswap\b/.test(lower)) {
      return toolIntent("appkit_swap", appKitSwapArgs(raw, defaultSettlementRail));
    }
    if (/\bbalance\b/.test(lower)) {
      return toolIntent("appkit_unified_balance", { settlementRail: extractRail(raw) || defaultSettlementRail, token: "USDC" });
    }
    if (/\bsend\b/.test(lower)) {
      return toolIntent("appkit_send_usdc", { amount: extractAmount(raw) || 0, settlementRail: extractRail(raw) || defaultSettlementRail });
    }
  }

  const handle = raw.match(/@[a-zA-Z0-9_]{1,15}/)?.[0];
  if (handle && /\b(resolve|identity|who is)\b/i.test(raw)) {
    return toolIntent("resolve_x_handle", { handle });
  }

  if (/\bdefi\b.*\btools?\b|\bwhat defi/.test(lower)) {
    return toolIntent("list_defi_tools");
  }
  if (/\b(live|available|supported|route|routes|routable|tradable)\b/.test(lower)
    && /\b(swap|bridge|route|routes|pairs?)\b/.test(lower)
    && /\b(show|list|what|which|available|live|supported)\b/.test(lower)) {
    return toolIntent("list_route_capabilities", {
      status: /\b(live|available|routable|tradable)\b/.test(lower) ? "live" : undefined,
      type: /\bbridge\b/.test(lower) ? "bridge" : /\b(swap|pairs?)\b/.test(lower) ? "swap" : undefined,
      limit: extractLimit(raw) || 25
    });
  }
  if (/\b(arc|trading)\b.*\bprimitives?\b|\bwhat can.*\b(trade|arc)\b/.test(lower)) {
    return toolIntent("list_arc_trading_primitives");
  }
  if (/\bdefi\b.*\bactions?\b|\btransactions?\b.*\bdefi\b/.test(lower)) {
    return toolIntent("list_defi_actions", { limit: extractLimit(raw) || 10 });
  }

  return null;
}

function toolIntent(tool, args = {}) {
  return {
    action: "tool_call",
    tool,
    arguments: args
  };
}

function withAgentHandle(tool, args, handle) {
  const next = { ...args };
  if (tool === "send_usdc" || tool === "create_social_bounty" || tool === "create_airdrop") {
    next.senderHandle ||= handle;
  } else if (![
    "arc_perps_readiness",
    "appkit_readiness",
    "list_appkit_capabilities",
    "list_defi_tools",
    "list_route_capabilities",
    "list_arc_trading_primitives",
    "quote_arc_perp_position",
    "read_arc_perps_oracle_price",
    "get_arc_perps_position",
    "list_arc_perps_positions",
    "answer_agent_question"
  ].includes(tool)) {
    next.handle ||= handle;
  }
  return next;
}

function riskForTool(tool) {
  if (["send_usdc", "create_social_bounty", "create_airdrop", "award_airdrop", "quote_defi_route", "appkit_bridge_usdc", "appkit_swap", "appkit_send_usdc", "confirm_action", "confirm_defi_action", "request_testnet_usdc"].includes(tool)) {
    return "high";
  }
  if (["propose_perp_trade", "propose_copy_trade", "assess_liquidation_risk", "quote_arc_perp_position", "close_arc_perp_user_position", "create_strategy_policy", "plan_rebalance_strategy", "reduce_risk_strategy", "run_strategy_check", "create_mandate", "update_mandate", "delete_mandate", "create_automation", "run_automation", "run_due_automations", "pause_automation", "resume_automation", "delete_automation"].includes(tool)) {
    return "medium";
  }
  return "low";
}

function contradictionBlockForPlan(planned = {}) {
  const tool = planned.plan?.tool;
  if (!tool || riskForTool(tool) !== "high") return null;
  const contradictions = planned.contextMeta?.contextIntegrity?.items || [];
  const blocking = contradictions.filter((item) => item.blocksExecution);
  if (!blocking.length) return null;
  const first = blocking[0];
  return {
    reason: `Current context has conflicting ${first.topic || first.kind || "execution"} evidence. I need a fresh read before moving funds.`,
    summary: "I found conflicting current information, so I am not moving funds yet. Refresh the route, wallet, or receipt state first, then I can continue safely.",
    contradictions: blocking
  };
}

function signerForTool(tool, args) {
  if (["send_usdc", "create_social_bounty", "create_airdrop", "award_airdrop", "quote_defi_route", "confirm_action", "confirm_defi_action", "appkit_bridge_usdc", "appkit_swap"].includes(tool)) {
    return circleUserSigner({
      operation: tool,
      settlementRail: args.settlementRail || args.fromRail || "arc-testnet",
      requiresUserApproval: false,
      executionStatus: "policy_checked"
    });
  }
  if (["appkit_send_usdc", "appkit_estimate_send", "appkit_unified_balance", "propose_perp_trade", "propose_copy_trade", "close_arc_perp_user_position"].includes(tool)) {
    return userWalletSigningRequired({
      operation: tool,
      settlementRail: args.settlementRail || args.fromRail || "arc-testnet",
      reason: "This terminal action cannot use the backend settlement signer."
    });
  }
  return readOnlySigner({ operation: tool });
}

function shouldUseModelBeforeDeterministic(planned = {}) {
  if (config.ai.routerMode === "deterministic_first") return false;
  if (config.ai.routerMode === "model_first") {
    if (planned.parser === "conversation_intent") return false;
    if (["confirm_action", "get_receipt", "get_defi_action_receipt"].includes(planned.plan?.tool)) return false;
    return true;
  }
  if (!planned?.plan?.tool) return true;
  if (planned.parser === "conversation_intent") return false;
  if (planned.plan.tool === "answer_agent_question") return false;
  if (planned.parser?.includes("deterministic_social_command")) return false;
  return false;
}

function inferLastTopic(conversation = []) {
  const items = Array.isArray(conversation) ? conversation.slice().reverse() : [];
  for (const item of items) {
    const text = String(item.content || item.text || "").toLowerCase();
    if (!text) continue;
    if (/\bautomation|scheduled|recurring\b/.test(text)) return "automation";
    if (/\bswap|pair|token|coin|asset|route\b/.test(text)) return "swap";
    if (/\bbridge|rail|base|arc\b/.test(text)) return "bridge";
    if (/\bperp|position|long|short|leverage\b/.test(text)) return "perps";
    if (/\bmandate|rule|policy\b/.test(text)) return "mandates";
    if (/\bportfolio|balance|wallet\b/.test(text)) return "wallet";
  }
  return null;
}

function answerAgentQuestion({
  questionKind = "agent_capabilities",
  topic = "agent",
  question = "",
  handle,
  defaultSettlementRail = "arc-testnet"
} = {}) {
  const kind = String(questionKind || "agent_capabilities");
  const normalizedTopic = String(topic || "agent");
  if (kind === "pending_task") {
    const working = publicAgentWorkingMemory(handle);
    const pending = working.pendingClarification;
    if (!pending) {
      return {
        ok: true,
        status: "answered",
        answer: "There is no unfinished task right now. Tell me what you want to do next.",
        topic: working.topic || normalizedTopic,
        nextAction: "ready_for_next_instruction"
      };
    }
    const missing = (pending.missing || []).map(readableMissingField);
    return {
      ok: true,
      status: "answered",
      answer: [
        working.objective ? `We were working on this: ${working.objective}` : "We were finishing your last request.",
        missing.length
          ? `I still need ${joinNaturalList(missing)} so I do not guess with your money.`
          : "I have the details and can continue when you are ready."
      ].join(" "),
      topic: working.topic || normalizedTopic,
      nextAction: missing.length ? "provide_missing_task_details" : "continue_active_task"
    };
  }
  if (kind === "how_to") {
    return {
      ok: true,
      status: "answered",
      answer: howToAnswer(normalizedTopic, defaultSettlementRail),
      topic: normalizedTopic,
      nextAction: "send_natural_language_request"
    };
  }

  if (kind === "swap_capabilities" || normalizedTopic === "swap") {
    const routes = listDefiRouteCapabilities({
      type: "swap",
      limit: 20
    }).routes || [];
    const live = routes.filter((route) => route.status === "live");
    return {
      ok: true,
      status: "answered",
      answer: buildSwapCapabilityAnswer(live),
      topic: "swap",
      routes: live,
      nextAction: live.length ? "ask_for_swap_amount" : "check_route_registry_later"
    };
  }

  if (kind === "bridge_capabilities" || normalizedTopic === "bridge") {
    const routes = listDefiRouteCapabilities({
      type: "bridge",
      limit: 20
    }).routes || [];
    const live = routes.filter((route) => route.status === "live");
    return {
      ok: true,
      status: "answered",
      answer: buildBridgeCapabilityAnswer(live),
      topic: "bridge",
      routes: live,
      nextAction: live.length ? "ask_for_bridge_amount" : "check_route_registry_later"
    };
  }

  if (kind === "automation_status") {
    const automations = listAutomations({ handle, limit: 8 }).automations || [];
    const active = automations.filter((item) => item.status === "active");
    const paused = automations.filter((item) => item.status === "paused");
    const latest = automations[0] || null;
    const focus = paused[0] || latest;
    const reason = focus
      ? automationPauseReason(focus)
      : "I do not see an automation for this wallet yet.";
    return {
      ok: true,
      status: "answered",
      answer: focus
        ? [
          `${focus.id} is ${focus.status}.`,
          reason,
          focus.status === "paused"
            ? "I did not create a new automation. I only checked the existing one."
            : "I did not change anything."
        ].join(" ")
        : reason,
      topic: "automation",
      automations,
      nextAction: focus?.status === "paused" ? "resume_or_edit_automation_if_needed" : "ready_for_next_instruction"
    };
  }

  if (kind === "automation_capabilities" || normalizedTopic === "automation") {
    const automations = listAutomations({ handle, limit: 8 }).automations || [];
    const active = automations.filter((item) => item.status === "active");
    return {
      ok: true,
      status: "answered",
      answer: [
        "I can run recurring wallet and trading checks, but I only create one when you give me a clear schedule.",
        active.length
          ? `You currently have ${active.length} active automation${active.length === 1 ? "" : "s"}.`
          : "You do not have any active automations right now.",
        "Examples: 'sync balances every 10 minutes', 'swap 1 USDC to EURC every 10 seconds for 4 times', or 'pause all running automations'."
      ].join(" "),
      topic: "automation",
      automations,
      capabilities: [
        "sync balances",
        "repeat an agent action on a schedule",
        "run due automations",
        "pause/resume/delete automations",
        "stop all active automations"
      ],
      nextAction: "give_automation_schedule"
    };
  }

  return {
    ok: true,
    status: "answered",
    answer: [
      "Tell me what you want in normal language and I will choose the right tool before touching funds.",
      "I can check balances, send USDC to X handles, swap live token routes, bridge rails, prepare perps, save trading rules, and run scheduled actions.",
      `For this wallet (${handle || "your handle"}), I default to ${defaultSettlementRail}.`
    ].join(" "),
    topic: "agent",
    nextAction: "send_natural_language_request"
  };
}

function automationPauseReason(automation = {}) {
  const last = automation.lastResult || {};
  const error = automation.lastError || last.reason || last.error || last.status || "";
  if (/create another automation|runaway loop|resolved to create another automation/i.test(error)) {
    return "It paused because the saved automation text looked like it was trying to create another automation. I stop that automatically to prevent a runaway loop.";
  }
  if (automation.status === "completed") {
    return automation.maxRuns
      ? `It completed after ${automation.runCount || automation.maxRuns}/${automation.maxRuns} runs.`
      : "It is completed.";
  }
  if (automation.status === "active") {
    return automation.nextRunAt
      ? `It is still active. The next run is scheduled for ${new Date(automation.nextRunAt).toISOString()}.`
      : "It is active, but I do not see the next scheduled run.";
  }
  if (automation.status === "paused") {
    return error
      ? `It paused after this issue: ${error}`
      : "It is paused, but I do not see a detailed pause reason in memory.";
  }
  return error || "I found the automation, but it does not have a detailed status reason.";
}

function readableMissingField(field) {
  return {
    amount: "the amount",
    recipientHandle: "the recipient",
    fromToken: "the token to spend",
    toToken: "the token to receive",
    fromRail: "the source network",
    toRail: "the destination network",
    symbol: "the market",
    side: "whether you want long or short",
    collateralUsd: "the collateral amount",
    leverage: "the leverage",
    text: "the action to repeat",
    schedule: "the schedule"
  }[field] || String(field);
}

function joinNaturalList(values = []) {
  if (values.length <= 1) return values[0] || "one more detail";
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

function buildSwapCapabilityAnswer(routes = []) {
  if (!routes.length) {
    return "I do not see any live swap route right now. That means I should not pretend a swap is tradable until the route registry or provider proves it.";
  }
  const pairs = routes
    .map((route) => `${route.fromToken} to ${route.toToken} on ${humanRail(route.fromRail)}`)
    .filter(Boolean);
  return `Right now I can try these live swaps: ${pairs.slice(0, 6).join(", ")}. To use one, say something like 'swap 1 USDC to EURC on Arc'.`;
}

function buildBridgeCapabilityAnswer(routes = []) {
  if (!routes.length) {
    return "I do not see any live bridge route right now. I can still check again later, but I should not move funds without a live route.";
  }
  const labels = routes
    .map((route) => `${route.fromToken || "USDC"} from ${humanRail(route.fromRail)} to ${humanRail(route.toRail)}`)
    .filter(Boolean);
  return `Right now I can check these live bridge routes: ${labels.slice(0, 6).join(", ")}. To use one, say something like 'bridge 5 USDC from Arc to Base'.`;
}

function howToAnswer(topic, defaultSettlementRail) {
  if (topic === "automation") {
    return "For automations, tell me the action, the interval, and when to stop. Example: 'swap 1 USDC to EURC every 10 seconds for 4 times'. I will save it and show live run status.";
  }
  if (topic === "swap") {
    return "For swaps, tell me amount, source token, target token, and rail. Example: 'swap 1 USDC to EURC on Arc'. I check live routes first; if no route exists, no funds move.";
  }
  if (topic === "bridge") {
    return "For bridges, tell me amount, token, source rail, and destination rail. Example: 'bridge 5 USDC from Arc to Base'. Small bridges can be expensive, so I check route quality first.";
  }
  if (topic === "perps") {
    return "For perps, give symbol, side, collateral, and leverage. Example: 'long BTC with 1 USDC at 2x'. I prepare the trade, ask for approval, then show the transaction when it submits.";
  }
  if (topic === "wallet") {
    return "For wallet checks, ask naturally: 'show my balance', 'analyze my portfolio', or 'what changed since my last trade'. I will read wallet state and memory before answering.";
  }
  return `Use bunOS like a trading assistant. Say the outcome you want, not a command name. Example: 'swap 1 USDC to EURC on ${humanRail(defaultSettlementRail)}', 'show live routes', or 'analyze my wallet'.`;
}

function humanRail(rail) {
  const value = String(rail || "");
  if (value === "arc-testnet") return "Arc";
  if (value === "base-sepolia") return "Base";
  return value || "this rail";
}

function reasonForTool(tool) {
  if (tool === "answer_agent_question") return "The agent will answer a capability or usage question without executing a trade.";
  if (tool === "get_balance") return "The agent will read the current wallet profile.";
  if (tool === "get_agent_memory") return "The agent will read recent trades, perps, automations, approvals, and failures from its wallet memory.";
  if (tool.includes("agent_workflow")) return "The agent will run a bounded multi-step workflow with separate policy checks for each step.";
  if (tool === "sync_circle_balances") return "The agent will refresh Circle balances into the local ledger.";
  if (tool.includes("airdrop")) return "The agent will use the Arc airdrop campaign ledger and Circle user-wallet payment path.";
  if (tool.startsWith("appkit")) return "The agent will use the Arc AppKit/Circle user-wallet path when configured.";
  if (tool.includes("perp")) return "The agent will use the perps analysis/proposal surface without backend signer execution.";
  if (tool === "analyze_portfolio") return "The agent will inspect wallet exposure, pending actions, perps risk, and strategy drift without executing trades.";
  if (tool === "get_market_feed_snapshot") return "The agent will refresh external market feeds and mark unavailable data as stale instead of inventing prices.";
  if (tool.includes("mandate")) return "The agent will save or inspect standing trading rules and enforce them before future trades.";
  if (tool.includes("automation")) return "The agent will create or manage a recurring automation through the same policy-gated execution path.";
  if (tool === "list_route_capabilities") return "The agent will read the live route registry before suggesting swaps or bridges.";
  if (tool.includes("strategy") || tool.includes("rebalance")) return "The agent will create a portfolio strategy plan without executing trades automatically.";
  if (tool.includes("defi")) return "The agent will use the DeFi action ledger and user-wallet execution provider.";
  return "The agent will call the matching allowlisted tool.";
}

function describeWorkflowIntent(intent = {}) {
  if (intent.action === "quote_swap") return `Swap ${intent.amount || "some"} ${intent.fromToken || "USDC"} to ${intent.toToken || "a token"}.`;
  if (intent.action === "quote_bridge") return `Bridge ${intent.amount || "some"} ${intent.fromToken || "USDC"} to ${intent.toRail || "another rail"}.`;
  if (intent.action === "send_payment") return `Send ${intent.amount || "some"} USDC to ${intent.recipientHandle || "a recipient"}.`;
  if (intent.action === "tool_call") return `Run ${intent.tool}.`;
  return `Run ${intent.action || "workflow step"}.`;
}

function parseClosePerp(text) {
  const lower = String(text || "").toLowerCase();
  if (!/\b(close|exit|flatten)\b/.test(lower) || !/\b(perp|position|trade|long|short|last|latest|current)\b/.test(lower)) {
    return null;
  }
  const match = text.match(CLOSE_PERP_PATTERN);
  const explicitPositionId = text.match(/\b(?:position|pos|trade)?\s*#?(\d+)\b/i)?.[1] || match?.[2];
  const symbol = match?.[3] && !["PERP", "POSITION", "TRADE"].includes(match[3].toUpperCase())
    ? match[3].toUpperCase()
    : extractSymbol(text);
  const side = match?.[4]?.toLowerCase() || (/\blong\b/i.test(text) ? "long" : /\bshort\b/i.test(text) ? "short" : null);
  return {
    ...(explicitPositionId ? { positionId: Number(explicitPositionId) } : { positionRef: match?.[1] || "latest_open" }),
    ...(symbol ? { symbol } : {}),
    ...(side ? { side } : {})
  };
}

function extractAmount(text) {
  const normalized = normalizeTradingLanguage(text);
  const match = String(normalized || "").match(/\$?(\d+(?:\.\d+)?)/);
  return match ? parseAmountValue(match[1]) : null;
}

function extractLimit(text) {
  const match = String(text || "").match(/\b(?:limit|top|last)\s+(\d{1,3})\b/i);
  return match ? Number(match[1]) : null;
}

function isAutomationRequest(text) {
  const lower = String(text || "").toLowerCase();
  if (/\?|\b(?:why|what|how|when|where|which|status|update|list|paused|stopped|failed|not running|did not run|didn't run)\b/.test(lower)) {
    return false;
  }
  const hasAutomationVerb = /\b(?:create|make|start|run|schedule|automate|repeat)\b/.test(lower);
  const hasAutomationNoun = /\b(?:automation|scheduled task|recurring task|schedule)\b/.test(lower);
  const hasSchedule = /\bevery\s+(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|sixty)\s*(?:second|seconds|sec|secs|s|minute|minutes|min|mins|m|hour|hours|hr|hrs|h|day|days|d)\b/.test(lower)
    || /\b(?:daily|hourly|weekly|recurring|repeat)\b/.test(lower);
  const hasRepeatableAction = /\b(?:swap|bridge|send|sync|refresh|check|rebalance|analy[sz]e|run strategy|show balance|balance)\b/.test(lower);
  return hasSchedule && hasRepeatableAction && (hasAutomationVerb || hasAutomationNoun || /\brepeat\b/.test(lower) || !/\b(?:once|now|right now)\b/.test(lower));
}

function extractAutomationIntervalMinutes(text) {
  return extractAutomationSchedule(text).intervalMinutes;
}

function extractAutomationSchedule(text) {
  const raw = String(text || "").toLowerCase();
  const match = raw.match(/\bevery\s+(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|sixty)\s*(second|seconds|sec|secs|s|minute|minutes|min|mins|m|hour|hours|hr|hrs|h|day|days|d)\b/);
  const maxRuns = extractAutomationMaxRuns(raw);
  if (!match) return { intervalMinutes: 60, intervalMs: 60 * 60_000, ...(maxRuns ? { maxRuns } : {}) };
  const amount = parseNumberWord(match[1]);
  const unit = match[2];
  let intervalMs;
  if (unit === "d" || unit.startsWith("day")) intervalMs = amount * 24 * 60 * 60_000;
  else if (unit === "h" || unit.startsWith("hour") || unit.startsWith("hr")) intervalMs = amount * 60 * 60_000;
  else if (unit === "m" || unit.startsWith("minute") || unit.startsWith("min")) intervalMs = amount * 60_000;
  else intervalMs = amount * 1000;
  return {
    intervalMs,
    intervalMinutes: Math.round((intervalMs / 60_000) * 1000) / 1000,
    ...(maxRuns ? { maxRuns } : {})
  };
}

function extractAutomationMaxRuns(text) {
  const match = String(text || "").match(/\b(?:for|until|stop\s+after)\s+(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|sixty)\s*(?:times?|runs?|executions?)\b/i);
  return match ? parseNumberWord(match[1]) : null;
}

function parseNumberWord(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    fifteen: 15,
    twenty: 20,
    thirty: 30,
    sixty: 60
  }[String(value || "").toLowerCase()] || 0;
}

function extractRail(text) {
  if (/\bbase(?:-sepolia)?\b/i.test(text)) return "base-sepolia";
  if (/\barc(?:-testnet)?\b/i.test(text)) return "arc-testnet";
  return null;
}

function extractHandles(text) {
  return Array.from(new Set(
    String(text || "").match(/@[a-zA-Z0-9_]{1,15}/g)?.map((handle) => handle.toLowerCase()) || []
  ));
}

function extractSymbol(text) {
  const ignored = new Set([
    "ARC",
    "BASE",
    "USDC",
    "EURC",
    "CIRBTC",
    "PRICE",
    "ORACLE",
    "PERP",
    "POSITION",
    "POSITIONS",
    "TRADE",
    "TRADES",
    "CLOSE",
    "EXIT",
    "FLATTEN",
    "MY",
    "THE",
    "LAST",
    "LATEST",
    "CURRENT"
  ]);
  const match = String(text || "").toUpperCase().match(/\b[A-Z]{2,12}\b/g)?.find((item) => !ignored.has(item));
  return match || null;
}

function parseTargetAllocations(text) {
  const allocations = {};
  const matches = String(text || "").matchAll(/(\d+(?:\.\d+)?)\s*%\s*(0x[a-fA-F0-9]{40}|[a-zA-Z][a-zA-Z0-9]{1,20})/g);
  for (const match of matches) {
    const token = normalizeSwapToken(match[2]);
    if (token) allocations[token] = Number(match[1]);
  }
  return Object.keys(allocations).length ? allocations : null;
}

function appKitBridgeArgs(text, defaultSettlementRail) {
  const bridge = parseBridge(text, defaultSettlementRail);
  return {
    amount: bridge?.amount || extractAmount(text) || 0,
    fromRail: bridge?.fromRail || extractRail(text) || defaultSettlementRail,
    toRail: bridge?.toRail || (extractRail(text) === "base-sepolia" ? "base-sepolia" : "arc-testnet"),
    token: bridge?.fromToken || bridge?.asset || "USDC"
  };
}

function appKitSwapArgs(text, defaultSettlementRail) {
  const swap = parseSwap(text, defaultSettlementRail);
  return {
    amount: swap?.amount || extractAmount(text) || 0,
    settlementRail: swap?.settlementRail || extractRail(text) || defaultSettlementRail,
    tokenIn: swap?.fromToken || "USDC",
    tokenOut: swap?.toToken || extractSymbol(text) || "EURC"
  };
}

function planFromIntent({ intent, handle, defaultSettlementRail, source }) {
  if (intent.action === "clarify") {
    return {
      tool: null,
      arguments: {},
      canExecuteNow: false,
      requiresConfirmation: false,
      risk: "none",
      signer: readOnlySigner({ operation: "clarify" }),
      reason: intent.question
    };
  }

  if (intent.action === "tool_call") {
    const args = withAgentHandle(intent.tool, intent.arguments || {}, handle);
    return {
      tool: intent.tool,
      arguments: args,
      canExecuteNow: true,
      requiresConfirmation: false,
      risk: riskForTool(intent.tool),
      signer: signerForTool(intent.tool, args),
      reason: reasonForTool(intent.tool)
    };
  }

  if (intent.action === "send_payment") {
    return {
      tool: "send_usdc",
      arguments: {
        senderHandle: handle,
        recipientHandle: intent.recipientHandle,
        amount: intent.amount,
        settlementRail: defaultSettlementRail,
        memo: `agent:${source}`
      },
      canExecuteNow: true,
      requiresConfirmation: true,
      risk: intent.amount > 25 ? "high" : "medium",
      signer: circleUserSigner({
        operation: "send_usdc",
        settlementRail: defaultSettlementRail,
        requiresUserApproval: true,
        executionStatus: "planned"
      }),
      reason: "Payment will be policy-checked and routed through the sender's Circle user wallet."
    };
  }

  if (intent.action === "create_social_bounty") {
    return {
      tool: "create_social_bounty",
      arguments: {
        senderHandle: handle,
        postId: "x-post-from-agent",
        amount: intent.amount,
        asset: intent.asset || "USDC",
        rule: intent.rule || "first_valid_commenter"
      },
      canExecuteNow: true,
      requiresConfirmation: true,
      risk: intent.amount > 25 ? "high" : "medium",
      signer: circleUserSigner({
        operation: "social_bounty_escrow",
        settlementRail: defaultSettlementRail,
        requiresUserApproval: true,
        executionStatus: "planned"
      }),
      reason: "Bounty escrow will be policy-checked and funded from the sender's Circle user wallet."
    };
  }

  if (intent.action === "quote_bridge") {
    return {
      tool: "quote_defi_route",
      arguments: {
        handle,
        type: "bridge",
        fromRail: intent.fromRail,
        toRail: intent.toRail,
        amount: intent.amount,
        fromToken: intent.fromToken || intent.asset || "USDC",
        toToken: intent.toToken || intent.fromToken || intent.asset || "USDC"
      },
      canExecuteNow: true,
      requiresConfirmation: false,
      risk: "high",
      signer: circleUserSigner({
        operation: `bridge_${String(intent.fromToken || intent.asset || "USDC").toLowerCase()}`,
        settlementRail: intent.fromRail,
        requiresUserApproval: false,
        executionStatus: "policy_checked"
      }),
      reason: "The agent will request a live bridge route from the configured user-wallet providers and fail closed if no provider route exists."
    };
  }

  if (intent.action === "quote_swap") {
    return {
      tool: "quote_defi_route",
      arguments: {
        handle,
        type: "swap",
        fromRail: intent.settlementRail,
        toRail: intent.settlementRail,
        amount: intent.amount,
        fromToken: intent.fromToken,
        toToken: intent.toToken
      },
      canExecuteNow: true,
      requiresConfirmation: false,
      risk: "high",
      signer: circleUserSigner({
        operation: "swap",
        settlementRail: intent.settlementRail,
        requiresUserApproval: false,
        executionStatus: "policy_checked"
      }),
      reason: "The agent will request a live swap route from the configured user-wallet providers and fail closed if no provider route exists."
    };
  }

  if (intent.action === "propose_perp_trade") {
    return {
      tool: "propose_perp_trade",
      arguments: {
        handle,
        symbol: intent.symbol,
        side: intent.side,
        collateralUsd: intent.collateralUsd,
        leverage: intent.leverage,
        settlementRail: defaultSettlementRail
      },
      canExecuteNow: false,
      requiresConfirmation: true,
      risk: Number(intent.leverage) > 2 ? "high" : "medium",
      signer: userWalletSigningRequired({
        operation: "open_perp_position",
        settlementRail: defaultSettlementRail,
        reason: "Perp execution needs a user-owned signing adapter. The agent can produce the proposal first."
      }),
      reason: "Perp proposal is available now; live execution remains user-wallet gated."
    };
  }

  return {
    tool: null,
    arguments: {},
    canExecuteNow: false,
    requiresConfirmation: false,
    risk: "unknown",
    signer: readOnlySigner({ operation: "unsupported" }),
    reason: `Unsupported action: ${intent.action}`
  };
}

function normalizeRail(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return null;
  if (text === "arc" || text === "arc-testnet") return "arc-testnet";
  if (text === "base" || text === "base-sepolia") return "base-sepolia";
  return null;
}

function normalizeSwapToken(value) {
  const raw = String(value || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(raw)) return raw;
  const alias = TOKEN_ALIASES.get(raw.toLowerCase());
  if (alias) return alias;
  const token = raw.toUpperCase();
  if (!token || INVALID_SWAP_TOKENS.has(token)) return null;
  if (token === "ETH") return "WETH";
  if (token === "CIRBTC") return "cirBTC";
  return token;
}

function normalizeTradingLanguage(text) {
  let next = String(text || "");
  next = next.replace(/\b(?:a|an|one)\s+(?:dollar|usd|usdc)\b/gi, "1 USDC");
  next = next.replace(/\btwo\s+(?:dollars?|usd|usdc)\b/gi, "2 USDC");
  next = next.replace(/\bthree\s+(?:dollars?|usd|usdc)\b/gi, "3 USDC");
  next = next.replace(/\bfour\s+(?:dollars?|usd|usdc)\b/gi, "4 USDC");
  next = next.replace(/\bfive\s+(?:dollars?|usd|usdc)\b/gi, "5 USDC");
  next = next.replace(/\bsix\s+(?:dollars?|usd|usdc)\b/gi, "6 USDC");
  next = next.replace(/\bseven\s+(?:dollars?|usd|usdc)\b/gi, "7 USDC");
  next = next.replace(/\beight\s+(?:dollars?|usd|usdc)\b/gi, "8 USDC");
  next = next.replace(/\bnine\s+(?:dollars?|usd|usdc)\b/gi, "9 USDC");
  next = next.replace(/\bten\s+(?:dollars?|usd|usdc)\b/gi, "10 USDC");
  next = next.replace(/\beuro\s+(?:coin|stablecoin|stable|token)\b/gi, "EURC");
  next = next.replace(/\busd\s+(?:coin|stablecoin|stable|token)\b/gi, "USDC");
  next = next.replace(/\bcircle\s+btc\b/gi, "cirBTC");
  next = next.replace(/\bcircle\s+bitcoin\b/gi, "cirBTC");
  next = next.replace(/\bwrapped\s+eth(?:ereum)?\b/gi, "WETH");
  next = next.replace(/\beth(?:ereum)?\b/gi, "WETH");
  return next;
}

function parseAmountValue(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "a" || raw === "an" || raw === "one") return 1;
  const words = new Map([
    ["two", 2],
    ["three", 3],
    ["four", 4],
    ["five", 5],
    ["six", 6],
    ["seven", 7],
    ["eight", 8],
    ["nine", 9],
    ["ten", 10]
  ]);
  if (words.has(raw)) return words.get(raw);
  const numeric = Number(raw.replace(/^\$/, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

const TOKEN_ALIASES = new Map([
  ["euro", "EURC"],
  ["eur", "EURC"],
  ["eurocoin", "EURC"],
  ["euro coin", "EURC"],
  ["euro stable", "EURC"],
  ["euro stablecoin", "EURC"],
  ["dollar", "USDC"],
  ["dollars", "USDC"],
  ["usd", "USDC"],
  ["usd coin", "USDC"],
  ["stable dollar", "USDC"],
  ["circle dollar", "USDC"],
  ["bitcoin", "cirBTC"],
  ["btc", "cirBTC"],
  ["circle btc", "cirBTC"],
  ["circle bitcoin", "cirBTC"],
  ["wrapped eth", "WETH"],
  ["wrapped ethereum", "WETH"],
  ["ethereum", "WETH"]
]);

function isSupportedSwapPair({ settlementRail, fromToken, toToken }) {
  return Boolean(settlementRail && fromToken && toToken && fromToken !== toToken);
}

function resolveApprovalId({ handle, approvalId } = {}) {
  if (approvalId && approvalId !== "__latest_pending__") return approvalId;
  const approval = ledger.approvals
    .filter((item) => item.handle === handle && item.status === "pending")
    .slice()
    .reverse()[0];
  if (!approval) {
    throw new Error("I could not find a pending approval for this wallet.");
  }
  return approval.id;
}

function resolveDefiActionId({ handle, actionId, type } = {}) {
  if (actionId && actionId !== "__latest__") return actionId;
  const action = ledger.defiActions
    .filter((item) => item.handle === handle)
    .filter((item) => !type || item.type === type)
    .slice()
    .reverse()[0];
  if (!action) {
    throw new Error(`I could not find a recent ${type || "DeFi"} action for this wallet.`);
  }
  return action.id;
}

async function resolveClosePerpPositionArgs({ handle, args = {} } = {}) {
  if (args.positionId) {
    return { positionId: Number(args.positionId) };
  }

  let profile;
  try {
    profile = getWalletProfile(handle);
  } catch (error) {
    return {
      ok: false,
      status: "wallet_not_found",
      reason: `I could not resolve ${handle}'s wallet before closing the position: ${error.message}`,
      nextAction: "connect_wallet"
    };
  }

  const arcWallet = profile.wallets?.find((wallet) => wallet.rail === "arc-testnet");
  if (!arcWallet?.address) {
    return {
      ok: false,
      status: "wallet_not_found",
      reason: `I cannot close a perp for ${profile.handle} because there is no Arc wallet bound to this account.`,
      nextAction: "connect_wallet"
    };
  }

  let positionsResult;
  try {
    positionsResult = await listArcPerpsPositions({
      ownerAddress: arcWallet.address,
      limit: 50
    });
  } catch (error) {
    return {
      ok: false,
      status: "position_lookup_failed",
      reason: `I could not inspect ArcPerps positions before closing: ${error.message}`,
      nextAction: "check_arc_perps_readiness"
    };
  }

  const symbol = args.symbol ? String(args.symbol).toUpperCase() : null;
  const side = args.side ? String(args.side).toLowerCase() : null;
  const openPositions = (positionsResult.positions || [])
    .filter((position) => position.open)
    .filter((position) => !symbol || position.symbol?.toUpperCase() === symbol)
    .filter((position) => !side || position.side === side);
  let position = openPositions[0];

  if (!position) {
    const proposal = ledger.perpProposals
      .filter((item) => item.handle === profile.handle)
      .filter((item) => item.positionId)
      .filter((item) => ["submitted", "settled", "open"].includes(String(item.status || "").toLowerCase()))
      .filter((item) => !symbol || String(item.symbol || "").toUpperCase() === symbol)
      .filter((item) => !side || String(item.side || "").toLowerCase() === side)
      .slice()
      .reverse()[0];
    if (proposal) {
      position = {
        id: Number(proposal.positionId),
        symbol: proposal.symbol,
        side: proposal.side,
        owner: arcWallet.address,
        open: true,
        source: "agent_memory"
      };
    }
  }

  if (!position) {
    const filters = [symbol, side].filter(Boolean).join(" ");
    return {
      ok: false,
      status: "position_not_found",
      reason: `I did not find an open ${filters ? `${filters} ` : ""}ArcPerps position for ${profile.handle}. Nothing was closed.`,
      nextAction: "list_arc_perps_positions",
      memory: {
        walletAddress: arcWallet.address,
        openPositions: (positionsResult.positions || []).filter((item) => item.open).map((item) => item.id)
      }
    };
  }

  return {
    positionId: position.id,
    memory: {
      resolvedFrom: args.positionRef || "latest_open",
      position
    }
  };
}

function buildAgentExecutionReport({ planned, result = {} } = {}) {
  const payment = result.payment || null;
  const action = result.action || null;
  const proposal = result.proposal || null;
  const receipt = result.receipt || null;
  const tool = planned?.plan?.tool || "unknown";
  const status = result.status
    || payment?.status
    || action?.status
    || proposal?.status
    || receipt?.action?.status
    || receipt?.payment?.status
    || (result.ok === false ? "failed" : "completed");
  const txHash = result.txHash
    || payment?.transfer?.txHash
    || action?.txHash
    || action?.execution?.txHash
    || receipt?.txHash
    || result.steps?.find?.((step) => step.txHash)?.txHash
    || null;
  const explorerUrl = result.explorerUrl
    || action?.explorerUrl
    || action?.execution?.explorerUrl
    || receipt?.explorerUrl
    || result.steps?.find?.((step) => step.explorerUrl)?.explorerUrl
    || null;
  const failureStatuses = new Set([
    "failed",
    "rejected",
    "position_not_found",
    "position_lookup_failed",
    "wallet_not_found",
    "user_wallet_signing_required",
    "execution_not_enabled",
    "quote_unavailable"
  ]);
  const ok = result.ok !== false && !failureStatuses.has(String(status || "").toLowerCase());
  const nextAction = ok
    ? (result.nextAction || nextActionForStatus(status, planned))
    : nextActionForStatus(status, planned);

  return {
    ok,
    tool,
    action: planned?.intent?.action || null,
    status,
    reason: executionReason({ planned, result, status, ok }),
    txHash,
    explorerUrl,
    receiptUrl: result.publicUrl || receipt?.publicUrl || null,
    nextAction,
    ids: {
      paymentId: payment?.id || null,
      actionId: action?.id || receipt?.action?.id || null,
      approvalId: result.approval?.id || payment?.approvalId || action?.approvalId || proposal?.approvalId || null,
      proposalId: proposal?.id || null,
      positionId: result.positionId || result.position?.id || proposal?.positionId || null,
      workflowId: result.workflow?.id || null
    },
    memory: {
      lastTool: tool,
      lastActionId: action?.id || payment?.id || proposal?.id || null,
      lastTrade: result.positionId || result.position?.id || proposal?.id || null,
      workflowId: result.workflow?.id || null,
      ...(result.memory || {})
    }
  };
}

function executionReason({ planned, result, status, ok }) {
  if (result.reason) return result.reason;
  if (result.error) return result.error;
  if (result.action?.failureReason) return result.action.failureReason;
  if (result.signer?.reason) return result.signer.reason;
  if (ok && result.txHash) return `Submitted ${planned?.plan?.tool || "action"} on-chain.`;
  if (ok && status === "submitted") return "The action was submitted and is waiting for settlement.";
  if (ok && status === "requires_confirmation") return "The action is prepared and needs explicit user approval.";
  if (ok && result.workflow?.id) return `Workflow ${result.workflow.id} is ${status}.`;
  if (ok && planned?.plan?.tool === "close_arc_perp_user_position") return "The close-position request was accepted.";
  if (!ok && status === "user_wallet_signing_required") return "This action needs the user's Circle wallet signing path before it can execute.";
  return planned?.plan?.reason || (ok ? "The agent completed the requested tool call." : "The agent could not complete the requested tool call.");
}

function nextActionForStatus(status, planned) {
  const value = String(status || "").toLowerCase();
  if (value === "requires_confirmation") return "approve_action";
  if (value === "waiting_approval") return "approve_current_step_then_resume_workflow";
  if (value === "waiting_execution") return "monitor_receipt_then_resume_workflow";
  if (value === "paused_budget") return "resume_workflow";
  if (value === "submitted") return "monitor_receipt";
  if (value === "settled" || value === "completed") return "done";
  if (value === "position_not_found") return "list_arc_perps_positions";
  if (value === "user_wallet_signing_required") return "connect_or_enable_user_wallet_signing";
  if (value === "execution_not_enabled") return "enable_execution_or_check_provider";
  if (value === "quote_unavailable") return "choose_supported_route";
  if (value === "not_configured") return "configure_required_environment";
  if (value === "failed" || value === "rejected") return "inspect_reason";
  return planned?.nextAction || "review_result";
}

function narrateAgentFailure({ planned, error }) {
  const tool = planned?.plan?.tool || "requested action";
  if (tool === "close_arc_perp_user_position") {
    return `I tried to close the perp position, but it failed before submission: ${error.message}`;
  }
  return `I tried to run ${tool}, but it failed: ${error.message}`;
}

function shouldUseModelNarrator({ planned, result, execution }) {
  const tool = planned?.plan?.tool;
  if (!tool) return false;
  if (["answer_agent_question", "get_balance", "sync_circle_balances", "get_wallet_capabilities", "list_route_capabilities"].includes(tool)) return false;
  if (result?.answer) return false;
  if (result?.wallet) return false;
  return execution?.status !== "clarification_required";
}

function assertAllowedTool(tool) {
  if (!tool) return;
  if (!ALLOWED_TOOLS.has(tool)) {
    throw new Error(`Agent planned unsupported tool: ${tool}`);
  }
}

function finalizePlanned(planned) {
  return {
    ...planned,
    contract: validateAgentPlanContract({ planned })
  };
}

function upgradeTerminalPlan(planned) {
  const fallbackParser = planned.parser?.includes("fallback")
    ? planned.parser
    : `${planned.parser || "deterministic"}_fallback`;
  if (planned.plan?.tool !== "quote_defi_route") {
    return {
      ...planned,
      parser: fallbackParser
    };
  }

  const operation = planned.intent.action === "quote_bridge"
    ? `bridge_${String(planned.intent.fromToken || planned.intent.asset || "USDC").toLowerCase()}`
    : "swap";
  const settlementRail = planned.intent.fromRail || planned.intent.settlementRail || "arc-testnet";
  const signer = circleUserSigner({
    operation,
    settlementRail,
    requiresUserApproval: false,
    executionStatus: "planned"
  });

  return {
    ...planned,
    parser: fallbackParser,
    plan: {
      ...planned.plan,
      canExecuteNow: true,
      requiresConfirmation: false,
      signer,
      reason: `The agent will create a live ${planned.intent.action === "quote_bridge" ? "bridge" : "swap"} route through configured user-wallet providers and fail closed if no route exists.`
    },
    signer,
    policy: {
      ...planned.policy,
      canExecuteNow: true,
      requiresConfirmation: false,
      reason: "Live route plus immediate user-wallet execution."
    },
    nextAction: "call_tool_after_policy_check"
  };
}
