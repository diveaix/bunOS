import { users } from "./fixtures.js";

const MAX_RECENT_TURNS = 12;

export function getAgentWorkingMemory(handle) {
  const user = users.get(normalizeHandleLocal(handle));
  if (!user) return emptyWorkingMemory();

  user.agentMemory ||= {
    riskProfile: user.policy?.riskProfile || "balanced",
    recentDecisions: [],
    recentFailures: []
  };
  user.agentMemory.working ||= emptyWorkingMemory();
  if (Number(user.agentMemory.working.version || 1) < 2) {
    user.agentMemory.working.version = 2;
    user.agentMemory.working.objectiveGraph ||= null;
  }
  return user.agentMemory.working;
}

export function publicAgentWorkingMemory(handle) {
  const working = getAgentWorkingMemory(handle);
  return {
    status: working.status,
    topic: working.topic,
    objective: working.objective,
    pendingClarification: working.pendingClarification ? {
      question: working.pendingClarification.question,
      missing: working.pendingClarification.missing,
      draft: working.pendingClarification.draft
    } : null,
    objectiveGraph: publicObjectiveGraph(working.objectiveGraph),
    lastOutcome: working.lastOutcome,
    recentTurns: (working.recentTurns || []).slice(0, 6)
  };
}

export function rememberAgentTurn({
  handle,
  text,
  planned = {},
  result = {},
  execution = {},
  narrative = {}
} = {}) {
  const working = getAgentWorkingMemory(handle);
  const now = new Date().toISOString();
  const previousPendingAction = working.pendingClarification?.draft?.action || null;
  const intent = planned.intent || {};
  const tool = planned.plan?.tool || null;
  const pending = normalizePendingIntent(intent.pending);
  const status = String(execution.status || result.status || (tool ? "planned" : "clarification_required"));
  const outcome = {
    at: now,
    status,
    tool,
    txHash: validTx(execution.txHash || result.txHash),
    actionId: execution.ids?.actionId || result.action?.id || null,
    proposalId: execution.ids?.proposalId || result.proposal?.id || null,
    positionId: execution.ids?.positionId || result.positionId || result.position?.id || null,
    workflowId: execution.ids?.workflowId || result.workflow?.id || null,
    reason: publicReason(execution.reason || result.reason || result.error),
    summary: publicReason(narrative.summary)
  };

  const preservesPendingTask = tool === "answer_agent_question"
    && planned.plan?.arguments?.questionKind === "pending_task"
    && working.pendingClarification;

  working.topic = inferTopic(planned, working.topic);
  if (!preservesPendingTask) {
    working.objective = describeObjective(planned, working.objective);
  }
  working.lastOutcome = outcome;
  working.updatedAt = now;

  if (preservesPendingTask) {
    working.status = "awaiting_clarification";
  } else if (tool === "cancel_agent_task" || status === "cancelled") {
    working.status = "cancelled";
    working.pendingClarification = null;
  } else if (!tool && pending) {
    working.status = "awaiting_clarification";
    working.pendingClarification = {
      question: intent.question || planned.plan?.reason || "What detail should I use?",
      missing: pending.missing,
      draft: pending.draft,
      createdAt: working.pendingClarification?.createdAt || now,
      updatedAt: now
    };
  } else if (!tool) {
    working.status = "idle";
    working.pendingClarification = null;
  } else if (isTerminalFailure(status, execution, result)) {
    working.status = "failed";
    working.pendingClarification = null;
  } else if (isPendingStatus(status)) {
    working.status = "in_progress";
    working.pendingClarification = null;
  } else {
    working.status = "completed";
    working.pendingClarification = null;
  }

  working.objectiveGraph = transitionObjectiveGraph({
    graph: working.objectiveGraph,
    objective: working.objective,
    topic: working.topic,
    previousPendingAction,
    action: intent.pending?.draft?.action || intent.action || null,
    tool,
    status: working.status,
    executionStatus: status,
    outcome,
    now
  });

  working.recentTurns = [
    {
      at: now,
      user: String(text || planned.text || "").slice(0, 500),
      tool,
      status,
      summary: outcome.summary || outcome.reason
    },
    ...(working.recentTurns || [])
  ].slice(0, MAX_RECENT_TURNS);

  return working;
}

