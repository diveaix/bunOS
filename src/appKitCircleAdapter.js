import { randomUUID } from "node:crypto";
import { AppKit } from "@circle-fin/app-kit";
import { ViemAdapter } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { config } from "./config.js";
import { circleErrorMessage, getCircleDeveloperClient } from "./circleSdk.js";
import { getSettlementRail, listSettlementRails } from "./settlement.js";
import { getWalletProfile } from "./walletAccounts.js";

const FINAL_STATES = new Set(["COMPLETE", "CONFIRMED", "MINED"]);
const FAILED_STATES = new Set(["FAILED", "CANCELLED", "DENIED"]);
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 120_000;

export function getCircleAppKitReadiness() {
  const hasCircle = Boolean(config.circle.apiKey && config.circle.entitySecret && config.circle.walletSetId);
  const rails = listSettlementRails();
  return {
    ok: hasCircle,
    provider: "circle-app-kit",
    mode: "real",
    backendSignerAllowed: false,
    estimateReady: hasCircle,
    executionEnabled: Boolean(config.appKit.executionEnabled),
    executionReady: Boolean(config.appKit.executionEnabled && hasCircle),
    unifiedBalanceEnabled: Boolean(config.appKit.unifiedBalanceEnabled),
    kitKeyConfigured: Boolean(config.appKit.kitKey),
    blockers: [
      ...(!hasCircle ? ["Configure Circle API key, entity secret, and wallet set"] : []),
      ...(!config.appKit.executionEnabled ? ["Set APPKIT_EXECUTION_ENABLED=1 to submit AppKit transactions"] : [])
    ],
    rails: rails.map((rail) => ({
      id: rail.id,
      appKitChain: rail.appKitChain || null,
      circleBlockchain: rail.circleBlockchain,
      addressContext: "developer-controlled"
    }))
  };
}

export async function createCircleAppKitContext({ handle } = {}) {
  const profile = getWalletProfile(handle);
  const provider = new CircleWalletEip1193Provider({ profile });
  const adapter = new ViemAdapter({
    getPublicClient: ({ chain }) => createPublicClient({
      chain,
      transport: http(rpcUrlForChainId(chain.id))
    }),
    getWalletClient: ({ chain }) => createWalletClient({
      chain,
      transport: custom(provider)
    })
  }, {
    addressContext: "developer-controlled",
    supportedChains: new AppKit().getSupportedChains().filter((chain) => chain.type === "evm")
  });

  return {
    kit: new AppKit(),
    adapter,
    profile
  };
}

export async function estimateCircleAppKitBridge(input = {}) {
  const params = await buildBridgeParams(input);
  const rawEstimate = await params.kit.estimateBridge(params.request);
  const estimate = normalizeBridgeEstimate(rawEstimate, params);
  return {
    ok: true,
    provider: "circle-app-kit",
    mode: "live",
    operation: "bridge",
    executable: getCircleAppKitReadiness().executionReady,
    request: summarizeBridgeRequest(params),
    estimate,
    rawEstimate: jsonSafe(rawEstimate),
    quoteQuality: bridgeQuoteQuality(estimate),
    signer: signerMetadata(params.profile, input.fromRail || "arc-testnet")
  };
}

export async function executeCircleAppKitBridge(input = {}) {
  const readiness = getCircleAppKitReadiness();
  if (!readiness.executionReady) {
    return executionBlocked("appkit_bridge_usdc", readiness);
  }

  const params = await buildBridgeParams(input);
  const result = await params.kit.bridge(params.request);
  return {
    ok: true,
    status: normalizeAppKitResultStatus(result?.state || result?.status, result),
    provider: "circle-app-kit",
    mode: "real",
    operation: "bridge",
    backendSignerAllowed: false,
    txHash: extractTxHash(result),
    submissions: extractSubmissions(result),
    raw: jsonSafe(result)
  };
}

export async function estimateCircleAppKitSwap(input = {}) {
  const params = await buildSwapParams(input);
  const rawEstimate = await retryAppKitEstimate(() => params.kit.estimateSwap(params.request));
  const estimate = normalizeSwapEstimate(rawEstimate, params);
  return {
    ok: true,
    provider: "circle-app-kit",
    mode: "live",
    operation: "swap",
    executable: getCircleAppKitReadiness().executionReady,
    request: summarizeSwapRequest(params),
    estimate,
    rawEstimate: jsonSafe(rawEstimate),
    quoteQuality: swapQuoteQuality(estimate),
    signer: signerMetadata(params.profile, params.rail.id)
  };
}

