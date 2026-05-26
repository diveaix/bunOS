# ArcPay Wallet

ArcPay is an X-native USDC wallet and payment backend. A user connects X, ArcPay provisions Circle developer-controlled wallets, and payments settle on Arc Testnet with a Base Sepolia bridge path for demos.

## Pillars

```txt
X OAuth 2.0 PKCE
      |
      v
User Identity + Session
      |
      v
Circle Wallet Provisioning
      |
      v
ArcPay Payment Orchestrator
   |          |              |
   v          v              v
Policy     Arc Rail      Base Sepolia
Engine     USDC          Bridge Demo
      \      |              /
       \     v             /
        Direct transfer or claim escrow
```

## What Works Locally

- `POST /api/auth/x/mock` connects an X handle and creates Circle-style wallets.
- Wallets are provisioned for `arc-testnet` and `base-sepolia`.
- Arc Testnet uses the live network metadata: chain ID `5042002`, USDC gas, and `https://testnet.arcscan.app`.
- `/api/wallets/fund` requests Circle testnet faucet funds in real Circle mode, or creates a real external-deposit instruction.
- `/api/wallets/sync-balances` refreshes Circle token balances into the dashboard ledger.
- `/api/wallets/send` sends USDC on the selected rail.
- `/api/wallets/bridge` and `bridge_usdc` support the Arc Testnet <-> Base Sepolia demo route.
- `/api/x/webhook` receives X post events like `@ArcPay send 3 USDC to @bob` and `@ArcPay long BTC with 20 USDC at 2x`.
- Transfer submission is queued as backend jobs, so webhooks and UI requests can return fast while workers move money.
- `/api/circle/webhook` reconciles Circle transfer notifications.
- `/api/defi/tools` exposes policy-gated DeFi adapters for swaps, bridges, Polymarket, and Hyperliquid.
- `/api/defi/quote` creates bridge/swap quotes without executing funds.
- `/api/defi/actions/:id/confirm` records user confirmation and queues user-wallet execution.
- `/api/defi/actions/:id/reconcile` polls submitted bridge/swap execution status.
- `/api/defi/actions/:id/receipt` and `/defi/actions/:id` expose DeFi receipts with tx/explorer metadata.
- `/api/defi/polymarket/markets` and `/api/defi/hyperliquid/markets` provide read-only market discovery.
- If a recipient has not onboarded, the payment becomes claimable escrow.
- When that recipient later connects X, matching pending escrow is automatically released.
- Mutating routes persist to SQLite at `.data/arcpay.sqlite`.
- Idempotency keys prevent duplicate payments when clients or webhooks retry.
- X OAuth tokens are sealed at rest with AES-256-GCM.
- The dashboard exposes the above as normal wallet UI, not command boxes.

## Run

```bash
npm install
npm start
```

The app and scripts automatically read `F:\Downloads\arc-hack\.env`. PowerShell variables still work and take priority over `.env`.

Open:

```txt
http://localhost:4317
```

To run on another port:

```bash
$env:PORT=4319; npm start
```

To use Canteen's agent-friendly Arc RPC:

```bash
uv tool install git+https://github.com/the-canteen-dev/ARC-cli.git
arc-canteen login
arc-canteen rpc-url
```

Put the returned URL in `ARC_TESTNET_RPC_URL`.

## Circle Real Mode Setup

Add your Circle API key to `.env`, then register an entity secret and create a wallet set:

```bash
npm run circle:register-entity-secret
npm run circle:create-wallet-set
```

Copy the printed values into `.env`:

```env
PROVIDER_MODE=real
TRANSFER_PROVIDER=circle
CIRCLE_WALLETS_ENABLED=1
X_AUTH_MODE=mock
CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
CIRCLE_WALLET_SET_ID=...
```

`X_AUTH_MODE=mock` is intentional for local development because X requires an HTTPS website/callback. After deploying to Vercel, set `X_AUTH_MODE=real`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, and an HTTPS `X_REDIRECT_URI`.

## Vercel Deploy