export function resolvePendingClarification({ text = "", working = {} } = {}) {
  const pending = working.pendingClarification;
  if (!pending?.draft?.action) return null;

  const draft = {
    ...pending.draft,
    ...(pending.draft.arguments || {})
  };
  delete draft.arguments;
  const filled = fillDraftFromText(draft, text);
  const missing = missingFields(filled);
  if (missing.length) {
    return {
      action: "clarify",
      question: clarificationQuestion(filled.action, missing),
      pending: {
        draft: stripEmpty(filled),
        missing
      }
    };
  }
  if (filled.action === "create_automation") {
    const { action, ...arguments_ } = stripEmpty(filled);
    return {
      action: "tool_call",
      tool: "create_automation",
      arguments: arguments_
    };
  }
  return stripEmpty(filled);
}

export function buildPendingIntent(action, draft = {}, missing = []) {
  return {
    draft: stripEmpty({ action, ...draft }),
    missing: Array.from(new Set(missing.filter(Boolean)))
  };
}

export function cancelAgentWorkingTask(handle, reason = "cancelled_by_user") {
  const working = getAgentWorkingMemory(handle);
  const previousObjective = working.objective;
  working.status = "cancelled";
  working.pendingClarification = null;
  working.lastOutcome = {
    at: new Date().toISOString(),
    status: "cancelled",
    tool: "cancel_agent_task",
    txHash: null,
    actionId: null,
    proposalId: null,
    positionId: null,
    reason,
    summary: previousObjective
      ? `Cancelled: ${previousObjective}`
      : "There was no unfinished task to cancel."
  };
  working.objectiveGraph = transitionObjectiveGraph({
    graph: working.objectiveGraph,
    objective: previousObjective,
    topic: working.topic,
    tool: "cancel_agent_task",
    status: "cancelled",
    executionStatus: "cancelled",
    outcome: working.lastOutcome,
    now: working.lastOutcome.at
  });
  working.updatedAt = working.lastOutcome.at;
  return {
    ok: true,
    status: "cancelled",
    cancelled: Boolean(previousObjective),
    previousObjective,
    answer: previousObjective
      ? "Okay, I dropped that unfinished task."
      : "There was no unfinished task to cancel.",
    nextAction: "ready_for_next_instruction"
  };
}

function fillDraftFromText(draft, text) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();
  const next = { ...draft };
  const amount = extractAmount(raw);
  const handle = raw.match(/@[a-zA-Z0-9_]{1,15}/)?.[0];
  const rails = extractRails(lower);
  const tokens = extractTokens(raw);
  const side = lower.match(/\b(long|short)\b/)?.[1];
  const leverage = lower.match(/\b(\d+(?:\.\d+)?)\s*x\b/)?.[1];

  if (["quote_swap", "quote_bridge", "send_payment"].includes(next.action) && !positive(next.amount) && amount) {
    next.amount = amount;
  }
  if (next.action === "send_payment" && !next.recipientHandle && handle) {
    next.recipientHandle = normalizeHandleLocal(handle);
  }
  if (next.action === "quote_swap") {
    if (!next.fromToken && tokens.length > 1) next.fromToken = tokens[0];
    if (!next.toToken && tokens.length) next.toToken = tokens[tokens.length - 1];
    if (tokens.length && isCorrection(lower)) next.toToken = tokens[tokens.length - 1];
    next.settlementRail ||= rails[0] || "arc-testnet";
    if (rails.length && isCorrection(lower)) next.settlementRail = rails.at(-1);
    next.fromToken ||= "USDC";
  }
  if (next.action === "quote_bridge") {
    next.fromRail ||= rails[0] || "arc-testnet";
    if (!next.toRail && rails.length) {
      next.toRail = rails.find((rail) => rail !== next.fromRail) || rails[0];
    }
    if (rails.length && isCorrection(lower)) {
      next.toRail = rails.find((rail) => rail !== next.fromRail) || rails.at(-1);
    }
    if (!next.fromToken && tokens.length) next.fromToken = tokens[0];
    next.fromToken ||= next.asset || "USDC";
    next.toToken ||= next.fromToken;
    next.asset ||= next.fromToken;
  }
  if (next.action === "propose_perp_trade") {
    if (!next.symbol && tokens.length) next.symbol = tokens[0] === "cirBTC" ? "BTC" : tokens[0];
    if (!next.side && side) next.side = side;
    if (side && isCorrection(lower)) next.side = side;
    if (!positive(next.collateralUsd) && amount) next.collateralUsd = amount;
    if (!positive(next.leverage) && leverage) next.leverage = Number(leverage);
  }
  if (next.action === "create_automation") {
    const seconds = lower.match(/\bevery\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)\b/)?.[1];
    const minutes = lower.match(/\bevery\s+(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b/)?.[1];
    const maxRuns = lower.match(/\b(?:for|max(?:imum)?|total)\s+(\d+)\s+times?\b/)?.[1];
    if (!positive(next.intervalSeconds) && seconds) next.intervalSeconds = Number(seconds);
    if (!positive(next.intervalMinutes) && minutes) next.intervalMinutes = Number(minutes);
    if (!positive(next.maxRuns) && maxRuns) next.maxRuns = Number(maxRuns);
    if (!next.text && raw && !/^(?:every|for|max|total)\b/i.test(raw)) next.text = raw;
  }
  return next;
}

