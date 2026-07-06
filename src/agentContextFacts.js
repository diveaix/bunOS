const DEFAULT_FACT_LIMIT = 18;
const AUTHORITY_WEIGHT = {
  authoritative: 1,
  observed: 0.9,
  configured: 0.8,
  user_stated: 0.72,
  remembered: 0.58,
  inferred: 0.4
};
const FRESHNESS_WEIGHT = {
  fresh: 1,
  reference: 0.88,
  aging: 0.65,
  stale: 0.25,
  unknown: 0.45
};

export function buildAgentContextFacts({
  context = {},
  text = "",
  topic = "agent",
  now = new Date()
} = {}) {
  const facts = [];
  const observedAt = now.toISOString();

  facts.push(contextFact({
    id: "identity:authenticated_handle",
    kind: "identity",
    topic: "agent",
    value: {
      handle: context.user?.handle || null,
      walletConnected: Boolean(context.user?.walletConnected)
    },
    source: "authenticated_session",
    authority: "authoritative",
    observedAt,
    ttlMs: null,
    query: text,
    activeTopic: topic
  }));

  if (context.wallet) {
    facts.push(contextFact({
      id: "wallet:balance_snapshot",
      kind: "wallet_snapshot",
      topic: "wallet",
      value: {
        totalValueUsd: context.wallet.totalValueUsd,
        balances: context.wallet.balances,
        tokenBalances: context.wallet.tokenBalances,
        spendable: context.wallet.spendable
      },
      source: "wallet_profile",
      authority: "observed",
      observedAt,
      ttlMs: 30_000,
      query: text,
      activeTopic: topic
    }));
  }

  addRouteFacts(facts, context.routes, { text, topic, now });
  addOpenStateFacts(facts, context.openState, { text, topic, observedAt });
  addMemoryFacts(facts, context, { text, topic });
  addConversationFacts(facts, context.conversation, { text, topic, observedAt });

  return selectAgentContextFacts(facts, {
    topic,
    query: text,
    limit: DEFAULT_FACT_LIMIT,
    now
  });
}

export function selectAgentContextFacts(facts = [], {
  topic = "agent",
  query = "",
  limit = DEFAULT_FACT_LIMIT,
  now = new Date()
} = {}) {
  return facts
    .filter(Boolean)
    .map((fact) => refreshFact(fact, { topic, query, now }))
    .filter((fact) => fact.relevance.score > 0.1)
    .sort((a, b) => (
      b.relevance.score - a.relevance.score
      || authorityScore(b.provenance.authority) - authorityScore(a.provenance.authority)
      || timestamp(b.provenance.observedAt) - timestamp(a.provenance.observedAt)
    ))
    .slice(0, Math.max(1, Number(limit) || DEFAULT_FACT_LIMIT));
}

export function assessAgentContextFacts(facts = []) {
  const counts = {
    total: facts.length,
    executionAuthority: 0,
    planningHints: 0,
    historicalOnly: 0,
    unusable: 0,
    stale: 0,
    contradictions: 0,
    blockingContradictions: 0
  };
  for (const fact of facts) {
    if (fact.freshness?.status === "stale") counts.stale += 1;
    if (fact.decisionUse === "execution_authority") counts.executionAuthority += 1;
    else if (fact.decisionUse === "planning_hint") counts.planningHints += 1;
    else if (fact.decisionUse === "historical_only") counts.historicalOnly += 1;
    else counts.unusable += 1;
  }
  const contradictions = detectAgentContextContradictions(facts);
  counts.contradictions = contradictions.length;
  counts.blockingContradictions = contradictions.filter((item) => item.blocksExecution).length;
  return {
    version: 1,
    ...counts,
    hasContradictions: contradictions.length > 0,
    contradictions,
    rule: "Only execution_authority facts may prove current state. planning_hint facts may select a check, historical_only facts explain prior outcomes, and unusable facts must be refreshed."
  };
}

