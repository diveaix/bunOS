# bunOS Complete Trading Agent Plan

This file is the source of truth for turning bunOS from a tool-driven bot into a complete Arc-native trading AI agent.

Read this file before starting each phase and after completing each phase. When a phase is completed, update its status, notes, files changed, verification, and remaining gaps here before moving on.

## Product Bar

bunOS should feel like a trading agent with judgment, memory, and follow-through.

It should not merely say:

> Tool ran. Status pending.

It should say:

> I checked your wallet, route quality, fees, market context, and policy. I am taking / refusing / waiting on this action for these reasons. Here is the receipt, tx hash if available, and what I will monitor next.

## Non-Negotiables

- No backend signer may spend user funds.
- Every money-moving action must have policy trace, signer trace, receipt, and idempotency.
- Every failed action must explain the real reason.
- Every pending action must be monitorable until terminal success or failure.
- MCP keys must stay scoped to the authenticated handle and allowed scopes.
- Public responses must redact secrets, tokens, private keys, provider credentials, and internal sensitive details.
- Terminal, MCP, API, and X bot must share the same agent decision layer.
- No fake transaction success. If execution is not real or not confirmed, say so plainly.

## Phase 1 - Natural Agent Response Layer

Goal: make every response feel like a trading agent made a decision.

Tasks:

- Add an agent response narrator that converts structured execution results into natural language.
- Standardize response shape across terminal, API, MCP, and X:
  - `summary`
  - `decision`
  - `whatChecked`
  - `whatHappened`
  - `why`
  - `nextAction`
  - `receipt`
  - `txHash`
  - `warnings`
- Add response modes:
  - `executed`
  - `monitoring`
  - `waiting`
  - `refused`
  - `needs_approval`
  - `clarifying`
  - `failed`
- Replace generic fallback copy with situation-specific language.
- Make the terminal render the natural response first, then details.
- Make X replies use the same narrator.

Acceptance:

- `swap $1 USDC to cirBTC` explains liquidity/route failure like a trader.
- `close my perp` explains whether a position was found, closed, or why it failed.
- No response leads with raw tool names unless the user asks for technical output.

Status: Complete locally

Notes:

- Existing `decision` objects are a good base.
- This phase should not add new trading abilities; it changes how the agent communicates.
- Added a shared narrator so terminal, API/MCP, and X bot responses can speak from the same execution state.
- The narrator is intentionally honest: it distinguishes executed, monitoring, approval-needed, failed, refused, and clarifying states instead of dressing pending actions as success.

Files changed:

- `src/agentNarrator.js`
- `src/agentPlanner.js`
- `src/xPayments.js`
- `frontend/src/pages/Terminal.jsx`
- `test/run-tests.js`

Verification:

- `npm test` - 48/48 passed.
- `npm run frontend:build` - passed.

Remaining gaps:

- Phase 2 still needs true execution follow-through so queued/monitoring actions can auto-update to final settled/failed states in the terminal and X replies.

## Phase 2 - Execution Follow-Through

Goal: no swap, bridge, payment, or perp remains stuck at vague `pending`.

Tasks:

- Add a unified execution monitor for money-moving actions.
- Track lifecycle states:
  - `planned`
  - `quoted`
  - `queued`
  - `submitted`
  - `settled`
  - `failed`
  - `expired`
  - `needs_user_signature`
- Auto-poll DeFi receipts when terminal action queues execution.
- Add terminal follow-up updates for queued actions.
- Add receipt refresh endpoint that returns the latest execution state.
- Add X reply update path for final success/failure when reply credentials are configured.
- Store final tx hash and explorer URL when available.
- Update balances after settled actions when Circle/provider state is available.

Acceptance:

- If a bridge queues, the user sees whether it submitted, settled, or failed.
- If a swap fails after quote, the user sees the exact provider/job reason.
- Receipts show a complete timeline.

Status: Complete locally

Notes:

- Existing jobs and DeFi receipt code should be reused.
- This phase is critical for trust.
- Added a unified execution monitor for payments, DeFi actions, and perp proposals.
- Terminal polling now refreshes the monitor endpoint and shows lifecycle, job, receipt, tx hash, reason, and next action.
- X command receipts can now be refreshed into a final/update reply payload when monitored execution changes.
- MCP now exposes `refresh_execution_monitor` for agents that need to follow a payment, swap/bridge, or perp proposal after the first command.