The repo includes `vercel.json` and `api/index.js` so the same local server can run as a Vercel function for `/api/*`, `/auth/*`, and `/mcp`. Set these Vercel environment variables:

```env
APP_BASE_URL=https://your-project.vercel.app
X_AUTH_MODE=real
X_CLIENT_ID=...
X_CLIENT_SECRET=...
X_REDIRECT_URI=https://your-project.vercel.app/auth/x/callback
X_WEBHOOK_SECRET=...
PROVIDER_MODE=real
TRANSFER_PROVIDER=circle
CIRCLE_WALLETS_ENABLED=1
CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
CIRCLE_WALLET_SET_ID=...
ARC_TESTNET_RPC_URL=...
ARC_PERPS_EXECUTION_ENABLED=0
ARC_PERPS_USDC_ADDRESS=0x3600000000000000000000000000000000000000
ARC_PERPS_ORACLE_ADDRESS=...
ARC_PERPS_VAULT_ADDRESS=...
```

Serverless SQLite uses `/tmp/arcpay.sqlite` on Vercel, so state is not durable between cold starts. That is acceptable for the hackathon demo path, but production needs managed Postgres or another durable store.

## Environment

Copy `.env.example` into your real environment manager and set:

- `PROVIDER_MODE=mock` for fully local demos.
- `PROVIDER_MODE=real` when backend provider rails are real. X auth is controlled separately by `X_AUTH_MODE`.
- `X_AUTH_MODE=mock` locally until the app has HTTPS; set `X_AUTH_MODE=real` after Vercel/X OAuth setup.
- `TRANSFER_PROVIDER=mock` or `circle`. Use `circle` for real user-owned Circle wallet transfers.
- `ARC_TESTNET_RPC_URL` for Arc Testnet JSON-RPC. The public default is `https://rpc.testnet.arc.network`; Canteen keys work too.
- `ARC_SETTLEMENT_PRIVATE_KEY` is admin-only for deploy scripts. It is not used by MCP or agent tools for user money.
- `APPKIT_EXECUTION_ENABLED=1` lets Circle AppKit submit bridge/swap transactions through the user's Circle wallet adapter. Keep `0` unless Circle wallets, live adapters, and test funds are ready.
- `APPKIT_UNIFIED_BALANCE_ENABLED=0` until the unified-balance UX is ready.
- `APPKIT_KIT_KEY` is optional and should stay empty unless Circle explicitly gives you a kit key.
- `X_CLIENT_ID`, `X_CLIENT_SECRET`, and `X_REDIRECT_URI` for X OAuth 2.0 Authorization Code with PKCE.
- `X_SCOPES=tweet.read tweet.write users.read offline.access` if the bot should post command replies.
- `X_REPLY_ENABLED=1` and `X_BOT_ACCESS_TOKEN=...` to post generated receipt replies through the X API.
- `CIRCLE_WALLETS_ENABLED=1` to provision real Circle developer-controlled wallets while keeping X auth mocked locally.
- `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, and `CIRCLE_WALLET_SET_ID` for Circle developer-controlled wallets.
- `CIRCLE_USDC_TOKEN_ID` is optional; when absent, ArcPay uses the configured USDC token addresses for Arc Testnet and Base Sepolia.
- Do not configure a static `CIRCLE_ENTITY_SECRET_CIPHERTEXT`; the backend uses Circle's SDK to generate fresh ciphertext per sensitive request.
- `CIRCLE_WEBHOOK_PUBLIC_KEY_BASE64` or `CIRCLE_WEBHOOK_SECRET` for Circle webhook verification.
- `TOKEN_ENCRYPTION_KEY` for sealing OAuth tokens at rest.
- `DEFI_LIVE_ADAPTERS=1` to call live LI.FI, Polymarket, and Hyperliquid public APIs. Default `0` uses deterministic mock discovery/quotes.
- `DEFI_EXECUTION_ENABLED=1` to let confirmed bridge/swap jobs submit through Circle AppKit or LI.FI calldata through the user's Circle wallet. Keep it `0` unless Circle wallets, live routes, and test funds are ready.
- `LIFI_API_KEY` is optional but recommended for live LI.FI quote rate limits.
- `DEFI_ALLOWED_PROTOCOLS`, `DEFI_MAX_ACTION_USD`, and `DEFI_MAX_SLIPPAGE` control the DeFi policy gate.
- `SUPPORTED_SETTLEMENT_RAILS=arc-testnet,base-sepolia` for the current hackathon build.

## API Quickstart

## Agent + MCP Surface

ArcPay now exposes one agent backend through both X-style commands and MCP tools. The core MCP surface is:

- Agent planning/running: `plan_agent_action`, `run_agent_action`, `list_agent_tools`
- Wallet and money: `create_wallet`, `get_balance`, `sync_circle_balances`, `request_testnet_usdc`, `send_usdc`, `bridge_usdc`, `demo_bridge_arc_to_base`, `quote_swap`, `get_receipt`
- DeFi operations: `list_defi_tools`, `quote_defi_route`, `confirm_defi_action`, `list_defi_actions`, `reconcile_defi_action`, `get_defi_action_receipt`
- Safety: `list_approvals`, `confirm_action`
- Copy trading proposals: `propose_copy_trade`, `list_copy_trade_proposals`
- Perps intelligence: `list_perp_intelligence`, `assess_liquidation_risk`, `propose_perp_trade`, `list_perp_proposals`
- ArcPerps Lite read/proposal tools: `arc_perps_readiness`, `arc_perps_status`, `quote_arc_perp_position`, `read_arc_perps_oracle_price`, `get_arc_perps_position`, `list_arc_perps_positions`
- Arc App Kit tools: `appkit_readiness`, `list_appkit_capabilities`, `appkit_estimate_send`, `appkit_send_usdc`, `appkit_estimate_bridge`, `appkit_bridge_usdc`, `appkit_estimate_swap`, `appkit_swap`, `appkit_unified_balance`

Risky actions create approval records first. `confirm_action` routes the approval to the right executor: payment confirmation, DeFi handoff, copy-trade confirmation, or a user-wallet-required ArcPerps proposal. Backend signer execution is disabled from the MCP/agent surface.

The AppKit MCP tools intentionally do not use `ARC_SETTLEMENT_PRIVATE_KEY`. User money goes through Circle wallet tools (`create_wallet`, `sync_circle_balances`, `send_usdc`) or the Circle AppKit viem adapter, which submits from the user's Circle wallet address. Bridge/swap actions are quote-and-approval first; when `DEFI_LIVE_ADAPTERS=1`, `DEFI_EXECUTION_ENABLED=1`, and `APPKIT_EXECUTION_ENABLED=1`, the worker prefers Circle AppKit and falls back to LI.FI calldata where available. `demo_bridge_arc_to_base` is a judge-friendly helper that creates/loads the user wallet and returns an Arc Testnet -> Base Sepolia bridge quote plus approval metadata without auto-spending. MCP clients can then use `list_defi_actions`, `reconcile_defi_action`, and `get_defi_action_receipt` to operate the full action lifecycle.

The agent planner is available at `POST /api/agent/plan` and as MCP tool `plan_agent_action`. It converts natural language into an allowlisted tool plan with signer, gas payer, risk, and confirmation metadata. `POST /api/agent/run` and MCP tool `run_agent_action` plan first, then call only the safe allowlisted backend step. User money still goes through Circle user wallets, approvals, or `user_wallet_signing_required`; the runner never falls back to `ARC_SETTLEMENT_PRIVATE_KEY`.

X command receipts are available as JSON at `/api/x/commands/:id` and as a public HTML receipt at `/x/commands/:id`. Each completed command stores bot-ready reply copy that summarizes the action and states that no backend signer was used. Real reply posting is available through the product API, but intentionally not exposed as an MCP tool.

The MCP server intentionally does not expose X reply posting, social trader ranking, or prediction-market search tools. Bridge and swap tools create policy-gated Circle AppKit/LI.FI quotes and approvals. Execution only turns on through Circle user-wallet execution flags; it never falls back to a backend signer.

List MCP tools:

```bash
curl http://localhost:4317/api/mcp/tools
```

Use JSON-RPC over HTTP, AGNT-style:

```bash
curl -X POST http://localhost:4317/mcp \
  -H "content-type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}"
