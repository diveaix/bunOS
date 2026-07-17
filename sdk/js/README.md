# bunOS JavaScript SDK

Small ESM client for agent developers. It wraps the bunOS REST, MCP, and launchpad execution endpoints.

## Setup

Use it directly from this repo:

```js
import { createBunosClient } from "./sdk/js/index.js";
```

Or publish/install the package later from `sdk/js` as `@bunos/sdk`.

## Agent Access

```js
const bunos = createBunosClient({
  baseUrl: "https://bunos.xyz",
  apiKey: process.env.BUNOS_API_KEY
});

const plan = await bunos.plan({
  handle: "@sara",
  input: "Bridge 3 USDC from Arc testnet to Base Sepolia"
});

const result = await bunos.run({
  handle: "@sara",
  input: "Show my balance",
  idempotencyKey: "balance-check-001"
});

const balance = await bunos.getBalance({
  handle: "@sara",
  settlementRail: "arc-testnet"
});
```

Use a bearer token created from the product's API Keys page. When a token is supplied, bunOS binds wallet actions to the token owner's handle.

## Launchpad Planning

```js
const architecture = await bunos.launchpadArchitecture();

const launchPlan = await bunos.planTokenLaunch({
  creatorHandle: "@sara",
  name: "Arc Creator Token",
  symbol: "ARCC",
  totalSupply: 1_000_000,
  liquiditySeedUsd: 100,
  liquidityLockDays: 90,
  maxSlippage: 0.01
});
```

## Launchpad Execution

```js
const created = await bunos.createTokenLaunch({
  creatorHandle: "@sara",
  name: "Arc Creator Token",
  symbol: "ARCC",
  liquiditySeedUsd: 100,
  liquidityLockDays: 90,
  grants: ["deploy_token", "seed_liquidity", "open_trading"],
  idempotencyKey: "launch-arcc-001"
});

await bunos.deployLaunchToken(created.launch.id);
await bunos.seedLaunchLiquidity(created.launch.id);
await bunos.openLaunchTrading(created.launch.id);

const monitor = await bunos.monitorLaunch(created.launch.id);
```

Launch execution currently uses the deterministic local Arc launch-owned-liquidity adapter. The DEX adapter boundary is explicit so a live Arc pool/router can replace it when the venue is chosen.

## Self-Funding Agent Loop

```js
await bunos.accrueLaunchFees(created.launch.id, {
  handle: "@sara",
  volumeUsd: 1_000,
  source: "local-smoke",
  idempotencyKey: "launch-arcc-fees-001"
});

await bunos.claimLaunchFees(created.launch.id, {
  handle: "@sara",
  destination: "compute_credits",
  idempotencyKey: "launch-arcc-claim-001"
});

const treasury = await bunos.getAgentTreasury({ handle: "@sara" });

await bunos.spendAgentCompute({
  handle: "@sara",
  amountUsd: 1.5,
  purpose: "llm_usage",
  idempotencyKey: "launch-arcc-compute-001"
});
```

Fee accrual is currently deterministic local telemetry. When the Arc pool/router adapter is connected, the same SDK methods can read and claim live pool fees.
