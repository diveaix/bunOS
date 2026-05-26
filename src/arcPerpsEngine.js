import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatUnits,
  http,
  parseUnits
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { circleErrorMessage, getCircleDeveloperClient } from "./circleSdk.js";
import { listHyperliquidMarkets } from "./hyperliquidAdapter.js";
import { getSettlementRail } from "./settlement.js";
import { readOnlySigner, userWalletSigningRequired } from "./signerPolicy.js";
import { getWalletProfile } from "./walletAccounts.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const USDC_DECIMALS = 6;
const PRICE_DECIMALS = 8;
const BPS = 10_000;
const FINAL_CIRCLE_STATES = new Set(["COMPLETE", "CONFIRMED", "MINED"]);
const FAILED_CIRCLE_STATES = new Set(["FAILED", "CANCELLED", "DENIED"]);
const CIRCLE_POLL_INTERVAL_MS = 2500;
const CIRCLE_POLL_TIMEOUT_MS = 120_000;
const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
];

let vaultArtifact;
let oracleArtifact;

export function getArcPerpsReadiness() {
  const missing = [];
  if (!config.arc.rpcUrl) missing.push("ARC_TESTNET_RPC_URL");
  if (!config.arcPerps.usdcAddress) missing.push("ARC_PERPS_USDC_ADDRESS");
  if (!config.arcPerps.oracleAddress) missing.push("ARC_PERPS_ORACLE_ADDRESS");
  if (!config.arcPerps.vaultAddress) missing.push("ARC_PERPS_VAULT_ADDRESS");
  const circleReady = Boolean(config.circle.apiKey && config.circle.entitySecret && config.circle.walletSetId);

  return {
    ok: missing.length === 0,
    executionEnabled: Boolean(config.arcPerps.executionEnabled && circleReady && missing.length === 0),
    userWalletExecutionReady: Boolean(config.arcPerps.executionEnabled && circleReady && missing.length === 0),
    backendSignerAllowed: false,
    adminSignerConfigured: Boolean(config.arc.settlementPrivateKey),
    adminExecutionEnabled: Boolean(config.arcPerps.executionEnabled && config.arc.settlementPrivateKey && missing.length === 0),
    oracleSyncEnabled: Boolean(config.arcPerps.oracleSyncEnabled && config.arcPerps.executionEnabled && config.defi.liveAdapters && config.arc.settlementPrivateKey && missing.length === 0),
    missing,
    blockers: [
      ...missing,
      ...(!circleReady ? ["Circle API key, entity secret, and wallet set required for user-wallet perps execution"] : []),
      ...(!config.arcPerps.executionEnabled ? ["Set ARC_PERPS_EXECUTION_ENABLED=1 to submit user-wallet perps transactions"] : [])
    ],
    rail: "arc-testnet",
    usdcAddress: config.arcPerps.usdcAddress || null,
    vaultAddress: config.arcPerps.vaultAddress || null,
    oracleAddress: config.arcPerps.oracleAddress || null,
    maxLeverage: config.arcPerps.maxLeverage
  };
}

