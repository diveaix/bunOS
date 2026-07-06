import { execFileSync } from "node:child_process";

export const CANTEEN_RPC_HOST = "rpc.testnet.arc-node.thecanteenapp.com";
export const CANTEEN_RPC_BASE_URL = `https://${CANTEEN_RPC_HOST}`;
export const CANTEEN_NODE_URL = "https://arc-node.thecanteenapp.com/";
export const ARC_CANTEEN_INSTALL_COMMAND = "uv tool install git+https://github.com/the-canteen-dev/ARC-cli";
const LEGACY_PUBLIC_ARC_RPC_HOST = "rpc.testnet.arc.network";

export function resolveArcRpcUrl(env = process.env) {
  const configured = firstNonEmpty(env.ARC_TESTNET_RPC_URL, env.RPC);
  if (configured && !isLegacyPublicArcRpcUrl(configured)) {
    return {
      url: configured,
      source: env.ARC_TESTNET_RPC_URL ? "ARC_TESTNET_RPC_URL" : "RPC",
      provider: isCanteenRpcUrl(configured) ? "canteen" : "custom",
      canteenTrackingReady: isCanteenRpcUrl(configured)
    };
  }

  const cliUrl = readCanteenCliRpcUrl();
  if (cliUrl) {
    return {
      url: cliUrl,
      source: "arc-canteen-cli",
      provider: "canteen",
      canteenTrackingReady: true
    };
  }

  return {
    url: configured || "https://rpc.testnet.arc.network",
    source: configured ? "legacy-public-env" : "public-fallback",
    provider: "circle-public",
    canteenTrackingReady: false
  };
}

export function readCanteenCliRpcUrl({ timeoutMs = 1500 } = {}) {
  try {
    const output = execFileSync("arc-canteen", ["rpc-url"], {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return isCanteenRpcUrl(output) ? output : "";
  } catch {
    return "";
  }
}

export function isCanteenRpcUrl(value = "") {
  try {
    const url = new URL(value);
    return url.hostname === CANTEEN_RPC_HOST && url.pathname.startsWith("/v1/");
  } catch {
    return false;
  }
}

export function isLegacyPublicArcRpcUrl(value = "") {
  try {
    return new URL(value).hostname === LEGACY_PUBLIC_ARC_RPC_HOST;
  } catch {
    return false;
  }
}

export function canteenCliInstallHint() {
  return {
    install: ARC_CANTEEN_INSTALL_COMMAND,
    login: "arc-canteen login",
    rpcUrl: "arc-canteen rpc-url",
    rpcCall: "arc-canteen rpc eth_chainId",
    node: CANTEEN_NODE_URL
  };
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}