```

Use SSE transport:

```txt
GET  http://localhost:4317/sse
POST http://localhost:4317/messages?sessionId=<session-from-sse>
```

The prefixed form also works for clients that expect an MCP path:

```txt
GET  http://localhost:4317/mcp/sse
POST http://localhost:4317/mcp/messages?sessionId=<session-from-sse>
```

Plan and run a natural-language request through the guarded agent path:

```bash
curl -X POST http://localhost:4317/api/agent/run \
  -H "content-type: application/json" \
  -d "{\"handle\":\"@sara\",\"text\":\"bridge 5 usdc from arc to base\"}"
```

Run the hackathon smoke path:

```bash
npm run hackathon:smoke -- --rail arc-testnet
```

That prints wallet capabilities, a guarded USDC send, bridge/swap quote actions, an X perps command receipt URL, and the preflight percentages.

Run the focused MCP smoke:

```bash
npm run mcp:smoke
```

Use `npm run mcp:smoke -- --execute-send` only when you intend to create a send action through the active transfer provider.

Run a live DeFi route check against Circle user wallets and LI.FI:

```bash
npm run defi:live-smoke
```

Add `-- --confirm` only when the quote returns executable calldata and the wallet is funded. This smoke never uses `ARC_SETTLEMENT_PRIVATE_KEY`; if LI.FI cannot route Arc Testnet or the wallet lacks funds, it reports `quote_unavailable` or provider errors instead of pretending execution happened.

Run the MCP server over stdio for MCP clients:

```bash
npm run mcp:stdio
```

Create a perps proposal:

```bash
curl -X POST http://localhost:4317/api/mcp/call \
  -H "content-type: application/json" \
  -d "{\"tool\":\"propose_perp_trade\",\"arguments\":{\"handle\":\"@sara\",\"symbol\":\"BTC\",\"side\":\"long\",\"collateralUsd\":20,\"leverage\":2}}"
