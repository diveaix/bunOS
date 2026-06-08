import { refreshExecutionMonitor } from "./executionMonitor.js";

const PROMOTABLE_STATES = new Set([
  "queued",
  "submitted",
  "settled",
  "failed",
  "expired",
  "rejected",
  "claimable",
  "claimed",
  "execution_not_enabled",
  "user_wallet_signing_required"
]);
const FAILURE_STATES = new Set([
  "failed",
  "expired",
  "rejected",
  "execution_not_enabled",
  "user_wallet_signing_required"
]);

export async function observeAgentExecution({
  planned = {},
  result = {},
  execution = {}
} = {}) {
  const target = observationTarget({ result, execution });
  if (!target) {
    return {
      execution,
      monitor: null,
      trace: harnessTrace({
        outcome: "not_applicable",
        reason: "The action has no monitorable receipt target."
      })
    };
  }

  let refreshed;
  try {
    refreshed = await refreshExecutionMonitor({
      kind: target.kind,
      id: target.id,
      runWorker: false
    });
  } catch (error) {
    return {
      execution,
      monitor: null,
      trace: harnessTrace({
        outcome: "observation_failed",
        kind: target.kind,
        id: target.id,
        reason: publicReason(error.message)
      })
    };
  }

  const monitor = refreshed.monitor || null;
  if (!monitor) {
    return {
      execution,
      monitor: null,
      trace: harnessTrace({
        outcome: "no_monitor",
        kind: target.kind,
        id: target.id
      })
    };
  }

  const plannedHandle = normalizeHandleLocal(planned.handle);
  const monitorHandle = normalizeHandleLocal(monitor.handle);
  if (plannedHandle && monitorHandle && plannedHandle !== monitorHandle) {
    return {
      execution,
      monitor: null,
      trace: harnessTrace({
        outcome: "ownership_mismatch",
        kind: target.kind,
        id: target.id,
        reason: "The receipt target does not belong to the requesting wallet."
      })
    };
  }

  const lifecycle = String(monitor.lifecycle || monitor.status || "").toLowerCase();
  const promoted = PROMOTABLE_STATES.has(lifecycle);
  const observedExecution = promoted
    ? mergeMonitorTruth(execution, monitor, lifecycle)
    : execution;

  return {
    execution: observedExecution,
    monitor,
    trace: harnessTrace({
      outcome: promoted ? "truth_promoted" : "observed",
      kind: target.kind,
      id: target.id,
      lifecycle: lifecycle || null,
      terminal: Boolean(monitor.terminal),
      txHashObserved: Boolean(validTx(monitor.txHash)),
      reason: publicReason(monitor.reason)
    })
  };
}

function observationTarget({ result, execution }) {
  const paymentId = execution.ids?.paymentId || result.payment?.id || null;
  if (paymentId) return { kind: "payment", id: paymentId };

  const actionId = execution.ids?.actionId || result.action?.id || result.receipt?.action?.id || null;
  if (actionId) return { kind: "defi_action", id: actionId };

  const proposalId = execution.ids?.proposalId || result.proposal?.id || null;
  if (proposalId) return { kind: "perp_proposal", id: proposalId };

  return null;
}

function mergeMonitorTruth(execution, monitor, lifecycle) {
  const txHash = validTx(monitor.txHash) || validTx(execution.txHash);
  const rawStatus = String(monitor.rawStatus || "").toLowerCase();
  const status = lifecycle === "failed" && rawStatus && rawStatus !== "confirmed"
    ? rawStatus
    : lifecycle;
  return {
    ...execution,
    ok: !FAILURE_STATES.has(lifecycle),
    status,
    reason: publicReason(monitor.reason) || execution.reason,
    txHash,
    explorerUrl: monitor.explorerUrl || execution.explorerUrl || null,
    receiptUrl: monitor.receiptUrl || execution.receiptUrl || null,
    nextAction: execution.nextAction || monitor.nextAction
  };
}

function harnessTrace({
  outcome,
  kind = null,
  id = null,
  lifecycle = null,
  terminal = false,
  txHashObserved = false,
  reason = null
}) {
  return {
    version: 1,
    mode: "bounded_observe",
    maxFollowUps: 1,
    followUpsUsed: kind && id ? 1 : 0,
    modelCalls: 0,
    spendCalls: 0,
    workerRuns: 0,
    outcome,
    target: kind && id ? { kind, id } : null,
    lifecycle,
    terminal,
    txHashObserved,
    reason
  };
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
  if (!handle) return null;
  const value = String(handle).trim().toLowerCase();
  return value.startsWith("@") ? value : `@${value}`;
}
