import { ledger } from "./fixtures.js";
import { config } from "./config.js";
import { getSettlementRail } from "./settlement.js";
import { quoteCircleAppKitRoute } from "./appKitCircleAdapter.js";

const FRESH_MS = 5 * 60_000;
const DEFAULT_PROBE_AMOUNT = 1;
const AUTO_PROBE_STATUSES = new Set(["stale_probe_required", "stale", "probe_failed", "unavailable"]);

const SEEDED_ROUTES = [
  seededRoute({ type: "swap", fromRail: "arc-testnet", toRail: "arc-testnet", fromToken: "USDC", toToken: "EURC", status: "live", provider: "circle-app-kit", source: "manual_seed", reason: "Known Arc AppKit route." }),
  seededRoute({ type: "swap", fromRail: "arc-testnet", toRail: "arc-testnet", fromToken: "EURC", toToken: "USDC", status: "unavailable", provider: "circle-app-kit", source: "manual_seed", reason: "Reverse route has not returned a live quote yet." }),
  seededRoute({ type: "swap", fromRail: "arc-testnet", toRail: "arc-testnet", fromToken: "USDC", toToken: "cirBTC", status: "unavailable", provider: "circle-app-kit", source: "manual_seed", reason: "cirBTC route has not returned a live quote yet." }),
  seededRoute({ type: "swap", fromRail: "arc-testnet", toRail: "arc-testnet", fromToken: "cirBTC", toToken: "USDC", status: "unavailable", provider: "circle-app-kit", source: "manual_seed", reason: "cirBTC route has not returned a live quote yet." }),
  seededRoute({ type: "swap", fromRail: "arc-testnet", toRail: "arc-testnet", fromToken: "NATIVE", toToken: "USDC", status: "hidden", provider: "circle-app-kit", source: "manual_seed", reason: "Arc native asset is USDC-like gas context; do not present it as a swap pair." }),
  seededRoute({ type: "swap", fromRail: "arc-testnet", toRail: "arc-testnet", fromToken: "USDC", toToken: "NATIVE", status: "hidden", provider: "circle-app-kit", source: "manual_seed", reason: "Arc native asset is not a normal swap target in bunOS." }),
  seededRoute({ type: "swap", fromRail: "arc-testnet", toRail: "arc-testnet", fromToken: "USDT", toToken: "USDC", status: "needs_address", provider: "circle-app-kit", source: "manual_seed", reason: "USDT symbol routes require an explicit token address on Arc." }),
  seededRoute({ type: "swap", fromRail: "arc-testnet", toRail: "arc-testnet", fromToken: "USDC", toToken: "USDT", status: "needs_address", provider: "circle-app-kit", source: "manual_seed", reason: "USDT symbol routes require an explicit token address on Arc." }),
  seededRoute({ type: "bridge", fromRail: "arc-testnet", toRail: "base-sepolia", fromToken: "USDC", toToken: "USDC", status: "live", provider: "circle-app-kit", source: "manual_seed", reason: "Known USDC bridge route; fee and balance checks still apply." }),
  seededRoute({ type: "bridge", fromRail: "base-sepolia", toRail: "arc-testnet", fromToken: "USDC", toToken: "USDC", status: "live", provider: "circle-app-kit", source: "manual_seed", reason: "Known USDC bridge route; fee and balance checks still apply." })
];

export function listRouteCapabilities({ type, fromRail, toRail, status, includeHidden = false, limit = 100 } = {}) {
  ensureSeedRoutes();
  const normalizedType = type ? String(type).toLowerCase() : null;
  const routes = (ledger.routeCapabilities || []).map(withEffectiveStatus);
  return {
    ok: true,
    routes: routes
      .filter((route) => (
        (!normalizedType || route.type === normalizedType)
        && (!fromRail || route.fromRail === normalizeRail(fromRail))
        && (!toRail || route.toRail === normalizeRail(toRail))
        && (!status || route.effectiveStatus === status || route.status === status)
        && (includeHidden || route.status !== "hidden")
      ))
      .slice()
      .sort((a, b) => routeSortKey(a).localeCompare(routeSortKey(b)))
      .slice(0, Number(limit) || 100)
  };
}