```

Check ArcPerps Lite readiness:

```bash
curl http://localhost:4317/api/arc-perps/readiness
curl http://localhost:4317/api/arc-perps/status
```

Quote an Arc-settled perps position:

```bash
curl -X POST http://localhost:4317/api/arc-perps/quote \
  -H "content-type: application/json" \
  -d "{\"symbol\":\"BTC\",\"side\":\"long\",\"marginUsd\":20,\"leverage\":2,\"markPrice\":100000}"
```

Resolve an X identity:

```bash
curl "http://localhost:4317/api/identity/resolve?handle=@alice"
```

List payments:

```bash
curl "http://localhost:4317/api/payments?handle=@alice"
```

Get a payment receipt:

```bash
curl http://localhost:4317/api/payments/pay_001
```

List claim inbox:

```bash
curl "http://localhost:4317/api/claims?handle=@alice&status=unclaimed"
```

View operations and webhook trails:

```bash
curl http://localhost:4317/api/operations
```

View provider transfer work:

```bash
curl http://localhost:4317/api/provider/work
```

Check settlement rail health:

```bash
curl http://localhost:4317/api/settlement/health
```

Request real Circle testnet funds for the selected wallet rail:

```bash
curl -X POST http://localhost:4317/api/wallets/fund \
  -H "content-type: application/json" \
  -d "{\"handle\":\"@sara\",\"amount\":10,\"source\":\"circle_faucet\",\"settlementRail\":\"arc-testnet\"}"
```

Sync real Circle token balances:

```bash
curl -X POST http://localhost:4317/api/wallets/sync-balances \
  -H "content-type: application/json" \
  -d "{\"handle\":\"@sara\"}"
