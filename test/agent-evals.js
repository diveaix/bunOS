import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { config } from "../src/config.js";
import { ledger, users } from "../src/fixtures.js";
import { buildAgentContext, summarizeAgentContextForModel } from "../src/agentContext.js";
import {
  assessAgentContextFacts,
  contextFact,
  selectAgentContextFacts
} from "../src/agentContextFacts.js";
import {
  executeAgentPlan,
  planAgentAction,
  planAgentActionWithModel,
  resumeAgentWorkflowsFromMonitor,
  runAgentAction
} from "../src/agentPlanner.js";
import { validateAgentPlanContract } from "../src/agentPlanGuard.js";
import { normalizeModelIntent } from "../src/modelPlanner.js";
import {
  cancelAgentWorkflow,
  createAgentWorkflow,
  findAgentWorkflowsForExecutionTarget,
  getAgentWorkflow,
  listAgentWorkflows,
  runAgentWorkflow
} from "../src/agentWorkflow.js";
import {
  buildPendingIntent,
  getAgentWorkingMemory,
  rememberAgentTurn
} from "../src/agentWorkingMemory.js";
import { observeAgentExecution } from "../src/agentHarness.js";

const BASE_CONFIG = {
  providerMode: config.providerMode,
  transferProvider: config.transferProvider,
  xReplyEnabled: config.x.replyEnabled,
  defiLiveAdapters: config.defi.liveAdapters,
  defiExecutionEnabled: config.defi.executionEnabled,
  aiEnabled: config.ai.enabled
};

const MUTABLE_LEDGER_KEYS = [
  "payments",
  "claims",
  "funding",
  "bridges",
  "events",
  "xWebhooks",
  "xCommands",
  "circleWebhooks",
  "jobs",
  "automations",
  "defiActions",
  "approvals",
  "securityLocks",
  "rateLimits",
  "agentObservability",
  "agentWorkflows",
  "copyTradeProposals",
  "perpProposals",
  "airdrops"
];

const USER_FACING_FORBIDDEN = [
  /\bbackend\b/i,
  /\bprovider stack\b/i,
  /\bfallback\b/i,
  /\bLI\.FI\b/i,
  /\bAppKit\b/i,
  /\bprivate key\b/i,
  /\bsettlement signer\b/i,
  /\brouteCapability\b/i,
  /\bpolicy engine\b/i,
  /\bworker\b/i
];

const planCases = [
  {
    name: "automation capability question is not treated as creation",
    text: "what automations can you run?",
    expect: {
      parser: "conversation_intent",
      tool: "answer_agent_question",
      arguments: {
        questionKind: "automation_capabilities",
        topic: "automation"
      }
    }
  },
  {
    name: "explicit automation status lists automations",
    text: "automation update?",
    expect: {
      parser: "deterministic_tool_command",
      tool: "list_automations"
    }
  },
  {
    name: "automation pause question is read-only",
    text: "why was the automation paused?",
    expect: {
      parser: "conversation_intent",
      tool: "answer_agent_question",
      arguments: {
        questionKind: "automation_status",
        topic: "automation"
      }
    }
  },
  {
    name: "token capability question reads routes instead of quoting",
    text: "what tokens can you swap?",
    expect: {
      parser: "conversation_intent",
      tool: "answer_agent_question",
      arguments: {
        questionKind: "swap_capabilities",
        topic: "swap"
      }
    }
  },
  {
    name: "follow-up usage question inherits swap topic",
    text: "how to use this?",
    conversation: [
      {
        role: "assistant",
        content: "Right now I can try these live swaps: USDC to EURC on Arc."
      }
    ],
    expect: {
      parser: "conversation_intent",
      tool: "answer_agent_question",
      arguments: {
        questionKind: "how_to",
        topic: "swap"
      }
    }
  },
  {
    name: "outcome language maps to swap tool",
    text: "get me EURC using 1 USDC on arc",
    expect: {
      parser: "deterministic_swap",
      tool: "quote_defi_route",
      arguments: {
        type: "swap",
        fromToken: "USDC",
        toToken: "EURC",
        fromRail: "arc-testnet",
        toRail: "arc-testnet",
        amount: 1
      }
    }
  },
  {
    name: "natural conversion language maps to swap tool",
    text: "turn my 1 USDC into some EURC on arc",
    expect: {
      parser: "deterministic_swap",
      tool: "quote_defi_route",
      arguments: {
        type: "swap",
        fromToken: "USDC",
        toToken: "EURC",
        amount: 1
      }
    }
  },
  {
    name: "pause all running automations maps to bulk pause",
    text: "pause all running automations",
    expect: {
      parser: "deterministic_tool_command",
      tool: "pause_automations"
    }
  },
  {
    name: "number-word bridge phrasing maps to USDC bridge",
    text: "move one dollar over to base",
    expect: {
      parser: "deterministic_bridge",
      tool: "quote_defi_route",
      arguments: {
        type: "bridge",
        amount: 1,
        fromToken: "USDC",
        toToken: "USDC",
        fromRail: "arc-testnet",
        toRail: "base-sepolia"
      }
    }
  },
  {
    name: "token alias swap phrasing maps to EURC swap",
    text: "turn a dollar into euro coin",
    expect: {
      parser: "deterministic_swap",
      tool: "quote_defi_route",
      arguments: {
        type: "swap",
        amount: 1,
        fromToken: "USDC",
        toToken: "EURC",
        fromRail: "arc-testnet",
        toRail: "arc-testnet"
      }
    }
  }
];

