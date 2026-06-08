import { ledger } from "./fixtures.js";
import { refreshExecutionMonitor } from "./executionMonitor.js";

const MAX_WORKFLOW_STEPS = 4;
const MAX_TRANSITIONS_PER_RUN = 4;
const MAX_SPEND_STEPS_PER_RUN = 1;
const MAX_WAIT_REFRESH_ATTEMPTS = 6;
const WAIT_REFRESH_BASE_MS = 10_000;
const WAIT_REFRESH_MAX_MS = 5 * 60_000;
const WORKFLOW_TOOLS = new Set([
  "create_agent_workflow",
  "resume_agent_workflow",
  "get_agent_workflow",
  "list_agent_workflows",
  "cancel_agent_workflow"
]);
const SPEND_TOOLS = new Set([
  "send_usdc",
  "create_social_bounty",
  "create_airdrop",
  "award_airdrop",
  "quote_defi_route",
  "propose_perp_trade",
  "close_arc_perp_user_position",
  "appkit_send_usdc",
  "appkit_bridge_usdc",
  "appkit_swap",
  "confirm_action",
  "confirm_defi_action"
]);
const FAILURE_STATES = new Set([
  "failed",
  "rejected",
  "expired",
  "quote_unavailable",
  "wallet_not_found",
  "position_not_found",
  "execution_not_enabled",
  "user_wallet_signing_required"
]);
const WAITING_STATES = new Set([
  "requires_confirmation",
  "pending",
  "queued",
  "confirmed",
  "submitted",
  "claimable"
]);
const SUCCESS_STATES = new Set([
  "completed",
  "settled",
  "claimed",
  "answered",
  "ready",
  "cancelled"
]);

