import { config } from "./config.js";

const STABLE_TOKENS = new Set(["USDC", "EURC", "USDT"]);
const DEFAULT_DEFI_ASSETS = ["USDC", "EURC", "cirBTC", "WETH", "ETH", "NATIVE"];

export function userDefiPolicy(user = {}) {
  const policy = user.policy || {};
  const defi = policy.defi || {};
  return {
    maxTradeUsd: Number(defi.maxTradeUsd || policy.maxPerPayment || config.defi.maxActionUsd),
    maxSlippage: Number(defi.maxSlippage ?? config.defi.maxSlippage),
    allowedAssets: normalizeAssetList(defi.allowedAssets || policy.allowedDeFiAssets || DEFAULT_DEFI_ASSETS),
    allowedRails: defi.allowedRails || policy.allowedSettlementRails || config.settlement.supportedRails,
    minPostTradeStableUsd: Number(defi.minPostTradeStableUsd ?? 0.25),
    warnFeeRatio: Number(defi.warnFeeRatio ?? 0.15),
    blockFeeRatio: Number(defi.blockFeeRatio ?? 0.85),
    smallBridgeUsd: Number(defi.smallBridgeUsd ?? 2)
  };
}

export function buildTradeSimulation({ user, wallet, action, quote = null, providerError = null } = {}) {
  const policy = userDefiPolicy(user);
  const amount = Number(action?.amountUsd || action?.amount || 0);
  const fromToken = normalizeToken(action?.fromToken || "USDC");
  const toToken = normalizeToken(action?.toToken || fromToken);
  const fromRail = action?.fromRail || action?.settlementRail || "arc-testnet";
  const toRail = action?.toRail || fromRail;
  const source = sourceTokenBalance({ wallet, rail: fromRail, token: fromToken });
  const fees = estimateRouteFees({ action, quote, fromToken });
  const feeUsd = fees.estimatedFeeUsd;
  const requiredSourceAmount = requiredSource({ action, amount, fromToken, sourceTokenFee: fees.sourceTokenFeeAmount });
  const output = estimateOutput({ action, quote, toToken });
  const postTradeSourceBalance = source.known
    ? round(Math.max(0, Number(source.amount || 0) - requiredSourceAmount))
    : null;
  const feeRatioBaseUsd = STABLE_TOKENS.has(tokenKey(fromToken))
    ? amount
    : Number(action?.notionalUsd || action?.valueUsd || 0);
  const feeRatio = feeRatioBaseUsd > 0 ? round(feeUsd / feeRatioBaseUsd, 6) : 0;
  const slippage = Number(action?.slippage ?? 0.005);
  const warnings = [];
  const blockers = [];

  if (!source.known) {
    warnings.push(`${fromToken} balance on ${fromRail} is not synced locally; the provider may still reject the route.`);
  } else if (Number(source.amount || 0) < requiredSourceAmount) {
    blockers.push(`Insufficient ${fromToken} balance on ${fromRail}: need about ${formatAmount(requiredSourceAmount)} ${fromToken}, available ${formatAmount(source.amount)} ${fromToken}.`);
  }

  if (action?.type === "bridge" && amount > 0 && amount <= policy.smallBridgeUsd) {
    warnings.push("Small bridges can be uneconomical because bridge, forwarder, or gas fees can be large relative to the amount.");
  }

  if (feeRatio >= policy.warnFeeRatio) {
    warnings.push(`Estimated route fees are about ${(feeRatio * 100).toFixed(1)}% of the trade amount.`);
  }

  if (feeRatio >= policy.blockFeeRatio) {
    blockers.push(`Estimated route fees are too high for this policy: ${(feeRatio * 100).toFixed(1)}% of the trade amount.`);
  }

  if (source.known && STABLE_TOKENS.has(tokenKey(fromToken)) && postTradeSourceBalance < policy.minPostTradeStableUsd) {
    warnings.push(`Post-trade ${fromToken} balance on ${fromRail} would be about ${formatAmount(postTradeSourceBalance)}.`);
  }

  if (slippage > policy.maxSlippage * 0.8 && slippage <= policy.maxSlippage) {
    warnings.push(`Requested slippage is close to your max policy: ${(slippage * 100).toFixed(2)}%.`);
  }

  if (providerError) {
    warnings.push(`Provider could not return a quote: ${providerError.message || providerError}`);
  }

  return {
    ok: blockers.length === 0,
    type: action?.type || "trade",
    route: {
      fromRail,
      toRail,
      fromToken,
      toToken
    },
    amount,
    sourceBalance: {
      known: source.known,
      amount: source.known ? round(source.amount) : null,
      token: fromToken,
      rail: fromRail
    },
    requiredSourceAmount: round(requiredSourceAmount),
    estimatedFeeUsd: round(feeUsd),
    sourceTokenFeeAmount: round(fees.sourceTokenFeeAmount),
    feeBreakdown: fees.breakdown,
    feeRatio,
    output,
    slippage,
    slippageBps: Math.round(slippage * 10_000),
    maxSlippage: policy.maxSlippage,
    postTradeSourceBalance,
    warnings: unique(warnings),
    blockers: unique(blockers),
    recommendation: recommendation({ blockers, warnings, action, feeRatio })
  };
}