const runCases = [
  {
    name: "automation capability answer is read-only and plain",
    text: "what automations can you run?",
    assertResult(result) {
      assert.equal(result.ok, true);
      assert.equal(result.planned.plan.tool, "answer_agent_question");
      assert.equal(ledger.automations.length, 0);
      assert.match(result.summary, /only create one when you give me a clear schedule/i);
      assertNoBackendLeak(result.summary);
    }
  },
  {
    name: "automation pause question explains existing automation without creating a new one",
    text: "why was the automation paused?",
    before() {
      ledger.automations.push({
        id: "auto_paused_eval",
        handle: "@sara",
        name: "Swap EURC check",
        kind: "run_agent_action",
        status: "paused",
        intervalMs: 10_000,
        intervalMinutes: 0.167,
        maxRuns: 4,
        runCount: 1,
        nextRunAt: null,
        lastRunAt: new Date().toISOString(),
        lastResult: null,
        lastError: "This automation tried to create another automation. I paused it to prevent a runaway loop.",
        payload: {
          handle: "@sara",
          text: "swap 1 USDC to EURC",
          defaultSettlementRail: "arc-testnet"
        }
      });
    },
    assertResult(result) {
      assert.equal(result.ok, true);
      assert.equal(result.planned.plan.tool, "answer_agent_question");
      assert.equal(ledger.automations.length, 1);
      assert.match(result.summary, /paused because the saved automation text/i);
      assert.doesNotMatch(result.summary, /Automation saved/i);
      assertNoBackendLeak(result.summary);
    }
  },
  {
    name: "swap capability answer lists only live routes",
    text: "what tokens can you swap?",
    assertResult(result) {
      assert.equal(result.ok, true);
      assert.equal(result.result.topic, "swap");
      assert.match(result.summary, /USDC to EURC on Arc/i);
      assert.doesNotMatch(result.summary, /cirBTC/i);
      assertNoBackendLeak(result.summary);
    }
  },
  {
    name: "follow-up usage answer uses the previous route topic",
    text: "how to use this?",
    conversation: [
      {
        role: "assistant",
        content: "Right now I can try these live swaps: USDC to EURC on Arc."
      }
    ],
    assertResult(result) {
      assert.equal(result.ok, true);
      assert.equal(result.result.topic, "swap");
      assert.match(result.summary, /For swaps/i);
      assertNoBackendLeak(result.summary);
    }
  },
  {
    name: "unavailable cirBTC route fails closed before provider execution",
    text: "swap 1 USDC to cirBTC on arc",
    config: {
      defiLiveAdapters: true
    },
    assertResult(result) {
      assert.equal(result.ok, false);
      assert.equal(result.status, "quote_unavailable");
      assert.equal(result.execution.txHash, null);
      assert.match(result.summary, /No funds moved/i);
      assert.match(result.summary, /cirBTC route has not returned a live quote/i);
      assertNoBackendLeak(result.summary);
    }
  },
  {
    name: "route question does not create defi action",
    text: "what tokens can you swap?",
    assertResult(result) {
      assert.equal(result.ok, true);
      assert.equal(ledger.defiActions.length, 0);
      assert.equal(ledger.jobs.length, 0);
    }
  }
];

