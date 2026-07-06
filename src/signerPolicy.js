export function circleUserSigner({
  operation,
  settlementRail,
  requiresUserApproval = true,
  executionStatus = "policy_checked"
} = {}) {
  return {
    operation,
    signerType: "circle_user_wallet",
    signerScope: "per_user",
    backendSignerAllowed: false,
    settlementRail: settlementRail || null,
    gasPayer: "circle_wallet_or_paymaster",
    requiresUserApproval: Boolean(requiresUserApproval),
    executionStatus
  };
}

export function userWalletSigningRequired({
  operation,
  settlementRail,
  reason = "A user-owned signing adapter is required before this action can execute."
} = {}) {
  return {
    operation,
    signerType: "user_wallet_required",
    signerScope: "per_user",
    backendSignerAllowed: false,
    settlementRail: settlementRail || null,
    gasPayer: "user_wallet_or_paymaster",
    requiresUserApproval: true,
    executionStatus: "user_wallet_signing_required",
    reason
  };
}

export function readOnlySigner({ operation, settlementRail } = {}) {
  return {
    operation,
    signerType: "none",
    signerScope: "read_only",
    backendSignerAllowed: false,
    settlementRail: settlementRail || null,
    gasPayer: "none",
    requiresUserApproval: false,
    executionStatus: "read_only"
  };
}

