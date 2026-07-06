import { config } from "./config.js";

export async function searchPolymarketMarkets({ query = "", limit = 10 } = {}) {
  if (!config.defi.liveAdapters) {
    return {
      ok: true,
      mode: "mock",
      provider: "polymarket",
      markets: [
        {
          id: "poly_mock_001",
          question: query ? `Mock market for ${query}` : "Will BTC be above $100k at year end?",
          active: true,
          closed: false,
          volume: "1000000",
          outcomes: ["Yes", "No"],
          outcomePrices: ["0.50", "0.50"]
        }
      ]
    };
  }

  const url = new URL(`${config.defi.polymarketGammaUrl}/markets`);
  url.searchParams.set("active", "true");
  url.searchParams.set("closed", "false");
  url.searchParams.set("limit", String(Math.min(Number(limit) || 10, 50)));
  if (query) {
    url.searchParams.set("q", query);
  }

  const markets = await fetchJson(url);
  return {
    ok: true,
    mode: "live",
    provider: "polymarket",
    markets: (Array.isArray(markets) ? markets : markets.data || []).map(toMarketSummary)
  };
}

function toMarketSummary(market) {
  return {
    id: market.id || market.conditionId || market.slug,
    slug: market.slug,
    question: market.question || market.title,
    active: Boolean(market.active),
    closed: Boolean(market.closed),
    volume: market.volume || market.volumeNum || null,
    liquidity: market.liquidity || market.liquidityNum || null,
    outcomes: parseMaybeJson(market.outcomes),
    outcomePrices: parseMaybeJson(market.outcomePrices),
    clobTokenIds: parseMaybeJson(market.clobTokenIds)
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.message || data?.error || "Polymarket market search failed");
  }

  return data;
}

function parseMaybeJson(value) {
  if (!value || Array.isArray(value)) {
    return value || [];
  }

  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
