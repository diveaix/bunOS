import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { getSettlementRail } from "./settlement.js";

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function isEvmAddress(value) {
  return EVM_ADDRESS.test(value || "");
}

export async function submitAppKitTransfer({ payment }) {
  if (!config.arc.settlementPrivateKey) {
    throw new Error("App Kit transfers require ARC_SETTLEMENT_PRIVATE_KEY");
  }

  const instruction = payment.walletInstruction;
  if (!isEvmAddress(instruction?.to || "")) {
    throw new Error("App Kit transfers require a valid 0x recipient wallet address");
  }

  const rail = getSettlementRail(payment.settlementRail);
  if (!rail.appKitChain) {
    throw new Error(`${rail.id} is not supported by App Kit transfer provider`);
  }

  const { kit, adapter } = await createAppKitSourceAdapter({ rail });

  const params = {
    from: { adapter, chain: rail.appKitChain },
    to: instruction.to,
    amount: String(payment.amount),
    token: payment.asset || "USDC"
  };
  const result = await kit.send(params);
  return formatAppKitResult({
    result,
    rail,
    providerTransferId: extractTxHash(result) || result?.id || randomUUID(),
    refId: payment.id
  });
}

export async function createAppKitSourceAdapter({ rail }) {
  if (!config.arc.settlementPrivateKey) {
    throw new Error("App Kit operations require ARC_SETTLEMENT_PRIVATE_KEY");
  }

  if (!rail?.appKitChain) {
    throw new Error(`${rail?.id || "rail"} is not supported by App Kit`);
  }

  const [{ AppKit }, { createViemAdapterFromPrivateKey }, viem] = await Promise.all([
    import("@circle-fin/app-kit"),
    import("@circle-fin/adapter-viem-v2"),
    import("viem")
  ]);
  const { createPublicClient, createWalletClient, http } = viem;
  const rpcUrl = rpcUrlForRail(rail);

  const adapter = createViemAdapterFromPrivateKey({
    privateKey: config.arc.settlementPrivateKey,
    getPublicClient: ({ chain }) => createPublicClient({
      chain,
      transport: http(rpcUrl)
    }),
    getWalletClient: ({ chain, account }) => createWalletClient({
      chain,
      account,
      transport: http(rpcUrl)
    })
  });

  const kit = new AppKit();

  return { kit, adapter };
}

export function formatAppKitResult({ result, rail, providerTransferId, refId }) {
  const txHash = extractTxHash(result);
  const status = normalizeAppKitState(result?.state || result?.status);

  return {
    provider: "circle-app-kit",
    mode: "real",
    providerTransferId: providerTransferId || txHash || result?.id || randomUUID(),
    refId,
    status,
    rawStatus: result?.state || result?.status || "unknown",
    txHash,
    explorerUrl: txHash ? `${rail.explorerBaseUrl}${txHash}` : null,
    chain: rail.appKitChain,
    submittedAt: new Date().toISOString(),
    raw: result
  };
}

function rpcUrlForRail(rail) {
  if (rail.id === "arc-testnet") {
    return config.arc.rpcUrl;
  }

  return rail.rpcUrl || undefined;
}

function normalizeAppKitState(state = "") {
  const normalized = String(state).toLowerCase();
  if (["success", "settled", "confirmed", "complete", "completed"].includes(normalized)) {
    return "settled";
  }

  if (["failed", "failure", "error", "reverted"].includes(normalized)) {
    return "failed";
  }

  return "submitted";
}

export function extractTxHash(result) {
  return result?.txHash
    || result?.transactionHash
    || result?.hash
    || result?.steps?.find((step) => step.txHash || step.transactionHash || step.hash)?.txHash
    || result?.steps?.find((step) => step.txHash || step.transactionHash || step.hash)?.transactionHash
    || result?.steps?.find((step) => step.txHash || step.transactionHash || step.hash)?.hash
    || null;
}
