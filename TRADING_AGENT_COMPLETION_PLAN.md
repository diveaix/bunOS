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

## Phase 11 - Agent Harness And Context Engineering

Goal: make bunOS carry a user objective across turns instead of treating every message as an isolated command.

Tasks:

- Add persistent, user-scoped working memory:
  - active objective
  - topic
  - pending clarification
  - missing fields
  - last truthful outcome
  - compact recent turns
- Preserve partially understood model intents instead of discarding them.
- Resolve short follow-ups into the pending task:
  - `use 5 dollars`
  - `send it to @alice`
  - `make it long`
  - `actually use WETH instead`
- Support task lifecycle controls:
  - cancel/forget/start over
  - explicit new objective supersedes stale context
  - meta-questions such as `why do you need that?`
- Keep model context query-aware, bounded, and free of wallet addresses/private credentials.
- Keep working memory valid after a terminal refresh or when no browser conversation history is supplied.
- Add adversarial multi-turn, isolation, privacy, ambiguity, correction, and cancellation evals.

Acceptance:

- `swap some USDC to EURC` followed by `use 5 dollars` produces one grounded swap plan without needing browser history.
- Partial answers update the task and ask only for fields that remain missing.
- `never mind` cancels an unfinished task instead of mapping to an unrelated trading tool.
- A clear new request replaces stale task context.
- One user's working memory never influences another user.
- Model context remains within its configured budget and excludes private wallet identifiers.

Status: Complete locally and pushed

Notes:

- Added a deep working-memory module instead of spreading task-state rules through parsers and UI code.
- Working memory is stored inside the persisted per-user agent memory record, so it survives backend persistence and cross-channel use.
- Context resolution runs before the model only for narrowly defined references and task controls. A clear deterministic request still supersedes stale task context.
- The model now receives compact active-task state and returns a preserved pending draft when required fields are missing.
- The agent can explain why a field is required without abandoning the active task.
- This phase improves understanding and continuity. It does not bypass route availability, policy, approvals, or user-owned signing requirements.

Files changed:

- `src/agentWorkingMemory.js`
- `src/agentContext.js`
- `src/agentMemory.js`
- `src/agentPlanner.js`
- `src/modelPlanner.js`
- `src/server.js`
- `test/agent-evals.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 59/59 core regression tests passed.
- `npm run test:agent` - all agent planning, execution, context, privacy, and multi-turn evals passed.
- Multi-turn evals cover refresh recovery, partial slot filling, cancellation, supersession, corrections, pending-task explanations, and handle isolation.

Remaining gaps:

- Funded production smoke is still needed to prove a settled swap/bridge tx hash with a real production wallet.
- X public reply posting still depends on production write credentials and scopes.
- ArcPerps remains bounded by the configured user-owned signing path and on-chain contract readiness.
- Production admin endpoints still need role-based access before broad multi-tenant launch.

## Phase 12 - Bounded Observe And Follow-Through Harness

Goal: let the agent inspect execution truth once after a tool call without creating recursive model/tool loops.

Tasks:

- Add one bounded post-tool observation step.
- Reuse the shared execution monitor and receipt modules.
- Permit only read-only observation:
  - no worker execution
  - no spend calls
  - no model calls
  - no retries
- Promote fresher lifecycle truth, failure reasons, tx hashes, explorer URLs, and receipt URLs.
- Preserve specific statuses such as `quote_unavailable` instead of flattening them into generic failure.
- Preserve the agent's established next-action guidance unless it is missing.
- Refuse receipt context that belongs to another handle.
- Keep harness trace out of normal terminal output while retaining it for internal/API diagnostics.

Acceptance:

- A failed execution job is reflected as failed on the first agent response without running the job again.
- A submitted receipt promotes its real transaction hash into the response.
- Observation uses at most one follow-up, zero model calls, zero spend calls, and zero worker runs.
- Cross-handle receipt state cannot be merged into another user's response.
- Actions without a receipt target skip observation cleanly.

Status: Complete locally and pushed

Notes:

- The observer is intentionally not a general autonomous loop. It is a bounded truth-refresh step.
- The frontend's longer execution polling remains responsible for future settlement changes after the first response.
- This design avoids the runaway credit/tool loops that previously burned model credits while still improving immediate execution truth.

Files changed:

- `src/agentHarness.js`
- `src/agentPlanner.js`
- `test/agent-evals.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 59/59 core regression tests passed.
- Agent harness evals passed, including no-loop/no-spend, failure promotion, tx-hash promotion, ownership isolation, and no-target behavior.

