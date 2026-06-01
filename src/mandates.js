import { ledger, users } from "./fixtures.js";
import { normalizeHandle, resolveXHandle } from "./identity.js";
import { nextEventId } from "./ids.js";
import { readOnlySigner } from "./signerPolicy.js";

const STABLE_GROUP = new Set(["STABLE", "STABLES"]);
const VOLATILE_GROUP = new Set(["BTC", "CIRBTC", "ETH", "WETH", "SOL"]);

export function createMandate({ handle = "@sara", text, kind, rules = {}, status = "active", source = "agent" } = {}) {
  const user = resolveXHandle(handle);
  const parsed = text ? parseMandateText(text) : normalizeMandate({ kind, rules, sourceText: text || kind });
  if (!parsed) {
    return {
      ok: false,
      status: "clarification_required",
      reason: "I could not turn that into a standing trading rule. Try: max trade $10, never buy WETH, max leverage 2x, or never bridge if fee is over 3%.",
      nextAction: "provide_mandate_rule",
      signer: readOnlySigner({ operation: "create_mandate" })
    };
  }

  const memory = getMandateMemory(user.handle);
  const mandate = {
    id: nextMandateId(user.handle),
    handle: user.handle,
    kind: parsed.kind,
    status,
    source,
    sourceText: text || parsed.sourceText || parsed.kind,
    rules: {
      ...parsed.rules,
      ...rules
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: []
  };
  mandate.conflicts = detectMandateConflicts({
    handle: user.handle,
    candidate: mandate
  });
  mandate.history.push({
    at: mandate.createdAt,
    type: "created",
    rules: mandate.rules,
    conflicts: mandate.conflicts
  });
  memory.mandates.unshift(mandate);
  recordMandateEvent("mandate_created", mandate);

  return {
    ok: true,
    status: mandate.conflicts.length ? "saved_with_conflicts" : "saved",
    mandate,
    conflicts: mandate.conflicts,
    receipt: mandateReceipt(mandate, "created"),
    signer: readOnlySigner({ operation: "create_mandate" }),
    reason: mandate.conflicts.length
      ? `Mandate saved, but I found ${mandate.conflicts.length} conflict(s) to review.`
      : "Mandate saved and will be enforced on future agent trades.",
    nextAction: mandate.conflicts.length ? "review_mandate_conflicts" : "enforce_on_next_trade"
  };
}

export function updateMandate({ handle = "@sara", mandateId, text, rules = {}, status } = {}) {
  const mandate = findMandate(handle, mandateId);
  if (!mandate) throw new Error("Mandate not found");
  const parsed = text ? parseMandateText(text) : null;
  const previous = {
    kind: mandate.kind,
    rules: mandate.rules,
    status: mandate.status
  };
  if (parsed) {
    mandate.kind = parsed.kind;
    mandate.sourceText = text;
    mandate.rules = parsed.rules;
  }
  mandate.rules = {
    ...mandate.rules,
    ...rules
  };
  if (status) mandate.status = status;
  mandate.updatedAt = new Date().toISOString();
  mandate.conflicts = detectMandateConflicts({
    handle: mandate.handle,
    candidate: mandate,
    ignoreId: mandate.id
  });
  mandate.history ||= [];
  mandate.history.push({
    at: mandate.updatedAt,
    type: "updated",
    previous,
    rules: mandate.rules,
    status: mandate.status,
    conflicts: mandate.conflicts
  });
  recordMandateEvent("mandate_updated", mandate);

  return {
    ok: true,
    status: mandate.conflicts.length ? "updated_with_conflicts" : "updated",
    mandate,
    conflicts: mandate.conflicts,
    receipt: mandateReceipt(mandate, "updated"),
    signer: readOnlySigner({ operation: "update_mandate" }),
    reason: mandate.conflicts.length
      ? `Mandate updated, but ${mandate.conflicts.length} conflict(s) remain.`
      : "Mandate updated.",
    nextAction: mandate.conflicts.length ? "review_mandate_conflicts" : "enforce_on_next_trade"
  };
}

export function deleteMandate({ handle = "@sara", mandateId } = {}) {
  const mandate = findMandate(handle, mandateId);
  if (!mandate) throw new Error("Mandate not found");
  mandate.status = "deleted";
  mandate.updatedAt = new Date().toISOString();
  mandate.history ||= [];
  mandate.history.push({
    at: mandate.updatedAt,
    type: "deleted"
  });
  recordMandateEvent("mandate_deleted", mandate);
  return {
    ok: true,
    status: "deleted",
    mandate,
    receipt: mandateReceipt(mandate, "deleted"),
    signer: readOnlySigner({ operation: "delete_mandate" }),
    reason: "Mandate deleted. It will no longer be enforced.",
    nextAction: "none"
  };
}

export function listMandates({ handle = "@sara", status = "active", limit = 50 } = {}) {
  const user = resolveXHandle(handle);
  const mandates = getMandateMemory(user.handle).mandates
    .filter((mandate) => !status || mandate.status === status)
    .slice(0, Number(limit) || 50);
  return {
    ok: true,
    status: "listed",
    handle: user.handle,
    mandates,
    activeCount: getActiveMandates(user.handle).length,
    signer: readOnlySigner({ operation: "list_mandates" }),
    nextAction: mandates.length ? "review_mandates" : "create_mandate"
  };
}

export function evaluateMandatesForAction({ handle = "@sara", action = {}, simulation = null, quote = null, risk = null, type } = {}) {
  const user = resolveXHandle(handle);
  const active = getActiveMandates(user.handle);
  const context = normalizeActionContext({ action, simulation, quote, risk, type });
  const violations = [];
  const warnings = [];
  const appliedMandates = [];

  for (const mandate of active) {
    const result = evaluateMandate(mandate, context);
    if (!result.applies) continue;
    appliedMandates.push({
      id: mandate.id,
      kind: mandate.kind,
      sourceText: mandate.sourceText
    });
    if (result.violation) {
      violations.push({
        mandateId: mandate.id,
        kind: mandate.kind,
        reason: result.reason,
        sourceText: mandate.sourceText
      });
    } else if (result.warning) {
      warnings.push(result.reason);
    }
  }

  const approved = violations.length === 0;
  const check = {
    approved,
    status: approved ? "approved" : "rejected",
    reason: approved
      ? (appliedMandates.length ? "Standing mandates checked and passed." : "No active standing mandates apply.")
      : `Standing mandate blocked this action: ${violations[0].reason}`,
    violations,
    warnings,
    appliedMandates,
    checkedAt: new Date().toISOString(),
    context
  };
  recordMandateEvaluation(user.handle, check);
  return check;
}

export function parseMandateText(text) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();
  if (!raw) return null;

  const target = parseTargetMandate(raw);
  if (target) return target;

  const fee = raw.match(/\b(?:never|do not|don't)\s+(bridge|swap|trade)?[^.]*\bfee\s+(?:is\s+)?(?:over|above|greater than|more than)\s+(\d+(?:\.\d+)?)\s*%/i);
  if (fee) {
    return normalizeMandate({
      kind: "max_fee_ratio",
      sourceText: raw,
      rules: {
        actionType: fee[1]?.toLowerCase() || "trade",
        maxFeeRatio: Number(fee[2]) / 100
      }
    });
  }

  const maxTrade = raw.match(/\b(?:max(?:imum)?|limit)\s+(?:per\s*)?(?:trade|swap|bridge|action)\s+(?:size\s+)?(?:to\s+)?\$?(\d+(?:\.\d+)?)/i)
    || raw.match(/\b(?:do not|don't|never)\s+(?:trade|swap|bridge)\s+(?:more than|over|above)\s+\$?(\d+(?:\.\d+)?)/i);
  if (maxTrade) {
    return normalizeMandate({
      kind: "max_trade_size",
      sourceText: raw,
      rules: { maxTradeUsd: Number(maxTrade[1]) }
    });
  }

  const dailySpend = raw.match(/\b(?:max(?:imum)?|limit)\s+(?:daily|per day)\s+(?:spend|trade|volume)\s+(?:to\s+)?\$?(\d+(?:\.\d+)?)/i);
  if (dailySpend) {
    return normalizeMandate({
      kind: "max_daily_spend",
      sourceText: raw,
      rules: { maxDailySpendUsd: Number(dailySpend[1]) }
    });
  }

  const maxLev = raw.match(/\b(?:max(?:imum)?|limit)\s+leverage\s+(?:to\s+)?(\d+(?:\.\d+)?)x?\b/i)
    || raw.match(/\b(?:never|do not|don't)\s+(?:use\s+)?(?:more than|over|above)\s+(\d+(?:\.\d+)?)x\s+leverage/i);
  if (maxLev) {
    return normalizeMandate({
      kind: "max_leverage",
      sourceText: raw,
      rules: { maxLeverage: Number(maxLev[1]) }
    });
  }

  const slippage = raw.match(/\b(?:max(?:imum)?|limit)\s+slippage\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*%/i)
    || raw.match(/\b(?:never|do not|don't)\s+(?:swap|trade)[^.]*slippage\s+(?:over|above|greater than|more than)\s+(\d+(?:\.\d+)?)\s*%/i);
  if (slippage) {
    return normalizeMandate({
      kind: "max_slippage",
      sourceText: raw,
      rules: { maxSlippage: Number(slippage[1]) / 100 }
    });
  }

  const forbidden = raw.match(/\b(?:never|do not|don't|forbid|block)\s+(?:buy|sell|trade|swap|bridge)?\s*(?:token|asset)?s?\s*((?:0x[a-fA-F0-9]{40}|[a-zA-Z][a-zA-Z0-9]{1,20})(?:[,\s]+(?:0x[a-fA-F0-9]{40}|[a-zA-Z][a-zA-Z0-9]{1,20}))*)/i);
  if (forbidden && /\b(never|forbid|block|do not|don't)\b/.test(lower) && !/\bfee|leverage|slippage|bridge if\b/.test(lower)) {
    const assets = extractAssets(forbidden[1]);
    if (assets.length) {
      return normalizeMandate({
        kind: "forbidden_assets",
        sourceText: raw,
        rules: { forbiddenAssets: assets }
      });
    }
  }

  const allowed = raw.match(/\b(?:only|allow|allowed)\s+(?:trade|swap|bridge|use)?\s*(?:assets?|tokens?)?\s*((?:0x[a-fA-F0-9]{40}|[a-zA-Z][a-zA-Z0-9]{1,20})(?:[,\s]+(?:0x[a-fA-F0-9]{40}|[a-zA-Z][a-zA-Z0-9]{1,20}))*)/i);
  if (allowed && /\b(only|allow|allowed)\b/.test(lower)) {
    const assets = extractAssets(allowed[1]).filter((asset) => !["TRADE", "SWAP", "BRIDGE", "USE", "TOKENS", "ASSETS"].includes(tokenKey(asset)));
    if (assets.length) {
      return normalizeMandate({
        kind: "allowed_assets",
        sourceText: raw,
        rules: { allowedAssets: assets }
      });
    }
  }

  const rebalance = raw.match(/\brebalance\s+(?:if|when)?[^.]*?(?:drift|threshold)\s+(?:is\s+)?(?:over|above|greater than|more than)?\s*(\d+(?:\.\d+)?)\s*%/i);
  if (rebalance) {
    return normalizeMandate({
      kind: "rebalance_threshold",
      sourceText: raw,
      rules: { rebalanceThreshold: Number(rebalance[1]) / 100 }
    });
  }

  const dca = raw.match(/\bdca\s+\$?(\d+(?:\.\d+)?)\s+(?:into|to|in)\s+([a-zA-Z][a-zA-Z0-9]{1,20})(?:\s+(daily|weekly|monthly))?/i);
  if (dca) {
    return normalizeMandate({
      kind: "dca",
      sourceText: raw,
      rules: {
        amountUsd: Number(dca[1]),
        toToken: normalizeToken(dca[2]),
        interval: dca[3]?.toLowerCase() || "daily",
        pauseWhen: /unless\s+volatility\s+is\s+high|unless\s+high\s+volatility/i.test(raw) ? ["high_volatility"] : []
      }
    });
  }

  const liq = raw.match(/\bclose\s+perps?\s+if\s+(?:liquidation\s+)?buffer\s+drops\s+below\s+(\d+(?:\.\d+)?)\s*%/i);
  if (liq) {
    return normalizeMandate({
      kind: "liquidation_buffer",
      sourceText: raw,
      rules: {
        minLiquidationBufferPct: Number(liq[1]),
        action: "close_perps"
      }
    });
  }

  const stopLoss = raw.match(/\bstop[-\s]?loss\s+(?:at|below)?\s*(\d+(?:\.\d+)?)\s*%/i);
  const takeProfit = raw.match(/\btake[-\s]?profit\s+(?:at|above)?\s*(\d+(?:\.\d+)?)\s*%/i);
  if (stopLoss || takeProfit) {
    return normalizeMandate({
      kind: "stop_loss_take_profit",
      sourceText: raw,
      rules: {
        stopLossPct: stopLoss ? Number(stopLoss[1]) / 100 : undefined,
        takeProfitPct: takeProfit ? Number(takeProfit[1]) / 100 : undefined
      }
    });
  }

  return null;
}

function parseTargetMandate(raw) {
  const lower = raw.toLowerCase();
  if (!/\b(keep me|target|allocate|allocation|portfolio)\b/.test(lower)) return null;
  const entries = Array.from(raw.matchAll(/(\d+(?:\.\d+)?)\s*%\s*(stables?|stablecoins?|0x[a-fA-F0-9]{40}|[a-zA-Z][a-zA-Z0-9]{1,20})/gi));
  if (!entries.length) return null;
  const targetAllocations = {};
  for (const entry of entries) {
    const token = normalizeAllocationToken(entry[2]);
    targetAllocations[token] = Number(entry[1]) / 100;
  }
  return normalizeMandate({
    kind: "target_allocation",
    sourceText: raw,
    rules: { targetAllocations }
  });
}

function normalizeMandate({ kind, rules = {}, sourceText } = {}) {
  if (!kind) return null;
  return {
    kind,
    sourceText,
    rules: stripUndefined(rules)
  };
}

function evaluateMandate(mandate, context) {
  const rules = mandate.rules || {};
  const tokens = [context.fromToken, context.toToken, context.symbol].filter(Boolean);
  const appliesToAction = !rules.actionType
    || rules.actionType === "trade"
    || rules.actionType === context.type
    || (rules.actionType === "perp" && context.type === "perp");

  if (mandate.kind === "max_trade_size" && context.amountUsd > Number(rules.maxTradeUsd || 0)) {
    return violation(appliesToAction, `mandate ${mandate.id} caps per-trade size at US$${rules.maxTradeUsd}, but this action is US$${context.amountUsd}.`);
  }
  if (mandate.kind === "max_daily_spend") {
    const spent = dailySpendUsd(mandate.handle);
    const max = Number(rules.maxDailySpendUsd || 0);
    if (max > 0 && spent + context.amountUsd > max) {
      return violation(appliesToAction, `mandate ${mandate.id} caps daily spend at US$${max}; today is already about US$${spent}, and this action would reach US$${round(spent + context.amountUsd)}.`);
    }
    return pass(appliesToAction);
  }
  if (mandate.kind === "max_leverage" && Number(context.leverage || 0) > Number(rules.maxLeverage || 0)) {
    return violation(context.type === "perp", `mandate ${mandate.id} caps leverage at ${rules.maxLeverage}x, but this request is ${context.leverage}x.`);
  }
  if (mandate.kind === "allowed_assets") {
    const disallowed = tokens.find((token) => !assetMatchesList(token, rules.allowedAssets || []));
    if (disallowed) {
      return violation(appliesToAction, `mandate ${mandate.id} only allows ${rules.allowedAssets.join(", ")}; ${disallowed} is outside that list.`);
    }
    return pass(appliesToAction && tokens.length > 0);
  }
  if (mandate.kind === "forbidden_assets") {
    const blocked = tokens.find((token) => assetMatchesList(token, rules.forbiddenAssets || []));
    if (blocked) {
      return violation(appliesToAction, `mandate ${mandate.id} forbids ${blocked}.`);
    }
    return pass(appliesToAction && tokens.length > 0);
  }
  if (mandate.kind === "max_fee_ratio" && Number(context.feeRatio || 0) > Number(rules.maxFeeRatio || 0)) {
    return violation(appliesToAction, `mandate ${mandate.id} caps ${rules.actionType || "trade"} fees at ${(rules.maxFeeRatio * 100).toFixed(2)}%, but this route is about ${(context.feeRatio * 100).toFixed(2)}%.`);
  }
  if (mandate.kind === "max_slippage" && Number(context.slippage || 0) > Number(rules.maxSlippage || 0)) {
    return violation(appliesToAction, `mandate ${mandate.id} caps slippage at ${(rules.maxSlippage * 100).toFixed(2)}%, but this request uses ${(context.slippage * 100).toFixed(2)}%.`);
  }
  if (mandate.kind === "liquidation_buffer" && context.type === "perp") {
    const buffer = Number(context.liquidationBufferPct || 0);
    if (buffer > 0 && buffer < Number(rules.minLiquidationBufferPct || 0)) {
      return violation(true, `mandate ${mandate.id} requires at least ${rules.minLiquidationBufferPct}% liquidation buffer; this proposal is ${buffer}%.`);
    }
    return pass(true);
  }
  if (["target_allocation", "rebalance_threshold", "dca", "stop_loss_take_profit"].includes(mandate.kind)) {
    return {
      applies: false,
      warning: true,
      reason: `mandate ${mandate.id} is a standing strategy rule and does not block this action directly.`
    };
  }
  return pass(false);
}

function normalizeActionContext({ action = {}, simulation = null, quote = null, risk = null, type } = {}) {
  const amountUsd = Number(action.amountUsd || action.amount || action.collateralUsd || risk?.collateralUsd || 0);
  const feeRatio = Number(simulation?.feeRatio ?? quote?.feeRatio ?? action.feeRatio ?? 0);
  const slippage = Number(action.slippage ?? simulation?.slippage ?? 0);
  return {
    type: type || action.type || (risk ? "perp" : "trade"),
    amountUsd,
    fromToken: normalizeToken(action.fromToken || simulation?.route?.fromToken || null),
    toToken: normalizeToken(action.toToken || simulation?.route?.toToken || null),
    fromRail: action.fromRail || simulation?.route?.fromRail || null,
    toRail: action.toRail || simulation?.route?.toRail || null,
    symbol: normalizeToken(action.symbol || risk?.symbol || null),
    leverage: Number(action.leverage || risk?.leverage || 0),
    liquidationBufferPct: Number(risk?.liquidationBufferPct || action.liquidationBufferPct || 0),
    feeRatio,
    slippage
  };
}

function detectMandateConflicts({ handle, candidate, ignoreId } = {}) {
  const active = getActiveMandates(handle).filter((mandate) => mandate.id !== ignoreId && mandate.id !== candidate.id);
  const conflicts = [];
  for (const mandate of active) {
    if (mandate.kind === candidate.kind && JSON.stringify(mandate.rules) !== JSON.stringify(candidate.rules)) {
      conflicts.push({
        mandateId: mandate.id,
        kind: mandate.kind,
        reason: `Existing ${mandate.kind} mandate has different rules.`
      });
    }
    const allowed = candidate.rules?.allowedAssets || (mandate.kind === "allowed_assets" ? mandate.rules.allowedAssets : null);
    const forbidden = candidate.rules?.forbiddenAssets || (mandate.kind === "forbidden_assets" ? mandate.rules.forbiddenAssets : null);
    if (allowed?.length && forbidden?.length) {
      const overlap = allowed.find((asset) => assetMatchesList(asset, forbidden));
      if (overlap) {
        conflicts.push({
          mandateId: mandate.id,
          kind: "asset_policy",
          reason: `${overlap} is both allowed and forbidden.`
        });
      }
    }
  }
  return conflicts;
}

function getMandateMemory(handle) {
  const user = resolveXHandle(handle);
  user.agentMemory ||= {
    riskProfile: user.policy?.riskProfile || "balanced",
    recentDecisions: [],
    recentFailures: []
  };
  user.agentMemory.mandates ||= [];
  return user.agentMemory;
}

function getActiveMandates(handle) {
  return getMandateMemory(handle).mandates.filter((mandate) => mandate.status === "active");
}

function findMandate(handle, mandateId) {
  const user = resolveXHandle(handle);
  return getMandateMemory(user.handle).mandates.find((mandate) => mandate.id === mandateId);
}

function nextMandateId(handle) {
  const user = users.get(normalizeHandle(handle));
  const count = Number(user?.agentMemory?.mandates?.length || 0) + 1;
  return `mandate_${Date.now().toString(36)}_${String(count).padStart(3, "0")}`;
}

function recordMandateEvent(type, mandate) {
  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type,
    handle: mandate.handle,
    mandateId: mandate.id,
    mandateKind: mandate.kind,
    status: mandate.status
  });
}

function recordMandateEvaluation(handle, check) {
  ledger.events.push({
    id: nextEventId(),
    at: check.checkedAt,
    type: "mandates_evaluated",
    handle,
    approved: check.approved,
    appliedCount: check.appliedMandates.length,
    violationCount: check.violations.length,
    reason: check.reason
  });
}

function mandateReceipt(mandate, action) {
  return {
    mandateId: mandate.id,
    action,
    status: mandate.status,
    kind: mandate.kind,
    rules: mandate.rules,
    conflicts: mandate.conflicts || [],
    at: new Date().toISOString()
  };
}

function dailySpendUsd(handle) {
  const normalized = normalizeHandle(handle);
  const today = new Date().toISOString().slice(0, 10);
  const defi = ledger.defiActions
    .filter((action) => action.handle === normalized && !["created", "rejected", "failed", "quote_unavailable"].includes(action.status))
    .filter((action) => String(action.createdAt || "").startsWith(today))
    .reduce((sum, action) => sum + Number(action.request?.amountUsd || action.request?.amount || 0), 0);
  const payments = ledger.payments
    .filter((payment) => payment.senderHandle === normalized && !["failed", "rejected"].includes(payment.status))
    .filter((payment) => String(payment.createdAt || "").startsWith(today))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return round(defi + payments);
}

function violation(applies, reason) {
  return {
    applies: Boolean(applies),
    violation: Boolean(applies),
    reason
  };
}

function pass(applies) {
  return {
    applies: Boolean(applies),
    violation: false
  };
}

function extractAssets(text) {
  return Array.from(String(text || "").matchAll(/0x[a-fA-F0-9]{40}|[a-zA-Z][a-zA-Z0-9]{1,20}/g))
    .map((match) => normalizeToken(match[0]))
    .filter((asset) => !["TO", "IF", "OVER", "ABOVE", "MORE", "THAN", "AND", "OR"].includes(tokenKey(asset)));
}

function normalizeAllocationToken(token) {
  const key = tokenKey(token);
  if (["STABLE", "STABLES", "STABLECOIN", "STABLECOINS"].includes(key)) return "STABLES";
  return normalizeToken(token);
}

function normalizeToken(token) {
  if (!token) return null;
  const raw = String(token).trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(raw)) return raw;
  const key = raw.toUpperCase();
  if (key === "CIRBTC" || key === "BTC") return "cirBTC";
  if (key === "ETH") return "WETH";
  return key;
}

function assetMatchesList(asset, list = []) {
  const key = tokenKey(asset);
  return list.some((item) => {
    const candidate = tokenKey(item);
    if (STABLE_GROUP.has(candidate)) return ["USDC", "EURC", "USDT"].includes(key);
    if (candidate === "BTC") return key === "CIRBTC";
    if (candidate === "ETH") return key === "WETH";
    if (VOLATILE_GROUP.has(candidate) && candidate === key) return true;
    return candidate === key;
  });
}

function tokenKey(token) {
  return String(token || "").toUpperCase();
}

function round(value) {
  return Math.round(Number(value || 0) * 1_000_000) / 1_000_000;
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
