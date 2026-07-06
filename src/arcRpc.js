import { config } from "./config.js";
import { canteenCliInstallHint, isCanteenRpcUrl } from "./canteenRpc.js";

export async function checkArcRpcHealth({ timeoutMs = 3500 } = {}) {
  const startedAt = Date.now();
  const [chainId, blockNumber] = await Promise.all([
    arcRpc("eth_chainId", [], { timeoutMs }),
    arcRpc("eth_blockNumber", [], { timeoutMs })
  ]);

  return {
    ok: chainId?.toLowerCase() === config.arc.expectedChainIdHex,
    rpc: redactRpcUrl(config.arc.rpcUrl),
    rpcSource: config.arc.rpcSource,
    rpcProvider: config.arc.rpcProvider,
    canteenTrackingReady: Boolean(config.arc.canteenTrackingReady && isCanteenRpcUrl(config.arc.rpcUrl)),
    chainId,
    expectedChainId: config.arc.expectedChainIdHex,
    blockNumberHex: blockNumber,
    blockNumber: blockNumber ? Number.parseInt(blockNumber, 16) : null,
    latencyMs: Date.now() - startedAt,
    canteen: {
      requiredForTrackedJudging: true,
      connected: Boolean(config.arc.canteenTrackingReady && isCanteenRpcUrl(config.arc.rpcUrl)),
      cli: canteenCliInstallHint()
    }
  };
}

export async function getArcReadiness() {
  try {
    return await checkArcRpcHealth();
  } catch (error) {
    return {
      ok: false,
      rpc: redactRpcUrl(config.arc.rpcUrl),
      rpcSource: config.arc.rpcSource,
      rpcProvider: config.arc.rpcProvider,
      canteenTrackingReady: Boolean(config.arc.canteenTrackingReady && isCanteenRpcUrl(config.arc.rpcUrl)),
      expectedChainId: config.arc.expectedChainIdHex,
      error: error.message,
      canteen: {
        requiredForTrackedJudging: true,
        connected: Boolean(config.arc.canteenTrackingReady && isCanteenRpcUrl(config.arc.rpcUrl)),
        cli: canteenCliInstallHint()
      }
    };
  }
}

export function redactRpcUrl(rawUrl = "") {
  if (!rawUrl) {
    return "";
  }

  try {
    const url = new URL(rawUrl);
    const redactedPath = url.pathname.replace(/\/v1\/[^/]+/i, "/v1/<key>");
    return `${url.origin}${redactedPath}`;
  } catch {
    return rawUrl.includes("/v1/") ? rawUrl.replace(/\/v1\/[^/\s]+/i, "/v1/<key>") : rawUrl;
  }
}

async function arcRpc(method, params = [], { timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(config.arc.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params
      }),
      signal: controller.signal
    });
    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || `Arc RPC ${method} failed`);
    }

    return data.result;
  } finally {
    clearTimeout(timer);
  }
}
