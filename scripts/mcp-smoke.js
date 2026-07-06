import { callMcpTool, mcpTools } from "../src/mcp.js";
import { persistStore } from "../src/store.js";

const handle = argValue("--handle") || "@sara";
const executeSend = process.argv.includes("--execute-send");
const steps = [];

await record("tools_list", async () => {
  const names = mcpTools.map((tool) => tool.name).sort();
  const removed = [
    "x_reply_readiness",
    "post_x_command_reply",
    "rank_social_traders",
    "search_prediction_markets"
  ];
  return {
    count: names.length,
    removedToolsAbsent: removed.every((name) => !names.includes(name)),
    coreToolsPresent: [
      "create_wallet",
      "get_balance",
      "get_wallet_capabilities",
      "send_usdc",
      "bridge_usdc",
      "demo_bridge_arc_to_base",
      "quote_swap",
      "list_defi_actions",
      "get_defi_action_receipt",
      "reconcile_defi_action",
      "propose_perp_trade",
      "arc_perps_readiness"
    ].every((name) => names.includes(name)),
    names
  };
});

await record("create_wallet", async () => {
  const result = await callMcpTool("create_wallet", { handle });
  return {
    handle: result.wallet.handle,
    walletSetId: result.wallet.walletSetId || null,
    rails: result.wallet.wallets.map((wallet) => wallet.rail)
  };
});

await record("wallet_capabilities", async () => {
  const result = await callMcpTool("get_wallet_capabilities", { handle });
  return {
    signerModel: result.signerModel,
    backendSignerAllowed: result.backendSignerAllowed,
    sendUsdc: result.capabilities.sendUsdc,
    bridgeUsdc: result.capabilities.bridgeUsdc,
    swap: result.capabilities.swap,
    perps: result.capabilities.perps
  };
});

let defiExecution = null;
await record("defi_execution_readiness", async () => {
  const result = await callMcpTool("list_defi_tools", {});
  defiExecution = result.execution;
  return {
    ready: result.execution.ready,
    enabled: result.execution.enabled,
    liveQuotesEnabled: result.execution.liveQuotesEnabled,
    provider: result.execution.provider,
    backendSignerAllowed: result.execution.backendSignerAllowed,
    blockers: result.execution.blockers
  };
});

await record(executeSend ? "send_usdc" : "plan_send_usdc", async () => {
  if (executeSend) {
    const result = await callMcpTool("send_usdc", {
      senderHandle: handle,
      recipientHandle: "@bob",
      amount: 1,
      settlementRail: "arc-testnet",
      memo: "mcp smoke"
    });
    return {
      ok: result.ok,
      paymentId: result.payment.id,
      status: result.payment.status,
      signer: result.payment.signer
    };
  }

  const result = await callMcpTool("plan_agent_action", {
    handle,
    text: "send 1 usdc to @bob"
  });
  return {
    tool: result.plan.tool,
    canExecuteNow: result.plan.canExecuteNow,
    signer: result.signer
  };
});

await record("bridge_usdc_quote", async () => {
  const result = await callMcpTool("bridge_usdc", {
    handle,
    amount: 5,
    fromRail: "arc-testnet",
    toRail: "base-sepolia",
    slippage: 0.005
  });
  return compactDefiResult(result);
});

await record("demo_bridge_arc_to_base", async () => {
  const result = await callMcpTool("demo_bridge_arc_to_base", {
    handle,
    amount: 2,
    slippage: 0.005
  });
  return {
    ok: result.ok,
    demo: result.demo,
    backendSignerAllowed: result.backendSignerAllowed,
    walletRails: result.wallet.wallets.map((wallet) => wallet.rail),
    approvalId: result.approvalId,
    quote: compactDefiResult(result.quote)
  };
});

await record("quote_swap", async () => {
  const result = await callMcpTool("quote_swap", {
    handle,
    amount: 3,
    settlementRail: "arc-testnet",
    fromToken: "USDC",
    toToken: "EURC",
    slippage: 0.005
  });
  return compactDefiResult(result);
});

await record("list_defi_actions", async () => {
  const result = await callMcpTool("list_defi_actions", {
    handle,
    limit: 5
  });
  return {
    ok: result.ok,
    count: result.actions.length,
    latest: result.actions[0] ? compactAction(result.actions[0]) : null
  };
});

await record("get_defi_action_receipt", async () => {
  const listed = await callMcpTool("list_defi_actions", { handle, limit: 1 });
  const action = listed.actions[0];
  if (!action) return { skipped: true, reason: "No DeFi actions" };
  const result = await callMcpTool("get_defi_action_receipt", {
    actionId: action.id,
    host: "localhost:4319"
  });
  return {
    ok: result.ok,
    actionId: action.id,
    publicUrl: result.receipt.publicUrl,
    nextAction: result.receipt.nextAction
  };
});

await record("reconcile_defi_action", async () => {
  const listed = await callMcpTool("list_defi_actions", { handle, limit: 1 });
  const action = listed.actions[0];
  if (!action) return { skipped: true, reason: "No DeFi actions" };
  const result = await callMcpTool("reconcile_defi_action", { actionId: action.id });
  return {
    ok: result.ok,
    jobId: result.job.id,
    skipped: result.result.skipped,
    status: result.result.status
  };
});

await record("propose_perp_trade", async () => {
  const result = await callMcpTool("propose_perp_trade", {
    handle,
    symbol: "BTC",
    side: "long",
    collateralUsd: 10,
    leverage: 2,
    settlementRail: "arc-testnet"
  });
  return {
    ok: result.ok,
    proposalId: result.proposal.id,
    status: result.proposal.status,
    approvalId: result.approval.id,
    signer: result.proposal.signer
  };
});

await record("arc_perps_readiness", async () => {
  const result = await callMcpTool("arc_perps_readiness", {});
  return {
    ok: result.ok,
    rail: result.rail,
    backendSignerAllowed: result.backendSignerAllowed,
    executionEnabled: result.executionEnabled,
    vaultAddress: result.vaultAddress || null
  };
});

await persistStore();

console.log(JSON.stringify({
  ok: steps.every((step) => step.ok),
  handle,
  executeSend,
  bridgeStatus: defiExecution?.ready ? "circle_contract_execution_after_confirmation" : "quote_only_until_execution_enabled",
  swapStatus: defiExecution?.ready ? "circle_contract_execution_after_confirmation" : "quote_only_until_execution_enabled",
  steps
}, null, 2));

async function record(name, run) {
  try {
    steps.push({ name, ok: true, result: await run() });
  } catch (error) {
    steps.push({ name, ok: false, error: error.message });
  }
}

function compactDefiResult(result) {
  return {
    ok: result.ok,
    actionId: result.action?.id || null,
    type: result.action?.type || null,
    status: result.action?.status || null,
    nextAction: result.nextAction,
    quoteProvider: result.quote?.provider || null,
    quoteMode: result.quote?.mode || null,
    signer: result.action?.signer || null
  };
}

function compactAction(action) {
  return {
    id: action.id,
    type: action.type,
    status: action.status,
    protocol: action.protocol,
    approvalId: action.approvalId || null
  };
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1] || null;
  return value && !value.startsWith("--") ? value : null;
}
