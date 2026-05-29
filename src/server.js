import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpTools, callMcpTool } from "./mcp.js";
import { handleMcpJsonRpc, toMcpError } from "./mcpJsonRpc.js";
import { getArcReadiness } from "./arcRpc.js";
import { confirmAction } from "./agentActions.js";
import { listAgentTools, planAgentActionWithModel, runAgentAction } from "./agentPlanner.js";
import {
  getArcPerpsPosition,
  getArcPerpsReadiness,
  getArcPerpsStatus,
  listArcPerpsPositions,
  openArcPerpPositionWithUserWallet,
  quoteArcPerpPosition,
  readArcPerpsOraclePrice,
  closeArcPerpPositionWithUserWallet,
  syncArcPerpsOracleFromHyperliquid
} from "./arcPerpsEngine.js";
import { listApprovals } from "./approvals.js";
import {
  awardBounty,
  claimPayment,
  confirmPayment,
  createPaymentIntent,
  createSocialBounty,
  getState
} from "./orchestrator.js";
import { getCircleReadiness } from "./circleProvider.js";
import { config } from "./config.js";
import { getAgentModelReadiness } from "./modelPlanner.js";
import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  runAutomation,
  runDueAutomations,
  updateAutomation
} from "./automations.js";
import {
  awardAirdrop,
  createAirdrop,
  getAirdropReceipt,
  listAirdrops
} from "./airdrops.js";
import { listArcTradingPrimitives } from "./arcTradingPrimitives.js";
import { ledger } from "./fixtures.js";
import { nextEventId } from "./ids.js";
import {
  getOperations,
  getPaymentReceipt,
  listClaims,
  listPayments,
  resolveIdentity
} from "./queries.js";
import { getBuildPreflight } from "./preflight.js";
import {
  listProviderWork,
  retryFailedTransfers,
  retryPaymentTransfer
} from "./reconciliation.js";
import { enqueueJob, listJobs, runDueJobs, runJob } from "./jobs.js";
import { listSettlementRails } from "./settlement.js";
import { loadStore, persistStore } from "./store.js";
import {
  reconcileCircleNotification,
  verifyCircleWebhook
} from "./transferProvider.js";
import {
  bridgeFunds,
  createWallet,
  fundWallet,
  getWalletCapabilities,
  getWalletProfile,
  listWalletProfiles,
  syncWalletBalances
} from "./walletAccounts.js";
import {
  completeMockXOAuth,
  completeXOAuth,
  destroySession,
  getSession,
  startXOAuth
} from "./xOAuth.js";
import {
  getXReplyReadiness,
  postXCommandReply
} from "./xReplyPoster.js";
import {
  runXBotCommand,
  runXBotWebhookDelivery
} from "./xBotLoop.js";
import {
  getXWebhookStatus,
  getXCommandReceipt,
  listXCommands,
} from "./xPayments.js";
import {
  listCopyTradeProposals,
  proposeCopyTrade,
  rankSocialTraders
} from "./socialTradingAgent.js";
import {
  applyMcpApiKeyContext,
  authenticateMcpApiKey,
  createMcpApiKey,
  listMcpApiKeys,
  revokeMcpApiKey
} from "./mcpApiKeys.js";
import {
  assessLiquidationRisk,
  listPerpIntelligence,
  listPerpProposals,
  proposePerpTrade
} from "./perpsAgent.js";
import {
  confirmDefiAction,
  getDefiActionReceipt,
  listDefiActions,
  listDefiTools,
  listPerpMarkets,
  quoteDefiRoute,
  searchPredictionMarkets
} from "./defiOrchestrator.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT || 4317);
const sseClients = new Map();

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/state") {
      return json(res, getState());
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, {
        ok: true,
        at: new Date().toISOString(),
        providerMode: config.providerMode,
        transferProvider: config.transferProvider,
        rails: listSettlementRails().map((rail) => rail.id),
        circle: getCircleReadiness(),
        x: {
          authMode: config.x.authMode,
          hasClientId: Boolean(config.x.clientId),
          hasClientSecret: Boolean(config.x.clientSecret),
          reply: getXReplyReadiness()
        },
        arc: await getArcReadiness(),
        jobs: {
          queued: ledger.jobs.filter((job) => job.status === "queued").length,
          failed: ledger.jobs.filter((job) => job.status === "failed").length
        },
        automations: {
          total: ledger.automations.length,
          active: ledger.automations.filter((automation) => automation.status === "active").length,
          workerEnabled: config.automations.workerEnabled,
          workerIntervalMs: config.automations.tickMs
        },
        defi: {
          actions: ledger.defiActions.length,
          liveAdapters: config.defi.liveAdapters
        },
        ai: getAgentModelReadiness()
      });
    }

    if (req.method === "GET" && url.pathname === "/api/preflight") {
      return json(res, await getBuildPreflight());
    }

    if (req.method === "GET" && url.pathname === "/api/hackathon/status") {
      return json(res, await getHackathonStatus());
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, {
        providerMode: config.providerMode,
        transferProvider: config.transferProvider,
        settlementRails: listSettlementRails(),
        circle: getCircleReadiness(),
        x: {
          authMode: config.x.authMode,
          hasClientId: Boolean(config.x.clientId),
          hasClientSecret: Boolean(config.x.clientSecret),
          redirectUri: config.x.redirectUri,
          scopes: config.x.scopes,
          reply: getXReplyReadiness({ handle: url.searchParams.get("handle") || undefined })
        },
        arc: await getArcReadiness(),
        defi: {
          liveAdapters: config.defi.liveAdapters,
          executionEnabled: config.defi.executionEnabled,
          maxActionUsd: config.defi.maxActionUsd,
          maxSlippage: config.defi.maxSlippage,
          allowedProtocols: config.defi.allowedProtocols
        },
        ai: getAgentModelReadiness()
      });
    }

    if (req.method === "GET" && url.pathname === "/api/settlement/health") {
      return json(res, {
        ok: true,
        rails: listSettlementRails(),
        arc: await getArcReadiness()
      });
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
      const session = getSession(readCookie(req, "arcpay_session"));
      return json(res, { ok: true, session });
    }

    if (req.method === "GET" && url.pathname === "/api/api-keys") {
      const session = requireSession(req);
      return json(res, { ok: true, apiKeys: listMcpApiKeys(session.handle) });
    }

    if (req.method === "POST" && url.pathname === "/api/api-keys") {
      const session = requireSession(req);
      const body = await readJson(req);
      return jsonPersisted(res, createMcpApiKey({
        handle: session.handle,
        name: body.name || "MCP key",
        scopes: body.scopes || ["mcp:tools"]
      }));
    }

    const apiKeyMatch = url.pathname.match(/^\/api\/api-keys\/([^/]+)$/);
    if (req.method === "DELETE" && apiKeyMatch) {
      const session = requireSession(req);
      return jsonPersisted(res, revokeMcpApiKey({
        handle: session.handle,
        keyId: apiKeyMatch[1]
      }));
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const result = destroySession(readCookie(req, "arcpay_session"));
      return json(res, result, 200, clearSessionCookieHeader());
    }

    if (req.method === "GET" && url.pathname === "/api/wallets") {
      return json(res, { wallets: listWalletProfiles() });
    }

    if (req.method === "GET" && url.pathname === "/api/wallet") {
      return json(res, { wallet: getWalletProfile(url.searchParams.get("handle") || "@sara") });
    }

    if (req.method === "GET" && url.pathname === "/api/wallet/capabilities") {
      return json(res, getWalletCapabilities(url.searchParams.get("handle") || "@sara"));
    }

    if (req.method === "GET" && url.pathname === "/api/identity/resolve") {
      return json(res, resolveIdentity({ handle: url.searchParams.get("handle") }));
    }

    if (req.method === "GET" && url.pathname === "/api/payments") {
      return json(res, listPayments({
        handle: url.searchParams.get("handle"),
        status: url.searchParams.get("status"),
        limit: url.searchParams.get("limit") || 50
      }));
    }

    const receiptMatch = url.pathname.match(/^\/api\/payments\/([^/]+)$/);
    if (req.method === "GET" && receiptMatch) {
      return json(res, getPaymentReceipt({ paymentId: receiptMatch[1] }));
    }

    if (req.method === "GET" && url.pathname === "/api/claims") {
      return json(res, listClaims({
        handle: url.searchParams.get("handle"),
        status: url.searchParams.get("status"),
        limit: url.searchParams.get("limit") || 50
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/operations") {
      return json(res, getOperations({ limit: url.searchParams.get("limit") || 50 }));
    }

    if (req.method === "GET" && url.pathname === "/api/provider/work") {
      return json(res, listProviderWork({
        status: url.searchParams.get("status"),
        limit: url.searchParams.get("limit") || 50
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/jobs") {
      return json(res, listJobs({
        status: url.searchParams.get("status"),
        type: url.searchParams.get("type"),
        limit: url.searchParams.get("limit") || 50
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/automations") {
      return json(res, listAutomations({
        handle: url.searchParams.get("handle"),
        status: url.searchParams.get("status"),
        kind: url.searchParams.get("kind"),
        limit: url.searchParams.get("limit") || 50
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/approvals") {
      return json(res, listApprovals({
        handle: url.searchParams.get("handle"),
        status: url.searchParams.get("status"),
        kind: url.searchParams.get("kind"),
        limit: url.searchParams.get("limit") || 50
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/airdrops") {
      return json(res, listAirdrops({
        handle: url.searchParams.get("handle"),
        status: url.searchParams.get("status"),
        limit: url.searchParams.get("limit") || 50
      }));
    }

    const airdropApiMatch = url.pathname.match(/^\/api\/airdrops\/([^/]+)$/);
    if (req.method === "GET" && airdropApiMatch) {
      return json(res, getAirdropReceipt({
        airdropId: airdropApiMatch[1],
        host: req.headers.host,
        protocol: req.headers["x-forwarded-proto"] || "http"
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/x/commands") {
      return json(res, listXCommands({
        handle: url.searchParams.get("handle"),
        status: url.searchParams.get("status"),
        limit: url.searchParams.get("limit") || 50
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/x/webhook/status") {
      return json(res, getXWebhookStatus({
        host: req.headers.host,
        protocol: req.headers["x-forwarded-proto"] || "http"
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/x/reply/status") {
      return json(res, getXReplyReadiness({
        handle: url.searchParams.get("handle") || undefined
      }));
    }

    const xCommandMatch = url.pathname.match(/^\/api\/x\/commands\/([^/]+)$/);
    if (req.method === "GET" && xCommandMatch) {
      return json(res, getXCommandReceipt({
        commandId: xCommandMatch[1],
        host: req.headers.host,
        protocol: req.headers["x-forwarded-proto"] || "http"
      }));
    }

    const xCommandReplyMatch = url.pathname.match(/^\/api\/x\/commands\/([^/]+)\/reply$/);
    if (req.method === "POST" && xCommandReplyMatch) {
      const body = await readJson(req);
      return jsonPersisted(res, await postXCommandReply({
        commandId: xCommandReplyMatch[1],
        publicUrl: body.publicUrl || `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}/x/commands/${encodeURIComponent(xCommandReplyMatch[1])}`,
        force: Boolean(body.force)
      }));
    }

    const xCommandApproveApiMatch = url.pathname.match(/^\/api\/x\/commands\/([^/]+)\/approve$/);
    if (req.method === "POST" && xCommandApproveApiMatch) {
      const body = await readJson(req);
      const receipt = getXCommandReceipt({
        commandId: xCommandApproveApiMatch[1],
        host: req.headers.host,
        protocol: req.headers["x-forwarded-proto"] || "http"
      }).receipt;
      const approval = receipt.related.approval;
      if (!approval) {
        return json(res, { ok: false, error: "This X command does not require approval." }, 409);
      }
      const confirmed = await confirmAction({
        approvalId: approval.id,
        handle: body.handle || approval.handle
      });
      const txHash = confirmed.result?.execution?.txHash
        || confirmed.result?.payment?.transfer?.txHash
        || confirmed.result?.action?.execution?.txHash
        || null;
      receipt.command.approvalResult = {
        status: confirmed.approval.status,
        approvalId: approval.id,
        approvedAt: confirmed.approval.completedAt || new Date().toISOString(),
        txHash,
        resultStatus: confirmed.result?.execution?.status
          || confirmed.result?.payment?.status
          || confirmed.result?.action?.status
          || "approved"
      };
      if (txHash && !receipt.command.resultRefs?.txHash) {
        receipt.command.resultRefs = {
          ...(receipt.command.resultRefs || {}),
          txHash
        };
      }
      const updatedReceipt = getXCommandReceipt({
        commandId: xCommandApproveApiMatch[1],
        host: req.headers.host,
        protocol: req.headers["x-forwarded-proto"] || "http"
      }).receipt;
      return jsonPersisted(res, {
        ok: true,
        command: updatedReceipt.command,
        approval: confirmed.approval,
        result: confirmed.result,
        receipt: updatedReceipt
      });
    }

    if (req.method === "GET" && url.pathname === "/api/social/traders") {
      return jsonPersisted(res, rankSocialTraders({
        handle: url.searchParams.get("handle") || "@sara",
        riskProfile: url.searchParams.get("riskProfile") || "balanced",
        limit: url.searchParams.get("limit") || 5
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/social/proposals") {
      return json(res, listCopyTradeProposals({
        handle: url.searchParams.get("handle"),
        status: url.searchParams.get("status"),
        limit: url.searchParams.get("limit") || 50
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/perps/intelligence") {
      return jsonPersisted(res, await listPerpIntelligence({
        handle: url.searchParams.get("handle") || "@sara",
        limit: url.searchParams.get("limit") || 5
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/perps/proposals") {
      return json(res, listPerpProposals({
        handle: url.searchParams.get("handle"),
        status: url.searchParams.get("status"),
        limit: url.searchParams.get("limit") || 50
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/arc-perps/readiness") {
      return json(res, getArcPerpsReadiness());
    }

    if (req.method === "GET" && url.pathname === "/api/arc-perps/status") {
      return json(res, await getArcPerpsStatus({
        ownerAddress: url.searchParams.get("ownerAddress") || undefined
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/arc-perps/oracle") {
      return json(res, await readArcPerpsOraclePrice({
        symbol: url.searchParams.get("symbol") || "BTC"
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/arc-perps/positions") {
      return json(res, await listArcPerpsPositions({
        ownerAddress: url.searchParams.get("ownerAddress") || undefined,
        limit: Number(url.searchParams.get("limit") || 25)
      }));
    }

    const arcPerpsPositionMatch = url.pathname.match(/^\/api\/arc-perps\/positions\/([^/]+)$/);
    if (req.method === "GET" && arcPerpsPositionMatch) {
      return json(res, await getArcPerpsPosition({ positionId: arcPerpsPositionMatch[1] }));
    }

    if (req.method === "GET" && url.pathname === "/api/defi/tools") {
      return json(res, listDefiTools());
    }

    if (req.method === "GET" && url.pathname === "/api/arc/trading-primitives") {
      return json(res, listArcTradingPrimitives());
    }

    if (req.method === "GET" && url.pathname === "/api/defi/actions") {
      return json(res, listDefiActions({
        handle: url.searchParams.get("handle"),
        status: url.searchParams.get("status"),
        limit: url.searchParams.get("limit") || 50
      }));
    }

    const defiActionApiMatch = url.pathname.match(/^\/api\/defi\/actions\/([^/]+)$/);
    if (req.method === "GET" && defiActionApiMatch) {
      return json(res, getDefiActionReceipt({
        actionId: defiActionApiMatch[1],
        host: req.headers.host,
        protocol: req.headers["x-forwarded-proto"] || "http"
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/defi/polymarket/markets") {
      return jsonPersisted(res, await searchPredictionMarkets({
        handle: url.searchParams.get("handle") || "@sara",
        query: url.searchParams.get("query") || url.searchParams.get("q") || "",
        limit: url.searchParams.get("limit") || 10
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/defi/hyperliquid/markets") {
      return jsonPersisted(res, await listPerpMarkets({
        handle: url.searchParams.get("handle") || "@sara",
        limit: url.searchParams.get("limit") || 20
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/mcp/tools") {
      return json(res, { tools: mcpTools });
    }

    if (req.method === "OPTIONS" && isMcpHttpPath(url.pathname)) {
      res.writeHead(204, corsHeaders());
      return res.end();
    }

    if (req.method === "GET" && url.pathname === "/api/agent/tools") {
      return json(res, listAgentTools());
    }

    if (req.method === "POST" && url.pathname === "/api/agent/plan") {
      const body = await readJson(req);
      return json(res, await planAgentActionWithModel(body));
    }

    if (req.method === "POST" && url.pathname === "/api/agent/run") {
      const body = await readJson(req);
      return jsonPersisted(res, await runAgentAction({
        ...body,
        idempotencyKey: body.idempotencyKey || req.headers["idempotency-key"]
      }));
    }

    if (req.method === "GET" && url.pathname === "/mcp") {
      return json(res, {
        name: "ArcPay MCP",
        transport: "json-rpc-over-http",
        endpoints: {
          http: "/mcp",
          sse: "/sse",
          prefixedSse: "/mcp/sse"
        },
        tools: mcpTools.map((tool) => tool.name)
      });
    }

    if (req.method === "POST" && url.pathname === "/mcp") {
      const body = await readJson(req);
      return jsonPersisted(res, await handleMcpHttpPayload(body, getMcpAuthContext(req)), 200, corsHeaders());
    }

    if (req.method === "GET" && (url.pathname === "/sse" || url.pathname === "/mcp/sse")) {
      return openMcpSse(req, res, url.pathname === "/mcp/sse" ? "/mcp/messages" : "/messages", getMcpAuthContext(req));
    }

    if (req.method === "POST" && (url.pathname === "/messages" || url.pathname === "/mcp/messages")) {
      return await handleMcpSseMessage(req, res, url);
    }

    if (req.method === "POST" && url.pathname === "/api/mcp/call") {
      const body = await readJson(req);
      const context = getMcpAuthContext(req);
      return jsonPersisted(res, await callMcpTool(
        body.tool,
        applyMcpApiKeyContext(body.tool, body.arguments || {}, context)
      ));
    }

    const publicXCommandMatch = url.pathname.match(/^\/x\/commands\/([^/]+)$/);
    if (req.method === "GET" && publicXCommandMatch) {
      const receipt = getXCommandReceipt({
        commandId: publicXCommandMatch[1],
        host: req.headers.host,
        protocol: req.headers["x-forwarded-proto"] || "http"
      }).receipt;
      return html(res, renderPublicXCommandReceipt(receipt));
    }

    const publicXCommandApproveMatch = url.pathname.match(/^\/x\/commands\/([^/]+)\/approve$/);
    if (req.method === "GET" && publicXCommandApproveMatch) {
      const receipt = getXCommandReceipt({
        commandId: publicXCommandApproveMatch[1],
        host: req.headers.host,
        protocol: req.headers["x-forwarded-proto"] || "http"
      }).receipt;
      return html(res, renderPublicXCommandApproval(receipt));
    }

    const publicDefiActionMatch = url.pathname.match(/^\/defi\/actions\/([^/]+)$/);
    if (req.method === "GET" && publicDefiActionMatch) {
      const receipt = getDefiActionReceipt({
        actionId: publicDefiActionMatch[1],
        host: req.headers.host,
        protocol: req.headers["x-forwarded-proto"] || "http"
      }).receipt;
      return html(res, renderPublicDefiActionReceipt(receipt));
    }

    const publicAirdropMatch = url.pathname.match(/^\/airdrops\/([^/]+)$/);
    if (req.method === "GET" && publicAirdropMatch) {
      const receipt = getAirdropReceipt({
        airdropId: publicAirdropMatch[1],
        host: req.headers.host,
        protocol: req.headers["x-forwarded-proto"] || "http"
      }).receipt;
      return html(res, renderPublicAirdropReceipt(receipt));
    }

    if (req.method === "POST" && url.pathname === "/api/actions/confirm") {
      const body = await readJson(req);
      return jsonPersisted(res, await confirmAction({
        approvalId: body.approvalId,
        handle: body.handle
      }));
    }

    if (req.method === "POST" && url.pathname === "/api/airdrops") {
      const body = await readJson(req);
      return jsonPersisted(res, await createAirdrop({
        ...body,
        idempotencyKey: body.idempotencyKey || req.headers["idempotency-key"]
      }));
    }

    const airdropAwardMatch = url.pathname.match(/^\/api\/airdrops\/([^/]+)\/award$/);
    if (req.method === "POST" && airdropAwardMatch) {
      const body = await readJson(req);
      return jsonPersisted(res, await awardAirdrop({
        airdropId: airdropAwardMatch[1],
        winnerHandles: body.winnerHandles || body.recipients || []
      }));
    }

    if (req.method === "POST" && url.pathname === "/api/payments") {
      const body = await readJson(req);
      return jsonPersisted(res, await createPaymentIntent({
        ...body,
        idempotencyKey: body.idempotencyKey || req.headers["idempotency-key"]
      }));
    }

    if (req.method === "GET" && url.pathname === "/auth/x/start") {
      const started = startXOAuth({ returnTo: url.searchParams.get("returnTo") || "/" });
      res.writeHead(302, { location: started.authUrl });
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/api/auth/x/start") {
      const body = await readJson(req);
      return json(res, startXOAuth({ returnTo: body.returnTo || "/" }));
    }

    if (req.method === "POST" && url.pathname === "/api/auth/x/mock") {
      const body = await readJson(req);
      const result = await completeMockXOAuth({ handle: body.handle || "@sara" });
      return jsonPersisted(res, result, 200, sessionCookieHeader(result.session));
    }

    if (req.method === "GET" && ["/auth/x/callback", "/wallet/auth/x/callback"].includes(url.pathname)) {
      let result;
      try {
        result = await completeXOAuth({
          state: url.searchParams.get("state"),
          code: url.searchParams.get("code")
        });
      } catch (error) {
        res.writeHead(302, {
          location: `/?auth_error=${encodeURIComponent(error.message)}`
        });
        return res.end();
      }

      setSessionCookie(res, result.session, {
        location: `${result.returnTo || "/"}?handle=${encodeURIComponent(result.user.handle)}`
      });
      await persistStore();
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/api/wallets/create") {
      const body = await readJson(req);
      return jsonPersisted(res, await createWallet(body));
    }

    if (req.method === "POST" && url.pathname === "/api/wallets/fund") {
      const body = await readJson(req);
      return jsonPersisted(res, await fundWallet(body));
    }

    if (req.method === "POST" && url.pathname === "/api/wallets/sync-balances") {
      const body = await readJson(req);
      return jsonPersisted(res, await syncWalletBalances(body));
    }

    if (req.method === "POST" && url.pathname === "/api/wallets/bridge") {
      const body = await readJson(req);
      return jsonPersisted(res, await bridgeFunds(body));
    }

    if (req.method === "POST" && url.pathname === "/api/wallets/send") {
      const body = await readJson(req);
      return jsonPersisted(res, await createPaymentIntent({
        senderHandle: body.senderHandle,
        recipientHandle: body.recipientHandle,
        amount: body.amount,
        asset: "USDC",
        settlementRail: body.settlementRail,
        source: "wallet-dashboard",
        memo: body.memo || "",
        idempotencyKey: body.idempotencyKey || req.headers["idempotency-key"]
      }));
    }

    if (req.method === "POST" && url.pathname === "/api/defi/quote") {
      const body = await readJson(req);
      return jsonPersisted(res, await quoteDefiRoute(body));
    }

    if (req.method === "POST" && url.pathname === "/api/social/proposals") {
      const body = await readJson(req);
      return jsonPersisted(res, proposeCopyTrade(body));
    }

    if (req.method === "POST" && url.pathname === "/api/perps/risk") {
      const body = await readJson(req);
      return jsonPersisted(res, assessLiquidationRisk(body));
    }

    if (req.method === "POST" && url.pathname === "/api/perps/proposals") {
      const body = await readJson(req);
      return jsonPersisted(res, proposePerpTrade(body));
    }

    if (req.method === "POST" && url.pathname === "/api/arc-perps/quote") {
      const body = await readJson(req);
      return json(res, await quoteArcPerpPosition(body));
    }

    if (req.method === "POST" && url.pathname === "/api/arc-perps/open") {
      const body = await readJson(req);
      return jsonPersisted(res, await openArcPerpPositionWithUserWallet(body));
    }

    if (req.method === "POST" && url.pathname === "/api/arc-perps/oracle/price") {
      return json(res, signerBackedExecutionDisabled("set_arc_perps_oracle_price"), 409);
    }

    if (req.method === "POST" && url.pathname === "/api/arc-perps/markets") {
      return json(res, signerBackedExecutionDisabled("set_arc_perps_market"), 409);
    }

    if (req.method === "POST" && url.pathname === "/api/arc-perps/approve") {
      return json(res, signerBackedExecutionDisabled("approve_arc_perps_usdc"), 409);
    }

    if (req.method === "POST" && url.pathname === "/api/arc-perps/margin/deposit") {
      return json(res, signerBackedExecutionDisabled("deposit_arc_perps_margin"), 409);
    }

    if (req.method === "POST" && url.pathname === "/api/arc-perps/margin/withdraw") {
      return json(res, signerBackedExecutionDisabled("withdraw_arc_perps_margin"), 409);
    }

    if (req.method === "POST" && url.pathname === "/api/arc-perps/liquidity/provide") {
      return json(res, signerBackedExecutionDisabled("provide_arc_perps_liquidity"), 409);
    }

    if (req.method === "POST" && url.pathname === "/api/arc-perps/close") {
      const body = await readJson(req);
      return jsonPersisted(res, await closeArcPerpPositionWithUserWallet(body));
    }

    const confirmDefiMatch = url.pathname.match(/^\/api\/defi\/actions\/([^/]+)\/confirm$/);
    if (req.method === "POST" && confirmDefiMatch) {
      const body = await readJson(req);
      return jsonPersisted(res, await confirmDefiAction({
        actionId: confirmDefiMatch[1],
        handle: body.handle
      }));
    }

    const reconcileDefiMatch = url.pathname.match(/^\/api\/defi\/actions\/([^/]+)\/reconcile$/);
    if (req.method === "POST" && reconcileDefiMatch) {
      const job = enqueueJob({
        type: "reconcile_defi_action",
        payload: { actionId: reconcileDefiMatch[1] },
        idempotencyKey: `reconcile_defi_action:${reconcileDefiMatch[1]}:manual:${Date.now()}`
      });
      return jsonPersisted(res, await runJob({ jobId: job.id }));
    }

    const defiReceiptMatch = url.pathname.match(/^\/api\/defi\/actions\/([^/]+)\/receipt$/);
    if (req.method === "GET" && defiReceiptMatch) {
      return json(res, getDefiActionReceipt({
        actionId: defiReceiptMatch[1],
        host: req.headers.host,
        protocol: req.headers["x-forwarded-proto"] || "http"
      }));
    }

    if (req.method === "POST" && url.pathname === "/api/x/webhook") {
      const rawBody = await readBody(req);
      try {
        return jsonPersisted(res, await runXBotWebhookDelivery({
          headers: req.headers,
          rawBody,
          host: req.headers.host,
          protocol: req.headers["x-forwarded-proto"] || "http",
          postReply: url.searchParams.get("reply") !== "0"
        }));
      } catch (error) {
        await persistStore();
        throw error;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/circle/webhook") {
      const rawBody = await readBody(req);
      await verifyCircleWebhook({ headers: req.headers, rawBody });
      const body = rawBody ? JSON.parse(rawBody) : {};
      const eventId = body.id || body.notification?.id || body.data?.id || body.transaction?.id || req.headers["circle-event-id"];
      if (eventId && ledger.circleWebhooks.some((event) => event.eventId === eventId)) {
        return json(res, { ok: true, duplicate: true, eventId });
      }
      ledger.circleWebhooks.push({
        eventId: eventId || `circle_${Date.now()}`,
        receivedAt: new Date().toISOString(),
        notificationType: body.notificationType || body.type || "circle_webhook",
        raw: body
      });
      return jsonPersisted(res, reconcileCircleNotification({ ledger, notification: body }));
    }

    if (req.method === "POST" && url.pathname === "/api/x/command") {
      const body = await readJson(req);
      return jsonPersisted(res, await runXBotCommand({
        actorHandle: body.actorHandle,
        text: body.text,
        postId: body.postId || "demo-post",
        eventId: body.eventId,
        idempotencyKey: body.idempotencyKey || req.headers["idempotency-key"],
        settlementRail: body.settlementRail,
        source: "x-command",
        host: req.headers.host,
        protocol: req.headers["x-forwarded-proto"] || "http",
        postReply: body.postReply !== false
      }));
    }

    const claimMatch = url.pathname.match(/^\/api\/claims\/([^/]+)\/claim$/);
    if (req.method === "POST" && claimMatch) {
      const body = await readJson(req);
      return jsonPersisted(res, await claimPayment({
        paymentId: claimMatch[1],
        claimantHandle: body.claimantHandle,
        walletAddress: body.walletAddress
      }));
    }

    const confirmMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/confirm$/);
    if (req.method === "POST" && confirmMatch) {
      return jsonPersisted(res, await confirmPayment({ paymentId: confirmMatch[1] }));
    }

    const retryTransferMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/retry-transfer$/);
    if (req.method === "POST" && retryTransferMatch) {
      return jsonPersisted(res, await retryPaymentTransfer({ paymentId: retryTransferMatch[1] }));
    }

    if (req.method === "POST" && url.pathname === "/api/provider/retry-failed") {
      const body = await readJson(req);
      return jsonPersisted(res, await retryFailedTransfers({ limit: body.limit || 20 }));
    }

    if (req.method === "POST" && url.pathname === "/api/jobs/run-due") {
      const body = await readJson(req);
      const jobs = await runDueJobs({ limit: body.limit || 20 });
      const automations = await runDueAutomations({ limit: body.automationLimit || body.limit || 20 });
      return jsonPersisted(res, { ok: true, jobs, automations });
    }

    const runJobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/run$/);
    if (req.method === "POST" && runJobMatch) {
      return jsonPersisted(res, await runJob({ jobId: runJobMatch[1] }));
    }

    if (req.method === "POST" && url.pathname === "/api/automations") {
      const body = await readJson(req);
      return jsonPersisted(res, createAutomation(body));
    }

    if (req.method === "POST" && url.pathname === "/api/automations/run-due") {
      const body = await readJson(req);
      return jsonPersisted(res, await runDueAutomations({ limit: body.limit || 20 }));
    }

    const automationRunMatch = url.pathname.match(/^\/api\/automations\/([^/]+)\/run$/);
    if (req.method === "POST" && automationRunMatch) {
      return jsonPersisted(res, await runAutomation({ automationId: automationRunMatch[1] }));
    }

    const automationMatch = url.pathname.match(/^\/api\/automations\/([^/]+)$/);
    if (req.method === "PATCH" && automationMatch) {
      const body = await readJson(req);
      return jsonPersisted(res, updateAutomation({ automationId: automationMatch[1], ...body }));
    }

    if (req.method === "DELETE" && automationMatch) {
      return jsonPersisted(res, deleteAutomation({ automationId: automationMatch[1] }));
    }

    const awardMatch = url.pathname.match(/^\/api\/bounties\/([^/]+)\/award$/);
    if (req.method === "POST" && awardMatch) {
      const body = await readJson(req);
      return jsonPersisted(res, await awardBounty({
        paymentId: awardMatch[1],
        winnerHandle: body.winnerHandle
      }));
    }

    if (req.method === "GET") {
      return await serveStatic(url.pathname, res);
    }

    notFound(res);
  } catch (error) {
    json(res, { ok: false, error: error.message }, 400);
  }
});

export const ready = loadStore();
await ready;

let backgroundWorkerRunning = false;

if (!process.env.VERCEL) {
  server.listen(port, () => {
    console.log(`ArcPay prototype running on http://localhost:${port}`);
  });
  startBackgroundWorker();
}

function startBackgroundWorker() {
  if (!config.automations.workerEnabled) {
    console.log("Background automation worker disabled");
    return;
  }

  const runTick = () => {
    runBackgroundWorkerTick().catch((error) => {
      console.error("Background automation worker failed", error);
    });
  };

  const timer = setInterval(runTick, config.automations.tickMs);
  timer.unref?.();

  const firstTick = setTimeout(runTick, 2_000);
  firstTick.unref?.();

  console.log(`Background automation worker running every ${config.automations.tickMs}ms`);
}

async function runBackgroundWorkerTick() {
  if (backgroundWorkerRunning) return;
  backgroundWorkerRunning = true;

  try {
    const [jobs, automations, oracleSync] = await Promise.all([
      runDueJobs({ limit: config.automations.limit }),
      runDueAutomations({ limit: config.automations.limit }),
      syncArcPerpsOracleFromHyperliquid()
    ]);

    const oracleUpdates = oracleSync.ok ? oracleSync.updates.filter((item) => !item.skipped).length : 0;
    if (jobs.ran.length || automations.ran.length || oracleUpdates) {
      await persistStore();
      console.log(`Background worker ran ${jobs.ran.length} jobs, ${automations.ran.length} automations, and ${oracleUpdates} oracle updates`);
    }
  } finally {
    backgroundWorkerRunning = false;
  }
}

async function serveStatic(pathname, res) {
  const spaRoutes = new Set(["/", "/terminal", "/mcp-guide", "/api-keys", "/dashboard", "/wallet"]);
  const safePath = spaRoutes.has(pathname) ? "/index.html" : pathname;
  const filePath = join(root, "public", safePath);
  let content;

  try {
    content = await readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return notFound(res);
    }

    throw error;
  }

  const type = contentType(extname(filePath));
  res.writeHead(200, { "content-type": type });
  res.end(content);
}

async function readJson(req) {
  const rawBody = await readBody(req);

  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return "";
  }

  return Buffer.concat(chunks).toString("utf8");
}

function json(res, payload, status = 200, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(payload, jsonReplacer, 2));
}

function html(res, body, status = 200) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

function renderPublicXCommandReceipt(receipt) {
  const command = receipt.command;
  const related = receipt.related || {};
  const payment = related.payment;
  const airdrop = related.airdrop;
  const proposal = related.proposal;
  const action = related.defiAction;
  const approval = related.approval;
  const title = `${command.actorHandle} command`;
  const resultStatus = command.result?.status || payment?.status || proposal?.status || action?.status || command.status;
  const approvalUrl = receipt.approvalUrl;
  const txHash = command.resultRefs?.txHash || command.approvalResult?.txHash || "none";
  const summary = payment
    ? `${payment.amount} ${payment.asset || "USDC"} to ${payment.recipientHandle || "claim winner"}`
    : airdrop
      ? `${airdrop.amountPerRecipient} ${airdrop.asset} airdrop`
      : proposal
      ? `${proposal.side} ${proposal.symbol} at ${proposal.leverage}x`
      : action
        ? `${action.type} ${action.amount} ${action.fromToken || "USDC"}`
        : command.intent?.action || "Agent action";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | ArcPay Receipt</title>
    <style>
      :root { color-scheme: light; --bg:#f7f6f3; --ink:#171717; --muted:#706e69; --line:#e4e0d8; --surface:#fff; --green:#2f6759; --yellow:#8a640f; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100dvh; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
      main { width: min(760px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0; }
      .brand { display:flex; align-items:center; gap:10px; margin-bottom:24px; font-weight:800; }
      .mark { width:34px; height:34px; border-radius:8px; display:grid; place-items:center; background:var(--ink); color:#fff; }
      article { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: clamp(22px, 5vw, 42px); }
      .kicker { color: var(--muted); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; font-weight: 800; }
      h1 { margin: 8px 0 10px; font-size: clamp(32px, 8vw, 64px); line-height: .95; letter-spacing: 0; }
      blockquote { margin: 24px 0; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: #fbfbfa; overflow-wrap:anywhere; }
      .status { display:inline-flex; margin-top: 10px; border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 800; text-transform: uppercase; color: var(--green); }
      .grid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:10px; margin-top:24px; }
      .cell { border:1px solid var(--line); border-radius:8px; padding:12px; }
      .cell span { display:block; color:var(--muted); font-size:12px; font-weight:800; text-transform:uppercase; }
      .cell strong { display:block; margin-top:4px; overflow-wrap:anywhere; }
      .reply { margin-top:24px; border-left: 3px solid var(--green); padding: 12px 14px; background:#edf3ec; border-radius: 8px; overflow-wrap:anywhere; }
      .muted { color: var(--muted); }
      @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } main { padding: 24px 0; } }
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="mark">A</span><span>ArcPay Receipt</span></div>
      <article>
        <span class="kicker">${escapeHtml(command.id)}</span>
        <h1>${escapeHtml(summary)}</h1>
        <span class="status">${escapeHtml(resultStatus || command.status)}</span>
        <blockquote>${escapeHtml(command.text)}</blockquote>
        <div class="grid">
          ${receiptCell("Actor", command.actorHandle)}
          ${receiptCell("Source", command.source)}
          ${receiptCell("Intent", command.intent?.action || "unknown")}
          ${receiptCell("Settlement", command.settlementRail || payment?.settlementRail || airdrop?.settlementRail || proposal?.settlementRail || action?.fromRail || "arc-testnet")}
          ${receiptCell("Approval", approval?.status || "not required")}
          ${receiptCell("Approval link", approvalUrl || "not required")}
          ${receiptCell("Tx hash", txHash)}
          ${receiptCell("Reply delivery", command.replyDelivery?.status || "not attempted")}
          ${receiptCell("Backend signer", "not used")}
        </div>
        <div class="reply"><strong>Bot reply</strong><br />${escapeHtml(receipt.reply || command.reply || "")}</div>
        <p class="muted">This receipt is generated from the bunOS command ledger and is designed to be shared back in the X thread.</p>
      </article>
    </main>
  </body>
</html>`;
}

function renderPublicXCommandApproval(receipt) {
  const command = receipt.command;
  const approval = receipt.related?.approval;
  const disabled = !approval || approval.status !== "pending";
  const status = approval?.status || "not required";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Approve ${escapeHtml(command.id)} | bunOS</title>
    <style>
      :root { color-scheme: dark; --bg:#060608; --ink:#f4f1ee; --muted:#a29a94; --line:#2a2020; --surface:#141416; --orange:#ff3b1f; }
      * { box-sizing:border-box; }
      body { margin:0; min-height:100dvh; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; display:grid; place-items:center; padding:24px; }
      main { width:min(720px, 100%); border:1px solid var(--line); border-radius:18px; background:var(--surface); padding:clamp(24px, 5vw, 44px); }
      .kicker { color:var(--orange); text-transform:uppercase; letter-spacing:.1em; font-size:12px; font-weight:900; }
      h1 { margin:10px 0 12px; font-size:clamp(34px, 8vw, 72px); line-height:.95; letter-spacing:0; }
      blockquote { margin:24px 0; padding:16px; border:1px solid var(--line); border-radius:12px; background:#09090c; overflow-wrap:anywhere; }
      .grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; margin:22px 0; }
      .cell { border:1px solid var(--line); border-radius:12px; padding:12px; background:#0c0c10; }
      .cell span { display:block; color:var(--muted); font-size:12px; text-transform:uppercase; font-weight:900; }
      .cell strong { display:block; margin-top:4px; overflow-wrap:anywhere; }
      button, a { min-height:46px; border-radius:12px; border:1px solid var(--line); padding:0 16px; display:inline-flex; align-items:center; justify-content:center; color:var(--ink); text-decoration:none; font-weight:900; }
      button { background:var(--orange); border-color:var(--orange); cursor:pointer; }
      button:disabled { opacity:.45; cursor:not-allowed; }
      a { background:#0c0c10; margin-left:8px; }
      .msg { margin-top:18px; color:var(--muted); min-height:24px; }
      @media (max-width: 640px) { .grid { grid-template-columns:1fr; } a { margin:8px 0 0; width:100%; } button { width:100%; } }
    </style>
  </head>
  <body>
    <main>
      <span class="kicker">${escapeHtml(command.id)}</span>
      <h1>${disabled ? "Approval status" : "Approve action"}</h1>
      <p>${escapeHtml(approval?.summary || "This command has no pending approval.")}</p>
      <blockquote>${escapeHtml(command.text)}</blockquote>
      <div class="grid">
        ${receiptCell("Actor", command.actorHandle)}
        ${receiptCell("Approval", status)}
        ${receiptCell("Kind", approval?.kind || "none")}
        ${receiptCell("Target", approval?.targetId || "none")}
      </div>
      <button id="approve" ${disabled ? "disabled" : ""}>Approve and execute</button>
      <a href="${escapeHtml(receipt.publicUrl || `/x/commands/${command.id}`)}">View receipt</a>
      <div class="msg" id="msg">${disabled ? `Current status: ${escapeHtml(status)}` : "This will execute using the user's connected wallet/tool path, not a backend signer."}</div>
    </main>
    <script>
      const button = document.getElementById("approve");
      const msg = document.getElementById("msg");
      button?.addEventListener("click", async () => {
        button.disabled = true;
        msg.textContent = "Approving...";
        const response = await fetch("/api/x/commands/${encodeURIComponent(command.id)}/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle: "${escapeHtml(command.actorHandle)}" })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
          msg.textContent = data.error || "Approval failed.";
          button.disabled = false;
          return;
        }
        msg.textContent = "Approved. Opening updated receipt...";
        window.location.href = data.receipt?.publicUrl || "${escapeHtml(receipt.publicUrl || `/x/commands/${command.id}`)}";
      });
    </script>
  </body>
</html>`;
}

function renderPublicDefiActionReceipt(receipt) {
  const action = receipt.action;
  const request = action.request || {};
  const approval = receipt.approval;
  const execution = receipt.execution;
  const amount = request.amount || request.amountUsd || "n/a";
  const title = `${action.type} ${amount} ${request.fromToken || "USDC"}`;
  const timeline = receipt.timeline || [];

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | ArcPay DeFi Receipt</title>
    <style>
      :root { color-scheme: light; --bg:#f7f6f3; --ink:#171717; --muted:#706e69; --line:#e4e0d8; --surface:#fff; --green:#2f6759; --amber:#8a640f; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100dvh; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
      main { width: min(800px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0; }
      .brand { display:flex; align-items:center; gap:10px; margin-bottom:24px; font-weight:800; }
      .mark { width:34px; height:34px; border-radius:8px; display:grid; place-items:center; background:var(--ink); color:#fff; }
      article { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: clamp(22px, 5vw, 42px); }
      .kicker { color: var(--muted); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; font-weight: 800; }
      h1 { margin: 8px 0 10px; font-size: clamp(32px, 8vw, 58px); line-height: .98; letter-spacing: 0; }
      .status { display:inline-flex; margin-top: 10px; border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 800; text-transform: uppercase; color: var(--green); }
      .grid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:10px; margin-top:24px; }
      .cell { border:1px solid var(--line); border-radius:8px; padding:12px; }
      .cell span { display:block; color:var(--muted); font-size:12px; font-weight:800; text-transform:uppercase; }
      .cell strong { display:block; margin-top:4px; overflow-wrap:anywhere; }
      .timeline { margin:28px 0 0; padding:0; list-style:none; display:grid; gap:10px; }
      .timeline li { border-left: 3px solid var(--green); padding: 8px 0 8px 12px; }
      .timeline span { display:block; color:var(--muted); font-size:12px; }
      a { color: var(--green); font-weight: 800; }
      .muted { color: var(--muted); margin-top:24px; }
      @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } main { padding: 24px 0; } }
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="mark">A</span><span>ArcPay DeFi Receipt</span></div>
      <article>
        <span class="kicker">${escapeHtml(action.id)}</span>
        <h1>${escapeHtml(title)}</h1>
        <span class="status">${escapeHtml(action.status)}</span>
        <div class="grid">
          ${receiptCell("Handle", action.handle)}
          ${receiptCell("Protocol", action.protocol)}
          ${receiptCell("Route", `${request.fromRail || "n/a"} -> ${request.toRail || "n/a"}`)}
          ${receiptCell("Approval", approval?.status || "not required")}
          ${receiptCell("Signer", action.signer?.signerType || "circle_user_wallet")}
          ${receiptCell("Backend signer", execution?.backendSignerAllowed === true ? "blocked by policy" : "not used")}
          ${receiptCell("Provider", execution?.provider || action.quote?.provider || "quote only")}
          ${receiptCell("Next action", receipt.nextAction || "none")}
        </div>
        ${receipt.explorerUrl ? `<p><a href="${escapeHtml(receipt.explorerUrl)}">Open transaction explorer</a></p>` : ""}
        <ul class="timeline">
          ${timeline.map((item) => `<li><strong>${escapeHtml(item.label || item.type)}</strong><span>${escapeHtml(item.at)}</span></li>`).join("")}
        </ul>
        <p class="muted">This receipt records user-wallet execution state. It does not use the backend deployer wallet for user funds.</p>
      </article>
    </main>
  </body>
</html>`;
}

function renderPublicAirdropReceipt(receipt) {
  const airdrop = receipt.airdrop;
  const approval = receipt.approval;
  const payments = receipt.payments || [];
  const title = `${airdrop.amountPerRecipient} ${airdrop.asset} airdrop`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | bunOS Airdrop</title>
    <style>
      :root { color-scheme: dark; --bg:#060608; --ink:#f4f1ee; --muted:#a29a94; --line:#2a2020; --surface:#141416; --orange:#ff3b1f; }
      * { box-sizing:border-box; }
      body { margin:0; min-height:100dvh; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
      main { width:min(860px, calc(100% - 32px)); margin:0 auto; padding:48px 0; }
      article { border:1px solid var(--line); border-radius:18px; background:var(--surface); padding:clamp(24px, 5vw, 44px); }
      .kicker { color:var(--orange); text-transform:uppercase; letter-spacing:.1em; font-size:12px; font-weight:900; }
      h1 { margin:10px 0 12px; font-size:clamp(38px, 8vw, 78px); line-height:.95; letter-spacing:0; }
      .grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; margin-top:24px; }
      .cell { border:1px solid var(--line); border-radius:12px; padding:12px; background:#0c0c10; }
      .cell span { display:block; color:var(--muted); font-size:12px; text-transform:uppercase; font-weight:900; }
      .cell strong { display:block; margin-top:4px; overflow-wrap:anywhere; }
      ul { margin:24px 0 0; padding:0; list-style:none; display:grid; gap:10px; }
      li { border:1px solid var(--line); border-radius:12px; padding:12px; background:#0c0c10; display:flex; justify-content:space-between; gap:12px; }
      .muted { color:var(--muted); }
      @media (max-width: 640px) { .grid { grid-template-columns:1fr; } li { display:block; } }
    </style>
  </head>
  <body>
    <main>
      <article>
        <span class="kicker">${escapeHtml(airdrop.id)}</span>
        <h1>${escapeHtml(title)}</h1>
        <p class="muted">${escapeHtml(airdrop.rule)} from ${escapeHtml(airdrop.senderHandle)} on ${escapeHtml(airdrop.settlementRail)}.</p>
        <div class="grid">
          ${receiptCell("Status", airdrop.status)}
          ${receiptCell("Budget", `${airdrop.totalBudget} ${airdrop.asset}`)}
          ${receiptCell("Recipients", `${airdrop.winnerHandles?.length || 0}/${airdrop.maxRecipients}`)}
          ${receiptCell("Approval", approval?.status || "not required")}
          ${receiptCell("Backend signer", "not used")}
          ${receiptCell("Next", receipt.nextAction)}
        </div>
        <ul>
          ${payments.map((payment) => `<li><strong>${escapeHtml(payment.recipientHandle || "recipient")}</strong><span>${escapeHtml(payment.status)} ${escapeHtml(payment.id)}</span></li>`).join("") || "<li><strong>No distributions yet</strong><span>waiting</span></li>"}
        </ul>
      </article>
    </main>
  </body>
</html>`;
}

function receiptCell(label, value) {
  return `<div class="cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "n/a")}</strong></div>`;
}

async function getHackathonStatus() {
  const arcPerps = await safeAsync(() => getArcPerpsStatus());
  const positions = await safeAsync(() => listArcPerpsPositions({ limit: 8 }));
  const arc = await safeAsync(() => getArcReadiness());
  const circle = getCircleReadiness();
  const pendingApprovals = ledger.approvals.filter((approval) => approval.status === "pending");
  const queuedJobs = ledger.jobs.filter((job) => job.status === "queued");
  const failedJobs = ledger.jobs.filter((job) => job.status === "failed");
  const openPositions = positions.ok ? positions.positions.filter((position) => position.open) : [];

  const checks = [
    {
      id: "x-webhook",
      label: "X command intake",
      ok: true,
      detail: `${ledger.xWebhooks.length} received`
    },
    {
      id: "circle-wallets",
      label: "Circle wallets",
      ok: circle.ready || config.providerMode === "mock",
      detail: circle.ready ? "credentials configured" : `${config.providerMode} mode`
    },
    {
      id: "arc-rpc",
      label: "Arc RPC",
      ok: Boolean(arc.ok),
      detail: arc.ok ? `chain ${arc.chainId || "ready"}` : arc.error || "not ready"
    },
    {
      id: "arc-perps",
      label: "ArcPerps contracts",
      ok: Boolean(arcPerps.ok),
      detail: arcPerps.ok ? compactAddress(arcPerps.vaultAddress) : (arcPerps.missing || []).join(", ")
    },
    {
      id: "execution",
      label: "User-owned execution",
      ok: config.transferProvider === "circle" && circle.ready,
      detail: config.transferProvider === "circle" && circle.ready
        ? "Circle user wallets"
        : "backend signer execution disabled"
    },
    {
      id: "jobs",
      label: "Worker queue",
      ok: failedJobs.length === 0,
      detail: `${queuedJobs.length} queued, ${failedJobs.length} failed`
    }
  ];

  return {
    ok: checks.every((check) => check.ok),
    at: new Date().toISOString(),
    mode: {
      provider: config.providerMode,
      transfer: config.transferProvider,
      defiLiveAdapters: config.defi.liveAdapters
    },
    checks,
    counts: {
      wallets: listWalletProfiles().length,
      payments: ledger.payments.length,
      approvalsPending: pendingApprovals.length,
      jobsQueued: queuedJobs.length,
      jobsFailed: failedJobs.length,
      defiActions: ledger.defiActions.length,
      perpProposals: ledger.perpProposals.length,
      xCommands: ledger.xCommands.length,
      openPositions: openPositions.length
    },
    arcPerps: {
      status: arcPerps,
      positions: positions.ok ? positions.positions : [],
      positionsError: positions.ok ? null : positions.error
    },
    latest: {
      events: ledger.events.slice().reverse().slice(0, 8),
      approvals: ledger.approvals.slice().reverse().slice(0, 5),
      jobs: ledger.jobs.slice().reverse().slice(0, 5),
      xCommands: ledger.xCommands.slice().reverse().slice(0, 5),
      xWebhooks: ledger.xWebhooks.slice().reverse().slice(0, 5)
    }
  };
}

function signerBackedExecutionDisabled(tool) {
  return {
    ok: false,
    tool,
    status: "user_wallet_signing_required",
    backendSignerAllowed: false,
    message: "This endpoint would use ARC_SETTLEMENT_PRIVATE_KEY, so it is disabled. Wire it to a user-owned Circle/AppKit signing path before enabling live execution."
  };
}

function recordArcPerpsTx(type, result, metadata = {}) {
  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type,
    txHash: result.txHash || null,
    explorerUrl: result.explorerUrl || null,
    status: result.receipt?.status || "submitted",
    ...metadata
  });
}

async function safeAsync(run) {
  try {
    return await run();
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function compactAddress(address = "") {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "n/a";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function jsonPersisted(res, payload, status = 200, headers = {}) {
  await persistStore();
  return json(res, payload, status, headers);
}

async function handleMcpHttpPayload(body, context = {}) {
  if (Array.isArray(body)) {
    const responses = [];
    for (const item of body) {
      const response = await handleMcpJsonRpc(item, context);
      if (response) responses.push(response);
    }
    return responses;
  }

  return await handleMcpJsonRpc(body, context);
}

function openMcpSse(req, res, messagePath, context = {}) {
  const sessionId = randomUUID();
  const endpoint = `${messagePath}?sessionId=${encodeURIComponent(sessionId)}`;
  res.writeHead(200, {
    ...corsHeaders(),
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  res.write(`event: endpoint\ndata: ${endpoint}\n\n`);
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, sessionId })}\n\n`);

  const heartbeat = setInterval(() => {
    if (!res.destroyed) res.write(": heartbeat\n\n");
  }, 25_000);

  sseClients.set(sessionId, { res, heartbeat, context });
  req.on("close", () => closeMcpSseSession(sessionId));
}

async function handleMcpSseMessage(req, res, url) {
  const sessionId = url.searchParams.get("sessionId");
  const client = sessionId ? sseClients.get(sessionId) : null;
  if (!client) {
    return json(res, {
      ok: false,
      error: "Unknown or expired MCP SSE session"
    }, 404, corsHeaders());
  }

  let response;
  try {
    const body = await readJson(req);
    response = await handleMcpHttpPayload(body, client.context || {});
    await persistStore();
  } catch (error) {
    response = toMcpError({ id: null, error });
  }

  if (response) {
    client.res.write(`event: message\ndata: ${JSON.stringify(response, jsonReplacer)}\n\n`);
  }

  return json(res, { ok: true }, 202, corsHeaders());
}

function closeMcpSseSession(sessionId) {
  const client = sseClients.get(sessionId);
  if (!client) return;
  clearInterval(client.heartbeat);
  sseClients.delete(sessionId);
}

function isMcpHttpPath(pathname) {
  return ["/mcp", "/sse", "/messages", "/mcp/sse", "/mcp/messages"].includes(pathname);
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization, content-type, mcp-session-id"
  };
}

function getMcpAuthContext(req) {
  const auth = authenticateMcpApiKey(req.headers.authorization || "");
  return auth ? { handle: auth.handle, keyId: auth.keyId, scopes: auth.scopes } : {};
}

function requireSession(req) {
  const session = getSession(readCookie(req, "arcpay_session"));
  if (!session?.handle) {
    const error = new Error("Sign in with X before managing MCP API keys.");
    error.status = 401;
    throw error;
  }
  return session;
}

function notFound(res) {
  json(res, { ok: false, error: "Not found" }, 404);
}

function readCookie(req, name) {
  const cookie = req.headers.cookie || "";
  const pairs = cookie.split(";").map((part) => part.trim().split("="));
  const match = pairs.find(([key]) => key === name);
  return match ? decodeURIComponent(match[1] || "") : "";
}

function setSessionCookie(res, session, extraHeaders = {}) {
  const headers = {
    ...sessionCookieHeader(session),
    ...extraHeaders
  };

  res.writeHead(extraHeaders.location ? 302 : 200, headers);
}

function sessionCookieHeader(session) {
  return {
    "set-cookie": `arcpay_session=${encodeURIComponent(session.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
  };
}

function clearSessionCookieHeader() {
  return {
    "set-cookie": "arcpay_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  };
}

function contentType(ext) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";
}
