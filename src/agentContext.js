import { ledger } from "./fixtures.js";
import { getAgentMemory } from "./agentMemory.js";
import { normalizeHandle } from "./identity.js";
import { listRouteCapabilities } from "./routeRegistry.js";
import { getWalletCapabilities, getWalletProfile } from "./walletAccounts.js";
import {
  publicAgentWorkingMemory,
  resolvePendingClarification
} from "./agentWorkingMemory.js";
import {
  assessAgentContextFacts,
  buildAgentContextFacts
} from "./agentContextFacts.js";

const MAX_RECENT_CONVERSATION = 8;
const MAX_CONTEXT_ITEMS = 6;
const MAX_MODEL_CONTEXT_CHARS = 12_000;

export function buildAgentContext({
  handle = "@sara",
  text = "",
  conversation = [],
  deterministic = {},
  defaultSettlementRail = "arc-testnet"
} = {}) {
  const normalizedHandle = safe(() => normalizeHandle(handle), normalizeHandleLocal(handle));
  const profile = safe(() => getWalletProfile(normalizedHandle), null);
  const capabilities = safe(() => getWalletCapabilities(normalizedHandle), null);
  const memory = getAgentMemory(normalizedHandle);
  const workingMemory = publicAgentWorkingMemory(normalizedHandle);
  const routes = buildRouteContext();
  const recentConversation = summarizeConversation(conversation);
  const inferredTopic = inferContextTopic({ text, conversation: recentConversation, memory });
  const openState = buildOpenState(normalizedHandle);
  const recent = buildRecentContext(normalizedHandle, memory);
  const references = buildReferenceContext({
    text,
    topic: inferredTopic,
    openState,
    memory,
    recent
  });
  const topic = topicForReference(references.kind)
    || (inferredTopic === "agent" ? workingMemory.topic : inferredTopic)
    || "agent";
  references.topic = topic;

  const context = {
    version: 2,
    purpose: "tool_planning_context",
    user: {
      handle: normalizedHandle,
      walletConnected: Boolean(profile?.onboarded && profile?.walletAddress),
      defaultSettlementRail,
      rails: (profile?.wallets || []).map((wallet) => wallet.rail).filter(Boolean)
    },
    wallet: profile ? {
      totalValueUsd: Number(profile.balance || 0),
      balances: profile.balances || {},
      tokenBalances: profile.tokenBalances || {},
      spendable: Boolean(profile.onboarded && profile.walletAddress),
      capabilities: capabilities?.capabilities || {}
    } : {
      totalValueUsd: 0,
      balances: {},
      tokenBalances: {},
      spendable: false,
      capabilities: {}
    },
    routes,
    openState,
    memory: {
      riskProfile: memory.riskProfile || "balanced",
      lastAction: publicLastAction(memory.lastAction),
      lastTrade: publicLastTrade(memory.lastTrade || recent.lastTrade),
      recentFailures: (memory.recentFailures || []).slice(0, 4).map(publicFailure)
    },
    workingMemory,
    recent,
    conversation: {
      topic,
      lastMessages: recentConversation
    },
    references,
    deterministic: {
      parser: deterministic.parser || null,
      tool: deterministic.plan?.tool || null,
      action: deterministic.intent?.action || null,
      confidence: deterministic.plan?.tool ? "high" : "low"
    },
    policies: {
      neverUseBackendSigner: true,
      failClosedOnUnknownRoute: true,
      answerCapabilityQuestionsWithoutExecution: true,
      createAutomationOnlyWithClearSchedule: true,
      requireApprovalForPerps: true
    },
    guidance: guidanceForTopic(topic)
  };
  context.facts = buildAgentContextFacts({
    context,
    text,
    topic
  });
  context.contextIntegrity = assessAgentContextFacts(context.facts);
  return context;
}