function missingFields(intent = {}) {
  if (intent.action === "send_payment") {
    return [
      !positive(intent.amount) ? "amount" : null,
      !intent.recipientHandle ? "recipientHandle" : null
    ].filter(Boolean);
  }
  if (intent.action === "quote_swap") {
    return [
      !positive(intent.amount) ? "amount" : null,
      !intent.fromToken ? "fromToken" : null,
      !intent.toToken ? "toToken" : null
    ].filter(Boolean);
  }
  if (intent.action === "quote_bridge") {
    return [
      !positive(intent.amount) ? "amount" : null,
      !intent.fromRail ? "fromRail" : null,
      !intent.toRail ? "toRail" : null
    ].filter(Boolean);
  }
  if (intent.action === "propose_perp_trade") {
    return [
      !intent.symbol ? "symbol" : null,
      !["long", "short"].includes(String(intent.side || "").toLowerCase()) ? "side" : null,
      !positive(intent.collateralUsd) ? "collateralUsd" : null,
      !positive(intent.leverage) ? "leverage" : null
    ].filter(Boolean);
  }
  if (intent.action === "create_automation") {
    return [
      !intent.text ? "text" : null,
      !positive(intent.intervalSeconds) && !positive(intent.intervalMinutes) && !positive(intent.intervalMs)
        ? "schedule"
        : null
    ].filter(Boolean);
  }
  return [];
}

function clarificationQuestion(action, missing) {
  const labels = {
    amount: "amount",
    recipientHandle: "recipient",
    fromToken: "source token",
    toToken: "token to receive",
    fromRail: "source network",
    toRail: "destination network",
    symbol: "market",
    side: "long or short direction",
    collateralUsd: "collateral amount",
    leverage: "leverage",
    text: "action to repeat",
    schedule: "schedule"
  };
  const readable = missing.map((field) => labels[field] || field);
  const joined = readable.length > 1
    ? `${readable.slice(0, -1).join(", ")} and ${readable.at(-1)}`
    : readable[0];
  const prefix = {
    send_payment: "To send the payment",
    quote_swap: "To make that swap",
    quote_bridge: "To make that bridge",
    propose_perp_trade: "To prepare that perp trade",
    create_automation: "To create that automation"
  }[action] || "To continue";
  return `${prefix}, I still need the ${joined}.`;
}

function normalizePendingIntent(pending) {
  if (!pending?.draft?.action) return null;
  const draft = stripEmpty(pending.draft);
  const missing = pending.missing?.length ? pending.missing : missingFields(draft);
  return { draft, missing };
}

function inferTopic(planned, fallback) {
  const action = String(planned.intent?.pending?.draft?.action || planned.intent?.action || "");
  const tool = String(planned.plan?.tool || "");
  if (/workflow/.test(`${action} ${tool}`)) return "workflow";
  if (/automation/.test(`${action} ${tool}`)) return "automation";
  if (/perp|position/.test(`${action} ${tool}`)) return "perps";
  if (/bridge/.test(`${action} ${tool}`)) return "bridge";
  if (/swap|defi_route/.test(`${action} ${tool}`)) return "swap";
  if (/payment|send_usdc/.test(`${action} ${tool}`)) return "payment";
  if (/balance|wallet|portfolio/.test(`${action} ${tool}`)) return "wallet";
  return fallback || "agent";
}

