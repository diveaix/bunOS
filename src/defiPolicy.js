import { config } from "./config.js";
import { userDefiPolicy } from "./tradeRisk.js";

const highRiskActions = new Set(["polymarket_order", "hyperliquid_order"]);

export function evaluateDefiPolicy({ user, action, simulation = null }) {
  if (!user?.onboarded) {
    return deny("User must connect X and create a wallet first");
  }

  const policy = userDefiPolicy(user);

  if (!config.defi.allowedProtocols.includes(action.protocol)) {
    return deny(`${action.protocol} is not enabled`);
  }

  const maxActionUsd = Math.min(config.defi.maxActionUsd, policy.maxTradeUsd);
  if (action.amountUsd && Number(action.amountUsd) > maxActionUsd) {
    return deny(`Amount exceeds DeFi action limit of ${maxActionUsd} USD`);
  }

  if (action.slippage && Number(action.slippage) > policy.maxSlippage) {
    return deny(`Slippage exceeds max of ${policy.maxSlippage}`);
  }

  if (!policy.allowedRails.includes(action.fromRail) || !policy.allowedRails.includes(action.toRail)) {
    return deny(`Rail is not allowed by user policy: ${action.fromRail} -> ${action.toRail}`);
  }

  const requestedAssets = [action.fromToken, action.toToken].filter(Boolean);
  const disallowedAsset = requestedAssets.find((asset) => !assetAllowed(asset, policy.allowedAssets));
  if (disallowedAsset) {
    return deny(`Asset is not allowed by user DeFi policy: ${disallowedAsset}`);
  }

  if (simulation?.blockers?.length) {
    return deny(simulation.blockers[0]);
  }

  const requiresConfirmation = highRiskActions.has(action.type);
  return {
    approved: true,
    requiresConfirmation,
    reason: requiresConfirmation ? "Human confirmation required before execution" : "Policy approved for immediate execution",
    warnings: simulation?.warnings || [],
    simulation: simulation ? {
      recommendation: simulation.recommendation,
      estimatedFeeUsd: simulation.estimatedFeeUsd,
      feeRatio: simulation.feeRatio,
      postTradeSourceBalance: simulation.postTradeSourceBalance
    } : null
  };
}

function deny(reason) {
  return {
    approved: false,
    requiresConfirmation: false,
    reason
  };
}

function assetAllowed(asset, allowedAssets) {
  if (/^0x[a-fA-F0-9]{40}$/.test(String(asset || ""))) return true;
  const value = String(asset || "").toUpperCase();
  return allowedAssets.map((item) => String(item || "").toUpperCase()).includes(value);
}
