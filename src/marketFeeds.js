import { config } from "./config.js";
import { ledger } from "./fixtures.js";
import { listHyperliquidMarkets } from "./hyperliquidAdapter.js";
import { nextEventId } from "./ids.js";

const SUPPORTED_ASSETS = ["USDC", "EURC", "cirBTC", "WETH", "NATIVE"];
const COINGECKO_IDS = {
  USDC: "usd-coin",
  EURC: "euro-coin",
  cirBTC: "bitcoin",
  WETH: "weth",
  NATIVE: "ethereum"
};
const STALE_MS = 5 * 60_000;
const feedCache = {
  prices: null,
  perps: null,
  fetchedAt: null,
  error: null
};

export async function refreshMarketFeedSnapshot({ assets = SUPPORTED_ASSETS, settlementRail = "arc-testnet", force = false } = {}) {
  if (!force && feedCache.fetchedAt && Date.now() - new Date(feedCache.fetchedAt).getTime() < 30_000) {
    return getMarketFeedSnapshot({ assets, settlementRail });
  }

  const fetchedAt = new Date().toISOString();
  let prices;
  let perps;
  let error = null;

  try {
    prices = await fetchTokenPrices({ assets });
  } catch (err) {
    error = err.message;
    prices = referencePrices({ assets, reason: err.message });
  }

  try {
    perps = await fetchPerpsContext();
  } catch (err) {
    error = error || err.message;
    perps = referencePerpsContext(err.message);
  }

  feedCache.prices = prices;
  feedCache.perps = perps;
  feedCache.fetchedAt = fetchedAt;
  feedCache.error = error;

  const snapshot = getMarketFeedSnapshot({ assets, settlementRail });
  ledger.events.push({
    id: nextEventId(),
    at: fetchedAt,
    type: "market_feeds_refreshed",
    settlementRail,
    freshness: snapshot.freshness.status,
    error
  });
  return snapshot;
}

export function getMarketFeedSnapshot({ assets = SUPPORTED_ASSETS, settlementRail = "arc-testnet" } = {}) {
  const prices = filterPrices(feedCache.prices || referencePrices({ assets, reason: "Market feeds have not been refreshed yet." }), assets);
  const perps = feedCache.perps || referencePerpsContext("Market feeds have not been refreshed yet.");
  const routeSampling = summarizeRouteSampling({ settlementRail });
  const liquidity = liquiditySnapshot(routeSampling);
  const freshness = freshnessStatus({ prices, perps, fetchedAt: feedCache.fetchedAt, error: feedCache.error });
  const regime = detectFeedRegime({ prices, perps, liquidity, freshness });

  return {
    ok: true,
    provider: "bunOS-market-feeds",
    settlementRail,
    assets,
    prices,
    perps,
    routeSampling,
    liquidity,
    freshness,
    regime,
    warnings: feedWarnings({ prices, perps, liquidity, freshness, regime }),
    recommendation: feedRecommendation(regime),
    updatedAt: new Date().toISOString()
  };
}

export function marketFeedForTrade({ fromToken, toToken, settlementRail = "arc-testnet" } = {}) {
  const assets = Array.from(new Set([fromToken || "USDC", toToken || "USDC", ...SUPPORTED_ASSETS].filter(Boolean)));
  const snapshot = getMarketFeedSnapshot({ assets, settlementRail });
  const pair = {
    from: snapshot.prices[normalizeAsset(fromToken || "USDC")] || null,
    to: snapshot.prices[normalizeAsset(toToken || "USDC")] || null
  };
  const warnings = [];
  if (snapshot.regime.status === "stale_data") warnings.push(snapshot.regime.reason);
  if (pair.from && pair.from.freshness !== "fresh" && pair.from.freshness !== "reference") warnings.push(`${pair.from.symbol} price is ${pair.from.freshness}.`);
  if (pair.to && pair.to.freshness !== "fresh" && pair.to.freshness !== "reference") warnings.push(`${pair.to.symbol} price is ${pair.to.freshness}.`);
  if (snapshot.liquidity.status !== "healthy") warnings.push(snapshot.liquidity.reason);

  return {
    ok: true,
    snapshot,
    pair,
    warnings,
    recommendation: warnings.length ? "wait_or_size_down" : "market_context_clear"
  };
}

