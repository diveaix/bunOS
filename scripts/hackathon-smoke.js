import { config } from "../src/config.js";
import { runAgentAction } from "../src/agentPlanner.js";
import { getBuildPreflight } from "../src/preflight.js";
import { getXCommandReceipt, processXPaymentEvent } from "../src/xPayments.js";
import { createWallet, getWalletCapabilities } from "../src/walletAccounts.js";
import { persistStore } from "../src/store.js";

const handle = argValue("--handle") || "@sara";
const rail = argValue("--rail") || "arc-testnet";
const hostUrl = new URL(config.appBaseUrl || `http://localhost:${process.env.PORT || 4317}`);
const runId = `smoke_${Date.now()}`;
const steps = [];

await record("create_wallet", async () => {
  const result = await createWallet({
    handle,
    settlementRails: ["arc-testnet", "base-sepolia"]
  });
  return {
    handle: result.wallet.handle,
    walletSetId: result.wallet.walletSetId || null,
    rails: result.wallet.wallets.map((wallet) => wallet.rail)
  };
});

await record("wallet_capabilities", async () => {
  const capabilities = getWalletCapabilities(handle);
  return {
    signerModel: capabilities.signerModel,
    backendSignerAllowed: capabilities.backendSignerAllowed,
    canSendUsdc: capabilities.capabilities.sendUsdc,
    bridgeExecution: capabilities.rails[0]?.bridgeStatus || capabilities.capabilities.bridgeUsdc,
    swapExecution: capabilities.rails[0]?.swapStatus || capabilities.capabilities.swap,
    perpsExecution: capabilities.rails[0]?.perpsStatus || capabilities.capabilities.perps
  };
});

await record("agent_send_usdc", async () => {
  const result = await runAgentAction({
    handle,
    text: "send 1 usdc to @bob",
    defaultSettlementRail: rail,
    source: "hackathon-smoke",
    idempotencyKey: `${runId}:send`
  });
  return compactAgentRun(result);
});

await record("agent_bridge_quote", async () => {
  const result = await runAgentAction({
    handle,
    text: "bridge 5 usdc from arc to base",
    defaultSettlementRail: rail,
    source: "hackathon-smoke",
    idempotencyKey: `${runId}:bridge`
  });
  return compactAgentRun(result);
});

await record("agent_swap_quote", async () => {
  const result = await runAgentAction({
    handle,
    text: "swap 3 usdc to eth",
    defaultSettlementRail: rail,
    source: "hackathon-smoke",
    idempotencyKey: `${runId}:swap`
  });
  return compactAgentRun(result);
});

await record("x_perps_command", async () => {
  const result = await processXPaymentEvent({
    actorHandle: handle,
    text: "@bunOS long BTC with 5 USDC at 2x",
    postId: `${runId}_perp`,
    eventId: `${runId}:perp`,
    settlementRail: rail,
    source: "hackathon-smoke"
  });
  const receipt = getXCommandReceipt({
    commandId: result.command.id,
    host: hostUrl.host,
    protocol: hostUrl.protocol.replace(":", "")
  }).receipt;
  return {
    commandId: result.command.id,
    commandStatus: result.command.status,
    proposalId: result.proposal?.id || null,
    proposalStatus: result.proposal?.status || null,
    approvalId: result.approval?.id || null,
    publicUrl: receipt.publicUrl,
    reply: receipt.reply
  };
});

await record("preflight", async () => {
  const result = await getBuildPreflight();
  return {
    localReadyPct: result.localReadyPct,
    launchReadyPct: result.launchReadyPct,
    launchBlockers: result.launchBlockers.map((blocker) => blocker.label)
  };
});

await persistStore();

const summary = {
  ok: steps.every((step) => step.ok),
  runId,
  handle,
  rail,
  providerMode: config.providerMode,
  transferProvider: config.transferProvider,
  appBaseUrl: config.appBaseUrl,
  backendSignerPolicy: "No user-facing action may use ARC_SETTLEMENT_PRIVATE_KEY.",
  steps
};

console.log(JSON.stringify(summary, null, 2));

async function record(name, run) {
  try {
    steps.push({
      name,
      ok: true,
      result: await run()
    });
  } catch (error) {
    steps.push({
      name,
      ok: false,
      error: error.message
    });
  }
}

function compactAgentRun(result) {
  return {
    ok: result.ok,
    tool: result.planned?.plan?.tool || null,
    canExecuteNow: result.planned?.plan?.canExecuteNow || false,
    nextAction: result.nextAction,
    signer: {
      signerType: result.signer?.signerType || null,
      executionStatus: result.signer?.executionStatus || null,
      backendSignerAllowed: result.signer?.backendSignerAllowed
    },
    paymentId: result.result?.payment?.id || null,
    paymentStatus: result.result?.payment?.status || null,
    actionId: result.result?.action?.id || null,
    actionStatus: result.result?.action?.status || null,
    approvalId: result.result?.approval?.id || result.result?.payment?.approvalId || null,
    error: result.result?.error || result.result?.event?.reason || null
  };
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1] || null;
  return value && !value.startsWith("--") ? value : null;
}