const contextCases = [
  {
    name: "context packet exposes live and blocked routes separately",
    async run() {
      resetLedger();
      configureOfflineHarness();
      config.defi.liveAdapters = true;
      const context = buildAgentContext({
        handle: "@sara",
        text: "can I swap USDC to EURC on Arc?",
        defaultSettlementRail: "arc-testnet"
      });
      assert.ok(context.routes.liveSwaps.some((route) => route.fromToken === "USDC" && route.toToken === "EURC"));
      assert.ok(context.routes.blockedRoutes.some((route) => route.toToken === "cirBTC"));
      assert.equal(context.policies.failClosedOnUnknownRoute, true);
      assert.equal(context.policies.neverUseBackendSigner, true);
    }
  },
  {
    name: "do it again repeats the last known swap without model",
    async run() {
      resetLedger();
      configureOfflineHarness();
      users.get("@sara").agentMemory = {
        riskProfile: "balanced",
        recentDecisions: [],
        recentFailures: [],
        lastTrade: {
          type: "swap",
          status: "settled",
          amount: 1,
          fromToken: "USDC",
          toToken: "EURC",
          fromRail: "arc-testnet",
          toRail: "arc-testnet"
        }
      };
      const planned = await planAgentActionWithModel({
        handle: "@sara",
        text: "do it again",
        source: "eval",
        useModel: false
      });
      assert.equal(planned.parser, "agent_context");
      assert.equal(planned.plan.tool, "quote_defi_route");
      assertPartial(planned.plan.arguments, {
        type: "swap",
        amount: 1,
        fromToken: "USDC",
        toToken: "EURC",
        fromRail: "arc-testnet"
      });
    }
  },
  {
    name: "failure follow-up reads memory instead of starting a new trade",
    async run() {
      resetLedger();
      configureOfflineHarness();
      users.get("@sara").agentMemory = {
        riskProfile: "balanced",
        recentDecisions: [],
        recentFailures: [
          {
            at: new Date().toISOString(),
            tool: "quote_defi_route",
            status: "quote_unavailable",
            reason: "No live route exists.",
            actionId: "defi_failed"
          }
        ],
        lastAction: {
          text: "swap 1 USDC to cirBTC on arc",
          tool: "quote_defi_route",
          status: "quote_unavailable",
          reason: "No live route exists."
        }
      };
      const planned = await planAgentActionWithModel({
        handle: "@sara",
        text: "why did that fail?",
        source: "eval",
        useModel: false
      });
      assert.equal(planned.parser, "agent_context");
      assert.equal(planned.plan.tool, "get_agent_memory");
      assert.equal(ledger.defiActions.length, 0);
    }
  },
  {
    name: "ambiguous close uses the only open perp position",
    async run() {
      resetLedger();
      configureOfflineHarness();
      ledger.perpProposals.push({
        id: "perp_1",
        handle: "@sara",
        status: "submitted",
        symbol: "BTC",
        side: "long",
        collateralUsd: 1,
        leverage: 2,
        positionId: 42,
        execution: {
          txHash: "0x1111111111111111111111111111111111111111111111111111111111111111"
        }
      });
      const planned = await planAgentActionWithModel({
        handle: "@sara",
        text: "close it",
        source: "eval",
        useModel: false
      });
      assert.equal(planned.parser, "agent_context");
      assert.equal(planned.plan.tool, "close_arc_perp_user_position");
      assert.equal(planned.plan.arguments.positionId, 42);
    }
  },
  {
    name: "ambiguous automation pause uses the active automation",
    async run() {
      resetLedger();
      configureOfflineHarness();
      ledger.automations.push({
        id: "auto_eval",
        handle: "@sara",
        name: "Eval automation",
        status: "active",
        intervalMs: 10_000,
        payload: {
          text: "sync balances"
        }
      });
      const planned = await planAgentActionWithModel({
        handle: "@sara",
        text: "pause that",
        source: "eval",
        useModel: false
      });
      assert.equal(planned.parser, "agent_context");
      assert.equal(planned.plan.tool, "pause_automation");
      assert.equal(planned.plan.arguments.automationId, "auto_eval");
    }
  },
  {
    name: "multiple open perps require clarification instead of choosing one",
    async run() {
      resetLedger();
      configureOfflineHarness();
      ledger.perpProposals.push(
        {
          id: "perp_1",
          handle: "@sara",
          status: "open",
          symbol: "BTC",
          side: "long",
          collateralUsd: 1,
          leverage: 2,
          positionId: 41
        },
        {
          id: "perp_2",
          handle: "@sara",
          status: "open",
          symbol: "ETH",
          side: "short",
          collateralUsd: 2,
          leverage: 2,
          positionId: 42
        }
      );
      const planned = await planAgentActionWithModel({
        handle: "@sara",
        text: "close it",
        source: "eval",
        useModel: false
      });
      assert.equal(planned.parser, "agent_context");
      assert.equal(planned.plan.tool, null);
      assert.match(planned.plan.reason, /Which position should I close/i);
      assert.equal(planned.contextMeta.topic, "perps");
    }
  },
  {
    name: "multiple active automations require clarification",
    async run() {
      resetLedger();
      configureOfflineHarness();
      ledger.automations.push(
        {
          id: "auto_one",
          handle: "@sara",
          name: "One",
          status: "active",
          intervalMs: 10_000
        },
        {
          id: "auto_two",
          handle: "@sara",
          name: "Two",
          status: "active",
          intervalMs: 20_000
        }
      );
      const planned = await planAgentActionWithModel({
        handle: "@sara",
        text: "pause that",
        source: "eval",
        useModel: false
      });
      assert.equal(planned.parser, "agent_context");
      assert.equal(planned.plan.tool, null);
      assert.match(planned.plan.reason, /Which one should I pause/i);
    }
  },
  {
    name: "swap model context excludes unrelated automation and perp state",
    async run() {
      resetLedger();
      configureOfflineHarness();
      ledger.automations.push({
        id: "auto_hidden",
        handle: "@sara",
        status: "active",
        intervalMs: 10_000
      });
      ledger.perpProposals.push({
        id: "perp_hidden",
        handle: "@sara",
        status: "open",
        symbol: "BTC",
        side: "long",
        positionId: 7
      });
      const context = buildAgentContext({
        handle: "@sara",
        text: "swap one dollar into euro coin",
        defaultSettlementRail: "arc-testnet"
      });
      const modelContext = summarizeAgentContextForModel(context);
      assert.equal(modelContext.conversation.topic, "swap");
      assert.ok(modelContext.routes.liveSwaps.length > 0);
      assert.equal(modelContext.openState, undefined);
      assert.ok(modelContext.contextMeta.included.includes("routes"));
      assert.ok(!modelContext.contextMeta.included.includes("openState"));
    }
  },
  {
    name: "automation model context excludes routes and wallet balances",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const context = buildAgentContext({
        handle: "@sara",
        text: "what automations can you run?",
        defaultSettlementRail: "arc-testnet"
      });
      const modelContext = summarizeAgentContextForModel(context);
      assert.equal(modelContext.conversation.topic, "automation");
      assert.equal(modelContext.routes, undefined);
      assert.equal(modelContext.wallet, undefined);
      assert.ok(Array.isArray(modelContext.openState.activeAutomations));
    }
  },
  {
    name: "model context is bounded and does not contain wallet addresses",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const conversation = Array.from({ length: 30 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        content: `message ${index} ${"x".repeat(800)}`
      }));
      const context = buildAgentContext({
        handle: "@sara",
        text: "what can you do?",
        conversation,
        defaultSettlementRail: "arc-testnet"
      });
      const modelContext = summarizeAgentContextForModel(context);
      const serialized = JSON.stringify(modelContext);
      assert.ok(serialized.length <= 12_500);
      assert.doesNotMatch(serialized, /0xSaraCircleWallet/i);
      assert.doesNotMatch(serialized, /walletSetId/i);
      assert.doesNotMatch(serialized, /privateKey/i);
      assert.ok(modelContext.contextMeta.estimatedChars <= 12_500);
    }
  },
  {
    name: "planner responses expose context metadata but not the full packet",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const planned = await planAgentActionWithModel({
        handle: "@sara",
        text: "what tokens can you swap?",
        source: "eval",
        useModel: false
      });
      assert.equal(planned.context, undefined);
      assert.equal(planned.contextMeta.topic, "swap");
      assert.ok(Array.isArray(planned.contextMeta.included));
    }
  },
  {
    name: "missing referenced state returns a specific clarification",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const cases = [
        ["close it", /do not see an open perp position/i],
        ["pause that", /do not see an active automation/i],
        ["approve it", /do not see a pending approval/i],
        ["do it again", /do not have a previous trade/i]
      ];
      for (const [text, expected] of cases) {
        const planned = await planAgentActionWithModel({
          handle: "@sara",
          text,
          source: "eval",
          useModel: false
        });
        assert.equal(planned.parser, "agent_context");
        assert.equal(planned.plan.tool, null);
        assert.match(planned.plan.reason, expected);
      }
    }
  },
  {
    name: "one pending approval resolves approve-it reference",
    async run() {
      resetLedger();
      configureOfflineHarness();
      ledger.approvals.push({
        id: "appr_eval",
        handle: "@sara",
        status: "pending",
        kind: "perp_trade",
        targetId: "perp_eval",
        title: "Open BTC long"
      });
      const planned = await planAgentActionWithModel({
        handle: "@sara",
        text: "approve it",
        source: "eval",
        useModel: false
      });
      assert.equal(planned.parser, "agent_context");
      assert.equal(planned.plan.tool, "confirm_action");
      assert.equal(planned.plan.arguments.approvalId, "appr_eval");
    }
  },
  {
    name: "pending swap survives refresh and fills amount on the next turn",
    async run() {
      resetLedger();
      configureOfflineHarness();
      seedPendingTurn({
        handle: "@sara",
        text: "swap some USDC to EURC",
        action: "quote_swap",
        draft: {
          fromToken: "USDC",
          toToken: "EURC",
          settlementRail: "arc-testnet"
        },
        missing: ["amount"],
        question: "How much USDC should I swap?"
      });

      const planned = await planAgentActionWithModel({
        handle: "@sara",
        text: "use 5 dollars",
        source: "eval",
        useModel: false,
        conversation: []
      });

      assert.equal(planned.parser, "agent_context");
      assert.equal(planned.plan.tool, "quote_defi_route");
      assert.equal(planned.plan.arguments.amount, 5);
      assert.equal(planned.plan.arguments.fromToken, "USDC");
      assert.equal(planned.plan.arguments.toToken, "EURC");
      assert.equal(planned.contextMeta.topic, "swap");
    }
  },
  {
    name: "partial follow-up keeps the task pending with a precise missing field",
    async run() {
      resetLedger();
      configureOfflineHarness();
      seedPendingTurn({
        handle: "@sara",
        text: "send some USDC",
        action: "send_payment",
        draft: { asset: "USDC" },
        missing: ["amount", "recipientHandle"],
        question: "How much, and to whom?"
      });

      const result = await runAgentAction({
        handle: "@sara",
        text: "send it to @alice",
        source: "eval",
        useModel: false,
        conversation: []
      });

      assert.equal(result.status, "clarification_required");
      assert.match(result.clarification, /still need the amount/i);
      const working = getAgentWorkingMemory("@sara");
      assert.equal(working.status, "awaiting_clarification");
      assert.equal(working.pendingClarification.draft.recipientHandle, "@alice");
      assert.deepEqual(working.pendingClarification.missing, ["amount"]);
    }
  },
  {
    name: "working memory is isolated by user handle",
    async run() {
      resetLedger();
      configureOfflineHarness();
      seedPendingTurn({
        handle: "@sara",
        text: "swap to EURC",
        action: "quote_swap",
        draft: {
          fromToken: "USDC",
          toToken: "EURC",
          settlementRail: "arc-testnet"
        },
        missing: ["amount"],
        question: "How much?"
      });

      const bob = await planAgentActionWithModel({
        handle: "@bob",
        text: "use 5 dollars",
        source: "eval",
        useModel: false,
        conversation: []
      });

      assert.notEqual(bob.plan.tool, "quote_defi_route");
      assert.equal(getAgentWorkingMemory("@bob").pendingClarification, null);
      assert.ok(getAgentWorkingMemory("@sara").pendingClarification);
    }
  },
  {
    name: "completed task clears stale clarification state",
    async run() {
      resetLedger();
      configureOfflineHarness();
      seedPendingTurn({
        handle: "@sara",
        text: "send some USDC to @alice",
        action: "send_payment",
        draft: {
          asset: "USDC",
          recipientHandle: "@alice"
        },
        missing: ["amount"],
        question: "How much?"
      });
      rememberAgentTurn({
        handle: "@sara",
        text: "use 3 dollars",
        planned: {
          text: "use 3 dollars",
          intent: {
            action: "send_payment",
            amount: 3,
            asset: "USDC",
            recipientHandle: "@alice"
          },
          plan: { tool: "send_usdc" }
        },
        result: { ok: true, status: "completed" },
        execution: { ok: true, status: "completed", ids: {} },
        narrative: { summary: "Payment completed." }
      });

      const working = getAgentWorkingMemory("@sara");
      assert.equal(working.status, "completed");
      assert.equal(working.pendingClarification, null);
      assert.match(working.objective, /send 3 USDC to @alice/i);
    }
  },
  {
    name: "model context carries compact working memory without private wallet data",
    async run() {
      resetLedger();
      configureOfflineHarness();
      seedPendingTurn({
        handle: "@sara",
        text: "open a BTC perp",
        action: "propose_perp_trade",
        draft: { symbol: "BTC" },
        missing: ["side", "collateralUsd", "leverage"],
        question: "Long or short, with how much collateral and leverage?"
      });
      const context = buildAgentContext({
        handle: "@sara",
        text: "make it long",
        conversation: []
      });
      const modelContext = summarizeAgentContextForModel(context);
      const serialized = JSON.stringify(modelContext);
      assert.equal(modelContext.workingMemory.status, "awaiting_clarification");
      assert.equal(modelContext.workingMemory.pendingClarification.draft.symbol, "BTC");
      assert.doesNotMatch(serialized, /walletSetId|privateKey|0xSaraCircleWallet/i);
    }
  },
  {
    name: "user can cancel an unfinished task naturally",
    async run() {
      resetLedger();
      configureOfflineHarness();
      seedPendingTurn({
        handle: "@sara",
        text: "swap to EURC",
        action: "quote_swap",
        draft: {
          fromToken: "USDC",
          toToken: "EURC",
          settlementRail: "arc-testnet"
        },
        missing: ["amount"],
        question: "How much?"
      });

      const result = await runAgentAction({
        handle: "@sara",
        text: "never mind",
        source: "eval",
        useModel: false,
        conversation: []
      });

      assert.equal(result.planned.plan.tool, "cancel_agent_task");
      assert.equal(result.result.status, "cancelled");
      assert.equal(getAgentWorkingMemory("@sara").status, "cancelled");
      assert.equal(getAgentWorkingMemory("@sara").pendingClarification, null);
      assert.equal(getAgentWorkingMemory("@sara").objective, null);
    }
  },
  {
    name: "clear new objective supersedes an unfinished task",
    async run() {
      resetLedger();
      configureOfflineHarness();
      seedPendingTurn({
        handle: "@sara",
        text: "swap to EURC",
        action: "quote_swap",
        draft: {
          fromToken: "USDC",
          toToken: "EURC",
          settlementRail: "arc-testnet"
        },
        missing: ["amount"],
        question: "How much?"
      });

      const result = await runAgentAction({
        handle: "@sara",
        text: "check my balance",
        source: "eval",
        useModel: false,
        conversation: []
      });

      assert.equal(result.planned.plan.tool, "get_balance");
      assert.equal(getAgentWorkingMemory("@sara").pendingClarification, null);
      assert.equal(getAgentWorkingMemory("@sara").topic, "wallet");
      assert.equal(getAgentWorkingMemory("@sara").objective, "Check the wallet balance.");
    }
  },
  {
    name: "user can correct a slot while the task is pending",
    async run() {
      resetLedger();
      configureOfflineHarness();
      seedPendingTurn({
        handle: "@sara",
        text: "swap USDC to EURC",
        action: "quote_swap",
        draft: {
          fromToken: "USDC",
          toToken: "EURC",
          settlementRail: "arc-testnet"
        },
        missing: ["amount"],
        question: "How much?"
      });

      const result = await runAgentAction({
        handle: "@sara",
        text: "actually use WETH instead",
        source: "eval",
        useModel: false,
        conversation: []
      });

      assert.equal(result.status, "clarification_required");
      const pending = getAgentWorkingMemory("@sara").pendingClarification;
      assert.equal(pending.draft.toToken, "WETH");
      assert.deepEqual(pending.missing, ["amount"]);
      assert.equal(getAgentWorkingMemory("@sara").topic, "swap");
    }
  },
  {
    name: "agent explains a pending task instead of repeating a generic prompt",
    async run() {
      resetLedger();
      configureOfflineHarness();
      seedPendingTurn({
        handle: "@sara",
        text: "open a BTC perp",
        action: "propose_perp_trade",
        draft: { symbol: "BTC" },
        missing: ["side", "collateralUsd", "leverage"],
        question: "Long or short, with how much collateral and leverage?"
      });

      const result = await runAgentAction({
        handle: "@sara",
        text: "why do you need that?",
        source: "eval",
        useModel: false,
        conversation: []
      });

      assert.equal(result.planned.plan.tool, "answer_agent_question");
      assert.match(result.result.answer, /do not guess with your money/i);
      assert.match(result.result.answer, /long or short/i);
      assert.ok(getAgentWorkingMemory("@sara").pendingClarification);
    }
  },
  {
    name: "bounded observer promotes a failed receipt without running its worker",
    async run() {
      resetLedger();
      configureOfflineHarness();
      ledger.defiActions.push({
        id: "defi_observe_failed",
        handle: "@sara",
        type: "swap",
        status: "confirmed",
        request: {
          amount: 1,
          fromToken: "USDC",
          toToken: "EURC",
          fromRail: "arc-testnet",
          toRail: "arc-testnet"
        },
        executionJobId: "job_observe_failed",
        createdAt: new Date().toISOString()
      });
      ledger.jobs.push({
        id: "job_observe_failed",
        type: "execute_defi_action",
        status: "failed",
        attempts: 2,
        maxAttempts: 2,
        lastError: "Execution reverted",
        updatedAt: new Date().toISOString()
      });

      const observed = await observeAgentExecution({
        planned: { handle: "@sara" },
        result: {},
        execution: {
          ok: true,
          status: "confirmed",
          ids: { actionId: "defi_observe_failed" }
        }
      });

      assert.equal(observed.execution.ok, false);
      assert.equal(observed.execution.status, "failed");
      assert.match(observed.execution.reason, /execution reverted/i);
      assert.equal(observed.trace.maxFollowUps, 1);
      assert.equal(observed.trace.followUpsUsed, 1);
      assert.equal(observed.trace.modelCalls, 0);
      assert.equal(observed.trace.spendCalls, 0);
      assert.equal(observed.trace.workerRuns, 0);
      assert.equal(ledger.jobs[0].attempts, 2);
    }
  },
  {
    name: "bounded observer promotes a submitted transaction hash",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const txHash = `0x${"a".repeat(64)}`;
      ledger.defiActions.push({
        id: "defi_observe_tx",
        handle: "@sara",
        type: "swap",
        status: "submitted",
        txHash,
        request: {
          amount: 1,
          fromToken: "USDC",
          toToken: "EURC",
          fromRail: "arc-testnet",
          toRail: "arc-testnet"
        },
        createdAt: new Date().toISOString()
      });

      const observed = await observeAgentExecution({
        planned: { handle: "@sara" },
        result: {},
        execution: {
          ok: true,
          status: "confirmed",
          txHash: null,
          ids: { actionId: "defi_observe_tx" }
        }
      });

      assert.equal(observed.execution.status, "submitted");
      assert.equal(observed.execution.txHash, txHash);
      assert.equal(observed.trace.txHashObserved, true);
      assert.equal(observed.trace.outcome, "truth_promoted");
    }
  },
  {
    name: "bounded observer refuses cross-handle receipt context",
    async run() {
      resetLedger();
      configureOfflineHarness();
      ledger.defiActions.push({
        id: "defi_observe_owner",
        handle: "@sara",
        type: "swap",
        status: "submitted",
        request: {
          amount: 1,
          fromToken: "USDC",
          toToken: "EURC",
          fromRail: "arc-testnet",
          toRail: "arc-testnet"
        },
        createdAt: new Date().toISOString()
      });

      const initial = {
        ok: true,
        status: "confirmed",
        ids: { actionId: "defi_observe_owner" }
      };
      const observed = await observeAgentExecution({
        planned: { handle: "@bob" },
        result: {},
        execution: initial
      });

      assert.equal(observed.execution, initial);
      assert.equal(observed.monitor, null);
      assert.equal(observed.trace.outcome, "ownership_mismatch");
      assert.equal(observed.trace.spendCalls, 0);
    }
  },
  {
    name: "bounded observer does nothing when there is no receipt target",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const initial = { ok: true, status: "answered", ids: {} };
      const observed = await observeAgentExecution({
        planned: { handle: "@sara" },
        result: { ok: true, status: "answered" },
        execution: initial
      });
      assert.equal(observed.execution, initial);
      assert.equal(observed.trace.followUpsUsed, 0);
      assert.equal(observed.trace.modelCalls, 0);
      assert.equal(observed.trace.spendCalls, 0);
    }
  },
  {
    name: "valid user-wallet swap plans satisfy the execution contract",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const planned = planAgentAction({
        handle: "@sara",
        text: "swap 1 USDC to EURC on arc",
        source: "eval"
      });
      assert.equal(planned.contract.ok, true);
      assert.equal(planned.contract.version, 1);
    }
  },
  {
    name: "plan contract rejects cross-handle and secret-bearing arguments",
    async run() {
      const contract = validateAgentPlanContract({
        planned: {
          handle: "@sara",
          plan: {
            tool: "send_usdc",
            signer: { backendSignerAllowed: false },
            arguments: {
              senderHandle: "@bob",
              recipientHandle: "@alice",
              amount: 1,
              privateKey: `0x${"a".repeat(64)}`
            }
          }
        }
      });
      assert.equal(contract.ok, false);
      assert.ok(contract.issues.some((issue) => /authenticated handle/i.test(issue)));
      assert.ok(contract.issues.some((issue) => /forbidden field/i.test(issue)));
      assert.ok(contract.issues.some((issue) => /secret-shaped/i.test(issue)));
    }
  },
  {
    name: "invalid plans fail before a money-moving tool is called",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const before = ledger.payments.length;
      await assert.rejects(
        executeAgentPlan({
          handle: "@sara",
          source: "eval",
          planned: {
            handle: "@sara",
            plan: {
              tool: "send_usdc",
              signer: { backendSignerAllowed: true },
              arguments: {
                senderHandle: "@sara",
                recipientHandle: "@alice",
                amount: 1
              }
            }
          }
        }),
        (error) => error.code === "AGENT_PLAN_REJECTED"
      );
      assert.equal(ledger.payments.length, before);
    }
  },
  {
    name: "raw incomplete model intents become grounded pending tasks",
    async run() {
      const intent = normalizeModelIntent({
        action: "quote_swap",
        fromToken: "USDC",
        toToken: "EURC",
        settlementRail: "arc-testnet"
      });
      assert.equal(intent.action, "clarify");
      assert.equal(intent.pending.draft.action, "quote_swap");
      assert.deepEqual(intent.pending.missing, ["amount"]);
      assert.equal(intent.pending.draft.toToken, "EURC");
    }
  },
  {
    name: "raw automation model intents require both action and schedule",
    async run() {
      const intent = normalizeModelIntent({
        action: "create_automation",
        text: "swap 1 USDC to EURC"
      });
      assert.equal(intent.action, "clarify");
      assert.equal(intent.pending.draft.action, "create_automation");
      assert.deepEqual(intent.pending.missing, ["schedule"]);
    }
  },
  {
    name: "scenario corpus preserves multi-turn context behavior",
    async run() {
      const scenarios = JSON.parse(readFileSync(
        new URL("./fixtures/agent-context-scenarios.json", import.meta.url),
        "utf8"
      ));
      for (const scenario of scenarios) {
        resetLedger();
        configureOfflineHarness();
        if (scenario.pending) {
          seedPendingTurn({
            handle: scenario.handle || "@sara",
            text: scenario.pending.text,
            action: scenario.pending.action,
            draft: scenario.pending.draft,
            missing: scenario.pending.missing,
            question: scenario.pending.question
          });
        }
        const planned = await planAgentActionWithModel({
          handle: scenario.handle || "@sara",
          text: scenario.input,
          source: "eval",
          useModel: false,
          conversation: []
        });
        assert.equal(planned.plan.tool, scenario.expect.tool, scenario.name);
        if (scenario.expect.arguments) {
          assertPartial(planned.plan.arguments, scenario.expect.arguments, scenario.name);
        }
        if (scenario.expect.reasonPattern) {
          assert.match(planned.plan.reason, new RegExp(scenario.expect.reasonPattern, "i"), scenario.name);
        }
        assert.equal(planned.contract.ok, true, scenario.name);
      }
    }
  },
  {
    name: "model context facts carry provenance freshness and relevance",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const context = buildAgentContext({
        handle: "@sara",
        text: "can I swap USDC to EURC on Arc?",
        defaultSettlementRail: "arc-testnet"
      });
      const modelContext = summarizeAgentContextForModel(context);
      assert.ok(modelContext.facts.length > 0);
      const route = modelContext.facts.find((fact) => fact.kind === "route_capability");
      assert.ok(route);
      assert.equal(route.value.fromToken, "USDC");
      assert.equal(route.value.toToken, "EURC");
      assert.ok(route.provenance.source);
      assert.ok(route.provenance.authority);
      assert.ok(["fresh", "aging", "reference", "stale", "unknown"].includes(route.freshness.status));
      assert.ok(["execution_authority", "planning_hint", "historical_only", "unusable"].includes(route.decisionUse));
      assert.ok(route.relevance.score > 0);
      assert.equal(route.relevance.specificity, 1);
      assert.equal(modelContext.contextMeta.version, 2);
      assert.equal(modelContext.contextIntegrity.total, modelContext.facts.length);
      assert.match(modelContext.contextIntegrity.rule, /Only execution_authority facts/i);
    }
  },
  {
    name: "expired observations are marked stale and rank below authoritative facts",
    async run() {
      const now = new Date("2026-06-07T10:00:00.000Z");
      const stale = contextFact({
        id: "route:stale",
        kind: "route_capability",
        topic: "swap",
        value: { fromToken: "USDC", toToken: "EURC", status: "live" },
        source: "route_probe",
        authority: "observed",
        observedAt: "2026-06-07T09:00:00.000Z",
        ttlMs: 60_000,
        query: "swap USDC to EURC",
        activeTopic: "swap"
      });
      const identity = contextFact({
        id: "identity",
        kind: "identity",
        topic: "agent",
        value: { handle: "@sara" },
        source: "authenticated_session",
        authority: "authoritative",
        observedAt: now.toISOString(),
        ttlMs: null,
        query: "swap USDC to EURC",
        activeTopic: "swap"
      });
      const selected = selectAgentContextFacts([stale, identity], {
        topic: "swap",
        query: "swap USDC to EURC",
        now
      });
      const staleResult = selected.find((fact) => fact.id === "route:stale");
      assert.equal(staleResult.freshness.status, "stale");
      assert.equal(staleResult.decisionUse, "unusable");
      assert.equal(selected.find((fact) => fact.id === "identity").decisionUse, "execution_authority");
      assert.ok(selected[0].relevance.score >= staleResult.relevance.score);
    }
  },
  {
    name: "working memory exposes a compact objective lifecycle graph",
    async run() {
      resetLedger();
      configureOfflineHarness();
      seedPendingTurn({
        handle: "@sara",
        text: "open a BTC perp",
        action: "propose_perp_trade",
        draft: { symbol: "BTC" },
        missing: ["side", "collateralUsd", "leverage"],
        question: "Long or short, with how much collateral and leverage?"
      });
      let working = getAgentWorkingMemory("@sara");
      assert.equal(working.objectiveGraph.status, "waiting_for_user");
      assert.equal(working.objectiveGraph.currentStep, "clarify");
      assert.equal(working.objectiveGraph.action, "propose_perp_trade");

      const result = await runAgentAction({
        handle: "@sara",
        text: "check my balance",
        source: "eval",
        useModel: false,
        conversation: []
      });
      assert.equal(result.planned.plan.tool, "get_balance");
      working = getAgentWorkingMemory("@sara");
      assert.equal(working.objectiveGraph.goal, "Check the wallet balance.");
      assert.equal(working.objectiveGraph.status, "completed");
      assert.equal(working.objectiveGraph.currentStep, "complete");
      assert.equal(working.objectiveGraph.evidence.tool, "get_balance");
    }
  },
  {
    name: "objective graph retains execution evidence without exposing secrets",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const txHash = `0x${"b".repeat(64)}`;
      rememberAgentTurn({
        handle: "@sara",
        text: "swap 1 USDC to EURC",
        planned: {
          text: "swap 1 USDC to EURC",
          intent: {
            action: "quote_swap",
            amount: 1,
            fromToken: "USDC",
            toToken: "EURC",
            settlementRail: "arc-testnet"
          },
          plan: {
            tool: "quote_defi_route",
            arguments: {
              type: "swap",
              amount: 1,
              fromToken: "USDC",
              toToken: "EURC"
            }
          }
        },
        execution: {
          ok: true,
          status: "submitted",
          txHash,
          ids: { actionId: "defi_graph" }
        }
      });
      const graph = getAgentWorkingMemory("@sara").objectiveGraph;
      assert.equal(graph.status, "monitoring");
      assert.equal(graph.currentStep, "monitor");
      assert.equal(graph.evidence.actionId, "defi_graph");
      assert.equal(graph.evidence.txHash, txHash);
      assert.doesNotMatch(JSON.stringify(graph), /privateKey|KIT_KEY|xai-/i);
    }
  },
  {
    name: "deterministic planner preserves ordered multi-step requests",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const planned = planAgentAction({
        handle: "@sara",
        text: "check my balance then analyze my portfolio",
        source: "eval"
      });
      assert.equal(planned.parser, "deterministic_workflow");
      assert.equal(planned.plan.tool, "create_agent_workflow");
      assert.equal(planned.plan.arguments.steps.length, 2);
      assert.equal(planned.plan.arguments.steps[0].tool, "get_balance");
      assert.equal(planned.plan.arguments.steps[1].tool, "analyze_portfolio");
      assert.equal(planned.contract.ok, true);
    }
  },
  {
    name: "model workflow intents normalize each step independently",
    async run() {
      const intent = normalizeModelIntent({
        action: "create_workflow",
        goal: "Check balance and swap",
        steps: [
          { action: "get_balance" },
          {
            action: "quote_swap",
            amount: 1,
            fromToken: "USDC",
            toToken: "EURC",
            settlementRail: "arc-testnet"
          }
        ]
      });
      assert.equal(intent.action, "tool_call");
      assert.equal(intent.tool, "create_agent_workflow");
      assert.equal(intent.arguments.steps.length, 2);
      assert.equal(intent.arguments.steps[0].tool, "get_balance");
      assert.equal(intent.arguments.steps[1].action, "quote_swap");
    }
  },
  {
    name: "read-only workflow runs to completion without model recursion",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const result = await runAgentAction({
        handle: "@sara",
        text: "check my balance then analyze my portfolio",
        source: "eval",
        useModel: false
      });
      assert.equal(result.planned.plan.tool, "create_agent_workflow");
      assert.equal(result.result.workflow.status, "completed");
      assert.equal(result.result.workflow.steps.every((step) => step.status === "completed"), true);
      assert.equal(result.result.workflow.lastRun.modelCalls, 0);
      assert.equal(result.result.workflow.limits.maxSpendStepsPerRun, 1);
    }
  },
  {
    name: "workflow pauses after one spend step and resumes remaining work",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const workflow = createAgentWorkflow({
        handle: "@sara",
        goal: "Read, spend, then read again",
        steps: [
          { action: "tool_call", tool: "get_balance", arguments: {} },
          { action: "send_payment", amount: 1, recipientHandle: "@alice" },
          { action: "tool_call", tool: "get_balance", arguments: {} }
        ]
      });
      const adapters = fakeWorkflowAdapters();
      let result = await runAgentWorkflow({
        workflowId: workflow.id,
        handle: "@sara",
        ...adapters
      });
      assert.equal(result.status, "paused_budget");
      assert.equal(result.workflow.currentStepIndex, 2);
      assert.equal(result.workflow.lastRun.spendSteps, 1);
      assert.equal(result.workflow.steps[1].status, "completed");

      result = await runAgentWorkflow({
        workflowId: workflow.id,
        handle: "@sara",
        ...adapters
      });
      assert.equal(result.status, "completed");
      assert.equal(result.workflow.steps[2].status, "completed");
    }
  },
  {
    name: "workflow waits for settlement and refreshes receipt before advancing",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const workflow = createAgentWorkflow({
        handle: "@sara",
        goal: "Swap, then inspect balance",
        steps: [
          {
            action: "quote_swap",
            amount: 1,
            fromToken: "USDC",
            toToken: "EURC",
            settlementRail: "arc-testnet"
          },
          { action: "tool_call", tool: "get_balance", arguments: {} }
        ]
      });
      let submitted = false;
      const adapters = fakeWorkflowAdapters({
        execute(planned) {
          if (planned.plan.tool === "quote_defi_route") {
            submitted = true;
            ledger.defiActions.push({
              id: "defi_workflow_wait",
              handle: "@sara",
              type: "swap",
              status: "confirmed",
              request: {
                amount: 1,
                fromToken: "USDC",
                toToken: "EURC",
                fromRail: "arc-testnet",
                toRail: "arc-testnet"
              },
              createdAt: new Date().toISOString()
            });
            return {
              ok: true,
              status: "confirmed",
              action: ledger.defiActions[0]
            };
          }
          return { ok: true, status: "answered" };
        }
      });
      let result = await runAgentWorkflow({
        workflowId: workflow.id,
        handle: "@sara",
        ...adapters
      });
      assert.equal(submitted, true);
      assert.equal(result.status, "waiting_execution");
      assert.equal(result.workflow.currentStepIndex, 0);

      ledger.defiActions[0].status = "settled";
      ledger.defiActions[0].txHash = `0x${"c".repeat(64)}`;
      result = await runAgentWorkflow({
        workflowId: workflow.id,
        handle: "@sara",
        ...adapters
      });
      assert.equal(result.status, "completed");
      assert.equal(result.workflow.steps[0].evidence.txHash, `0x${"c".repeat(64)}`);
      assert.equal(result.workflow.steps[1].status, "completed");
    }
  },
  {
    name: "workflow ownership nesting and cancellation fail closed",
    async run() {
      resetLedger();
      configureOfflineHarness();
      assert.throws(() => createAgentWorkflow({
        handle: "@sara",
        steps: [
          { action: "create_workflow" },
          { action: "tool_call", tool: "get_balance", arguments: {} }
        ]
      }), /invalid action/i);

      const workflow = createAgentWorkflow({
        handle: "@sara",
        goal: "Two reads",
        steps: [
          { action: "tool_call", tool: "get_balance", arguments: {} },
          { action: "tool_call", tool: "analyze_portfolio", arguments: {} }
        ]
      });
      assert.throws(() => getAgentWorkflow({
        workflowId: workflow.id,
        handle: "@bob"
      }), (error) => error.code === "WORKFLOW_OWNERSHIP_MISMATCH");
      const cancelled = cancelAgentWorkflow({
        workflowId: workflow.id,
        handle: "@sara"
      });
      assert.equal(cancelled.status, "cancelled");
      assert.equal(listAgentWorkflows({ handle: "@sara" }).workflows.length, 1);
    }
  },
  {
    name: "context integrity exposes blocking route contradictions",
    async run() {
      const now = new Date();
      const facts = [
        contextFact({
          id: "route:configured",
          kind: "route_capability",
          topic: "swap",
          value: {
            type: "swap",
            fromRail: "arc-testnet",
            toRail: "arc-testnet",
            fromToken: "USDC",
            toToken: "EURC",
            status: "live"
          },
          source: "route_registry",
          authority: "configured",
          observedAt: now.toISOString(),
          query: "swap 1 USDC to EURC",
          activeTopic: "swap"
        }),
        contextFact({
          id: "route:probe",
          kind: "route_capability",
          topic: "swap",
          value: {
            type: "swap",
            fromRail: "arc-testnet",
            toRail: "arc-testnet",
            fromToken: "USDC",
            toToken: "EURC",
            status: "probe_failed"
          },
          source: "route_probe",
          authority: "observed",
          observedAt: now.toISOString(),
          ttlMs: 5 * 60_000,
          query: "swap 1 USDC to EURC",
          activeTopic: "swap"
        })
      ];
      const integrity = assessAgentContextFacts(facts);
      assert.equal(integrity.hasContradictions, true);
      assert.equal(integrity.blockingContradictions, 1);
      assert.equal(integrity.contradictions[0].blocksExecution, true);
    }
  },
  {
    name: "agent refuses money movement when route facts conflict",
    async run() {
      resetLedger();
      configureOfflineHarness();
      ledger.routeCapabilities.push({
        id: "route:swap:arc-testnet:arc-testnet:usdc:eurc",
        type: "swap",
        fromRail: "arc-testnet",
        toRail: "arc-testnet",
        fromToken: "USDC",
        toToken: "EURC",
        status: "probe_failed",
        provider: "circle-app-kit",
        source: "probe",
        lastQuotedAt: new Date().toISOString(),
        lastError: "Probe failed after registry seed said live.",
        reason: "Probe failed after registry seed said live.",
        updatedAt: new Date().toISOString()
      });
      const result = await runAgentAction({
        handle: "@sara",
        text: "swap 1 USDC to EURC",
        source: "eval",
        useModel: false
      });
      assert.equal(result.ok, false);
      assert.equal(result.status, "context_conflict");
      assert.equal(result.result, undefined);
      assert.match(result.summary, /conflicting current information/i);
      assert.equal(ledger.defiActions.length, 0);
    }
  },
  {
    name: "execution monitor can resume waiting workflows without model calls",
    async run() {
      resetLedger();
      configureOfflineHarness();
      const workflow = createAgentWorkflow({
        handle: "@sara",
        goal: "Swap, then inspect balance",
        steps: [
          {
            action: "quote_swap",
            amount: 1,
            fromToken: "USDC",
            toToken: "EURC",
            settlementRail: "arc-testnet"
          },
          { action: "tool_call", tool: "get_balance", arguments: {} }
        ]
      });
      const adapters = fakeWorkflowAdapters({
        execute(planned) {
          if (planned.plan.tool === "quote_defi_route") {
            ledger.defiActions.push({
              id: "defi_event_resume",
              handle: "@sara",
              type: "swap",
              status: "confirmed",
              request: {
                amount: 1,
                fromToken: "USDC",
                toToken: "EURC",
                fromRail: "arc-testnet",
                toRail: "arc-testnet"
              },
              createdAt: new Date().toISOString()
            });
            return {
              ok: true,
              status: "confirmed",
              action: ledger.defiActions[0]
            };
          }
          return { ok: true, status: "answered" };
        }
      });
      let result = await runAgentWorkflow({
        workflowId: workflow.id,
        handle: "@sara",
        ...adapters
      });
      assert.equal(result.status, "waiting_execution");
      assert.equal(findAgentWorkflowsForExecutionTarget({
        kind: "defi_action",
        id: "defi_event_resume",
        handle: "@sara"
      }).length, 1);

      ledger.defiActions[0].status = "settled";
      ledger.defiActions[0].txHash = `0x${"d".repeat(64)}`;
      result = await resumeAgentWorkflowsFromMonitor({
        kind: "defi_action",
        id: "defi_event_resume",
        handle: "@sara",
        source: "eval"
      });
      assert.equal(result.resumed, 1);
      assert.equal(result.workflows[0].status, "completed");
      assert.equal(result.workflows[0].workflow.lastRun.modelCalls, 0);
      assert.equal(result.workflows[0].workflow.steps[0].evidence.txHash, `0x${"d".repeat(64)}`);
    }
  }
];

