import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJson } from "../api";
import "./Agents.css";

const ACCESS_STEPS = [
  {
    title: "Discover",
    text: "Read the live capability surface, supported rails, launchpad status, and MCP tool list before planning an action."
  },
  {
    title: "Get Key",
    text: "A signed-in user creates a scoped API key, then gives only that bearer token to the agent runtime."
  },
  {
    title: "Authorize",
    text: "Send Authorization: Bearer bunos_mcp_... on REST, SDK, or MCP calls. The key binds actions to the key owner's handle."
  },
  {
    title: "Act",
    text: "Use task-specific skills for launch, swaps, bridges, wallet reads, treasury, or automation. Stop on approvals."
  }
];

const ACCESS_MODES = [
  {
    title: "MCP",
    fit: "Agent-native clients",
    text: "Use the MCP transport when the agent runtime can load tools and call them directly.",
    link: "/mcp-guide",
    linkLabel: "Open MCP Guide"
  },
  {
    title: "SDK",
    fit: "Node apps and hosted agents",
    text: "Use the JavaScript SDK when you own the runtime and want typed helper methods.",
    link: "#sdk",
    linkLabel: "View SDK"
  },
  {
    title: "REST",
    fit: "Any HTTP-capable agent",
    text: "Use REST when your agent can only issue HTTP requests or needs deterministic endpoint calls.",
    link: "#rest",
    linkLabel: "View REST"
  }
];

const AGENT_SKILLS = [
  {
    title: "Token Launch Skill",
    purpose: "Create an Arc token, seed locked USDC liquidity, open trading, and publish a receipt.",
    trigger: "launch a token, create token, go live, seed liquidity",
    scopes: "mcp:trade",
    tools: ["plan_token_launch", "create_token_launch", "deploy_launch_token", "seed_launch_liquidity", "open_launch_trading", "monitor_launch"],
    flow: ["Plan first", "Create draft", "Deploy token", "Seed liquidity", "Open trading", "Read receipt"]
  },
  {
    title: "Swap Skill",
    purpose: "Quote or run supported token swaps while respecting execution readiness and policy limits.",
    trigger: "swap USDC to EURC, buy token, quote route",
    scopes: "mcp:trade",
    tools: ["quote_defi_route", "confirm_defi_action", "get_defi_action_receipt"],
    flow: ["Check /api/config", "Quote route", "Review slippage", "Execute only when enabled", "Return receipt"]
  },
  {
    title: "Bridge Skill",
    purpose: "Move supported assets between Arc testnet and supported destination rails.",
    trigger: "bridge USDC to Base, move funds, transfer rail",
    scopes: "mcp:trade",
    tools: ["quote_defi_route", "confirm_defi_action", "get_defi_action_receipt"],
    flow: ["Resolve source rail", "Quote bridge", "Check amount limit", "Stop on approval", "Track receipt"]
  },
  {
    title: "Wallet Skill",
    purpose: "Read balances, sync Circle wallets, request testnet funds, and inspect wallet capabilities.",
    trigger: "show balance, fund wallet, wallet readiness",
    scopes: "mcp:read or mcp:wallets",
    tools: ["get_balance", "get_wallet_capabilities", "sync_circle_balances", "request_testnet_usdc"],
    flow: ["Resolve handle", "Read capability", "Sync if needed", "Return balances"]
  },
  {
    title: "Treasury Skill",
    purpose: "Track launch fees, compute credits, runway, and agent self-funding status.",
    trigger: "show treasury, claim fees, spend compute, runway",
    scopes: "mcp:read or mcp:trade",
    tools: ["get_launch_fees", "claim_launch_fees", "get_agent_treasury", "spend_agent_compute"],
    flow: ["Read launch fees", "Claim to compute", "Check runway", "Spend only existing credits"]
  },
  {
    title: "Automation Skill",
    purpose: "Create recurring wallet or agent jobs with controlled intervals and explicit status.",
    trigger: "sync every 10 minutes, run this daily, pause automation",
    scopes: "mcp:automations",
    tools: ["create_automation", "list_automations", "run_due_automations", "pause_automation"],
    flow: ["Parse schedule", "Create automation", "Report next run", "Pause or resume by id"]
  }
];

