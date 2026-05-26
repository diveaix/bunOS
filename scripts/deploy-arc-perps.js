import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, encodeFunctionData, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../src/config.js";
import { getSettlementRail } from "../src/settlement.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const rail = getSettlementRail("arc-testnet");

if (!config.arc.settlementPrivateKey) {
  throw new Error("ARC_SETTLEMENT_PRIVATE_KEY is required to deploy ArcPerps contracts");
}

const usdcAddress = process.env.ARC_PERPS_USDC_ADDRESS || rail.usdcAddress;
const initialBtcPrice = BigInt(process.env.ARC_PERPS_INITIAL_BTC_PRICE || "10000000000000");
const account = privateKeyToAccount(normalizePrivateKey(config.arc.settlementPrivateKey));
const chain = {
  id: rail.chainId,
  name: rail.label,
  nativeCurrency: rail.nativeCurrency,
  rpcUrls: { default: { http: [config.arc.rpcUrl] } }
};

const publicClient = createPublicClient({ chain, transport: http(config.arc.rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(config.arc.rpcUrl) });

const oracle = await artifact("ArcPerpsOracle");
const vault = await artifact("ArcPerpsVault");

const oracleAddress = await deployContract({
  name: "ArcPerpsOracle",
  abi: oracle.abi,
  bytecode: oracle.bytecode,
  args: []
});

const vaultAddress = await deployContract({
  name: "ArcPerpsVault",
  abi: vault.abi,
  bytecode: vault.bytecode,
  args: [usdcAddress, oracleAddress]
});

await write({
  address: oracleAddress,
  abi: oracle.abi,
  functionName: "setPrice",
  args: [symbolBytes32("BTC"), initialBtcPrice],
  label: "set BTC oracle price"
});

await write({
  address: vaultAddress,
  abi: vault.abi,
  functionName: "setMarket",
  args: [symbolBytes32("BTC"), true],
  label: "enable BTC market"
});

console.log(JSON.stringify({
  network: rail.id,
  deployer: account.address,
  usdcAddress,
  oracleAddress,
  vaultAddress,
  initialBtcPrice: formatUnits(initialBtcPrice, 8),
  env: {
    ARC_PERPS_USDC_ADDRESS: usdcAddress,
    ARC_PERPS_ORACLE_ADDRESS: oracleAddress,
    ARC_PERPS_VAULT_ADDRESS: vaultAddress
  }
}, null, 2));

async function artifact(name) {
  return JSON.parse(await readFile(join(root, "build", "contracts", `${name}.json`), "utf8"));
}

async function deployContract({ name, abi, bytecode, args }) {
  const hash = await walletClient.deployContract({ abi, bytecode, args });
  console.log(`${name} deploy tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`${name} deployed at ${receipt.contractAddress}`);
  return receipt.contractAddress;
}

async function write({ address, abi, functionName, args, label }) {
  const data = encodeFunctionData({ abi, functionName, args });
  const hash = await walletClient.sendTransaction({ to: address, data });
  console.log(`${label} tx: ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });
}

function symbolBytes32(symbol) {
  const bytes = Buffer.from(symbol.toUpperCase(), "utf8");
  if (bytes.length > 32) {
    throw new Error("Symbol too long");
  }
  return `0x${bytes.toString("hex").padEnd(64, "0")}`;
}

function normalizePrivateKey(value) {
  return value.startsWith("0x") ? value : `0x${value}`;
}
