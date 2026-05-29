import { config } from "./config.js";

const rails = {
  "arc-testnet": {
    id: "arc-testnet",
    label: "Arc Testnet",
    family: "arc",
    mode: "testnet",
    chainId: 5042002,
    chainIdHex: "0x4cef52",
    appKitChain: "Arc_Testnet",
    circleBlockchain: "ARC-TESTNET",
    nativeCurrency: { symbol: "USDC", decimals: 18 },
    usdcAddress: "0x3600000000000000000000000000000000000000",
    cirbtcAddress: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
    cctpDomain: 26,
    rpcUrl: config.arc.rpcUrl,
    explorerBaseUrl: "https://testnet.arcscan.app/tx/"
  },
  "base-sepolia": {
    id: "base-sepolia",
    label: "Base Sepolia",
    family: "base",
    mode: "testnet",
    chainId: 84532,
    chainIdHex: "0x14a34",
    appKitChain: "Base_Sepolia",
    circleBlockchain: "BASE-SEPOLIA",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorerBaseUrl: "https://sepolia.basescan.org/tx/"
  }
};

export function listSettlementRails() {
  return config.settlement.supportedRails.map(getSettlementRail);
}

export function getSettlementRail(id) {
  const rail = rails[id];
  if (!rail) {
    throw new Error(`Unsupported settlement rail: ${id}`);
  }

  return rail;
}

export function selectSettlementRail({ preferred } = {}) {
  const requested = preferred || config.settlement.defaultRail;
  const rail = getSettlementRail(requested);

  if (!config.settlement.supportedRails.includes(rail.id)) {
    throw new Error(`${rail.id} is not enabled`);
  }

  return rail;
}

export function simulateSettlement({ rail, paymentId }) {
  const txHash = `0x${Buffer.from(`${rail.id}:${paymentId}`).toString("hex").padEnd(64, "0").slice(0, 64)}`;

  return {
    rail: rail.id,
    railLabel: rail.label,
    chainId: rail.chainId,
    chainIdHex: rail.chainIdHex,
    circleBlockchain: rail.circleBlockchain,
    txHash,
    explorerUrl: `${rail.explorerBaseUrl}${txHash}`,
    bridge: rail.family === "base" ? "base-sepolia-usdc" : "arc-native-usdc"
  };
}
