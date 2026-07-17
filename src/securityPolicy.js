import { ledger } from "./fixtures.js";
import { nextEventId } from "./ids.js";

const READ_TOOLS = new Set([
  "list_agent_tools",
  "plan_agent_action",
  "get_launchpad_architecture",
  "plan_token_launch",
  "get_token_launch",
  "list_token_launches",
  "get_launch_receipt",
  "monitor_launch",
  "get_launch_fees",
  "get_agent_treasury",
  "list_launch_feed",
  "get_balance",
  "analyze_portfolio",
  "get_wallet_capabilities",
  "list_arc_trading_primitives",
  "list_approvals",
  "get_receipt",
  "list_airdrops",
  "get_airdrop_receipt",
  "list_copy_trade_proposals",
  "appkit_readiness",
  "list_appkit_capabilities",
  "appkit_estimate_send",
  "appkit_estimate_bridge",
  "appkit_estimate_swap",
  "appkit_unified_balance",
  "resolve_x_handle",
  "list_defi_tools",
  "list_defi_actions",
  "get_defi_action_receipt",
  "list_strategy_policies",
  "plan_rebalance_strategy",
  "reduce_risk_strategy",
  "get_market_intelligence",
  "get_market_feed_snapshot",
  "list_mandates"
]);

const PAYMENT_TOOLS = new Set([
  "send_usdc",
  "create_payment_intent",
  "create_social_bounty",
  "create_airdrop",
  "award_airdrop"
]);

const APPROVAL_TOOLS = new Set(["confirm_action"]);

const TRADE_TOOLS = new Set([
  "run_agent_action",
  "create_token_launch",
  "deploy_launch_token",
  "seed_launch_liquidity",
  "open_launch_trading",
  "accrue_launch_fees",
  "claim_launch_fees",
  "spend_agent_compute",
  "quote_defi_route",
  "bridge_usdc",
  "demo_bridge_arc_to_base",
  "quote_swap",
  "confirm_defi_action",
  "reconcile_defi_action",
  "refresh_execution_monitor",
  "propose_copy_trade",
  "appkit_send_usdc",
  "appkit_bridge_usdc",
  "appkit_swap",
  "create_strategy_policy",
  "run_strategy_check",
  "create_mandate",
  "update_mandate",
  "delete_mandate"
]);

const LAUNCH_POLICY_TOOLS = new Set([
  "update_launch_agent_policy"
]);

const AUTOMATION_TOOLS = new Set([
  "create_automation",
  "list_automations",
  "run_automation",
  "run_due_automations",
  "pause_automation",
  "resume_automation",
  "delete_automation"
]);

const WALLET_ADMIN_TOOLS = new Set([
  "create_wallet",
  "sync_circle_balances",
  "request_testnet_usdc"
]);

export function requiredScopesForTool(tool) {
  if (READ_TOOLS.has(tool)) return ["mcp:read"];
  if (PAYMENT_TOOLS.has(tool)) return ["mcp:payments"];
  if (APPROVAL_TOOLS.has(tool)) return ["mcp:approvals"];
  if (LAUNCH_POLICY_TOOLS.has(tool)) return ["mcp:approvals"];
  if (TRADE_TOOLS.has(tool)) return ["mcp:trade"];
  if (AUTOMATION_TOOLS.has(tool)) return ["mcp:automations"];
  if (WALLET_ADMIN_TOOLS.has(tool)) return ["mcp:wallets"];
  return ["mcp:tools"];
}

export function assertMcpToolAuthorized(tool, context = {}) {
  if (!context.handle) return true;
  if (isMcpToolAllowed(tool, context)) return true;
  const scopes = normalizeScopes(context.scopes);
  const required = requiredScopesForTool(tool);

  recordSecurityEvent("mcp_scope_denied", {
    handle: context.handle,
    keyId: context.keyId || null,
    tool,
    requiredScopes: required,
    scopes: Array.from(scopes)
  });
  const error = new Error(`MCP key is missing required scope for ${tool}: ${required.join(" or ")}`);
  error.status = 403;
  throw error;
}

export function isMcpToolAllowed(tool, context = {}) {
  if (!context.handle) return true;
  const scopes = normalizeScopes(context.scopes);
  if (scopes.has("mcp:*") || scopes.has("mcp:tools")) return true;
  const required = requiredScopesForTool(tool);
  return required.some((scope) => scopes.has(scope));
}

export function securityTrace({ handle, tool, context = {}, status = "allowed" } = {}) {
  return {
    handle: handle || context.handle || null,
    tool,
    status,
    keyId: context.keyId || null,
    scopes: context.scopes || [],
    backendSignerAllowed: false,
    at: new Date().toISOString()
  };
}

export function recordSecurityEvent(type, event = {}) {
  ledger.events.push({
    id: nextEventId(),
    at: new Date().toISOString(),
    type,
    ...redactSecurityEvent(event)
  });
}

function normalizeScopes(scopes) {
  const values = Array.isArray(scopes) ? scopes : String(scopes || "").split(",");
  return new Set(values.map((scope) => String(scope).trim()).filter(Boolean));
}

function redactSecurityEvent(event) {
  const next = { ...event };
  delete next.secret;
  delete next.token;
  delete next.authorization;
  delete next.accessToken;
  delete next.refreshToken;
  delete next.privateKey;
  return next;
}
