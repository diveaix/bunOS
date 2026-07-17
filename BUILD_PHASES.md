# bunOS Build Phases

## Current Direction

bunOS is now focused on an Arc-native token launchpad with an agent terminal and wallet infrastructure. The product goal is to let humans and autonomous agents create launch plans, prepare token deployments, seed USDC liquidity, monitor launch health, and produce receipts for every important action.

## Phase 1: Wallet And Identity

- X-handle based local identity.
- Circle-style wallet provisioning.
- Arc Testnet as the primary settlement rail.
- Base Sepolia as a demo bridge rail.
- Balance sync, funding instructions, sends, claimable escrow, and receipts.

## Phase 2: Terminal And Agent Runner

- Natural-language command parsing for sends, swaps, bridges, launch actions, airdrops, approvals, and automations.
- Shared planner path for terminal, X-style commands, API, MCP, and SDK usage.
- Policy gates before sensitive actions.
- Execution receipts and background reconciliation.

## Phase 3: MCP And SDK

- API-key backed MCP access.
- Agent discovery page explaining keys, authorization, MCP setup, SDK setup, and available skills.
- JavaScript SDK for authenticated bunOS API requests.
- Tests for authenticated SDK request construction.

## Phase 4: Launchpad

- Launchpad page for creating and previewing launches.
- Launch lifecycle records for token name, symbol, supply, liquidity seed, lock duration, slippage, creator handle, and receipts.
- Launch health views for readiness, treasury state, and execution logs.

## Phase 5: Launchpad Contracts

- `ArcLaunchToken` for launch token supply.
- `ArcLaunchFactory` for canonical launch records and token creation.
- `ArcLaunchController` for reviewed state transitions.
- `ArcLiquidityLocker` for locked launch liquidity.
- `ArcAgentPolicyVault` for agent permissions and budget controls.

## Phase 6: Production Readiness

- Replace local demo storage with durable managed persistence.
- Harden webhooks, idempotency, retries, and worker coordination.
- Add funded launch receipts on Arc Testnet.
- Expand launch telemetry around liquidity, holder distribution, fees, and agent runway.
- Keep user-wallet signing boundaries explicit for every money-moving action.
