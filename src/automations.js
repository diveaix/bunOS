import { ledger } from "./fixtures.js";
import { nextAutomationId, nextEventId } from "./ids.js";
import { normalizeHandle } from "./identity.js";
import { enqueueJob, runJob } from "./jobs.js";
import { runAgentAction } from "./agentPlanner.js";
import { syncWalletBalances } from "./walletAccounts.js";
import { runStrategyCheck } from "./strategyAgent.js";
import { truthFromAgentPayload } from "./executionTruth.js";

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
    intervalMs: parsed.intervalMs,
    maxRuns: parsed.maxRuns,
    payload: parsed.payload,
    nextRunAt: input.nextRunAt || new Date(Date.now() + parsed.intervalMs).toISOString(),
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
  repairAutomationPayloads({ handle });
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

export function pauseAutomations({ handle, kind, status = "active", limit = 100000 } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const now = new Date().toISOString();
  const matches = (ledger.automations || [])
    .filter((automation) => (
      (!normalized || automation.handle === normalized)
      && (!kind || automation.kind === kind)
      && (!status || automation.status === status)
    ))
    .slice(0, Number(limit) || 100000);

  for (const automation of matches) {
    automation.status = "paused";
    automation.updatedAt = now;
    recordAutomationEvent("automation_bulk_paused", automation);
  }

  return {
    ok: true,
    paused: matches.length,
    status: "paused",
    at: now
  };
}

export function deleteAutomation({ automationId } = {}) {
  const index = (ledger.automations || []).findIndex((automation) => automation.id === automationId);
  if (index < 0) throw new Error("Automation not found");
  const [automation] = ledger.automations.splice(index, 1);
  recordAutomationEvent("automation_deleted", automation);
  return { ok: true, automation };
}

export async function runAutomation({ automationId } = {}) {
  repairAutomationPayloads();
  const automation = findAutomation(automationId);
  return await executeAutomation(automation);
}