export function detectAgentContextContradictions(facts = []) {
  const groups = new Map();
  for (const fact of facts.map((item) => refreshFact(item, {
    topic: item?.topic || "agent",
    query: "",
    now: new Date()
  }))) {
    if (!fact || fact.decisionUse === "unusable") continue;
    const key = contradictionKey(fact);
    if (!key) continue;
    const claim = contradictionClaim(fact);
    if (claim === null || claim === undefined || claim === "") continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ fact, claim: String(claim).toLowerCase() });
  }

  const contradictions = [];
  for (const [key, entries] of groups.entries()) {
    const claims = Array.from(new Set(entries.map((entry) => entry.claim)));
    if (claims.length < 2) continue;
    const current = entries.filter((entry) => (
      entry.fact.decisionUse === "execution_authority"
      || entry.fact.provenance.authority === "authoritative"
      || entry.fact.provenance.authority === "observed"
    ));
    const blocksExecution = current.length > 0 && entries.some((entry) => isBlockingClaim(entry.fact, entry.claim));
    contradictions.push({
      key,
      kind: entries[0].fact.kind,
      topic: entries[0].fact.topic,
      claims,
      factIds: entries.map((entry) => entry.fact.id).slice(0, 6),
      sources: Array.from(new Set(entries.map((entry) => entry.fact.provenance.source))).slice(0, 6),
      authorities: Array.from(new Set(entries.map((entry) => entry.fact.provenance.authority))).slice(0, 6),
      blocksExecution,
      guidance: blocksExecution
        ? "Refresh authoritative state or ask the user before money movement."
        : "Prefer the freshest highest-authority fact for planning."
    });
  }
  return contradictions.slice(0, 8);
}

export function contextFact({
  id,
  kind,
  topic = "agent",
  value,
  source,
  authority = "inferred",
  observedAt = null,
  ttlMs = null,
  query = "",
  activeTopic = "agent",
  confidence
} = {}) {
  const observed = validDate(observedAt) || null;
  const expiresAt = observed && positiveOrZero(ttlMs)
    ? new Date(new Date(observed).getTime() + Number(ttlMs)).toISOString()
    : null;
  const fact = {
    id: String(id || `${kind || "fact"}:${source || "unknown"}`),
    kind: String(kind || "fact"),
    topic: String(topic || "agent"),
    value,
    provenance: {
      source: String(source || "unknown"),
      authority,
      observedAt: observed,
      expiresAt
    },
    confidence: confidence ?? authorityScore(authority)
  };
  return refreshFact(fact, {
    topic: activeTopic,
    query,
    now: new Date()
  });
}

function addRouteFacts(facts, routes = {}, { text, topic, now }) {
  for (const route of [
    ...(routes?.liveSwaps || []),
    ...(routes?.liveBridges || []),
    ...(routes?.blockedRoutes || [])
  ]) {
    const observedAt = validDate(route.lastQuotedAt || route.updatedAt);
    const probed = route.source === "probe";
    facts.push(contextFact({
      id: route.id || [
        "route",
        route.type,
        route.fromRail,
        route.toRail,
        route.fromToken,
        route.toToken
      ].join(":"),
      kind: "route_capability",
      topic: route.type === "bridge" ? "bridge" : "swap",
      value: {
        type: route.type,
        fromRail: route.fromRail,
        toRail: route.toRail,
        fromToken: route.fromToken,
        toToken: route.toToken,
        status: route.status,
        reason: route.reason || null
      },
      source: probed ? "route_probe" : "route_registry",
      authority: probed ? "observed" : "configured",
      observedAt: observedAt || now.toISOString(),
      ttlMs: probed ? 5 * 60_000 : null,
      query: text,
      activeTopic: topic
    }));
  }
}

function addOpenStateFacts(facts, openState = {}, { text, topic, observedAt }) {
  for (const approval of openState?.pendingApprovals || []) {
    facts.push(contextFact({
      id: `approval:${approval.id}`,
      kind: "pending_approval",
      topic: "agent",
      value: approval,
      source: "approval_ledger",
      authority: "authoritative",
      observedAt,
      ttlMs: 15_000,
      query: text,
      activeTopic: topic
    }));
  }
  for (const automation of openState?.activeAutomations || []) {
    facts.push(contextFact({
      id: `automation:${automation.id}`,
      kind: "active_automation",
      topic: "automation",
      value: automation,
      source: "automation_ledger",
      authority: "authoritative",
      observedAt: validDate(automation.updatedAt || automation.lastRunAt) || observedAt,
      ttlMs: 30_000,
      query: text,
      activeTopic: topic
    }));
  }
  for (const position of openState?.openPerps || []) {
    facts.push(contextFact({
      id: `perp:${position.positionId || position.id}`,
      kind: "open_perp",
      topic: "perps",
      value: position,
      source: "perp_ledger",
      authority: "authoritative",
      observedAt: validDate(position.updatedAt || position.createdAt) || observedAt,
      ttlMs: 15_000,
      query: text,
      activeTopic: topic
    }));
  }
  for (const workflow of openState?.activeWorkflows || []) {
    facts.push(contextFact({
      id: `workflow:${workflow.id}`,
      kind: "active_workflow",
      topic: "workflow",
      value: workflow,
      source: "agent_workflow_ledger",
      authority: "authoritative",
      observedAt: validDate(workflow.updatedAt) || observedAt,
      ttlMs: 15_000,
      query: text,
      activeTopic: topic
    }));
  }
}