const REST_ENDPOINTS = [
  ["GET", "/api/config", "Discover provider mode, AI planner mode, supported settlement rails, and execution readiness."],
  ["GET", "/api/agent/tools", "List tools an agent is allowed to plan or run."],
  ["GET", "/api/mcp/tools", "Read MCP tool schemas for direct tool-call integration."],
  ["POST", "/api/agent/plan", "Convert natural language into a proposed action without executing it."],
  ["POST", "/api/agent/run", "Plan and execute an allowed natural-language action."],
  ["POST", "/api/mcp/call", "Call one MCP tool directly over HTTP."],
  ["GET", "/api/launchpad/architecture", "Discover launchpad lifecycle, liquidity model, and agent launch policy."],
  ["GET", "/api/launchpad/feed", "Discover live public token launches."],
  ["POST", "/api/launchpad/plan", "Preview a token launch."],
  ["POST", "/api/launchpad/launches", "Create a token launch draft."],
  ["POST", "/api/launchpad/launches/:id/deploy-token", "Deploy the token for a launch."],
  ["POST", "/api/launchpad/launches/:id/seed-liquidity", "Seed locked TOKEN/USDC liquidity."],
  ["POST", "/api/launchpad/launches/:id/go-live", "Open trading for a launch."],
  ["GET", "/api/launchpad/launches/:id/receipt", "Read the launch receipt."],
  ["GET", "/api/launchpad/treasury", "Read agent launch treasury and compute runway."]
];

