import "../src/env.js";
import { loadStore, persistStore } from "../src/store.js";
import { createWallet, fundWallet, syncWalletBalances } from "../src/walletAccounts.js";

const handle = process.env.CIRCLE_SMOKE_HANDLE || `@circle_smoke_${Date.now()}`;
const settlementRail = process.env.CIRCLE_SMOKE_RAIL || "arc-testnet";
const requestFaucet = process.argv.includes("--faucet") || process.env.CIRCLE_SMOKE_FAUCET === "1";

await loadStore();

console.log(`Creating/syncing Circle wallet for ${handle} on ${settlementRail}`);
const created = await createWallet({
  handle,
  settlementRails: [settlementRail]
});
console.log(JSON.stringify({
  ok: created.ok,
  handle: created.wallet.handle,
  walletSetId: created.wallet.walletSetId,
  wallets: created.wallet.wallets.map((wallet) => ({
    id: wallet.id,
    rail: wallet.rail,
    blockchain: wallet.blockchain,
    address: wallet.address
  }))
}, null, 2));

if (requestFaucet) {
  console.log("Requesting Circle testnet faucet funds...");
  try {
    const funded = await fundWallet({
      handle,
      amount: 10,
      source: "circle_faucet",
      settlementRail
    });
    console.log(JSON.stringify({
      funding: funded.funding,
      faucet: funded.faucet,
      synced: funded.synced
    }, null, 2));
  } catch (error) {
    console.error(`Faucet request failed: ${error.message}`);
    console.error("Wallet creation still succeeded. Fund the printed address externally or retry the faucet later.");
  }
} else {
  console.log("Skipping faucet. Re-run with --faucet to request real Circle testnet funds.");
}

const synced = await syncWalletBalances({ handle }).catch((error) => ({
  ok: false,
  error: error.message
}));
console.log("Balance sync:");
console.log(JSON.stringify(synced, null, 2));

await persistStore();