Remaining gaps:

- The observer does not autonomously choose a different trade after failure. That must remain a separate, explicit replan with policy checks.
- Long-running settlement still depends on the existing execution monitor polling path.
- Funded production settlement proof remains outstanding.

## Phase 13 - Context Contract And Scenario Corpus

Goal: make model-produced plans safe, testable, and stable across nuanced multi-turn conversations.

Tasks:

- Add one plan contract for deterministic, contextual, and model-produced plans.
- Reject plans before execution when they:
  - enable backend signing
  - cross the authenticated handle
  - contain secrets or private-key-shaped data
  - omit required money-moving fields
  - contain invalid rails, sides, or numeric values
- Normalize raw model intents through an exported, directly testable interface.
- Preserve incomplete model intents as grounded pending tasks.
- Prefer matching pending-task continuations over shallow fresh-command parsing.
- Let clear new objectives supersede stale context.
- Add a reusable scenario corpus for multi-turn context behavior.

Acceptance:

- A malformed model plan cannot reach a money-moving tool.
- A cross-handle or secret-bearing plan fails closed.
- `open a BTC perp` followed by `long with 4 dollars at 2x` completes the BTC plan instead of guessing a new market.
- `check my balance` still replaces an unfinished swap task.
- Raw incomplete swap and automation intents become precise pending tasks.
- The scenario corpus can grow without adding custom test code for every conversation.

Status: Complete locally and pushed

Notes:

- The plan contract is attached at the planning seam and asserted again at the execution seam.
- Contract validation is independent of the model provider. Grok, deterministic parsing, and contextual resolution all use the same interface.
- The contract does not prove that a route is liquid or a transaction will settle. Route capability, policy, user-wallet signing, and receipt truth remain separate modules.
- The scenario corpus exposed and fixed a real continuation-priority bug where a fragment could be misread as a new command.

Files changed:

- `src/agentPlanGuard.js`
- `src/agentPlanner.js`
- `src/modelPlanner.js`
- `test/agent-evals.js`
- `test/fixtures/agent-context-scenarios.json`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 59/59 core regression tests passed and all agent evals passed.
- `npm run frontend:build` - passed.
- Agent contract evals cover backend signer rejection, handle ownership, secret rejection, required fields, and no-tool-call failure.
- Context corpus covers swap/payment/perp completion, cancellation, and new-objective supersession.

Remaining gaps:

- Context facts do not yet carry explicit provenance and freshness timestamps in the model packet.
- Retrieval is topic-aware but not ranked by measured relevance or confidence.
- The model does not yet receive a compact tool-result ledger for long-running multi-step objectives.
- Funded production settlement proof remains outstanding.

## Phase 14 - Provenance-Aware Context And Objective Graph

Goal: make the agent distinguish current truth, configured capability, user statements, remembered history, and inference while tracking each user objective through its lifecycle.

Tasks:

- Add typed context facts with:
  - source
  - authority
  - observation time
  - expiry
  - freshness
  - relevance score
  - decision-use class
- Rank facts by topic, lexical relevance, authority, and freshness.
- Mark facts as:
  - `execution_authority`
  - `planning_hint`
  - `historical_only`
  - `unusable`
- Add a context-integrity summary for the model.
- Add a persistent objective graph with lifecycle steps:
  - understand
  - clarify
  - plan
  - approve
  - execute
  - monitor
  - complete
- Preserve objective evidence such as tool, action id, proposal id, position id, status, and transaction hash.
- Migrate existing working-memory records to the new schema without losing user state.
- Teach the model the fact trust hierarchy and stale-data rules.

