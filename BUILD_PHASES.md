# ArcPay Build Phases

Last updated: 2026-05-29

## Current Immediate Build Plan

This is the active plan. Older phase sections below are historical hackathon scaffolding and should not override this roadmap.

### Phase 1: Agent Overhaul

Status: Done locally.

- Replaced weak fallback responses with structured execution results.
- Added `close_perp_position` intent and tool path.
- Made terminal/X/MCP execution responses include `status`, `reason`, `txHash`, `receiptUrl`, and `nextAction` where applicable.
- Added agent memory for last trade, open positions, and "that action".
- Added failure narration so the agent explains why an action did not execute.

### Phase 2: X Bot Execution Loop

Status: Done locally.

- Built a reusable X bot loop that processes command/webhook input, creates receipts, and attempts real X replies when reply envs are enabled.
- Added command receipts with stable public receipt URLs, approval URLs, reply delivery state, signer policy, and tx hash fields.
- Added approval links at `/x/commands/:id/approve` and approval execution API at `/api/x/commands/:id/approve`.
- Hardened idempotency with explicit idempotency keys, event-id hashing, normalized command hashing, duplicate replay counters, and duplicate webhook rejection before execution.

### Phase 3: Real Arc Trading Primitives

Status: Built locally.

- Swaps and bridges route through DeFi/AppKit quote, confirmation, execution, reconciliation, and receipt primitives.
- Perps route through ArcPerps proposal, quote, open/close user-wallet paths, readiness checks, oracle reads, and position receipts.
- Airdrops are now first-class primitives with fixed-recipient distribution, social winner awarding, approvals, receipts, MCP tools, API routes, and terminal/X agent planning.
- Bounties remain available through social bounty creation and award flows.
- Automations run balance syncs, agent actions, and DeFi reconciliation through the same policy-gated surfaces.
- No user-facing path may spend through `ARC_SETTLEMENT_PRIVATE_KEY`.
- Unsupported live execution returns a clear `user_wallet_signing_required`, `execution_not_enabled`, or route-specific failure reason.

## Product Rule

No MCP tool, X agent action, dashboard action, or user-facing API may spend from a shared backend signer wallet.

`ARC_SETTLEMENT_PRIVATE_KEY` is admin-only for deploy/setup scripts. User money must move through one of these paths:

- Per-user Circle developer-controlled wallet
- User-delegated/session signing adapter
- Circle AppKit adapter backed by the user's Circle wallet

If a feature cannot execute with a user-owned wallet yet, it must return a quote, plan, approval, or `user_wallet_signing_required`. It must not silently fall back to the backend signer.

## Current Build Status

Overall local build: about 88 percent.

Hackathon demo readiness: about 80 percent.

The backend has a strong wallet, policy, MCP, X command, agent runner, ArcPerps read/quote foundation, and one real AppKit/Circle bridge execution smoke. The missing part is real X OAuth on HTTPS, production persistence/workers, swap-route realism, user-owned perps execution, and richer model fallback for ambiguous commands.

## Built Already

| Area | Status | Notes |
| --- | --- | --- |
| Dashboard wallet basics | Built | Create wallet, fund flow, balances, send flow, approvals, receipts. |
| Circle wallet provisioning | Built | Per-user Circle wallets on Arc and Base Sepolia demo rails. |
| Circle transfers | Mostly built | Real transfer provider path exists through Circle; needs final funded-wallet smoke. |
| X command parser | Built | Deterministic parser for send, bounty, basic perps command. |
| X webhook intake | Built | Signed webhook support, replay protection, command receipts. |
| MCP HTTP/SSE endpoint | Built | `/mcp`, `/sse`, `/mcp/sse`, `/api/mcp/tools`, `/api/mcp/call`. |
| MCP stdio server | Built | `npm run mcp:stdio`. |
| MCP wallet tools | Built | `create_wallet`, `get_balance`, `sync_circle_balances`, `request_testnet_usdc`, `send_usdc`. |
| MCP DeFi tools | Built | Circle AppKit bridge quotes/execution, LI.FI fallback, swap quotes where supported, Arc -> Base demo helper, confirmation handoff, action listing, reconciliation, receipts, Polymarket read, Hyperliquid read. |
| MCP agent planner/runner | Built | `plan_agent_action`, `run_agent_action`, `list_agent_tools`; no X reply/social ranking/prediction market tools. |
| ArcPerps contracts | Built/deployed | Vault/oracle contracts deployed on Arc testnet. |
| ArcPerps read/quote tools | Built | Readiness, status, oracle read, quote, position read/list. |
| Backend signer guardrail | Built | MCP/AppKit/ArcPerps execution no longer spends from backend signer. |
| Vercel scaffold | Built | `api/index.js`, `vercel.json`, env notes. |

