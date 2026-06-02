# bunOS

bunOS is an agent-native trading and wallet backend for Arc. It gives AI agents a guarded execution layer for user-owned Circle wallets, Arc-settled perps, swaps, bridges, payments, automations, and X-based financial commands.

The goal is not to make another wallet UI. The goal is to expose the primitives an AI agent needs to safely understand a user's intent, inspect wallet state, choose the right tool, execute on-chain when allowed, and report back with receipts instead of vague bot replies.

## What bunOS Does

- Connects an X identity to a Circle wallet.
- Lets agents send, receive, swap, bridge, and trade through user-owned wallet flows.
- Exposes wallet and trading capabilities through HTTP APIs, MCP tools, and X command flows.
- Uses Arc Testnet as the primary settlement rail, with Canteen RPC support.
- Provides Arc perps contracts and an execution engine for testnet positions.
- Tracks agent memory for recent trades, open positions, failed routes, pending approvals, automations, and wallet state.
- Produces clear execution receipts, tx hashes, explorer links, and safe failure explanations.
- Blocks backend-signer misuse for normal user-money actions.

## Why It Matters

Most agent trading prototypes are either chat wrappers or mock demos. bunOS focuses on the infrastructure gap between a model and real financial execution:

- **User-owned execution:** the backend does not silently spend from one shared signer wallet.
- **Agent-ready tools:** MCP and HTTP surfaces expose reusable wallet, trading, and memory primitives.
- **Policy before execution:** risk, balance, route, signer, and approval checks sit before money moves.
- **Receipts by default:** actions create durable records that agents, users, and external clients can inspect.
- **Arc-native settlement:** Arc RPC, Arc contracts, USDC gas, and Arc explorer links are first-class.
- **X-native workflows:** posts and replies can become payment, trading, automation, or receipt flows.

## Core Primitives

### Identity

bunOS links a social handle to wallet and session state. X OAuth can be used for real identity, while auth, wallet provisioning, and execution stay separated.

### Wallets

Circle wallets are provisioned per user. The backend tracks balances, rails, funding instructions, sends, and receipts across supported networks.

### Agent Tools

The agent layer maps natural language into guarded tools:

- inspect wallet state
- send USDC
- quote and execute swaps
- quote and execute bridges
- propose and approve perps
- close and monitor positions
- create and inspect automations
- retrieve memory about previous actions

### MCP Server

bunOS exposes the same wallet and trading primitives through MCP so other AI agents can connect to the user's wallet context and request actions without needing bespoke integrations.

### Arc Perps

The repo includes lightweight Arc testnet perps contracts:

- `ArcPerpsOracle.sol`
- `ArcPerpsVault.sol`

The backend can quote, open, close, inspect, and monitor positions when configured with live Arc and Circle credentials.

### Memory

The agent can inspect recent trades, open perps, failed routes, pending approvals, automations, and wallet state. That memory layer is what turns the system from a stateless command parser into an agent that can answer "what happened to my last trade?" or "close that position."

### Safety

bunOS is built around the principle that an agent should never silently spend user funds.

- User-money actions require a user wallet.
- Backend signer use is blocked for normal agent and MCP flows.
- Secrets are redacted before public payloads leave the backend.
- Risky actions can require explicit approval.
- Idempotency and replay checks prevent duplicated actions.
- Failed routes fail closed instead of pretending settlement happened.
- Receipts preserve execution status and transaction references.

## Architecture

```txt
User / X / MCP Client
        |
        v
Agent Planner
        |
        v
Policy + Memory + Intent Layer
        |
        v
Tool Executor
   |       |        |        |
   v       v        v        v
Wallets  Swaps   Bridges   Perps
   |       |        |        |
   v       v        v        v
Circle  AppKit   LI.FI     Arc Contracts
        |
        v
Arc Testnet / Supported Rails
```

## Integrations

- Arc Testnet
- Canteen Arc RPC
- Circle Developer-Controlled Wallets
- Circle AppKit
- MCP JSON-RPC and SSE transport
- X OAuth and X command receipts
- LI.FI route discovery where available
- Hyperliquid and Polymarket adapters for market intelligence surfaces

## What Builders Can Use

bunOS exposes primitives that other Arc builders can build on:

- wallet binding by handle
- MCP-authenticated wallet access
- agent memory for trading state
- user-wallet-only execution checks
- payment and DeFi receipts
- approval records with signed tokens
- Arc perps quoting and settlement helpers
- route-quality checks for swaps and bridges
- X command receipts and bot-loop infrastructure
- security guards for public payload redaction

## Repository Scope

This public repository is focused on the backend, contracts, MCP surface, and agent execution primitives. Frontend application files, generated static builds, design assets, and internal planning docs are intentionally excluded from this product-facing repo.

## Status

bunOS is an active Arc agent-infrastructure project. The backend supports real testnet execution when configured with the required Arc, Circle, AppKit, and X credentials. Third-party swap and bridge availability still depends on provider liquidity, route support, and chain coverage.

## Name

This project is **bunOS**. Older internal references to ArcPay may still exist in compatibility code or historical data paths, but the product and public surface should be referred to as bunOS.