export default function Agents() {
  const [origin, setOrigin] = useState("checking...");
  const [toolCount, setToolCount] = useState("...");
  const [mode, setMode] = useState({
    providerMode: "checking",
    transferProvider: "checking",
    aiMode: "checking",
    rails: []
  });

  useEffect(() => {
    setOrigin(window.location.origin);
    fetchJson("/api/agent/tools")
      .then((data) => setToolCount(String(data.tools?.length || 0)))
      .catch(() => setToolCount("unavailable"));

    fetchJson("/api/config")
      .then((data) => setMode({
        providerMode: data.providerMode || "unknown",
        transferProvider: data.transferProvider || "unknown",
        aiMode: data.ai?.mode || (data.ai?.enabled ? "model" : "fallback"),
        rails: data.settlementRails?.map((rail) => rail.id) || []
      }))
      .catch(() => {});
  }, []);

  const baseUrl = useMemo(() => origin === "checking..." ? "https://bunos.xyz" : origin, [origin]);

  return (
    <main className="agents-page">
      <section className="agents-hero">
        <div className="agents-hero-copy">
          <span className="agents-kicker">Agent Integration</span>
          <h1>Everything an autonomous agent needs to use bunOS.</h1>
          <p>
            Discover capabilities, get an API key, authorize calls, launch tokens,
            use swaps and bridges, and load task-specific skills from one page.
          </p>
          <div className="agents-hero-actions">
            <Link className="primary-action" to="/api-keys">Get API Key</Link>
            <a className="secondary-action" href="#skills">View Skills</a>
            <Link className="secondary-action" to="/mcp-guide">MCP Setup</Link>
          </div>
        </div>
        <div className="agents-status-panel" aria-label="Live agent access status">
          <StatusItem label="Origin" value={baseUrl} />
          <StatusItem label="Tools" value={toolCount} />
          <StatusItem label="Mode" value={mode.providerMode} />
          <StatusItem label="Transfers" value={mode.transferProvider} />
          <StatusItem label="Planner" value={mode.aiMode} />
          <StatusItem label="Rails" value={mode.rails.join(", ") || "loading"} />
        </div>
      </section>

      <section className="agents-section">
        <SectionTitle index="01" title="Agent Path" />
        <div className="agents-path">
          {ACCESS_STEPS.map((step, index) => (
            <div className="agents-path-step" key={step.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step.title}</strong>
              <p>{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="agents-section">
        <SectionTitle index="02" title="Access Modes" />
        <div className="agents-mode-grid">
          {ACCESS_MODES.map((modeOption) => (
            <article className="agents-mode-card" key={modeOption.title}>
              <span>{modeOption.fit}</span>
              <strong>{modeOption.title}</strong>
              <p>{modeOption.text}</p>
              {modeOption.link.startsWith("/") ? (
                <Link to={modeOption.link}>{modeOption.linkLabel}</Link>
              ) : (
                <a href={modeOption.link}>{modeOption.linkLabel}</a>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="agents-section" id="keys">
        <SectionTitle index="03" title="API Keys And Authorization" />
        <div className="agents-two-column">
          <div className="agents-card">
            <h3>How an agent gets access</h3>
            <ol className="agents-ordered">
              <li>A human signs in and opens <Link to="/api-keys">API Keys</Link>.</li>
              <li>They create a key with the minimum required scopes.</li>
              <li>The agent stores only the <code>bunos_mcp_...</code> bearer token.</li>
              <li>Every action is scoped to the key owner, even if the request body tries another handle.</li>
            </ol>
          </div>
          <CodeBlock label="Headers">{`Authorization: Bearer bunos_mcp_...\nContent-Type: application/json\nIdempotency-Key: agent-action-001`}</CodeBlock>
        </div>
      </section>

      <section className="agents-section" id="skills">
        <SectionTitle index="04" title="Task Skills" />
        <p className="agents-section-copy">
          Skills are the recommended operating recipes for autonomous agents. Pick the smallest skill that matches the user intent,
          check readiness first, then execute only the listed flow.
        </p>
        <div className="agents-skill-grid">
          {AGENT_SKILLS.map((skill) => <SkillCard key={skill.title} skill={skill} />)}
        </div>
      </section>

      <section className="agents-section" id="sdk">
        <SectionTitle index="05" title="SDK Quick Start" />
        <div className="agents-two-column">
          <CodeBlock label="Create client">{`import { createBunosClient } from "./sdk/js/index.js";\n\nconst bunos = createBunosClient({\n  baseUrl: "${baseUrl}",\n  apiKey: process.env.BUNOS_API_KEY\n});`}</CodeBlock>
          <CodeBlock label="Discover capabilities">{`const config = await bunos.config();\nconst tools = await bunos.agentTools();\nconst feed = await bunos.listLaunchFeed({ status: "live" });`}</CodeBlock>
        </div>
        <div className="agents-code-grid">
          <CodeBlock label="Launch token with SDK">{`const created = await bunos.createTokenLaunch({\n  creatorHandle: "@sara",\n  name: "Arc Creator Token",\n  symbol: "ARCC",\n  liquiditySeedUsd: 100,\n  liquidityLockDays: 90,\n  grants: ["deploy_token", "seed_liquidity", "open_trading"],\n  idempotencyKey: "launch-arcc-001"\n});\n\nawait bunos.deployLaunchToken(created.launch.id, {\n  idempotencyKey: "launch-arcc-deploy"\n});\nawait bunos.seedLaunchLiquidity(created.launch.id, {\n  amountUsd: 100,\n  idempotencyKey: "launch-arcc-liquidity"\n});\nawait bunos.openLaunchTrading(created.launch.id, {\n  idempotencyKey: "launch-arcc-live"\n});\n\nconst receipt = await bunos.getLaunchReceipt(created.launch.id);`}</CodeBlock>
          <CodeBlock label="Swap or bridge with SDK">{`const swapPlan = await bunos.plan({\n  handle: "@sara",\n  input: "swap 5 USDC to EURC on Arc"\n});\n\nconst bridgePlan = await bunos.plan({\n  handle: "@sara",\n  input: "bridge 3 USDC from Arc testnet to Base Sepolia"\n});\n\nconst result = await bunos.run({\n  handle: "@sara",\n  input: "show my wallet balance",\n  idempotencyKey: "agent-balance-001"\n});`}</CodeBlock>
        </div>
      </section>

      <section className="agents-section" id="rest">
        <SectionTitle index="06" title="REST Quick Start" />
        <div className="agents-code-grid">
          <CodeBlock label="Plan natural language">{`curl -X POST ${baseUrl}/api/agent/plan \\\n  -H "Authorization: Bearer bunos_mcp_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "handle": "@sara",\n    "text": "swap 5 USDC to EURC on Arc"\n  }'`}</CodeBlock>
          <CodeBlock label="Call MCP tool directly">{`curl -X POST ${baseUrl}/api/mcp/call \\\n  -H "Authorization: Bearer bunos_mcp_..." \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: direct-tool-001" \\\n  -d '{\n    "tool": "create_token_launch",\n    "arguments": {\n      "creatorHandle": "@sara",\n      "name": "Arc Creator Token",\n      "symbol": "ARCC",\n      "liquiditySeedUsd": 100,\n      "liquidityLockDays": 90,\n      "grants": ["deploy_token", "seed_liquidity", "open_trading"]\n    }\n  }'`}</CodeBlock>
        </div>
      </section>

      <section className="agents-section">
        <SectionTitle index="07" title="Endpoint Map" />
        <div className="agents-endpoint-list">
          {REST_ENDPOINTS.map(([method, path, desc]) => (
            <Endpoint key={`${method}-${path}`} method={method} path={path} desc={desc} />
          ))}
        </div>
      </section>

      <section className="agents-section">
        <SectionTitle index="08" title="Operating Rules" />
        <div className="agents-rule-grid">
          <Rule title="Plan before impact" text="For launch, swap, bridge, payment, and treasury actions, call plan first unless the user already gave an exact command." />
          <Rule title="Use idempotency" text="Every write call should send an Idempotency-Key so retries do not duplicate launches, payments, liquidity actions, or claims." />
          <Rule title="Stop on approvals" text="If a response requires approval, return the approval or receipt to the user and do not retry execution." />
          <Rule title="Never pass secrets" text="Do not put API keys, OAuth tokens, private keys, entity secrets, or wallet secrets in tool arguments." />
          <Rule title="Respect scope" text="Use the smallest key scope and do not ask for wallet or trade access when read access is enough." />
          <Rule title="Read readiness" text="Call /api/config before assuming live execution, model routing, Circle wallets, Arc RPC, or supported rails are available." />
        </div>
      </section>
    </main>
  );
}

function SectionTitle({ index, title }) {
  return (
    <div className="agents-section-head">
      <span>{index}</span>
      <h2>{title}</h2>
    </div>
  );
}

function StatusItem({ label, value }) {
  return (
    <div className="agents-status-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SkillCard({ skill }) {
  return (
    <article className="agents-skill-card">
      <div className="agents-skill-head">
        <span>{skill.scopes}</span>
        <h3>{skill.title}</h3>
        <p>{skill.purpose}</p>
      </div>
      <div className="agents-skill-detail">
        <strong>Trigger</strong>
        <p>{skill.trigger}</p>
      </div>
      <div className="agents-chip-list">
        {skill.tools.map((tool) => <code key={tool}>{tool}</code>)}
      </div>
      <ol className="agents-flow-list">
        {skill.flow.map((item) => <li key={item}>{item}</li>)}
      </ol>
    </article>
  );
}

function Endpoint({ method, path, desc }) {
  return (
    <div className="agents-endpoint">
      <span className={`agents-method ${method.toLowerCase()}`}>{method}</span>
      <code>{path}</code>
      <p>{desc}</p>
    </div>
  );
}

function Rule({ title, text }) {
  return (
    <div className="agents-rule">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function CodeBlock({ label, children }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="agents-code">
      <div className="agents-code-head">
        <span>{label}</span>
        <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}