## Missing

| Missing Piece | Why It Matters | Current State |
| --- | --- | --- |
| Real X OAuth on HTTPS | Required to prove users own their X identity. | Local mock works; real mode waits on Vercel HTTPS callback. |
| Durable production DB | Needed for real users, receipts, replay protection, approvals. | Local SQLite only. |
| Funded bridge execution smoke | Core DeFi capability. | Done once: 1 USDC Arc Testnet -> Base Sepolia via Circle AppKit/CCTP from the user's Circle wallet. |
| Funded swap execution smoke | Core DeFi capability. | AppKit reports Arc USDC -> native is invalid because Arc native gas is USDC; choose a supported Arc swap pair/token. |
| User-owned perps execution | Core hackathon differentiator. | Proposals/read/quote exist; execution is blocked until user wallet signing path exists. |
| AI planner layer | Makes it an agent, not just command regex and tools. | Deterministic planner and runner built; optional LLM fallback remains. |
| Agent risk narration | Needed so users know signer, gas payer, slippage, liquidation risk. | Signer/risk metadata exists; user-facing copy needs polish. |
| Circle challenge/policy UX | Needed for safe user approvals. | Backend approval records exist; UX and challenge flow need polish. |
| Worker/cron in deployment | Needed for queued jobs, reconciliation, retries. | Local `run-due` endpoint exists. |
| End-to-end funded smoke | Needed for judge confidence. | Bridge path executed; send/swap/perps need their own funded smoke. |

## Phase 1: User-Owned Wallet Execution Foundation

Goal: Make every money-moving action clearly execute from the user's wallet or fail safely.

Build:

- Confirm `TRANSFER_PROVIDER=circle` is the only live user payment provider.
- Remove or keep disabled all AppKit backend signer execution paths.
- Add a user-wallet capability endpoint: `GET /api/wallet/capabilities?handle=@user`.
- Add explicit signer metadata to every quote/action:
  - `signerType: circle_user_wallet`
  - `gasPayer`
  - `requiresUserApproval`
  - `executionStatus`
- Add tests that fail if MCP tools expose backend-signer execution.

Status:

- Built `GET /api/wallet/capabilities?handle=@user`.
- Built MCP tool `get_wallet_capabilities`.
- Built shared signer metadata helpers in `src/signerPolicy.js`.
- Added signer metadata to payments, DeFi quotes/actions, copy-trade proposals, perps proposals, read-only market intelligence, and AppKit actions.
- Added tests that fail if backend-signer ArcPerps execution tools are advertised through MCP.

Acceptance:

- Done: `send_usdc` uses Circle user wallet metadata only.
- Done: AppKit bridge/swap estimates use a Circle-wallet viem adapter with developer-controlled address context.
- Done: AppKit bridge execution submits from the user's Circle wallet when `APPKIT_EXECUTION_ENABLED=1`.
- Done: ArcPerps open/close via MCP is not advertised; API returns `user_wallet_signing_required`.
- Done: Tests prove no user-facing MCP tool advertises backend-signer ArcPerps execution.
- Remaining: funded live swap smoke with a supported pair and user-owned perps execution path.

## Phase 2: Real X Auth And Identity

Goal: Replace local mock identity with real X OAuth.

Build:

- Deploy to Vercel or another HTTPS host.
- Configure X Developer Portal callback:
  - `https://<domain>/auth/x/callback`
