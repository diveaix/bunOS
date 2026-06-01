import { ledger } from "./fixtures.js";
import { nextAutomationId, nextEventId } from "./ids.js";
import { normalizeHandle } from "./identity.js";
import { enqueueJob, runJob } from "./jobs.js";
import { runAgentAction } from "./agentPlanner.js";
import { syncWalletBalances } from "./walletAccounts.js";
import { runStrategyCheck } from "./strategyAgent.js";

const SUPPORTED_KINDS = new Set([
  "sync_circle_balances",
  "run_agent_action",
  "reconcile_defi_action",
  "run_strategy_check"
]);

export function createAutomation(input = {}) {
  const handle = normalizeHandle(input.handle || "@sara");
  const parsed = normalizeAutomationInput({ ...input, handle });
  const now = new Date().toISOString();
  const automation = {
    id: nextAutomationId(),
    handle,
    name: parsed.name,
    kind: parsed.kind,
    status: input.status === "paused" ? "paused" : "active",
    intervalMinutes: parsed.intervalMinutes,
    payload: parsed.payload,
    nextRunAt: input.nextRunAt || new Date(Date.now() + parsed.intervalMinutes * 60_000).toISOString(),
    runCount: 0,
    failureCount: 0,
    lastRunAt: null,
    lastResult: null,
    lastError: null,
    createdAt: now,
    updatedAt: now
  };
  ledger.automations.push(automation);
  recordAutomationEvent("automation_created", automation);
  return { ok: true, automation };
}

