import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { config } from "../src/config.js";
import { planAgentAction, runAgentAction } from "../src/agentPlanner.js";
import { openSecret } from "../src/cryptoBox.js";
import { redactRpcUrl } from "../src/arcRpc.js";
import { ledger, users } from "../src/fixtures.js";
import { parseSocialCommand } from "../src/intent.js";
import { getSettlementRail } from "../src/settlement.js";
import {
  awardBounty,
  claimPayment,
  confirmPayment,
  createPaymentIntent,
  createSocialBounty
} from "../src/orchestrator.js";
import { enqueueJob, listJobs, runDueJobs, runJob } from "../src/jobs.js";
import { listApprovals } from "../src/approvals.js";
import { callMcpTool, mcpTools } from "../src/mcp.js";
import { completeMockXOAuth } from "../src/xOAuth.js";
import {
  getXCommandReceipt,
  getXWebhookStatus,
  listXCommands,
  processXPaymentEvent,
  processXWebhookDelivery,
  verifyXWebhook
} from "../src/xPayments.js";
import { runXBotCommand, runXBotWebhookDelivery } from "../src/xBotLoop.js";
import { reconcileCircleNotification } from "../src/transferProvider.js";
import {
  getOperations,
  getPaymentReceipt,
  listClaims,
  listPayments,
  resolveIdentity
} from "../src/queries.js";
import {
  listProviderWork,
  retryPaymentTransfer
} from "../src/reconciliation.js";
import { bridgeFunds, getWalletProfile } from "../src/walletAccounts.js";
import {
  awardAirdrop,
  createAirdrop,
  getAirdropReceipt,
  listAirdrops
} from "../src/airdrops.js";
import { listArcTradingPrimitives } from "../src/arcTradingPrimitives.js";
import {
  confirmDefiAction,
  getDefiActionReceipt,
  listDefiActions,
  listDefiTools,
  listPerpMarkets,
  quoteDefiRoute,
  searchPredictionMarkets
} from "../src/defiOrchestrator.js";
import { getDefiExecutionReadiness } from "../src/defiExecution.js";
import {
  getArcPerpsReadiness,
  getArcPerpsStatus,
  quoteArcPerpPosition
} from "../src/arcPerpsEngine.js";
import {
  applyMcpApiKeyContext,
  authenticateMcpApiKey,
  createMcpApiKey,
  listMcpApiKeys,
  revokeMcpApiKey
} from "../src/mcpApiKeys.js";

config.providerMode = "mock";
config.transferProvider = "mock";
config.x.replyEnabled = false;
config.defi.liveAdapters = false;
config.defi.executionEnabled = false;

