export function evaluatePolicy({ sender, amount, asset, settlementRail }) {
  if (!sender?.onboarded) {
    return deny("Sender must onboard and connect a wallet first");
  }

  const policy = sender.policy;
  if (!policy) {
    return deny("Sender does not have an ArcPay spending policy");
  }

  if (!policy.allowedAssets.includes(asset)) {
    return deny(`${asset} is not allowed by sender policy`);
  }

  if (!policy.allowedSettlementRails.includes(settlementRail)) {
    return deny(`${settlementRail} is not allowed by sender policy`);
  }

  if (amount > policy.maxPerPayment) {
    return deny(`Amount exceeds max per payment of ${policy.maxPerPayment} ${asset}`);
  }

  return {
    approved: true,
    requiresConfirmation: amount > policy.requireConfirmationAbove,
    reason: "Policy approved"
  };
}

function deny(reason) {
  return {
    approved: false,
    requiresConfirmation: false,
    reason
  };
}
