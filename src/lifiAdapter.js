import { config } from "./config.js";
import { getSettlementRail } from "./settlement.js";

const NATIVE_EVM_TOKEN = "0x0000000000000000000000000000000000000000";
const KNOWN_TOKEN_DECIMALS = {
  USDC: 6,
  EURC: 6,
  USDT: 6,
  WETH: 18,
  ETH: 18,
  NATIVE: 18,
  WBTC: 8,
  CIRBTC: 8
};
const tokenMetadataCache = new Map();

export async function getLifiQuote({
  fromRail,
  toRail,
  fromToken = "USDC",
  toToken = "USDC",
  amount,
  fromAddress,
  toAddress,
  slippage = 0.005
}) {
  const from = getSettlementRail(fromRail);
  const to = getSettlementRail(toRail);
  const fromTokenRef = resolveTokenAddress({ token: fromToken, rail: from });
  const toTokenRef = resolveTokenAddress({ token: toToken, rail: to });
  const fromDecimals = await resolveTokenDecimals({
    token: fromToken,
    tokenRef: fromTokenRef,
    rail: from,
    live: config.defi.liveAdapters
  });
  const fromAmount = toTokenUnits(amount, fromDecimals);

  const request = {
    fromChain: from.chainId,
    toChain: to.chainId,
    fromToken: fromTokenRef,
    toToken: toTokenRef,
    fromAmount,
    fromAddress,
    toAddress: toAddress || fromAddress,
    slippage
  };

  if (!config.defi.liveAdapters) {
    return {
      ok: true,
      mode: "mock",
      provider: "lifi",
      request,
      estimate: {
        fromAmount,
        toAmount: fromAmount,
        tool: fromRail === toRail ? "same-chain-swap-preview" : "bridge-preview",
        gasCostUSD: "0.01",
        executionDurationSeconds: fromRail === toRail ? 20 : 180
      },
      executable: false
    };
  }

  const url = new URL(`${config.defi.lifiBaseUrl}/quote`);
  for (const [key, value] of Object.entries(request)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const data = await fetchJson(url);
  return {
    ok: true,
    mode: "live",
    provider: "lifi",
    request,
    estimate: {
      fromAmount: data.estimate?.fromAmount || data.action?.fromAmount || fromAmount,
      toAmount: data.estimate?.toAmount || null,
      toAmountMin: data.estimate?.toAmountMin || null,
      tool: data.tool || data.includedSteps?.[0]?.tool || null,
      gasCostUSD: data.estimate?.gasCosts?.[0]?.amountUSD || null,
      executionDurationSeconds: data.estimate?.executionDuration || null
    },
    transactionRequest: data.transactionRequest || null,
    executable: Boolean(data.transactionRequest),
    raw: data
  };
}

async function fetchJson(url) {
  const headers = { accept: "application/json" };
  if (config.defi.lifiApiKey) {
    headers["x-lifi-api-key"] = config.defi.lifiApiKey;
  }

  const response = await fetch(url, { headers });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.message || data?.error || "LI.FI quote failed");
  }

  return data;
}

function resolveTokenAddress({ token, rail }) {
  const value = String(token || "USDC").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(value)) return value;

  const symbol = value.toUpperCase();
  if (symbol === "USDC") return rail.usdcAddress;
  if (symbol === "CIRBTC" && rail.cirbtcAddress) return rail.cirbtcAddress;
  if (symbol === "ETH" || symbol === rail.nativeCurrency?.symbol?.toUpperCase()) {
    return NATIVE_EVM_TOKEN;
  }

  return value;
}

async function resolveTokenDecimals({ token, tokenRef, rail, live }) {
  const symbol = String(token || "").trim().toUpperCase();
  if (tokenRef === NATIVE_EVM_TOKEN || symbol === "NATIVE") return 18;
  if (KNOWN_TOKEN_DECIMALS[symbol]) return KNOWN_TOKEN_DECIMALS[symbol];
  if (!live) return 6;

  const metadata = await fetchLifiTokenMetadata({ token, tokenRef, rail }).catch(() => null);
  return Number(metadata?.decimals || 6);
}

async function fetchLifiTokenMetadata({ token, tokenRef, rail }) {
  const cacheKey = `${rail.chainId}:${String(tokenRef || token).toLowerCase()}`;
  if (tokenMetadataCache.has(cacheKey)) return tokenMetadataCache.get(cacheKey);

  const url = new URL(`${config.defi.lifiBaseUrl}/tokens`);
  url.searchParams.set("chains", String(rail.chainId));
  const data = await fetchJson(url);
  const tokens = data.tokens?.[rail.chainId] || data.tokens?.[String(rail.chainId)] || [];
  const wantedAddress = String(tokenRef || "").toLowerCase();
  const wantedSymbol = String(token || tokenRef || "").toUpperCase();
  const match = tokens.find((item) => (
    String(item.address || "").toLowerCase() === wantedAddress
    || String(item.symbol || "").toUpperCase() === wantedSymbol
  )) || null;

  tokenMetadataCache.set(cacheKey, match);
  return match;
}

function toTokenUnits(amount, decimals) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Amount must be greater than zero");
  }

  return String(Math.round(numeric * 10 ** decimals));
}
