import { ledger, users } from "./fixtures.js";
import {
  getCircleWalletTokenBalances,
  provisionCircleWallets,
  requestCircleTestnetTokens
} from "./circleProvider.js";
import { config, isRealCircleWalletMode, isRealProviderMode } from "./config.js";
import { nextEventId } from "./ids.js";
import { normalizeHandle, resolveXHandle } from "./identity.js";
import { getSettlementRail, listSettlementRails } from "./settlement.js";
import { circleUserSigner, userWalletSigningRequired } from "./signerPolicy.js";

export function listWalletProfiles() {
  return Array.from(users.values())
    .filter((user) => !isRealProviderMode() || isRealUserWallet(user))
    .map(toWalletProfile);
}

export function getWalletProfile(handle) {
  return toWalletProfile(readableUser(resolveXHandle(handle)));
}

export function getWalletCapabilities(handle) {
  const user = readableUser(resolveXHandle(handle));
  const wallet = toWalletProfile(user);
  const defiExecutionConfigured = Boolean(config.defi.executionEnabled && config.defi.liveAdapters && isRealCircleWalletMode());
  const rails = listSettlementRails().map((rail) => {
    const railWallet = wallet.wallets.find((item) => item.rail === rail.id);
    return {
      rail: rail.id,
      label: rail.label,
      mode: rail.mode,
      circleBlockchain: rail.circleBlockchain,
      walletId: railWallet?.id || null,
      address: railWallet?.address || null,
      hasUserWallet: Boolean(railWallet?.id && railWallet?.address),
      canReceive: Boolean(railWallet?.address),
      canSendUsdc: Boolean(config.transferProvider === "circle" && railWallet?.id && railWallet?.address),
      canRequestFaucet: rail.mode === "testnet" && Boolean(railWallet?.address),
      sendSigner: circleUserSigner({
        operation: "send_usdc",
        settlementRail: rail.id,
        executionStatus: config.transferProvider === "circle" && railWallet?.id ? "configured" : "wallet_required"
      }),
      bridgeSigner: defiExecutionConfigured
        ? circleUserSigner({ operation: "bridge_usdc", settlementRail: rail.id, executionStatus: "configured" })
        : userWalletSigningRequired({ operation: "bridge_usdc", settlementRail: rail.id }),
      swapSigner: defiExecutionConfigured
        ? circleUserSigner({ operation: "swap", settlementRail: rail.id, executionStatus: "configured" })
        : userWalletSigningRequired({ operation: "swap", settlementRail: rail.id }),
      perpsSigner: userWalletSigningRequired({ operation: "open_perp_position", settlementRail: rail.id }),
      bridgeStatus: defiExecutionConfigured ? "circle_contract_execution_configured" : "user_wallet_signing_required",
      swapStatus: defiExecutionConfigured ? "circle_contract_execution_configured" : "user_wallet_signing_required",
      perpsStatus: config.arcPerps.executionEnabled ? "circle_contract_execution_after_confirmation" : "user_wallet_signing_required"
    };
  });

  return {
    ok: true,
    handle: wallet.handle,
    signerModel: "per-user-circle-wallet",
    backendSignerAllowed: false,
    transferProvider: config.transferProvider,
    circleWalletsEnabled: isRealCircleWalletMode(),
    wallet,
    capabilities: {
      createWallet: true,
      syncBalances: wallet.onboarded,
      sendUsdc: config.transferProvider === "circle" && wallet.onboarded,
      requestTestnetUsdc: wallet.onboarded,
      bridgeUsdc: defiExecutionConfigured ? "circle_contract_execution_after_confirmation" : "quote_only_until_user_signing_adapter",
      swap: defiExecutionConfigured ? "circle_contract_execution_after_confirmation" : "quote_only_until_user_signing_adapter",
      perps: config.arcPerps.executionEnabled ? "circle_contract_execution_after_confirmation" : "proposal_only_until_user_signing_adapter",
      appKit: "disabled_until_user_owned_adapter"
    },
    rails
  };
}

