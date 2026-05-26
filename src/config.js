import "./env.js";

export const config = {
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 4317}`,
  providerMode: process.env.PROVIDER_MODE || "mock",
  transferProvider: process.env.TRANSFER_PROVIDER || (process.env.PROVIDER_MODE === "real" ? "circle" : "mock"),
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "dev-only-token-encryption-key-change-me",
  webhookSecret: process.env.X_WEBHOOK_SECRET || "",
  arc: {
    rpcUrl: process.env.ARC_TESTNET_RPC_URL || process.env.RPC || "https://rpc.testnet.arc.network",
    wsUrl: process.env.ARC_TESTNET_WS_URL || "wss://rpc.testnet.arc.network",
    settlementPrivateKey: process.env.ARC_SETTLEMENT_PRIVATE_KEY || "",
    expectedChainIdHex: "0x4cef52"
  },
  x: {
    authMode: process.env.X_AUTH_MODE || "mock",
    clientId: process.env.X_CLIENT_ID || "",
    clientSecret: process.env.X_CLIENT_SECRET || "",
    redirectUri: process.env.X_REDIRECT_URI || `http://localhost:${process.env.PORT || 4317}/auth/x/callback`,
    scopes: (process.env.X_SCOPES || "tweet.read tweet.write users.read offline.access").split(/\s+/).filter(Boolean),
    apiBaseUrl: process.env.X_API_BASE_URL || "https://api.x.com",
    replyEnabled: process.env.X_REPLY_ENABLED === "1",
    replyAuthor: process.env.X_REPLY_AUTHOR || "bot",
    botAccessToken: process.env.X_BOT_ACCESS_TOKEN || ""
  },
  circle: {
    walletsEnabled: process.env.CIRCLE_WALLETS_ENABLED === "1",
    apiKey: process.env.CIRCLE_API_KEY || "",
    entitySecret: process.env.CIRCLE_ENTITY_SECRET || "",
    entitySecretCiphertext: process.env.CIRCLE_ENTITY_SECRET_CIPHERTEXT || "",
    walletSetId: process.env.CIRCLE_WALLET_SET_ID || "",
    usdcTokenId: process.env.CIRCLE_USDC_TOKEN_ID || "",
    webhookPublicKeyBase64: process.env.CIRCLE_WEBHOOK_PUBLIC_KEY_BASE64 || "",
    webhookSecret: process.env.CIRCLE_WEBHOOK_SECRET || "",
    apiBaseUrl: process.env.CIRCLE_API_BASE_URL || "https://api.circle.com"
  },
  defi: {
    liveAdapters: process.env.DEFI_LIVE_ADAPTERS === "1",
    executionEnabled: process.env.DEFI_EXECUTION_ENABLED === "1",
    lifiBaseUrl: process.env.LIFI_API_BASE_URL || "https://li.quest/v1",
    lifiApiKey: process.env.LIFI_API_KEY || "",
    polymarketGammaUrl: process.env.POLYMARKET_GAMMA_URL || "https://gamma-api.polymarket.com",
    hyperliquidInfoUrl: process.env.HYPERLIQUID_INFO_URL || "https://api.hyperliquid.xyz/info",
    maxActionUsd: Number(process.env.DEFI_MAX_ACTION_USD || 25),
    maxSlippage: Number(process.env.DEFI_MAX_SLIPPAGE || 0.01),
    allowedProtocols: (process.env.DEFI_ALLOWED_PROTOCOLS || "lifi,circle-app-kit,polymarket,hyperliquid")
      .split(",")
      .map((protocol) => protocol.trim())
      .filter(Boolean)
  },
  appKit: {
    executionEnabled: process.env.APPKIT_EXECUTION_ENABLED === "1",
    unifiedBalanceEnabled: process.env.APPKIT_UNIFIED_BALANCE_ENABLED === "1",
    kitKey: process.env.APPKIT_KIT_KEY || ""
  },
  ai: {
    enabled: process.env.AGENT_MODEL_ENABLED !== "0",
    provider: "gemini",
    model: process.env.GEMINI_MODEL || process.env.AGENT_MODEL || "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY || "",
    baseUrl: process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta"
  },
  arcPerps: {
    usdcAddress: process.env.ARC_PERPS_USDC_ADDRESS || "",
    oracleAddress: process.env.ARC_PERPS_ORACLE_ADDRESS || "",
    vaultAddress: process.env.ARC_PERPS_VAULT_ADDRESS || "",
    executionEnabled: process.env.ARC_PERPS_EXECUTION_ENABLED === "1",
    oracleSyncEnabled: process.env.ARC_PERPS_ORACLE_SYNC_ENABLED !== "0",
    oracleSyncSymbols: (process.env.ARC_PERPS_ORACLE_SYMBOLS || "BTC")
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean),
    oracleMaxAgeMs: Math.max(15_000, Number(process.env.ARC_PERPS_ORACLE_MAX_AGE_MS || 60_000)),
    maxLeverage: Number(process.env.ARC_PERPS_MAX_LEVERAGE || 3)
  },
  automations: {
    workerEnabled: process.env.AUTOMATION_WORKER_ENABLED !== "0",
    tickMs: Math.max(5_000, Number(process.env.AUTOMATION_WORKER_INTERVAL_MS || 60_000)),
    limit: Math.max(1, Number(process.env.AUTOMATION_WORKER_LIMIT || 20))
  },
  settlement: {
    defaultRail: process.env.DEFAULT_SETTLEMENT_RAIL || "arc-testnet",
    supportedRails: (process.env.SUPPORTED_SETTLEMENT_RAILS || "arc-testnet,base-sepolia")
      .split(",")
      .map((rail) => rail.trim())
      .filter(Boolean)
  }
};

export function isRealProviderMode() {
  return config.providerMode === "real";
}

export function isRealXAuthMode() {
  return config.x.authMode === "real";
}

export function isRealCircleWalletMode() {
  return config.circle.walletsEnabled || config.transferProvider === "circle" || config.providerMode === "real";
}