export function resolveContextualIntent({ text = "", context = {} } = {}) {
  const lower = String(text || "").trim().toLowerCase();
  if (!lower) return null;

  if (context.workingMemory?.pendingClarification && isTaskCancellation(lower)) {
    return {
      action: "tool_call",
      tool: "cancel_agent_task",
      arguments: {}
    };
  }

  if (context.workingMemory?.pendingClarification && isPendingTaskQuestion(lower)) {
    return {
      action: "tool_call",
      tool: "answer_agent_question",
      arguments: {
        questionKind: "pending_task",
        topic: context.workingMemory.topic || "agent",
        question: text
      }
    };
  }

  const pendingIntent = resolvePendingClarification({
    text,
    working: context.workingMemory
  });
  if (pendingIntent) return pendingIntent;

  if (isRepeatRequest(lower)) {
    return repeatLastTradeIntent(context) || {
      action: "clarify",
      question: "I do not have a previous trade with enough details to repeat. Tell me the amount, asset, and action you want."
    };
  }

  if (isFailureQuestion(lower)) {
    return {
      action: "tool_call",
      tool: "get_agent_memory",
      arguments: {
        limit: 8,
        focus: "last_failure"
      }
    };
  }

  if (isAmbiguousCloseRequest(lower)) {
    const positions = context.openState?.openPerps || [];
    if (positions.length === 1 && positions[0]?.positionId) {
      return {
        action: "tool_call",
        tool: "close_arc_perp_user_position",
        arguments: {
          positionId: Number(positions[0].positionId)
        }
      };
    }
    if (positions.length > 1) {
      return {
        action: "clarify",
        question: `You have ${positions.length} open perp positions. Which position should I close?`
      };
    }
    return {
      action: "clarify",
      question: "I do not see an open perp position to close."
    };
  }

  if (isAmbiguousAutomationPause(lower)) {
    const automations = context.openState?.activeAutomations || [];
    if (automations.length === 1 && automations[0]?.id) {
      return {
        action: "tool_call",
        tool: "pause_automation",
        arguments: {
          automationId: automations[0].id
        }
      };
    }
    if (automations.length > 1) {
      return {
        action: "clarify",
        question: `You have ${automations.length} active automations. Which one should I pause?`
      };
    }
    return {
      action: "clarify",
      question: "I do not see an active automation to pause."
    };
  }

  if (isAmbiguousApprovalRequest(lower)) {
    const approvals = context.openState?.pendingApprovals || [];
    if (approvals.length === 1 && approvals[0]?.id) {
      return {
        action: "tool_call",
        tool: "confirm_action",
        arguments: {
          approvalId: approvals[0].id
        }
      };
    }
    if (approvals.length > 1) {
      return {
        action: "clarify",
        question: `You have ${approvals.length} pending approvals. Which one should I approve?`
      };
    }
    return {
      action: "clarify",
      question: "I do not see a pending approval for this wallet."
    };
  }

  return null;
}

export function summarizeAgentContextForModel(context = {}) {
  const topic = context.conversation?.topic || "agent";
  const included = new Set(["user", "memory", "workingMemory", "conversation", "references", "facts", "contextIntegrity", "policies", "guidance", "deterministic"]);
  const selected = {
    user: context.user,
    memory: context.memory,
    workingMemory: context.workingMemory,
    conversation: context.conversation,
    references: context.references,
    facts: context.facts,
    contextIntegrity: compactContextIntegrity(context.contextIntegrity),
    deterministic: context.deterministic,
    policies: context.policies,
    guidance: context.guidance
  };
  if (["swap", "bridge", "wallet", "perps", "agent"].includes(topic)) {
    selected.wallet = context.wallet;
    included.add("wallet");
  }
  if (["swap", "bridge", "agent"].includes(topic)) {
    selected.routes = context.routes;
    included.add("routes");
  }
  if (topic === "automation") {
    selected.openState = {
      activeAutomations: context.openState?.activeAutomations || [],
      pendingApprovals: []
    };
    included.add("openState.activeAutomations");
  } else if (topic === "workflow") {
    selected.openState = {
      activeWorkflows: context.openState?.activeWorkflows || []
    };
    included.add("openState.activeWorkflows");
  } else if (topic === "perps") {
    selected.openState = {
      openPerps: context.openState?.openPerps || [],
      pendingApprovals: context.openState?.pendingApprovals || []
    };
    included.add("openState.openPerps");
    included.add("openState.pendingApprovals");
  } else if (topic === "agent" || context.references?.kind === "approval") {
    selected.openState = context.openState;
    included.add("openState");
  }
  if (["swap", "bridge", "perps", "wallet", "agent"].includes(topic)) {
    selected.recent = context.recent;
    included.add("recent");
  }

  const bounded = enforceContextBudget(selected, MAX_MODEL_CONTEXT_CHARS);
  bounded.contextMeta = {
    version: context.version || 1,
    topic,
    included: Array.from(included),
    contextIntegrity: compactContextIntegrity(context.contextIntegrity),
    maxChars: MAX_MODEL_CONTEXT_CHARS,
    estimatedChars: JSON.stringify(bounded).length,
    truncated: JSON.stringify(selected).length > MAX_MODEL_CONTEXT_CHARS
  };
  return bounded;
}