export async function getArcPerpsStatus({ ownerAddress } = {}) {
  const readiness = getArcPerpsReadiness();
  const status = {
    ...readiness,
    accountAddress: null,
    usdcBalance: null,
    vaultAllowance: null,
    depositedMargin: null,
    poolBalance: null,
    nextPositionId: null,
    risk: null
  };

  if (readiness.missing.length || !config.arc.rpcUrl) {
    return status;
  }

  const vault = await getVaultArtifact();
  const { publicClient } = getPublicClient();
  const accountAddress = ownerAddress || null;
  status.accountAddress = accountAddress;

  const [poolBalance, nextPositionId, maxLeverageBps, maintenanceMarginBps] = await Promise.all([
    publicClient.readContract({
      address: config.arcPerps.vaultAddress,
      abi: vault.abi,
      functionName: "poolBalance"
    }),
    publicClient.readContract({
      address: config.arcPerps.vaultAddress,
      abi: vault.abi,
      functionName: "nextPositionId"
    }),
    publicClient.readContract({
      address: config.arcPerps.vaultAddress,
      abi: vault.abi,
      functionName: "maxLeverageBps"
    }),
    publicClient.readContract({
      address: config.arcPerps.vaultAddress,
      abi: vault.abi,
      functionName: "maintenanceMarginBps"
    })
  ]);

  status.poolBalance = Number(formatUnits(poolBalance, USDC_DECIMALS));
  status.nextPositionId = Number(nextPositionId);
  status.risk = {
    maxLeverage: Number(maxLeverageBps) / BPS,
    maintenanceMarginPct: Number(maintenanceMarginBps) / 100
  };

  if (accountAddress) {
    const [usdcBalance, vaultAllowance, depositedMargin] = await Promise.all([
      publicClient.readContract({
        address: config.arcPerps.usdcAddress,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [accountAddress]
      }),
      publicClient.readContract({
        address: config.arcPerps.usdcAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [accountAddress, config.arcPerps.vaultAddress]
      }),
      publicClient.readContract({
        address: config.arcPerps.vaultAddress,
        abi: vault.abi,
        functionName: "marginBalances",
        args: [accountAddress]
      })
    ]);
    status.usdcBalance = Number(formatUnits(usdcBalance, USDC_DECIMALS));
    status.vaultAllowance = Number(formatUnits(vaultAllowance, USDC_DECIMALS));
    status.depositedMargin = Number(formatUnits(depositedMargin, USDC_DECIMALS));
  }

  return status;
}

export async function quoteArcPerpPosition({
  symbol = "BTC",
  side = "long",
  marginUsd,
  leverage = 2,
  markPrice
} = {}) {
  const margin = Number(marginUsd || 0);
  const lev = Number(leverage || 0);
  if (!Number.isFinite(margin) || margin <= 0) {
    throw new Error("Margin must be greater than zero");
  }
  if (!Number.isFinite(lev) || lev < 1 || lev > config.arcPerps.maxLeverage) {
    throw new Error(`Leverage must be between 1 and ${config.arcPerps.maxLeverage}`);
  }

  const price = markPrice ? Number(markPrice) : await readArcPerpsOraclePrice({ symbol }).then((result) => result.price);
  const notionalUsd = round(margin * lev);
  const liquidationPrice = liquidationPriceFor({ side, entryPrice: price, leverage: lev });

  return {
    ok: true,
    quote: {
      symbol: symbol.toUpperCase(),
      side,
      marginUsd: margin,
      leverage: lev,
      notionalUsd,
      entryPrice: price,
      liquidationPrice,
      liquidationBufferPct: round(Math.abs(price - liquidationPrice) / price * 100),
      settlementRail: "arc-testnet",
      settlement: "ArcPerpsVault",
      requiresApproval: true
    },
    signer: readOnlySigner({ operation: "quote_arc_perp_position", settlementRail: "arc-testnet" })
  };
}

export async function readArcPerpsOraclePrice({ symbol = "BTC" } = {}) {
  assertReadReady();
  const oracle = await getOracleArtifact();
  const { publicClient } = getPublicClient();
  const [price, timestamp] = await publicClient.readContract({
    address: config.arcPerps.oracleAddress,
    abi: oracle.abi,
    functionName: "getPrice",
    args: [symbolBytes32(symbol)]
  });
  return {
    ok: true,
    symbol: symbol.toUpperCase(),
    price: Number(formatUnits(price, PRICE_DECIMALS)),
    rawPrice: price.toString(),
    updatedAt: Number(timestamp),
    signer: readOnlySigner({ operation: "read_arc_perps_oracle_price", settlementRail: "arc-testnet" })
  };
}

export async function setArcPerpsOraclePrice({ symbol = "BTC", price } = {}) {
  assertAdminExecutionReady();
  const oracle = await getOracleArtifact();
  const clients = getClients();
  const rawPrice = parseUnits(String(Number(price || 0)), PRICE_DECIMALS);
  if (rawPrice <= 0n) {
    throw new Error("Price must be greater than zero");
  }
  const data = encodeFunctionData({
    abi: oracle.abi,
    functionName: "setPrice",
    args: [symbolBytes32(symbol), rawPrice]
  });
  const hash = await clients.walletClient.sendTransaction({
    to: config.arcPerps.oracleAddress,
    data
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });

  return transactionResult(hash, receipt);
}

