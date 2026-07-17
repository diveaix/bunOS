# bunOS

bunOS is an Arc-native token launchpad, agent terminal, and wallet backend. Creators and autonomous agents can plan token launches, prepare launch records, seed initial USDC liquidity, monitor launch health, and use wallet actions through the same API, MCP, SDK, and web surfaces.

The wallet is supporting infrastructure: it provides identity, balances, funding, approvals, receipts, and settlement for launchpad and terminal workflows.

## Product Surfaces

- Launchpad: create launch plans, preview token settings, track launch status, and inspect launch receipts.
- Terminal: run natural-language wallet, launch, swap, bridge, and automation commands.
- Agents: discover API-key, MCP, and SDK access patterns for autonomous usage.
- Wallet: connect an X handle, provision Circle wallets, fund testnet USDC, send payments, view balances, and confirm actions.
- MCP and SDK: expose the same product primitives to external agents and developer tooling.

## What Works Locally

- X-handle based local login and wallet identity.
- Circle-style wallet provisioning in mock mode, with real Circle configuration supported through environment variables.
- Arc Testnet and Base Sepolia wallet rails.
- USDC sends, claimable escrow, airdrops, bridge quotes, swap quotes, receipts, and reconciliation.
- Token launch planning and local launch lifecycle records.
- Launchpad contracts for launch tokens, launch factory, launch controller, liquidity locking, and agent policy vaults.
- API-key backed MCP access for agent clients.
- A JavaScript SDK for authenticated bunOS API calls.
- Policy-gated approvals for larger or sensitive actions.
- Local persistence through the configured SQLite file.

## Run Locally

```bash
npm install
npm start
```

Open:

```txt
http://localhost:4317
```

Run the frontend dev server separately when needed:

```bash
npm run frontend:dev
```

Build the production frontend into `public/`:

```bash
npm run frontend:build
```

## Environment

Copy `.env.example` into your environment manager and set the values you need.

Important local defaults:

- `PROVIDER_MODE=mock`
- `TRANSFER_PROVIDER=mock`
- `X_AUTH_MODE=mock`
- `DEFI_LIVE_ADAPTERS=0`
- `DEFI_EXECUTION_ENABLED=0`
- `APPKIT_EXECUTION_ENABLED=0`

For real Circle wallet flows, configure:

- `CIRCLE_WALLETS_ENABLED=1`
- `CIRCLE_API_KEY`
- `CIRCLE_ENTITY_SECRET`
- `CIRCLE_WALLET_SET_ID`
- `CIRCLE_WEBHOOK_PUBLIC_KEY_BASE64` or `CIRCLE_WEBHOOK_SECRET`

For Arc Testnet, configure:

- `ARC_TESTNET_RPC_URL`
- `ARC_TESTNET_WS_URL`
- `DEFAULT_SETTLEMENT_RAIL=arc-testnet`
- `SUPPORTED_SETTLEMENT_RAILS=arc-testnet,base-sepolia`

## Contracts

The launchpad contract set lives in `contracts/`:

- `ArcLaunchToken.sol`
- `ArcLaunchFactory.sol`
- `ArcLaunchController.sol`
- `ArcLiquidityLocker.sol`
- `ArcAgentPolicyVault.sol`

Compile contracts:

```bash
npm run compile:contracts
```

## Agent And MCP Access

bunOS exposes an MCP server for agent clients. Agents can use API keys to access wallet and launchpad tools without sharing the user's private session.

Core agent surfaces include:

- `plan_agent_action`
- `run_agent_action`
- `list_agent_tools`
- `create_wallet`
- `get_balance`
- `send_usdc`
- `bridge_usdc`
- `quote_swap`
- `create_launch_plan`
- `preview_launch`
- `create_launch`
- `list_launches`
- `get_receipt`
- `list_approvals`
- `confirm_action`

The MCP endpoint is served by the backend at:

```txt
/mcp
```

## SDK

The SDK lives in `sdk/` and wraps authenticated bunOS API requests for agent and app developers.

Run SDK tests:

```bash
node test/sdk.test.js
```

## Verification

Run the project tests:

```bash
npm test
```

Run contract compilation:

```bash
npm run compile:contracts
```

Run frontend production build:

```bash
npm run frontend:build
```
