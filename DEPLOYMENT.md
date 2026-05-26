# Deployment

This project deploys as two services:

- Railway: Node backend, API, MCP JSON-RPC/SSE, X OAuth callbacks, Circle/AppKit execution.
- Vercel: static frontend from `public/`, with rewrites to the Railway backend.

## Backend: Railway

Railway needs Node 22 because the backend uses `node:sqlite`.

1. Log in:

```powershell
npx @railway/cli login
```

2. Create/link a Railway project, then set the runtime variables from `.env`.

Minimum production-style variables:

```env
PROVIDER_MODE=real
TRANSFER_PROVIDER=circle
CIRCLE_WALLETS_ENABLED=1
DEFI_LIVE_ADAPTERS=1
DEFI_EXECUTION_ENABLED=1
APPKIT_EXECUTION_ENABLED=1
APPKIT_UNIFIED_BALANCE_ENABLED=1
DEFAULT_SETTLEMENT_RAIL=arc-testnet
SUPPORTED_SETTLEMENT_RAILS=arc-testnet,base-sepolia
SQLITE_FILE=/data/arcpay.sqlite
```

Also set the secret values for Circle, Gemini, X OAuth, ArcPerps, LI.FI, and webhooks from your local `.env`.

For durable hackathon state, attach a Railway volume at `/data`. Without it, SQLite state can disappear on redeploy.

3. Deploy:

```powershell
npx @railway/cli up
```

4. Generate a public Railway domain, then verify:

```powershell
Invoke-WebRequest https://YOUR-BACKEND.up.railway.app/api/health
```

## Frontend: Vercel

1. Log in:

```powershell
vercel login
```

2. Build the frontend deploy folder with the Railway backend URL:

```powershell
npm run deploy:frontend:prepare -- https://YOUR-BACKEND.up.railway.app
```

3. Deploy the generated static frontend:

```powershell
vercel deploy .vercel-frontend --prod
```

The generated Vercel config rewrites `/api/*`, `/auth/*`, `/mcp`, `/sse`, `/messages`, `/x/*`, and `/defi/*` to Railway.

## X OAuth URLs

For the split deploy, use the Vercel frontend URL as the X redirect URL:

```env
APP_BASE_URL=https://YOUR-FRONTEND.vercel.app
X_AUTH_MODE=real
X_REDIRECT_URI=https://YOUR-FRONTEND.vercel.app/auth/x/callback
```

Because Vercel rewrites `/auth/*` to Railway, the browser remains on the frontend domain while the backend handles OAuth.