export function checkRouteCapability(action = {}) {
  ensureSeedRoutes();
  const descriptor = normalizeRouteDescriptor(action);
  if (!config.defi.liveAdapters) {
    return { ok: true, status: "mock_allowed", descriptor };
  }
  const record = findRoute(descriptor);
  if (!record) {
    return unavailableDecision({
      descriptor,
      status: "unavailable",
      reason: `I do not have a live ${descriptor.type} route for ${formatRoute(descriptor)} right now.`
    });
  }

  const effectiveStatus = effectiveRouteStatus(record);

  if (effectiveStatus === "live") {
    return { ok: true, status: "live", route: withEffectiveStatus(record), descriptor };
  }

  if (effectiveStatus === "stale_probe_required") {
    return unavailableDecision({
      descriptor,
      route: withEffectiveStatus(record),
      status: "stale_probe_required",
      reason: `I know ${formatRoute(descriptor)} as a possible route, but I do not have a fresh live quote for it yet.`
    });
  }

  if (record.status === "probe_failed" && !isFresh(record)) {
    return unavailableDecision({
      descriptor,
      route: withEffectiveStatus(record),
      status: "stale",
      reason: `The last probe for ${formatRoute(descriptor)} is stale and did not prove a live route.`
    });
  }

  return unavailableDecision({
    descriptor,
    route: withEffectiveStatus(record),
    status: effectiveStatus,
    reason: userReasonForRoute(record, descriptor)
  });
}

export async function resolveRouteCapability(action = {}, { handle, amount, autoProbe = true } = {}) {
  const initial = checkRouteCapability(action);
  if (
    initial.ok
    || !autoProbe
    || !config.defi.liveAdapters
    || !config.defi.routeProbeEnabled
    || !shouldAutoProbeRoute(initial)
  ) {
    return initial;
  }

  const probe = await probeRouteCapability({
    ...(initial.descriptor || normalizeRouteDescriptor(action)),
    handle: handle || action.handle || action.senderHandle,
    amount: amount || action.amount || action.amountUsd || DEFAULT_PROBE_AMOUNT
  });

  if (probe.ok) {
    return {
      ok: true,
      status: "live",
      route: withEffectiveStatus(probe.route),
      descriptor: initial.descriptor,
      probe
    };
  }

  return unavailableDecision({
    descriptor: initial.descriptor,
    route: withEffectiveStatus(probe.route),
    status: "probe_failed",
    reason: `I checked ${formatRoute(initial.descriptor)} live, but the provider did not return a tradable route.`
  });
}

