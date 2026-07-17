# Deployment

## Local

Install dependencies and start the backend:

```bash
npm install
npm start
```

Build the frontend:

```bash
npm run frontend:build
```

Compile launchpad contracts:

```bash
npm run compile:contracts
```

## Environment

Use `.env.example` as the source of deploy-time configuration.

Required for a production-like deployment:

- `APP_BASE_URL`
- `TOKEN_ENCRYPTION_KEY`
- `ARC_TESTNET_RPC_URL`
- `X_AUTH_MODE`
- `X_CLIENT_ID`
- `X_CLIENT_SECRET`
- `X_REDIRECT_URI`
- `X_WEBHOOK_SECRET`
- `CIRCLE_WALLETS_ENABLED`
- `CIRCLE_API_KEY`
- `CIRCLE_ENTITY_SECRET`
- `CIRCLE_WALLET_SET_ID`
- `CIRCLE_WEBHOOK_PUBLIC_KEY_BASE64` or `CIRCLE_WEBHOOK_SECRET`

Optional integrations:

- `LIFI_API_KEY`
- `APPKIT_KIT_KEY`
- `GEMINI_API_KEY`
- `XAI_API_KEY`

## Vercel

The repository includes `vercel.json` and `api/index.js` so the Node server can be served through Vercel functions for API and MCP routes.

Before deploying:

1. Configure environment variables in Vercel.
2. Run `npm run frontend:build`.
3. Confirm `public/` contains the current frontend build.
4. Run `npm test` locally.

## Railway

The repository includes `railway.json`, `.railwayignore`, and `nixpacks.toml`.

For Railway deployments, configure the same environment variables and make sure any production persistence requirement is backed by a durable database instead of local temporary storage.

## Operational Notes

- Keep backend admin keys separate from user-wallet execution.
- Use scoped API keys for MCP clients and agent access.
- Keep action receipts public enough for verification but redacted enough to avoid secret leakage.
- Use durable queues and storage before running multiple production workers.