export async function executeCircleAppKitSwap(input = {}) {
  const readiness = getCircleAppKitReadiness();
  if (!readiness.executionReady) {
    return executionBlocked("appkit_swap", readiness);
  }

  const params = await buildSwapParams(input);
  const result = await params.kit.swap(params.request);
  return {
    ok: true,
    status: normalizeAppKitResultStatus(result?.state || result?.status, result),
    provider: "circle-app-kit",
    mode: "real",
    operation: "swap",
    backendSignerAllowed: false,
    txHash: extractTxHash(result),
    submissions: extractSubmissions(result),
    raw: jsonSafe(result)
  };
}

export async function quoteCircleAppKitRoute(input = {}) {
  if ((input.type || (input.fromRail === input.toRail ? "swap" : "bridge")) === "bridge") {
    return estimateCircleAppKitBridge(input);
  }
  return estimateCircleAppKitSwap(input);
}

async function buildBridgeParams(input) {
  const fromRail = getSettlementRail(input.fromRail || input.settlementRail || "arc-testnet");
  const toRail = getSettlementRail(input.toRail || input.destinationRail || "base-sepolia");
  if (!fromRail.appKitChain || !toRail.appKitChain) {
    throw new Error("Both bridge rails must support Circle AppKit");
  }

  const { kit, adapter, profile } = await createCircleAppKitContext({ handle: input.handle || input.senderHandle });
  const fromWallet = walletForRail(profile, fromRail.id);
  const toAddress = input.recipientAddress
    || input.toAddress
    || walletForRail(profile, toRail.id)?.address
    || fromWallet.address;

  return {
    kit,
    adapter,
    profile,
    fromRail,
    toRail,
    fromWallet,
    toAddress,
    request: {
      from: {
        adapter,
        chain: fromRail.appKitChain,
        address: fromWallet.address
      },
      to: {
        chain: toRail.appKitChain,
        recipientAddress: toAddress,
        useForwarder: input.useForwarder !== false
      },
      amount: String(input.amount || input.amountUsd),
      token: normalizeSwapToken(input.token || input.fromToken || "USDC"),
      config: input.transferSpeed ? { transferSpeed: input.transferSpeed } : undefined
    }
  };
}

async function buildSwapParams(input) {
  const rail = getSettlementRail(input.settlementRail || input.fromRail || "arc-testnet");
  if (!rail.appKitChain) {
    throw new Error(`${rail.id} is not supported by Circle AppKit swaps`);
  }

  const { kit, adapter, profile } = await createCircleAppKitContext({ handle: input.handle || input.senderHandle });
  const wallet = walletForRail(profile, rail.id);
  const slippageBps = input.slippageBps ?? (input.slippage !== undefined ? Math.round(Number(input.slippage) * 10_000) : undefined);
  return {
    kit,
    adapter,
    profile,
    rail,
    wallet,
    request: {
      from: {
        adapter,
        chain: rail.appKitChain,
        address: wallet.address
      },
      tokenIn: appKitSwapTokenRef(input.tokenIn || input.fromToken || "USDC", rail),
      tokenOut: appKitSwapTokenRef(input.tokenOut || input.toToken || "EURC", rail),
      amountIn: String(input.amountIn || input.amount || input.amountUsd),
      config: {
        ...(slippageBps !== undefined ? { slippageBps } : {}),
        ...(config.appKit.kitKey ? { kitKey: config.appKit.kitKey } : {})
      }
    }
  };
}

class CircleWalletEip1193Provider {
  constructor({ profile }) {
    this.profile = profile;
    this.activeChainId = getSettlementRail("arc-testnet").chainId;
  }

  async request({ method, params = [] }) {
    if (method === "eth_chainId") {
      return `0x${this.activeChainId.toString(16)}`;
    }

    if (method === "wallet_switchEthereumChain") {
      const chainId = params?.[0]?.chainId;
      this.activeChainId = Number.parseInt(String(chainId), 16);
      return null;
    }

    if (method === "eth_accounts" || method === "eth_requestAccounts") {
      return [this.addressForChainId(this.activeChainId)];
    }

    if (method === "eth_sendTransaction") {
      return this.submitTransaction(params?.[0] || {});
    }

    if (method === "personal_sign") {
      const [message, address] = params;
      return this.signMessage({ address, message });
    }

    if (method === "eth_signTypedData_v4" || method === "eth_signTypedData") {
      const [address, data] = params;
      return this.signTypedData({ address, data });
    }

    throw new Error(`Circle AppKit provider does not support ${method}`);
  }