export async function probeRouteCapability(input = {}) {
  ensureSeedRoutes();
  const descriptor = normalizeRouteDescriptor({
    ...input,
    amount: input.amount || input.amountUsd || DEFAULT_PROBE_AMOUNT
  });
  const handle = input.handle || "@sara";
  const amount = Number(input.amount || input.amountUsd || DEFAULT_PROBE_AMOUNT);
  let quote;
  try {
    quote = await quoteCircleAppKitRoute({
      handle,
      type: descriptor.type,
      fromRail: descriptor.fromRail,
      toRail: descriptor.toRail,
      settlementRail: descriptor.fromRail,
      fromToken: descriptor.fromToken,
      toToken: descriptor.toToken,
      token: descriptor.fromToken,
      tokenIn: descriptor.fromToken,
      tokenOut: descriptor.toToken,
      amount,
      amountUsd: amount
    });
    const quality = quoteQuality({ quote, descriptor });
    if (!quality.ok) {
      const route = upsertRouteCapability({
        ...descriptor,
        status: "probe_failed",
        provider: quote.provider || "circle-app-kit",
        source: "probe",
        lastQuotedAt: new Date().toISOString(),
        lastError: quality.reason,
        inputAmount: amount,
        estimatedFee: estimateFeeUsd(quote),
        expectedOutput: estimateOutput(quote),
        reason: quality.reason,
        raw: summarizeQuote(quote)
      });
      return { ok: false, route, quote, error: quality.reason };
    }

    const route = upsertRouteCapability({
      ...descriptor,
      status: "live",
      provider: quote.provider || "circle-app-kit",
      source: "probe",
      lastQuotedAt: new Date().toISOString(),
      lastError: null,
      inputAmount: amount,
      estimatedFee: estimateFeeUsd(quote),
      expectedOutput: estimateOutput(quote),
      reason: quality.reason || "Live quote probe succeeded.",
      raw: summarizeQuote(quote)
    });
    return { ok: true, route, quote };
  } catch (error) {
    const route = upsertRouteCapability({
      ...descriptor,
      status: "probe_failed",
      provider: "circle-app-kit",
      source: "probe",
      lastQuotedAt: new Date().toISOString(),
      lastError: cleanProviderError(error.message),
      inputAmount: amount,
      estimatedFee: null,
      expectedOutput: null,
      reason: cleanProviderError(error.message)
    });
    return { ok: false, route, error: route.lastError };
  }
}

function shouldAutoProbeRoute(decision) {
  if (!AUTO_PROBE_STATUSES.has(decision.status)) return false;
  const route = decision.route;
  if (!route) return false;
  if (["hidden", "needs_address"].includes(route.status)) return false;
  return route.provider === "circle-app-kit" || route.source === "manual_seed" || route.source === "probe";
}

export async function probeDefaultRoutes({ handle = "@sara", amount = DEFAULT_PROBE_AMOUNT, limit = 20 } = {}) {
  ensureSeedRoutes();
  const routes = listRouteCapabilities({ includeHidden: false, limit }).routes
    .filter((route) => ["live", "unavailable", "probe_failed"].includes(route.status))
    .slice(0, Number(limit) || 20);
  const results = [];
  for (const route of routes) {
    results.push(await probeRouteCapability({ ...route, handle, amount }));
  }
  return { ok: true, probed: results.length, results };
}

export function routeCapabilityForUi() {
  const { routes } = listRouteCapabilities({ includeHidden: false, limit: 200 });
  const normalized = routes.map(withEffectiveStatus);
  return {
    ok: true,
    live: normalized.filter((route) => route.status === "live"),
    unavailable: normalized.filter((route) => route.status !== "live")
  };
}

export function normalizeRouteDescriptor(action = {}) {
  const type = String(action.type || (action.fromRail && action.toRail && action.fromRail !== action.toRail ? "bridge" : "swap")).toLowerCase();
  const fromRail = normalizeRail(action.fromRail || action.settlementRail || "arc-testnet");
  const toRail = normalizeRail(action.toRail || (type === "swap" ? fromRail : "base-sepolia"));
  const fromToken = normalizeRouteToken(action.fromToken || action.tokenIn || action.token || "USDC");
  const toToken = normalizeRouteToken(action.toToken || action.tokenOut || (type === "swap" ? "EURC" : fromToken));
  return { type, fromRail, toRail, fromToken, toToken };
}

function ensureSeedRoutes() {
  ledger.routeCapabilities ||= [];
  for (const route of SEEDED_ROUTES) {
    const existing = findRoute(route);
    if (!existing) ledger.routeCapabilities.push({ ...route });
  }
}

function seededRoute(input) {
  const descriptor = normalizeRouteDescriptor(input);
  const now = "2026-05-01T00:00:00.000Z";
  return {
    id: routeId(descriptor),
    ...descriptor,
    status: input.status,
    provider: input.provider || "circle-app-kit",
    source: input.source || "manual_seed",
    lastQuotedAt: input.status === "live" ? now : null,
    lastError: input.status === "live" ? null : input.reason,
    inputAmount: DEFAULT_PROBE_AMOUNT,
    expectedOutput: null,
    estimatedFee: null,
    reason: input.reason || null,
    updatedAt: now
  };
}