export async function runDueAutomations({ limit = 20 } = {}) {
  repairAutomationPayloads();
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

export function repairAutomationPayloads({ handle, includePaused = true } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const now = new Date().toISOString();
  const report = { ok: true, repaired: 0, paused: 0 };
  for (const automation of ledger.automations || []) {
    if (normalized && automation.handle !== normalized) continue;
    if (!includePaused && automation.status === "paused") continue;
    if (automation.kind !== "run_agent_action") continue;

    const before = String(automation.payload?.text || "");
    if (looksLikeAutomationCreation(before) && /^\s*(?:create|make|start|schedule|automate)\b/i.test(before)) {
      if (automation.status !== "paused") {
        automation.status = "paused";
        automation.nextRunAt = null;
        automation.lastError = "Automation payload still looked like it would create another automation.";
        automation.updatedAt = now;
        report.paused += 1;
        recordAutomationEvent("automation_recursive_payload_paused", automation);
      }
      continue;
    }

    const cleaned = stripScheduleText(before);
    if (cleaned && cleaned !== before) {
      automation.payload = {
        ...(automation.payload || {}),
        text: cleaned
      };
      if (!automation.name || /run agent:|automation/i.test(automation.name)) {
        automation.name = `Run agent: ${cleaned.slice(0, 48)}`;
      }
      automation.updatedAt = now;
      report.repaired += 1;
      recordAutomationEvent("automation_payload_repaired", automation, {
        oldText: before.slice(0, 240),
        newText: cleaned.slice(0, 240)
      });
    }

    if (looksLikeAutomationCreation(cleaned || before) && automation.status !== "paused") {
      automation.status = "paused";
      automation.nextRunAt = null;
      automation.lastError = "Automation payload still looked like it would create another automation.";
      automation.updatedAt = now;
      report.paused += 1;
      recordAutomationEvent("automation_recursive_payload_paused", automation);
    }
  }
  return report;
}

function normalizeAutomationInput(input) {
  const interval = normalizeInterval(input);
  const maxRuns = normalizeMaxRuns(input.maxRuns || input.runLimit || parseMaxRuns(input.text || input.prompt || ""));
  const kind = input.kind || inferKind(input);
  if (!SUPPORTED_KINDS.has(kind)) {
    throw new Error(`Unsupported automation kind: ${kind || "unknown"}`);
  }

  if (kind === "sync_circle_balances") {
    return {
      kind,
      ...interval,
      maxRuns,
      name: input.name || `Sync balances for ${input.handle}`,
      payload: { handle: input.handle }
    };
  }

  if (kind === "reconcile_defi_action") {
    const actionId = input.actionId || input.payload?.actionId;
    if (!actionId) throw new Error("reconcile_defi_action automation requires actionId");
    return {
      kind,
      ...interval,
      maxRuns,
      name: input.name || `Watch ${actionId}`,
      payload: { actionId }
    };
  }

  if (kind === "run_strategy_check") {
    return {
      kind,
      ...interval,
      maxRuns,
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
  const cleanedPrompt = stripScheduleText(prompt);
  return {
    kind,
    ...interval,
    maxRuns,
    name: input.name || `Run agent: ${String(cleanedPrompt || prompt).slice(0, 48)}`,
    payload: {
      handle: input.handle,
      text: cleanedPrompt,
      defaultSettlementRail: input.defaultSettlementRail || input.payload?.defaultSettlementRail || "arc-testnet",
      fast: input.fast !== false,
      useModel: input.useModel === true || input.payload?.useModel === true
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

function normalizeInterval(input) {
  const parsed = parseInterval(input.text || input.prompt || "");
  const intervalMs = Number(input.intervalMs || input.everyMs || 0)
    || secondsToMs(input.intervalSeconds || input.everySeconds)
    || minutesToMs(input.intervalMinutes || input.everyMinutes)
    || parsed.intervalMs;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("Automation interval must be greater than zero");
  const normalizedMs = Math.max(5_000, Math.round(intervalMs));
  return {
    intervalMs: normalizedMs,
    intervalMinutes: Math.round((normalizedMs / 60_000) * 1000) / 1000
  };
}

function parseInterval(text) {
  const raw = String(text || "").toLowerCase();
  const match = raw.match(/\bevery\s+(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|sixty)\s*(second|seconds|sec|secs|s|minute|minutes|min|mins|m|hour|hours|hr|hrs|h|day|days|d)\b/);
  if (!match) return { intervalMs: 60 * 60_000, intervalMinutes: 60 };
  const amount = parseNumberWord(match[1]);
  const unit = match[2];
  if (unit === "d" || unit.startsWith("day")) return { intervalMs: amount * 24 * 60 * 60_000, intervalMinutes: amount * 24 * 60 };
  if (unit === "h" || unit.startsWith("hour") || unit.startsWith("hr")) return { intervalMs: amount * 60 * 60_000, intervalMinutes: amount * 60 };
  if (unit === "m" || unit.startsWith("minute") || unit.startsWith("min")) return { intervalMs: amount * 60_000, intervalMinutes: amount };
  return { intervalMs: amount * 1000, intervalMinutes: amount / 60 };
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

function minutesToMs(value) {
  const minutes = Number(value || 0);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0;
}

function secondsToMs(value) {
  const seconds = Number(value || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function normalizeMaxRuns(value) {
  const runs = Number(value || 0);
  return Number.isFinite(runs) && runs > 0 ? Math.max(1, Math.floor(runs)) : null;
}

function parseMaxRuns(text) {
  const match = String(text || "").match(/\b(?:for|until|stop\s+after)\s+(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|sixty)\s*(?:times?|runs?|executions?)\b/i);
  return match ? parseNumberWord(match[1]) : null;
}

function stripScheduleText(text) {
  const numberWord = "(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|sixty)";
  return String(text || "")
    .replace(/^\s*(?:run|create|make|start|schedule|automate)\s+(?:an?\s+)?(?:automation|scheduled task|recurring task)\s*[:.-]?\s*/ig, "")
    .replace(/^\s*(?:an?\s+)?(?:automation|scheduled task|recurring task)\s*[:.-]?\s*/ig, "")
    .replace(/^\s*run\s+agent\s*:\s*/ig, "")
    .replace(/^\s*(?:an?\s+)?(?:automation|scheduled task|recurring task)\s*[:.-]?\s*/ig, "")
    .replace(new RegExp(`\\bevery\\s+${numberWord}\\s*(?:second|seconds|sec|secs|s|minute|minutes|min|mins|m|hour|hours|hr|hrs|h|day|days|d)\\b`, "ig"), "")
    .replace(new RegExp(`\\b(?:for|until|stop\\s+after)\\s+${numberWord}\\s*(?:times?|runs?|executions?)\\b`, "ig"), "")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*[,.;:-]\s*/, "")
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
    if (automation.maxRuns && automation.runCount >= automation.maxRuns) {
      automation.status = "completed";
      automation.nextRunAt = null;
    } else {
      automation.nextRunAt = nextRunAt(automation);
    }
    automation.updatedAt = new Date().toISOString();
    recordAutomationEvent("automation_succeeded", automation);
    return { ok: true, automation, result };
  } catch (error) {
    automation.failureCount = Number(automation.failureCount || 0) + 1;
    automation.lastError = error.message;
    if (error.pauseAutomation) {
      automation.status = "paused";
      automation.nextRunAt = null;
    } else if (automation.maxRuns && automation.runCount >= automation.maxRuns) {
      automation.status = "completed";
      automation.nextRunAt = null;
    } else {
      automation.nextRunAt = nextRunAt(automation);
    }
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
    const text = automation.payload.text;
    if (looksLikeAutomationCreation(text)) {
      throw recursiveAutomationError("This automation tried to create another automation. I paused it to prevent a runaway loop.");
    }
    const result = await runAgentAction({
      handle: automation.payload.handle || automation.handle,
      text,
      defaultSettlementRail: automation.payload.defaultSettlementRail || "arc-testnet",
      source: "automation",
      fast: automation.payload.fast !== false,
      useModel: automation.payload.useModel === true,
      idempotencyKey: `automation:${automation.id}:${automation.runCount}`
    });
    if (result?.planned?.plan?.tool === "create_automation") {
      throw recursiveAutomationError("This automation resolved to create another automation. I paused it to prevent a runaway loop.");
    }
    return result;
  }
  throw new Error(`Unsupported automation kind: ${automation.kind}`);
}

function looksLikeAutomationCreation(text) {
  return /\b(?:create|make|start|run|schedule|automate)\b[\s\S]{0,40}\b(?:automation|automations|schedule|scheduled task|recurring task)\b/i.test(String(text || ""));
}

function recursiveAutomationError(message) {
  const error = new Error(message);
  error.pauseAutomation = true;
  return error;
}

function summarizeResult(result) {
  const truth = truthFromAgentPayload(result || {});
  return {
    ok: result?.ok !== false,
    status: result?.status || result?.action?.status || result?.payment?.status || result?.job?.status || null,
    txHash: result?.txHash || result?.execution?.txHash || result?.action?.txHash || result?.payment?.transfer?.txHash || null,
    explorerUrl: result?.explorerUrl || result?.execution?.explorerUrl || result?.action?.explorerUrl || result?.payment?.transfer?.explorerUrl || null,
    receiptUrl: result?.receiptUrl || result?.execution?.receiptUrl || result?.receipt?.publicUrl || null,
    truth,
    nextAction: result?.nextAction || null,
    at: new Date().toISOString()
  };
}

function nextRunAt(automation) {
  return new Date(Date.now() + Number(automation.intervalMs || Number(automation.intervalMinutes || 60) * 60_000)).toISOString();
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
