import { randomUUID } from "node:crypto";
import { circleErrorMessage, getCircleDeveloperClient } from "./circleSdk.js";
import { config } from "./config.js";
import { getSettlementRail } from "./settlement.js";
import { getWalletProfile } from "./walletAccounts.js";
import { executeCircleAppKitBridge, executeCircleAppKitSwap, getCircleAppKitReadiness } from "./appKitCircleAdapter.js";

const ZERO_VALUE = new Set(["0", "0x0", "0x", "", null, undefined]);

export function getDefiExecutionReadiness() {
  return {
    ok: true,
    enabled: config.defi.executionEnabled,
    liveQuotesEnabled: config.defi.liveAdapters,
    provider: "circle_contract_execution",
    backendSignerAllowed: false,
    ready: Boolean(config.defi.executionEnabled && config.defi.liveAdapters && config.circle.apiKey && config.circle.entitySecret),
    appKit: getCircleAppKitReadiness(),
    blockers: [
      ...(!config.defi.executionEnabled ? ["Set DEFI_EXECUTION_ENABLED=1"] : []),
      ...(!config.defi.liveAdapters ? ["Set DEFI_LIVE_ADAPTERS=1 so live route providers return executable requests"] : []),
      ...(!config.circle.apiKey || !config.circle.entitySecret ? ["Configure Circle API key and entity secret"] : [])
    ]
  };
}

export async function submitDefiActionExecution({ action }) {
  const readiness = getDefiExecutionReadiness();
  if (!readiness.ready) {
    return {
      ok: false,
      status: "execution_not_enabled",
      backendSignerAllowed: false,
      readiness,
      reason: readiness.blockers.join("; ")
    };
  }

  if (action.protocol === "circle-app-kit") {
    return submitAppKitDefiExecution({ action, readiness });
  }

  if (action.protocol !== "lifi") {
    throw new Error(`Unsupported DeFi execution protocol: ${action.protocol}`);
  }

  if (action.quote?.mode !== "live") {
    return {
      ok: false,
      status: "live_quote_required",
      backendSignerAllowed: false,
      reason: "Execution requires a live LI.FI quote with transactionRequest"
    };
  }

  const transactionRequest = action.quote?.transactionRequest;
  if (!transactionRequest?.to || !transactionRequest?.data) {
    return {
      ok: false,
      status: "transaction_request_missing",
      backendSignerAllowed: false,
      reason: "LI.FI quote did not include an executable transactionRequest"
    };
  }

  return submitLifiDefiExecution({ action, transactionRequest });
}

async function submitLifiDefiExecution({ action, transactionRequest }) {
  const wallet = walletForAction(action);
  const submissions = action.execution?.submissions ? [...action.execution.submissions] : [];
  const approvalInput = approvalTransactionInput({ action, wallet });
  const approval = submissions.find((item) => item.refId === `${action.id}:approve`);
  const route = submissions.find((item) => item.refId === `${action.id}:route`);

  if (approvalInput && !approval) {
    const submittedApproval = await submitCircleContractExecution({
      ...approvalInput,
      idempotencyKey: circleActionIdempotencyKey(action, "approve")
    });
    submissions.push(submittedApproval);

    return circleExecutionResult({
      action,
      wallet,
      submissions,
      phase: "approval_submitted",
      reason: "Approval submitted; route will submit after allowance is confirmed."
    });
  }

  if (approvalInput && approval?.status !== "settled") {
    return circleExecutionResult({
      action,
      wallet,
      submissions,
      phase: "awaiting_approval",
      reason: "Waiting for approval transaction to settle before submitting route."
    });
  }

  if (!route) {
    submissions.push(await submitCircleContractExecution({
      walletId: wallet.walletId,
      contractAddress: transactionRequest.to,
      callData: transactionRequest.data,
      amount: nativeAmountFromTxValue(transactionRequest.value),
      refId: `${action.id}:route`,
      idempotencyKey: circleActionIdempotencyKey(action, "route")
    }));
  }

  return circleExecutionResult({
    action,
    wallet,
    submissions,
    phase: "route_submitted"
  });
}