function compactContextIntegrity(integrity = {}) {
  return {
    version: integrity.version,
    total: integrity.total,
    executionAuthority: integrity.executionAuthority,
    planningHints: integrity.planningHints,
    historicalOnly: integrity.historicalOnly,
    unusable: integrity.unusable,
    stale: integrity.stale,
    contradictions: integrity.contradictions,
    blockingContradictions: integrity.blockingContradictions,
    hasContradictions: integrity.hasContradictions,
    rule: integrity.rule,
    items: (integrity.contradictions || []).slice(0, 3).map((item) => ({
      key: item.key,
      topic: item.topic,
      claims: item.claims,
      blocksExecution: item.blocksExecution,
      guidance: item.guidance
    }))
  };
}

function buildRouteContext() {
  const liveSwaps = listRouteCapabilities({ type: "swap", status: "live", limit: 20 }).routes || [];
  const liveBridges = listRouteCapabilities({ type: "bridge", status: "live", limit: 20 }).routes || [];
  const blocked = listRouteCapabilities({ includeHidden: false, limit: 50 }).routes
    .filter((route) => route.status !== "live")
    .slice(0, MAX_CONTEXT_ITEMS);
  return {
    liveSwaps: liveSwaps.map(publicRoute),
    liveBridges: liveBridges.map(publicRoute),
    blockedRoutes: blocked.map(publicRoute),
    rule: "Only suggest routes listed in liveSwaps/liveBridges as tradable. Treat blockedRoutes as not executable."
  };
}

function buildOpenState(handle) {
  const pendingApprovals = recentForHandle(ledger.approvals, handle, MAX_CONTEXT_ITEMS)
    .filter((approval) => approval.status === "pending")
    .map((approval) => ({
      id: approval.id,
      kind: approval.kind,
      targetId: approval.targetId,
      title: approval.title || approval.kind
    }));

  const activeAutomations = recentForHandle(ledger.automations, handle, MAX_CONTEXT_ITEMS)
    .filter((automation) => automation.status === "active")
    .map((automation) => ({
      id: automation.id,
      name: automation.name,
      text: automation.payload?.text || automation.text || null,
      intervalMs: automation.intervalMs,
      maxRuns: automation.maxRuns || null,
      runCount: automation.runCount || 0,
      nextRunAt: automation.nextRunAt || null,
      lastRunAt: automation.lastRunAt || null,
      lastStatus: automation.lastResult?.status || automation.lastError || null,
      createdAt: automation.createdAt || null,
      updatedAt: automation.updatedAt || null
    }));

  const openPerps = recentForHandle(ledger.perpProposals, handle, MAX_CONTEXT_ITEMS)
    .filter((proposal) => proposal.positionId && ["submitted", "settled", "open"].includes(String(proposal.status || "").toLowerCase()))
    .map((proposal) => ({
      id: proposal.id,
      positionId: Number(proposal.positionId),
      symbol: proposal.symbol,
      side: proposal.side,
      collateralUsd: proposal.collateralUsd,
      leverage: proposal.leverage,
      status: proposal.status,
      txHash: proposal.txHash || proposal.execution?.txHash || null,
      createdAt: proposal.createdAt || null,
      updatedAt: proposal.updatedAt || proposal.executedAt || proposal.confirmedAt || null
    }));

  const activeWorkflows = recentForHandle(ledger.agentWorkflows || [], handle, MAX_CONTEXT_ITEMS)
    .filter((workflow) => !["completed", "cancelled"].includes(workflow.status))
    .map((workflow) => ({
      id: workflow.id,
      goal: workflow.goal,
      status: workflow.status,
      currentStepIndex: workflow.currentStepIndex,
      stepCount: workflow.steps?.length || 0,
      currentStep: workflow.steps?.[workflow.currentStepIndex]?.status || null,
      updatedAt: workflow.updatedAt || null
    }));

  return {
    pendingApprovals,
    activeAutomations,
    openPerps,
    activeWorkflows
  };
}

