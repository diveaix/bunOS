# Bunos Demo Video Script

Target length: 2 to 3 minutes

## 0:00 - Hook

Narration:

"Crypto apps still make users think in wallets, chains, bridges, approvals, and protocol tabs. Bunos flips that around. It gives every X user an AI-powered wallet and trading agent, so they can move money and access DeFi through simple language."

Screen:

- Open the Bunos dashboard.
- Show the wallet empty state before login.
- Click Connect / create wallet.

## 0:20 - Real Login And Wallet Creation

Narration:

"This is not a mock login flow. We use real X OAuth. When the user connects their X account, Bunos provisions a Circle wallet for that identity across supported settlement rails."

Screen:

- Start X OAuth.
- Return to the dashboard.
- Show wallet created.
- Show Arc Testnet and Base Sepolia rails.
- Show receive address.

Note:

If X OAuth is still being fixed during recording, say:

"For the hackathon recording, X OAuth is wired and live, and this step shows the production callback flow. Once X accepts the app credentials, the same callback provisions the Circle wallet automatically."

## 0:45 - Real Balances

Narration:

"The dashboard only shows real wallet state. Seeded demo balances are blocked in production mode, so if there is no wallet or no funds, Bunos says that honestly."

Screen:

- Click Refresh.
- Show balances by rail.
- Show USDC, EURC, or other Circle balances if present.

## 1:05 - Send Money By Handle

Narration:

"Instead of pasting addresses, users send to X handles. Bunos resolves the identity, checks policy, and routes payment through the user wallet."

Screen:

- Open Send.
- Send a small USDC amount to an X handle.
- Show activity/receipt/status.

## 1:25 - AI Terminal

Narration:

"The same capabilities are exposed through an AI terminal. The user can ask for balances, send USDC, quote swaps, bridge assets, or prepare trading actions in natural language."

Screen:

- Open Terminal.
- Type: `check my wallet balances`
- Type: `swap 1 USDC to EURC on arc`
- Type: `bridge 1 USDC from arc to base`
- Show tool result and transaction/status details.

## 1:55 - MCP Server

Narration:

"Bunos also ships as an MCP server, so any compatible AI agent can use the same wallet and DeFi tools. The MCP layer exposes wallet, send, swap, bridge, balances, receipts, and trading proposal tools."

Screen:

- Open MCP Guide.
- Show hosted endpoint:
  `https://backend-production-efc9.up.railway.app/mcp`
- Show tools list.

## 2:15 - Perps And Agentic DeFi

Narration:

"The project is designed beyond payments. Bunos supports agentic DeFi workflows: swaps, bridges, copy-trading proposals, and a lightweight Arc perps settlement engine. Money-moving actions are tied to user wallets, not a backend signer wallet."

Screen:

- Show terminal command:
  `propose a 2x BTC long with tight liquidation protection`
- Show proposal/status.
- Show that backend signer is not used for user funds.

## 2:40 - Close

Narration:

"Bunos brings the financial stack to where users already coordinate: X and AI chat. X gives identity and intent, Circle gives programmable wallets and USDC rails, Arc becomes the settlement layer, and MCP makes the whole system available to agents."

Screen:

- Dashboard overview.
- Terminal.
- MCP guide.
- Final title card:
  "Bunos - AI wallet and DeFi agent for X"

## Backup One-Minute Version

"Bunos is an AI wallet and DeFi agent for X. Users connect with real X OAuth, and Bunos provisions Circle wallets for their X identity. From the dashboard, they can fund, receive, send USDC, bridge between Arc and Base, and swap supported tokens. The terminal turns the same actions into natural language commands, so a user can type things like 'check my balance', 'send 5 USDC to @alice', or 'swap 1 USDC to EURC on Arc'. Under the hood, Bunos exposes the same capabilities through an MCP server, meaning external AI agents can access wallet, payment, swap, bridge, and trading proposal tools. User funds route through per-user Circle wallets, not a shared backend signer. Arc acts as the settlement layer, Circle powers wallet and USDC infrastructure, and X becomes the social command surface."