function circleExecutionResult({ action, wallet, submissions, phase, reason }) {
  const status = ["approval_submitted", "awaiting_approval"].includes(phase)
    ? "submitted"
    : aggregateSubmissionStatus(submissions);
  return {
    ok: true,
    status,
    provider: "circle",
    mode: "real",
    backendSignerAllowed: false,
    walletId: wallet.walletId,
    fromRail: action.request.fromRail,
    phase,
    reason,
    submissions,
    txHash: submissions.find((item) => item.refId?.endsWith(":route"))?.txHash
      || submissions.find((item) => item.txHash)?.txHash
      || null
  };
}

async function submitAppKitDefiExecution({ action, readiness }) {
  if (!getCircleAppKitReadiness().executionReady) {
    return {
      ok: false,
      status: "execution_not_enabled",
      provider: "circle-app-kit",
      backendSignerAllowed: false,
      readiness,
      reason: getCircleAppKitReadiness().blockers.join("; ")
    };
  }

  const execute = action.type === "bridge" ? executeCircleAppKitBridge : executeCircleAppKitSwap;
  const result = await execute({
    ...action.request,
    handle: action.handle
  });

  return {
    ...result,
    provider: "circle-app-kit",
    mode: "real",
    backendSignerAllowed: false,
    walletId: walletForAction(action).walletId,
    fromRail: action.request.fromRail
  };
}

export async function syncDefiActionExecutionStatus({ action }) {
  const readiness = getDefiExecutionReadiness();
  const execution = action.execution;
  if (!execution?.submissions?.length) {
    return {
      ok: false,
      status: action.status,
      backendSignerAllowed: false,
      reason: "No submitted DeFi execution transactions to reconcile"
    };
  }

  if (execution.provider !== "circle" || execution.mode !== "real") {
    return {
      ...execution,
      ok: true,
      status: action.status,
      backendSignerAllowed: false,
      skipped: true,
      reason: "Only real Circle DeFi executions require provider polling"
    };
  }

  if (!readiness.ready) {
    return {
      ok: false,
      status: action.status,
      backendSignerAllowed: false,
      readiness,
      reason: readiness.blockers.join("; ")
    };
  }

  const submissions = [];
  for (const submission of execution.submissions) {
    if (!submission.providerTransactionId) {
      submissions.push(submission);
      continue;
    }
    submissions.push(await getCircleTransactionStatus(submission));
  }

  const approval = submissions.find((item) => item.refId === `${action.id}:approve`);
  const route = submissions.find((item) => item.refId === `${action.id}:route`);
  if (approval?.status === "settled" && !route && action.quote?.transactionRequest?.to && action.quote?.transactionRequest?.data) {
    const wallet = walletForAction(action);
    submissions.push(await submitCircleContractExecution({
      walletId: wallet.walletId,
      contractAddress: action.quote.transactionRequest.to,
      callData: action.quote.transactionRequest.data,
      amount: nativeAmountFromTxValue(action.quote.transactionRequest.value),
      refId: `${action.id}:route`,
      idempotencyKey: circleActionIdempotencyKey(action, "route")
    }));
  }

  const status = aggregateSubmissionStatus(submissions);
  return {
    ...execution,
    ok: true,
    status,
    backendSignerAllowed: false,
    submissions,
    txHash: submissions.find((item) => item.refId?.endsWith(":route"))?.txHash
      || submissions.find((item) => item.txHash)?.txHash
      || null,
    checkedAt: new Date().toISOString()
  };
}

async function submitCircleContractExecution(input) {
  const idempotencyKey = isUuidV4(input.idempotencyKey) ? input.idempotencyKey : randomUUID();
  let response;
  try {
    response = await getCircleDeveloperClient().createContractExecutionTransaction({
      idempotencyKey,
      walletId: input.walletId,
      contractAddress: input.contractAddress,
      callData: input.callData,
      abiFunctionSignature: input.abiFunctionSignature,
      abiParameters: input.abiParameters,
      amount: input.amount || "0",
      fee: {
        type: "level",
        config: {
          feeLevel: "MEDIUM"
        }
      },
      refId: input.refId
    });
  } catch (error) {
    throw new Error(circleErrorMessage(error, "Circle contract execution failed"));
  }

  const data = response.data || response;
  const transaction = data.transaction || data.data || data;
  const rawStatus = transaction.state || transaction.status || "SUBMITTED";
  return {
    providerTransactionId: transaction.id,
    status: normalizeCircleStatus(rawStatus),
    rawStatus,
    txHash: transaction.txHash || transaction.transactionHash || null,
    refId: input.refId,
    submittedAt: new Date().toISOString()
  };
}

