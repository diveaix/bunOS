# Agent Trading Phases

This document tracks the current agent execution surface after the product shift to a token launchpad, terminal, and wallet.

## Phase 1 - Wallet and Policy Context

- Build a trade-state snapshot before every agent run: balances, wallet readiness, recent DeFi actions, approvals, automations, and known failures.
- Apply user policy and standing mandates before any money-moving action.
- Keep backend signer usage disabled for user-facing actions.

## Phase 2 - Route and Market Checks

- Fetch Arc asset prices and recent route sampling.
- Show swap and bridge warnings before approval.
- Treat stale market data, low liquidity, and high fees as reasons to size down or pause execution.

## Phase 3 - User-Gated Execution

- Send, swap, bridge, distribution, and launchpad actions must create receipts and clear statuses.
- Large or risky actions create approvals before execution.
- Execution monitoring follows payments and DeFi actions until terminal states.

## Phase 4 - Launchpad Autonomy

- Agents can discover launchpad capabilities through the MCP/agent pages.
- Token launch flows expose required metadata, liquidity seed, lock settings, signer requirements, and receipts.
- Launchpad operations must be policy-gated and auditable before autonomous execution is enabled.