function describeObjective(planned, fallback) {
  const intent = planned.intent?.pending?.draft || planned.intent || {};
  if (intent.action === "quote_swap") {
    return `Swap ${intent.amount || "an amount of"} ${intent.fromToken || "a token"} to ${intent.toToken || "another token"}.`;
  }
  if (intent.action === "quote_bridge") {
    return `Bridge ${intent.amount || "an amount"} ${intent.fromToken || intent.asset || "USDC"} from ${intent.fromRail || "a source network"} to ${intent.toRail || "a destination network"}.`;
  }
  if (intent.action === "send_payment") {
    return `Send ${intent.amount || "an amount of"} USDC to ${intent.recipientHandle || "a recipient"}.`;
  }
  if (intent.action === "propose_perp_trade") {
    return `Open a ${intent.side || "long or short"} ${intent.symbol || "perp"} position.`;
  }
  if (intent.action === "create_automation" || planned.plan?.tool === "create_automation") {
    return `Create a recurring automation for ${intent.text || planned.plan?.arguments?.text || "a user action"}.`;
  }
  if (planned.plan?.tool === "get_balance") return "Check the wallet balance.";
  if (planned.plan?.tool === "analyze_portfolio") return "Analyze the wallet portfolio.";
  if (planned.plan?.tool === "list_automations") return "Review current automations.";
  if (planned.plan?.tool === "create_agent_workflow") {
    return planned.plan?.arguments?.goal || "Complete a bounded multi-step workflow.";
  }
  if (planned.plan?.tool?.includes("agent_workflow")) return "Continue the active multi-step workflow.";
  if (planned.plan?.tool === "cancel_agent_task") return null;
  if (planned.plan?.tool) return `Run ${String(planned.plan.tool).replaceAll("_", " ")}.`;
  return fallback || null;
}

function extractAmount(text) {
  if (/^\s*\d+(?:\.\d+)?\s*x\s*$/i.test(String(text || ""))) return null;
  const numeric = String(text || "").match(/\$?\s*(\d+(?:\.\d+)?)/)?.[1];
  if (numeric && positive(numeric)) return Number(numeric);
  const words = new Map([
    ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
    ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10]
  ]);
  for (const [word, value] of words) {
    if (new RegExp(`\\b${word}\\b`, "i").test(String(text || ""))) return value;
  }
  return null;
}

function extractRails(lower) {
  const rails = [];
  if (/\barc(?:-testnet)?\b/.test(lower)) rails.push("arc-testnet");
  if (/\bbase(?:-sepolia)?\b/.test(lower)) rails.push("base-sepolia");
  return rails;
}

function extractTokens(text) {
  const aliases = new Map([
    ["USDC", "USDC"],
    ["EURC", "EURC"],
    ["CIRBTC", "cirBTC"],
    ["BTC", "BTC"],
    ["WETH", "WETH"],
    ["ETH", "WETH"],
    ["EURO", "EURC"],
    ["DOLLAR", "USDC"],
    ["BITCOIN", "BTC"]
  ]);
  const ignored = new Set([
    "SWAP", "BRIDGE", "SEND", "MOVE", "FROM", "INTO", "WITH", "USING",
    "LONG", "SHORT", "ARC", "BASE", "USE", "MAKE", "IT", "THAT",
    "ACTUALLY", "INSTEAD", "RATHER", "CHANGE", "SOME", "THE", "TO",
    "OF", "FOR", "ON", "IN", "AND", "DOLLAR", "DOLLARS", "USD"
  ]);
  const matches = String(text || "").match(/0x[a-fA-F0-9]{40}|\b[A-Za-z][A-Za-z0-9]{1,19}\b/g) || [];
  return Array.from(new Set(matches.flatMap((raw) => {
    if (/^0x[a-fA-F0-9]{40}$/.test(raw)) return [raw];
    const value = raw.toUpperCase();
    if (ignored.has(value)) return [];
    if (aliases.has(value)) return [aliases.get(value)];
    return raw === value && /^[A-Z][A-Z0-9]{1,11}$/.test(raw) ? [raw] : [];
  })));
}

function isCorrection(lower) {
  return /\b(?:actually|instead|rather|change|make it)\b/.test(lower);
}

function stripEmpty(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => (
    item !== null && item !== undefined && item !== ""
  )));
}

function emptyWorkingMemory() {
  return {
    version: 2,
    status: "idle",
    topic: "agent",
    objective: null,
    pendingClarification: null,
    objectiveGraph: null,
    lastOutcome: null,
    recentTurns: [],
    updatedAt: null
  };
}

