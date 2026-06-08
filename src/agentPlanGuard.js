const MAX_PLAN_ARGUMENT_CHARS = 20_000;
const FORBIDDEN_KEYS = /(?:private.?key|secret|api.?key|kit.?key|entity.?secret|mnemonic|seed.?phrase|access.?token|refresh.?token|authorization|wallet.?set.?id)/i;
const SECRET_PATTERNS = [
  /(?:xai|sk)-[A-Za-z0-9_-]{20,}/,
  /KIT_KEY:[A-Za-z0-9:_-]+/,
  /\b0x[a-fA-F0-9]{64}\b/
];
const RAILS = new Set(["arc-testnet", "base-sepolia"]);
const SIDES = new Set(["long", "short"]);

export function validateAgentPlanContract({ planned = {} } = {}) {
  const plan = planned.plan || {};
  const tool = plan.tool || null;
  if (!tool) return contractResult(true, [], ["clarification_only"]);

  const args = plan.arguments || {};
  const issues = [];
  const checks = [
    "tool_present",
    "backend_signer_disabled",
    "argument_budget",
    "secret_free_arguments",
    "handle_ownership",
    "tool_required_fields",
    "numeric_bounds",
    "rail_values"
  ];

  if (plan.signer?.backendSignerAllowed !== false && planned.signer?.backendSignerAllowed !== false) {
    issues.push("The plan does not prove that backend signing is disabled.");
  }

  const serialized = safeSerialize(args);
  if (serialized.length > MAX_PLAN_ARGUMENT_CHARS) {
    issues.push(`Plan arguments exceed ${MAX_PLAN_ARGUMENT_CHARS} characters.`);
  }
  inspectValue(args, issues);

  const owner = normalizeHandleLocal(planned.handle);
  for (const key of ["handle", "senderHandle", "ownerHandle"]) {
    if (args[key] && owner && normalizeHandleLocal(args[key]) !== owner) {
      issues.push(`Plan argument ${key} does not match the authenticated handle.`);
    }
  }

  validateRequiredFields(tool, args, issues);
  validateNumbers(args, issues);
  validateRails(args, issues);

  if (args.side && !SIDES.has(String(args.side).toLowerCase())) {
    issues.push("Perp side must be long or short.");
  }

  return contractResult(issues.length === 0, issues, checks);
}

export function assertAgentPlanContract({ planned } = {}) {
  const contract = planned?.contract || validateAgentPlanContract({ planned });
  if (!contract.ok) {
    const error = new Error(`Agent plan rejected: ${contract.issues.join(" ")}`);
    error.code = "AGENT_PLAN_REJECTED";
    error.contract = contract;
    throw error;
  }
  return contract;
}

function validateRequiredFields(tool, args, issues) {
  if (tool === "send_usdc") {
    requirePositive(args.amount, "amount", issues);
    requireValue(args.recipientHandle, "recipientHandle", issues);
  }
  if (tool === "quote_defi_route") {
    requirePositive(args.amount, "amount", issues);
    requireValue(args.type, "type", issues);
    requireValue(args.fromRail, "fromRail", issues);
    requireValue(args.toRail, "toRail", issues);
    requireValue(args.fromToken, "fromToken", issues);
    requireValue(args.toToken, "toToken", issues);
    if (!["swap", "bridge"].includes(String(args.type || "").toLowerCase())) {
      issues.push("DeFi route type must be swap or bridge.");
    }
  }
  if (tool === "propose_perp_trade") {
    requireValue(args.symbol, "symbol", issues);
    requireValue(args.side, "side", issues);
    requirePositive(args.collateralUsd, "collateralUsd", issues);
    requirePositive(args.leverage, "leverage", issues);
  }
  if (tool === "confirm_action") {
    requireValue(args.approvalId, "approvalId", issues);
  }
  if (tool === "create_automation") {
    if (!args.text && !args.kind) issues.push("Automation plan requires an action.");
    if (!positive(args.intervalMs) && !positive(args.intervalSeconds) && !positive(args.intervalMinutes)) {
      issues.push("Automation plan requires a positive interval.");
    }
  }
  if (tool === "create_agent_workflow") {
    if (!Array.isArray(args.steps) || args.steps.length < 2 || args.steps.length > 4) {
      issues.push("Agent workflow requires between two and four steps.");
    }
    if (args.steps?.some((step) => (
      !step?.action
      || step.action === "create_workflow"
      || (step.action === "tool_call" && String(step.tool || "").includes("agent_workflow"))
    ))) {
      issues.push("Agent workflow contains an invalid or nested step.");
    }
  }
  if (["resume_agent_workflow", "get_agent_workflow", "cancel_agent_workflow"].includes(tool)) {
    requireValue(args.workflowId, "workflowId", issues);
  }
}

function validateNumbers(value, issues, path = "") {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const label = path ? `${path}.${key}` : key;
    if (item && typeof item === "object") {
      validateNumbers(item, issues, label);
      continue;
    }
    if (!/(?:amount|usd|leverage|interval|runs|limit)$/i.test(key)) continue;
    if (item === undefined || item === null) continue;
    if (!Number.isFinite(Number(item)) || Number(item) <= 0) {
      issues.push(`Plan argument ${label} must be a positive number.`);
    }
  }
}

function validateRails(args, issues) {
  for (const key of ["settlementRail", "fromRail", "toRail"]) {
    if (!args[key]) continue;
    if (!RAILS.has(String(args[key]).toLowerCase())) {
      issues.push(`Plan argument ${key} uses an unsupported rail.`);
    }
  }
}

function inspectValue(value, issues, path = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectValue(item, issues, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const label = path ? `${path}.${key}` : key;
      if (FORBIDDEN_KEYS.test(key)) issues.push(`Plan arguments contain forbidden field ${label}.`);
      inspectValue(item, issues, label);
    }
    return;
  }
  if (typeof value !== "string") return;
  if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    issues.push(`Plan argument ${path || "value"} contains secret-shaped data.`);
  }
}

function contractResult(ok, issues, checks) {
  return {
    version: 1,
    ok,
    issues: Array.from(new Set(issues)),
    checks,
    maxArgumentChars: MAX_PLAN_ARGUMENT_CHARS
  };
}

function requirePositive(value, name, issues) {
  if (!positive(value)) issues.push(`Plan requires a positive ${name}.`);
}

function requireValue(value, name, issues) {
  if (value === undefined || value === null || value === "") issues.push(`Plan requires ${name}.`);
}

function positive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function safeSerialize(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "x".repeat(MAX_PLAN_ARGUMENT_CHARS + 1);
  }
}

function normalizeHandleLocal(handle) {
  if (!handle) return null;
  const value = String(handle).trim().toLowerCase();
  return value.startsWith("@") ? value : `@${value}`;
}
