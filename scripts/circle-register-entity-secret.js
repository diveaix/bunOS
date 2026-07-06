import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";
import "../src/env.js";

const apiKey = process.env.CIRCLE_API_KEY;
let entitySecret = process.env.CIRCLE_ENTITY_SECRET;
const recoveryDir = process.env.CIRCLE_RECOVERY_DIR || join(process.cwd(), "circle-recovery");

if (!apiKey) {
  throw new Error("CIRCLE_API_KEY is required. Add it to .env first.");
}

if (!entitySecret) {
  entitySecret = randomBytes(32).toString("hex");
  console.log("Generated CIRCLE_ENTITY_SECRET. Add this to .env and keep it private:");
  console.log(entitySecret);
  console.log("");
}

await mkdir(recoveryDir, { recursive: true });

if (existsSync(recoveryDir)) {
  console.log(`Registering entity secret with Circle. Recovery files will be saved in: ${recoveryDir}`);
}

try {
  const response = await registerEntitySecretCiphertext({
    apiKey,
    entitySecret,
    recoveryFileDownloadPath: recoveryDir
  });

  console.log("Entity secret registered.");
  console.log(JSON.stringify(response.data || response, null, 2));
  console.log("");
  console.log("Next .env values:");
  console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}`);
  console.log("Now run: npm run circle:create-wallet-set");
} catch (error) {
  printCircleError(error);
  process.exitCode = 1;
}

function printCircleError(error) {
  console.error("Circle entity secret registration failed.");
  console.error(`Message: ${error.message}`);
  if (error.code) console.error(`Code: ${error.code}`);
  if (error.status) console.error(`HTTP: ${error.status}`);

  if (error.code === 156015) {
    console.error("");
    console.error("Circle says an entity secret is already registered for this API key.");
    console.error("If you do not know that original secret, rotate/reset the entity secret in Circle Console, then run this script again.");
  }
}