function fakeWorkflowAdapters({ execute } = {}) {
  return {
    async planStep(intent) {
      const tool = intent.action === "tool_call"
        ? intent.tool
        : intent.action === "send_payment"
          ? "send_usdc"
          : intent.action === "quote_swap" || intent.action === "quote_bridge"
            ? "quote_defi_route"
            : intent.action;
      return {
        handle: "@sara",
        intent,
        contract: { ok: true },
        plan: {
          tool,
          arguments: intent.arguments || intent,
          signer: { backendSignerAllowed: false }
        }
      };
    },
    async executeStep(planned) {
      if (execute) return execute(planned);
      return { ok: true, status: planned.plan.tool === "send_usdc" ? "completed" : "answered" };
    }
  };
}

function seedPendingTurn({
  handle,
  text,
  action,
  draft,
  missing,
  question
}) {
  rememberAgentTurn({
    handle,
    text,
    planned: {
      text,
      intent: {
        action: "clarify",
        question,
        pending: buildPendingIntent(action, draft, missing)
      },
      plan: {
        tool: null,
        reason: question
      }
    },
    result: {
      ok: false,
      status: "clarification_required",
      reason: question
    },
    execution: {
      ok: false,
      status: "clarification_required",
      reason: question,
      ids: {}
    }
  });
}