export function describeSimulation(simulation) {
  if (!simulation) return null;
  if (simulation.blockers?.length) return simulation.blockers[0];
  if (simulation.warnings?.length) return simulation.warnings[0];
  return "Trade simulation passed balance, fee, route, and slippage checks.";
}

function recommendation({ blockers, warnings, action, feeRatio }) {
  if (blockers.length) return "do_not_execute";
  if (action?.type === "bridge" && (feeRatio >= 0.15 || Number(action.amountUsd || action.amount || 0) <= 2)) {
    return "route_is_possible_but_uneconomical";
  }
  if (warnings.length) return "execute_with_caution";
  return "execute";
}

function sourceTokenBalance({ wallet, rail, token }) {
  const normalized = tokenKey(token);
  const tokenBalances = Array.isArray(wallet?.tokenBalances?.[rail]) ? wallet.tokenBalances[rail] : [];
  const match = tokenBalances.find((item) => tokenKey(item.symbol) === normalized);

  if (match) {
    return { known: true, amount: Number(match.amount || 0), source: "tokenBalances" };
  }

  if (normalized === "USDC" && wallet?.balances?.[rail] !== undefined) {
    return { known: true, amount: Number(wallet.balances[rail] || 0), source: "railBalance" };
  }

  return { known: false, amount: 0, source: "unknown" };
}

function requiredSource({ action, amount, fromToken, sourceTokenFee }) {
  if (action?.type === "bridge" && STABLE_TOKENS.has(tokenKey(fromToken))) {
    return amount + sourceTokenFee;
  }
  return amount;
}

function estimateRouteFees({ action, quote, fromToken }) {
  let sourceTokenFeeAmount = sourceTokenFeesFromQuote({ quote, fromToken });
  const estimatedFeeUsd = estimateFeeUsd({ action, quote, sourceTokenFeeAmount, fromToken });
  if (action?.type === "bridge" && sourceTokenFeeAmount === 0 && STABLE_TOKENS.has(tokenKey(fromToken)) && estimatedFeeUsd > 0) {
    sourceTokenFeeAmount = estimatedFeeUsd;
  }
  return {
    estimatedFeeUsd,
    sourceTokenFeeAmount,
    breakdown: {
      sourceTokenFeeAmount: round(sourceTokenFeeAmount),
      sourceToken: normalizeToken(fromToken),
      estimatedFeeUsd: round(estimatedFeeUsd),
      note: "Raw gas units are excluded from source-token balance requirements."
    }
  };
}

function estimateFeeUsd({ action, quote, sourceTokenFeeAmount = 0, fromToken }) {
  const quotedFee = firstFiniteNumber([
    quote?.estimate?.gasCostUSD,
    quote?.estimate?.gasCostUsd,
    quote?.estimate?.feeUsd,
    quote?.estimate?.feeUSD,
    quote?.raw?.estimate?.gasCosts?.[0]?.amountUSD
  ]);

  if (quotedFee !== null) {
    return action?.type === "bridge" ? Math.max(quotedFee, 0.15) : quotedFee;
  }
  if (quote?.estimate) {
    const nested = findNestedUsdFee(quote.estimate);
    if (nested !== null) return action?.type === "bridge" ? Math.max(nested, 0.15) : nested;
  }

  if (STABLE_TOKENS.has(tokenKey(fromToken)) && sourceTokenFeeAmount > 0) {
    return action?.type === "bridge" ? Math.max(sourceTokenFeeAmount, 0.15) : sourceTokenFeeAmount;
  }

  if (action?.type === "bridge") return 0.15;
  return 0;
}

