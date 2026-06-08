import { config } from "./config.js";
import { normalizeHandle } from "./identity.js";
import { buildPendingIntent } from "./agentWorkingMemory.js";

const ALLOWED_ACTIONS = new Set([
  "send_payment",
  "answer_agent_question",
  "cancel_agent_task",
  "create_workflow",
  "resume_agent_workflow",
  "get_agent_workflow",
  "list_agent_workflows",
  "cancel_agent_workflow",
  "create_social_bounty",
  "create_airdrop",
  "award_airdrop",
  "list_airdrops",
  "get_airdrop_receipt",
  "quote_bridge",
  "quote_swap",
  "propose_perp_trade",
  "get_balance",
  "analyze_portfolio",
  "sync_circle_balances",
  "request_testnet_usdc",
  "list_approvals",
  "confirm_action",
  "get_receipt",
  "propose_copy_trade",
  "list_copy_trade_proposals",
  "list_perp_intelligence",
  "assess_liquidation_risk",
  "list_perp_proposals",
  "arc_perps_readiness",
  "arc_perps_status",
  "quote_arc_perp_position",
  "read_arc_perps_oracle_price",
  "get_arc_perps_position",
  "list_arc_perps_positions",
  "close_arc_perp_user_position",
  "appkit_readiness",
  "list_appkit_capabilities",
  "appkit_estimate_bridge",
  "appkit_bridge_usdc",
  "appkit_estimate_swap",
  "appkit_swap",
  "appkit_unified_balance",
  "resolve_x_handle",
  "list_defi_tools",
  "list_route_capabilities",
  "list_arc_trading_primitives",
  "list_defi_actions",
  "reconcile_defi_action",
  "get_defi_action_receipt",
  "get_market_feed_snapshot",
  "list_perp_markets",
  "create_mandate",
  "list_mandates",
  "update_mandate",
  "delete_mandate",
  "create_automation",
  "list_automations",
  "run_automation",
  "run_due_automations",
  "pause_automations",
  "pause_automation",
  "resume_automation",
  "delete_automation",
  "clarify"
]);

export function getAgentModelReadiness() {
  const provider = normalizeProvider(config.ai.provider);
  return {
    ok: Boolean(config.ai.enabled && ["gemini", "xai"].includes(provider) && config.ai.apiKey),
    enabled: config.ai.enabled,
    provider,
    model: config.ai.model,
    hasApiKey: Boolean(config.ai.apiKey),
    mode: config.ai.apiKey ? "model" : "deterministic_fallback"
  };
}