  async submitTransaction(tx) {
    const wallet = this.walletForAddressAndChain(tx.from, this.activeChainId);
    let response;
    try {
      response = await getCircleDeveloperClient().createContractExecutionTransaction({
        idempotencyKey: randomUUID(),
        walletId: wallet.id,
        contractAddress: tx.to,
        callData: tx.data || "0x",
        amount: nativeAmountFromTxValue(tx.value),
        fee: {
          type: "level",
          config: { feeLevel: "MEDIUM" }
        },
        refId: `appkit:${Date.now()}`
      });
    } catch (error) {
      throw new Error(circleErrorMessage(error, "Circle AppKit transaction submission failed"));
    }

    const transaction = unwrapTransaction(response);
    if (transaction.txHash || transaction.transactionHash) {
      return transaction.txHash || transaction.transactionHash;
    }

    return pollCircleTxHash(transaction.id);
  }

  async signMessage({ address, message }) {
    const wallet = this.walletForAddressAndChain(address, this.activeChainId);
    try {
      const response = await getCircleDeveloperClient().signMessage({
        walletId: wallet.id,
        message,
        encodedByHex: typeof message === "string" && message.startsWith("0x"),
        memo: "bunOS AppKit message signature"
      });
      return unwrapSignature(response);
    } catch (error) {
      throw new Error(circleErrorMessage(error, "Circle AppKit message signing failed"));
    }
  }

  async signTypedData({ address, data }) {
    const wallet = this.walletForAddressAndChain(address, this.activeChainId);
    try {
      const response = await getCircleDeveloperClient().signTypedData({
        walletId: wallet.id,
        data: typeof data === "string" ? data : JSON.stringify(data),
        memo: "bunOS AppKit typed-data signature"
      });
      return unwrapSignature(response);
    } catch (error) {
      throw new Error(circleErrorMessage(error, "Circle AppKit typed-data signing failed"));
    }
  }

  addressForChainId(chainId) {
    const rail = railForChainId(chainId);
    return walletForRail(this.profile, rail.id).address;
  }

  walletForAddressAndChain(address, chainId) {
    const rail = railForChainId(chainId);
    const wallet = walletForRail(this.profile, rail.id);
    if (address && wallet.address.toLowerCase() !== String(address).toLowerCase()) {
      throw new Error(`Circle wallet address mismatch for ${rail.id}`);
    }
    return wallet;
  }
}

async function pollCircleTxHash(transactionId) {
  if (!transactionId) {
    throw new Error("Circle did not return a transaction id");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    let response;
    try {
      response = await getCircleDeveloperClient().getTransaction({ id: transactionId });
    } catch (error) {
      throw new Error(circleErrorMessage(error, "Circle transaction polling failed"));
    }

    const transaction = unwrapTransaction(response);
    const txHash = transaction.txHash || transaction.transactionHash;
    if (txHash) return txHash;

    const state = String(transaction.state || transaction.status || "").toUpperCase();
    if (FAILED_STATES.has(state)) {
      throw new Error(transaction.errorReason || transaction.errorDetails || `Circle transaction failed with state ${state}`);
    }
    if (FINAL_STATES.has(state) && !txHash) {
      throw new Error(`Circle transaction ${transactionId} completed without a transaction hash`);
    }
  }

  throw new Error(`Timed out waiting for Circle transaction hash: ${transactionId}`);
}

function walletForRail(profile, railId) {
  const wallet = profile.wallets?.find((item) => item.rail === railId);
  if (!wallet?.id || !wallet?.address) {
    throw new Error(`No Circle wallet found for ${profile.handle} on ${railId}`);
  }
  return wallet;
}

function railForChainId(chainId) {
  const rail = listSettlementRails().find((item) => Number(item.chainId) === Number(chainId));
  if (!rail) {
    throw new Error(`Unsupported AppKit chain id: ${chainId}`);
  }
  return rail;
}

function rpcUrlForChainId(chainId) {
  const rail = listSettlementRails().find((item) => Number(item.chainId) === Number(chainId));
  if (rail?.id === "arc-testnet") return config.arc.rpcUrl;
  return rail?.rpcUrl;
}