export function createAgentWorkflow({
  handle,
  goal,
  steps,
  source = "agent"
} = {}) {
  const owner = normalizeHandle(handle);
  const normalizedSteps = normalizeWorkflowSteps(steps);
  const now = new Date().toISOString();
  const workflow = {
    id: `workflow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    handle: owner,
    goal: String(goal || "Complete the requested multi-step action.").slice(0, 500),
    source,
    status: "ready",
    currentStepIndex: 0,
    steps: normalizedSteps.map((intent, index) => ({
      id: `step_${index + 1}`,
      index,
      intent,
      status: "pending",
      tool: null,
      result: null,
      evidence: null,
      startedAt: null,
      completedAt: null
    })),
    limits: {
      maxSteps: MAX_WORKFLOW_STEPS,
      maxTransitionsPerRun: MAX_TRANSITIONS_PER_RUN,
      maxSpendStepsPerRun: MAX_SPEND_STEPS_PER_RUN,
      maxWaitRefreshAttempts: MAX_WAIT_REFRESH_ATTEMPTS,
      recursiveModelCalls: 0
    },
    runCount: 0,
    lastRun: null,
    retry: emptyRetryState(),
    compensation: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };
  ledger.agentWorkflows ||= [];
  ledger.agentWorkflows.push(workflow);
  return workflow;
}

export async function createAndRunAgentWorkflow({
  handle,
  goal,
  steps,
  source,
  planStep,
  executeStep
} = {}) {
  const workflow = createAgentWorkflow({ handle, goal, steps, source });
  return await runAgentWorkflow({
    workflowId: workflow.id,
    handle,
    planStep,
    executeStep
  });
}

export async function runAgentWorkflow({
  workflowId,
  handle,
  planStep,
  executeStep,
  forceRefresh = true
} = {}) {
  const workflow = requireOwnedWorkflow(workflowId, handle);
  if (["completed", "cancelled"].includes(workflow.status)) {
    return workflowResult(workflow, "Workflow is already finished.");
  }
  if (typeof planStep !== "function" || typeof executeStep !== "function") {
    throw new Error("Workflow runner requires planStep and executeStep adapters");
  }

  const run = {
    at: new Date().toISOString(),
    transitions: 0,
    spendSteps: 0,
    modelCalls: 0,
    outcome: "no_progress"
  };
  workflow.runCount += 1;
  workflow.status = "running";

  const refreshed = await refreshWaitingStep(workflow, { forceRefresh });
  if (refreshed.waiting) {
    run.outcome = refreshed.outcome;
    return finishRun(workflow, run);
  }
  if (refreshed.failed) {
    run.outcome = "failed";
    return finishRun(workflow, run);
  }

  while (
    workflow.currentStepIndex < workflow.steps.length
    && run.transitions < MAX_TRANSITIONS_PER_RUN
  ) {
    const step = workflow.steps[workflow.currentStepIndex];
    step.status = "planning";
    step.startedAt ||= new Date().toISOString();

    let planned;
    try {
      planned = await planStep(step.intent, workflow);
    } catch (error) {
      failStep(workflow, step, `Step planning failed: ${publicReason(error.message)}`);
      run.outcome = "failed";
      break;
    }

    const tool = planned?.plan?.tool;
    if (!tool || WORKFLOW_TOOLS.has(tool)) {
      failStep(workflow, step, tool
        ? "Nested workflows are not allowed."
        : planned?.plan?.reason || "The workflow step needs clarification.");
      run.outcome = "failed";
      break;
    }
    step.tool = tool;
    step.planContract = planned.contract || null;

    const spendStep = SPEND_TOOLS.has(tool);
    if (spendStep && run.spendSteps >= MAX_SPEND_STEPS_PER_RUN) {
      step.status = "paused_budget";
      workflow.status = "paused_budget";
      run.outcome = "spend_budget_reached";
      break;
    }

    step.status = "executing";
    let result;
    try {
      result = await executeStep(planned, workflow);
    } catch (error) {
      failStep(workflow, step, `Step execution failed: ${publicReason(error.message)}`);
      run.outcome = "failed";
      break;
    }

    run.transitions += 1;
    if (spendStep) run.spendSteps += 1;
    const evidence = executionEvidence(result);
    step.result = publicStepResult(result);
    step.evidence = evidence;

    if (FAILURE_STATES.has(evidence.status) || result?.ok === false) {
      failStep(workflow, step, evidence.reason || "The workflow step failed.");
      run.outcome = "failed";
      break;
    }

    if (WAITING_STATES.has(evidence.status)) {
      step.status = evidence.status === "requires_confirmation"
        ? "waiting_approval"
        : "waiting_execution";
      workflow.status = step.status;
      armWorkflowRetry(workflow, { outcome: step.status });
      run.outcome = step.status;
      break;
    }

    step.status = "completed";
    step.completedAt = new Date().toISOString();
    resetWorkflowRetry(workflow);
    workflow.currentStepIndex += 1;
    run.outcome = "progressed";

    if (spendStep && workflow.currentStepIndex < workflow.steps.length) {
      workflow.status = "paused_budget";
      run.outcome = "spend_budget_reached";
      break;
    }
  }

  if (workflow.currentStepIndex >= workflow.steps.length) {
    workflow.status = "completed";
    workflow.completedAt = new Date().toISOString();
    run.outcome = "completed";
  } else if (workflow.status === "running") {
    workflow.status = "paused_budget";
  }

  return finishRun(workflow, run);
}

export function getAgentWorkflow({ workflowId, handle } = {}) {
  return publicWorkflow(requireOwnedWorkflow(workflowId, handle));
}

export function listAgentWorkflows({ handle, status, limit = 20 } = {}) {
  const owner = normalizeHandle(handle);
  return {
    ok: true,
    workflows: (ledger.agentWorkflows || [])
      .filter((workflow) => workflow.handle === owner)
      .filter((workflow) => !status || workflow.status === status)
      .slice()
      .reverse()
      .slice(0, Math.max(1, Number(limit) || 20))
      .map(publicWorkflow)
  };
}

export function cancelAgentWorkflow({ workflowId, handle } = {}) {
  const workflow = requireOwnedWorkflow(workflowId, handle);
  if (workflow.status === "completed") {
    return workflowResult(workflow, "Completed workflows cannot be cancelled.");
  }
  workflow.status = "cancelled";
  workflow.completedAt = new Date().toISOString();
  workflow.updatedAt = workflow.completedAt;
  const step = workflow.steps[workflow.currentStepIndex];
  if (step && !["completed", "failed"].includes(step.status)) step.status = "cancelled";
  return workflowResult(workflow, "Workflow cancelled. No automatic rollback was attempted.");
}

export function findAgentWorkflowsForExecutionTarget({ kind, id, handle } = {}) {
  const target = normalizeMonitorTarget({ kind, id });
  if (!target) return [];
  const owner = handle ? normalizeHandle(handle) : null;
  return (ledger.agentWorkflows || [])
    .filter((workflow) => !owner || workflow.handle === owner)
    .filter((workflow) => workflow.status === "waiting_execution")
    .filter((workflow) => {
      const step = workflow.steps?.[workflow.currentStepIndex];
      const stepTarget = monitorTarget(step?.evidence || {});
      return stepTarget?.kind === target.kind && stepTarget?.id === target.id;
    })
    .map(publicWorkflow);
}

export async function resumeAgentWorkflowsForExecutionTarget({
  kind,
  id,
  handle,
  planStep,
  executeStep,
  limit = 3
} = {}) {
  const workflows = findAgentWorkflowsForExecutionTarget({ kind, id, handle });
  const results = [];
  for (const workflow of workflows.slice(0, Math.max(1, Number(limit) || 3))) {
    results.push(await runAgentWorkflow({
      workflowId: workflow.id,
      handle: workflow.handle,
      planStep,
      executeStep,
      forceRefresh: true
    }));
  }
  return {
    ok: true,
    resumed: results.length,
    workflows: results
  };
}

export async function runDueAgentWorkflows({
  limit = 10,
  planStep,
  executeStep
} = {}) {
  if (typeof planStep !== "function" || typeof executeStep !== "function") {
    throw new Error("Workflow due runner requires planStep and executeStep adapters");
  }
  const due = findDueAgentWorkflows({ limit });
  const ran = [];
  const failed = [];
  for (const workflow of due) {
    try {
      ran.push(await runAgentWorkflow({
        workflowId: workflow.id,
        handle: workflow.handle,
        planStep,
        executeStep,
        forceRefresh: false
      }));
    } catch (error) {
      failed.push({
        workflowId: workflow.id,
        handle: workflow.handle,
        error: publicReason(error.message)
      });
    }
  }
  return {
    ok: failed.length === 0,
    due: due.length,
    ran,
    failed
  };
}

export function findDueAgentWorkflows({ handle, limit = 10, now = new Date() } = {}) {
  const owner = handle ? normalizeHandle(handle) : null;
  const ts = now.getTime();
  return (ledger.agentWorkflows || [])
    .filter((workflow) => !owner || workflow.handle === owner)
    .filter((workflow) => workflow.status === "waiting_execution")
    .filter((workflow) => {
      const retry = ensureRetryState(workflow);
      if (retry.exhausted) return false;
      if (!retry.nextRefreshAt) return true;
      return new Date(retry.nextRefreshAt).getTime() <= ts;
    })
    .slice()
    .sort((a, b) => workflowDueAt(a) - workflowDueAt(b))
    .slice(0, Math.max(1, Number(limit) || 10))
    .map(publicWorkflow);
}

function normalizeWorkflowSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 2) {
    throw new Error("A workflow requires at least two steps");
  }
  if (steps.length > MAX_WORKFLOW_STEPS) {
    throw new Error(`A workflow supports at most ${MAX_WORKFLOW_STEPS} steps`);
  }
  return steps.map((step, index) => {
    const intent = step?.intent || step;
    if (!intent?.action || intent.action === "create_workflow") {
      throw new Error(`Workflow step ${index + 1} has an invalid action`);
    }
    return JSON.parse(JSON.stringify(intent));
  });
}

async function refreshWaitingStep(workflow, { forceRefresh = false } = {}) {
  const step = workflow.steps[workflow.currentStepIndex];
  if (!step || !["waiting_execution", "waiting_approval"].includes(step.status)) {
    return { waiting: false, failed: false };
  }
  const target = monitorTarget(step.evidence);
  if (!target) {
    workflow.status = step.status;
    return {
      waiting: true,
      failed: false,
      outcome: step.status
    };
  }
  const retry = ensureRetryState(workflow);
  const now = Date.now();
  if (!forceRefresh && retry.exhausted) {
    workflow.status = step.status;
    return { waiting: true, failed: false, outcome: "retry_exhausted" };
  }
  if (!forceRefresh && retry.nextRefreshAt && new Date(retry.nextRefreshAt).getTime() > now) {
    workflow.status = step.status;
    return { waiting: true, failed: false, outcome: "backoff_waiting" };
  }
  if (!forceRefresh && retry.waitingRefreshAttempts >= retry.maxAttempts) {
    retry.exhausted = true;
    retry.lastOutcome = "retry_exhausted";
    workflow.status = step.status;
    workflow.updatedAt = new Date().toISOString();
    return { waiting: true, failed: false, outcome: "retry_exhausted" };
  }
  retry.waitingRefreshAttempts += 1;
  retry.lastRefreshAt = new Date().toISOString();
  retry.exhausted = false;
  let refreshed;
  try {
    refreshed = await refreshExecutionMonitor({
      kind: target.kind,
      id: target.id,
      runWorker: false
    });
  } catch (error) {
    step.evidence.reason = publicReason(error.message);
    workflow.status = step.status;
    scheduleWorkflowRetry(workflow, "observation_failed");
    return { waiting: true, failed: false, outcome: "observation_failed" };
  }
  const monitor = refreshed.monitor || null;
  if (!monitor) {
    workflow.status = step.status;
    scheduleWorkflowRetry(workflow, "monitor_unavailable");
    return { waiting: true, failed: false, outcome: "monitor_unavailable" };
  }
  if (monitor.handle && normalizeHandle(monitor.handle) !== workflow.handle) {
    failStep(workflow, step, "Workflow receipt ownership mismatch.");
    return { waiting: false, failed: true };
  }
  const status = String(monitor.lifecycle || monitor.status || "").toLowerCase();
  step.evidence = {
    ...step.evidence,
    status,
    txHash: validTx(monitor.txHash) || step.evidence.txHash || null,
    explorerUrl: monitor.explorerUrl || step.evidence.explorerUrl || null,
    receiptUrl: monitor.receiptUrl || step.evidence.receiptUrl || null,
    reason: publicReason(monitor.reason) || step.evidence.reason || null
  };
  if (FAILURE_STATES.has(status)) {
    failStep(workflow, step, step.evidence.reason || "The monitored workflow step failed.");
    return { waiting: false, failed: true };
  }
  if (!monitor.terminal && !SUCCESS_STATES.has(status)) {
    workflow.status = step.status;
    scheduleWorkflowRetry(workflow, step.status);
    return { waiting: true, failed: false, outcome: step.status };
  }
  step.status = "completed";
  step.completedAt = new Date().toISOString();
  workflow.currentStepIndex += 1;
  workflow.status = "running";
  resetWorkflowRetry(workflow);
  return { waiting: false, failed: false };
}

function failStep(workflow, step, reason) {
  step.status = "failed";
  step.completedAt = new Date().toISOString();
  step.evidence = {
    ...(step.evidence || {}),
    status: "failed",
    reason: publicReason(reason)
  };
  workflow.status = "failed";
  workflow.compensation = {
    status: "manual_review",
    reason: "bunOS does not automatically reverse prior on-chain steps. Review completed receipts before retrying or compensating."
  };
}

function finishRun(workflow, run) {
  workflow.lastRun = run;
  workflow.updatedAt = new Date().toISOString();
  return workflowResult(workflow);
}

function workflowResult(workflow, message = null) {
  return {
    ok: !["failed"].includes(workflow.status),
    status: workflow.status,
    workflow: publicWorkflow(workflow),
    reason: message || workflow.steps.find((step) => step.status === "failed")?.evidence?.reason || null,
    nextAction: workflowNextAction(workflow)
  };
}

function workflowNextAction(workflow) {
  if (workflow.status === "waiting_approval") return "approve_current_step_then_resume_workflow";
  if (workflow.status === "waiting_execution") return "monitor_receipt_then_resume_workflow";
  if (workflow.status === "paused_budget") return "resume_workflow";
  if (workflow.status === "failed") return "inspect_failed_step";
  if (workflow.status === "completed") return "done";
  if (workflow.status === "cancelled") return "ready_for_next_instruction";
  return "resume_workflow";
}

function executionEvidence(result = {}) {
  const action = result.action || result.receipt?.action || null;
  const payment = result.payment || result.receipt?.payment || null;
  const proposal = result.proposal || null;
  const status = String(
    result.status
    || action?.status
    || payment?.status
    || proposal?.status
    || (result.ok === false ? "failed" : "completed")
  ).toLowerCase();
  return {
    status,
    actionId: action?.id || null,
    paymentId: payment?.id || null,
    proposalId: proposal?.id || null,
    positionId: result.positionId || result.position?.id || proposal?.positionId || null,
    txHash: validTx(result.txHash || action?.txHash || action?.execution?.txHash || payment?.transfer?.txHash),
    explorerUrl: result.explorerUrl || action?.explorerUrl || action?.execution?.explorerUrl || null,
    receiptUrl: result.receiptUrl || result.publicUrl || result.receipt?.publicUrl || null,
    reason: publicReason(result.reason || result.error || action?.failureReason || action?.lastExecutionError)
  };
}

function monitorTarget(evidence = {}) {
  if (evidence.paymentId) return { kind: "payment", id: evidence.paymentId };
  if (evidence.actionId) return { kind: "defi_action", id: evidence.actionId };
  if (evidence.proposalId) return { kind: "perp_proposal", id: evidence.proposalId };
  return null;
}

function normalizeMonitorTarget({ kind, id } = {}) {
  const value = String(id || "").trim();
  if (!value) return null;
  if (kind === "payment") return { kind, id: value };
  if (kind === "defi_action") return { kind, id: value };
  if (kind === "perp_proposal") return { kind, id: value };
  return null;
}

function publicStepResult(result = {}) {
  return {
    ok: result.ok !== false,
    status: executionEvidence(result).status,
    answer: result.answer ? String(result.answer).slice(0, 500) : null
  };
}

function publicWorkflow(workflow) {
  return {
    id: workflow.id,
    handle: workflow.handle,
    goal: workflow.goal,
    source: workflow.source,
    status: workflow.status,
    currentStepIndex: workflow.currentStepIndex,
    steps: workflow.steps.map((step) => ({
      id: step.id,
      index: step.index,
      intent: step.intent,
      status: step.status,
      tool: step.tool,
      result: step.result,
      evidence: step.evidence,
      startedAt: step.startedAt,
      completedAt: step.completedAt
    })),
    limits: workflow.limits,
    runCount: workflow.runCount,
    lastRun: workflow.lastRun,
    retry: workflow.retry || emptyRetryState(),
    compensation: workflow.compensation,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    completedAt: workflow.completedAt
  };
}

function workflowDueAt(workflow) {
  const retry = ensureRetryState(workflow);
  return retry.nextRefreshAt ? new Date(retry.nextRefreshAt).getTime() : 0;
}

function requireOwnedWorkflow(workflowId, handle) {
  const workflow = (ledger.agentWorkflows || []).find((item) => item.id === workflowId);
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`);
  if (workflow.handle !== normalizeHandle(handle)) {
    const error = new Error("Workflow does not belong to the authenticated handle");
    error.code = "WORKFLOW_OWNERSHIP_MISMATCH";
    throw error;
  }
  return workflow;
}