async function fetchTokenPrices({ assets }) {
  if (!config.defi.liveAdapters && process.env.MARKET_FEEDS_ENABLED !== "1") {
    return referencePrices({ assets, reason: "Set MARKET_FEEDS_ENABLED=1 or DEFI_LIVE_ADAPTERS=1 to fetch external token prices." });
  }

  const ids = Array.from(new Set(assets.map((asset) => COINGECKO_IDS[normalizeAsset(asset)]).filter(Boolean)));
  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_24hr_change", "true");
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `CoinGecko returned ${response.status}`);

  return Object.fromEntries(assets.map((asset) => {
    const symbol = normalizeAsset(asset);
    const id = COINGECKO_IDS[symbol];
    const row = data[id] || {};
    if (!Number.isFinite(Number(row.usd))) {
      return [symbol, priceUnavailable(symbol, "CoinGecko did not return a USD price.")];
    }
    return [symbol, {
      symbol,
      priceUsd: round(Number(row.usd), symbol === "cirBTC" ? 2 : 6),
      change24hPct: Number.isFinite(Number(row.usd_24h_change)) ? round(Number(row.usd_24h_change), 4) : null,
      source: "coingecko",
      freshness: "fresh",
      fetchedAt: new Date().toISOString()
    }];
  }));
}

async function fetchPerpsContext() {
  const markets = await listHyperliquidMarkets({ limit: 20 });
  const marketRows = (markets.markets || []).map((market) => ({
    symbol: market.symbol,
    markPrice: numericOrNull(market.markPrice || market.mid),
    mid: numericOrNull(market.mid),
    funding: numericOrNull(market.funding),
    openInterest: numericOrNull(market.openInterest),
    maxLeverage: market.maxLeverage || null,
    volatilityProxy: numericOrNull(market.volatilityProxy),
    dataAvailability: {
      funding: market.funding === null || market.funding === undefined ? "unavailable" : "available",
      openInterest: market.openInterest === null || market.openInterest === undefined ? "unavailable" : "available",
      volatilityProxy: market.volatilityProxy === null || market.volatilityProxy === undefined ? "unavailable" : "available"
    }
  }));
  return {
    provider: markets.provider,
    mode: markets.mode,
    freshness: markets.freshness || (markets.mode === "live" ? "fresh" : "stale_reference"),
    fetchedAt: markets.fetchedAt || null,
    markets: marketRows
  };
}

function referencePrices({ assets, reason }) {
  return Object.fromEntries(assets.map((asset) => {
    const symbol = normalizeAsset(asset);
    if (symbol === "USDC" || symbol === "EURC") {
      return [symbol, {
        symbol,
        priceUsd: 1,
        change24hPct: null,
        source: "stablecoin_reference",
        freshness: "reference",
        fetchedAt: null,
        reason
      }];
    }
    return [symbol, priceUnavailable(symbol, reason)];
  }));
}

function referencePerpsContext(reason) {
  return {
    provider: "hyperliquid",
    mode: "unavailable",
    freshness: "stale_data",
    fetchedAt: null,
    reason,
    markets: []
  };
}

function summarizeRouteSampling({ settlementRail }) {
  const actions = ledger.defiActions
    .filter((action) => !settlementRail || action.request?.fromRail === settlementRail || action.request?.toRail === settlementRail)
    .slice()
    .reverse()
    .slice(0, 30);
  const samples = actions.map((action) => ({
    id: action.id,
    type: action.type,
    route: `${action.request?.fromToken || "USDC"}:${action.request?.fromRail || "unknown"}->${action.request?.toToken || "USDC"}:${action.request?.toRail || action.request?.fromRail || "unknown"}`,
    status: action.status,
    quoteProvider: action.quote?.provider || action.protocol || null,
    feeRatio: Number.isFinite(Number(action.simulation?.feeRatio)) ? Number(action.simulation.feeRatio) : null,
    sampledAt: action.completedAt || action.failedAt || action.createdAt || null
  }));
  const unavailable = samples.filter((sample) => ["quote_unavailable", "failed", "rejected"].includes(String(sample.status).toLowerCase())).length;
  const highFee = samples.filter((sample) => Number(sample.feeRatio || 0) >= 0.15).length;
  return {
    sampleCount: samples.length,
    unavailableCount: unavailable,
    highFeeCount: highFee,
    lastSampleAt: samples[0]?.sampledAt || null,
    samples: samples.slice(0, 8)
  };
}