```

Smoke-test real Circle wallet creation without sending a transfer:

```bash
npm run circle:smoke-wallet
```

Request faucet funds during the smoke test:

```bash
npm run circle:smoke-wallet -- --faucet
```

View queued backend jobs:

```bash
curl http://localhost:4317/api/jobs
```

List DeFi tools:

```bash
curl http://localhost:4317/api/defi/tools
```

Quote a bridge route without executing:

```bash
curl -X POST http://localhost:4317/api/defi/quote \
  -H "content-type: application/json" \
  -d "{\"handle\":\"@sara\",\"fromRail\":\"arc-testnet\",\"toRail\":\"base-sepolia\",\"amount\":5,\"slippage\":0.005}"
```

Confirm a quoted DeFi action:

```bash
curl -X POST http://localhost:4317/api/defi/actions/defi_001/confirm \
  -H "content-type: application/json" \
  -d "{\"handle\":\"@sara\"}"
```

Sync a submitted DeFi action and open its receipt:

```bash
curl -X POST http://localhost:4317/api/defi/actions/defi_001/reconcile \
  -H "content-type: application/json" \
  -d "{}"

curl http://localhost:4317/api/defi/actions/defi_001/receipt
```

Search prediction and perp markets:

```bash
curl "http://localhost:4317/api/defi/polymarket/markets?handle=@sara&query=bitcoin&limit=5"
curl "http://localhost:4317/api/defi/hyperliquid/markets?handle=@sara&limit=5"
```

## ArcPerps Lite

This repo includes a real Arc testnet perps settlement package under `contracts/`:

- `ArcPerpsOracle.sol` is a controlled testnet price oracle for hackathon execution.
- `ArcPerpsVault.sol` holds USDC margin, tracks long/short positions, settles PnL, and exposes liquidation helpers.
- `src/arcPerpsEngine.js` wraps readiness checks, quotes, open, and close transactions.

Compile contracts:

```bash
npm run compile:contracts
```

Deploy to Arc testnet:

```bash
set ARC_SETTLEMENT_PRIVATE_KEY=0x...
set ARC_PERPS_USDC_ADDRESS=0x3600000000000000000000000000000000000000
npm run deploy:arc-perps
```

Copy the printed `ARC_PERPS_ORACLE_ADDRESS` and `ARC_PERPS_VAULT_ADDRESS` into `.env`, then keep `ARC_PERPS_EXECUTION_ENABLED=0` for the MCP/agent product path. The deployer key is admin-only. The oracle is deliberately simple for testnet; production needs a hardened oracle source, circuit breakers, funding, insurance, liquidation bots, and audited contracts.

MCP and the X agent can quote and inspect positions, but signer-backed open/close/margin/liquidity/admin actions are disabled until they can execute from a user-owned wallet:

```bash
curl -X POST http://localhost:4317/api/arc-perps/quote \
  -H "content-type: application/json" \
  -d "{\"symbol\":\"BTC\",\"side\":\"long\",\"marginUsd\":20,\"leverage\":2}"

curl "http://localhost:4317/api/arc-perps/positions?limit=10"
```

Connect X and create wallets in mock mode:

```bash
curl -X POST http://localhost:4317/api/auth/x/mock \
  -H "content-type: application/json" \
  -d "{\"handle\":\"@alice\"}"
```

List wallets:

```bash
curl http://localhost:4317/api/wallets
```

Fund a wallet on Arc Testnet:

```bash
curl -X POST http://localhost:4317/api/wallets/fund \
  -H "content-type: application/json" \
  -d "{\"handle\":\"@alice\",\"amount\":25,\"source\":\"bank_transfer\",\"settlementRail\":\"arc-testnet\"}"
```

Send USDC on Arc:

```bash
curl -X POST http://localhost:4317/api/wallets/send \
  -H "content-type: application/json" \
  -d "{\"senderHandle\":\"@alice\",\"recipientHandle\":\"@bob\",\"amount\":5,\"settlementRail\":\"arc-testnet\",\"memo\":\"coffee\"}"
