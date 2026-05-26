import { ledger } from "./fixtures.js";
import { normalizeHandle } from "./identity.js";
import { nextApprovalId, nextEventId } from "./ids.js";

export function createApproval({
  handle,
  kind,
  targetId,
  title,
  summary,
  risk = "medium",
  metadata = {}
}) {
  const normalized = normalizeHandle(handle);
  const existing = ledger.approvals.find((approval) => (
    approval.status === "pending"
    && approval.kind === kind
    && approval.targetId === targetId
    && approval.handle === normalized
  ));

  if (existing) {
    return existing;
  }

  const approval = {
    id: nextApprovalId(),
    handle: normalized,
    kind,
    targetId,
    title,
    summary,
    risk,
    metadata,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  ledger.approvals.push(approval);
  recordApprovalEvent("approval_created", approval);
  return approval;
}

export function listApprovals({ handle, status, kind, limit = 50 } = {}) {
  const normalized = handle ? normalizeHandle(handle) : null;
  const approvals = ledger.approvals
    .filter((approval) => (
      (!normalized || approval.handle === normalized)
      && (!status || approval.status === status)
      && (!kind || approval.kind === kind)
    ))
    .slice()
    .reverse()
    .slice(0, Number(limit) || 50);

  return { ok: true, approvals };
}

export function getApproval(approvalId) {
  const approval = ledger.approvals.find((item) => item.id === approvalId);
  if (!approval) {
    throw new Error("Approval not found");
  }

  return approval;
}

export function completeApproval({ approvalId, status = "approved", result }) {
  const approval = getApproval(approvalId);
  approval.status = status;
  approval.completedAt = new Date().toISOString();
  approval.result = result || null;
  recordApprovalEvent(`approval_${status}`, approval);
  return approval;
}

export function rejectApproval({ approvalId, reason = "Rejected by user" }) {
  const approval = getApproval(approvalId);
  approval.status = "rejected";
  approval.rejectedAt = new Date().toISOString();
  approval.reason = reason;
  recordApprovalEvent("approval_rejected", approval);
  return { ok: true, approval };
}

function recordApprovalEvent(type, approval) {
  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type,
    approvalId: approval.id,
    handle: approval.handle,
    kind: approval.kind,
    targetId: approval.targetId,
    status: approval.status
  });
}
