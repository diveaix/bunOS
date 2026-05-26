import { config } from "./config.js";

export async function listHyperliquidMarkets({ limit = 20 } = {}) {
  if (!config.defi.liveAdapters) {
    return {
      ok: true,
      mode: "mock",
      provider: "hyperliquid",
      markets: [
        { symbol: "BTC", mid: "100000", openInterest: null },
        { symbol: "ETH", mid: "3500", openInterest: null }
      ].slice(0, Number(limit) || 20)
    };
  }

  const [mids, meta] = await Promise.all([
    postInfo({ type: "allMids" }),
    postInfo({ type: "meta" })
  ]);
  const universe = meta?.universe || [];
  const markets = Object.entries(mids || {})
    .slice(0, Number(limit) || 20)
    .map(([symbol, mid]) => ({
      symbol,
      mid,
      maxLeverage: universe.find((item) => item.name === symbol)?.maxLeverage || null,
      onlyIsolated: universe.find((item) => item.name === symbol)?.onlyIsolated || false
    }));

  return {
    ok: true,
    mode: "live",
    provider: "hyperliquid",
    markets
  };
}

async function postInfo(body) {
  const response = await fetch(config.defi.hyperliquidInfoUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.message || data?.error || "Hyperliquid info request failed");
  }

  return data;
}