export async function planIntentWithModel({ text, defaultSettlementRail = "arc-testnet", context = {} } = {}) {
  const readiness = getAgentModelReadiness();
  if (!readiness.ok) return null;

  const timeoutMs = Number(process.env.AGENT_MODEL_TIMEOUT_MS || 1200);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const system = intentPlannerPrompt();
  let response;
  try {
    response = await callModelJson({
      system,
      user: JSON.stringify({ text, defaultSettlementRail, context }),
      schema: intentSchema(),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Agent model timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json();
  if (!response.ok) throw new Error(modelErrorMessage(data));
  return normalizeModelIntent(JSON.parse(extractModelText(data)), defaultSettlementRail);
}

export async function composeExecutionReplyWithModel({
  text,
  planned = {},
  result = {},
  execution = {},
  decision = {},
  narrative = {},
  state = {}
} = {}) {
  const readiness = getAgentModelReadiness();
  if (!readiness.ok) return null;

  const timeoutMs = Number(process.env.AGENT_REPLY_MODEL_TIMEOUT_MS || 1200);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const payload = sanitizeReplyContext({ text, planned, result, execution, decision, narrative, state });

  let response;
  try {
    response = await callModelJson({
      system: [
        "You are bunOS, an Arc trading agent talking to a user after backend execution.",
        "Write one short, natural response a 13-year-old could understand.",
        "Do not mention backend internals, parsers, provider stack traces, fallback paths, policy engine, or private keys.",
        "Say clearly whether money moved. If there is no transaction hash, do not imply on-chain completion.",
        "If blocked, say the simple reason and the next useful action.",
        "Return only JSON with fields: summary, nextAction."
      ].join("\n"),
      user: JSON.stringify(payload),
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary: { type: "string" },
          nextAction: { type: ["string", "null"] }
        },
        required: ["summary", "nextAction"],
        propertyOrdering: ["summary", "nextAction"]
      },
      signal: controller.signal
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || !data) return null;
  try {
    const parsed = JSON.parse(extractModelText(data));
    const summary = cleanModelReply(parsed.summary);
    if (!summary) return null;
    return {
      summary,
      nextAction: cleanModelReply(parsed.nextAction),
      model: {
        provider: readiness.provider,
        model: readiness.model,
        role: "execution_narrator"
      }
    };
  } catch {
    return null;
  }
}

function intentSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: Array.from(ALLOWED_ACTIONS) },
      amount: { type: ["number", "null"] },
      asset: { type: ["string", "null"] },
      recipientHandle: { type: ["string", "null"] },
      rule: { type: ["string", "null"] },
      recipients: { type: ["array", "null"], items: { type: "string" } },
      maxRecipients: { type: ["number", "null"] },
      airdropId: { type: ["string", "null"] },
      fromRail: { type: ["string", "null"] },
      toRail: { type: ["string", "null"] },
      fromToken: { type: ["string", "null"] },
      toToken: { type: ["string", "null"] },
      settlementRail: { type: ["string", "null"] },
      symbol: { type: ["string", "null"] },
      side: { type: ["string", "null"] },
      collateralUsd: { type: ["number", "null"] },
      leverage: { type: ["number", "null"] },
      traderHandle: { type: ["string", "null"] },
      capitalUsd: { type: ["number", "null"] },
      riskProfile: { type: ["string", "null"] },
      approvalId: { type: ["string", "null"] },
      paymentId: { type: ["string", "null"] },
      actionId: { type: ["string", "null"] },
      mandateId: { type: ["string", "null"] },
      automationId: { type: ["string", "null"] },
      workflowId: { type: ["string", "null"] },
      goal: { type: ["string", "null"] },
      steps: { type: ["array", "null"], items: { type: "object" } },
      intervalMinutes: { type: ["number", "null"] },
      everyMinutes: { type: ["number", "null"] },
      intervalSeconds: { type: ["number", "null"] },
      everySeconds: { type: ["number", "null"] },
      intervalMs: { type: ["number", "null"] },
      maxRuns: { type: ["number", "null"] },
      kind: { type: ["string", "null"] },
      type: { type: ["string", "null"] },
      status: { type: ["string", "null"] },
      includeHidden: { type: ["boolean", "null"] },
      text: { type: ["string", "null"] },
      positionId: { type: ["number", "null"] },
      marginUsd: { type: ["number", "null"] },
      limit: { type: ["number", "null"] },
      question: { type: ["string", "null"] },
      questionKind: { type: ["string", "null"] },
      topic: { type: ["string", "null"] }
    },
    required: [
      "action",
      "amount",
      "asset",
      "recipientHandle",
      "rule",
      "recipients",
      "maxRecipients",
      "airdropId",
      "fromRail",
      "toRail",
      "fromToken",
      "toToken",
      "settlementRail",
      "symbol",
      "side",
      "collateralUsd",
      "leverage",
      "traderHandle",
      "capitalUsd",
      "riskProfile",
      "approvalId",
      "paymentId",
      "actionId",
      "mandateId",
      "automationId",
      "workflowId",
      "goal",
      "steps",
      "intervalMinutes",
      "everyMinutes",
      "intervalSeconds",
      "everySeconds",
      "intervalMs",
      "maxRuns",
      "kind",
      "type",
      "status",
      "includeHidden",
      "text",
      "positionId",
      "marginUsd",
      "limit",
      "question",
      "questionKind",
      "topic"
    ],
    propertyOrdering: [
      "action",
      "amount",
      "asset",
      "recipientHandle",
      "rule",
      "recipients",
      "maxRecipients",
      "airdropId",
      "fromRail",
      "toRail",
      "fromToken",
      "toToken",
      "settlementRail",
      "symbol",
      "side",
      "collateralUsd",
      "leverage",
      "traderHandle",
      "capitalUsd",
      "riskProfile",
      "approvalId",
      "paymentId",
      "actionId",
      "mandateId",
      "automationId",
      "workflowId",
      "goal",
      "steps",
      "intervalMinutes",
      "everyMinutes",
      "intervalSeconds",
      "everySeconds",
      "intervalMs",
      "maxRuns",
      "kind",
      "type",
      "status",
      "includeHidden",
      "text",
      "positionId",
      "marginUsd",
      "limit",
      "question",
      "questionKind",
      "topic"
    ]
  };
}

async function callModelJson({ system, user, schema, signal }) {
  const provider = normalizeProvider(config.ai.provider);
  if (provider === "xai") return callXaiResponses({ system, user, schema, signal });
  return callGeminiGenerateContent({ system, user, schema, signal });
}