export async function createWallet({ handle, settlementRails } = {}) {
  const user = resolveXHandle(handle);
  if (isRealProviderMode() && !isRealUserWallet(user)) {
    clearNonRealWalletState(user);
  }

  const rails = resolveRails(settlementRails);
  const existingWallets = enabledChainWallets(user);
  const missingRails = rails.filter((rail) => !existingWallets.some((wallet) => wallet.rail === rail.id));

  if (!missingRails.length && existingWallets.length) {
    user.chainWallets = existingWallets;
    user.balances = supportedBalances(user.balances || {});
    user.onboarded = true;
    user.walletAddress = existingWallets.find((wallet) => wallet.rail === "arc-testnet")?.address
      || existingWallets[0]?.address
      || user.walletAddress
      || buildWalletAddress(user.handle);
    user.policy ||= defaultPolicy();
    return {
      ok: true,
      wallet: toWalletProfile(user),
      reused: true
    };
  }

  const circle = await provisionCircleWallets({
    handle: user.handle,
    xUserId: user.xUserId,
    rails: missingRails
  });

  user.walletSetId = circle.walletSetId;
  user.chainWallets = mergeChainWallets(existingWallets, circle.wallets);
  user.walletAddress = user.chainWallets.find((wallet) => wallet.rail === "arc-testnet")?.address
    || user.chainWallets[0]?.address
    || buildWalletAddress(user.handle);

  user.onboarded = true;
  user.balance = sumSupportedBalances(user.balances || {});
  user.balances = supportedBalances(user.balances || {});
  user.policy ||= defaultPolicy();

  recordWalletEvent({
    type: "wallet_created",
    handle: user.handle,
    walletAddress: user.walletAddress,
    walletSetId: user.walletSetId,
    rails: user.chainWallets.map((wallet) => wallet.rail)
  });

  return {
    ok: true,
    wallet: toWalletProfile(user)
  };
}

export async function fundWallet({ handle, amount, source = "bank_transfer", settlementRail = "arc-testnet" }) {
  const numericAmount = normalizeAmount(amount);
  const user = resolveXHandle(handle);

  if (!user.onboarded || !user.walletAddress) {
    await createWallet({ handle: user.handle });
  }

  if (isRealCircleWalletMode()) {
    return await fundRealCircleWallet({
      user,
      amount: numericAmount,
      source,
      settlementRail
    });
  }

  user.balances ||= {};
  user.balances[settlementRail] = roundUsd(Number(user.balances[settlementRail] || 0) + numericAmount);
  user.balance = sumSupportedBalances(user.balances);
  const funding = {
    id: `fund_${String(ledger.funding.length + 1).padStart(3, "0")}`,
    handle: user.handle,
    source,
    amount: numericAmount,
    asset: "USDC",
    settlementRail,
    provider: source === "external_wallet" ? "circle-cctp-ready" : "mock-funding",
    status: "settled",
    createdAt: new Date().toISOString(),
    settledAt: new Date().toISOString()
  };
  ledger.funding.push(funding);

  recordWalletEvent({
    type: "wallet_funded",
    source,
    handle: user.handle,
    amount: numericAmount,
    asset: "USDC",
    settlementRail
  });

  return {
    ok: true,
    wallet: toWalletProfile(user),
    funding
  };
}

export async function syncWalletBalances({ handle } = {}) {
  const user = resolveXHandle(handle);
  if (!user.onboarded || !user.chainWallets?.length) {
    throw new Error("Wallet must be created before syncing balances");
  }

  if (!isRealCircleWalletMode()) {
    return {
      ok: true,
      mode: "mock",
      wallet: toWalletProfile(user),
      synced: []
    };
  }

  const synced = [];
  user.balances ||= {};
  user.tokenBalances ||= {};

  for (const wallet of enabledChainWallets(user)) {
    if (!wallet.id || !wallet.rail) continue;
    const rail = getSettlementRail(wallet.rail);
    const tokenBalances = await getCircleWalletTokenBalances({ walletId: wallet.id });
    const normalizedTokens = normalizeTokenBalances(tokenBalances, rail);
    const usdc = findTokenBalance(normalizedTokens, rail, "USDC");
    const amount = usdc ? Number(usdc.amount || 0) : 0;
    user.balances[rail.id] = roundUsd(amount);
    user.tokenBalances[rail.id] = normalizedTokens;
    synced.push({
      rail: rail.id,
      walletId: wallet.id,
      address: wallet.address,
      amount: user.balances[rail.id],
      token: usdc || null,
      tokenBalances: normalizedTokens
    });
  }

  user.balance = sumSupportedTokenBalances(user);
  recordWalletEvent({
    type: "wallet_balances_synced",
    handle: user.handle,
    rails: synced.map((item) => item.rail)
  });

  return {
    ok: true,
    mode: "real",
    wallet: toWalletProfile(user),
    synced
  };
}