Acceptance:

- Expired route, balance, approval, automation, or position observations cannot be treated as current execution truth.
- Configured routes are planning hints; only fresh probe facts prove recent quote availability.
- Remembered failures explain history but do not prove present failure.
- Authenticated identity and fresh ledger observations outrank conversational inference.
- An unfinished objective exposes its current lifecycle step.
- A clear new goal creates a new objective graph instead of inheriting stale steps.
- Submitted execution stores monitor evidence without storing secrets.

Status: Complete locally and pushed

Notes:

- The original domain-shaped context remains available because it is easier for the model to use. The ranked facts provide the evidence and trust layer underneath it.
- `decisionUse` is deliberately machine-readable; provenance is not merely explanatory metadata.
- Facts are query-aware and bounded with the existing model context budget.
- Objective graphs are intentionally compact. They are not an unrestricted autonomous task planner.

Files changed:

- `src/agentContextFacts.js`
- `src/agentContext.js`
- `src/agentWorkingMemory.js`
- `src/modelPlanner.js`
- `test/agent-evals.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 59/59 core regression tests passed and all agent evals passed.
- `npm run frontend:build` - passed.
- Context evals prove provenance, freshness, relevance, decision-use classification, stale observation rejection, objective lifecycle transitions, evidence retention, context budget, and private-data exclusion.

Remaining gaps:

- Facts are assembled from local application state. Production-grade infrastructure should eventually store observations in an append-only event store.
- Conflicting facts are ranked but not yet surfaced as an explicit contradiction set.
- The agent still performs one action per turn. A bounded multi-step execution graph with per-step policy gates is the next harness upgrade.
- Funded production settlement proof remains outstanding.

## Phase 15 - Bounded Multi-Step Orchestration

Goal: let the agent carry out small ordered workflows without turning a model response into an unrestricted autonomous execution loop.

Tasks:

- Add persistent user-owned workflows with two to four ordered steps.
- Let deterministic parsing and model planning preserve explicit phrases such as:
  - `then`
  - `and then`
  - `after that`
- Validate every workflow step through the normal agent plan contract and policy layer.
- Permit at most one spend-capable step per workflow invocation.
- Pause workflows when they require:
  - user approval
  - wallet execution
  - transaction settlement
  - another bounded invocation
- Refresh receipt state before advancing a waiting workflow.
- Store per-step evidence such as action id, proposal id, position id, status, transaction hash, receipt, and reason.
- Enforce workflow ownership and reject nested workflows.
- Stop on failure and explain manual compensation instead of pretending an on-chain action was rolled back.
- Add workflow create, resume, inspect, list, and cancel tools.
- Expose active workflow facts to the context packet and objective graph.

Acceptance:

- An ordered read-only workflow completes without recursive model calls.
- A workflow cannot execute more than one money-moving step in one invocation.
- A submitted step pauses until receipt truth is available.
- A failed step stops the workflow and does not execute later steps.
- One user cannot inspect, resume, or cancel another user's workflow.
- A workflow cannot create another workflow.
- Cancellation is persistent and prevents later execution.
- Existing one-step agent behavior remains unchanged.

Status: Complete locally and ready to push

Notes:

- This is bounded orchestration, not an open-ended autonomous loop.
- Each step is planned and validated independently so a valid first step cannot smuggle an invalid later action into execution.
- On-chain work is irreversible. Compensation guidance is explicit and manual unless a separate approved reverse action exists.
- The runner performs no recursive model calls. Model usage remains at the user-intent boundary.

Files changed:

- `src/agentWorkflow.js`
- `src/agentPlanner.js`
- `src/agentPlanGuard.js`
- `src/modelPlanner.js`
- `src/agentContext.js`
- `src/agentContextFacts.js`
- `src/agentWorkingMemory.js`
- `src/fixtures.js`
- `src/store.js`
- `test/agent-evals.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 59/59 core regression tests passed and all agent evals passed.
- `npm run frontend:build` - passed.
- Workflow evals cover ordered parsing, model normalization, read-only completion, spend-step budgeting, receipt refresh, ownership, nesting rejection, and cancellation.