function addMemoryFacts(facts, context, { text, topic }) {
  const lastTrade = context.memory?.lastTrade || context.recent?.lastTrade;
  if (lastTrade) {
    facts.push(contextFact({
      id: `memory:last_trade:${lastTrade.id || "latest"}`,
      kind: "historical_trade",
      topic: lastTrade.type === "perp" ? "perps" : lastTrade.type || "agent",
      value: lastTrade,
      source: "agent_memory",
      authority: "remembered",
      observedAt: validDate(lastTrade.at),
      ttlMs: null,
      query: text,
      activeTopic: topic
    }));
  }
  for (const failure of context.memory?.recentFailures || []) {
    facts.push(contextFact({
      id: `memory:failure:${failure.actionId || failure.at || facts.length}`,
      kind: "historical_failure",
      topic: topicForTool(failure.tool),
      value: failure,
      source: "agent_memory",
      authority: "remembered",
      observedAt: validDate(failure.at),
      ttlMs: null,
      query: text,
      activeTopic: topic
    }));
  }
  if (context.workingMemory?.objectiveGraph) {
    facts.push(contextFact({
      id: `objective:${context.workingMemory.objectiveGraph.id || "active"}`,
      kind: "active_objective",
      topic: context.workingMemory.topic || "agent",
      value: context.workingMemory.objectiveGraph,
      source: "agent_working_memory",
      authority: "authoritative",
      observedAt: validDate(context.workingMemory.objectiveGraph.updatedAt),
      ttlMs: null,
      query: text,
      activeTopic: topic
    }));
  }
}

function addConversationFacts(facts, conversation = {}, { text, topic, observedAt }) {
  const lastUser = (conversation?.lastMessages || []).slice().reverse()
    .find((message) => message.role === "user");
  if (!lastUser?.content) return;
  facts.push(contextFact({
    id: "conversation:last_user_statement",
    kind: "user_statement",
    topic,
    value: {
      content: lastUser.content
    },
    source: "conversation",
    authority: "user_stated",
    observedAt,
    ttlMs: 10 * 60_000,
    query: text,
    activeTopic: topic
  }));
}

function refreshFact(fact, { topic, query, now }) {
  const freshness = freshnessFor(fact.provenance, now);
  const topical = topic === "agent" || fact.topic === "agent" || fact.topic === topic ? 1 : 0.3;
  const lexical = lexicalOverlap(query, fact);
  const specificity = entitySpecificity(query, fact);
  const authority = authorityScore(fact.provenance.authority);
  const score = clamp(
    (topical * 0.32)
    + (lexical * 0.16)
    + (specificity * 0.22)
    + (authority * 0.17)
    + (FRESHNESS_WEIGHT[freshness.status] * 0.13)
  );
  return {
    ...fact,
    freshness,
    decisionUse: decisionUseFor(fact, freshness),
    relevance: {
      score: Number(score.toFixed(3)),
      topical: Number(topical.toFixed(2)),
      lexical: Number(lexical.toFixed(2)),
      specificity: Number(specificity.toFixed(2))
    }
  };
}

function entitySpecificity(query, fact) {
  const input = String(query || "").toLowerCase();
  const value = fact.value || {};
  if (!input) return 0.5;
  if (fact.kind === "route_capability") {
    const entities = [
      value.fromToken,
      value.toToken,
      railAlias(value.fromRail),
      railAlias(value.toRail)
    ].filter(Boolean).map((item) => String(item).toLowerCase());
    const matched = entities.filter((item) => input.includes(item)).length;
    const tokenEntities = [value.fromToken, value.toToken].filter(Boolean);
    const tokenMatches = tokenEntities.filter((item) => input.includes(String(item).toLowerCase())).length;
    if (tokenEntities.length === 2 && tokenMatches === tokenEntities.length) {
      const fromIndex = input.indexOf(String(value.fromToken).toLowerCase());
      const toIndex = input.lastIndexOf(String(value.toToken).toLowerCase());
      return fromIndex <= toIndex ? 1 : 0.65;
    }
    if (tokenEntities.length && tokenMatches === tokenEntities.length) return 1;
    return entities.length ? matched / entities.length : 0;
  }
  const identifiers = [
    value.id,
    value.actionId,
    value.approvalId,
    value.automationId,
    value.positionId,
    value.symbol,
    value.recipientHandle
  ].filter(Boolean).map((item) => String(item).toLowerCase());
  if (identifiers.some((item) => input.includes(item))) return 1;
  return fact.topic === "agent" ? 0.45 : 0.25;
}