function configureOfflineHarness() {
  config.providerMode = "mock";
  config.transferProvider = "mock";
  config.x.replyEnabled = false;
  config.defi.liveAdapters = false;
  config.defi.executionEnabled = false;
  config.ai.enabled = false;
}

function restoreConfig() {
  config.providerMode = BASE_CONFIG.providerMode;
  config.transferProvider = BASE_CONFIG.transferProvider;
  config.x.replyEnabled = BASE_CONFIG.xReplyEnabled;
  config.defi.liveAdapters = BASE_CONFIG.defiLiveAdapters;
  config.defi.executionEnabled = BASE_CONFIG.defiExecutionEnabled;
  config.ai.enabled = BASE_CONFIG.aiEnabled;
}

function resetLedger() {
  for (const key of MUTABLE_LEDGER_KEYS) ledger[key] = [];
  ledger.oauthStates.clear();
  ledger.idempotency.clear();
  for (const user of users.values()) {
    delete user.agentMemory;
  }
}

function applyCaseConfig(caseConfig = {}) {
  if (Object.hasOwn(caseConfig, "defiLiveAdapters")) {
    config.defi.liveAdapters = caseConfig.defiLiveAdapters;
  }
  if (Object.hasOwn(caseConfig, "defiExecutionEnabled")) {
    config.defi.executionEnabled = caseConfig.defiExecutionEnabled;
  }
}

