# bunOS Token Launchpad Architecture

## Product Shift

bunOS should move from wallet plus terminal to launchpad plus terminal, with the wallet becoming supporting infrastructure. The primary promise is:

> Agents and humans can launch Arc-native tokens, seed initial USDC liquidity, open markets, and monitor launch health through policy-gated autonomous workflows.

The wallet remains important, but it becomes the funding, signing, settlement, fee-claiming, and receipt layer behind launches. The Bankr-inspired loop is: launch an agent token, earn trading fees, claim those fees into compute credits, and use the resulting treasury to fund the agent's runtime.

## Core Surfaces

- Launchpad: primary product surface for token creation, launch plans, liquidity setup, launch receipts, and post-launch monitoring.
- Terminal: natural-language control surface for creators and operators.
- Agents: integration surface for autonomous access through API keys, MCP, and SDK.
- Wallet: side surface for balances, approvals, funding, and transfer history.

## Launch Lifecycle

1. Draft
   - Collect token name, symbol, metadata URI/hash, total supply, creator handle, initial allocation, liquidity budget, lock duration, and launch window.
   - Agent actions are planning-only at this stage unless a policy grant already exists.

2. Risk Review
   - Validate supply math, creator funding, liquidity seed, slippage, launch timing, route readiness, and agent spend limits.
   - Produce a public plan receipt before any on-chain action.

3. Token Deploy
   - Use `ArcLaunchFactory` to deploy an ERC-20 compatible token on Arc.
   - Record deterministic salt, creator, token address, metadata hash, supply, and launch id.

4. Liquidity Seed
   - Use USDC as the base asset.
   - Transfer token allocation and USDC seed into a liquidity router.
   - Create or seed a TOKEN/USDC pool.
   - Lock LP receipt or launch-owned liquidity in `ArcLiquidityLocker`.

5. Go Live
   - Open trading only after token deployment, liquidity seeding, and liquidity lock are complete.
   - Publish launch receipt, token address, pool address, liquidity lock, and risk summary.

6. Operate
   - Agents monitor pool depth, route quality, holder distribution, treasury balance, failed jobs, pending approvals, and liquidity lock status.

7. Self-Fund
   - TOKEN/USDC trading fees accrue to the launch treasury.
   - Agents claim fee share into compute credits.
   - Compute credits pay for LLM calls, API usage, MCP tool execution, and automations.
   - Runway is exposed as a first-class agent metric.

## Contract Architecture

- `ArcLaunchToken`
  - ERC-20 compatible launch token.
  - Capped initial supply.
  - Factory-controlled initial mint.
  - Immutable metadata hash where possible.

- `ArcLaunchFactory`
  - Creates canonical launch records.
  - Deploys launch tokens.
  - Emits launch creation and token deployment events.

- `ArcLaunchController`
  - Moves launches through reviewed states.
  - Enforces launch windows.
  - Coordinates token deployment, liquidity seeding, go-live, and emergency pause.

- `ArcLiquidityLocker`
  - Locks LP positions or launch-owned liquidity.
  - Blocks agent liquidity withdrawal by default.
  - Emits lock and unlock eligibility events.

- `ArcAgentPolicyVault`
  - Stores per-launch agent permissions.
  - Defines max budget, allowed actions, slippage, launch window, allowed rails, and pause authority.

## Liquidity Design

Base pair: TOKEN/USDC on Arc.

Default flow:

1. Creator or agent funds launch escrow with USDC.
2. Factory deploys launch token and mints launch allocation.
3. Controller sends token allocation and USDC to the liquidity router.
4. Router creates or seeds a TOKEN/USDC pool.
5. LP receipt or launch-owned liquidity is locked.
6. Receipt URL and telemetry become available to humans, agents, SDK users, and MCP clients.

Safeguards:

- Minimum liquidity seed before go-live.
- Price impact quote before pool creation.
- Slippage cap on liquidity creation.
- Required liquidity lock before public trading.
- Idempotency keys for every token deploy and liquidity action.
- Public receipts for token deploy, liquidity seed, lock, and go-live.

## Self-Funding Treasury