function decisionUseFor(fact, freshness) {
  if (freshness.status === "stale" || freshness.status === "unknown") return "unusable";
  if (fact.provenance.authority === "remembered") return "historical_only";
  if (["configured", "user_stated", "inferred"].includes(fact.provenance.authority)) return "planning_hint";
  if (["authoritative", "observed"].includes(fact.provenance.authority)) return "execution_authority";
  return "unusable";
}

function contradictionKey(fact) {
  const value = fact.value || {};
  if (fact.kind === "route_capability") {
    return [
      "route",
      value.type || fact.topic,
      canonical(value.fromRail),
      canonical(value.toRail),
      canonical(value.fromToken),
      canonical(value.toToken)
    ].join(":");
  }
  if (fact.kind === "wallet_snapshot") return "wallet:spendable";
  if (fact.kind === "open_perp") return `perp:${value.positionId || value.id || value.symbol || "unknown"}`;
  if (fact.kind === "active_workflow") return `workflow:${value.id || "unknown"}`;
  if (fact.kind === "pending_approval") return `approval:${value.id || value.targetId || "unknown"}`;
  if (fact.kind === "active_objective") return `objective:${value.id || "active"}`;
  return null;
}

function contradictionClaim(fact) {
  const value = fact.value || {};
  if (fact.kind === "route_capability") return routeClaim(value.status);
  if (fact.kind === "wallet_snapshot") return value.spendable ? "spendable" : "not_spendable";
  if (fact.kind === "open_perp") return String(value.status || "open").toLowerCase();
  if (fact.kind === "active_workflow") return String(value.status || "active").toLowerCase();
  if (fact.kind === "pending_approval") return String(value.status || "pending").toLowerCase();
  if (fact.kind === "active_objective") return String(value.status || value.currentStep || "active").toLowerCase();
  return null;
}

function routeClaim(status) {
  const value = String(status || "").toLowerCase();
  if (["live", "available", "ready"].includes(value)) return "live";
  if (["blocked", "unavailable", "hidden", "failed", "quote_unavailable", "disabled"].includes(value)) return "unavailable";
  return value || "unknown";
}

function isBlockingClaim(fact, claim) {
  if (fact.kind === "route_capability") return claim !== "live";
  if (fact.kind === "wallet_snapshot") return claim === "not_spendable";
  if (fact.kind === "open_perp") return ["closed", "failed", "rejected"].includes(claim);
  if (fact.kind === "pending_approval") return ["expired", "rejected", "cancelled"].includes(claim);
  if (fact.kind === "active_workflow") return ["failed", "cancelled"].includes(claim);
  return false;
}

function canonical(value) {
  return String(value || "").trim().toLowerCase();
}

function freshnessFor(provenance = {}, now = new Date()) {
  const observed = timestamp(provenance.observedAt);
  const expires = timestamp(provenance.expiresAt);
  if (!observed) {
    return { status: "unknown", ageMs: null, expiresInMs: null };
  }
  const nowMs = now.getTime();
  const ageMs = Math.max(0, nowMs - observed);
  if (!expires) return { status: "reference", ageMs, expiresInMs: null };
  const expiresInMs = expires - nowMs;
  if (expiresInMs < 0) return { status: "stale", ageMs, expiresInMs };
  const lifetime = Math.max(1, expires - observed);
  return {
    status: ageMs > lifetime * 0.75 ? "aging" : "fresh",
    ageMs,
    expiresInMs
  };
}

function lexicalOverlap(query, fact) {
  const queryTerms = terms(query);
  if (!queryTerms.size) return 0.5;
  const factTerms = terms(`${fact.kind} ${fact.topic} ${safeStringify(fact.value)}`);
  let matches = 0;
  for (const term of queryTerms) if (factTerms.has(term)) matches += 1;
  return Math.min(1, matches / Math.max(1, Math.min(queryTerms.size, 5)));
}

function terms(value) {
  return new Set(String(value || "").toLowerCase().match(/[a-z0-9@]{2,}/g) || []);
}

function topicForTool(tool) {
  const value = String(tool || "");
  if (/automation/.test(value)) return "automation";
  if (/perp|position/.test(value)) return "perps";
  if (/bridge/.test(value)) return "bridge";
  if (/swap|defi|route/.test(value)) return "swap";
  if (/wallet|balance|payment|send/.test(value)) return "wallet";
  return "agent";
}

function railAlias(value) {
  const rail = String(value || "").toLowerCase();
  if (rail === "arc-testnet") return "arc";
  if (rail === "base-sepolia") return "base";
  return rail;
}

function authorityScore(authority) {
  return AUTHORITY_WEIGHT[authority] ?? AUTHORITY_WEIGHT.inferred;
}

function validDate(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function timestamp(value) {
  return value ? new Date(value).getTime() || 0 : 0;
}

function positiveOrZero(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}