function buildRecentContext(handle, memory) {
  const defiActions = recentForHandle(ledger.defiActions, handle, MAX_CONTEXT_ITEMS).map((action) => ({
    id: action.id,
    type: action.type,
    status: action.status,
    amount: action.request?.amount || action.request?.amountUsd || null,
    fromToken: action.request?.fromToken || null,
    toToken: action.request?.toToken || null,
    fromRail: action.request?.fromRail || null,
    toRail: action.request?.toRail || null,
    txHash: action.txHash || action.execution?.txHash || null,
    reason: publicReason(action.failureReason || action.reason || action.lastExecutionError)
  }));
  const perps = recentForHandle(ledger.perpProposals, handle, MAX_CONTEXT_ITEMS).map((proposal) => ({
    id: proposal.id,
    type: "perp",
    status: proposal.status,
    symbol: proposal.symbol,
    side: proposal.side,
    collateralUsd: proposal.collateralUsd,
    leverage: proposal.leverage,
    positionId: proposal.positionId || null,
    txHash: proposal.txHash || proposal.execution?.txHash || null,
    reason: publicReason(proposal.failureReason || proposal.execution?.reason)
  }));
  const lastTrade = deriveLastTrade({ memory, defiActions, perps });
  return {
    lastTrade,
    trades: [...defiActions, ...perps].slice(0, MAX_CONTEXT_ITEMS)
  };
}

function repeatLastTradeIntent(context = {}) {
  const trade = context.memory?.lastTrade || context.recent?.lastTrade;
  if (!trade) return null;
  if (trade.type === "swap" && trade.amount && trade.fromToken && trade.toToken) {
    return {
      action: "quote_swap",
      amount: Number(trade.amount),
      fromToken: trade.fromToken,
      toToken: trade.toToken,
      settlementRail: trade.fromRail || trade.settlementRail || "arc-testnet"
    };
  }
  if (trade.type === "bridge" && trade.amount && trade.fromRail && trade.toRail) {
    return {
      action: "quote_bridge",
      amount: Number(trade.amount),
      asset: trade.fromToken || "USDC",
      fromToken: trade.fromToken || "USDC",
      toToken: trade.toToken || trade.fromToken || "USDC",
      fromRail: trade.fromRail,
      toRail: trade.toRail
    };
  }
  if (trade.type === "perp" && trade.symbol && trade.side && trade.amount && trade.leverage) {
    return {
      action: "propose_perp_trade",
      symbol: trade.symbol,
      side: trade.side,
      collateralUsd: Number(trade.amount),
      leverage: Number(trade.leverage)
    };
  }
  return null;
}

function deriveLastTrade({ memory = {}, defiActions = [], perps = [] } = {}) {
  const memoryTrade = publicLastTrade(memory.lastTrade);
  if (memoryTrade) return memoryTrade;
  const candidates = [...defiActions, ...perps].filter(Boolean);
  return candidates[0] || null;
}

function summarizeConversation(conversation = []) {
  return Array.isArray(conversation)
    ? conversation.slice(-MAX_RECENT_CONVERSATION).map((item) => ({
      role: item.role || "unknown",
      content: String(item.content || item.text || "").slice(0, 500)
    })).filter((item) => item.content)
    : [];
}

function inferContextTopic({ text = "", conversation = [], memory = {} } = {}) {
  const items = [
    { content: text },
    ...conversation.slice().reverse(),
    { content: memory.lastAction?.text || "" },
    { content: memory.lastTrade?.text || "" }
  ];
  for (const item of items) {
    const value = String(item.content || "").toLowerCase();
    if (!value) continue;
    if (/\bworkflow|multi[-\s]?step\b/.test(value)) return "workflow";
    if (/\bautomation|scheduled|recurring\b/.test(value)) return "automation";
    if (/\bswap|pair|token|coin|asset|route|eurc|usdc|cirbtc\b/.test(value)) return "swap";
    if (/\bbridge|rail|base|arc\b/.test(value)) return "bridge";
    if (/\bperp|position|long|short|leverage\b/.test(value)) return "perps";
    if (/\bmandate|rule|policy\b/.test(value)) return "mandates";
    if (/\bportfolio|balance|wallet\b/.test(value)) return "wallet";
  }
  return "agent";
}