Remaining gaps:

- Conflicting current facts are ranked but not yet exposed as a first-class contradiction set.
- Workflow continuation is invocation-driven. Production should resume from signed provider webhooks or a durable event worker.
- The frontend does not yet show a compact workflow timeline.
- Model-provider structured-output behavior still needs a live production smoke test.
- Funded production settlement proof remains outstanding.

## Phase 16 - Contradiction-Aware Context And Event Continuation

Goal: stop the agent from acting on conflicting current truth, and let waiting workflows continue from authoritative receipt events without burning model calls.

Tasks:

- Detect conflicting context facts by execution entity:
  - route capability
  - wallet spendability
  - open perp position
  - pending approval
  - active workflow
  - active objective
- Mark contradictions as blocking when they affect money movement.
- Keep contradiction metadata compact enough for the model context budget.
- Add a backend execution guard that refuses high-risk tools when blocking contradictions exist.
- Teach the model planner to refresh or clarify instead of inventing around contradictory facts.
- Add workflow lookup by monitor target.
- Add workflow resume from execution monitor events.
- Resume waiting workflows without recursive model calls.
- Preserve the existing bounded-context size invariant.

Acceptance:

- A fresh route probe conflict against a configured route is surfaced as a blocking contradiction.
- A spend-capable action refuses to execute when blocking context contradictions exist.
- Read-only questions are not blocked by contradiction metadata.
- Waiting workflows can be resumed from a payment, DeFi action, or perp proposal monitor target.
- Event continuation uses receipt truth and does not call the model.
- Model context remains bounded and secret-free.

Status: Complete locally and pushed

Notes:

- This does not make the agent pessimistic globally. The block applies to high-risk tools only.
- Contradictions are compacted before entering the model packet. The backend still keeps richer fact evidence for integrity assessment.
- Event continuation is now available as a backend primitive. Production webhooks can call it after reconciling receipts.

Files changed:

- `src/agentContextFacts.js`
- `src/agentContext.js`
- `src/agentPlanner.js`
- `src/agentWorkflow.js`
- `src/modelPlanner.js`
- `test/agent-evals.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 59/59 core regression tests passed and all agent evals passed.
- `npm run frontend:build` - passed.
- Syntax checks passed for changed agent modules and eval harness.
- New evals cover route contradiction detection, execution blocking on conflicting current route truth, and receipt-event workflow continuation without model calls.

Remaining gaps:

- Production webhooks still need to call the event-continuation primitive directly after receipt reconciliation.
- The frontend does not yet show a compact workflow timeline or contradiction explanation panel.
- Long-term memory retrieval is still mostly recency/topic based; semantic embeddings or indexed retrieval would help once history grows.
- Funded production settlement proof remains outstanding.

## Phase 17 - Monitor-Driven Workflow Continuation Wiring

Goal: connect the event-continuation primitive to real backend refresh and reconcile paths so waiting workflows do not depend on the user typing `continue`.

Tasks:

- Resume waiting workflows after payment execution refresh.
- Resume waiting workflows after generic execution-monitor refresh.
- Resume waiting workflows after DeFi action refresh.
- Resume waiting workflows after manual DeFi reconciliation.
- Resume waiting workflows after matched Circle payment webhooks.
- Resume waiting workflows from MCP `refresh_execution_monitor`.
- Resume waiting workflows from MCP `reconcile_defi_action`.
- Include public workflow continuation status in monitor/reconcile responses.

Acceptance:

- A workflow waiting on a settled DeFi action completes when MCP refreshes that action.
- Continuation uses receipt truth and does not call the model.
- Existing monitor responses remain compatible.
- Server and MCP paths share the same continuation semantics.

Status: Complete locally and pushed

Notes:

- The continuation hook is intentionally attached after monitor refresh/reconcile, not before. Receipt truth stays the authority.
- This does not introduce a polling loop. External webhooks, manual refreshes, and MCP calls can all advance waiting workflows.
- Circle webhook continuation is scoped to matched payment events because those expose a reliable payment id.

Files changed:

- `src/server.js`
- `src/mcp.js`
- `test/run-tests.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 60/60 core regression tests passed and all agent evals passed.
- `npm run frontend:build` - passed.
- Syntax checks passed for server, MCP, and test files.
- New regression proves MCP execution refresh resumes a waiting workflow with zero model calls.