Files changed:

- `src/executionMonitor.js`
- `src/agentPlanner.js`
- `src/server.js`
- `src/xPayments.js`
- `src/xReplyPoster.js`
- `src/mcp.js`
- `src/securityPolicy.js`
- `frontend/src/pages/Terminal.jsx`
- `test/run-tests.js`

Verification:

- `npm test` - 48/48 passed.
- `npm run frontend:build` - passed.

Remaining gaps:

- Provider truth still matters: if Circle/AppKit or another adapter cannot return final settlement/tx state, the monitor reports the exact blocked or still-monitoring state instead of faking success.
- X final replies are now supported by API path, but real posting still depends on configured X reply credentials and `tweet.write` scope.

## Phase 3 - Portfolio Brain

Goal: the agent understands the wallet as a portfolio, not just isolated commands.

Tasks:

- Add a portfolio snapshot module:
  - total value by rail
  - assets by token
  - stable vs volatile exposure
  - perps exposure
  - idle capital
  - unsettled/pending actions
  - strategy drift
- Add portfolio recommendation function.
- Add natural commands:
  - `analyze my portfolio`
  - `what should I do with my wallet`
  - `am I overexposed`
  - `what changed since last trade`
- Feed portfolio snapshot into every trading decision.
- Add terminal portfolio intelligence rendering.
- Add MCP tool for portfolio analysis.

Acceptance:

- The agent can answer “what should I do with my portfolio?” without blindly asking for a command.
- The agent can explain risk from balances, open perps, and pending actions.
- The agent can recommend holding when trading is not useful.

Status: Complete locally

Notes:

- Strategy primitives already exist, but they need broader portfolio context.
- Added a broad portfolio brain that reads wallet assets across rails, stable/volatile exposure, perps proposal exposure, pending actions, strategy drift, and last trade memory.
- Added natural agent commands such as `analyze my portfolio`, `what should I do with my wallet`, `am I overexposed`, and `what changed since last trade`.
- Agent state now includes compact portfolio context, so every trading decision can warn about portfolio risk, pending actions, and strategy drift.
- Terminal and MCP can render/use portfolio recommendations without creating a trade.

Files changed:

- `src/portfolioBrain.js`
- `src/agentPlanner.js`
- `src/agentMemory.js`
- `src/agentNarrator.js`
- `src/modelPlanner.js`
- `src/mcp.js`
- `src/securityPolicy.js`
- `src/server.js`
- `frontend/src/pages/Terminal.jsx`
- `test/run-tests.js`

Verification:

- `npm test` - 48/48 passed.
- `npm run frontend:build` - passed.

Remaining gaps:

- Portfolio values currently use synced wallet/ledger USD values. Phase 4 should add external live price feeds and freshness labels for non-stable assets.
- Open ArcPerps positions from chain reads are not yet merged into the portfolio snapshot; current perps exposure is based on local perp proposals/execution state.

## Phase 4 - Real Market Feeds

Goal: give the agent external market context, not only local route history.

Tasks:

- Add market feed abstraction.
- Add token price feeds for supported Arc assets:
  - USDC
  - EURC
  - cirBTC
  - WETH
  - native gas token where useful
- Add route quote sampling over time.
- Add liquidity/route availability tracking.
- Add Hyperliquid/perps market context:
  - funding
  - mark price
  - open interest if available
  - volatility proxy
- Add regime labels:
  - `risk_on`
  - `risk_off`
  - `high_fee`
  - `low_liquidity`
  - `high_volatility`
  - `stale_data`
- Feed market context into strategy checks and trade decisions.

Acceptance:

- The agent can say “I am waiting because volatility/fees/liquidity are bad.”
- The agent can compare a requested trade against current market conditions.
- Market data freshness is visible.

Status: Complete locally

Notes:

- Current Phase 5 market intelligence tracks local route history. This phase adds external feeds.
- Do not fake prices. If a feed is unavailable, mark it stale/unavailable.
- Added a market feed abstraction for supported Arc assets, route sampling, liquidity availability, and Hyperliquid/perps context.
- Token feeds support USDC, EURC, cirBTC, WETH, and native gas reference. Stablecoins use explicit reference pricing when external feeds are not enabled; volatile assets are marked unavailable/stale rather than invented.
- Hyperliquid live mode now attempts `metaAndAssetCtxs` for mark price, funding, open interest, and volatility proxy when available.
- Market intelligence now combines local route history with feed freshness and feed regime labels.
- Trade decisions receive market-feed warnings without automatically blocking valid routes unless a live feed was attempted and failed.
- Terminal and MCP can render/consume `get_market_feed_snapshot`.

Files changed:

- `src/marketFeeds.js`
- `src/marketIntelligence.js`
- `src/hyperliquidAdapter.js`
- `src/agentPlanner.js`
- `src/agentMemory.js`
- `src/agentNarrator.js`
- `src/perpsAgent.js`
- `src/modelPlanner.js`
- `src/mcp.js`
- `src/securityPolicy.js`
- `src/server.js`
- `frontend/src/pages/Terminal.jsx`
- `test/run-tests.js`

Verification:

- `npm test` - 48/48 passed.
- `npm run frontend:build` - passed.

Remaining gaps:

- Live token prices require `MARKET_FEEDS_ENABLED=1` or live DeFi adapters. Without that, volatile assets are intentionally marked unavailable/stale.
- Open interest/funding are returned only if Hyperliquid exposes them in `metaAndAssetCtxs`; otherwise those fields remain unavailable.
- No historical volatility database yet; volatility proxy is based on available feed fields only.

## Phase 5 - Strategy Goals And Mandates

Goal: users can give the agent standing instructions.

Tasks:

- Add persistent user mandates:
  - target allocation
  - max per-trade size
  - max daily spend
  - max leverage
  - allowed assets
  - forbidden assets
  - max fee ratio
  - max slippage
  - rebalance threshold
  - DCA rules
  - stop-loss / take-profit rules
- Add mandate parser:
  - `keep me 70% stables and 30% BTC`
  - `never bridge if fee is over 3%`
  - `DCA $5 into BTC daily unless volatility is high`
  - `close perps if liquidation buffer drops below 15%`
- Add mandate conflict detection.
- Add mandate receipts/audit trail.
- Add terminal and MCP tools to list/update/delete mandates.

Acceptance:

- The agent can remember and enforce user trading rules across sessions.
- The agent refuses actions that violate standing user rules.
- The agent can explain which mandate caused a refusal.

Status: Complete locally

Notes:

- Existing strategy policies are a starting point, but mandates should cover all trading behavior.
- Added a persistent mandate engine stored in per-user agent memory, which is already persisted with the user record.
- Mandates now cover target allocations, max trade size, max daily spend, max leverage, allowed/forbidden assets, max fee ratio, max slippage, rebalance thresholds, DCA rules, liquidation-buffer triggers, and stop-loss/take-profit rules.
- The deterministic parser now recognizes rules such as `keep me 70% stables and 30% BTC`, `never bridge if fee is over 3%`, `DCA $5 into BTC daily unless volatility is high`, `close perps if liquidation buffer drops below 15%`, `max trade $10`, and `max leverage 2x`.
- DeFi swaps/bridges and perp proposals now call mandate enforcement before execution/proposal approval. Violations return a rejected action with the exact mandate reason.
- Mandate create/update/delete operations write receipt-style audit entries into the event ledger.
- Terminal, MCP, model planner, API, and agent decision checks all understand mandate tools.

Files changed:

- `src/mandates.js`
- `src/agentPlanner.js`
- `src/defiOrchestrator.js`
- `src/perpsAgent.js`
- `src/agentMemory.js`
- `src/agentNarrator.js`
- `src/modelPlanner.js`
- `src/mcp.js`
- `src/securityPolicy.js`
- `src/server.js`
- `frontend/src/pages/Terminal.jsx`
- `test/run-tests.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 49/49 passed.
- `npm run frontend:build` - passed.

Remaining gaps:

- Target allocation and DCA mandates are stored and surfaced, but automated execution scheduling still belongs in the automation/strategy phases; they do not independently rebalance yet.
- Mandates currently enforce DeFi swaps/bridges and perp proposal creation. Payment-specific mandate enforcement can be added if we want max-daily-spend to include direct sends as a hard block before payment creation.
- Conflict detection is intentionally conservative; a richer UI should help users resolve overlapping rules.

## Phase 6 - X-Native Trading Agent

Goal: bunOS works as a real X trading agent with replies, receipts, approvals, and replay protection.

Tasks:

- Finalize X bot mention ingestion.
- Support commands:
  - send
  - swap
  - bridge
  - perps
  - portfolio analysis
  - strategy creation
  - automations
  - distributions/bounties where policy allows
- Add approval-link flow for risky actions.
- Add public receipt links.
- Add final reply updates when actions settle/fail.
- Add replay protection for X events, posts, replies, and approvals.
- Add clear bot identity and safety copy.

Acceptance:

- `@bunos swap $5 USDC to EURC` creates the same decision/receipt as terminal.
- Replayed X events cannot duplicate trades.
- Bot replies with final status and tx hash when available.

Status: Complete locally

Notes:

- Existing X loop is already shared with `runAgentAction`; this phase completes production polish.
- X commands now support automation creation/list/run/pause/resume/delete through the same shared agent decision layer as terminal and MCP.
- Automation receipts are linked into X command receipts, public receipt pages, and reply text.
- X replies now refuse duplicate posting when a reply has already been delivered for a command.
- Bot replies now include explicit bunOS safety copy around signer policy/no backend signer usage.

Files changed:

- `src/agentPlanner.js`
- `src/modelPlanner.js`
- `src/xPayments.js`
- `src/xReplyPoster.js`
- `src/server.js`
- `test/run-tests.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 51/51 passed.
- `npm run frontend:build` - passed.

Remaining gaps:

- Real X reply posting still depends on production X credentials, `tweet.write` scope, and `X_REPLY_ENABLED=1`.
- Phase 7 should add stronger signed approval tokens, cross-channel replay locks, rate limits, and public/private receipt separation audits.

## Phase 7 - Security And Reliability Upgrade

Goal: move from hackathon-safe to serious-infra baseline.

Tasks:

- Add spend locks per user/action/idempotency key.
- Add replay locks for API, MCP, terminal, and X approval paths.
- Add per-scope API key rate limits.
- Add signed approval tokens with expiry.
- Add public/private response separation.
- Add stronger audit log queries.
- Add secret scanning checks for generated responses/logs.
- Add invariants:
  - backend signer cannot spend user funds
  - MCP key cannot switch handle
  - approval cannot execute another user’s action
  - duplicate event cannot create duplicate money movement
- Add tests for malicious handle override attempts.

Acceptance:

- A read-only MCP key cannot call trade/payment tools.
- A key for `@alice` cannot spend from `@bob`.
- Duplicate approval/event calls are idempotent.
- Public receipts never leak secrets or internal provider credentials.

Status: Complete locally

Notes:

- Scoped MCP keys, forced handle context, redaction, and security audit events are already implemented locally.
- Added signed approval tokens with expiry for public X approval links.
- Added spend locks around approval execution so duplicate confirmations cannot create duplicate money movement.
- Added replay locks for API agent-run idempotency keys.
- Added per-scope MCP API key rate limits.
- Added public payload leak checks and backend-signer spend invariants.
- Added a security audit query endpoint scoped to the signed-in user.
- Added hostile handle override tests for MCP keys and approval ownership.

Files changed:

- `src/securityPolicy.js`
- `src/securityGuards.js`
- `src/mcpApiKeys.js`
- `src/redaction.js`
- `src/mcpJsonRpc.js`
- `src/agentActions.js`
- `src/xPayments.js`
- `src/server.js`
- `src/fixtures.js`
- `src/store.js`
- `test/run-tests.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 54/54 passed.
- `npm run frontend:build` - passed.

Remaining gaps:

- Production deployments should still put CDN/WAF-level rate limits in front of public endpoints.
- Signed public approvals now exist for X command approvals; non-public/internal approval APIs remain session/API-context driven.
- Audit querying is local-app level. Phase 8 should turn this into richer observability with metrics and alert-ready health summaries.

## Phase 8 - Production Observability

Goal: operate the agent without flying blind.

Tasks:

- Add structured logs for agent decisions.
- Add metrics:
  - actions planned
  - actions executed
  - failures by reason
  - route failure rate
  - average execution time
  - pending actions
  - approval conversion
  - X command success rate
- Add `/api/admin/agent-health` or private equivalent.
- Add error categories.
- Add alert-ready status summaries.

Acceptance:

- We can tell what the agent is doing and why failures happen.
- Demo and production debugging do not require reading raw ledger blobs.

Status: Complete locally

Notes:

- Keep admin data private. Do not expose secrets or user-sensitive content publicly.
- Added a compact agent observability ledger fed from the shared `runAgentAction` path.
- Added structured decision events with source, tool, status, stance, timing, failure category, receipt/tx presence, and redacted reasons.
- Added metrics for planned actions, executed actions, failures by category, route failure rate, average execution time, pending actions, approval conversion, and X command success rate.
- Added private admin endpoints for agent health, agent metrics, and scoped agent event inspection.
- Added alert-ready health summaries for high failure rate, route failures, pending backlogs, approval backlogs, and X command success issues.

Files changed:

- `src/agentObservability.js`
- `src/agentPlanner.js`
- `src/server.js`
- `src/fixtures.js`
- `src/store.js`
- `test/run-tests.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 55/55 passed.
- `npm run frontend:build` - passed.

Remaining gaps:

- Admin endpoints currently require a signed-in session but not a separate admin role. Add role-based access before multi-tenant production.
- Metrics are ledger-derived and in-process. A production deployment should export these to a real metrics/log backend.
- Phase 9 should surface the most useful agent health and pending-action context in the frontend without exposing raw admin internals.

## Phase 9 - Frontend Agent Experience

Goal: the UI feels like a serious trading cockpit with an AI agent, not a form wrapper.

Tasks:

- Make the agent response the primary terminal output.
- Add portfolio intelligence view.
- Add active/pending execution monitor.
- Add strategy/mandate management view.
- Add receipts/timeline view for every action.
- Add market regime widget.
- Add risk warnings that are readable, not noisy.
- Add empty states that guide users without fake demos.

Acceptance:

- A user can understand wallet state, strategy, pending actions, and agent reasoning without opening logs.
- The UI does not expose raw command boxes as the main product pattern.

Status: Complete locally

Notes:

- Keep the current brand direction, but make the app more operationally useful.
- Added an Agent cockpit as the default wallet view so the product opens on portfolio intelligence, pending execution state, market regime, risk warnings, standing rules, and receipts instead of only raw wallet actions.
- The cockpit reads real backend state from portfolio analysis, market feeds, mandates, automations, agent health, and agent decision events. If private/admin data is unavailable, the UI says so rather than inventing status.
- Pending executions are aggregated from portfolio pending actions, DeFi actions, payments, approvals, and automations so the user can see what still needs follow-through.
- Standing rules can now be created and removed from the dashboard without forcing users into terminal commands.
- Timeline now surfaces agent reasoning and receipts across terminal/MCP/X/wallet activity where receipt links exist.

Files changed:

- `frontend/src/pages/Wallet.jsx`
- `frontend/src/pages/Wallet.css`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm run frontend:build` - passed.
- `npm test` - 55/55 passed.

Remaining gaps:

- The cockpit currently uses the existing wallet route instead of a dedicated `/agent` route. That is acceptable for this phase, but a later product pass could split wallet custody from agent operations.
- Agent health endpoints are session-private but not role-gated; Phase 10 should decide whether user-level health is enough or whether separate admin views are needed.
- Execution monitor rows show current known state. Deep per-row live polling is still strongest in Terminal; a later polish pass can add inline refresh per execution row.

## Phase 10 - End-To-End Real Execution Readiness

Goal: verify the complete product with real testnet execution.

Tasks:

- Run local real-mode checklist.
- Verify X OAuth with production callback.
- Verify Circle wallets per real user.
- Verify Arc RPC/Canteen tracking.
- Verify real swap route or truthful unavailable state.
- Verify real bridge route or truthful unavailable state.
- Verify ArcPerps readiness and user-wallet execution boundaries.
- Verify MCP with scoped API key.
- Verify receipt links.
- Verify frontend deployed envs.
- Verify Railway backend envs.

Acceptance:

- Every public feature either works with real testnet execution or clearly says why it cannot execute.
- No mock/demo language appears in user-facing production flows.

Status: Complete readiness pass

Notes:

- Production backend health shows real mode is configured: Circle wallets ready, Gemini model enabled, Arc RPC uses the Canteen-tracked `ARC_TESTNET_RPC_URL`, and Canteen tracking is connected.
- Frontend production at `bunos.xyz` is serving the current React/Vite bundle and rewrites `/api/*` to the Railway backend.
- Created a fresh production test handle through `/api/wallets/create`; Circle returned per-rail Arc Testnet and Base Sepolia developer-controlled wallet ids/addresses.
- Production live bridge quote for `1 USDC arc-testnet -> base-sepolia` returned a real Circle AppKit executable quote with gas/forwarder fees and no backend signer use. Execution correctly failed with `Insufficient USDC balance on Arc Testnet` on the empty smoke wallet.
- Production live swap quote for `1 USDC -> EURC on arc-testnet` returned a real Circle AppKit executable quote with estimated output and fees. Execution correctly failed with `Insufficient token balance on Arc Testnet` on the empty smoke wallet.
- Production smoke against an unfunded legacy `@sara` handle produced a truthful `quote_unavailable` because no Circle wallet was found for that handle on Arc. This is expected and useful error behavior.
- Local temp-clone Canteen preflight confirmed the CLI is logged in, but local env in the clone does not include `ARC_TESTNET_RPC_URL`, so local backend health falls back to public Arc RPC. Railway production is correctly configured with the Canteen RPC.
- X OAuth is configured in production. X bot reply posting is intentionally not ready until `tweet.write`, `X_REPLY_ENABLED=1`, and `X_BOT_ACCESS_TOKEN` are configured.
- MCP stdio smoke passed locally with the full tool surface and backend signer disabled for user funds.

Files changed:

- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 55/55 passed.
- `npm run frontend:build` - passed.
- `npm run arc:canteen:preflight` - local CLI logged in, but temp-clone env missing `ARC_TESTNET_RPC_URL`; production health verifies Canteen RPC is configured.
- `npm run mcp:smoke` - passed locally; 74 tools exposed, removed tools absent, signer policy shows `backendSignerAllowed: false`.
- `GET https://backend-production-efc9.up.railway.app/api/health` - passed; production Circle, Gemini, Canteen RPC, jobs, automations, and live DeFi adapters visible.
- `GET https://bunos.xyz/api/health` - passed through Vercel rewrite.
- `GET https://bunos.xyz/wallet` - served current bundle with backend origin.
- `POST /api/wallets/create` on production - created a real Circle wallet profile for a fresh test handle.
- `POST /api/defi/quote` bridge on production - live Circle AppKit quote returned; execution blocked honestly by insufficient USDC.
- `POST /api/defi/quote` swap on production - live Circle AppKit quote returned; execution blocked honestly by insufficient token balance.

Remaining gaps:

- Funded-wallet smoke is still needed to produce an actual settled swap/bridge tx hash on production. Current smoke used a fresh zero-balance wallet and correctly stopped at insufficient funds.
- X bot public reply posting is not enabled yet because production health reports missing `tweet.write`/bot access token setup.
- ArcPerps user-wallet execution remains proposal/user-signing-adapter gated; backend signer execution is intentionally not exposed.
- Admin observability is session-private but not role-based. Add role separation before broad multi-tenant launch.
- Root dependency audit still reports vulnerabilities after install; review and upgrade dependencies deliberately rather than force-fixing during deploy.

## Current Recommended Next Phase

Next recommended work: funded production smoke and role-gated production hardening.

Reason: Phases 1-10 now give the agent natural communication, execution follow-through, portfolio context, market feeds, mandates, X-native receipts, security controls, backend observability, a cockpit-style frontend, and production readiness checks. The biggest remaining proof point is funding a production smoke wallet and recording a settled testnet swap/bridge receipt.