export async function bridgeFunds({ handle, amount, fromRail, toRail }) {
  const numericAmount = normalizeAmount(amount);
  const user = resolveXHandle(handle);
  getSettlementRail(fromRail);
  getSettlementRail(toRail);

  if (!user.onboarded || !user.walletAddress) {
    throw new Error("Wallet must be created before bridging funds");
  }

  if (Number(user.balances?.[fromRail] || 0) < numericAmount) {
    throw new Error("Insufficient source rail balance");
  }

  user.balances[fromRail] = roundUsd(Number(user.balances[fromRail] || 0) - numericAmount);
  user.balances[toRail] = roundUsd(Number(user.balances[toRail] || 0) + numericAmount);
  user.balance = sumSupportedBalances(user.balances);

  const bridge = {
    id: `bridge_${String(ledger.bridges.length + 1).padStart(3, "0")}`,
    handle: user.handle,
    amount: numericAmount,
    asset: "USDC",
    fromRail,
    toRail,
    provider: "cctp-ready",
    status: "settled",
    createdAt: new Date().toISOString(),
    settledAt: new Date().toISOString()
  };
  ledger.bridges.push(bridge);

  recordWalletEvent({
    type: "wallet_bridged",
    handle: user.handle,
    amount: numericAmount,
    asset: "USDC",
    fromRail,
    toRail
  });

  return {
    ok: true,
    wallet: toWalletProfile(user),
    bridge
  };
}

export function toWalletProfile(user) {
  const tokenBalances = supportedTokenBalances(user);
  return {
    handle: user.handle,
    xUserId: user.xUserId,
    onboarded: Boolean(user.onboarded && user.walletAddress),
    walletAddress: user.walletAddress,
    balance: sumSupportedTokenBalances({ ...user, tokenBalances }),
    balances: supportedBalances(user.balances || {}),
    tokenBalances,
    asset: "USDC",
    settlementRail: "arc-testnet",
    wallets: enabledChainWallets(user),
    walletSetId: user.walletSetId,
    xConnected: Boolean(user.xOAuth?.connected),
    receiveLabel: `${user.handle} on ArcPay`
  };
}

export function normalizeAmount(amount) {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Amount must be greater than zero");
  }

  return roundUsd(numericAmount);
}