export async function setArcPerpsMarket({ symbol = "BTC", enabled = true } = {}) {
  assertAdminExecutionReady();
  const vault = await getVaultArtifact();
  const clients = getClients();
  const data = encodeFunctionData({
    abi: vault.abi,
    functionName: "setMarket",
    args: [symbolBytes32(symbol), Boolean(enabled)]
  });
  const hash = await clients.walletClient.sendTransaction({
    to: config.arcPerps.vaultAddress,
    data
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });

  return transactionResult(hash, receipt);
}

export async function openArcPerpPosition({
  symbol = "BTC",
  side = "long",
  marginUsd,
  leverage = 2
} = {}) {
  assertAdminExecutionReady();
  const vault = await getVaultArtifact();
  const clients = getClients();
  const symbolHex = symbolBytes32(symbol);
  const margin = parseUsdc(marginUsd);
  const leverageBps = BigInt(Math.round(Number(leverage) * BPS));
  const isLong = side !== "short";

  const data = encodeFunctionData({
    abi: vault.abi,
    functionName: "openPosition",
    args: [symbolHex, isLong, margin, leverageBps]
  });
  const hash = await clients.walletClient.sendTransaction({
    to: config.arcPerps.vaultAddress,
    data
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });

  return transactionResult(hash, receipt);
}

export async function approveArcPerpsUsdc({ amountUsd } = {}) {
  assertAdminExecutionReady();
  const clients = getClients();
  const amount = parseUsdc(amountUsd);
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [config.arcPerps.vaultAddress, amount]
  });
  const hash = await clients.walletClient.sendTransaction({
    to: config.arcPerps.usdcAddress,
    data
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });

  return transactionResult(hash, receipt);
}

export async function depositArcPerpsMargin({ amountUsd } = {}) {
  assertAdminExecutionReady();
  const vault = await getVaultArtifact();
  const clients = getClients();
  const amount = parseUsdc(amountUsd);
  const data = encodeFunctionData({
    abi: vault.abi,
    functionName: "depositMargin",
    args: [amount]
  });
  const hash = await clients.walletClient.sendTransaction({
    to: config.arcPerps.vaultAddress,
    data
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });

  return transactionResult(hash, receipt);
}

export async function withdrawArcPerpsMargin({ amountUsd } = {}) {
  assertAdminExecutionReady();
  const vault = await getVaultArtifact();
  const clients = getClients();
  const amount = parseUsdc(amountUsd);
  const data = encodeFunctionData({
    abi: vault.abi,
    functionName: "withdrawMargin",
    args: [amount]
  });
  const hash = await clients.walletClient.sendTransaction({
    to: config.arcPerps.vaultAddress,
    data
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });

  return transactionResult(hash, receipt);
}

export async function provideArcPerpsLiquidity({ amountUsd } = {}) {
  assertAdminExecutionReady();
  const vault = await getVaultArtifact();
  const clients = getClients();
  const amount = parseUsdc(amountUsd);
  const data = encodeFunctionData({
    abi: vault.abi,
    functionName: "provideLiquidity",
    args: [amount]
  });
  const hash = await clients.walletClient.sendTransaction({
    to: config.arcPerps.vaultAddress,
    data
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });

  return transactionResult(hash, receipt);
}

export async function closeArcPerpPosition({ positionId } = {}) {
  assertAdminExecutionReady();
  const vault = await getVaultArtifact();
  const clients = getClients();
  const data = encodeFunctionData({
    abi: vault.abi,
    functionName: "closePosition",
    args: [BigInt(positionId)]
  });
  const hash = await clients.walletClient.sendTransaction({
    to: config.arcPerps.vaultAddress,
    data
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });

  return transactionResult(hash, receipt);
}

export async function executeArcPerpProposalWithUserWallet({ proposal } = {}) {
  if (!proposal) throw new Error("proposal is required");
  return await openArcPerpPositionWithUserWallet({
    handle: proposal.handle,
    symbol: proposal.symbol,
    side: proposal.side,
    marginUsd: proposal.collateralUsd,
    leverage: proposal.leverage,
    idempotencyKey: `arc-perps:${proposal.id}`
  });
}