function buildReferenceContext({ text = "", topic, openState = {}, memory = {}, recent = {} } = {}) {
  const lower = String(text || "").trim().toLowerCase();
  let kind = null;
  let candidates = [];
  if (isRepeatRequest(lower)) {
    kind = "last_trade";
    candidates = [memory.lastTrade || recent.lastTrade].filter(Boolean);
  } else if (isFailureQuestion(lower)) {
    kind = "last_failure";
    candidates = (memory.recentFailures || []).slice(0, 3);
  } else if (isAmbiguousCloseRequest(lower)) {
    kind = "open_perp";
    candidates = openState.openPerps || [];
  } else if (isAmbiguousAutomationPause(lower)) {
    kind = "automation";
    candidates = openState.activeAutomations || [];
  } else if (isAmbiguousApprovalRequest(lower)) {
    kind = "approval";
    candidates = openState.pendingApprovals || [];
  }
  return {
    kind,
    topic,
    candidateCount: candidates.length,
    resolved: candidates.length === 1,
    requiresClarification: candidates.length > 1,
    candidateIds: candidates.map((candidate) => (
      candidate.id || candidate.positionId || candidate.actionId || candidate.proposalId || null
    )).filter(Boolean).slice(0, MAX_CONTEXT_ITEMS)
  };
}

function topicForReference(kind) {
  if (kind === "open_perp") return "perps";
  if (kind === "automation") return "automation";
  if (kind === "approval") return "agent";
  return null;
}

function guidanceForTopic(topic) {
  const base = [
    "Capability questions are read-only.",
    "Use live route context before suggesting swaps or bridges.",
    "Fail closed when no live route exists.",
    "Never plan backend-signer execution for user funds."
  ];
  if (topic === "automation") {
    return [
      ...base,
      "Only create an automation when the user gives an action plus a schedule.",
      "Questions containing 'automation' are not automatically create requests."
    ];
  }
  if (topic === "perps") {
    return [
      ...base,
      "Perp opens require explicit approval.",
      "Ambiguous close requests should use the known open position when exactly one exists."
    ];
  }
  if (topic === "swap" || topic === "bridge") {
    return [
      ...base,
      "If the requested pair is in blockedRoutes, explain that it is unavailable instead of trying another provider."
    ];
  }
  return base;
}

function publicRoute(route = {}) {
  return {
    id: route.id,
    type: route.type,
    fromRail: route.fromRail,
    toRail: route.toRail,
    fromToken: route.fromToken,
    toToken: route.toToken,
    status: route.status,
    reason: publicReason(route.reason || route.lastError),
    source: route.source || null,
    lastQuotedAt: route.lastQuotedAt || null,
    updatedAt: route.updatedAt || null
  };
}

function publicLastAction(action) {
  if (!action) return null;
  return {
    at: action.at || null,
    text: action.text || null,
    tool: action.tool || null,
    intent: action.intent || null,
    status: action.status || null,
    actionId: action.actionId || null,
    paymentId: action.paymentId || null,
    proposalId: action.proposalId || null,
    positionId: action.positionId || null,
    txHash: validTx(action.txHash),
    reason: publicReason(action.reason)
  };
}

function publicLastTrade(trade) {
  if (!trade) return null;
  return {
    id: trade.id || trade.actionId || trade.proposalId || null,
    type: trade.type || (trade.tool === "propose_perp_trade" ? "perp" : null),
    status: trade.status || null,
    amount: trade.amount || trade.collateralUsd || null,
    fromToken: trade.fromToken || null,
    toToken: trade.toToken || null,
    fromRail: trade.fromRail || trade.settlementRail || null,
    toRail: trade.toRail || trade.settlementRail || null,
    symbol: trade.symbol || null,
    side: trade.side || null,
    leverage: trade.leverage || null,
    positionId: trade.positionId || null,
    txHash: validTx(trade.txHash),
    reason: publicReason(trade.reason)
  };
}

function publicFailure(failure = {}) {
  return {
    at: failure.at || null,
    tool: failure.tool || failure.kind || null,
    status: failure.status || null,
    actionId: failure.actionId || failure.id || null,
    reason: publicReason(failure.reason)
  };
}

