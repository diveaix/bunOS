import { createBunosClient } from "../index.js";

const bunos = createBunosClient({
  baseUrl: process.env.BUNOS_BASE_URL || "http://localhost:4317",
  apiKey: process.env.BUNOS_API_KEY
});

const tools = await bunos.agentTools();
console.log(`Agent tools: ${tools.tools.length}`);

const plan = await bunos.plan({
  handle: process.env.BUNOS_HANDLE || "@sara",
  input: "Show my wallet balance"
});
console.log(plan);

const launchPlan = await bunos.planTokenLaunch({
  creatorHandle: process.env.BUNOS_HANDLE || "@sara",
  name: "Arc Demo Token",
  symbol: "ARCD",
  liquiditySeedUsd: 100
});
console.log(launchPlan.status, launchPlan.token.symbol);

const created = await bunos.createTokenLaunch({
  creatorHandle: process.env.BUNOS_HANDLE || "@sara",
  name: "Arc Demo Token",
  symbol: `AD${Date.now().toString().slice(-4)}`,
  liquiditySeedUsd: 25,
  grants: ["deploy_token", "seed_liquidity", "open_trading"],
  idempotencyKey: `sdk-example-${Date.now()}`
});
console.log(created.launch.id, created.launch.status);

const treasury = await bunos.getAgentTreasury({
  handle: process.env.BUNOS_HANDLE || "@sara"
});
console.log("Treasury runway:", treasury.treasury.runwayDays, "days");
