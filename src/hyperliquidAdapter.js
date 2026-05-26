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
  const midsBySymbol = mids || {};
  const orderedSymbols = [
    ...universe.map((item) => item.name),
    ...Object.keys(midsBySymbol)
  ];
  const seen = new Set();
  const markets = orderedSymbols
    .filter((symbol) => {
      if (!symbol || seen.has(symbol) || midsBySymbol[symbol] === undefined) return false;
      seen.add(symbol);
      return true;
    })
    .filter((symbol) => !String(symbol).startsWith("#"))
    .slice(0, Number(limit) || 20)
    .map((symbol) => {
      const metaItem = universe.find((item) => item.name === symbol);
      return {
        symbol,
        mid: midsBySymbol[symbol],
        maxLeverage: metaItem?.maxLeverage || null,
        onlyIsolated: metaItem?.onlyIsolated || false
      };
    });

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