const tests = [
  [
    "uses live Arc Testnet metadata",
    async () => {
      const arc = getSettlementRail("arc-testnet");

      assert.equal(arc.chainId, 5042002);
      assert.equal(arc.chainIdHex, "0x4cef52");
      assert.equal(arc.appKitChain, "Arc_Testnet");
      assert.equal(arc.usdcAddress, "0x3600000000000000000000000000000000000000");
      assert.equal(arc.cirbtcAddress, "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF");
      assert.equal(arc.rpcUrl, config.arc.rpcUrl);
      assert.ok(["canteen", "custom", "circle-public"].includes(config.arc.rpcProvider));
      assert.equal(arc.explorerBaseUrl, "https://testnet.arcscan.app/tx/");
      assert.equal(redactRpcUrl("https://rpc.testnet.arc-node.thecanteenapp.com/v1/secret-key"), "https://rpc.testnet.arc-node.thecanteenapp.com/v1/<key>");
    }
  ],
  [
    "parses direct X-handle payment commands",
    async () => {
      assert.deepEqual(parseSocialCommand("@ArcPay send 10 USDC to @alice"), {
        action: "send_payment",
        amount: 10,
        asset: "USDC",
        recipientHandle: "@alice"
      });
    }
  ],
  [
    "parses first-commenter bounty commands",
    async () => {
      assert.deepEqual(parseSocialCommand("@ArcPay pay 10 USDC to whoever comments first"), {
        action: "create_social_bounty",
        amount: 10,
        asset: "USDC",
        rule: "first_valid_commenter"
      });
    }
  ],
  [
    "parses X-native perp commands",
    async () => {
      assert.deepEqual(parseSocialCommand("@ArcPay long BTC with $20 at 2x"), {
        action: "propose_perp_trade",
        symbol: "BTC",
        side: "long",
        collateralUsd: 20,
        leverage: 2
      });
    }
  ],
  [
    "creates a claimable escrow when recipient has not onboarded",
    async () => {
      const result = await createPaymentIntent({
        senderHandle: "@sara",
        recipientHandle: "@newcreator",
        amount: 10
      });

      assert.equal(result.ok, true);
      assert.equal(result.payment.status, "claimable");
      assert.equal(result.payment.settlement.rail, "arc-testnet");
      assert.equal(result.payment.walletInstruction.provider, "circle-wallets");
    }
  ],
  [
    "requires confirmation when policy threshold is exceeded",
    async () => {
      const result = await createPaymentIntent({
        senderHandle: "@sara",
        recipientHandle: "@bob",
        amount: 12
      });

      assert.equal(result.ok, true);
      assert.equal(result.payment.status, "requires_confirmation");

      const confirmed = await confirmPayment({ paymentId: result.payment.id });
      assert.equal(confirmed.payment.status, "queued");
      await settleQueuedPayment(confirmed.payment);
      assert.equal(confirmed.payment.status, "settled");
    }
  ],
  [
    "lets the intended recipient claim escrow after X verification",
    async () => {
      const result = await createPaymentIntent({
        senderHandle: "@sara",
        recipientHandle: "@claimant",
        amount: 5
      });

      const claimed = await claimPayment({
        paymentId: result.payment.id,
        claimantHandle: "@claimant",
        walletAddress: "0xClaimantCircleWallet"
      });

      assert.equal(claimed.payment.status, "queued");
      await settleQueuedPayment(claimed.payment);
      assert.equal(claimed.payment.status, "settled");
      assert.equal(claimed.payment.recipientWalletAddress, "0xClaimantCircleWallet");
    }
  ],
  [
    "creates and awards a social bounty",
    async () => {
      const bounty = await createSocialBounty({
        senderHandle: "@sara",
        postId: "post_123",
        amount: 10
      });

      assert.equal(bounty.payment.status, "watching_replies");

      const awarded = await awardBounty({
        paymentId: bounty.payment.id,
        winnerHandle: "@bob"
      });

      assert.equal(awarded.payment.status, "queued");
      await settleQueuedPayment(awarded.payment);
      assert.equal(awarded.payment.status, "settled");
      assert.equal(awarded.payment.recipientHandle, "@bob");
    }
  ],
  [
    "creates fixed-recipient airdrops through Circle user-wallet payment paths",
    async () => {
      const result = await createAirdrop({
        senderHandle: "@sara",
        recipients: ["@alice", "@bob"],
        amountPerRecipient: 1,
        settlementRail: "arc-testnet",
        idempotencyKey: "test_airdrop_fixed_001"
      });

      assert.equal(result.ok, true);
      assert.equal(result.airdrop.status, "distributed");
      assert.equal(result.airdrop.distributions.length, 2);
      assert.equal(result.airdrop.signer.signerType, "circle_user_wallet");
      assert.equal(result.airdrop.signer.backendSignerAllowed, false);
      assert.equal(result.payments.length, 2);

      const receipt = getAirdropReceipt({
        airdropId: result.airdrop.id,
        host: "localhost:4319"
      });
      assert.equal(receipt.receipt.payments.length, 2);
      assert.ok(listAirdrops({ handle: "@sara" }).airdrops.find((airdrop) => airdrop.id === result.airdrop.id));

      const replay = await createAirdrop({
        senderHandle: "@sara",
        recipients: ["@alice", "@bob"],
        amountPerRecipient: 1,
        settlementRail: "arc-testnet",
        idempotencyKey: "test_airdrop_fixed_001"
      });
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.airdrop.id, result.airdrop.id);
    }
  ],
  [
    "creates social airdrops and awards winners later",
    async () => {
      const created = await createAirdrop({
        senderHandle: "@sara",
        amountPerRecipient: 0.5,
        maxRecipients: 2,
        postId: "post_airdrop_001",
        rule: "first_commenters",
        settlementRail: "arc-testnet"
      });

      assert.equal(created.ok, true);
      assert.equal(created.airdrop.status, "watching_replies");
      assert.equal(created.nextAction, "award_airdrop");

      const awarded = await awardAirdrop({
        airdropId: created.airdrop.id,
        winnerHandles: ["@alice", "@bob", "@sara"]
      });

      assert.equal(awarded.ok, true);
      assert.equal(awarded.airdrop.status, "distributed");
      assert.equal(awarded.airdrop.winnerHandles.length, 2);
      assert.equal(awarded.payments.length, 2);
    }
  ],
  [
    "connects X and provisions Circle wallets on Arc and Base Sepolia",
    async () => {
      const result = await completeMockXOAuth({ handle: "@maya" });

      assert.equal(result.ok, true);
      assert.equal(result.wallet.xConnected, true);
      assert.ok(result.wallet.wallets.find((wallet) => wallet.rail === "arc-testnet"));
      assert.ok(result.wallet.wallets.find((wallet) => wallet.rail === "base-sepolia"));
    }
  ],
  [
    "supports Base Sepolia as the bridge demo rail",
    async () => {
      const baseSepolia = getSettlementRail("base-sepolia");
      assert.equal(baseSepolia.chainId, 84532);
      assert.equal(baseSepolia.circleBlockchain, "BASE-SEPOLIA");
    }
  ],
  [
    "processes X webhook payment events through the payment core",
    async () => {
      const result = await processXPaymentEvent({
        actorHandle: "@sara",
        text: "@ArcPay send 4 USDC to @bob",
        postId: "post_webhook_001",
        settlementRail: "arc-testnet"
      });

      assert.equal(result.ok, true);
      assert.equal(result.payment.source, "x-webhook");
      assert.equal(result.payment.status, "queued");
      await settleQueuedPayment(result.payment);
      assert.equal(result.payment.status, "settled");
    }
  ],
  [
    "deduplicates replayed X webhook events",
    async () => {
      const before = ledger.payments.length;
      const payload = {
        actorHandle: "@sara",
        text: "@ArcPay send 2 USDC to @bob",
        postId: "post_replay_001",
        eventId: "evt_replay_001",
        settlementRail: "arc-testnet"
      };

      const first = await processXPaymentEvent(payload);
      const second = await processXPaymentEvent(payload);

      assert.equal(first.ok, true);
      assert.equal(second.idempotentReplay, true);
      assert.equal(ledger.payments.length, before + 1);
    }
  ],
  [
    "creates confirmation-gated perp proposals from X webhook commands",
    async () => {
      const result = await processXPaymentEvent({
        actorHandle: "@sara",
        text: "@ArcPay short ETH with 15 USDC at 2x",
        postId: "post_perp_001",
        eventId: "evt_perp_001",
        settlementRail: "arc-testnet"
      });

      assert.equal(result.ok, true);
      assert.equal(result.proposal.status, "requires_confirmation");
      assert.equal(result.proposal.source, "x-webhook");
      assert.equal(result.proposal.symbol, "ETH");
      assert.ok(result.approval.id);
      assert.equal(result.command.intent.action, "propose_perp_trade");
      assert.equal(result.command.resultRefs.proposalId, result.proposal.id);

      const inbox = listXCommands({ handle: "@sara", limit: 1 });
      assert.equal(inbox.commands[0].id, result.command.id);

      const receipt = getXCommandReceipt({
        commandId: result.command.id,
        host: "localhost:4319",
        protocol: "http"
      });
      assert.equal(receipt.receipt.related.proposal.id, result.proposal.id);
      assert.equal(receipt.receipt.publicUrl, `http://localhost:4319/x/commands/${result.command.id}`);
      assert.match(receipt.receipt.reply, /No backend signer used/);

      const replay = await processXPaymentEvent({
        actorHandle: "@sara",
        text: "@ArcPay short ETH with 15 USDC at 2x",
        postId: "post_perp_001",
        eventId: "evt_perp_001",
        settlementRail: "arc-testnet"
      });
      assert.equal(replay.idempotentReplay, true);
      assert.equal(replay.proposal.id, result.proposal.id);
    }
  ],
  [
    "auto-claims pending escrow when the intended X user connects",
    async () => {
      const payment = await createPaymentIntent({
        senderHandle: "@sara",
        recipientHandle: "@zora",
        amount: 3
      });

      assert.equal(payment.payment.status, "claimable");

      const connected = await completeMockXOAuth({ handle: "@zora" });
      assert.equal(connected.claims.length, 1);
      assert.equal(connected.claims[0].status, "queued");
      await settleQueuedPayment(connected.claims[0]);
      assert.equal(connected.claims[0].status, "settled");
    }
  ],
  [
    "verifies signed X webhook payloads when a secret is configured",
    () => {
      config.webhookSecret = "test-secret";
      const rawBody = "{\"event\":\"demo\"}";
      const signature = `sha256=${createHmac("sha256", "test-secret").update(rawBody).digest("hex")}`;

      assert.deepEqual(verifyXWebhook({
        headers: { "x-arcpay-signature": signature },
        rawBody
      }), { ok: true, mode: "hmac-sha256", signed: true });
      config.webhookSecret = "";
    }
  ],
  [
    "accepts signed X webhook deliveries and rejects replayed event ids",
    async () => {
      config.webhookSecret = "test-secret";
      const payload = {
        eventId: "evt_delivery_001",
        postId: "post_delivery_001",
        actorHandle: "@sara",
        text: "@ArcPay send 1 USDC to @bob",
        settlementRail: "arc-testnet"
      };
      const rawBody = JSON.stringify(payload);
      const signature = `sha256=${createHmac("sha256", "test-secret").update(rawBody).digest("hex")}`;

      const first = await processXWebhookDelivery({
        headers: { "x-arcpay-signature": signature },
        rawBody
      });
      const second = await processXWebhookDelivery({
        headers: { "x-arcpay-signature": signature },
        rawBody
      });

      assert.equal(first.ok, true);
      assert.equal(first.webhook.status, "processed");
      assert.equal(first.signature.mode, "hmac-sha256");
      assert.equal(second.duplicate, true);
      assert.equal(second.replayRejected, true);
      assert.equal(second.originalCommandId, first.command.id);
      assert.ok(getXWebhookStatus({ host: "localhost:4319" }).sample.rawBody);
      config.webhookSecret = "";
    }
  ],
  [
    "runs the X bot loop with receipts, approval links, and reply delivery state",
    async () => {
      const previousReplyEnabled = config.x.replyEnabled;
      config.x.replyEnabled = false;

      const result = await runXBotCommand({
        actorHandle: "@sara",
        text: "@ArcPay long BTC with 12 USDC at 2x",
        postId: "1234567890123456789",
        eventId: "evt_loop_perp_001",
        settlementRail: "arc-testnet",
        host: "bunos.xyz",
        protocol: "https"
      });

      assert.equal(result.ok, true);
      assert.equal(result.loop.status, "processed");
      assert.equal(result.loop.replyPostStatus, "x_reply_not_enabled");
      assert.equal(result.receipt.publicUrl, `https://bunos.xyz/x/commands/${result.command.id}`);
      assert.equal(result.receipt.approvalUrl, `https://bunos.xyz/x/commands/${result.command.id}/approve`);
      assert.match(result.reply, /Approve: https:\/\/bunos\.xyz\/x\/commands\//);
      assert.match(result.replyDelivery.message, /X_REPLY_ENABLED=1/);

      config.x.replyEnabled = previousReplyEnabled;
    }
  ],
  [
    "rejects replayed X bot webhook deliveries before running execution twice",
    async () => {
      const before = ledger.payments.length;
      const payload = {
        eventId: "evt_loop_replay_001",
        postId: "1234567890123456790",
        actorHandle: "@sara",
        text: "@ArcPay send 1 USDC to @bob",
        settlementRail: "arc-testnet"
      };
      const rawBody = JSON.stringify(payload);

      const first = await runXBotWebhookDelivery({
        headers: { "content-type": "application/json" },
        rawBody,
        host: "bunos.xyz",
        protocol: "https",
        postReply: false
      });
      const second = await runXBotWebhookDelivery({
        headers: { "content-type": "application/json" },
        rawBody,
        host: "bunos.xyz",
        protocol: "https",
        postReply: false
      });

      assert.equal(first.ok, true);
      assert.equal(second.duplicate, true);
      assert.equal(second.loop.status, "duplicate_rejected");
      assert.equal(second.loop.receiptUrl, first.receipt.publicUrl);
      assert.equal(ledger.payments.length, before + 1);
    }
  ],
  [
    "seals X OAuth tokens at rest",
    async () => {
      const result = await completeMockXOAuth({ handle: "@tokenuser" });
      const user = users.get(result.user.handle);

      assert.ok(user.xOAuth.accessToken.startsWith("v1."));
      assert.equal(openSecret(user.xOAuth.accessToken), "mock_x_access_token");
    }
  ],
  [
    "bridges funds between Arc and Base Sepolia rails",
    async () => {
      const result = await bridgeFunds({
        handle: "@sara",
        amount: 2,
        fromRail: "arc-testnet",
        toRail: "base-sepolia"
      });

      assert.equal(result.ok, true);
      assert.equal(result.bridge.status, "settled");
      assert.equal(result.bridge.provider, "cctp-ready");
    }
  ],
  [
    "shows non-USDC token balances without changing USDC spend accounting",
    async () => {
      const user = users.get("@sara");
      const previousTokenBalances = user.tokenBalances;
      user.tokenBalances = {
        ...(previousTokenBalances || {}),
        "arc-testnet": [
          {
            symbol: "USDC",
            amount: user.balances["arc-testnet"],
            valueUsd: user.balances["arc-testnet"]
          },
          {
            symbol: "EURC",
            amount: 1.25,
            valueUsd: 1.25,
            tokenAddress: "0xEurc"
          }
        ]
      };

      const profile = getWalletProfile("@sara");
      assert.equal(profile.balances["arc-testnet"], user.balances["arc-testnet"]);
      assert.ok(profile.tokenBalances["arc-testnet"].find((token) => token.symbol === "EURC" && token.amount === 1.25));
      assert.equal(profile.balance, user.balances["arc-testnet"] + user.balances["base-sepolia"] + 1.25);

      user.tokenBalances = previousTokenBalances;
    }
  ],
  [
    "reconciles Circle transfer webhooks into payment status",
    async () => {
      const payment = await createPaymentIntent({
        senderHandle: "@sara",
        recipientHandle: "@bob",
        amount: 1,
        settlementRail: "arc-testnet"
      });

      await settleQueuedPayment(payment.payment);
      const reconciled = reconcileCircleNotification({
        ledger,
        notification: {
          data: {
            id: payment.payment.transfer.providerTransferId,
            status: "CONFIRMED",
            txHash: "0xabc"
          }
        }
      });

      assert.equal(reconciled.ok, true);
      assert.equal(reconciled.payment.transfer.status, "settled");
      assert.equal(reconciled.payment.transfer.txHash, "0xabc");
    }
  ],
  [
    "builds payment receipts for frontend and agents",
    async () => {
      const payment = await createPaymentIntent({
        senderHandle: "@sara",
        recipientHandle: "@bob",
        amount: 1,
        settlementRail: "arc-testnet"
      });

      await settleQueuedPayment(payment.payment);
      const receipt = getPaymentReceipt({ paymentId: payment.payment.id });

      assert.equal(receipt.ok, true);
      assert.equal(receipt.receipt.payment.id, payment.payment.id);
      assert.ok(receipt.receipt.timeline.length >= 2);
      assert.equal(receipt.receipt.nextAction, "none");
    }
  ],
  [
    "lists identity, payments, claims, and operations contracts",
    async () => {
      const claimable = await createPaymentIntent({
        senderHandle: "@sara",
        recipientHandle: "@reader",
        amount: 1
      });

      const identity = resolveIdentity({ handle: "@reader" });
      const payments = listPayments({ handle: "@sara" });
      const claims = listClaims({ handle: "@reader", status: "unclaimed" });
      const ops = getOperations({ limit: 10 });

      assert.equal(claimable.payment.status, "claimable");
      assert.equal(identity.identity.handle, "@reader");
      assert.ok(payments.payments.length > 0);
      assert.equal(claims.claims.length, 1);
      assert.ok(ops.events.length > 0);
    }
  ],
  [
    "lists provider work and retries failed transfers",
    async () => {
      const payment = await createPaymentIntent({
        senderHandle: "@sara",
        recipientHandle: "@bob",
        amount: 1,
        settlementRail: "arc-testnet"
      });

      payment.payment.status = "failed";
      payment.payment.providerStatus = "failed";
      payment.payment.failureReason = "test failure";

      const work = listProviderWork({ status: "failed" });
      const retried = await retryPaymentTransfer({ paymentId: payment.payment.id });

      assert.ok(work.payments.find((item) => item.id === payment.payment.id));
      assert.equal(retried.ok, true);
      assert.equal(retried.payment.status, "queued");
      assert.equal(retried.job.type, "retry_transfer");
      await runJob({ jobId: retried.job.id });
      assert.equal(retried.payment.status, "settled");
      assert.equal(retried.payment.transferRetries, 1);
    }
  ],
  [
    "queues provider transfer jobs and runs due work",
    async () => {
      const result = await createPaymentIntent({
        senderHandle: "@sara",
        recipientHandle: "@bob",
        amount: 1,
        settlementRail: "arc-testnet"
      });

      assert.equal(result.payment.status, "queued");
      const jobs = listJobs({ status: "queued", type: "submit_transfer" });
      assert.ok(jobs.jobs.find((job) => job.id === result.payment.transferJobId));

      const ran = await runDueJobs({ limit: 50 });
      assert.ok(ran.ran.find((item) => item.job.id === result.payment.transferJobId));
      assert.equal(result.payment.status, "settled");
    }
  ],
  [
    "lists policy-gated DeFi tools",
    async () => {
      const tools = listDefiTools();

      assert.equal(tools.ok, true);
      assert.ok(tools.protocols.find((protocol) => protocol.id === "lifi"));
      assert.ok(tools.protocols.find((protocol) => protocol.id === "polymarket"));
      assert.ok(tools.protocols.find((protocol) => protocol.id === "hyperliquid"));
    }
  ],
  [
    "auto-runs LI.FI swap routes without approval prompts",
    async () => {
      const quoted = await quoteDefiRoute({
        handle: "@sara",
        fromRail: "arc-testnet",
        toRail: "arc-testnet",
        type: "swap",
        amount: 5,
        fromToken: "USDC",
        toToken: "ETH",
        slippage: 0.005
      });

      assert.equal(quoted.ok, true);
      assert.equal(quoted.action.protocol, "lifi");
      assert.equal(quoted.action.status, "execution_not_enabled");
      assert.equal(quoted.action.approvalId, undefined);
      assert.equal(quoted.action.execution.backendSignerAllowed, false);
      assert.equal(quoted.quote.provider, "lifi");
      assert.equal(quoted.quote.mode, "mock");
      assert.equal(quoted.nextAction, "display_receipt");
    }
  ],
  [
    "resolves Arc cirBTC aliases for swap quotes",
    async () => {
      const quoted = await quoteDefiRoute({
        handle: "@sara",
        fromRail: "arc-testnet",
        toRail: "arc-testnet",
        type: "swap",
        amount: 0.001,
        fromToken: "cirBTC",
        toToken: "USDC",
        slippage: 0.005
      });

      assert.equal(quoted.ok, true);
      assert.equal(quoted.action.request.fromToken, "cirBTC");
      assert.equal(quoted.quote.request.fromToken, "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF");
      assert.equal(quoted.quote.request.fromAmount, "100000");
    }
  ],
  [
    "queues DeFi execution immediately after a route is created",
    async () => {
      const quoted = await quoteDefiRoute({
        handle: "@sara",
        fromRail: "arc-testnet",
        toRail: "arc-testnet",
        type: "swap",
        amount: 4,
        fromToken: "USDC",
        toToken: "ETH",
        slippage: 0.005
      });

      assert.equal(quoted.ok, true);
      assert.equal(quoted.action.status, "execution_not_enabled");
      assert.ok(quoted.action.executionJobId);
      assert.equal(quoted.action.signer.backendSignerAllowed, false);
      assert.equal(quoted.action.execution.backendSignerAllowed, false);
      assert.match(quoted.action.execution.reason, /DEFI_EXECUTION_ENABLED/);

      const confirmed = await confirmDefiAction({
        actionId: quoted.action.id,
        handle: "@sara"
      });
      assert.equal(confirmed.skipped, true);
    }
  ],
  [
    "reports swap and bridge execution readiness without enabling backend signing",
    async () => {
      const previous = {
        executionEnabled: config.defi.executionEnabled,
        liveAdapters: config.defi.liveAdapters,
        apiKey: config.circle.apiKey,
        entitySecret: config.circle.entitySecret
      };

      try {
        config.defi.executionEnabled = true;
        config.defi.liveAdapters = true;
        config.circle.apiKey = "TEST_API_KEY";
        config.circle.entitySecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

        const readiness = getDefiExecutionReadiness();
        assert.equal(readiness.ready, true);
        assert.equal(readiness.provider, "circle_contract_execution");
        assert.equal(readiness.backendSignerAllowed, false);
        assert.deepEqual(readiness.blockers, []);
      } finally {
        config.defi.executionEnabled = previous.executionEnabled;
        config.defi.liveAdapters = previous.liveAdapters;
        config.circle.apiKey = previous.apiKey;
        config.circle.entitySecret = previous.entitySecret;
      }
    }
  ],
  [
    "reconciles DeFi actions and builds public receipts",
    async () => {
      const quoted = await quoteDefiRoute({
        handle: "@sara",
        fromRail: "arc-testnet",
        toRail: "base-sepolia",
        type: "bridge",
        amount: 2,
        fromToken: "USDC",
        toToken: "USDC",
        slippage: 0.005
      });

      quoted.action.status = "submitted";
      quoted.action.execution = {
        provider: "test",
        mode: "test",
        backendSignerAllowed: false,
        submissions: [{
          providerTransactionId: "tx_test_001",
          status: "submitted",
          txHash: "0xabc123",
          refId: `${quoted.action.id}:route`
        }],
        txHash: "0xabc123"
      };

      const job = enqueueJob({
        type: "reconcile_defi_action",
        payload: { actionId: quoted.action.id },
        idempotencyKey: `test_reconcile:${quoted.action.id}`
      });
      const ran = await runJob({ jobId: job.id });
      assert.equal(ran.ok, true);
      assert.equal(quoted.action.status, "submitted");
      assert.equal(quoted.action.execution.skipped, true);
      assert.equal(quoted.action.execution.backendSignerAllowed, false);

      const receipt = getDefiActionReceipt({
        actionId: quoted.action.id,
        host: "localhost:4319"
      });
      assert.equal(receipt.ok, true);
      assert.equal(receipt.receipt.publicUrl, `http://localhost:4319/defi/actions/${quoted.action.id}`);
      assert.equal(receipt.receipt.explorerUrl, "https://testnet.arcscan.app/tx/0xabc123");
      assert.equal(receipt.receipt.nextAction, "reconcile_defi_action");
    }
  ],
  [
    "rejects DeFi actions over the configured risk limit",
    async () => {
      const quoted = await quoteDefiRoute({
        handle: "@sara",
        fromRail: "arc-testnet",
        toRail: "arc-testnet",
        type: "swap",
        amount: config.defi.maxActionUsd + 1,
        fromToken: "USDC",
        toToken: "ETH",
        slippage: 0.005
      });

      assert.equal(quoted.ok, false);
      assert.equal(quoted.action.status, "rejected");
      assert.match(quoted.policy.reason, /Amount exceeds/);
    }
  ],
  [
    "supports read-only Polymarket and Hyperliquid discovery actions",
    async () => {
      const markets = await searchPredictionMarkets({ handle: "@sara", query: "bitcoin", limit: 1 });
      const perps = await listPerpMarkets({ handle: "@sara", limit: 1 });
      const actions = listDefiActions({ handle: "@sara" });

      assert.equal(markets.ok, true);
      assert.equal(markets.provider, "polymarket");
      assert.equal(perps.ok, true);
      assert.equal(perps.provider, "hyperliquid");
      assert.ok(actions.actions.find((action) => action.protocol === "polymarket"));
      assert.ok(actions.actions.find((action) => action.protocol === "hyperliquid"));
    }
  ],
  [
    "exposes core Arc/Circle MCP money tools with approval routing",
    async () => {
      const names = mcpTools.map((tool) => tool.name);
      for (const name of ["create_wallet", "get_balance", "get_wallet_capabilities", "send_usdc", "create_airdrop", "award_airdrop", "list_airdrops", "get_airdrop_receipt", "list_arc_trading_primitives", "bridge_usdc", "demo_bridge_arc_to_base", "quote_swap", "list_approvals", "confirm_action", "get_receipt", "list_defi_actions", "reconcile_defi_action", "get_defi_action_receipt"]) {
        assert.ok(names.includes(name), `${name} missing`);
      }

      const wallet = await callMcpTool("create_wallet", { handle: "@mcpdayone" });
      assert.equal(wallet.ok, true);
      assert.ok(wallet.wallet.wallets.find((item) => item.rail === "arc-testnet"));

      const capabilities = await callMcpTool("get_wallet_capabilities", { handle: "@mcpdayone" });
      assert.equal(capabilities.ok, true);
      assert.equal(capabilities.backendSignerAllowed, false);
      assert.equal(capabilities.signerModel, "per-user-circle-wallet");

      const payment = await callMcpTool("send_usdc", {
        senderHandle: "@sara",
        recipientHandle: "@bob",
        amount: 12,
        settlementRail: "arc-testnet",
        memo: "approval route"
      });
      assert.equal(payment.ok, true);
      assert.equal(payment.payment.status, "requires_confirmation");
      assert.ok(payment.payment.approvalId);
      assert.equal(payment.payment.signer.signerType, "circle_user_wallet");
      assert.equal(payment.payment.signer.backendSignerAllowed, false);

      const confirmed = await callMcpTool("confirm_action", {
        approvalId: payment.payment.approvalId,
        handle: "@sara"
      });
      assert.equal(confirmed.ok, true);
      assert.equal(confirmed.approval.status, "approved");
      assert.equal(payment.payment.status, "queued");

      const receipt = await callMcpTool("get_receipt", { paymentId: payment.payment.id });
      assert.equal(receipt.ok, true);
      assert.equal(receipt.receipt.payment.id, payment.payment.id);

      const airdrop = await callMcpTool("create_airdrop", {
        senderHandle: "@sara",
        recipients: ["@alice"],
        amountPerRecipient: 1,
        settlementRail: "arc-testnet"
      });
      assert.equal(airdrop.ok, true);
      assert.equal(airdrop.airdrop.status, "distributed");
      assert.equal(airdrop.airdrop.signer.backendSignerAllowed, false);

      const primitives = await callMcpTool("list_arc_trading_primitives", {});
      assert.equal(primitives.ok, true);
      for (const name of ["swap", "bridge", "perps", "airdrop", "bounty", "automation"]) {
        assert.ok(primitives.primitives.find((primitive) => primitive.name === name), `${name} primitive missing`);
      }

      const bridge = await callMcpTool("bridge_usdc", {
        handle: "@sara",
        amount: 3,
        fromRail: "arc-testnet",
        toRail: "base-sepolia"
      });
      assert.equal(bridge.ok, true);
      assert.equal(bridge.action.type, "bridge");
      assert.equal(bridge.action.status, "execution_not_enabled");
      assert.equal(bridge.action.approvalId, undefined);
      assert.equal(bridge.action.signer.backendSignerAllowed, false);

      const demoBridge = await callMcpTool("demo_bridge_arc_to_base", {
        handle: "@mcpdayone",
        amount: 2
      });
      assert.equal(demoBridge.ok, true);
      assert.equal(demoBridge.backendSignerAllowed, false);
      assert.equal(demoBridge.wallet.handle, "@mcpdayone");
      assert.equal(demoBridge.quote.action.type, "bridge");
      assert.equal(demoBridge.approvalId, null);
      assert.equal(demoBridge.quote.action.status, "execution_not_enabled");

      const defiActions = await callMcpTool("list_defi_actions", {
        handle: "@mcpdayone",
        limit: 5
      });
      assert.equal(defiActions.ok, true);
      assert.ok(defiActions.actions.find((action) => action.id === demoBridge.quote.action.id));

      const defiReceipt = await callMcpTool("get_defi_action_receipt", {
        actionId: demoBridge.quote.action.id,
        host: "localhost:4319"
      });
      assert.equal(defiReceipt.ok, true);
      assert.equal(defiReceipt.receipt.publicUrl, `http://localhost:4319/defi/actions/${demoBridge.quote.action.id}`);

      const reconciled = await callMcpTool("reconcile_defi_action", {
        actionId: demoBridge.quote.action.id
      });
      assert.equal(reconciled.ok, true);
      assert.equal(reconciled.result.skipped, true);
    }
  ],
  [
    "exposes MCP automations for recurring wallet and agent work",
    async () => {
      const names = mcpTools.map((tool) => tool.name);
      for (const name of [
        "create_automation",
        "list_automations",
        "run_automation",
        "run_due_automations",
        "pause_automation",
        "resume_automation",
        "delete_automation"
      ]) {
        assert.ok(names.includes(name), `${name} missing`);
      }

      await callMcpTool("create_wallet", { handle: "@automator" });
      const created = await callMcpTool("create_automation", {
        handle: "@automator",
        kind: "sync_circle_balances",
        intervalMinutes: 1,
        nextRunAt: new Date(Date.now() - 1_000).toISOString()
      });
      assert.equal(created.ok, true);
      assert.equal(created.automation.kind, "sync_circle_balances");
      assert.equal(created.automation.status, "active");
      assert.equal(created.automation.handle, "@automator");

      const listed = await callMcpTool("list_automations", { handle: "@automator" });
      assert.equal(listed.ok, true);
      assert.ok(listed.automations.find((automation) => automation.id === created.automation.id));

      const paused = await callMcpTool("pause_automation", { automationId: created.automation.id });
      assert.equal(paused.automation.status, "paused");
      const resumed = await callMcpTool("resume_automation", { automationId: created.automation.id });
      assert.equal(resumed.automation.status, "active");

      const due = await callMcpTool("run_due_automations", { limit: 10 });
      const ran = due.ran.find((result) => result.automation.id === created.automation.id);
      assert.ok(ran);
      assert.equal(ran.ok, true);
      assert.equal(ran.automation.runCount, 1);
      assert.ok(new Date(ran.automation.nextRunAt).getTime() > Date.now());

      const manual = await callMcpTool("run_automation", { automationId: created.automation.id });
      assert.equal(manual.ok, true);
      assert.equal(manual.automation.runCount, 2);

      const deleted = await callMcpTool("delete_automation", { automationId: created.automation.id });
      assert.equal(deleted.ok, true);
      const afterDelete = await callMcpTool("list_automations", { handle: "@automator" });
      assert.equal(afterDelete.automations.some((automation) => automation.id === created.automation.id), false);
    }
  ],
  [
    "creates copy trading and perps proposals as approvals",
    async () => {
      const copy = await callMcpTool("propose_copy_trade", {
        handle: "@sara",
        traderHandle: "@macro_mira",
        capitalUsd: 50,
        riskProfile: "balanced"
      });
      assert.equal(copy.ok, true);
      assert.equal(copy.proposal.status, "requires_confirmation");
      assert.ok(copy.approval.id);
      assert.equal(copy.proposal.signer.backendSignerAllowed, false);

      const risk = await callMcpTool("assess_liquidation_risk", {
        handle: "@sara",
        symbol: "BTC",
        side: "long",
        collateralUsd: 20,
        leverage: 2
      });
      assert.equal(risk.ok, true);
      assert.equal(risk.assessment.symbol, "BTC");

      const perp = await callMcpTool("propose_perp_trade", {
        handle: "@sara",
        symbol: "BTC",
        side: "long",
        collateralUsd: 20,
        leverage: 2
      });
      assert.equal(perp.ok, true);
      assert.equal(perp.proposal.status, "requires_confirmation");
      assert.ok(perp.approval.id);
      assert.equal(perp.proposal.signer.backendSignerAllowed, false);

      const approvals = listApprovals({ handle: "@sara", status: "pending" });
      assert.ok(approvals.approvals.find((approval) => approval.kind === "copy_trade"));
      assert.ok(approvals.approvals.find((approval) => approval.kind === "perp_trade"));

      const confirmed = await callMcpTool("confirm_action", {
        approvalId: perp.approval.id,
        handle: "@sara"
      });
      assert.equal(confirmed.ok, true);
      assert.equal(confirmed.result.proposal.status, "confirmed");
      assert.equal(confirmed.result.job.type, "execute_perp_proposal");

      const executionEnabled = config.arcPerps.executionEnabled;
      config.arcPerps.executionEnabled = false;
      const execution = await runJob({ jobId: confirmed.result.job.id });
      config.arcPerps.executionEnabled = executionEnabled;
      assert.equal(execution.ok, true);
      assert.equal(confirmed.result.proposal.status, "user_wallet_signing_required");
      assert.equal(confirmed.result.proposal.execution.backendSignerAllowed, false);
    }
  ],
  [
    "exposes ArcPerps Lite settlement tools and quotes",
    async () => {
      const names = mcpTools.map((tool) => tool.name);
      for (const name of [
        "arc_perps_readiness",
        "arc_perps_status",
        "quote_arc_perp_position",
        "read_arc_perps_oracle_price",
        "get_arc_perps_position",
        "list_arc_perps_positions",
        "open_arc_perp_user_position",
        "close_arc_perp_user_position",
        "sync_arc_perps_oracle"
      ]) {
        assert.ok(names.includes(name), `${name} missing`);
      }

      const readiness = getArcPerpsReadiness();
      assert.equal(readiness.rail, "arc-testnet");
      assert.equal(readiness.maxLeverage, config.arcPerps.maxLeverage);
      assert.equal(readiness.backendSignerAllowed, false);

      const status = await getArcPerpsStatus();
      assert.equal(status.rail, "arc-testnet");
      assert.ok(Array.isArray(status.missing));

      const quote = await quoteArcPerpPosition({
        symbol: "BTC",
        side: "long",
        marginUsd: 20,
        leverage: 2,
        markPrice: 100000
      });
      assert.equal(quote.ok, true);
      assert.equal(quote.quote.settlement, "ArcPerpsVault");
      assert.equal(quote.quote.notionalUsd, 40);
      assert.equal(quote.quote.entryPrice, 100000);
      assert.ok(quote.quote.liquidationPrice < quote.quote.entryPrice);

      const mcpQuote = await callMcpTool("quote_arc_perp_position", {
        symbol: "ETH",
        side: "short",
        marginUsd: 10,
        leverage: 2,
        markPrice: 3000
      });
      assert.equal(mcpQuote.ok, true);
      assert.ok(mcpQuote.quote.liquidationPrice > mcpQuote.quote.entryPrice);

      const userOpen = await callMcpTool("open_arc_perp_user_position", {
        handle: "@sara",
        symbol: "BTC",
        side: "long",
        marginUsd: 1,
        leverage: 2
      });
      assert.equal(userOpen.ok, false);
      assert.equal(userOpen.backendSignerAllowed, false);
      assert.equal(userOpen.status, "user_wallet_signing_required");

      const oracleSync = await callMcpTool("sync_arc_perps_oracle", { symbols: ["BTC"] });
      assert.equal(oracleSync.ok, false);
      assert.equal(oracleSync.skipped, true);
    }
  ],
  [
    "exposes Arc App Kit MCP server tools with execution gates",
    async () => {
      const names = mcpTools.map((tool) => tool.name);
      for (const name of [
        "appkit_readiness",
        "list_appkit_capabilities",
        "appkit_estimate_send",
        "appkit_send_usdc",
        "appkit_estimate_bridge",
        "appkit_bridge_usdc",
        "appkit_estimate_swap",
        "appkit_swap",
        "appkit_unified_balance"
      ]) {
        assert.ok(names.includes(name), `${name} missing`);
      }

      const readiness = await callMcpTool("appkit_readiness", {});
      assert.ok(Array.isArray(readiness.rails));
      assert.equal(readiness.backendSignerAllowed, false);
      assert.ok(readiness.rails.find((rail) => rail.id === "arc-testnet" && rail.supportedByAppKit.bridge && rail.supportedByAppKit.swap));

      const capabilities = await callMcpTool("list_appkit_capabilities", {});
      assert.equal(capabilities.capabilities.length, 3);
      assert.ok(capabilities.capabilities.find((capability) => capability.operation === "bridge_or_swap_quote"));

      const response = await callMcpTool("appkit_send_usdc", {
          settlementRail: "arc-testnet",
          recipientAddress: "0x0000000000000000000000000000000000000001",
          amount: 1
      });
      assert.equal(response.ok, false);
      assert.equal(response.backendSignerAllowed, false);
      assert.equal(response.signer.backendSignerAllowed, false);
      assert.equal(response.status, "user_wallet_signing_required");
    }
  ],
  [
    "does not advertise backend signer execution through MCP",
    async () => {
      const names = mcpTools.map((tool) => tool.name);
      for (const name of [
        "x_reply_readiness",
        "post_x_command_reply",
        "rank_social_traders",
        "search_prediction_markets"
      ]) {
        assert.equal(names.includes(name), false, `${name} should not be exposed`);
      }

      for (const name of [
        "set_arc_perps_oracle_price",
        "set_arc_perps_market",
        "approve_arc_perps_usdc",
        "deposit_arc_perps_margin",
        "withdraw_arc_perps_margin",
        "provide_arc_perps_liquidity",
        "open_arc_perp_position",
        "close_arc_perp_position"
      ]) {
        assert.equal(names.includes(name), false, `${name} should not be exposed`);
      }

      const descriptions = mcpTools.map((tool) => tool.description.toLowerCase()).join("\n");
      assert.equal(descriptions.includes("settlement signer funds"), false);
      assert.equal(descriptions.includes("backend-signer tools"), false);
    }
  ],
  [
    "plans natural-language agent actions without execution",
    async () => {
      const names = mcpTools.map((tool) => tool.name);
      assert.ok(names.includes("plan_agent_action"));
      assert.ok(names.includes("run_agent_action"));
      assert.ok(names.includes("list_agent_tools"));
      const agentTools = await callMcpTool("list_agent_tools", {});
      assert.equal(agentTools.tools.includes("create_wallet"), false);
      for (const name of [
        "get_balance",
        "sync_circle_balances",
        "list_approvals",
        "get_defi_action_receipt",
        "propose_copy_trade",
        "create_airdrop",
        "list_arc_trading_primitives",
        "arc_perps_readiness",
        "appkit_readiness",
        "list_perp_markets",
        "close_arc_perp_user_position"
      ]) {
        assert.ok(agentTools.tools.includes(name), `${name} missing from terminal agent tools`);
      }
      assert.equal(agentTools.tools.includes("rank_social_traders"), false);
      assert.equal(agentTools.tools.includes("search_prediction_markets"), false);

      const send = planAgentAction({
        handle: "@sara",
        text: "send 10 usdc to @alice"
      });
      assert.equal(send.plan.tool, "send_usdc");
      assert.equal(send.plan.canExecuteNow, true);
      assert.equal(send.signer.signerType, "circle_user_wallet");
      assert.equal(send.signer.backendSignerAllowed, false);

      const bridge = planAgentAction({
        handle: "@sara",
        text: "bridge 5 usdc from arc to base"
      });
      assert.equal(bridge.plan.tool, "quote_defi_route");
      assert.equal(bridge.plan.canExecuteNow, true);
      assert.equal(bridge.plan.requiresConfirmation, false);
      assert.equal(bridge.signer.executionStatus, "policy_checked");
      assert.equal(bridge.signer.requiresUserApproval, false);
      assert.equal(bridge.signer.backendSignerAllowed, false);
      assert.equal(bridge.intent.fromToken, "USDC");
      assert.equal(bridge.plan.arguments.fromToken, "USDC");

      const tokenBridge = planAgentAction({
        handle: "@sara",
        text: "bridge 5 EURC from arc to base"
      });
      assert.equal(tokenBridge.plan.tool, "quote_defi_route");
      assert.equal(tokenBridge.intent.fromToken, "EURC");
      assert.equal(tokenBridge.intent.toToken, "EURC");
      assert.equal(tokenBridge.plan.arguments.fromToken, "EURC");
      assert.equal(tokenBridge.plan.arguments.toToken, "EURC");

      const reverseSwap = planAgentAction({
        handle: "@sara",
        text: "swap $20 EURC to USDC"
      });
      assert.equal(reverseSwap.plan.tool, "quote_defi_route");
      assert.equal(reverseSwap.intent.fromToken, "EURC");
      assert.equal(reverseSwap.intent.toToken, "USDC");
      assert.equal(reverseSwap.plan.arguments.fromToken, "EURC");
      assert.equal(reverseSwap.plan.arguments.toToken, "USDC");

      const naturalSwap = planAgentAction({
        handle: "@sara",
        text: "swap $1 of USDC to EURC"
      });
      assert.equal(naturalSwap.plan.tool, "quote_defi_route");
      assert.equal(naturalSwap.intent.fromToken, "USDC");
      assert.equal(naturalSwap.intent.toToken, "EURC");
      assert.equal(naturalSwap.plan.arguments.fromToken, "USDC");
      assert.equal(naturalSwap.plan.arguments.toToken, "EURC");

      const providerResolvedSwap = planAgentAction({
        handle: "@sara",
        text: "swap $1 WETH to USDC on arc"
      });
      assert.equal(providerResolvedSwap.plan.tool, "quote_defi_route");
      assert.equal(providerResolvedSwap.intent.fromToken, "WETH");
      assert.equal(providerResolvedSwap.intent.toToken, "USDC");

      const cirBtcSwap = planAgentAction({
        handle: "@sara",
        text: "swap $1 USDC to cirBTC on arc"
      });
      assert.equal(cirBtcSwap.plan.tool, "quote_defi_route");
      assert.equal(cirBtcSwap.intent.fromToken, "USDC");
      assert.equal(cirBtcSwap.intent.toToken, "cirBTC");
      assert.equal(cirBtcSwap.plan.arguments.toToken, "cirBTC");

      const planned = await callMcpTool("plan_agent_action", {
        handle: "@sara",
        text: "long btc with $5 at 2x"
      });
      assert.equal(planned.plan.tool, "propose_perp_trade");
      assert.equal(planned.signer.backendSignerAllowed, false);

      const closePerp = planAgentAction({
        handle: "@sara",
        text: "close arc perp position #42"
      });
      assert.equal(closePerp.plan.tool, "close_arc_perp_user_position");
      assert.equal(closePerp.plan.arguments.positionId, 42);
      assert.equal(closePerp.signer.backendSignerAllowed, false);

      const balance = planAgentAction({
        handle: "@sara",
        text: "show my balance"
      });
      assert.equal(balance.plan.tool, "get_balance");
      assert.equal(balance.plan.risk, "low");

      const appKit = planAgentAction({
        handle: "@sara",
        text: "appkit readiness"
      });
      assert.equal(appKit.plan.tool, "appkit_readiness");

      const copy = planAgentAction({
        handle: "@sara",
        text: "copy trade @macro_mira with $50"
      });
      assert.equal(copy.plan.tool, "propose_copy_trade");
      assert.equal(copy.plan.arguments.traderHandle, "@macro_mira");

      const airdrop = planAgentAction({
        handle: "@sara",
        text: "airdrop $1 to @alice @bob"
      });
      assert.equal(airdrop.plan.tool, "create_airdrop");
      assert.deepEqual(airdrop.plan.arguments.recipients, ["@alice", "@bob"]);
      assert.equal(airdrop.signer.backendSignerAllowed, false);

      const primitivePlan = planAgentAction({
        handle: "@sara",
        text: "list arc trading primitives"
      });
      assert.equal(primitivePlan.plan.tool, "list_arc_trading_primitives");
    }
  ],
  [
    "runs natural-language agent actions through policy-gated tools",
    async () => {
      const payment = await runAgentAction({
        handle: "@sara",
        text: "send 2 usdc to @bob",
        source: "test-agent-run"
      });
      assert.equal(payment.ok, true);
      assert.equal(payment.planned.plan.tool, "send_usdc");
      assert.equal(payment.result.payment.status, "queued");
      assert.equal(payment.signer.signerType, "circle_user_wallet");
      assert.equal(payment.signer.backendSignerAllowed, false);

      const bridge = await callMcpTool("run_agent_action", {
        handle: "@sara",
        text: "bridge 5 usdc from arc to base",
        source: "test-agent-run"
      });
      assert.equal(bridge.ok, false);
      assert.equal(bridge.planned.plan.tool, "quote_defi_route");
      assert.equal(bridge.result.action.status, "execution_not_enabled");
      assert.equal(bridge.execution.status, "execution_not_enabled");
      assert.equal(bridge.execution.ok, false);
      assert.equal(bridge.result.action.approvalId, undefined);
      assert.equal(bridge.signer.backendSignerAllowed, false);
      assert.equal(bridge.nextAction, "enable_execution_or_check_provider");

      const balance = await callMcpTool("run_agent_action", {
        handle: "@sara",
        text: "show my balance"
      });
      assert.equal(balance.ok, true);
      assert.equal(balance.planned.plan.tool, "get_balance");
      assert.equal(balance.result.wallet.handle, "@sara");

      const airdrop = await callMcpTool("run_agent_action", {
        handle: "@sara",
        text: "airdrop $1 to @alice @bob",
        source: "test-agent-run",
        idempotencyKey: "test_agent_airdrop_001"
      });
      assert.equal(airdrop.ok, true);
      assert.equal(airdrop.planned.plan.tool, "create_airdrop");
      assert.equal(airdrop.result.airdrop.status, "distributed");
      assert.equal(airdrop.result.airdrop.signer.backendSignerAllowed, false);

      const readiness = await callMcpTool("run_agent_action", {
        handle: "@sara",
        text: "appkit readiness"
      });
      assert.equal(readiness.ok, true);
      assert.equal(readiness.planned.plan.tool, "appkit_readiness");
      assert.equal(readiness.result.backendSignerAllowed, false);

      const closePerp = await callMcpTool("run_agent_action", {
        handle: "@sara",
        text: "close arc perp position #42",
        source: "test-agent-run"
      });
      assert.equal(closePerp.ok, false);
      assert.equal(closePerp.planned.plan.tool, "close_arc_perp_user_position");
      assert.equal(closePerp.execution.status, "user_wallet_signing_required");
      assert.equal(closePerp.execution.ok, false);
      assert.equal(closePerp.signer.backendSignerAllowed, false);
      assert.match(closePerp.execution.reason, /user wallet|Circle user wallet|Set ARC_PERPS/i);

      const unclear = await callMcpTool("run_agent_action", {
        handle: "@sara",
        text: "do something smart with my bags"
      });
      assert.equal(unclear.ok, false);
      assert.equal(unclear.status, "clarification_required");
      assert.equal(unclear.signer.backendSignerAllowed, false);
    }
  ],
  [
    "binds MCP API keys to the user's own wallet handle",
    async () => {
      users.get("@sara").mcpApiKeys = [];
      const created = createMcpApiKey({ handle: "@sara", name: "Cursor" });
      assert.equal(created.ok, true);
      assert.ok(created.secret.startsWith("bunos_mcp_"));
      assert.equal(created.apiKey.name, "Cursor");
      assert.equal(listMcpApiKeys("@sara").length, 1);

      const auth = authenticateMcpApiKey(`Bearer ${created.secret}`);
      assert.equal(auth.handle, "@sara");
      assert.equal(listMcpApiKeys("@sara")[0].lastUsedAt !== null, true);

      const scoped = applyMcpApiKeyContext("send_usdc", {
        senderHandle: "@bob",
        recipientHandle: "@alice",
        amount: 1
      }, auth);
      assert.equal(scoped.senderHandle, "@sara");
      assert.equal(scoped.handle, "@sara");

      const revoked = revokeMcpApiKey({ handle: "@sara", keyId: created.apiKey.id });
      assert.equal(revoked.ok, true);
      assert.equal(authenticateMcpApiKey(created.secret), null);
    }
  ]
];

let passed = 0;

for (const [name, run] of tests) {
  try {
    await run();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode !== 1) {
  console.log(`${passed}/${tests.length} tests passed`);
}

async function settleQueuedPayment(payment) {
  assert.equal(payment.status, "queued");
  assert.ok(payment.transferJobId);
  const result = await runJob({ jobId: payment.transferJobId });
  assert.equal(result.ok, true);
  return result;
}