export function listAutomations({ handle, status, kind, limit = 50 } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const automations = (ledger.automations || [])
    .filter((automation) => (
      (!normalized || automation.handle === normalized)
      && (!status || automation.status === status)
      && (!kind || automation.kind === kind)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 50);
  return { ok: true, automations };
}

export function updateAutomation({ automationId, status, nextRunAt } = {}) {
  const automation = findAutomation(automationId);
  if (status) {
    if (!["active", "paused"].includes(status)) {
      throw new Error("Automation status must be active or paused");
    }
    automation.status = status;
  }
  if (nextRunAt) automation.nextRunAt = new Date(nextRunAt).toISOString();
  automation.updatedAt = new Date().toISOString();
  recordAutomationEvent("automation_updated", automation);
  return { ok: true, automation };
}

export function deleteAutomation({ automationId } = {}) {
  const index = (ledger.automations || []).findIndex((automation) => automation.id === automationId);
  if (index < 0) throw new Error("Automation not found");
  const [automation] = ledger.automations.splice(index, 1);
  recordAutomationEvent("automation_deleted", automation);
  return { ok: true, automation };
}

export async function runAutomation({ automationId } = {}) {
  const automation = findAutomation(automationId);
  return await executeAutomation(automation);
}

export async function runDueAutomations({ limit = 20 } = {}) {
  const now = Date.now();
  const due = (ledger.automations || [])
    .filter((automation) => (
      automation.status === "active"
      && automation.nextRunAt
      && new Date(automation.nextRunAt).getTime() <= now
    ))
    .slice(0, Number(limit) || 20);
  const results = [];
  for (const automation of due) {
    results.push(await executeAutomation(automation));
  }
  return { ok: true, ran: results };
}

function normalizeAutomationInput(input) {
  const intervalMinutes = normalizeIntervalMinutes(input.intervalMinutes || input.everyMinutes || parseIntervalMinutes(input.text || input.prompt || ""));
  const kind = input.kind || inferKind(input);
  if (!SUPPORTED_KINDS.has(kind)) {
    throw new Error(`Unsupported automation kind: ${kind || "unknown"}`);
  }

  if (kind === "sync_circle_balances") {
    return {
      kind,
      intervalMinutes,
      name: input.name || `Sync balances for ${input.handle}`,
      payload: { handle: input.handle }
    };
  }

  if (kind === "reconcile_defi_action") {
    const actionId = input.actionId || input.payload?.actionId;
    if (!actionId) throw new Error("reconcile_defi_action automation requires actionId");
    return {
      kind,
      intervalMinutes,
      name: input.name || `Watch ${actionId}`,
      payload: { actionId }
    };
  }

  if (kind === "run_strategy_check") {
    return {
      kind,
      intervalMinutes,
      name: input.name || `Check strategy for ${input.handle}`,
      payload: {
        handle: input.handle,
        strategyId: input.strategyId || input.payload?.strategyId,
        settlementRail: input.settlementRail || input.payload?.settlementRail || "arc-testnet"
      }
    };
  }

  const prompt = input.prompt || input.text || input.payload?.text;
  if (!prompt) throw new Error("run_agent_action automation requires prompt or text");
  return {
    kind,
    intervalMinutes,
    name: input.name || `Run agent: ${String(prompt).slice(0, 48)}`,
    payload: {
      handle: input.handle,
      text: stripScheduleText(prompt),
      defaultSettlementRail: input.defaultSettlementRail || input.payload?.defaultSettlementRail || "arc-testnet",
      fast: input.fast !== false
    }
  };
}

function inferKind(input) {
  const text = String(input.text || input.prompt || "").toLowerCase();
  if (input.actionId || input.payload?.actionId || /\b(reconcile|watch)\b.*\b(defi|bridge|swap|action)\b/.test(text)) return "reconcile_defi_action";
  if (input.strategyId || input.payload?.strategyId || /\b(strategy|rebalance|allocation)\b/.test(text)) return "run_strategy_check";
  if (/\b(sync|refresh)\b.*\bbalances?\b|\bbalances?\b.*\b(sync|refresh)\b/.test(text)) return "sync_circle_balances";
  return "run_agent_action";
}

function normalizeIntervalMinutes(value) {
  const minutes = Number(value || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("Automation intervalMinutes must be greater than zero");
  return Math.max(1, Math.round(minutes));
}

function parseIntervalMinutes(text) {
  const raw = String(text || "").toLowerCase();
  const match = raw.match(/\bevery\s+(\d+(?:\.\d+)?)\s*(minute|minutes|min|hour|hours|hr|hrs|day|days)\b/);
  if (!match) return 60;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith("day")) return amount * 24 * 60;
  if (unit.startsWith("hour") || unit.startsWith("hr")) return amount * 60;
  return amount;
}

function stripScheduleText(text) {
  return String(text || "")
    .replace(/\b(auto(?:mate)?|schedule|repeat|run)\b/ig, "")
    .replace(/\bevery\s+\d+(?:\.\d+)?\s*(?:minute|minutes|min|hour|hours|hr|hrs|day|days)\b/ig, "")
    .trim();
}

async function executeAutomation(automation) {
  const startedAt = new Date().toISOString();
  automation.lastRunAt = startedAt;
  automation.runCount = Number(automation.runCount || 0) + 1;
  automation.updatedAt = startedAt;
  recordAutomationEvent("automation_started", automation);
  try {
    const result = await executeAutomationPayload(automation);
    automation.lastResult = summarizeResult(result);
    automation.lastError = null;
    automation.nextRunAt = nextRunAt(automation.intervalMinutes);
    automation.updatedAt = new Date().toISOString();
    recordAutomationEvent("automation_succeeded", automation);
    return { ok: true, automation, result };
  } catch (error) {
    automation.failureCount = Number(automation.failureCount || 0) + 1;
    automation.lastError = error.message;
    automation.nextRunAt = nextRunAt(automation.intervalMinutes);
    automation.updatedAt = new Date().toISOString();
    recordAutomationEvent("automation_failed", automation, { error: error.message });
    return { ok: false, automation, error: error.message };
  }
}

async function executeAutomationPayload(automation) {
  if (automation.kind === "sync_circle_balances") {
    return await syncWalletBalances({ handle: automation.payload.handle || automation.handle });
  }
  if (automation.kind === "reconcile_defi_action") {
    const actionId = automation.payload.actionId;
    const job = enqueueJob({
      type: "reconcile_defi_action",
      payload: { actionId },
      idempotencyKey: `automation:${automation.id}:reconcile:${actionId}:${Date.now()}`
    });
    return await runJob({ jobId: job.id });
  }
  if (automation.kind === "run_strategy_check") {
    return runStrategyCheck({
      handle: automation.payload.handle || automation.handle,
      strategyId: automation.payload.strategyId,
      settlementRail: automation.payload.settlementRail || "arc-testnet"
    });
  }
  if (automation.kind === "run_agent_action") {
    return await runAgentAction({
      handle: automation.payload.handle || automation.handle,
      text: automation.payload.text,
      defaultSettlementRail: automation.payload.defaultSettlementRail || "arc-testnet",
      source: "automation",
      fast: automation.payload.fast !== false,
      idempotencyKey: `automation:${automation.id}:${automation.runCount}`
    });
  }
  throw new Error(`Unsupported automation kind: ${automation.kind}`);
}

function summarizeResult(result) {
  return {
    ok: result?.ok !== false,
    status: result?.status || result?.action?.status || result?.payment?.status || result?.job?.status || null,
    nextAction: result?.nextAction || null,
    at: new Date().toISOString()
  };
}

function nextRunAt(intervalMinutes) {
  return new Date(Date.now() + Number(intervalMinutes || 60) * 60_000).toISOString();
}

function findAutomation(automationId) {
  const automation = (ledger.automations || []).find((item) => item.id === automationId);
  if (!automation) throw new Error("Automation not found");
  return automation;
}

function recordAutomationEvent(type, automation, extra = {}) {
  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type,
    automationId: automation.id,
    handle: automation.handle,
    automationKind: automation.kind,
    status: automation.status,
    ...extra
  });
}
