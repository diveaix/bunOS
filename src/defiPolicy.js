import { config } from "./config.js";

const highRiskActions = new Set(["polymarket_order", "hyperliquid_order"]);

export function evaluateDefiPolicy({ user, action }) {
  if (!user?.onboarded) {
    return deny("User must connect X and create a wallet first");
  }

  if (!config.defi.allowedProtocols.includes(action.protocol)) {
    return deny(`${action.protocol} is not enabled`);
  }

  if (action.amountUsd && Number(action.amountUsd) > config.defi.maxActionUsd) {
    return deny(`Amount exceeds DeFi action limit of ${config.defi.maxActionUsd} USD`);
  }

  if (action.slippage && Number(action.slippage) > config.defi.maxSlippage) {
    return deny(`Slippage exceeds max of ${config.defi.maxSlippage}`);
  }

  const requiresConfirmation = highRiskActions.has(action.type);
  return {
    approved: true,
    requiresConfirmation,
    reason: requiresConfirmation ? "Human confirmation required before execution" : "Policy approved for immediate execution"
  };
}

function deny(reason) {
  return {
    approved: false,
    requiresConfirmation: false,
    reason
  };
}
