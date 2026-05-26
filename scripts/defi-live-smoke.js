import { config } from "../src/config.js";
import { quoteDefiRoute, confirmDefiAction, getDefiActionReceipt } from "../src/defiOrchestrator.js";
import { runJob } from "../src/jobs.js";
import { loadStore, persistStore } from "../src/store.js";
import { createWallet, syncWalletBalances } from "../src/walletAccounts.js";

await loadStore();

const handle = argValue("--handle") || `@live${Date.now().toString().slice(-6)}`;
const amount = Number(argValue("--amount") || 1);
const confirm = process.argv.includes("--confirm");
const host = argValue("--host") || "localhost:4319";
const steps = [];

await record("readiness", async () => ({
  providerMode: config.providerMode,
  transferProvider: config.transferProvider,
  liveAdapters: config.defi.liveAdapters,
  executionEnabled: config.defi.executionEnabled,
  circleReady: Boolean(config.circle.apiKey && config.circle.entitySecret && config.circle.walletSetId),
  backendSignerAllowed: false
}));

let walletAddress = null;
await record("create_wallet", async () => {
  const result = await createWallet({
    handle,
    settlementRails: ["arc-testnet", "base-sepolia"]
  });
  walletAddress = result.wallet.walletAddress;
  return {
    reused: result.reused || false,
    handle: result.wallet.handle,
    walletSetId: result.wallet.walletSetId,
    wallets: result.wallet.wallets.map((wallet) => ({
      rail: wallet.rail,
      id: wallet.id,
      address: wallet.address
    }))
  };
});

await record("sync_balances", async () => {
  const result = await syncWalletBalances({ handle });
  return {
    balances: result.wallet.balances,
    synced: result.synced.map((item) => ({
      rail: item.rail,
      amount: item.amount,
      token: item.token?.symbol || item.token?.name || null
    }))
  };
});

const routes = [
  {
    name: "bridge_arc_to_base",
    input: {
      type: "bridge",
      fromRail: "arc-testnet",
      toRail: "base-sepolia",
      fromToken: "USDC",
      toToken: "USDC"
    }
  },
  {
    name: "swap_arc_usdc_to_eurc",
    input: {
      type: "swap",
      fromRail: "arc-testnet",
      toRail: "arc-testnet",
      fromToken: "USDC",
      toToken: "EURC"
    }
  },
  {
    name: "swap_base_usdc_to_weth",
    input: {
      type: "swap",
      fromRail: "base-sepolia",
      toRail: "base-sepolia",
      fromToken: "USDC",
      toToken: "WETH"
    }
  }
];

for (const route of routes) {
  let actionId = null;
  let jobId = null;
  await record(`quote_${route.name}`, async () => {
    const result = await quoteDefiRoute({
      handle,
      amount,
      slippage: 0.005,
      source: "defi-live-smoke",
      ...route.input
    });
    actionId = result.action?.id || null;
    if (!result.ok || !["requires_confirmation", "quoted"].includes(result.action?.status)) {
      actionId = null;
    }
    return compactQuote(result);
  });

  if (!confirm || !actionId) continue;

  await record(`confirm_${route.name}`, async () => {
    const result = await confirmDefiAction({ actionId, handle });
    jobId = result.job?.id || null;
    return {
      ok: result.ok,
      actionId,
      status: result.action.status,
      jobId
    };
  });

  if (!jobId) continue;

  await record(`execute_${route.name}`, async () => {
    const result = await runJob({ jobId });
    return {
      ok: result.ok,
      jobStatus: result.job.status,
      actionStatus: result.result?.status,
      execution: result.result?.execution || null
    };
  });

  await record(`receipt_${route.name}`, async () => {
    const result = getDefiActionReceipt({ actionId, host });
    return {
      ok: result.ok,
      status: result.receipt.action.status,
      txHash: result.receipt.txHash,
      explorerUrl: result.receipt.explorerUrl,
      publicUrl: result.receipt.publicUrl,
      nextAction: result.receipt.nextAction
    };
  });
}

await persistStore();

console.log(JSON.stringify({
  ok: steps.every((step) => step.ok),
  handle,
  walletAddress,
  amount,
  confirm,
  summary: summarize(steps),
  steps
}, null, 2));

async function record(name, run) {
  try {
    steps.push({ name, ok: true, result: await run() });
  } catch (error) {
    steps.push({ name, ok: false, error: error.message });
  }
}

function compactQuote(result) {
  return {
    ok: result.ok,
    reason: result.reason || result.action?.reason || null,
    actionId: result.action?.id || null,
    status: result.action?.status || null,
    quoteMode: result.quote?.mode || null,
    executable: result.quote?.executable || false,
    provider: result.quote?.provider || null,
    tool: result.quote?.estimate?.tool || null,
    approvalId: result.action?.approvalId || null,
    signer: result.action?.signer || null
  };
}

function summarize(items) {
  const quotes = items.filter((step) => step.name.startsWith("quote_"));
  return {
    ready: items.find((step) => step.name === "readiness")?.result || null,
    executableQuotes: quotes.filter((step) => step.result?.executable).length,
    quoteUnavailable: quotes.filter((step) => step.result?.status === "quote_unavailable").length,
    failures: items.filter((step) => !step.ok).map((step) => ({ name: step.name, error: step.error }))
  };
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1] || null;
  return value && !value.startsWith("--") ? value : null;
}