```

Process an X payment post:

```bash
curl -X POST http://localhost:4317/api/x/webhook \
  -H "content-type: application/json" \
  -d "{\"actorHandle\":\"@alice\",\"text\":\"@ArcPay send 5 USDC to @bob\",\"settlementRail\":\"arc-testnet\"}"
```

Process an X perp post:

```bash
curl -X POST http://localhost:4317/api/x/webhook \
  -H "content-type: application/json" \
  -d "{\"actorHandle\":\"@sara\",\"text\":\"@ArcPay long BTC with 20 USDC at 2x\",\"postId\":\"post_perp_1\",\"eventId\":\"evt_perp_1\",\"settlementRail\":\"arc-testnet\"}"
```

Send a signed webhook when `X_WEBHOOK_SECRET` is configured:

```txt
X-ArcPay-Signature: sha256=<hmac_sha256(raw_body, X_WEBHOOK_SECRET)>
```

Use an `Idempotency-Key` header on payment requests and an `eventId` on X webhooks. Replayed requests return the original result and do not create a second payment.

Retry a failed provider transfer:

```bash
curl -X POST http://localhost:4317/api/payments/pay_001/retry-transfer
```

Run due worker jobs locally:

```bash
curl -X POST http://localhost:4317/api/jobs/run-due \
  -H "content-type: application/json" \
  -d "{\"limit\":20}"
```

Retry all failed provider transfers:

```bash
curl -X POST http://localhost:4317/api/provider/retry-failed \
  -H "content-type: application/json" \
  -d "{\"limit\":20}"
```

## Real Integration Notes

X OAuth uses Authorization Code with PKCE. The backend stores the PKCE verifier during `/api/auth/x/start` and completes the code exchange at `/auth/x/callback`.

Circle wallet provisioning is isolated in `src/circleProvider.js`. In mock mode it returns deterministic Circle-like wallet records. In real mode it calls Circle's developer-controlled wallet endpoint with the configured wallet set and target blockchains.

Settlement is isolated in `src/settlement.js`. Arc Testnet is the primary rail with chain ID `5042002`, USDC gas, and real explorer URLs. Base Sepolia is enabled as the hackathon bridge demo rail; Base mainnet remains out of scope.

State is persisted by `src/store.js` into SQLite at `.data/arcpay.sqlite`. This is good enough for local buildout and demos; move the same table model to managed Postgres before production.

Real transfer execution is isolated in `src/transferProvider.js`. Mock mode settles immediately. `TRANSFER_PROVIDER=circle` submits Circle developer-controlled wallet transfers and expects `/api/circle/webhook` reconciliation. `TRANSFER_PROVIDER=arc-appkit` is intentionally disabled for user payments because it would use a backend signer.

Backend worker execution is isolated in `src/jobs.js`. Local runs use `POST /api/jobs/run-due`; a deployed setup should call the same job runner from cron, a queue consumer, or a hosted worker.

DeFi integration is isolated in `src/defiOrchestrator.js` and adapter modules. Live bridge/swap quotes prefer Circle AppKit and fall back to LI.FI where useful. Confirmed bridge/swap actions enqueue an `execute_defi_action` job; by default the job stops safely with `execution_not_enabled`, and with `DEFI_LIVE_ADAPTERS=1`, `DEFI_EXECUTION_ENABLED=1`, and `APPKIT_EXECUTION_ENABLED=1`, AppKit submits through the user's Circle wallet. LI.FI transaction requests can still submit through Circle contract execution where LI.FI returns calldata. DeFi receipts expose provider status, tx hash, and explorer URL. If no provider supports a requested rail/token pair, the job fails closed instead of pretending settlement happened. Order placement and leveraged trading should stay confirmation-gated and protocol-allowlisted.

## Prototype Boundaries

This repository is still safe-by-default: no real funds move unless `PROVIDER_MODE=real` and real provider credentials are supplied. Production hardening still needs managed Postgres, production key management, real Circle webhook public key setup, hosted worker scheduling, withdrawal flows, and deployment-grade observability.
