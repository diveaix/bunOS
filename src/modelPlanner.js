import { config } from "./config.js";
import { normalizeHandle } from "./identity.js";

const ALLOWED_ACTIONS = new Set([
  "send_payment",
  "create_social_bounty",
  "quote_bridge",
  "quote_swap",
  "propose_perp_trade",
  "get_balance",
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
  "appkit_readiness",
  "list_appkit_capabilities",
  "appkit_estimate_bridge",
  "appkit_bridge_usdc",
  "appkit_estimate_swap",
  "appkit_swap",
  "appkit_unified_balance",
  "resolve_x_handle",
  "list_defi_tools",
  "list_defi_actions",
  "reconcile_defi_action",
  "get_defi_action_receipt",
  "list_perp_markets",
  "clarify"
]);

export function getAgentModelReadiness() {
  return {
    ok: Boolean(config.ai.enabled && config.ai.provider === "gemini" && config.ai.apiKey),
    enabled: config.ai.enabled,
    provider: config.ai.provider,
    model: config.ai.model,
    hasApiKey: Boolean(config.ai.apiKey),
    mode: config.ai.apiKey ? "model" : "deterministic_fallback"
  };
}

export async function planIntentWithModel({ text, defaultSettlementRail = "arc-testnet" } = {}) {
  const readiness = getAgentModelReadiness();
  if (!readiness.ok) return null;

  const response = await fetch(`${config.ai.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(config.ai.model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": config.ai.apiKey,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: [
              "You are the ArcPay intent planner.",
              "Return only JSON. Do not execute transactions.",
              `Allowed actions: ${Array.from(ALLOWED_ACTIONS).join(", ")}.`,
              "Supported rails: arc-testnet, base-sepolia. Use arc-testnet as default.",
              "Payments and bounties are USDC only. Swaps and bridges can use fromToken/toToken symbols or EVM token addresses. If unclear, return clarify with a question.",
              "Do not return create_wallet; the terminal does not create wallets.",
              "Schema examples:",
              "{\"action\":\"send_payment\",\"amount\":5,\"asset\":\"USDC\",\"recipientHandle\":\"@alice\"}",
              "{\"action\":\"quote_bridge\",\"amount\":1,\"asset\":\"USDC\",\"fromRail\":\"arc-testnet\",\"toRail\":\"base-sepolia\"}",
              "{\"action\":\"quote_bridge\",\"amount\":5,\"asset\":\"EURC\",\"fromToken\":\"EURC\",\"toToken\":\"EURC\",\"fromRail\":\"arc-testnet\",\"toRail\":\"base-sepolia\"}",
              "{\"action\":\"quote_swap\",\"amount\":1,\"fromToken\":\"USDC\",\"toToken\":\"EURC\",\"settlementRail\":\"arc-testnet\"}",
              "{\"action\":\"quote_swap\",\"amount\":20,\"fromToken\":\"EURC\",\"toToken\":\"USDC\",\"settlementRail\":\"arc-testnet\"}",
              "{\"action\":\"quote_swap\",\"amount\":0.001,\"fromToken\":\"USDC\",\"toToken\":\"cirBTC\",\"settlementRail\":\"arc-testnet\"}",
              "{\"action\":\"propose_perp_trade\",\"symbol\":\"BTC\",\"side\":\"long\",\"collateralUsd\":1,\"leverage\":2}",
              "{\"action\":\"get_balance\"}",
              "{\"action\":\"propose_copy_trade\",\"traderHandle\":\"@alice\",\"capitalUsd\":25,\"settlementRail\":\"arc-testnet\"}",
              "{\"action\":\"get_defi_action_receipt\",\"actionId\":\"defi_0001\"}",
              "{\"action\":\"clarify\",\"question\":\"Which token do you want to buy?\"}"
            ].join("\n")
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: JSON.stringify({ text, defaultSettlementRail })
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: intentSchema()
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Agent model request failed");
  }

  return sanitizeModelIntent(JSON.parse(extractGeminiText(data)), defaultSettlementRail);
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
      positionId: { type: ["number", "null"] },
      marginUsd: { type: ["number", "null"] },
      limit: { type: ["number", "null"] },
      question: { type: ["string", "null"] }
    },
    required: [
      "action",
      "amount",
      "asset",
      "recipientHandle",
      "rule",
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
      "positionId",
      "marginUsd",
      "limit",
      "question"
    ],
    propertyOrdering: [
      "action",
      "amount",
      "asset",
      "recipientHandle",
      "rule",
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
      "positionId",
      "marginUsd",
      "limit",
      "question"
    ]
  };
}

function extractGeminiText(data) {
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    ?.join("")
    ?.trim();
  if (!text) throw new Error("Agent model returned no intent JSON");
  return text;
}

function sanitizeModelIntent(intent, defaultSettlementRail) {
  if (!intent || !ALLOWED_ACTIONS.has(intent.action)) {
    return clarify("I can send, bridge, swap, or prepare a perp proposal. What do you want to do?");
  }

  if (intent.action === "send_payment") {
    if (!positive(intent.amount) || !intent.recipientHandle) return clarify("How much USDC should I send, and to which X handle?");
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

  if (intent.action === "quote_bridge") {
    const fromRail = normalizeRail(intent.fromRail) || defaultSettlementRail;
    const toRail = normalizeRail(intent.toRail);
    const fromToken = normalizeSwapToken(intent.fromToken || intent.asset) || "USDC";
    const toToken = normalizeSwapToken(intent.toToken) || fromToken;
    if (!positive(intent.amount) || !toRail || fromRail === toRail) return clarify("How much should I bridge, which token, and to which rail?");
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
    if (!positive(intent.amount) || !toToken || fromToken === toToken) return clarify("Which token pair should I swap?");
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
    if (!symbol || !["long", "short"].includes(side) || !positive(intent.collateralUsd) || !positive(intent.leverage)) {
      return clarify("Tell me the perp symbol, side, collateral, and leverage.");
    }
    return {
      action: "propose_perp_trade",
      symbol,
      side,
      collateralUsd: Number(intent.collateralUsd),
      leverage: Number(intent.leverage)
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

function clarify(question) {
  return { action: "clarify", question };
}

function normalizeSwapToken(value) {
  const raw = String(value || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(raw)) return raw;
  const token = raw.toUpperCase();
  if (!token || ["ARC", "BASE", "FROM", "IN", "ON", "TO"].includes(token)) return null;
  if (token === "ETH") return "WETH";
  if (token === "CIRBTC") return "cirBTC";
  return token;
}

function isSupportedSwapPair({ settlementRail, fromToken, toToken }) {
  return Boolean(settlementRail && fromToken && toToken && fromToken !== toToken);
}

const MODEL_TOOL_ACTIONS = new Set([
  "get_balance",
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
  "appkit_readiness",
  "list_appkit_capabilities",
  "appkit_estimate_bridge",
  "appkit_bridge_usdc",
  "appkit_estimate_swap",
  "appkit_swap",
  "appkit_unified_balance",
  "resolve_x_handle",
  "list_defi_tools",
  "list_defi_actions",
  "reconcile_defi_action",
  "get_defi_action_receipt",
  "list_perp_markets"
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

  if (tool === "confirm_action" && !args.approvalId) return clarify("Which approval ID should I confirm?");
  if (tool === "get_receipt" && !args.paymentId) return clarify("Which payment ID should I look up?");
  if (["reconcile_defi_action", "get_defi_action_receipt"].includes(tool) && !args.actionId) return clarify("Which DeFi action ID should I use?");
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