Each launch tracks:

- Gross trading volume
- Gross fees
- Agent fee share
- Protocol fee share
- Claimable USDC
- Claimed compute credits
- Runtime/API/tool spend
- Runway in days

Current adapter:

- `deterministic_local_fee_accrual`
- Used for local demos, tests, and agent API shape.

Future adapter:

- `arc_pool_fee_reader`
- Reads live pool fees from the selected Arc DEX/router.
- Claims fees into the agent treasury or creator wallet.

## Autonomous Agent Access

Agents should access launches through the same authorization model as the rest of bunOS:

- API key created by a signed-in user.
- Bearer token on REST and SDK calls.
- MCP tools for agent-native clients.
- Scope checks per action.
- Per-launch policy grants for autonomous execution.
- Idempotency keys for all state-changing actions.

Allowed without human approval:

- Draft launch
- Simulate launch
- Read launch status
- Monitor pool
- Publish receipt
- Run scheduled health check

Requires policy grant:

- Deploy token
- Seed liquidity
- Open trading
- Increase liquidity
- Start launch automation

Blocked by default:

- Withdraw locked liquidity
- Change token owner
- Mint extra supply
- Disable receipts
- Raise spend limit

## API Shape

Current endpoints:

- `GET /api/launchpad/architecture`
- `POST /api/launchpad/plan`
- `POST /api/launchpad/launches`
- `GET /api/launchpad/launches`
- `GET /api/launchpad/launches/:id`
- `POST /api/launchpad/launches/:id/deploy-token`
- `POST /api/launchpad/launches/:id/seed-liquidity`
- `POST /api/launchpad/launches/:id/go-live`
- `POST /api/launchpad/launches/:id/agent-policy`
- `GET /api/launchpad/launches/:id/receipt`
- `GET /api/launchpad/launches/:id/monitor`
- `GET /api/launchpad/launches/:id/fees`
- `POST /api/launchpad/launches/:id/fees/accrue`
- `POST /api/launchpad/launches/:id/fees/claim`
- `GET /api/launchpad/treasury`
- `POST /api/launchpad/treasury/spend`
- `GET /api/launchpad/feed`

## SDK Shape

Current:

- `launchpadArchitecture()`
- `planTokenLaunch(args)`
- `createTokenLaunch(args)`
- `deployLaunchToken(launchId)`
- `seedLaunchLiquidity(launchId)`
- `openLaunchTrading(launchId)`
- `updateLaunchAgentPolicy(launchId)`
- `getLaunch(launchId)`
- `listLaunches(filter)`
- `getLaunchReceipt(launchId)`
- `monitorLaunch(launchId)`
- `getLaunchFees(launchId)`
- `accrueLaunchFees(launchId, args)`
- `claimLaunchFees(launchId, args)`
- `getAgentTreasury(filter)`
- `spendAgentCompute(args)`
- `listLaunchFeed(filter)`

## MCP Tool Shape

Current:

- `get_launchpad_architecture`
- `plan_token_launch`
- `create_token_launch`
- `deploy_launch_token`
- `seed_launch_liquidity`
- `open_launch_trading`
- `update_launch_agent_policy`
- `get_token_launch`
- `list_token_launches`
- `get_launch_receipt`
- `monitor_launch`
- `get_launch_fees`
- `accrue_launch_fees`
- `claim_launch_fees`
- `get_agent_treasury`
- `spend_agent_compute`
- `list_launch_feed`

## Implementation Phases

1. Planning and receipts
   - Architecture endpoint
   - SDK helpers
   - Launch plan simulator
   - Launchpad UI blueprint

2. Contracts
   - Token contract
   - Factory
   - Controller
   - Liquidity locker
   - Contract tests

3. Liquidity execution
   - Pool adapter
   - USDC escrow
   - Liquidity quotes
   - LP lock receipts

4. Agent autonomy
   - MCP launch tools
   - Policy grants
   - Idempotent execution
   - Launch monitors

5. Self-funding
   - Fee accrual
   - Fee claiming
   - Compute credits
   - Agent treasury
   - Runway telemetry