export async function openArcPerpPositionWithUserWallet({
  handle = "@sara",
  symbol = "BTC",
  side = "long",
  marginUsd,
  leverage = 2,
  idempotencyKey
} = {}) {
  const readiness = getArcPerpsReadiness();
  if (!readiness.userWalletExecutionReady) {
    return userExecutionBlocked("open_arc_perp_position", readiness);
  }

  const vault = await getVaultArtifact();
  const profile = getWalletProfile(handle);
  const wallet = walletForRail(profile, "arc-testnet");
  const publicClient = getPublicClient().publicClient;
  const symbolHex = symbolBytes32(symbol);
  const margin = parseUsdc(marginUsd);
  const leverageBps = BigInt(Math.round(Number(leverage) * BPS));
  const isLong = side !== "short";
  const nextPositionId = await publicClient.readContract({
    address: config.arcPerps.vaultAddress,
    abi: vault.abi,
    functionName: "nextPositionId"
  });

  const steps = [];
  steps.push(await submitUserContractExecution({
    wallet,
    contractAddress: config.arcPerps.usdcAddress,
    callData: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [config.arcPerps.vaultAddress, margin]
    }),
    refId: `${idempotencyKey || `arc-perps:${Date.now()}`}:approve`
  }));

  steps.push(await submitUserContractExecution({
    wallet,
    contractAddress: config.arcPerps.vaultAddress,
    callData: encodeFunctionData({
      abi: vault.abi,
      functionName: "depositMargin",
      args: [margin]
    }),
    refId: `${idempotencyKey || `arc-perps:${Date.now()}`}:deposit`
  }));

  const open = await submitUserContractExecution({
    wallet,
    contractAddress: config.arcPerps.vaultAddress,
    callData: encodeFunctionData({
      abi: vault.abi,
      functionName: "openPosition",
      args: [symbolHex, isLong, margin, leverageBps]
    }),
    refId: `${idempotencyKey || `arc-perps:${Date.now()}`}:open`
  });
  steps.push(open);

  const positionId = Number(nextPositionId);
  const position = await getArcPerpsPosition({ positionId }).then((result) => result.position).catch(() => null);

  return {
    ok: true,
    status: "submitted",
    mode: "circle_user_wallet_contract_execution",
    backendSignerAllowed: false,
    handle: profile.handle,
    wallet: {
      id: wallet.id,
      address: wallet.address,
      rail: wallet.rail
    },
    positionId,
    position,
    steps,
    txHash: open.txHash,
    explorerUrl: open.explorerUrl,
    signer: circleUserArcPerpsSigner(profile, "open_arc_perp_position")
  };
}

export async function closeArcPerpPositionWithUserWallet({
  handle = "@sara",
  positionId,
  idempotencyKey
} = {}) {
  const readiness = getArcPerpsReadiness();
  if (!readiness.userWalletExecutionReady) {
    return userExecutionBlocked("close_arc_perp_position", readiness);
  }

  const vault = await getVaultArtifact();
  const profile = getWalletProfile(handle);
  const wallet = walletForRail(profile, "arc-testnet");
  const before = await getArcPerpsPosition({ positionId }).then((result) => result.position);
  if (before.owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error("Position does not belong to this user's Arc wallet");
  }

  const close = await submitUserContractExecution({
    wallet,
    contractAddress: config.arcPerps.vaultAddress,
    callData: encodeFunctionData({
      abi: vault.abi,
      functionName: "closePosition",
      args: [BigInt(positionId)]
    }),
    refId: `${idempotencyKey || `arc-perps:${Date.now()}`}:close:${positionId}`
  });
  const after = await getArcPerpsPosition({ positionId }).then((result) => result.position).catch(() => null);

  return {
    ok: true,
    status: "submitted",
    mode: "circle_user_wallet_contract_execution",
    backendSignerAllowed: false,
    handle: profile.handle,
    wallet: {
      id: wallet.id,
      address: wallet.address,
      rail: wallet.rail
    },
    positionId: Number(positionId),
    before,
    position: after,
    steps: [close],
    txHash: close.txHash,
    explorerUrl: close.explorerUrl,
    signer: circleUserArcPerpsSigner(profile, "close_arc_perp_position")
  };
}

