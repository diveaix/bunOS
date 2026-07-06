import { getSettlementRail, listSettlementRails } from "./settlement.js";
import { userWalletSigningRequired } from "./signerPolicy.js";
import { getWalletProfile } from "./walletAccounts.js";
import {
  estimateCircleAppKitBridge,
  estimateCircleAppKitSwap,
  executeCircleAppKitBridge,
  executeCircleAppKitSwap,
  getCircleAppKitReadiness
} from "./appKitCircleAdapter.js";

export async function getAppKitReadiness() {
  const kit = await import("@circle-fin/app-kit")
    .then(({ AppKit }) => new AppKit())
    .catch(() => null);
  const installed = Boolean(kit);
  const supported = kit ? getSupportedChainsSnapshot(kit) : {};
  const circleReadiness = getCircleAppKitReadiness();
  const rails = listSettlementRails().map((rail) => ({
    id: rail.id,
    label: rail.label,
    mode: rail.mode,
    appKitChain: rail.appKitChain || null,
    send: false,
    bridge: false,
    swap: false,
    unifiedBalance: false,
    supportedByAppKit: {
      bridge: Boolean(rail.appKitChain && supported.bridge?.some((chain) => chain.chain === rail.appKitChain)),
      swap: Boolean(rail.appKitChain && supported.swap?.some((chain) => chain.chain === rail.appKitChain)),
      unifiedBalance: Boolean(rail.appKitChain && supported.unifiedBalance?.some((chain) => chain.chain === rail.appKitChain))
    }
  }));

  return {
    ok: installed,
    mode: circleReadiness.executionReady ? "circle-user-wallet-execution" : "circle-user-wallet-estimates",
    source: "Circle AppKit with per-user Circle wallets",
    backendSignerAllowed: false,
    executionEnabled: circleReadiness.executionReady,
    unifiedBalanceEnabled: circleReadiness.unifiedBalanceEnabled,
    rails,
    supported,
    blockers: installed ? circleReadiness.blockers : ["@circle-fin/app-kit is not installed"],
    circle: circleReadiness
  };
}

export async function listAppKitCapabilities() {
  const readiness = await getAppKitReadiness();
  return {
    ok: readiness.ok,
    executionEnabled: readiness.executionEnabled,
    backendSignerAllowed: false,
    capabilities: [
      {
        id: "circle_user_send_usdc",
        operation: "send",
        description: "Use send_usdc for user-owned Circle wallet transfers."
      },
      {
        id: "quote_defi_route",
        operation: "bridge_or_swap_quote",
        description: "Create a confirmation-gated AppKit bridge/swap quote for a user wallet."
      },
      {
        id: "circle_appkit_user_adapter",
        operation: "appkit_user_wallet_execution",
        description: "AppKit uses a Circle-wallet viem adapter with developer-controlled address context. It does not use ARC_SETTLEMENT_PRIVATE_KEY."
      }
    ],
    rails: readiness.rails,
    supported: readiness.supported,
    note: "The MCP server no longer exposes backend-signer AppKit execution. User money routes through per-user Circle wallets."
  };
}

export async function estimateAppKitSend(input = {}) {
  return userWalletRequired("appkit_estimate_send", input);
}

export async function executeAppKitSend(input = {}) {
  return userWalletRequired("appkit_send_usdc", input);
}

export async function estimateAppKitBridge(input = {}) {
  try {
    return await estimateCircleAppKitBridge(input);
  } catch (error) {
    return appKitUnavailable("appkit_estimate_bridge", input, error);
  }
}

export async function executeAppKitBridge(input = {}) {
  try {
    return await executeCircleAppKitBridge(input);
  } catch (error) {
    return appKitUnavailable("appkit_bridge_usdc", input, error);
  }
}

export async function estimateAppKitSwap(input = {}) {
  try {
    return await estimateCircleAppKitSwap(input);
  } catch (error) {
    return appKitUnavailable("appkit_estimate_swap", input, error);
  }
}

export async function executeAppKitSwap(input = {}) {
  try {
    return await executeCircleAppKitSwap(input);
  } catch (error) {
    return appKitUnavailable("appkit_swap", input, error);
  }
}

export async function getAppKitUnifiedBalance(input = {}) {
  return userWalletRequired("appkit_unified_balance", input);
}

function userWalletRequired(tool, input) {
  const handle = input.handle || input.senderHandle || input.recipientHandle || null;
  const wallet = handle ? safeWalletProfile(handle) : null;
  return {
    ok: false,
    tool,
    status: "user_wallet_signing_required",
    backendSignerAllowed: false,
    signer: userWalletSigningRequired({
      operation: tool,
      settlementRail: input.settlementRail || input.fromRail,
      reason: "This AppKit action needs a user-owned Circle/AppKit signing adapter."
    }),
    message: "This tool is disabled until it can execute with the user's Circle wallet or an explicit user-delegated signing adapter. It will not use ARC_SETTLEMENT_PRIVATE_KEY.",
    recommendedTool: tool.includes("send") ? "send_usdc" : "quote_defi_route",
    wallet
  };
}

function appKitUnavailable(tool, input, error) {
  return {
    ...userWalletRequired(tool, input),
    status: "appkit_unavailable",
    reason: error.message,
    message: `Circle AppKit could not prepare this action: ${error.message}`
  };
}

function safeWalletProfile(handle) {
  try {
    return getWalletProfile(handle);
  } catch {
    return null;
  }
}

function getSupportedChainsSnapshot(kit) {
  try {
    const summarize = (chain) => ({
      chain: chain.chain,
      name: chain.name || chain.title,
      chainId: chain.chainId,
      type: chain.type,
      isTestnet: Boolean(chain.isTestnet),
      usdcAddress: chain.usdcAddress || null,
      forwarderSupported: Boolean(chain.cctp?.forwarderSupported?.destination || chain.gateway?.forwarderSupported?.destination)
    });
    return {
      bridge: kit.getSupportedChains("bridge").map(summarize),
      swap: kit.getSupportedChains("swap").map(summarize),
      unifiedBalance: kit.getSupportedChains("unifiedBalance").map(summarize)
    };
  } catch {
    return {};
  }
}
