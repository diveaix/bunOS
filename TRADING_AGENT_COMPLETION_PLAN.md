# Trading Agent Completion Plan

The project direction is now token launchpad + terminal, with wallet features as supporting infrastructure.

## Current Scope

- Wallet creation, balance reads, funding instructions, USDC sends, swaps, bridges, distributions, automations, approvals, receipts, and agent memory.
- Launchpad architecture and UI for token creation, liquidity seeding, lock windows, launch receipts, and agent-facing discovery.
- MCP and SDK access for autonomous agents with API-key authorization.

## Backend Goals

- Keep all user-facing money movement behind user-wallet or explicit approval paths.
- Keep execution monitoring focused on payments and DeFi actions.
- Keep portfolio and market intelligence scoped to assets, route quality, liquidity, pending actions, strategy drift, and launchpad readiness.
- Ensure no backend signer path can spend user funds.

## Frontend Goals

- Make the launchpad the primary product surface.
- Keep the terminal focused on natural-language payments, swaps, bridges, automations, portfolio analysis, and launchpad workflows.
- Keep the agent page dedicated to autonomous access: API keys, auth, MCP, SDK, tool categories, and launchpad/swap/bridge instructions.

## Verification

- Source search should show no removed trading surface references outside unrelated words such as `maxPerPayment`.
- Tests should cover wallet, DeFi, launchpad, automations, MCP discovery, and SDK behavior.
- Frontend build should regenerate public assets after source cleanup.