export function roundUsd(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

function buildWalletAddress(handle) {
  const normalized = normalizeHandle(handle).slice(1);
  const hex = Buffer.from(normalized).toString("hex").slice(0, 28).padEnd(28, "0");
  return `0xArc${hex}`;
}

function isRealUserWallet(user) {
  return Boolean(user?.chainWallets?.some((wallet) => isRealChainWallet(wallet, user)));
}

function isRealChainWallet(wallet, user) {
  return Boolean(
    wallet?.id
    && wallet?.address
    && !String(wallet.id).startsWith("wallet_")
    && !String(user?.walletSetId || "").endsWith("_demo")
  );
}

function readableUser(user) {
  if (!isRealProviderMode() || isRealUserWallet(user)) {
    return user;
  }

  return {
    ...user,
    onboarded: false,
    walletAddress: null,
    balance: 0,
    balances: {},
    tokenBalances: {},
    walletSetId: null,
    chainWallets: []
  };
}

function clearNonRealWalletState(user) {
  user.onboarded = false;
  user.walletAddress = null;
  user.balance = 0;
  user.balances = {};
  user.tokenBalances = {};
  user.walletSetId = null;
  user.chainWallets = [];
}

function defaultPolicy() {
  return {
    maxPerPayment: 100,
    maxDaily: 500,
    allowedAssets: ["USDC"],
    allowedSettlementRails: ["arc-testnet", "base-sepolia"],
    requireConfirmationAbove: 50
  };
}

function resolveRails(settlementRails) {
  const enabledRails = listSettlementRails();

  if (!settlementRails?.length) {
    return enabledRails;
  }

  const wanted = new Set(settlementRails);
  return enabledRails.filter((rail) => wanted.has(rail.id));
}

function enabledChainWallets(user) {
  const enabled = new Set(config.settlement.supportedRails);
  return (user.chainWallets || []).filter((wallet) => (
    enabled.has(wallet.rail)
    && (!isRealProviderMode() || isRealChainWallet(wallet, user))
  ));
}

function supportedBalances(balances) {
  return Object.fromEntries(
    config.settlement.supportedRails.map((rail) => [rail, Number(balances[rail] || 0)])
  );
}

function supportedTokenBalances(user) {
  const stored = user.tokenBalances || {};
  return Object.fromEntries(
    config.settlement.supportedRails.map((rail) => {
      const tokens = Array.isArray(stored[rail]) ? stored[rail].map(normalizeStoredTokenBalance).filter(Boolean) : [];
      if (tokens.length) {
        return [rail, sortTokenBalances(tokens)];
      }

      const amount = Number(user.balances?.[rail] || 0);
      return [rail, [{
        symbol: "USDC",
        amount: roundUsd(amount),
        displayAmount: String(roundUsd(amount)),
        tokenAddress: null,
        name: "USD Coin",
        valueUsd: roundUsd(amount),
        isPrimary: true
      }]];
    })
  );
}

function sumSupportedBalances(balances) {
  return roundUsd(Object.values(supportedBalances(balances)).reduce((sum, value) => sum + Number(value || 0), 0));
}

function sumSupportedTokenBalances(user) {
  const tokenBalances = supportedTokenBalances(user);
  return roundUsd(Object.values(tokenBalances).reduce((sum, tokens) => (
    sum + tokens.reduce((railSum, token) => railSum + Number(token.valueUsd || 0), 0)
  ), 0));
}

function mergeChainWallets(existing, incoming) {
  const byRail = new Map(existing.map((wallet) => [wallet.rail, wallet]));
  for (const wallet of incoming) {
    byRail.set(wallet.rail, wallet);
  }

  return Array.from(byRail.values());
}

async function fundRealCircleWallet({ user, amount, source, settlementRail }) {
  const rail = getSettlementRail(settlementRail);
  const wallet = walletForRail(user, settlementRail);
  if (!wallet?.address) {
    throw new Error(`No Circle wallet address found for ${settlementRail}`);
  }

  if (source !== "circle_faucet") {
    const funding = {
      id: `fund_${String(ledger.funding.length + 1).padStart(3, "0")}`,
      handle: user.handle,
      source,
      amount,
      asset: "USDC",
      settlementRail,
      provider: "external-deposit-instruction",
      status: "requires_external_deposit",
      destinationAddress: wallet.address,
      createdAt: new Date().toISOString()
    };
    ledger.funding.push(funding);
    recordWalletEvent({
      type: "wallet_funding_instruction_created",
      source,
      handle: user.handle,
      amount,
      asset: "USDC",
      settlementRail
    });
    return {
      ok: true,
      wallet: toWalletProfile(user),
      funding,
      nextAction: "send_usdc_to_address"
    };
  }

  if (rail.mode !== "testnet") {
    throw new Error("Circle faucet can only fund testnet wallets");
  }

  const faucet = await requestCircleTestnetTokens({
    address: wallet.address,
    blockchain: rail.circleBlockchain,
    usdc: true,
    native: true
  });

  const funding = {
    id: `fund_${String(ledger.funding.length + 1).padStart(3, "0")}`,
    handle: user.handle,
    source,
    amount,
    asset: "USDC",
    settlementRail,
    provider: "circle-faucet",
    status: "requested",
    destinationAddress: wallet.address,
    createdAt: new Date().toISOString(),
    requestedAt: faucet.requestedAt
  };
  ledger.funding.push(funding);
  recordWalletEvent({
    type: "wallet_faucet_requested",
    source,
    handle: user.handle,
    amount,
    asset: "USDC",
    settlementRail
  });

  const synced = await syncWalletBalances({ handle: user.handle }).catch((error) => ({
    ok: false,
    error: error.message
  }));

  return {
    ok: true,
    wallet: toWalletProfile(user),
    funding,
    faucet,
    synced,
    nextAction: "wait_for_circle_faucet"
  };
}

function normalizeTokenBalances(tokenBalances, rail) {
  return sortTokenBalances(dedupeTokenBalances((tokenBalances || [])
    .map((balance) => normalizeCircleTokenBalance(balance, rail))
    .filter(Boolean)));
}

function normalizeCircleTokenBalance(balance, rail) {
  const token = balance.token || {};
  const symbol = normalizeTokenSymbol(token.symbol || balance.symbol || "");
  const amount = roundUsd(Number(balance.amount || balance.balance || 0));
  if (!symbol || amount <= 0) return null;
  const tokenAddress = token.tokenAddress || token.address || balance.tokenAddress || null;
  return {
    symbol,
    amount,
    displayAmount: String(balance.amount || amount),
    tokenAddress,
    name: token.name || balance.name || symbol,
    standard: token.standard || balance.standard || null,
    decimals: token.decimals ?? balance.decimals ?? null,
    valueUsd: stableUsdValue(symbol, amount),
    isPrimary: symbol === "USDC" && tokenMatchesRail(tokenAddress, rail.usdcAddress)
  };
}

function normalizeStoredTokenBalance(token) {
  const symbol = normalizeTokenSymbol(token.symbol || "");
  const amount = roundUsd(Number(token.amount || 0));
  if (!symbol) return null;
  return {
    ...token,
    symbol,
    amount,
    displayAmount: String(token.displayAmount || amount),
    valueUsd: token.valueUsd === null || token.valueUsd === undefined
      ? stableUsdValue(symbol, amount)
      : roundUsd(Number(token.valueUsd || 0))
  };
}

function findTokenBalance(tokenBalances, rail, symbol) {
  const expectedSymbol = String(symbol || "").toUpperCase();
  const expectedAddress = expectedSymbol === "USDC" ? rail.usdcAddress?.toLowerCase() : null;
  return tokenBalances.find((balance) => (
    balance.symbol === expectedSymbol
    || (expectedAddress && balance.tokenAddress?.toLowerCase() === expectedAddress)
  ));
}

function stableUsdValue(symbol, amount) {
  return ["USDC", "EURC"].includes(tokenKey(symbol)) ? roundUsd(amount) : null;
}

function tokenMatchesRail(tokenAddress, expectedAddress) {
  if (!tokenAddress || !expectedAddress) return false;
  return tokenAddress.toLowerCase() === expectedAddress.toLowerCase();
}

function sortTokenBalances(tokens) {
  const rank = { USDC: 0, EURC: 1, CIRBTC: 2 };
  return tokens.slice().sort((a, b) => (
    (rank[tokenKey(a.symbol)] ?? 10) - (rank[tokenKey(b.symbol)] ?? 10)
    || Number(b.isPrimary || false) - Number(a.isPrimary || false)
    || String(a.symbol).localeCompare(String(b.symbol))
  ));
}

function dedupeTokenBalances(tokens) {
  const byKey = new Map();
  for (const token of tokens) {
    const normalizedKey = tokenKey(token.symbol);
    const key = ["USDC", "EURC", "CIRBTC"].includes(normalizedKey)
      ? normalizedKey
      : `${token.symbol}:${String(token.tokenAddress || "").toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, token);
      continue;
    }

    if (token.isPrimary && !existing.isPrimary) {
      byKey.set(key, token);
    } else if (token.isPrimary === existing.isPrimary && Number(token.amount || 0) > Number(existing.amount || 0)) {
      byKey.set(key, token);
    }
  }
  return Array.from(byKey.values());
}

function normalizeTokenSymbol(symbol) {
  const value = String(symbol || "").trim();
  if (value.toUpperCase() === "CIRBTC") return "cirBTC";
  return value.toUpperCase();
}

function tokenKey(symbol) {
  return String(symbol || "").toUpperCase();
}

function walletForRail(user, settlementRail) {
  return user.chainWallets?.find((wallet) => wallet.rail === settlementRail);
}

function recordWalletEvent(event) {
  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    ...event
  });
}
