export const users = new Map([
  [
    "@sara",
    {
      handle: "@sara",
      xUserId: "x_1001",
      onboarded: true,
      walletAddress: "0xSaraCircleWallet",
      balance: 184.25,
      balances: {
        "arc-testnet": 184.25,
        "base-sepolia": 38.5
      },
      walletSetId: "wset_sara_demo",
      chainWallets: [
        {
          id: "wallet_arc_sara",
          rail: "arc-testnet",
          blockchain: "ARC-TESTNET",
          address: "0xSaraCircleWallet",
          custody: "developer-controlled"
        },
        {
          id: "wallet_base_sara",
          rail: "base-sepolia",
          blockchain: "BASE-SEPOLIA",
          address: "0xSaraCircleWallet",
          custody: "developer-controlled"
        }
      ],
      xOAuth: {
        provider: "x",
        connected: true,
        connectedAt: "2026-05-15T00:00:00.000Z"
      },
      policy: {
        maxPerPayment: 25,
        maxDaily: 100,
        allowedAssets: ["USDC"],
        allowedSettlementRails: ["arc-testnet", "base-sepolia"],
        requireConfirmationAbove: 10
      }
    }
  ],
  [
    "@alice",
    {
      handle: "@alice",
      xUserId: "x_2002",
      onboarded: false,
      walletAddress: null,
      balance: 0,
      balances: {},
      walletSetId: null,
      chainWallets: [],
      xOAuth: null,
      policy: null
    }
  ],
  [
    "@bob",
    {
      handle: "@bob",
      xUserId: "x_3003",
      onboarded: true,
      walletAddress: "0xBobCircleWallet",
      balance: 42.75,
      balances: {
        "arc-testnet": 42.75,
        "base-sepolia": 11.25
      },
      walletSetId: "wset_bob_demo",
      chainWallets: [
        {
          id: "wallet_arc_bob",
          rail: "arc-testnet",
          blockchain: "ARC-TESTNET",
          address: "0xBobCircleWallet",
          custody: "developer-controlled"
        },
        {
          id: "wallet_base_bob",
          rail: "base-sepolia",
          blockchain: "BASE-SEPOLIA",
          address: "0xBobCircleWallet",
          custody: "developer-controlled"
        }
      ],
      xOAuth: {
        provider: "x",
        connected: true,
        connectedAt: "2026-05-15T00:00:00.000Z"
      },
      policy: {
        maxPerPayment: 100,
        maxDaily: 500,
        allowedAssets: ["USDC"],
        allowedSettlementRails: ["arc-testnet", "base-sepolia"],
        requireConfirmationAbove: 50
      }
    }
  ]
]);

export const ledger = {
  payments: [],
  claims: [],
  funding: [],
  bridges: [],
  events: [],
  oauthStates: new Map(),
  idempotency: new Map(),
  xWebhooks: [],
  xCommands: [],
  circleWebhooks: [],
  jobs: [],
  automations: [],
  defiActions: [],
  approvals: [],
  routeCapabilities: [],
  securityLocks: [],
  rateLimits: [],
  agentObservability: [],
  copyTradeProposals: [],
  perpProposals: [],
  airdrops: []
};

export const sessions = new Map();