function transitionObjectiveGraph({
  graph,
  objective,
  topic,
  previousPendingAction = null,
  action = null,
  tool = null,
  status,
  executionStatus,
  outcome = {},
  now
}) {
  if (!objective && !graph) return null;
  const terminal = ["completed", "failed", "cancelled"].includes(graph?.status);
  const changedAction = Boolean(previousPendingAction && action && previousPendingAction !== action);
  const changedObjective = Boolean(graph?.goal && objective && graph.goal !== objective);
  const startsNew = !graph
    || changedAction
    || (terminal && tool && tool !== "cancel_agent_task")
    || (changedObjective && !previousPendingAction);
  const next = startsNew
    ? createObjectiveGraph({ objective, topic, action, now })
    : {
        ...graph,
        goal: objective || graph.goal,
        topic: topic || graph.topic,
        action: action || graph.action,
        updatedAt: now
      };
  const stage = objectiveStage({ tool, status, executionStatus });
  next.status = objectiveStatus(stage);
  next.currentStep = stage;
  next.steps = objectiveSteps(stage);
  next.evidence = stripEmpty({
    tool,
    actionId: outcome.actionId,
    proposalId: outcome.proposalId,
    positionId: outcome.positionId,
    workflowId: outcome.workflowId,
    txHash: outcome.txHash,
    outcomeStatus: outcome.status,
    reason: outcome.reason
  });
  next.updatedAt = now;
  if (["complete", "failed", "cancelled"].includes(stage)) next.completedAt = now;
  return next;
}

function createObjectiveGraph({ objective, topic, action, now }) {
  return {
    version: 1,
    id: `objective_${Date.now().toString(36)}`,
    goal: objective || "Understand the user's request.",
    topic: topic || "agent",
    action: action || null,
    status: "active",
    currentStep: "understand",
    steps: objectiveSteps("understand"),
    evidence: {},
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };
}

function objectiveStage({ tool, status, executionStatus }) {
  const raw = String(executionStatus || "").toLowerCase();
  if (status === "cancelled" || tool === "cancel_agent_task") return "cancelled";
  if (status === "failed") return "failed";
  if (status === "awaiting_clarification" || !tool) return "clarify";
  if (raw === "requires_confirmation") return "approve";
  if (["submitted", "confirmed", "queued", "pending", "in_progress"].includes(raw) || status === "in_progress") {
    return ["submitted", "confirmed"].includes(raw) ? "monitor" : "execute";
  }
  if (["settled", "completed", "claimed", "answered", "cancelled"].includes(raw) || status === "completed") {
    return "complete";
  }
  return "plan";
}

function objectiveStatus(stage) {
  if (stage === "complete") return "completed";
  if (stage === "failed") return "failed";
  if (stage === "cancelled") return "cancelled";
  if (stage === "clarify") return "waiting_for_user";
  if (stage === "approve") return "waiting_for_approval";
  if (stage === "monitor") return "monitoring";
  return "active";
}

function objectiveSteps(current) {
  const order = ["understand", "clarify", "plan", "approve", "execute", "monitor", "complete"];
  if (current === "failed" || current === "cancelled") {
    return [
      { id: "understand", status: "completed" },
      { id: current, status: current }
    ];
  }
  const currentIndex = order.indexOf(current);
  return order.map((id, index) => ({
    id,
    status: index < currentIndex
      ? "completed"
      : index === currentIndex
        ? (current === "complete" ? "completed" : "active")
        : "pending"
  }));
}

function publicObjectiveGraph(graph) {
  if (!graph) return null;
  return {
    id: graph.id,
    goal: graph.goal,
    topic: graph.topic,
    action: graph.action,
    status: graph.status,
    currentStep: graph.currentStep,
    steps: graph.steps,
    evidence: graph.evidence,
    createdAt: graph.createdAt,
    updatedAt: graph.updatedAt,
    completedAt: graph.completedAt
  };
}

function isPendingStatus(status) {
  return ["planned", "quoted", "confirmed", "submitted", "requires_confirmation", "pending", "queued"].includes(String(status || "").toLowerCase());
}

function isTerminalFailure(status, execution, result) {
  return execution.ok === false
    || result.ok === false
    || ["failed", "rejected", "quote_unavailable", "position_not_found", "wallet_not_found"].includes(String(status || "").toLowerCase());
}

function positive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function validTx(value) {
  const text = String(value || "");
  return /^0x[a-fA-F0-9]{64}$/.test(text) ? text : null;
}

function publicReason(value) {
  return String(value || "")
    .replace(/Provider details:.*/i, "")
    .replace(/AppKit:.*/i, "")
    .replace(/LI\.FI fallback:.*/i, "")
    .replace(/KIT_KEY:[A-Za-z0-9:_-]+/g, "configured kit key")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500) || null;
}

function normalizeHandleLocal(handle) {
  const value = String(handle || "").trim().toLowerCase();
  return value.startsWith("@") ? value : `@${value}`;
}