- Set:
  - `APP_BASE_URL`
  - `X_AUTH_MODE=real`
  - `X_CLIENT_ID`
  - `X_CLIENT_SECRET`
  - `X_REDIRECT_URI`
  - `X_WEBHOOK_SECRET`
- Add identity binding table:
  - X user id
  - handle
  - Circle wallet ids
  - policy profile
- Add OAuth smoke test endpoint/checklist.

Acceptance:

- A real X login creates/loads a Circle wallet.
- Receipts show verified X identity.
- Mock auth is not used in the public demo.

## Phase 3: AI Agent Planner Layer

Goal: Turn natural language into safe, structured tool calls.

Build:

- Add `src/agentPlanner.js`.
- Keep deterministic parser for simple commands.
- Use model planning only when the command is ambiguous or richer than regex.
- Planner output must be strict JSON:
  - intent
  - user
  - tool
  - arguments
  - risk
  - signerType
  - requiresConfirmation
  - explanation
- Add tool allowlist. The model cannot invent tools.
- Add refusal rules:
  - no unsupported assets
  - no backend signer
  - no leverage above policy
  - no spending without identity binding

Acceptance:

- Done: Built deterministic first-pass planner in `src/agentPlanner.js`.
- Done: Added HTTP endpoints `GET /api/agent/tools` and `POST /api/agent/plan`.
- Done: Added HTTP endpoint `POST /api/agent/run`.
- Done: Added MCP tools `list_agent_tools`, `plan_agent_action`, and `run_agent_action`.
- Done: Planner returns signer/risk metadata and never executes directly.
- Done: Runner plans first, then calls only allowlisted backend tools through policy-gated paths.
- Done: Agent can parse:
  - "send 10 usdc to @alice"
  - "swap 3 usdc to eth"
  - "long btc with 5 usdc at 2x"
- Done: Ambiguous requests return a clarification instead of guessing.
- Done: Planner never directly executes; `run_agent_action` executes through backend policy only.
- Remaining: optional Gemini fallback for richer language once `GEMINI_API_KEY` is configured.

## Phase 4: X Agent Execution Loop

Goal: Make the product work from X posts/replies.

Build:

- Intake real X events or polling/webhook source.
- Process:
  - sender identity
  - command text
  - idempotency key
  - planner result
  - policy result
  - approval/execution
  - receipt
- Add reply/receipt generation:
  - command accepted
  - approval required
  - settled/submitted
  - failed with reason
- Add public receipt page per command.

Acceptance:

- Done: Signed simulated X events can create Circle wallet actions, DeFi quote actions, and perp proposals.
- Done: Duplicate events do not double-spend.
- Done: Command receipts exist through `/api/x/commands/:id`.
- Done: Public command receipts exist through `/x/commands/:id`.
- Done: X command results now include bot-ready reply text that states the action, receipt, and signer policy.
- Done: Added `npm run hackathon:smoke` for wallet, send, bridge quote, swap quote, X perps command, public receipt, and preflight checks.
- Done: Added gated real X reply poster with readiness checks for `tweet.write`, `X_REPLY_ENABLED`, and `X_BOT_ACCESS_TOKEN`.
- Done: Added `npm run mcp:smoke` and trimmed MCP surface to remove X reply posting, social trader ranking, and prediction-market search.
- Done: Changed MCP `bridge_usdc` to create a policy-gated quote/approval instead of pretending a local balance move is real bridge settlement.
- Done: Added AGNT-style MCP HTTP and SSE transports at `/mcp`, `/sse`, and `/mcp/sse`.
- Remaining: real X webhook source after HTTPS deployment.
- Remaining: enable X reply envs on Vercel and smoke against a numeric real tweet id.

## Phase 5: Bridge And Swap With User Wallets

Goal: Make DeFi actions real without a backend signer.

Build options to investigate in order:

1. Circle developer-controlled wallet contract execution
2. Circle/AppKit adapter that can sign using the user's Circle wallet
3. Delegated/session key with explicit user approval
4. External wallet connect for advanced DeFi actions