function estimateOutput({ action, quote, toToken }) {
  const estimate = quote?.estimate || {};
  const rawToAmount = estimate.toAmount || estimate.amountOut || estimate.outputAmount || null;
  const rawMin = estimate.toAmountMin || estimate.minAmountOut || null;
  const decimals = tokenDecimals(toToken);
  const amount = rawToAmount ? tokenUnitsToAmount(rawToAmount, decimals) : fallbackOutputAmount(action);
  const minAmount = rawMin ? tokenUnitsToAmount(rawMin, decimals) : null;

  return {
    token: toToken,
    amount,
    minAmount,
    rawAmount: rawToAmount,
    rawMinAmount: rawMin,
    durationSeconds: Number(estimate.executionDurationSeconds || estimate.executionDuration || 0) || null,
    tool: estimate.tool || null
  };
}

function fallbackOutputAmount(action) {
  const from = tokenKey(action?.fromToken);
  const to = tokenKey(action?.toToken);
  if (STABLE_TOKENS.has(from) && STABLE_TOKENS.has(to)) return round(Number(action?.amountUsd || action?.amount || 0));
  return null;
}

function tokenUnitsToAmount(value, decimals) {
  const raw = String(value || "");
  if (!/^\d+$/.test(raw)) return Number(raw) || null;
  const divisor = 10 ** decimals;
  return round(Number(raw) / divisor, decimals === 8 ? 8 : 6);
}

function tokenDecimals(token) {
  const key = tokenKey(token);
  if (key === "CIRBTC" || key === "WBTC") return 8;
  if (key === "WETH" || key === "ETH" || key === "NATIVE") return 18;
  return 6;
}

function firstFiniteNumber(values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function findNestedUsdFee(value) {
  if (!value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value)) {
    if (/amountUSD|amountUsd|feeUSD|feeUsd|gasCostUSD|gasCostUsd|usd$/i.test(key)) {
      const number = Number(item);
      if (Number.isFinite(number) && number >= 0) return number;
    }
    if (item && typeof item === "object" && /fee|cost/i.test(key)) {
      const number = Number(item.amountUSD ?? item.amountUsd ?? item.usd);
      if (Number.isFinite(number) && number >= 0) return number;
    }
    if (item && typeof item === "object") {
      const nested = findNestedUsdFee(item);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function sourceTokenFeesFromQuote({ quote, fromToken }) {
  const estimate = quote?.estimate || quote?.raw?.estimate || quote || {};
  const fees = collectFeeObjects(estimate);
  return fees.reduce((sum, fee) => {
    const symbol = feeTokenSymbol(fee);
    if (tokenKey(symbol) !== tokenKey(fromToken)) return sum;
    const amount = feeAmount(fee);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);
}

function collectFeeObjects(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectFeeObjects(item, output));
    return output;
  }

  if (looksLikeTokenFee(value)) {
    output.push(value);
  }

  for (const [key, item] of Object.entries(value)) {
    if (key === "gas" || key === "gasLimit" || key === "gasPrice") continue;
    if (item && typeof item === "object") collectFeeObjects(item, output);
  }
  return output;
}

function looksLikeTokenFee(value) {
  if (!value || typeof value !== "object") return false;
  if (!feeTokenSymbol(value)) return false;
  return firstFiniteNumber([
    value.amount,
    value.fee,
    value.cost,
    value.value
  ]) !== null;
}

function feeTokenSymbol(value) {
  const token = value.token || value.asset || value.currency || value.denomination;
  if (typeof token === "string") return token;
  return token?.symbol || token?.ticker || token?.name || value.tokenSymbol || value.symbol || null;
}

function feeAmount(value) {
  const raw = firstFiniteNumber([
    value.amount,
    value.fee,
    value.cost,
    value.value
  ]);
  if (raw === null) return 0;

  const decimals = Number(value.decimals ?? value.token?.decimals);
  const rawText = String(value.amount ?? value.fee ?? value.cost ?? value.value ?? "");
  if (Number.isInteger(decimals) && decimals > 0 && /^\d+$/.test(rawText) && raw >= 10 ** Math.min(decimals, 6)) {
    return tokenUnitsToAmount(rawText, decimals);
  }
  return raw;
}

function normalizeAssetList(values) {
  return values.map(normalizeToken);
}

function normalizeToken(token) {
  const value = String(token || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(value)) return value;
  if (value.toUpperCase() === "CIRBTC") return "cirBTC";
  return value.toUpperCase();
}

function tokenKey(token) {
  return String(token || "").toUpperCase();
}

function round(value, decimals = 6) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function formatAmount(value) {
  return Number(value || 0).toFixed(Number(value || 0) < 1 ? 4 : 2).replace(/\.?0+$/, "");
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
