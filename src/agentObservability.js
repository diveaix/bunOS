import { ledger } from "./fixtures.js";
import { redactSensitive } from "./redaction.js";

const FAILURE_CATEGORIES = [
  ["policy", /policy|mandate|limit|forbidden|not allowed|scope/i],
  ["wallet", /wallet|balance|fund|insufficient|signing|signer|gas/i],
  ["route", /route|quote|liquidity|slippage|lifi|appkit|bridge|swap/i],
  ["provider", /provider|circle|api|rpc|network|timeout|unavailable/i],
  ["approval", /approval|confirm|token|expired|signature/i],
  ["model", /model|gemini|intent|planner|clarify/i],
  ["security", /security|replay|rate limit|secret|backend signer/i]
];

export function recordAgentDecisionEvent({
  handle,
  source,
  planned,
  result = {},
  execution = {},
  decision = {},
  narrative = {},
  timing = {}
} = {}) {
  const tool = planned?.plan?.tool || planned?.intent?.action || "unknown";
  const status = execution.status || result.status || (result.ok === false ? "failed" : "completed");
  const ok = execution.ok ?? result.ok !== false;
  const reason = execution.reason || result.reason || result.error || narrative.why || planned?.plan?.reason || "";
  const event = redactSensitive({
    id: `agentobs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: "agent_decision",
    at: new Date().toISOString(),
    handle: normalizeHandle(handle || planned?.handle),
    source: source || planned?.source || "agent",
    tool,
    action: planned?.intent?.action || null,
    ok: Boolean(ok),
    status,
    decision: {
      stance: decision.stance || null,
      confidence: decision.confidence || null,
      riskLevel: decision.riskLevel || planned?.plan?.risk || null,
      nextAction: decision.nextAction || execution.nextAction || result.nextAction || null
    },
    narrativeMode: narrative.mode || null,
    reason: reason || null,
    failureCategory: ok ? null : categorizeFailure(reason || status),
    txHashPresent: Boolean(execution.txHash || result.txHash),
    receiptPresent: Boolean(execution.receiptUrl || result.receiptUrl || narrative.receipt?.url),
    timing: {
      planningMs: Number(timing.planningMs || 0),
      executionMs: Number(timing.executionMs || 0),
      totalMs: Number(timing.totalMs || 0),
      fast: Boolean(timing.fast)
    }
  });

  ledger.agentObservability ||= [];
  ledger.agentObservability.push(event);
  if (ledger.agentObservability.length > 2_000) {
    ledger.agentObservability.splice(0, ledger.agentObservability.length - 2_000);
  }
  return event;
}

export function getAgentMetrics({ windowMs = 24 * 60 * 60_000 } = {}) {
  const since = Date.now() - Number(windowMs || 24 * 60 * 60_000);
  const events = recentAgentEvents(since);
  const planned = events.length;
  const failures = events.filter((event) => !event.ok);
  const executed = events.filter((event) => event.ok && !["clarification_required", "planned"].includes(event.status));
  const pendingActions = countPendingActions();
  const approvals = approvalConversion();
  const x = xCommandMetrics();
  const route = routeMetrics();

  return {
    ok: true,
    windowMs: Number(windowMs || 24 * 60 * 60_000),
    actionsPlanned: planned,
    actionsExecuted: executed.length,
    failures: failures.length,
    failuresByReason: countBy(failures, (event) => event.failureCategory || "unknown"),
    routeFailureRate: route.failureRate,
    averageExecutionMs: average(events.map((event) => event.timing?.executionMs || 0).filter((value) => value > 0)),
    averageTotalMs: average(events.map((event) => event.timing?.totalMs || 0).filter((value) => value > 0)),
    pendingActions,
    approvalConversion: approvals,
    xCommandSuccessRate: x.successRate,
    xCommands: x,
    route,
    latest: events.slice(-10).reverse()
  };
}

export function getAgentHealth({ windowMs = 24 * 60 * 60_000 } = {}) {
  const metrics = getAgentMetrics({ windowMs });
  const failureRate = metrics.actionsPlanned ? metrics.failures / metrics.actionsPlanned : 0;
  const alerts = [];
  if (failureRate > 0.35 && metrics.actionsPlanned >= 5) alerts.push(alert("high_agent_failure_rate", "warning", `Agent failure rate is ${(failureRate * 100).toFixed(1)}%.`));
  if (metrics.routeFailureRate > 0.5 && metrics.route.total >= 3) alerts.push(alert("high_route_failure_rate", "warning", `Route failure rate is ${(metrics.routeFailureRate * 100).toFixed(1)}%.`));
  if (metrics.pendingActions.total > 10) alerts.push(alert("pending_actions_backlog", "warning", `${metrics.pendingActions.total} actions are pending or queued.`));
  if (metrics.approvalConversion.pending > 10) alerts.push(alert("approval_backlog", "warning", `${metrics.approvalConversion.pending} approvals are still pending.`));
  if (metrics.xCommands.total >= 5 && metrics.xCommandSuccessRate < 0.6) alerts.push(alert("low_x_command_success", "warning", `X command success rate is ${(metrics.xCommandSuccessRate * 100).toFixed(1)}%.`));

  const status = alerts.some((item) => item.severity === "critical")
    ? "critical"
    : alerts.length
      ? "degraded"
      : "healthy";

  return {
    ok: status !== "critical",
    status,
    at: new Date().toISOString(),
    metrics,
    alerts,
    summaries: [
      `${metrics.actionsPlanned} agent action(s) planned in window.`,
      `${metrics.failures} failure(s), ${metrics.pendingActions.total} pending/queued action(s).`,
      `X success rate ${(metrics.xCommandSuccessRate * 100).toFixed(1)}%, route failure rate ${(metrics.routeFailureRate * 100).toFixed(1)}%.`
    ]
  };
}

export function listAgentDecisionEvents({ handle, status, limit = 100 } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const events = (ledger.agentObservability || [])
    .filter((event) => (
      (!normalized || event.handle === normalized)
      && (!status || event.status === status)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 100);
  return { ok: true, events };
}

export function categorizeFailure(reason = "") {
  const text = String(reason || "unknown");
  const match = FAILURE_CATEGORIES.find(([, pattern]) => pattern.test(text));
  return match ? match[0] : "unknown";
}

function recentAgentEvents(since) {
  return (ledger.agentObservability || [])
    .filter((event) => new Date(event.at).getTime() >= since);
}

function countPendingActions() {
  const payments = ledger.payments.filter((item) => ["requires_confirmation", "queued", "claimable"].includes(item.status)).length;
  const defi = ledger.defiActions.filter((item) => ["requires_confirmation", "quoted", "confirmed", "execution_not_enabled", "submitted"].includes(item.status)).length;
  const jobs = ledger.jobs.filter((item) => ["queued", "running"].includes(item.status)).length;
  const approvals = ledger.approvals.filter((item) => item.status === "pending").length;
  const perps = ledger.perpProposals.filter((item) => ["requires_confirmation", "confirmed"].includes(item.status)).length;
  return { total: payments + defi + jobs + approvals + perps, payments, defi, jobs, approvals, perps };
}

function approvalConversion() {
  const total = ledger.approvals.length;
  const approved = ledger.approvals.filter((item) => item.status === "approved").length;
  const pending = ledger.approvals.filter((item) => item.status === "pending").length;
  const rejected = ledger.approvals.filter((item) => item.status === "rejected").length;
  return {
    total,
    approved,
    pending,
    rejected,
    rate: total ? approved / total : 0
  };
}

function xCommandMetrics() {
  const total = ledger.xCommands.length;
  const completed = ledger.xCommands.filter((item) => item.status === "completed").length;
  const rejected = ledger.xCommands.filter((item) => ["rejected", "parse_failed", "clarification_required"].includes(item.status)).length;
  const duplicates = ledger.xCommands.reduce((sum, item) => sum + Number(item.replayCount || 0), 0)
    + ledger.xWebhooks.filter((item) => item.status === "duplicate").length;
  return {
    total,
    completed,
    rejected,
    duplicates,
    successRate: total ? completed / total : 0
  };
}

function routeMetrics() {
  const actions = ledger.defiActions.filter((item) => ["swap", "bridge"].includes(item.type));
  const failures = actions.filter((item) => ["rejected", "quote_unavailable", "failed"].includes(item.status)).length;
  return {
    total: actions.length,
    failures,
    failureRate: actions.length ? failures / actions.length : 0
  };
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function alert(code, severity, message) {
  return { code, severity, message };
}

function normalizeHandle(handle) {
  const text = String(handle || "").trim().toLowerCase();
  if (!text) return null;
  return text.startsWith("@") ? text : `@${text}`;
}