function nativeAmountFromTxValue(value) {
  if (value === undefined || value === null || value === "0x0" || value === "0x" || value === "0") {
    return "0";
  }
  const wei = typeof value === "bigint"
    ? value
    : String(value).startsWith("0x")
      ? BigInt(value)
      : BigInt(String(value));
  const whole = wei / 10n ** 18n;
  const fraction = wei % (10n ** 18n);
  const fractionText = fraction.toString().padStart(18, "0").replace(/0+$/, "");
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

function unwrapTransaction(response) {
  const data = response.data || response;
  return data.transaction || data.data?.transaction || data.data || data;
}

function unwrapSignature(response) {
  const data = response.data || response;
  return data.signature || data.data?.signature || data.data || data;
}

function signerMetadata(profile, rail) {
  return {
    type: "circle_developer_controlled_wallet",
    custody: "developer-controlled",
    handle: profile.handle,
    settlementRail: rail,
    backendSignerAllowed: false
  };
}

function executionBlocked(operation, readiness) {
  return {
    ok: false,
    status: "execution_not_enabled",
    provider: "circle-app-kit",
    mode: "blocked",
    operation,
    backendSignerAllowed: false,
    readiness,
    reason: readiness.blockers.join("; ")
  };
}

function summarizeBridgeRequest({ fromRail, toRail, fromWallet, toAddress, request }) {
  return {
    fromRail: fromRail.id,
    toRail: toRail.id,
    fromAddress: fromWallet.address,
    toAddress,
    amount: request.amount,
    token: request.token,
    useForwarder: Boolean(request.to.useForwarder)
  };
}

function summarizeSwapRequest({ rail, wallet, request }) {
  return {
    settlementRail: rail.id,
    fromAddress: wallet.address,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    slippageBps: request.config?.slippageBps
  };
}

function normalizeSwapToken(token) {
  const raw = String(token || "").trim();
  if (!raw) return raw;
  if (/^0x[a-fA-F0-9]{40}$/.test(raw)) return raw;
  const value = raw.toUpperCase();
  if (value === "CIRBTC") return "cirBTC";
  return value === "ETH" ? "WETH" : value;
}

async function retryAppKitEstimate(run, { attempts = 3, delayMs = 700 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isTransientAppKitQuoteError(error)) {
        throw error;
      }
      await wait(delayMs * attempt);
    }
  }
  throw lastError;
}

