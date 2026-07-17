import assert from "node:assert/strict";
import { BunosApiError, createBunosClient } from "../sdk/js/index.js";

const requests = [];
const client = createBunosClient({
  baseUrl: "https://example.test/",
  apiKey: "bunos_mcp_test",
  fetch: async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith("/api/fail")) {
      return response(403, { error: "forbidden" });
    }
    return response(200, { ok: true, path: new URL(url).pathname });
  }
});

await client.config();
assert.equal(requests.at(-1).url, "https://example.test/api/config");
assert.equal(requests.at(-1).init.headers.authorization, undefined);

await client.plan({ handle: "@mallory", input: "show balance" });
assert.equal(requests.at(-1).url, "https://example.test/api/agent/plan");
assert.equal(requests.at(-1).init.headers.authorization, "Bearer bunos_mcp_test");
assert.deepEqual(JSON.parse(requests.at(-1).init.body), {
  handle: "@mallory",
  text: "show balance"
});

await client.run({
  handle: "@sara",
  input: "send 1 usdc to @alice",
  idempotencyKey: "sdk-test-run"
});
assert.equal(requests.at(-1).init.headers["idempotency-key"], "sdk-test-run");

await client.callTool("get_balance", { handle: "@sara" });
assert.deepEqual(JSON.parse(requests.at(-1).init.body), {
  tool: "get_balance",
  arguments: { handle: "@sara" }
});

await client.launchpadArchitecture();
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/architecture");
assert.equal(requests.at(-1).init.headers.authorization, undefined);

await client.planTokenLaunch({ creatorHandle: "@sara", symbol: "ARCD", liquiditySeedUsd: 100 });
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/plan");
assert.equal(requests.at(-1).init.headers.authorization, "Bearer bunos_mcp_test");
assert.deepEqual(JSON.parse(requests.at(-1).init.body), {
  creatorHandle: "@sara",
  symbol: "ARCD",
  liquiditySeedUsd: 100
});

await client.createTokenLaunch({
  creatorHandle: "@sara",
  symbol: "ARCD",
  liquiditySeedUsd: 25,
  idempotencyKey: "sdk-launch"
});
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/launches");
assert.equal(requests.at(-1).init.headers["idempotency-key"], "sdk-launch");

await client.listLaunches({ creatorHandle: "@sara", status: "live", limit: 5 });
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/launches?creatorHandle=%40sara&status=live&limit=5");
assert.equal(requests.at(-1).init.headers.authorization, undefined);

await client.getLaunch("launch_0001");
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/launches/launch_0001");

await client.deployLaunchToken("launch_0001", { handle: "@sara", idempotencyKey: "sdk-deploy" });
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/launches/launch_0001/deploy-token");
assert.equal(requests.at(-1).init.headers["idempotency-key"], "sdk-deploy");

await client.seedLaunchLiquidity("launch_0001", { handle: "@sara", amountUsd: 25, idempotencyKey: "sdk-seed" });
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/launches/launch_0001/seed-liquidity");
assert.deepEqual(JSON.parse(requests.at(-1).init.body), {
  handle: "@sara",
  amountUsd: 25,
  idempotencyKey: "sdk-seed"
});

await client.openLaunchTrading("launch_0001", { handle: "@sara", idempotencyKey: "sdk-live" });
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/launches/launch_0001/go-live");

await client.updateLaunchAgentPolicy("launch_0001", {
  handle: "@sara",
  grants: ["deploy_token"]
});
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/launches/launch_0001/agent-policy");

await client.getLaunchReceipt("launch_0001");
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/launches/launch_0001/receipt");

await client.monitorLaunch("launch_0001");
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/launches/launch_0001/monitor");

await client.getLaunchFees("launch_0001");
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/launches/launch_0001/fees");

await client.accrueLaunchFees("launch_0001", {
  handle: "@sara",
  volumeUsd: 1000,
  idempotencyKey: "sdk-fees"
});
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/launches/launch_0001/fees/accrue");
assert.equal(requests.at(-1).init.headers["idempotency-key"], "sdk-fees");
assert.deepEqual(JSON.parse(requests.at(-1).init.body), {
  handle: "@sara",
  volumeUsd: 1000,
  idempotencyKey: "sdk-fees"
});

await client.claimLaunchFees("launch_0001", {
  handle: "@sara",
  destination: "compute_credits",
  idempotencyKey: "sdk-claim"
});
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/launches/launch_0001/fees/claim");
assert.equal(requests.at(-1).init.headers["idempotency-key"], "sdk-claim");

await client.getAgentTreasury({ handle: "@sara", limit: 3 });
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/treasury?handle=%40sara&limit=3");

await client.spendAgentCompute({
  handle: "@sara",
  amountUsd: 1,
  purpose: "llm_usage",
  idempotencyKey: "sdk-compute"
});
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/treasury/spend");
assert.equal(requests.at(-1).init.headers["idempotency-key"], "sdk-compute");

await client.listLaunchFeed({ status: "live", limit: 2 });
assert.equal(requests.at(-1).url, "https://example.test/api/launchpad/feed?status=live&limit=2");
assert.equal(requests.at(-1).init.headers.authorization, undefined);

await assert.rejects(
  () => client.request("GET", "/api/fail"),
  (error) => {
    assert.equal(error instanceof BunosApiError, true);
    assert.equal(error.status, 403);
    assert.equal(error.message, "forbidden");
    return true;
  }
);

console.log("ok - sdk client builds authenticated bunOS requests");

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Forbidden",
    text: async () => JSON.stringify(data)
  };
}
