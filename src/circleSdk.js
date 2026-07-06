import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { config } from "./config.js";

let client;
let clientKey;

export function getCircleDeveloperClient() {
  if (!config.circle.apiKey || !config.circle.entitySecret) {
    throw new Error("Circle real mode requires CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET");
  }

  const key = `${config.circle.apiKey}:${config.circle.entitySecret}:${config.circle.apiBaseUrl}`;
  if (!client || clientKey !== key) {
    client = initiateDeveloperControlledWalletsClient({
      apiKey: config.circle.apiKey,
      entitySecret: config.circle.entitySecret,
      baseUrl: config.circle.apiBaseUrl
    });
    clientKey = key;
  }

  return client;
}

export function circleErrorMessage(error, fallback = "Circle request failed") {
  const parts = [];
  if (error?.message) parts.push(error.message);
  const apiError = error?.error?.response?.data || error?.response?.data || error?.data;
  if (apiError?.message && apiError.message !== error?.message) {
    parts.push(apiError.message);
  }
  if (apiError?.errors) {
    parts.push(JSON.stringify(apiError.errors));
  }
  if (error?.code) parts.push(`code ${error.code}`);
  if (error?.status) parts.push(`HTTP ${error.status}`);
  return parts.length ? parts.join(" - ") : fallback;
}