function liquiditySnapshot(routeSampling) {
  if (routeSampling.sampleCount === 0) {
    return {
      status: "unknown",
      reason: "No recent route samples are available."
    };
  }
  if (routeSampling.unavailableCount / routeSampling.sampleCount >= 0.4) {
    return {
      status: "low_liquidity",
      reason: "Recent route samples show repeated quote unavailability."
    };
  }
  if (routeSampling.highFeeCount >= 2) {
    return {
      status: "high_fee",
      reason: "Recent route samples show elevated fee ratios."
    };
  }
  return {
    status: "healthy",
    reason: "Recent sampled routes are not showing broad liquidity failures."
  };
}

function freshnessStatus({ prices, perps, fetchedAt, error }) {
  const stale = !fetchedAt || Date.now() - new Date(fetchedAt).getTime() > STALE_MS;
  const unavailablePrices = Object.values(prices).filter((price) => price.freshness === "unavailable").length;
  const stalePrices = Object.values(prices).filter((price) => price.freshness === "stale_data").length;
  const status = error || stale || stalePrices || unavailablePrices || perps.freshness === "stale_data"
    ? "stale_data"
    : "fresh";
  return {
    status,
    fetchedAt,
    maxAgeMs: STALE_MS,
    unavailablePrices,
    stalePrices,
    error,
    reason: status === "fresh"
      ? "External market data is fresh."
      : error || "One or more market feeds are stale or unavailable."
  };
}

function detectFeedRegime({ prices, perps, liquidity, freshness }) {
  if (freshness.status !== "fresh" && Object.values(prices).some((price) => price.freshness === "unavailable")) {
    return { status: "stale_data", reason: freshness.reason };
  }
  if (liquidity.status === "low_liquidity") return { status: "low_liquidity", reason: liquidity.reason };
  if (liquidity.status === "high_fee") return { status: "high_fee", reason: liquidity.reason };
  const highVol = Object.values(prices).find((price) => Math.abs(Number(price.change24hPct || 0)) >= 8)
    || perps.markets?.find((market) => Number(market.volatilityProxy || 0) >= 0.03);
  if (highVol) return { status: "high_volatility", reason: "Market feed shows elevated 24h move or perp volatility proxy." };
  const btc = prices.cirBTC || prices.BTC;
  if (Number(btc?.change24hPct || 0) > 2) return { status: "risk_on", reason: "BTC proxy is positive and route sampling is not degraded." };
  if (Number(btc?.change24hPct || 0) < -2) return { status: "risk_off", reason: "BTC proxy is negative; reduce leverage and avoid forced entries." };
  return { status: freshness.status === "fresh" ? "neutral" : "stale_data", reason: freshness.status === "fresh" ? "Feeds are available without a strong directional signal." : freshness.reason };
}

function feedWarnings({ prices, perps, liquidity, freshness, regime }) {
  const warnings = [];
  if (freshness.status !== "fresh") warnings.push(freshness.reason);
  if (liquidity.status !== "healthy" && liquidity.status !== "unknown") warnings.push(liquidity.reason);
  for (const price of Object.values(prices)) {
    if (price.freshness === "unavailable") warnings.push(`${price.symbol} price unavailable: ${price.reason}`);
  }
  if (perps.freshness !== "fresh") warnings.push("Perps feed is not fresh; funding/open-interest may be unavailable.");
  if (regime.status === "high_volatility") warnings.push(regime.reason);
  return Array.from(new Set(warnings)).slice(0, 6);
}

function feedRecommendation(regime) {
  if (regime.status === "stale_data") return "wait_for_fresh_market_data";
  if (regime.status === "low_liquidity") return "avoid_thin_routes";
  if (regime.status === "high_fee") return "avoid_small_trades";
  if (regime.status === "high_volatility") return "reduce_size_or_wait";
  if (regime.status === "risk_off") return "reduce_risk";
  if (regime.status === "risk_on") return "trade_with_policy_limits";
  return "monitor";
}

function filterPrices(prices, assets) {
  const result = {};
  for (const asset of assets) {
    const symbol = normalizeAsset(asset);
    result[symbol] = prices[symbol] || priceUnavailable(symbol, "No price entry in current feed snapshot.");
  }
  return result;
}

function priceUnavailable(symbol, reason) {
  return {
    symbol,
    priceUsd: null,
    change24hPct: null,
    source: "unavailable",
    freshness: "unavailable",
    fetchedAt: null,
    reason
  };
}

function normalizeAsset(asset) {
  const value = String(asset || "").trim();
  if (value.toUpperCase() === "CIRBTC" || value === "cirBTC") return "cirBTC";
  if (value.toUpperCase() === "ETH") return "WETH";
  return value.toUpperCase();
}

function numericOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(Number(value || 0) * factor) / factor;
}
