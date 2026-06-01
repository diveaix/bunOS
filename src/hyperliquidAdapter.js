import { config } from "./config.js";

export async function listHyperliquidMarkets({ limit = 20 } = {}) {
  if (!config.defi.liveAdapters) {
    return {
      ok: true,
      mode: "reference",
      provider: "hyperliquid",
      freshness: "stale_reference",
      fetchedAt: null,
      markets: [
        { symbol: "BTC", mid: "100000", markPrice: "100000", openInterest: null, funding: null, volatilityProxy: null },
        { symbol: "ETH", mid: "3500", markPrice: "3500", openInterest: null, funding: null, volatilityProxy: null }
      ].slice(0, Number(limit) || 20)
    };
  }

  const [mids, meta, metaAndAssetCtxs] = await Promise.all([
    postInfo({ type: "allMids" }),
    postInfo({ type: "meta" }),
    postInfo({ type: "metaAndAssetCtxs" }).catch(() => null)
  ]);
  const ctxMeta = Array.isArray(metaAndAssetCtxs) ? metaAndAssetCtxs[0] : null;
  const assetCtxs = Array.isArray(metaAndAssetCtxs) ? metaAndAssetCtxs[1] || [] : [];
  const universe = ctxMeta?.universe || meta?.universe || [];
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
      const assetIndex = universe.findIndex((item) => item.name === symbol);
      const metaItem = universe[assetIndex];
      const ctx = assetCtxs[assetIndex] || {};
      const markPrice = ctx.markPx || midsBySymbol[symbol] || null;
      return {
        symbol,
        mid: midsBySymbol[symbol],
        markPrice,
        openInterest: numericOrNull(ctx.openInterest),
        funding: numericOrNull(ctx.funding),
        premium: numericOrNull(ctx.premium),
        volatilityProxy: volatilityProxy(ctx, markPrice),
        maxLeverage: metaItem?.maxLeverage || null,
        onlyIsolated: metaItem?.onlyIsolated || false
      };
    });

  return {
    ok: true,
    mode: "live",
    provider: "hyperliquid",
    freshness: "fresh",
    fetchedAt: new Date().toISOString(),
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

function numericOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function volatilityProxy(ctx, markPrice) {
  const mark = Number(markPrice || 0);
  const previous = Number(ctx.prevDayPx || ctx.prevDayPrice || ctx.dayNtlVlm || 0);
  if (mark > 0 && previous > 0 && previous < mark * 10) {
    return Math.abs(mark - previous) / previous;
  }
  const premium = Math.abs(Number(ctx.premium || 0));
  return Number.isFinite(premium) ? premium : null;
}