export async function syncArcPerpsOracleFromHyperliquid({ symbols = config.arcPerps.oracleSyncSymbols } = {}) {
  const readiness = getArcPerpsReadiness();
  if (!readiness.oracleSyncEnabled) {
    return {
      ok: false,
      skipped: true,
      reason: "ArcPerps oracle sync needs live adapters, deployed contracts, and the protocol admin signer."
    };
  }

  const markets = await listHyperliquidMarkets({ limit: 250 });
  const updates = [];
  for (const symbol of symbols) {
    const market = markets.markets.find((item) => item.symbol.toUpperCase() === symbol.toUpperCase());
    const price = Number(market?.mid || 0);
    if (!Number.isFinite(price) || price <= 0) {
      updates.push({ symbol, skipped: true, reason: "No live Hyperliquid mid price" });
      continue;
    }

    const current = await readArcPerpsOraclePrice({ symbol }).catch(() => null);
    const stale = !current?.updatedAt || (Date.now() / 1000 - current.updatedAt) * 1000 > config.arcPerps.oracleMaxAgeMs;
    const changed = !current?.price || Math.abs(current.price - price) / current.price > 0.0005;
    if (!stale && !changed) {
      updates.push({ symbol, skipped: true, price, oraclePrice: current.price, reason: "Fresh enough" });
      continue;
    }

    const tx = await setArcPerpsOraclePrice({ symbol, price });
    updates.push({ symbol, price, txHash: tx.txHash, explorerUrl: tx.explorerUrl });
  }

  return {
    ok: true,
    provider: markets.provider,
    mode: markets.mode,
    updates
  };
}

export async function listArcPerpsPositions({ ownerAddress, limit = 25 } = {}) {
  assertReadReady();
  const vault = await getVaultArtifact();
  const { publicClient } = getPublicClient();
  const nextPositionId = await publicClient.readContract({
    address: config.arcPerps.vaultAddress,
    abi: vault.abi,
    functionName: "nextPositionId"
  });
  const maxId = Number(nextPositionId) - 1;
  const start = Math.max(1, maxId - Number(limit || 25) + 1);
  const positions = [];

  for (let id = maxId; id >= start; id -= 1) {
    const position = await readPosition({ publicClient, vault, positionId: id });
    if (!position.owner || position.owner === "0x0000000000000000000000000000000000000000") continue;
    if (ownerAddress && position.owner.toLowerCase() !== ownerAddress.toLowerCase()) continue;
    positions.push(position);
  }

  return {
    ok: true,
    positions,
    nextPositionId: Number(nextPositionId),
    signer: readOnlySigner({ operation: "list_arc_perps_positions", settlementRail: "arc-testnet" })
  };
}

export async function getArcPerpsPosition({ positionId } = {}) {
  assertReadReady();
  const vault = await getVaultArtifact();
  const { publicClient } = getPublicClient();
  const position = await readPosition({ publicClient, vault, positionId });
  return {
    ok: true,
    position,
    signer: readOnlySigner({ operation: "get_arc_perps_position", settlementRail: "arc-testnet" })
  };
}

async function readPosition({ publicClient, vault, positionId }) {
  const id = Number(positionId || 0);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("positionId must be a positive integer");
  }

  const raw = await publicClient.readContract({
    address: config.arcPerps.vaultAddress,
    abi: vault.abi,
    functionName: "positions",
    args: [BigInt(id)]
  });
  const position = normalizePosition(id, raw);
  if (position.open) {
    const [markPriceResult, liquidationPrice, pnl] = await Promise.all([
      readArcPerpsOraclePrice({ symbol: position.symbol }),
      publicClient.readContract({
        address: config.arcPerps.vaultAddress,
        abi: vault.abi,
        functionName: "getLiquidationPrice",
        args: [BigInt(id)]
      }),
      Promise.resolve(null)
    ]);
    const currentPnl = await publicClient.readContract({
      address: config.arcPerps.vaultAddress,
      abi: vault.abi,
      functionName: "getPnl",
      args: [BigInt(id), BigInt(markPriceResult.rawPrice)]
    }).catch(() => pnl);
    position.markPrice = markPriceResult.price;
    position.liquidationPrice = Number(formatUnits(liquidationPrice, PRICE_DECIMALS));
    if (currentPnl !== null) {
      position.pnlUsd = Number(formatUnits(currentPnl < 0n ? -currentPnl : currentPnl, USDC_DECIMALS)) * (currentPnl < 0n ? -1 : 1);
    }
  }
  delete position.rawEntryPrice;
  return position;
}