function assertPlanCase(testCase) {
  resetLedger();
  configureOfflineHarness();
  applyCaseConfig(testCase.config);
  const planned = planAgentAction({
    handle: "@sara",
    text: testCase.text,
    defaultSettlementRail: "arc-testnet",
    source: "eval",
    conversation: testCase.conversation || []
  });
  assert.equal(planned.parser, testCase.expect.parser);
  assert.equal(planned.plan.tool, testCase.expect.tool);
  assert.equal(planned.policy.backendSignerAllowed, false);
  if (testCase.expect.arguments) {
    assertPartial(planned.plan.arguments, testCase.expect.arguments);
  }
}

async function assertRunCase(testCase) {
  resetLedger();
  configureOfflineHarness();
  applyCaseConfig(testCase.config);
  await testCase.before?.();
  const result = await runAgentAction({
    handle: "@sara",
    text: testCase.text,
    defaultSettlementRail: "arc-testnet",
    source: "eval",
    useModel: false,
    conversation: testCase.conversation || []
  });
  await testCase.assertResult(result);
}

function assertPartial(actual, expected, path = "") {
  for (const [key, expectedValue] of Object.entries(expected)) {
    const label = path ? `${path}.${key}` : key;
    assert.ok(actual && Object.hasOwn(actual, key), `Missing ${label}`);
    if (expectedValue && typeof expectedValue === "object" && !Array.isArray(expectedValue)) {
      assertPartial(actual[key], expectedValue, label);
    } else {
      assert.deepEqual(actual[key], expectedValue, `Mismatch at ${label}`);
    }
  }
}

function assertNoBackendLeak(text) {
  for (const pattern of USER_FACING_FORBIDDEN) {
    assert.doesNotMatch(String(text || ""), pattern);
  }
}

async function runSuite(name, tests, runner) {
  for (const testCase of tests) {
    await runner(testCase);
    console.log(`ok - ${name}: ${testCase.name}`);
  }
}

try {
  configureOfflineHarness();
  await runSuite("agent plan eval", planCases, assertPlanCase);
  await runSuite("agent run eval", runCases, assertRunCase);
  await runSuite("agent context eval", contextCases, async (testCase) => testCase.run());
  console.log("agent eval harness passed");
} finally {
  restoreConfig();
}