function publicReason(reason) {
  return String(reason || "")
    .replace(/Provider details:.*/i, "")
    .replace(/AppKit:.*/i, "")
    .replace(/LI\.FI fallback:.*/i, "")
    .replace(/KIT_KEY:[A-Za-z0-9:_-]+/g, "configured kit key")
    .replace(/0x[a-fA-F0-9]{64}/g, "transaction hash")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280) || null;
}

function recentForHandle(rows = [], handle, limit) {
  return rows
    .filter((row) => row.handle === handle)
    .slice()
    .reverse()
    .slice(0, limit);
}

function isRepeatRequest(lower) {
  return /^(?:do it again|repeat(?: that| it)?|same again|run it again|try that again)$/i.test(lower);
}

function isFailureQuestion(lower) {
  return /^(?:why|what).*?(?:fail|failed|wrong|happen|happened)|(?:why did that fail|what went wrong)\??$/i.test(lower);
}

function isAmbiguousCloseRequest(lower) {
  return /^(?:close|exit|flatten)\s+(?:it|that|the position|my position|trade)\??$/i.test(lower);
}

function isAmbiguousAutomationPause(lower) {
  return /^(?:pause|stop|cancel|turn off)\s+(?:it|that|the automation|this automation)\??$/i.test(lower);
}

function isAmbiguousApprovalRequest(lower) {
  return /^(?:approve|confirm|execute)\s+(?:it|that|this|the action|the trade)\??$/i.test(lower);
}

function isTaskCancellation(lower) {
  return /^(?:never mind|nevermind|forget (?:it|that)|cancel (?:it|that|this)|drop (?:it|that)|start over|new task)\.?$/i.test(lower);
}

function isPendingTaskQuestion(lower) {
  return /^(?:why(?: do you need (?:that|this))?|what for|what (?:were|are) we doing|where were we|what do you still need|what is missing)\??$/i.test(lower);
}

function enforceContextBudget(value, maxChars) {
  const clone = JSON.parse(JSON.stringify(value));
  if (JSON.stringify(clone).length <= maxChars) return clone;

  if (clone.conversation?.lastMessages) clone.conversation.lastMessages = clone.conversation.lastMessages.slice(-4);
  if (clone.recent?.trades) clone.recent.trades = clone.recent.trades.slice(0, 3);
  if (clone.memory?.recentFailures) clone.memory.recentFailures = clone.memory.recentFailures.slice(0, 2);
  if (clone.workingMemory?.recentTurns) clone.workingMemory.recentTurns = clone.workingMemory.recentTurns.slice(0, 3);
  if (clone.routes?.blockedRoutes) clone.routes.blockedRoutes = clone.routes.blockedRoutes.slice(0, 3);
  if (clone.facts) clone.facts = clone.facts.slice(0, 10);
  for (const key of ["pendingApprovals", "activeAutomations", "openPerps", "activeWorkflows"]) {
    if (clone.openState?.[key]) clone.openState[key] = clone.openState[key].slice(0, 3);
  }
  if (JSON.stringify(clone).length <= maxChars) return clone;

  if (clone.facts) clone.facts = clone.facts.slice(0, 6);
  if (clone.routes?.blockedRoutes) clone.routes.blockedRoutes = clone.routes.blockedRoutes.slice(0, 2);
  if (clone.routes?.liveSwaps) clone.routes.liveSwaps = clone.routes.liveSwaps.slice(0, 4);
  if (clone.routes?.liveBridges) clone.routes.liveBridges = clone.routes.liveBridges.slice(0, 2);
  if (JSON.stringify(clone).length <= maxChars) return clone;

  delete clone.recent;
  if (JSON.stringify(clone).length <= maxChars) return clone;

  if (clone.wallet) {
    clone.wallet = {
      totalValueUsd: clone.wallet.totalValueUsd,
      balances: clone.wallet.balances,
      spendable: clone.wallet.spendable
    };
  }
  return clone;
}

function validTx(value) {
  const text = String(value || "");
  return /^0x[a-fA-F0-9]{64}$/.test(text) ? text : null;
}

function normalizeHandleLocal(handle) {
  const value = String(handle || "").trim().toLowerCase();
  return value.startsWith("@") ? value : `@${value}`;
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