Build:

- Bridge quote via AppKit/LI.FI.
- Swap quote via AppKit/LI.FI.
- Approval record with route, fees, slippage, gas payer.
- Execute only through user-owned signing.
- Reconcile transaction status.

Acceptance:

- Done: `bridge_usdc` no longer mutates local balances as final settlement in the MCP path.
- Done: `quote_swap` and `bridge_usdc` create policy-gated actions with approval records.
- Done: MCP `demo_bridge_arc_to_base` creates/loads the user wallet and returns an Arc Testnet -> Base Sepolia bridge quote/approval without auto-spending.
- Done: MCP clients can list DeFi actions, reconcile submitted executions, and fetch DeFi action receipts.
- Done: Added `DEFI_EXECUTION_ENABLED` as the hard switch for live swap/bridge execution.
- Done: Added `APPKIT_EXECUTION_ENABLED` as the hard switch for Circle AppKit transaction submission.
- Done: Confirmed bridge jobs can execute through Circle AppKit/CCTP using the user's Circle wallet, without `ARC_SETTLEMENT_PRIVATE_KEY`.
- Done: Confirmed LI.FI `transactionRequest` calldata can still submit through Circle user-wallet contract execution where LI.FI returns calldata.
- Done: Swap/bridge execution readiness reports blockers and keeps `backendSignerAllowed=false`.
- Done: LI.FI quote requests now resolve USDC/native token symbols to token addresses for live API calls.
- Done: Submitted DeFi actions enqueue `reconcile_defi_action` polling jobs.
- Done: Added manual DeFi reconciliation API and public receipts at `/defi/actions/:id`.
- Done: Added `npm run defi:live-smoke` to create/load a Circle wallet, sync balances, and test live Arc/Base route availability without a backend signer.
- Done: Restored the funded `@live163748` Circle wallet mapping and executed 1 USDC Arc Testnet -> Base Sepolia via Circle AppKit/CCTP.
- Remaining: choose and fund a supported swap pair for live swap execution.

## Phase 6: Perps With User Wallets

Goal: Make the ArcPerps hackathon differentiator real and safe.

Build:

- Perp proposal stays AI-assisted and confirmation-gated.
- User wallet approves/deposits margin.
- User wallet opens/closes position.
- Add risk controls:
  - max leverage
  - max margin
  - liquidation buffer
  - stop-loss suggestion
  - no auto-trade over policy
- Add position dashboard and receipt.

Acceptance:

- Perp execution does not use backend signer.
- User can see margin, PnL, liquidation price, and close status.
- Liquidation-risk explanation is shown before approval.

## Phase 7: Hackathon Demo Hardening

Goal: Make the judge flow reliable.

Build:

- Seed/test accounts checklist.
- One-click preflight screen:
  - Circle ready
  - X auth ready
  - webhook ready
  - MCP tools ready
  - user-owned execution status
- Demo scripts:
  - create wallet
  - sync balance
  - send USDC
  - quote bridge/swap
  - create perp proposal
  - show why execution requires user-owned signing if not complete
- Better error messages for Circle 403/faucet/funding issues.

Acceptance:

- Judge can understand what is real, what is blocked, and why.
- No mock transaction is presented as real.
- No backend signer spends user funds.

## Immediate Next Build

Build funded execution verification next while Phase 6 user-owned perps execution is being investigated.

The next concrete task is to run a real funded Circle/Li.FI smoke:

- fund the user's Circle Arc Testnet wallet.
- set `DEFI_LIVE_ADAPTERS=1` and `DEFI_EXECUTION_ENABLED=1`.
- quote Arc Testnet -> Base Sepolia bridge and Arc swap routes.
- confirm, run jobs, reconcile, and open `/defi/actions/:id`.
- if LI.FI cannot route Arc Testnet, implement an Arc/Circle-specific bridge adapter instead of pretending the bridge settled.

Latest verification target: `npm test`, `npm run mcp:smoke`, and `npm run hackathon:smoke -- --rail arc-testnet`.