function assertAdminExecutionReady() {
  const readiness = getArcPerpsReadiness();
  if (!readiness.ok) {
    throw new Error(`ArcPerps contracts are not configured: ${readiness.missing.join(", ")}`);
  }
  if (!config.arcPerps.executionEnabled || !config.arc.settlementPrivateKey) {
    throw new Error("ArcPerps admin execution is disabled; set ARC_PERPS_EXECUTION_ENABLED=1 and ARC_SETTLEMENT_PRIVATE_KEY for protocol admin operations");
  }
}

function assertReadReady() {
  const readiness = getArcPerpsReadiness();
  const readMissing = readiness.missing.filter((item) => item !== "ARC_SETTLEMENT_PRIVATE_KEY");
  if (readMissing.length) {
    throw new Error(`ArcPerps contracts are not configured: ${readMissing.join(", ")}`);
  }
}

function getPublicClient() {
  const rail = getSettlementRail("arc-testnet");
  const chain = {
    id: rail.chainId,
    name: rail.label,
    nativeCurrency: rail.nativeCurrency,
    rpcUrls: { default: { http: [config.arc.rpcUrl] } }
  };

  return {
    publicClient: createPublicClient({ chain, transport: http(config.arc.rpcUrl) })
  };
}

function getClients() {
  const rail = getSettlementRail("arc-testnet");
  const account = privateKeyToAccount(normalizePrivateKey(config.arc.settlementPrivateKey));
  const chain = {
    id: rail.chainId,
    name: rail.label,
    nativeCurrency: rail.nativeCurrency,
    rpcUrls: { default: { http: [config.arc.rpcUrl] } }
  };

  return {
    publicClient: createPublicClient({ chain, transport: http(config.arc.rpcUrl) }),
    walletClient: createWalletClient({ account, chain, transport: http(config.arc.rpcUrl) })
  };
}

async function submitUserContractExecution({ wallet, contractAddress, callData, refId }) {
  const response = await getCircleDeveloperClient().createContractExecutionTransaction({
    walletId: wallet.id,
    contractAddress,
    callData,
    amount: "0",
    fee: {
      type: "level",
      config: { feeLevel: "MEDIUM" }
    },
    refId
  }).catch((error) => {
    throw new Error(circleErrorMessage(error, "Circle ArcPerps transaction submission failed"));
  });
  const transaction = unwrapCircleTransaction(response);
  const txHash = transaction.txHash || transaction.transactionHash || await pollCircleTxHash(transaction.id);
  const receipt = await getPublicClient().publicClient.waitForTransactionReceipt({ hash: txHash });
  return {
    ok: true,
    id: transaction.id || null,
    status: normalizeCircleTransactionStatus(transaction.state || transaction.status),
    txHash,
    receiptStatus: receipt.status,
    explorerUrl: `${getSettlementRail("arc-testnet").explorerBaseUrl}${txHash}`
  };
}

async function pollCircleTxHash(transactionId) {
  if (!transactionId) {
    throw new Error("Circle did not return a transaction id");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < CIRCLE_POLL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, CIRCLE_POLL_INTERVAL_MS));
    const response = await getCircleDeveloperClient().getTransaction({ id: transactionId }).catch((error) => {
      throw new Error(circleErrorMessage(error, "Circle ArcPerps transaction polling failed"));
    });
    const transaction = unwrapCircleTransaction(response);
    const txHash = transaction.txHash || transaction.transactionHash;
    if (txHash) return txHash;

    const state = String(transaction.state || transaction.status || "").toUpperCase();
    if (FAILED_CIRCLE_STATES.has(state)) {
      throw new Error(transaction.errorReason || transaction.errorDetails || `Circle transaction failed with state ${state}`);
    }
    if (FINAL_CIRCLE_STATES.has(state) && !txHash) {
      throw new Error(`Circle transaction ${transactionId} completed without a transaction hash`);
    }
  }

  throw new Error(`Timed out waiting for Circle transaction hash: ${transactionId}`);
}

function unwrapCircleTransaction(response) {
  const data = response.data || response;
  return data.transaction || data.data?.transaction || data.data || data;
}

