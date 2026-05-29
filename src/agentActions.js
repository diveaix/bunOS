import { completeApproval, getApproval } from "./approvals.js";
import { confirmAirdrop } from "./airdrops.js";
import { confirmDefiAction } from "./defiOrchestrator.js";
import { confirmPayment } from "./orchestrator.js";
import { confirmPerpProposal } from "./perpsAgent.js";
import { confirmCopyTradeProposal } from "./socialTradingAgent.js";

export async function confirmAction({ approvalId, handle } = {}) {
  const approval = getApproval(approvalId);
  if (handle && approval.handle !== normalizeHandleLocal(handle)) {
    throw new Error("Approval does not belong to this handle");
  }

  if (approval.status === "approved") {
    return { ok: true, approval, skipped: true };
  }

  if (approval.status !== "pending") {
    throw new Error(`Approval cannot be confirmed from status: ${approval.status}`);
  }

  let result;
  if (approval.kind === "payment") {
    result = await confirmPayment({ paymentId: approval.targetId });
  } else if (approval.kind === "defi_action") {
    result = await confirmDefiAction({ actionId: approval.targetId, handle: approval.handle });
  } else if (approval.kind === "copy_trade") {
    result = confirmCopyTradeProposal({ proposalId: approval.targetId });
  } else if (approval.kind === "perp_trade") {
    result = confirmPerpProposal({ proposalId: approval.targetId });
  } else if (approval.kind === "airdrop") {
    result = await confirmAirdrop({ airdropId: approval.targetId });
  } else {
    throw new Error(`Unsupported approval kind: ${approval.kind}`);
  }

  const completed = completeApproval({ approvalId, status: "approved", result });
  return { ok: true, approval: completed, result };
}

function normalizeHandleLocal(handle) {
  const value = String(handle || "").trim().toLowerCase();
  return value.startsWith("@") ? value : `@${value}`;
}