function isTransientAppKitQuoteError(error) {
  const message = String(error?.message || error || "");
  return /server error|route or resource not found|no route available|temporarily|timeout|rate/i.test(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appKitSwapTokenRef(token, rail) {
  const normalized = normalizeSwapToken(token);
  if (/^0x[a-fA-F0-9]{40}$/.test(normalized)) return normalized;
  const key = String(normalized || "").toUpperCase();
  if (key === "EURC" && rail.eurcAddress) return rail.eurcAddress;
  if (key === "CIRBTC" && rail.cirbtcAddress) return rail.cirbtcAddress;
  return normalized;
}

function normalizeAppKitResultStatus(state = "", context = null) {
  const normalized = String(state).toLowerCase();
  if (["success", "settled", "confirmed", "complete", "completed"].includes(normalized)) return "settled";
  if (["failed", "failure", "error", "reverted"].includes(normalized)) return "failed";
  if (!normalized && (context?.txHash || context?.transactionHash || context?.hash)) return "submitted";
  return "submitted";
}

function extractTxHash(result) {
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  const executed = Array.isArray(result?.executedTransactions) ? result.executedTransactions : [];
  const swapTx = executed.find((item) => String(item.type || "").toLowerCase() === "swap");
  const preferredStep = steps.find((step) => ["burn", "swap", "send"].includes(String(step.name || step.type).toLowerCase()))
    || steps.findLast?.((step) => step.txHash || step.transactionHash || step.hash);
  return result?.txHash
    || result?.transactionHash
    || result?.hash
    || swapTx?.txHash
    || preferredStep?.txHash
    || preferredStep?.transactionHash
    || preferredStep?.hash
    || null;
}

function extractSubmissions(result) {
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  const fromSteps = steps
    .map((step, index) => ({
      refId: step.name || step.type || `appkit:${index}`,
      status: normalizeAppKitResultStatus(step.state || step.status, step),
      txHash: step.txHash || step.transactionHash || step.hash || null,
      rawStatus: step.state || step.status || null,
      submittedAt: new Date().toISOString()
    }))
    .filter((step) => step.txHash || step.rawStatus);
  const executed = Array.isArray(result?.executedTransactions) ? result.executedTransactions : [];
  const fromExecuted = executed
    .map((tx, index) => ({
      refId: tx.type || `appkit:tx:${index}`,
      status: "submitted",
      txHash: tx.txHash || tx.transactionHash || tx.hash || null,
      rawStatus: "SUBMITTED",
      submittedAt: new Date().toISOString()
    }))
    .filter((tx) => tx.txHash);
  return [...fromSteps, ...fromExecuted];
}

function normalizeSwapEstimate(estimate, params) {
  const safe = jsonSafe(estimate) || {};
  const estimatedOutput = normalizeTokenAmount(
    safe.estimatedOutput || safe.output || safe.toAmount,
    params.request.tokenOut
  );
  const stopLimit = normalizeTokenAmount(
    safe.stopLimit || safe.minimumOutput || safe.minOutput,
    params.request.tokenOut
  );
  return {
    ...safe,
    tokenIn: safe.tokenIn || params.request.tokenIn,
    tokenOut: safe.tokenOut || params.request.tokenOut,
    amountIn: safe.amountIn || params.request.amountIn,
    chain: safe.chain || params.rail.appKitChain,
    fromAddress: safe.fromAddress || params.wallet.address,
    toAddress: safe.toAddress || params.wallet.address,
    estimatedOutput,
    stopLimit,
    amountOut: safe.amountOut || estimatedOutput?.amount || null,
    fees: normalizeFeeList(safe.fees)
  };
}

function normalizeBridgeEstimate(estimate, params) {
  const safe = jsonSafe(estimate) || {};
  return {
    ...safe,
    token: safe.token || params.request.token || "USDC",
    amount: safe.amount || params.request.amount,
    source: safe.source || {
      address: params.fromWallet.address,
      chain: params.fromRail.appKitChain
    },
    destination: safe.destination || {
      address: params.toAddress,
      chain: params.toRail.appKitChain,
      recipientAddress: params.toAddress
    },
    gasFees: Array.isArray(safe.gasFees) ? safe.gasFees : [],
    fees: normalizeFeeList(safe.fees)
  };
}

function normalizeTokenAmount(value, fallbackToken) {
  if (!value) return null;
  if (typeof value === "object") {
    const amount = value.amount ?? value.value ?? value.toAmount ?? value.amountOut;
    return {
      ...value,
      token: value.token || value.symbol || fallbackToken,
      amount: amount === undefined || amount === null ? null : String(amount)
    };
  }
  return {
    token: fallbackToken,
    amount: String(value)
  };
}

function normalizeFeeList(fees) {
  if (!Array.isArray(fees)) return [];
  return fees.map((fee) => {
    const token = fee?.token?.symbol || fee?.token || fee?.currency;
    const decimals = fee?.token?.decimals ?? fee?.decimals;
    return {
      ...fee,
      token,
      amount: normalizeStableFeeAmount(fee?.amount, token, decimals)
    };
  });
}

function normalizeStableFeeAmount(amount, token, decimals = 6) {
  if (amount === null || amount === undefined || amount === "") return amount ?? null;
  const raw = String(amount);
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 0) return raw;
  if (String(token || "").toUpperCase() === "USDC" && /^\d+$/.test(raw) && number > 100 && Number(decimals) >= 6) {
    return String(number / 10 ** Number(decimals));
  }
  return raw;
}

function swapQuoteQuality(estimate) {
  const amount = Number(estimate?.estimatedOutput?.amount);
  return {
    ok: Number.isFinite(amount) && amount > 0,
    outputAmount: Number.isFinite(amount) ? amount : null,
    reason: Number.isFinite(amount) && amount > 0
      ? "Swap quote includes a positive estimated output."
      : "Swap quote did not include a positive estimated output."
  };
}

function bridgeQuoteQuality(estimate) {
  const amount = Number(estimate?.amount);
  return {
    ok: Number.isFinite(amount) && amount > 0 && estimate?.token === "USDC",
    outputAmount: Number.isFinite(amount) ? amount : null,
    reason: Number.isFinite(amount) && amount > 0
      ? "Bridge quote includes a positive USDC transfer amount."
      : "Bridge quote did not include a positive USDC transfer amount."
  };
}

function jsonSafe(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}