function upsertRouteCapability(input) {
  const descriptor = normalizeRouteDescriptor(input);
  ledger.routeCapabilities ||= [];
  const id = routeId(descriptor);
  const now = new Date().toISOString();
  const existing = ledger.routeCapabilities.find((route) => route.id === id);
  const next = {
    ...(existing || {}),
    id,
    ...descriptor,
    status: input.status,
    provider: input.provider || existing?.provider || "circle-app-kit",
    source: input.source || "probe",
    lastQuotedAt: input.lastQuotedAt || now,
    lastError: input.lastError || null,
    inputAmount: input.inputAmount ?? existing?.inputAmount ?? DEFAULT_PROBE_AMOUNT,
    expectedOutput: input.expectedOutput ?? null,
    estimatedFee: input.estimatedFee ?? null,
    reason: input.reason || null,
    raw: input.raw || undefined,
    updatedAt: now
  };
  if (existing) Object.assign(existing, next);
  else ledger.routeCapabilities.push(next);
  return existing || next;
}

function findRoute(descriptor) {
  const id = routeId(normalizeRouteDescriptor(descriptor));
  return (ledger.routeCapabilities || []).find((route) => route.id === id) || null;
}

function routeId(descriptor) {
  const normalized = normalizeRouteDescriptor(descriptor);
  return [
    "route",
    normalized.type,
    normalized.fromRail,
    normalized.toRail,
    normalized.fromToken.toLowerCase(),
    normalized.toToken.toLowerCase()
  ].join(":");
}

function unavailableDecision({ descriptor, route, status, reason }) {
  return {
    ok: false,
    status,
    route: route || null,
    descriptor,
    reason,
    suggestions: suggestionsForRoute(descriptor, route),
    nextAction: "choose_supported_route"
  };
}

function userReasonForRoute(route, descriptor) {
  if (route.status === "hidden") {
    return `${formatRoute(descriptor)} is not shown as a normal ${descriptor.type} route in bunOS.`;
  }
  if (route.status === "needs_address") {
    return `${formatRoute(descriptor)} needs an explicit token contract address before I can check a live route.`;
  }
  return `I cannot find a live ${descriptor.type} route for ${formatRoute(descriptor)} right now. ${route.reason || route.lastError || "The provider has not returned a successful quote."}`;
}

function suggestionsForRoute(descriptor, route) {
  if (descriptor.type === "swap" && descriptor.fromRail === "arc-testnet") {
    const base = ["Try USDC -> EURC on Arc if you want the currently enabled Arc swap route."];
    if (route?.status === "needs_address") base.push("Use the token contract address instead of the symbol for less common assets.");
    return base;
  }
  if (descriptor.type === "bridge") return ["Try USDC between Arc and Base Sepolia with a larger amount if small-route fees are too high."];
  return ["Choose a route marked live in the route registry."];
}

function formatRoute(descriptor) {
  if (descriptor.type === "bridge") return `${descriptor.fromToken} from ${descriptor.fromRail} to ${descriptor.toRail}`;
  return `${descriptor.fromToken} -> ${descriptor.toToken} on ${descriptor.fromRail}`;
}

function normalizeRail(rail) {
  const raw = String(rail || "arc-testnet").toLowerCase();
  if (raw === "arc") return "arc-testnet";
  if (raw === "base") return "base-sepolia";
  return getSettlementRail(raw).id;
}

function normalizeRouteToken(token) {
  const raw = String(token || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(raw)) return raw;
  const value = raw.toUpperCase();
  if (value === "ETH") return "WETH";
  if (value === "CIRBTC") return "cirBTC";
  return value;
}

function routeSortKey(route) {
  return `${effectiveRouteStatus(route) === "live" ? "0" : "1"}:${route.type}:${route.fromRail}:${route.fromToken}:${route.toToken}:${route.toRail}`;
}