function callGeminiGenerateContent({ system, user, schema, signal }) {
  return fetch(`${config.ai.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(config.ai.model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": config.ai.apiKey,
      "content-type": "application/json"
    },
    signal,
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: system }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: user }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: schema
      }
    })
  });
}

function callXaiResponses({ system, user, schema, signal }) {
  return fetch(`${config.ai.baseUrl.replace(/\/+$/, "")}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.ai.apiKey}`,
      "content-type": "application/json"
    },
    signal,
    body: JSON.stringify({
      model: config.ai.model,
      input: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            "Return valid JSON only. Do not wrap it in markdown.",
            user,
            `JSON schema: ${JSON.stringify(schema)}`
          ].join("\n")
        }
      ],
      temperature: 0
    })
  });
}

function extractModelText(data) {
  const provider = normalizeProvider(config.ai.provider);
  const text = provider === "xai" ? extractXaiText(data) : extractGeminiText(data);
  if (!text) throw new Error("Agent model returned no intent JSON");
  return stripJsonFence(text);
}

function extractGeminiText(data) {
  return data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    ?.join("")
    ?.trim();
}

function extractXaiText(data) {
  if (typeof data.output_text === "string") return data.output_text.trim();
  if (typeof data.text === "string") return data.text.trim();
  const output = Array.isArray(data.output) ? data.output : [];
  return output
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((content) => content.text || content.output_text || "")
    .join("")
    .trim();
}

function stripJsonFence(text) {
  return String(text || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function modelErrorMessage(data) {
  return data?.error?.message || data?.message || "Agent model request failed";
}

function normalizeProvider(provider) {
  const value = String(provider || "").toLowerCase();
  if (["xai", "grok"].includes(value)) return "xai";
  return "gemini";
}

function intentPlannerPrompt() {
  return [
    "You are the bunOS intent planner.",
    "Return only JSON. Do not execute transactions.",
    "You receive a compact agent context packet with wallet state, live routes, blocked routes, open positions, active automations, recent memory, conversation topic, and safety policies.",
    "Use that context before choosing a tool. Live routes are tradable candidates. Blocked routes are not tradable. Do not invent routes, balances, positions, automations, or tx hashes.",
    "If the user asks a capability/how-to/status question, answer or read state; do not create trades or automations.",
    "If the user says 'do it again', repeat the last trade from context only when amount, token/rail, and action are known; otherwise clarify.",
    "If the user says 'why did that fail' or 'what happened', inspect memory/receipts instead of starting a new action.",
    "If the user says 'close it' and context has exactly one open perp position, use close_arc_perp_user_position with that positionId; otherwise clarify.",
    "Use context.references for pronouns such as it/that/again. If references.requiresClarification is true, return clarify instead of guessing a candidate.",
    "Use context.workingMemory as the active task state. Its objectiveGraph shows the current goal, lifecycle step, and grounded evidence. A short follow-up may fill missing fields. A clear new request supersedes the unfinished task. 'Never mind', 'forget that', or 'start over' means cancel_agent_task.",
    "Use context.facts as the ranked evidence layer. Prefer authoritative and observed facts over configured, user-stated, remembered, or inferred facts.",
    "Follow each fact's decisionUse. execution_authority may prove current state; planning_hint may only tell you what to check; historical_only explains prior outcomes; unusable must be refreshed.",
    "Use context.contextIntegrity to see whether enough current evidence exists for the requested decision.",
    "If context.contextIntegrity.blockingContradictions is greater than zero and the user wants money movement, do not execute or invent a workaround. Return a read/clarify action that refreshes the conflicting state.",
    "Never use a stale fact to claim current balance, route availability, approval state, position state, or execution success. Ask for a refresh or call the appropriate read tool.",
    "A configured route fact proves capability only. A fresh route_probe fact proves a recent quote. A remembered failure explains history but does not prove the route is still failing.",
    "Do not invent facts that are absent from context.facts. When evidence conflicts, prefer the higher-authority fresher fact and ask for clarification if the conflict affects money movement.",
    "When the user clearly requests two to four ordered actions, return create_workflow with one normalized intent per step. Do not flatten multiple actions into one text field.",
    "Never create nested workflows. Do not add steps the user did not request. Preserve order and dependencies.",
    "If the user mentions automation, only create one when they provide an action plus interval/schedule. Questions about automations should use answer_agent_question or list_automations.",
    `Allowed actions: ${Array.from(ALLOWED_ACTIONS).join(", ")}.`,
    "Supported rails: arc-testnet, base-sepolia. Use arc-testnet as default.",
    "Payments and bounties are USDC only. Swaps and bridges can use fromToken/toToken symbols or EVM token addresses. If unclear, return clarify with a question.",
    "Do not return create_wallet; the terminal does not create wallets.",
    "Schema examples:",
    "{\"action\":\"send_payment\",\"amount\":5,\"asset\":\"USDC\",\"recipientHandle\":\"@alice\"}",
    "{\"action\":\"quote_bridge\",\"amount\":1,\"asset\":\"USDC\",\"fromRail\":\"arc-testnet\",\"toRail\":\"base-sepolia\"}",
    "{\"action\":\"create_airdrop\",\"amount\":1,\"asset\":\"USDC\",\"recipients\":[\"@alice\",\"@bob\"],\"settlementRail\":\"arc-testnet\"}",
    "{\"action\":\"create_airdrop\",\"amount\":1,\"asset\":\"USDC\",\"maxRecipients\":100,\"rule\":\"first_commenters\",\"settlementRail\":\"arc-testnet\"}",
    "{\"action\":\"award_airdrop\",\"airdropId\":\"air_0001\",\"recipients\":[\"@alice\",\"@bob\"]}",
    "{\"action\":\"quote_bridge\",\"amount\":5,\"asset\":\"EURC\",\"fromToken\":\"EURC\",\"toToken\":\"EURC\",\"fromRail\":\"arc-testnet\",\"toRail\":\"base-sepolia\"}",
    "{\"action\":\"quote_swap\",\"amount\":1,\"fromToken\":\"USDC\",\"toToken\":\"EURC\",\"settlementRail\":\"arc-testnet\"}",
    "{\"action\":\"quote_swap\",\"amount\":20,\"fromToken\":\"EURC\",\"toToken\":\"USDC\",\"settlementRail\":\"arc-testnet\"}",
    "{\"action\":\"quote_swap\",\"amount\":0.001,\"fromToken\":\"USDC\",\"toToken\":\"cirBTC\",\"settlementRail\":\"arc-testnet\"}",
    "Messy user phrases still map to tools: 'turn 1 USDC into EURC' => quote_swap, 'get me EURC using 1 USDC' => quote_swap, 'move 1 USDC over to Base' => quote_bridge.",
    "If the user says buy/get/turn/change one token using another token, treat it as a swap unless they mention a different destination rail.",
    "{\"action\":\"propose_perp_trade\",\"symbol\":\"BTC\",\"side\":\"long\",\"collateralUsd\":1,\"leverage\":2}",
    "{\"action\":\"close_arc_perp_user_position\",\"positionId\":12}",
    "{\"action\":\"get_balance\"}",
    "{\"action\":\"analyze_portfolio\"}",
    "{\"action\":\"get_market_feed_snapshot\",\"settlementRail\":\"arc-testnet\"}",
    "{\"action\":\"create_mandate\",\"text\":\"never bridge if fee is over 3%\"}",
    "{\"action\":\"list_mandates\"}",
    "{\"action\":\"create_automation\",\"text\":\"sync balances every 10 minutes\",\"intervalMinutes\":10}",
    "{\"action\":\"create_automation\",\"text\":\"swap 1 USDC to EURC\",\"intervalSeconds\":10,\"maxRuns\":4}",
    "{\"action\":\"create_workflow\",\"goal\":\"Check my balance, then swap 1 USDC to EURC\",\"steps\":[{\"action\":\"get_balance\"},{\"action\":\"quote_swap\",\"amount\":1,\"fromToken\":\"USDC\",\"toToken\":\"EURC\",\"settlementRail\":\"arc-testnet\"}]}",
    "{\"action\":\"resume_agent_workflow\",\"workflowId\":\"workflow_abc\"}",
    "{\"action\":\"list_agent_workflows\"}",
    "{\"action\":\"list_automations\"}",
    "{\"action\":\"answer_agent_question\",\"questionKind\":\"automation_capabilities\",\"topic\":\"automation\",\"question\":\"what automations can you run?\"}",
    "{\"action\":\"answer_agent_question\",\"questionKind\":\"swap_capabilities\",\"topic\":\"swap\",\"question\":\"what tokens can you swap?\"}",
    "{\"action\":\"answer_agent_question\",\"questionKind\":\"how_to\",\"topic\":\"swap\",\"question\":\"how to use this?\"}",
    "{\"action\":\"cancel_agent_task\"}",
    "{\"action\":\"list_route_capabilities\",\"status\":\"live\",\"type\":\"swap\"}",
    "{\"action\":\"pause_automations\",\"status\":\"active\"}",
    "{\"action\":\"pause_automation\",\"automationId\":\"auto_0001\"}",
    "{\"action\":\"propose_copy_trade\",\"traderHandle\":\"@alice\",\"capitalUsd\":25,\"settlementRail\":\"arc-testnet\"}",
    "{\"action\":\"get_defi_action_receipt\",\"actionId\":\"defi_0001\"}",
    "{\"action\":\"clarify\",\"question\":\"Which token do you want to buy?\"}"
  ].join("\n");
}

export function normalizeModelIntent(intent, defaultSettlementRail = "arc-testnet") {
  if (!intent || !ALLOWED_ACTIONS.has(intent.action)) {
    return clarify("I can send, bridge, swap, or prepare a perp proposal. What do you want to do?");
  }

  if (intent.action === "send_payment") {
    const missing = [
      !positive(intent.amount) ? "amount" : null,
      !intent.recipientHandle ? "recipientHandle" : null
    ].filter(Boolean);
    if (missing.length) {
      return clarify(
        "How much USDC should I send, and to which X handle?",
        buildPendingIntent("send_payment", {
          amount: positive(intent.amount) ? Number(intent.amount) : null,
          asset: "USDC",
          recipientHandle: intent.recipientHandle ? normalizeHandle(intent.recipientHandle) : null
        }, missing)
      );
    }
    return {
      action: "send_payment",
      amount: Number(intent.amount),
      asset: "USDC",
      recipientHandle: normalizeHandle(intent.recipientHandle)
    };
  }

  if (intent.action === "create_social_bounty") {
    if (!positive(intent.amount)) return clarify("How much USDC should the bounty pay?");
    return {
      action: "create_social_bounty",
      amount: Number(intent.amount),
      asset: "USDC",
      rule: intent.rule || "first_valid_commenter"
    };
  }

  if (intent.action === "create_airdrop") {
    if (!positive(intent.amount)) return clarify("How much USDC should each airdrop recipient receive?");
    const recipients = Array.isArray(intent.recipients)
      ? intent.recipients.map(normalizeHandle).filter(Boolean)
      : [];
    const maxRecipients = positive(intent.maxRecipients) ? Number(intent.maxRecipients) : recipients.length;
    if (!recipients.length && !maxRecipients) return clarify("Who should receive the airdrop, or how many social winners should qualify?");
    return {
      action: "tool_call",
      tool: "create_airdrop",
      arguments: stripNullish({
        amountPerRecipient: Number(intent.amount),
        recipients,
        maxRecipients,
        rule: intent.rule || (recipients.length ? "fixed_recipients" : "first_commenters"),
        settlementRail: normalizeRail(intent.settlementRail) || defaultSettlementRail
      })
    };
  }

  if (intent.action === "award_airdrop") {
    if (!intent.airdropId) return clarify("Which airdrop ID should I award?");
    const recipients = Array.isArray(intent.recipients)
      ? intent.recipients.map(normalizeHandle).filter(Boolean)
      : [];
    if (!recipients.length) return clarify("Which X handles won the airdrop?");
    return {
      action: "tool_call",
      tool: "award_airdrop",
      arguments: {
        airdropId: String(intent.airdropId),
        winnerHandles: recipients
      }
    };
  }

  if (intent.action === "quote_bridge") {
    const fromRail = normalizeRail(intent.fromRail) || defaultSettlementRail;
    const toRail = normalizeRail(intent.toRail);
    const fromToken = normalizeSwapToken(intent.fromToken || intent.asset) || "USDC";
    const toToken = normalizeSwapToken(intent.toToken) || fromToken;
    const missing = [
      !positive(intent.amount) ? "amount" : null,
      !fromRail ? "fromRail" : null,
      !toRail || fromRail === toRail ? "toRail" : null
    ].filter(Boolean);
    if (missing.length) {
      return clarify(
        "How much should I bridge, which token, and to which rail?",
        buildPendingIntent("quote_bridge", {
          amount: positive(intent.amount) ? Number(intent.amount) : null,
          asset: fromToken,
          fromToken,
          toToken,
          fromRail,
          toRail: fromRail === toRail ? null : toRail
        }, missing)
      );
    }
    return {
      action: "quote_bridge",
      amount: Number(intent.amount),
      asset: fromToken,
      fromToken,
      toToken,
      fromRail,
      toRail
    };
  }

  if (intent.action === "quote_swap") {
    const fromToken = normalizeSwapToken(intent.fromToken) || "USDC";
    const toToken = normalizeSwapToken(intent.toToken);
    const settlementRail = normalizeRail(intent.settlementRail) || defaultSettlementRail;
    const missing = [
      !positive(intent.amount) ? "amount" : null,
      !fromToken ? "fromToken" : null,
      !toToken || fromToken === toToken ? "toToken" : null
    ].filter(Boolean);
    if (missing.length) {
      return clarify(
        "Which amount and token pair should I swap?",
        buildPendingIntent("quote_swap", {
          amount: positive(intent.amount) ? Number(intent.amount) : null,
          fromToken,
          toToken: fromToken === toToken ? null : toToken,
          settlementRail
        }, missing)
      );
    }
    if (!isSupportedSwapPair({ settlementRail, fromToken, toToken })) {
      return clarify("Tell me a valid swap pair and rail. Try: swap $20 EURC to USDC on arc, or use token contract addresses for less common assets.");
    }
    return {
      action: "quote_swap",
      amount: Number(intent.amount),
      fromToken,
      toToken,
      settlementRail
    };
  }

  if (intent.action === "propose_perp_trade") {
    const side = String(intent.side || "").toLowerCase();
    const symbol = String(intent.symbol || "").toUpperCase();
    const missing = [
      !symbol ? "symbol" : null,
      !["long", "short"].includes(side) ? "side" : null,
      !positive(intent.collateralUsd) ? "collateralUsd" : null,
      !positive(intent.leverage) ? "leverage" : null
    ].filter(Boolean);
    if (missing.length) {
      return clarify(
        "Tell me the perp symbol, side, collateral, and leverage.",
        buildPendingIntent("propose_perp_trade", {
          symbol: symbol || null,
          side: ["long", "short"].includes(side) ? side : null,
          collateralUsd: positive(intent.collateralUsd) ? Number(intent.collateralUsd) : null,
          leverage: positive(intent.leverage) ? Number(intent.leverage) : null
        }, missing)
      );
    }
    return {
      action: "propose_perp_trade",
      symbol,
      side,
      collateralUsd: Number(intent.collateralUsd),
      leverage: Number(intent.leverage)
    };
  }

  if (intent.action === "answer_agent_question") {
    return {
      action: "tool_call",
      tool: "answer_agent_question",
      arguments: stripNullish({
        questionKind: intent.questionKind || intent.kind || "agent_capabilities",
        topic: intent.topic || null,
        question: intent.question || null,
        defaultSettlementRail
      })
    };
  }

  if (intent.action === "create_workflow") {
    if (!Array.isArray(intent.steps) || intent.steps.length < 2 || intent.steps.length > 4) {
      return clarify("Give me a multi-step goal with between two and four clear actions.");
    }
    const steps = intent.steps.map((step) => normalizeModelIntent(step, defaultSettlementRail));
    if (steps.some((step) => (
      !step
      || step.action === "clarify"
      || step.action === "create_workflow"
      || (step.action === "tool_call" && String(step.tool || "").includes("agent_workflow"))
    ))) {
      return clarify("One workflow step is incomplete. Tell me the missing amount, asset, recipient, rail, or trade settings.");
    }
    return {
      action: "tool_call",
      tool: "create_agent_workflow",
      arguments: {
        goal: String(intent.goal || intent.text || "Complete the requested multi-step action.").slice(0, 500),
        steps,
        defaultSettlementRail
      }
    };
  }

  if (MODEL_TOOL_ACTIONS.has(intent.action)) {
    return sanitizeToolIntent(intent, defaultSettlementRail);
  }

  return clarify(intent.question || "What should I do?");
}

function normalizeRail(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return null;
  if (text === "arc" || text === "arc-testnet") return "arc-testnet";
  if (text === "base" || text === "base-sepolia") return "base-sepolia";
  return null;
}

function positive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function clarify(question, pending = null) {
  return {
    action: "clarify",
    question,
    ...(pending ? { pending } : {})
  };
}

function normalizeSwapToken(value) {
  const raw = String(value || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(raw)) return raw;
  const alias = MODEL_TOKEN_ALIASES.get(raw.toLowerCase());
  if (alias) return alias;
  const token = raw.toUpperCase();
  if (!token || ["ARC", "BASE", "FROM", "IN", "ON", "TO"].includes(token)) return null;
  if (token === "ETH") return "WETH";
  if (token === "CIRBTC") return "cirBTC";
  return token;
}

const MODEL_TOKEN_ALIASES = new Map([
  ["euro", "EURC"],
  ["eur", "EURC"],
  ["eurocoin", "EURC"],
  ["euro coin", "EURC"],
  ["euro stable", "EURC"],
  ["euro stablecoin", "EURC"],
  ["dollar", "USDC"],
  ["dollars", "USDC"],
  ["usd", "USDC"],
  ["usd coin", "USDC"],
  ["stable dollar", "USDC"],
  ["circle dollar", "USDC"],
  ["bitcoin", "cirBTC"],
  ["btc", "cirBTC"],
  ["circle btc", "cirBTC"],
  ["circle bitcoin", "cirBTC"],
  ["wrapped eth", "WETH"],
  ["wrapped ethereum", "WETH"],
  ["ethereum", "WETH"]
]);

function isSupportedSwapPair({ settlementRail, fromToken, toToken }) {
  return Boolean(settlementRail && fromToken && toToken && fromToken !== toToken);
}

const MODEL_TOOL_ACTIONS = new Set([
  "answer_agent_question",
  "cancel_agent_task",
  "resume_agent_workflow",
  "get_agent_workflow",
  "list_agent_workflows",
  "cancel_agent_workflow",
  "get_balance",
  "analyze_portfolio",
  "sync_circle_balances",
  "request_testnet_usdc",
  "list_airdrops",
  "list_approvals",
  "confirm_action",
  "get_receipt",
  "get_airdrop_receipt",
  "propose_copy_trade",
  "list_copy_trade_proposals",
  "list_perp_intelligence",
  "assess_liquidation_risk",
  "list_perp_proposals",
  "arc_perps_readiness",
  "arc_perps_status",
  "quote_arc_perp_position",
  "read_arc_perps_oracle_price",
  "get_arc_perps_position",
  "list_arc_perps_positions",
  "close_arc_perp_user_position",
  "appkit_readiness",
  "list_appkit_capabilities",
  "appkit_estimate_bridge",
  "appkit_bridge_usdc",
  "appkit_estimate_swap",
  "appkit_swap",
  "appkit_unified_balance",
  "resolve_x_handle",
  "list_defi_tools",
  "list_route_capabilities",
  "list_arc_trading_primitives",
  "list_defi_actions",
  "reconcile_defi_action",
  "get_defi_action_receipt",
  "get_market_feed_snapshot",
  "list_perp_markets",
  "create_mandate",
  "list_mandates",
  "update_mandate",
  "delete_mandate",
  "create_automation",
  "list_automations",
  "run_automation",
  "run_due_automations",
  "pause_automations",
  "pause_automation",
  "resume_automation",
  "delete_automation"
]);

function sanitizeToolIntent(intent, defaultSettlementRail) {
  const tool = intent.action;
  const args = {};
  const rail = normalizeRail(intent.settlementRail || intent.fromRail) || defaultSettlementRail;

  if (positive(intent.amount)) args.amount = Number(intent.amount);
  if (positive(intent.limit)) args.limit = Number(intent.limit);
  if (intent.recipientHandle) args.recipientHandle = normalizeHandle(intent.recipientHandle);
  if (intent.traderHandle) args.traderHandle = normalizeHandle(intent.traderHandle);
  if (positive(intent.capitalUsd)) args.capitalUsd = Number(intent.capitalUsd);
  if (intent.riskProfile) args.riskProfile = String(intent.riskProfile);
  if (intent.approvalId) args.approvalId = String(intent.approvalId);
  if (intent.paymentId) args.paymentId = String(intent.paymentId);
  if (intent.actionId) args.actionId = String(intent.actionId);
  if (intent.mandateId) args.mandateId = String(intent.mandateId);
  if (intent.automationId) args.automationId = String(intent.automationId);
  if (intent.workflowId) args.workflowId = String(intent.workflowId);
  if (positive(intent.intervalMinutes)) args.intervalMinutes = Number(intent.intervalMinutes);
  if (positive(intent.everyMinutes)) args.everyMinutes = Number(intent.everyMinutes);
  if (positive(intent.intervalSeconds)) args.intervalSeconds = Number(intent.intervalSeconds);
  if (positive(intent.everySeconds)) args.everySeconds = Number(intent.everySeconds);
  if (positive(intent.intervalMs)) args.intervalMs = Number(intent.intervalMs);
  if (positive(intent.maxRuns)) args.maxRuns = Number(intent.maxRuns);
  if (intent.kind) args.kind = String(intent.kind);
  if (intent.type) args.type = String(intent.type);
  if (intent.status) args.status = String(intent.status);
  if (typeof intent.includeHidden === "boolean") args.includeHidden = intent.includeHidden;
  if (intent.text) args.text = String(intent.text);
  if (positive(intent.positionId)) args.positionId = Number(intent.positionId);
  if (positive(intent.marginUsd)) args.marginUsd = Number(intent.marginUsd);
  if (intent.symbol) args.symbol = String(intent.symbol).toUpperCase();
  if (["long", "short"].includes(String(intent.side || "").toLowerCase())) args.side = String(intent.side).toLowerCase();
  if (positive(intent.collateralUsd)) args.collateralUsd = Number(intent.collateralUsd);
  if (positive(intent.leverage)) args.leverage = Number(intent.leverage);
  if (intent.fromToken) args.fromToken = normalizeSwapToken(intent.fromToken);
  if (intent.toToken) args.toToken = normalizeSwapToken(intent.toToken);
  if (intent.fromRail) args.fromRail = normalizeRail(intent.fromRail) || rail;
  if (intent.toRail) args.toRail = normalizeRail(intent.toRail);
  args.settlementRail = rail;

  if (tool === "confirm_action" && !args.approvalId) args.approvalId = "__latest_pending__";
  if (tool === "get_receipt" && !args.paymentId) return clarify("Which payment ID should I look up?");
  if (["reconcile_defi_action", "get_defi_action_receipt"].includes(tool) && !args.actionId) return clarify("Which DeFi action ID should I use?");
  if (tool === "create_mandate" && !args.text) return clarify("What standing trading rule should I save?");
  if (["update_mandate", "delete_mandate"].includes(tool) && !args.mandateId) return clarify("Which mandate ID should I change?");
  if (tool === "create_automation" && (!args.text || (!positive(args.intervalSeconds) && !positive(args.intervalMinutes) && !positive(args.intervalMs)))) {
    const missing = [
      !args.text ? "text" : null,
      !positive(args.intervalSeconds) && !positive(args.intervalMinutes) && !positive(args.intervalMs) ? "schedule" : null
    ].filter(Boolean);
    return clarify(
      "What should the automation do, and how often should it run?",
      buildPendingIntent("create_automation", args, missing)
    );
  }
  if (["run_automation", "pause_automation", "resume_automation", "delete_automation"].includes(tool) && !args.automationId) return clarify("Which automation ID should I use?");
  if (["resume_agent_workflow", "get_agent_workflow", "cancel_agent_workflow"].includes(tool) && !args.workflowId) return clarify("Which workflow ID should I use?");
  if (tool === "propose_copy_trade" && (!args.traderHandle || !positive(args.capitalUsd))) return clarify("Which trader should I copy, and with how much capital?");
  if (["assess_liquidation_risk", "quote_arc_perp_position"].includes(tool) && (!args.symbol || !args.side || !positive(args.leverage))) {
    return clarify("Tell me the symbol, side, collateral or margin, and leverage.");
  }

  return {
    action: "tool_call",
    tool,
    arguments: stripNullish(args)
  };
}

function stripNullish(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ""));
}

function sanitizeReplyContext({ text, planned, result, execution, decision, narrative, state }) {
  const receipt = narrative.receipt || {};
  const action = result.action || result.receipt?.action || {};
  const request = action.request || planned.intent || {};
  return {
    userRequest: String(text || "").slice(0, 500),
    planned: {
      parser: planned.parser,
      tool: planned.plan?.tool || null,
      action: planned.intent?.action || null,
      arguments: publicArgs(planned.plan?.arguments || {})
    },
    outcome: {
      ok: execution.ok !== false && result.ok !== false,
      status: execution.status || result.status || action.status || "unknown",
      reason: publicReason(execution.reason || result.reason || result.error || decision.rationale || ""),
      txHash: publicTx(execution.txHash || result.txHash || receipt.txHash || action.txHash),
      receiptUrl: execution.receiptUrl || receipt.url || result.receipt?.publicUrl || null,
      nextAction: execution.nextAction || result.nextAction || narrative.nextAction || null
    },
    route: {
      type: action.type || request.action || null,
      amount: request.amountUsd || request.amount || planned.intent?.amount || null,
      fromToken: request.fromToken || planned.intent?.fromToken || planned.intent?.asset || null,
      toToken: request.toToken || planned.intent?.toToken || null,
      fromRail: request.fromRail || planned.intent?.fromRail || planned.intent?.settlementRail || null,
      toRail: request.toRail || planned.intent?.toRail || null
    },
    wallet: {
      handle: state.handle || planned.handle || null,
      connected: Boolean(state.wallet?.onboarded || state.wallet?.address),
      totalValueUsd: state.portfolio?.totalValueUsd ?? null
    },
    safety: {
      backendSignerAllowed: false,
      stance: decision.stance || null,
      risk: decision.riskLevel || null,
      warnings: Array.isArray(decision.warnings)
        ? decision.warnings.map(publicReason).filter(Boolean).slice(0, 3)
        : []
    }
  };
}

function publicArgs(args = {}) {
  const allowed = [
    "amount",
    "asset",
    "fromToken",
    "toToken",
    "fromRail",
    "toRail",
    "settlementRail",
    "recipientHandle",
    "symbol",
    "side",
    "collateralUsd",
    "leverage",
    "type",
    "status",
    "includeHidden",
    "intervalMs",
    "intervalMinutes",
    "maxRuns",
    "text"
  ];
  return Object.fromEntries(allowed.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));
}

function publicReason(reason) {
  return String(reason || "")
    .replace(/Provider details:.*/i, "")
    .replace(/AppKit:.*/i, "")
    .replace(/LI\.FI fallback:.*/i, "")
    .replace(/0x[a-fA-F0-9]{64}/g, "transaction hash")
    .replace(/KIT_KEY:[A-Za-z0-9:_-]+/g, "configured kit key")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function publicTx(txHash) {
  const value = String(txHash || "");
  return /^0x[a-fA-F0-9]{64}$/.test(value) ? value : null;
}

function cleanModelReply(value) {
  return String(value || "")
    .replace(/Provider details:.*/i, "")
    .replace(/AppKit:.*/i, "")
    .replace(/LI\.FI fallback:.*/i, "")
    .replace(/KIT_KEY:[A-Za-z0-9:_-]+/g, "configured kit key")
    .trim()
    .slice(0, 700);
}