function normalizeHandle(handle) {
  const value = String(handle || "").trim().toLowerCase();
  return value.startsWith("@") ? value : `@${value}`;
}

function validTx(value) {
  const text = String(value || "");
  return /^0x[a-fA-F0-9]{64}$/.test(text) ? text : null;
}

function emptyRetryState() {
  return {
    waitingRefreshAttempts: 0,
    maxAttempts: MAX_WAIT_REFRESH_ATTEMPTS,
    nextRefreshAt: null,
    lastRefreshAt: null,
    lastOutcome: null,
    exhausted: false
  };
}

function ensureRetryState(workflow) {
  workflow.retry ||= emptyRetryState();
  workflow.retry.maxAttempts ||= MAX_WAIT_REFRESH_ATTEMPTS;
  workflow.retry.waitingRefreshAttempts ||= 0;
  workflow.retry.exhausted = Boolean(workflow.retry.exhausted);
  return workflow.retry;
}

function armWorkflowRetry(workflow, { outcome }) {
  const retry = ensureRetryState(workflow);
  retry.waitingRefreshAttempts = 0;
  retry.lastOutcome = outcome || null;
  retry.exhausted = false;
  retry.nextRefreshAt = new Date(Date.now() + WAIT_REFRESH_BASE_MS).toISOString();
}

function scheduleWorkflowRetry(workflow, outcome) {
  const retry = ensureRetryState(workflow);
  const attempts = Math.max(1, Number(retry.waitingRefreshAttempts || 1));
  retry.lastOutcome = outcome || null;
  if (attempts >= retry.maxAttempts) {
    retry.exhausted = true;
    retry.nextRefreshAt = null;
    return retry;
  }
  const delay = Math.min(WAIT_REFRESH_MAX_MS, WAIT_REFRESH_BASE_MS * 2 ** Math.max(0, attempts - 1));
  retry.nextRefreshAt = new Date(Date.now() + delay).toISOString();
  return retry;
}

function resetWorkflowRetry(workflow) {
  workflow.retry = emptyRetryState();
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