function normalizeCircleTransactionStatus(value = "") {
  const status = String(value || "").toUpperCase();
  if (["CONFIRMED", "COMPLETE", "COMPLETED", "MINED"].includes(status)) return "settled";
  if (["FAILED", "CANCELLED", "DENIED"].includes(status)) return "failed";
  if (status) return status.toLowerCase();
  return "submitted";
}

function walletForRail(profile, railId) {
  const wallet = profile.wallets?.find((item) => item.rail === railId);
  if (!wallet?.id || !wallet?.address) {
    throw new Error(`No Circle wallet found for ${profile.handle} on ${railId}`);
  }
  if (String(wallet.id).startsWith("wallet_") || String(profile.walletSetId || "").endsWith("_demo")) {
    throw new Error(`Real Circle wallet required for ${profile.handle} on ${railId}`);
  }
  return wallet;
}

function circleUserArcPerpsSigner(profile, operation) {
  return {
    signerType: "circle_user_wallet",
    signerScope: "per_user",
    handle: profile.handle,
    operation,
    settlementRail: "arc-testnet",
    backendSignerAllowed: false,
    gasPayer: "circle_wallet_or_paymaster",
    executionStatus: "submitted"
  };
}

function userExecutionBlocked(operation, readiness) {
  return {
    ok: false,
    status: "user_wallet_signing_required",
    mode: "blocked",
    operation,
    backendSignerAllowed: false,
    readiness,
    signer: userWalletSigningRequired({
      operation,
      settlementRail: "arc-testnet",
      reason: readiness.blockers.join("; ") || "Circle user wallet execution is not ready"
    }),
    reason: readiness.blockers.join("; ") || "Circle user wallet execution is not ready"
  };
}

async function getVaultArtifact() {
  vaultArtifact ||= JSON.parse(await readFile(join(root, "build", "contracts", "ArcPerpsVault.json"), "utf8"));
  return vaultArtifact;
}

async function getOracleArtifact() {
  oracleArtifact ||= JSON.parse(await readFile(join(root, "build", "contracts", "ArcPerpsOracle.json"), "utf8"));
  return oracleArtifact;
}

function liquidationPriceFor({ side, entryPrice, leverage }) {
  const maxLossPct = (1 / leverage) * 0.95;
  const price = side === "short"
    ? entryPrice * (1 + maxLossPct)
    : entryPrice * (1 - maxLossPct);
  return round(price);
}

function symbolBytes32(symbol) {
  const bytes = Buffer.from(symbol.toUpperCase(), "utf8");
  if (bytes.length > 32) {
    throw new Error("Symbol too long");
  }
  return `0x${bytes.toString("hex").padEnd(64, "0")}`;
}

function symbolFromBytes32(value) {
  return Buffer.from(value.slice(2), "hex").toString("utf8").replace(/\0/g, "");
}

function normalizePrivateKey(value) {
  return value.startsWith("0x") ? value : `0x${value}`;
}

function accountAddressFromConfig() {
  if (!config.arc.settlementPrivateKey) return null;
  return privateKeyToAccount(normalizePrivateKey(config.arc.settlementPrivateKey)).address;
}

function parseUsdc(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be greater than zero");
  }
  return parseUnits(String(amount), USDC_DECIMALS);
}

function normalizePosition(positionId, raw) {
  const [
    owner,
    symbol,
    isLong,
    margin,
    notional,
    entryPrice,
    leverageBps,
    openedAt,
    open
  ] = raw;

  return {
    id: positionId,
    owner,
    symbol: symbolFromBytes32(symbol),
    side: isLong ? "long" : "short",
    marginUsd: Number(formatUnits(margin, USDC_DECIMALS)),
    notionalUsd: Number(formatUnits(notional, USDC_DECIMALS)),
    entryPrice: Number(formatUnits(entryPrice, PRICE_DECIMALS)),
    rawEntryPrice: entryPrice,
    leverage: Number(leverageBps) / BPS,
    openedAt: Number(openedAt),
    open
  };
}

function transactionResult(hash, receipt) {
  return {
    ok: true,
    txHash: hash,
    receipt,
    explorerUrl: `${getSettlementRail("arc-testnet").explorerBaseUrl}${hash}`
  };
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
