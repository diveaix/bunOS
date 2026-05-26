import { randomUUID } from "node:crypto";
import { circleErrorMessage, getCircleDeveloperClient } from "./circleSdk.js";
import { config, isRealCircleWalletMode } from "./config.js";

export async function provisionCircleWallets({ handle, xUserId, rails }) {
  if (isRealCircleWalletMode()) {
    return provisionRealCircleWallets({ handle, rails });
  }

  return provisionMockCircleWallets({ handle, xUserId, rails });
}

export async function requestCircleTestnetTokens({ address, blockchain, usdc = true, native = true, eurc = false } = {}) {
  if (!address) {
    throw new Error("Circle faucet requires a destination address");
  }

  if (!blockchain) {
    throw new Error("Circle faucet requires a testnet blockchain");
  }

  try {
    await getCircleDeveloperClient().requestTestnetTokens({
      address,
      blockchain,
      usdc,
      native,
      eurc
    });
  } catch (error) {
    if (error.status === 403 || error.code === 3) {
      throw new Error(`Circle faucet request forbidden for ${blockchain}. Check faucet access for this API key or fund ${address} externally.`);
    }
    throw new Error(circleErrorMessage(error, "Circle faucet request failed"));
  }

  return {
    ok: true,
    provider: "circle-faucet",
    address,
    blockchain,
    requested: {
      usdc,
      native,
      eurc
    },
    status: "requested",
    requestedAt: new Date().toISOString()
  };
}

export async function getCircleWalletTokenBalances({ walletId } = {}) {
  if (!walletId) {
    throw new Error("Circle balance sync requires walletId");
  }

  try {
    const response = await getCircleDeveloperClient().getWalletTokenBalance({ id: walletId });
    return response.data?.tokenBalances || response.data?.data?.tokenBalances || [];
  } catch (error) {
    throw new Error(circleErrorMessage(error, "Circle wallet balance sync failed"));
  }
}

export function getCircleReadiness() {
  const hasApiKey = Boolean(config.circle.apiKey);
  const hasEntitySecret = Boolean(config.circle.entitySecret);
  const hasWalletSet = Boolean(config.circle.walletSetId);

  return {
    mode: config.providerMode,
    realWallets: isRealCircleWalletMode(),
    ready: !isRealCircleWalletMode() || (hasApiKey && hasEntitySecret && hasWalletSet),
    hasApiKey,
    hasEntitySecret,
    hasWalletSet,
    message: isRealCircleWalletMode()
      ? "Circle API key, entity secret, and wallet set are required for real wallet creation"
      : "Mock Circle wallet provisioning is active"
  };
}

function provisionMockCircleWallets({ handle, xUserId, rails }) {
  const walletSetId = config.circle.walletSetId || `wset_${stableId(handle)}`;
  const evmAddress = `0x${stableId(`${handle}:${xUserId}`).padEnd(40, "0").slice(0, 40)}`;

  return {
    provider: "circle",
    mode: "mock",
    walletSetId,
    wallets: rails.map((rail) => ({
      id: `wallet_${rail.circleBlockchain.toLowerCase()}_${stableId(handle).slice(0, 10)}`,
      blockchain: rail.circleBlockchain,
      rail: rail.id,
      address: evmAddress,
      custody: "developer-controlled"
    }))
  };
}

async function provisionRealCircleWallets({ handle, rails }) {
  if (!config.circle.apiKey || !config.circle.entitySecret) {
    throw new Error("Circle real mode requires CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET");
  }

  if (!config.circle.walletSetId) {
    throw new Error("Circle real mode requires CIRCLE_WALLET_SET_ID for this prototype");
  }

  let response;
  try {
    response = await getCircleDeveloperClient().createWallets({
      idempotencyKey: randomUUID(),
      walletSetId: config.circle.walletSetId,
      blockchains: rails.map((rail) => rail.circleBlockchain),
      accountType: "EOA",
      count: 1,
      metadata: [{ name: `${handle} ArcPay wallet` }]
    });
  } catch (error) {
    throw new Error(circleErrorMessage(error, "Circle wallet creation failed"));
  }

  const data = response.data || response;
  return {
    provider: "circle",
    mode: "real",
    walletSetId: config.circle.walletSetId,
    wallets: (data.data?.wallets || data.wallets || []).map((wallet) => ({
      id: wallet.id,
      blockchain: wallet.blockchain,
      rail: rails.find((rail) => rail.circleBlockchain === wallet.blockchain)?.id,
      address: wallet.address,
      custody: "developer-controlled"
    }))
  };
}

function stableId(value) {
  return Buffer.from(String(value).toLowerCase()).toString("hex");
}