function isFresh(route) {
  return route.lastQuotedAt && Date.now() - new Date(route.lastQuotedAt).getTime() <= FRESH_MS;
}

function effectiveRouteStatus(route) {
  if (!route) return "unavailable";
  if (route.status !== "live") return route.status;
  if (!config.defi.liveAdapters || !config.defi.routeProbeEnabled) return "live";
  if (route.source === "probe" && isFresh(route)) return "live";
  return "stale_probe_required";
}

function withEffectiveStatus(route) {
  if (!route) return route;
  const effectiveStatus = effectiveRouteStatus(route);
  return {
    ...route,
    effectiveStatus,
    probeRequired: route.status === "live" && effectiveStatus !== "live",
    fresh: route.source === "probe" && isFresh(route)
  };
}

function estimateFeeUsd(quote) {
  const fee = firstFiniteNumber([
    quote?.estimate?.gasCostUSD,
    quote?.estimate?.gasCostUsd,
    quote?.estimate?.feeUsd,
    quote?.estimate?.feeUSD,
    quote?.estimatedFee,
    sumFees(quote?.estimate?.fees)
  ]);
  return fee;
}

function estimateOutput(quote) {
  return quote?.estimate?.estimatedOutput?.amount
    || quote?.estimate?.toAmount
    || quote?.estimate?.toAmountMin
    || quote?.estimate?.amountOut
    || quote?.estimate?.outputAmount
    || quote?.expectedOutput
    || null;
}

function summarizeQuote(quote) {
  return {
    provider: quote?.provider,
    operation: quote?.operation,
    executable: Boolean(quote?.executable),
    estimate: quote?.estimate || null,
    request: quote?.request || null
  };
}

function quoteQuality({ quote, descriptor }) {
  if (!quote?.ok) {
    return { ok: false, reason: quote?.reason || "Provider did not return a usable quote." };
  }

  if (descriptor.type === "swap") {
    const output = Number(estimateOutput(quote));
    if (!Number.isFinite(output) || output <= 0) {
      return {
        ok: false,
        reason: `Circle returned a ${formatRoute(descriptor)} quote, but it did not include a usable output amount.`
      };
    }
    return { ok: true, reason: "Live swap quote returned a usable output amount." };
  }

  if (descriptor.type === "bridge") {
    if (descriptor.fromToken !== "USDC" || descriptor.toToken !== "USDC") {
      return {
        ok: false,
        reason: "Circle AppKit bridge execution is USDC-only on the configured rails."
      };
    }
    const amount = Number(quote?.estimate?.amount ?? quote?.request?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        ok: false,
        reason: `Circle returned a ${formatRoute(descriptor)} bridge quote, but it did not include a usable amount.`
      };
    }
    return { ok: true, reason: "Live bridge quote returned a usable transfer amount." };
  }

  return { ok: false, reason: "Unsupported route type." };
}

function firstFiniteNumber(values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function sumFees(fees) {
  if (!Array.isArray(fees)) return null;
  let total = 0;
  let found = false;
  for (const fee of fees) {
    const token = fee?.token?.symbol || fee?.token || fee?.currency;
    if (String(token || "").toUpperCase() !== "USDC") continue;
    const amount = normalizedStableAmount(fee?.amount, fee?.token?.decimals ?? fee?.decimals);
    if (amount === null) continue;
    total += amount;
    found = true;
  }
  return found ? total : null;
}

function normalizedStableAmount(value, decimals = 6) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value);
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (/^\d+$/.test(raw) && amount > 100 && Number(decimals) >= 6) {
    return amount / 10 ** Number(decimals);
  }
  return amount;
}

function cleanProviderError(message) {
  return String(message || "Provider did not return a live route.")
    .replace(/AppKit:/ig, "")
    .replace(/LI\.FI fallback:/ig, "")
    .replace(/\s+/g, " ")
    .trim();
}
