import { canteenCliInstallHint, readCanteenCliRpcUrl } from "../src/canteenRpc.js";
import { checkArcRpcHealth, redactRpcUrl } from "../src/arcRpc.js";

const cliRpcUrl = readCanteenCliRpcUrl({ timeoutMs: 5000 });
const health = await checkArcRpcHealth({ timeoutMs: 5000 }).catch((error) => ({
  ok: false,
  error: error.message
}));

console.log(JSON.stringify({
  ok: Boolean(cliRpcUrl && health.ok && health.canteenTrackingReady),
  cliInstalledAndLoggedIn: Boolean(cliRpcUrl),
  cliRpc: cliRpcUrl ? redactRpcUrl(cliRpcUrl) : null,
  backendRpc: health.rpc || null,
  backendRpcSource: health.rpcSource || null,
  backendRpcProvider: health.rpcProvider || null,
  chainId: health.chainId || null,
  blockNumber: health.blockNumber || null,
  latencyMs: health.latencyMs || null,
  error: health.error || null,
  next: cliRpcUrl
    ? "Set ARC_TESTNET_RPC_URL to the full arc-canteen rpc-url value in Railway/Vercel. Keep the token secret."
    : canteenCliInstallHint()
}, null, 2));
