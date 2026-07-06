# bunOS Trading Agent Build Phases

The goal is to make bunOS feel like an Arc-native trading agent, not a command bot. The agent should understand wallet state, market context, risk, execution status, and user intent before touching tools.

## Phase 1 - Agent State And Decision Layer

Build the brain between the user and tools.

- Add per-user agent memory: last action, last trade, recent decisions, recent failures, preferred risk profile.
- Build a trade-state snapshot before every agent run: balances, wallet readiness, recent DeFi actions, approvals, perp proposals, and known failures.
- Return a structured `decision` object with every terminal/MCP agent response.
- Add decision fields: `stance`, `objective`, `riskLevel`, `confidence`, `checks`, `warnings`, `rationale`, `nextAction`.
- Make failures explain what actually happened, not generic fallback text.

Acceptance:

- A bridge that fails from insufficient USDC says exactly that.
- A bad route says why the agent refuses or suggests a safer alternative.
- A successful swap/bridge returns route, tx hash when available, receipt, and updated agent memory.

## Phase 2 - Pre-Trade Simulation And Risk Policy

Make the agent judge trade quality before execution.

- Add fee/slippage/output simulation summaries for swaps and bridges.
- Add balance-aware bridge checks, including amount plus estimated provider/gas fees.
- Add per-user policy settings: max trade, max leverage, max slippage, confirmation threshold, allowed assets.
- Add "bad trade" warnings for tiny bridges, high fee-to-amount ratio, unsupported liquidity, stale route, and low post-trade balance.
- Make terminal output say when an action is technically possible but economically dumb.

Acceptance:

- `bridge $1 USDC from arc to base` warns about bridge fees before executing when possible.
- `swap $1 USDC to cirBTC` says route/liquidity unavailable and suggests supported pairs.
- Perp actions show liquidation/risk summary before submission.

Status:

- Implemented locally.
- DeFi route creation now attaches a `simulation` object with source balance, required input, estimated fees, fee ratio, expected output, warnings, blockers, and recommendation.
- User DeFi policy now checks max trade size, max slippage, allowed rails, allowed assets, and simulation blockers before execution is queued.
- Terminal and receipt views render route-quality details instead of hiding them behind generic quote/queued states.

## Phase 3 - Strategy Primitives

Move from one-off commands to portfolio work.

- Add strategy tools: rebalance, DCA, rotate assets, reduce risk, close losing position, retry route later.
- Add declarative strategy memory: target allocations, allowed rails, preferred assets, forbidden assets.
- Add recurring strategy automations through the same policy and receipt system.
- Track strategy performance and realized action history.

Acceptance:

- `keep 70% USDC, 20% EURC, 10% cirBTC` creates a policy-gated strategy plan.
- `rebalance my Arc wallet` produces a plan before execution.
- Automations can run strategy checks without fake success.

Status:

- Implemented locally.
- Added strategy policies, rebalance plans, risk-reduction plans, and automation-safe strategy checks.
- Strategy checks never execute trades directly; they produce planned `quote_defi_route` steps for review and explicit execution.
- Terminal/MCP agent responses now render strategy plans and drift warnings.

## Phase 4 - X Agent Loop

Make social execution real and auditable.

- Connect bot account replies when X write scopes and token are configured.
- Process mentions/replies into the same agent decision layer.
- Reply with public receipts, failure reasons, and approval links.
- Add idempotency/replay protection to every X action.

Acceptance:

- `@bunos swap $5 USDC to EURC` creates the same receipt and decision as terminal.
- Replayed X events do not duplicate trades.
- Bot replies are disabled unless credentials and scopes are ready.

Status:

- Implemented locally.
- X commands now execute through the shared `runAgentAction` path, so terminal/MCP/X share agent decisions, memory, route simulation, and signer policy.
- X command receipts now retain `decision`, `agentState`, related action refs, approval links, public receipt URLs, and reply text.
- Idempotent X replays return the original command receipt and do not repost replies or run execution twice.

## Phase 5 - Market Intelligence

Give the agent live reasons.

- Add market feeds for Arc-supported assets and perps.
- Track route availability, execution failure rates, fee trends, and liquidity warnings.
- Add simple regime detection: risk-on, risk-off, high fee, low liquidity, high volatility.
- Feed those signals into decisions and automations.

Acceptance:

- Agent can say why it prefers holding, swapping, bridging, or doing nothing.
- Agent can explain why a route failed historically.
- Strategy automations can pause under bad market conditions.

Status:

- Implemented locally.
- Added route-health intelligence from recent swap/bridge attempts, including failure rates, quote availability, fee trends, and last failure reasons.
- DeFi route simulations now include market-intelligence warnings and recommendations before execution is queued.
- Strategy checks now run a market guard and can pause planning-only automations when route history shows low liquidity, high fees, or degraded execution quality.
- Terminal/MCP/agent surfaces expose `get_market_intelligence` for explaining route history and current regime.

## Phase 6 - Security Hardening

Make the agent safe enough to trust.

- Add explicit wallet ownership boundaries to every tool.
- Add scoped MCP/API key permissions per operation.
- Add spend and leverage limits at the policy layer.
- Add action replay locks, nonce/idempotency hardening, and audit logs.
- Redact secrets and sensitive wallet provider details from public responses.

Acceptance:

- No backend signer spends user funds.
- MCP keys cannot escape their handle/wallet scope.
- Every money-moving path has a receipt and policy trace.

Status:

- Implemented locally.
- MCP API keys now support scoped authorization (`mcp:read`, `mcp:payments`, `mcp:trade`, `mcp:approvals`, `mcp:automations`, `mcp:wallets`, or broad `mcp:tools`/`mcp:*`).
- MCP key calls are forced into the authenticated handle context, and denied scope attempts are written to the audit ledger.
- MCP tool listings are filtered by key scope when an authenticated key is used.
- HTTP and MCP JSON responses now pass through sensitive-value redaction for API keys, tokens, entity secrets, kit keys, and private-key-shaped values.
- Key create/auth/revoke/tool-use events now create security audit events.
