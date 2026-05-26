import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import "../src/env.js";

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
const name = process.env.CIRCLE_WALLET_SET_NAME || "ArcPay Hackathon";

if (!apiKey) {
  throw new Error("CIRCLE_API_KEY is required. Add it to .env first.");
}

if (!entitySecret) {
  throw new Error("CIRCLE_ENTITY_SECRET is required. Run npm run circle:register-entity-secret first.");
}

const client = initiateDeveloperControlledWalletsClient({
  apiKey,
  entitySecret
});

try {
  const response = await client.createWalletSet({
    idempotencyKey: process.env.CIRCLE_WALLET_SET_IDEMPOTENCY_KEY || randomUUID(),
    name
  });

  const walletSet = response.data?.walletSet || response.walletSet || response.data;
  const walletSetId = walletSet?.id;

  if (!walletSetId) {
    console.log(JSON.stringify(response, null, 2));
    throw new Error("Circle did not return a wallet set id.");
  }

  console.log("Circle wallet set created.");
  console.log(JSON.stringify(walletSet, null, 2));
  console.log("");
  console.log("Add this to .env:");
  console.log(`CIRCLE_WALLET_SET_ID=${walletSetId}`);
} catch (error) {
  printCircleError(error);
  process.exitCode = 1;
}

function printCircleError(error) {
  console.error("Circle wallet set creation failed.");
  console.error(`Message: ${error.message}`);
  if (error.code) console.error(`Code: ${error.code}`);
  if (error.status) console.error(`HTTP: ${error.status}`);

  if (error.code === 156016) {
    console.error("");
    console.error("Circle says the entity secret has not been registered yet.");
    console.error("Run: npm run circle:register-entity-secret");
    console.error("Then add the printed CIRCLE_ENTITY_SECRET to .env and run this script again.");
  }
}
