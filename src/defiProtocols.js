import { config } from "./config.js";

const protocols = [
  {
    id: "circle-app-kit",
    name: "Circle App Kit",
    category: "stablecoin",
    capabilities: ["send", "bridge", "swap"],
    chains: ["arc-testnet", "base-sepolia"],
    execution: "available_when_configured",
    risk: "medium"
  },
  {
    id: "lifi",
    name: "LI.FI",
    category: "routing",
    capabilities: ["quote_bridge", "quote_swap", "execute_bridge", "execute_swap"],
    chains: ["arc-testnet", "base-sepolia"],
    execution: "quote_first",
    risk: "medium"
  },
  {
    id: "polymarket",
    name: "Polymarket",
    category: "prediction_market",
    capabilities: ["search_markets", "orderbook", "place_order"],
    chains: ["polygon"],
    execution: "confirmation_required",
    risk: "high"
  },
  {
    id: "hyperliquid",
    name: "Hyperliquid",
    category: "perps",
    capabilities: ["markets", "positions", "place_order"],
    chains: ["hypercore", "hyperevm"],
    execution: "confirmation_required",
    risk: "very_high"
  }
];

export function listDefiProtocols() {
  const allowed = new Set(config.defi.allowedProtocols);
  return {
    ok: true,
    protocols: protocols.map((protocol) => ({
      ...protocol,
      enabled: allowed.has(protocol.id),
      live: config.defi.liveAdapters,
      requiresConfirmation: ["high", "very_high"].includes(protocol.risk)
    }))
  };
}

export function getDefiProtocol(id) {
  const protocol = protocols.find((item) => item.id === id);
  if (!protocol) {
    throw new Error(`Unsupported DeFi protocol: ${id}`);
  }

  return protocol;
}