Remaining gaps:

- The frontend does not yet show workflow continuation state as a user-facing timeline.
- X command refresh can still store monitor truth separately; it should also surface workflow continuation if X commands begin owning workflow IDs.
- Long-running workflow retries should eventually move to a durable event worker with explicit retry/backoff metrics.
- Funded production settlement proof remains outstanding.

## Phase 18 - Terminal Workflow And Conflict Clarity

Goal: make the terminal show agent orchestration in human language without exposing backend internals by default.

Tasks:

- Render bounded workflows as a short agent timeline.
- Render resumed execution-monitor workflows after receipts update.
- Render context contradictions as a clear pause reason instead of raw backend checks.
- Keep route checks, target ids, action ids, job ids, and market-intelligence internals out of the default terminal response.
- Preserve transaction and receipt links when they exist.

Acceptance:

- A user sees what the agent did, what is waiting, and what to do next.
- Backend-only diagnostics stay available in backend data but are not pushed into normal chat output.

Status: Complete locally and pushed

Notes:

- Added terminal renderers for workflow timelines, execution-monitor continuations, and context-conflict pause cards.
- The terminal now turns workflow steps into readable statuses like checking a route, sending a transaction, waiting for approval, or watching for a receipt.
- Context conflicts now pause money movement with a simple explanation instead of showing provider stack details.
- This phase improves the UX of already-built orchestration. It does not by itself solve provider liquidity, funded-wallet, or route availability issues.

Files changed:

- `frontend/src/pages/Terminal.jsx`
- `frontend/src/pages/Terminal.css`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm run frontend:build` - passed.
- `npm test` - 60/60 core regression tests passed and all agent evals passed.

Remaining gaps:

- Add a visual browser pass against live terminal messages once the app is running locally.
- Add an explicit "show diagnostics" affordance later if we want advanced users to inspect hidden backend checks on demand.

## Phase 19 - Fresh Route Capability Hardening

Goal: stop stale manual route seeds from being treated as executable live routes in real mode.

Tasks:

- Distinguish configured route candidates from fresh provider-proven routes.
- Add effective route status for UI, MCP, and agent route answers.
- Require a fresh route probe before trusting seeded `live` routes when `ROUTE_PROBE_ENABLED=1`.
- Auto-probe stale candidate routes during `quote_defi_route` before rejecting or executing.
- Keep local/mock behavior compatible for deterministic tests.

Acceptance:

- In real live-adapter mode with route probing enabled, a manual `live` seed is not enough to execute.
- Capability answers only list routes as live when the effective status is live.
- Unsupported or stale routes fail before wasting provider/execution work.
- Existing swap/bridge tests remain green.

Status: Complete locally and pushed

Notes:

- Seeded routes now mean "candidate route," not permanent proof of tradability.
- Probe-backed routes stay live only while the latest successful quote is fresh.
- This reduces false confidence from AppKit/LI.FI route availability claims, especially when a token is SDK-supported but not currently liquid.
- Production should set `ROUTE_PROBE_ENABLED=1` after confirming the AppKit key and user-wallet probe handle are configured.

Files changed:

- `src/routeRegistry.js`
- `src/defiOrchestrator.js`
- `test/run-tests.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 61/61 core regression tests passed and all agent evals passed.
- Syntax checks passed for `src/routeRegistry.js`, `src/defiOrchestrator.js`, and `test/run-tests.js`.

Remaining gaps:

- Production still needs a funded wallet smoke to record settled receipts.
- Route probes are invocation-driven/MCP-triggered today. A durable scheduled probe worker would keep the registry fresh without waiting for a user request.
- Route probe configuration should be reviewed before enabling it in production to avoid unnecessary provider/API usage.

## Phase 20 - Workflow Retry Backoff And Metrics

Goal: give long-running agent workflows bounded receipt refresh behavior, retry state, and observability.

Tasks:

- Add retry metadata to each workflow.
- Schedule exponential receipt-refresh backoff while a workflow waits for execution.
- Preserve explicit/manual resume behavior as a fresh receipt check.
- Let automated retry loops opt into backoff with `forceRefresh: false`.
- Keep monitor/webhook continuation able to bypass backoff when new receipt truth arrives.
- Expose waiting, due, exhausted, completed, failed, and cancelled workflow counts in agent metrics.

Acceptance:

- A waiting workflow does not hammer receipt refreshes in an automated loop.
- A user-triggered resume still checks the latest receipt immediately.
- Workflow state stays `waiting_execution` while the receipt is non-terminal instead of incorrectly showing `running`.
- Exhausted workflows are visible in health metrics.

Status: Complete locally and pushed

Notes:

- This is not a full durable worker yet. It creates the workflow retry contract and metrics that a durable worker can use safely.
- The state-machine bug where non-terminal monitor refreshes left a workflow as `running` was fixed.
- Workflow health now shows retry exhaustion so operations can spot stuck receipt monitors.

Files changed:

- `src/agentWorkflow.js`
- `src/agentObservability.js`
- `test/run-tests.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 62/62 core regression tests passed and all agent evals passed.
- Syntax checks passed for `src/agentWorkflow.js`, `src/agentObservability.js`, and `test/run-tests.js`.

Remaining gaps:

- Add a real durable workflow worker that scans due workflows and calls `runAgentWorkflow({ forceRefresh: false })`.
- Add production metrics export for workflow retry exhaustion and due-refresh backlog.
- Funded production smoke still needs settled receipts.

## Phase 21 - Durable Workflow Retry Worker

Goal: make waiting agent workflows advance from a background worker instead of relying only on user/manual refresh.

Tasks:

- Add a due-workflow scanner that selects waiting workflows whose retry backoff has elapsed.
- Add a shared worker runner that resumes due workflows with `forceRefresh: false`.
- Wire the server background tick to run due workflows alongside jobs, automations, oracle sync, and route probes.
- Add environment controls for workflow worker enablement and limit.
- Include due workflow runs in the manual `/api/jobs/run-due` endpoint.
- Test that only due workflows run and that settled receipts advance the workflow.

Acceptance:

- Waiting workflows can continue in the background once their retry window is due.
- Non-due workflows are skipped.
- Webhook/manual continuation can still bypass backoff when fresh receipt truth arrives.
- Background worker does not create a second timer or model-burning loop.

Status: Complete locally

Notes:

- The worker is intentionally bounded by `WORKFLOW_WORKER_LIMIT`.
- It reuses the existing server background tick, so operational behavior stays centralized.
- The runner uses the same planner/executor adapters as monitor continuation, with idempotency scoped by workflow id and current step.
- This is still an in-process worker. For serious scale, move it to a durable queue/cron process with external metrics.

Files changed:

- `src/agentWorkflow.js`
- `src/agentPlanner.js`
- `src/server.js`
- `src/config.js`
- `test/run-tests.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 63/63 core regression tests passed and all agent evals passed.
- Syntax checks passed for `src/agentWorkflow.js`, `src/agentPlanner.js`, `src/server.js`, `src/config.js`, and `test/run-tests.js`.

Remaining gaps:

- Production still needs a funded smoke wallet and settled receipts.
- Workflow retry metrics should eventually export to a real metrics/log backend.
- In multi-instance deployments, move this worker behind a distributed lock or external queue.

## Current Recommended Next Phase

Next recommended work: funded production smoke and externally shared worker coordination.