function circleActionIdempotencyKey(action, step) {
  action.circleIdempotencyKeys ||= {};
  action.circleIdempotencyKeys[step] ||= randomUUID();
  return action.circleIdempotencyKeys[step];
}

function isUuidV4(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function getCircleTransactionStatus(submission) {
  let response;
  try {
    response = await getCircleDeveloperClient().getTransaction({
      id: submission.providerTransactionId
    });
  } catch (error) {
    throw new Error(circleErrorMessage(error, "Circle transaction status check failed"));
  }

  const data = response.data || response;
  const transaction = data.transaction || data.data?.transaction || data.data || data;
  const rawStatus = transaction.state || transaction.status || submission.rawStatus || "SUBMITTED";
  return {
    ...submission,
    status: normalizeCircleStatus(rawStatus),
    rawStatus,
    txHash: transaction.txHash || transaction.transactionHash || submission.txHash || null,
    errorReason: transaction.errorReason || transaction.errorDetails || null,
    checkedAt: new Date().toISOString()
  };
}

function approvalTransactionInput({ action, wallet }) {
  const approvalAddress = action.quote?.raw?.estimate?.approvalAddress
    || action.quote?.raw?.action?.approvalAddress
    || action.quote?.raw?.approvalAddress;
  if (!approvalAddress) return null;

  const tokenAddress = tokenContractAddress(action);
  if (!tokenAddress) return null;

  return {
    walletId: wallet.walletId,
    contractAddress: tokenAddress,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [
      approvalAddress,
      action.quote?.request?.fromAmount || action.quote?.raw?.action?.fromAmount || toTokenUnits(action.request.amount, 6)
    ],
    amount: "0",
    refId: `${action.id}:approve`
  };
}

function tokenContractAddress(action) {
  const fromToken = String(action.request.fromToken || "USDC").toUpperCase();
  if (fromToken === "USDC") {
    return getSettlementRail(action.request.fromRail).usdcAddress;
  }
  if (fromToken === "CIRBTC") {
    return getSettlementRail(action.request.fromRail).cirbtcAddress || action.quote?.raw?.action?.fromToken?.address || null;
  }
  return action.quote?.raw?.action?.fromToken?.address || null;
}

function walletForAction(action) {
  const profile = getWalletProfile(action.handle);
  const wallet = profile.wallets.find((item) => item.rail === action.request.fromRail);
  if (!wallet?.id) {
    throw new Error(`No Circle wallet id found for ${action.handle} on ${action.request.fromRail}`);
  }
  return {
    walletId: wallet.id,
    address: wallet.address
  };
}

function nativeAmountFromTxValue(value) {
  if (ZERO_VALUE.has(value)) return "0";
  const raw = String(value);
  const wei = raw.startsWith("0x") ? BigInt(raw) : BigInt(raw);
  const whole = wei / 10n ** 18n;
  const fraction = wei % (10n ** 18n);
  const fractionText = fraction.toString().padStart(18, "0").replace(/0+$/, "");
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

function toTokenUnits(amount, decimals) {
  return String(Math.round(Number(amount || 0) * 10 ** decimals));
}

function normalizeCircleStatus(rawStatus = "") {
  const status = String(rawStatus).toUpperCase();
  if (["CONFIRMED", "COMPLETE", "COMPLETED"].includes(status)) return "settled";
  if (["FAILED", "CANCELLED", "DENIED"].includes(status)) return "failed";
  return "submitted";
}

function aggregateSubmissionStatus(submissions) {
  if (submissions.some((item) => item.status === "failed")) return "failed";
  if (submissions.length && submissions.every((item) => item.status === "settled")) return "settled";
  return "submitted";
}