Reason: the backend orchestration and terminal clarity are now much stronger, but a trading agent is only convincing when it can show settled funded receipts for the live routes it claims are available. The biggest remaining proof point is funding a production smoke wallet and recording settled testnet swap/bridge/perp receipts. SQLite leasing now prevents duplicate worker ticks when processes share the same database, but independent Railway replica files still require a shared database or queue.

## Phase 22 - Persisted Worker Lease

Goal: prevent two backend processes from running the same due jobs, automations, or agent workflows at the same time.

Tasks:

- Add an atomic persisted lease at the worker execution seam.
- Give every process a unique owner identity.
- Renew the lease while a long worker tick is active.
- Allow takeover only after lease expiry.
- Release only when the current owner still owns the lease.
- Expose current lease state in backend health.
- Add configuration for lease enablement, name, and TTL.
- Test contention, wrong-owner renewal/release, and expiry takeover.

Acceptance:

- A second process using the same SQLite database skips the worker tick while the first lease is active.
- A crashed worker stops blocking progress after its lease expires.
- A process cannot renew or release another process's lease.
- Long ticks renew ownership without creating a second execution loop.

Status: Complete locally

Notes:

- This hardens multi-process deployments that share one SQLite file or Railway volume.
- It does not coordinate replicas with isolated filesystems. Serious horizontal scale still needs Postgres/Redis-backed leasing or an external queue.
- The existing in-process mutex remains in place and is acquired before the asynchronous lease call, closing a same-process race.

Files changed:

- `src/store.js`
- `src/config.js`
- `src/server.js`
- `.env.example`
- `test/run-tests.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

## Phase 23 - Production Probe And Health Controls

Goal: preserve live route truth without recreating provider-credit loops, and make deployment health reflect current incidents rather than permanent history.

Tasks:

- Separate request-time route proof from scheduled route probing.
- Keep strict request-time probing available through `ROUTE_PROBE_ENABLED`.
- Make background route polling opt-in through `ROUTE_PROBE_WORKER_ENABLED`.
- Report both probe modes in backend health.
- Add worker queue health that distinguishes recent failures, overdue work, and historical failures.
- Use actionable queue health in the production status endpoint.

Acceptance:

- Production can require a fresh quote before a trade without polling every route forever.
- Background probing remains disabled unless explicitly enabled.
- Old failed jobs remain auditable but no longer make the service permanently unhealthy.
- Recent failed or overdue jobs still fail the worker-health check.

Status: Complete locally

Notes:

- Recommended production settings are `ROUTE_PROBE_ENABLED=1` and `ROUTE_PROBE_WORKER_ENABLED=0`.
- This means a requested swap or bridge proves its route live at execution time, while idle periods consume no route-probe API calls.
- Historical failed jobs remain visible as `jobsHistoricalFailed`.

Files changed:

- `src/config.js`
- `src/jobs.js`
- `src/server.js`
- `.env.example`
- `test/run-tests.js`
- `TRADING_AGENT_COMPLETION_PLAN.md`

Verification:

- `npm test` - 65/65 core regression tests passed and all agent evals passed.
- Syntax checks passed for config, jobs, server, store, and core tests.

## Phase 24 - Oracle Sync Failure Containment

Goal: stop a low-gas ArcPerps admin wallet from retrying failed on-chain oracle writes on every background tick.

Tasks:

- Honor the ArcPerps oracle-sync enable flag before calling the sync adapter.
- Add a separate minimum interval between oracle sync attempts.
- Mark the attempt time before execution so failures also receive backoff.
- Keep user-owned perp execution independent from the admin oracle scheduler.

Acceptance:

- Disabling oracle sync causes zero background oracle transactions.
- Re-enabling sync cannot attempt more often than the configured interval.
- A failed oracle write does not retry every automation tick.

Status: Complete locally

Production decision:

- Keep `ARC_PERPS_ORACLE_SYNC_ENABLED=0` until the oracle admin address has enough Arc native gas.
- The Circle faucet rejected funding for that external Arc testnet address with the current API key.
- User-owned perp execution remains enabled; only automatic admin price writes are paused.
