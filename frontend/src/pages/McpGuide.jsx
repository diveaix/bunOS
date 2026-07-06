import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJson } from "../api";
import BrandLogo from "../components/BrandLogo";
import "./McpGuide.css";

export default function McpGuide() {
  const [toolCount, setToolCount] = useState("40+");
  const [origin, setOrigin] = useState("checking...");

  useEffect(() => {
    setOrigin(window.location.origin);
    fetchJson("/api/mcp/tools")
      .then((data) => setToolCount(String(data.tools?.length || "40+")))
      .catch(() => {});
  }, []);

  return (
    <main className="mcp-page-wrap">
      <div className="mcp-page">
        {/* Hero */}
        <div className="mcp-hero">
          <div className="hero-badge">MCP Server Active</div>
          <h1>Connect your AI to <span>bunOS</span></h1>
          <p>bunOS exposes a Model Context Protocol (MCP) server so AI agents in Claude, Cursor, Windsurf, or any MCP client can read balances, send funds, swap tokens, bridge rails, manage automations, and trade through the wallet tied to your X account.</p>
          <div className="status-strip">
            <div className="status-item"><span>MCP Origin</span><strong>{origin}</strong></div>
            <div className="status-item"><span>Tools</span><strong>{toolCount}</strong></div>
            <div className="status-item"><span>Signing</span><strong>user wallet gated</strong></div>
          </div>
        </div>

        {/* Step 1 */}
        <Section num="1" title="Use the hosted bunOS MCP server">
          <p>The production MCP server is available through the bunOS domain. Create an API key at <Link to="/api-keys">/api-keys</Link>, then use the URL and bearer token in your MCP client.</p>
          <CodeBlock label="Hosted endpoints">{`# MCP endpoint\nhttps://bunos.xyz/mcp\n\n# SSE endpoint\nhttps://bunos.xyz/mcp/sse\n\n# SSE messages endpoint\nhttps://bunos.xyz/mcp/messages`}</CodeBlock>
        </Section>

        {/* Step 2 */}
        <Section num="2" title="MCP transport endpoints">
          <p>bunOS supports both <strong>Streamable HTTP</strong> and <strong>SSE</strong> transports for maximum compatibility. Use these paths after the hosted origin <code>https://bunos.xyz</code>.</p>
          <table className="endpoint-table">
            <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>
            <tbody>
              <EndpointRow method="POST" path="/mcp" desc="Streamable HTTP - JSON-RPC over HTTP (recommended)" />
              <EndpointRow method="GET" path="/sse" desc="SSE transport - Server-Sent Events stream" />
              <EndpointRow method="GET" path="/mcp/sse" desc="SSE transport (prefixed variant)" />
              <EndpointRow method="POST" path="/messages" desc="SSE message handler" />
              <EndpointRow method="GET" path="/api/mcp/tools" desc="REST - List all available MCP tools" />
              <EndpointRow method="POST" path="/api/mcp/call" desc="REST - Call a tool directly (for testing)" />
            </tbody>
          </table>
        </Section>

        {/* Step 3 */}
        <Section num="3" title="Configure your MCP client">
          <p>Add the bunOS server to your MCP client's configuration file. Here are configs for common clients:</p>

          <h3 className="mcp-sub-head">Claude Desktop</h3>
          <p>Edit <code>claude_desktop_config.json</code> (macOS: <code>~/Library/Application Support/Claude/</code>, Windows: <code>%APPDATA%\Claude\</code>)</p>
          <CodeBlock label="claude_desktop_config.json">{mcpConfig("https://bunos.xyz/mcp")}</CodeBlock>

          <h3 className="mcp-sub-head">Cursor / Windsurf / VS Code</h3>
          <p>Add to your MCP config file (usually <code>.cursor/mcp.json</code> or equivalent):</p>
          <CodeBlock label="mcp.json">{mcpConfig("https://bunos.xyz/mcp")}</CodeBlock>

          <h3 className="mcp-sub-head">SSE Transport (legacy clients)</h3>
          <p>If your MCP client requires SSE transport instead of Streamable HTTP:</p>
          <CodeBlock label="mcp_config.json (SSE)">{mcpSseConfig()}</CodeBlock>

          <div className="info-card tip">
            <span className="info-icon">i</span>
            <p>The Streamable HTTP transport (<code>/mcp</code>) is recommended for new integrations. SSE is supported for backward compatibility through <code>/mcp/sse</code> and <code>/mcp/messages</code>.</p>
          </div>
        </Section>

        {/* Step 4 */}
        <Section num="4" title="Verify the connection">
          <p>Test that your MCP server is reachable by calling the discovery endpoint:</p>
          <CodeBlock label="Terminal">{`curl https://bunos.xyz/mcp\n\n# Should return:\n# { "name": "bunOS MCP", "transport": "json-rpc-over-http", ... }`}</CodeBlock>
          <p>Or list all available tools:</p>
          <CodeBlock label="Terminal">{`curl https://bunos.xyz/api/mcp/tools | jq '.tools[].name'`}</CodeBlock>
          <p>Call a tool directly for testing:</p>
          <CodeBlock label="Terminal">{`curl -X POST https://bunos.xyz/api/mcp/call \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer bunos_mcp_..." \\\n  -d '{"tool": "get_balance", "arguments": {"handle": "@sara"}}'`}</CodeBlock>
        </Section>

        <hr />

        {/* Step 5 - Tools Reference */}
        <Section num="5" title="Available MCP tools">
          <p>bunOS exposes <strong>{toolCount}</strong> MCP tools across wallets, payments, DeFi, AppKit, perps, and agent planning. Here are the key categories:</p>

          <ToolCategory title="Agent" tools={[
            ["plan_agent_action", "Parse natural language into a tool call plan"],
            ["run_agent_action", "Plan + run a safe allowlisted step; money movement stays approval-gated"],
            ["list_agent_tools", "List tools the agent planner can call"],
            ["list_arc_trading_primitives", "Inspect swap, bridge, trade, distribution, bounty, and automation readiness"],
          ]} />
          <ToolCategory title="Automations" tools={[
            ["create_automation", "Schedule balance syncs, agent actions, or DeFi reconciliation"],
            ["list_automations", "List active and paused recurring tasks"],
            ["run_automation", "Run one automation immediately"],
            ["run_due_automations", "Run every due active automation"],
            ["pause_automation", "Pause a recurring task without deleting it"],
            ["resume_automation", "Resume a paused recurring task"],
            ["delete_automation", "Remove a recurring task"],
          ]} />
          <ToolCategory title="Wallets" tools={[
            ["create_wallet", "Create a Circle wallet for an X handle"],
            ["get_balance", "Read wallet balances across rails"],
            ["get_wallet_capabilities", "Check what actions the wallet supports"],
            ["sync_circle_balances", "Refresh real Circle token balances"],
            ["request_testnet_usdc", "Request faucet testnet USDC"],
          ]} />
          <ToolCategory title="Payments" tools={[
            ["send_usdc", "Send USDC to another X handle"],
            ["create_payment_intent", "Create a policy-checked payment"],
            ["create_social_bounty", "Create a USDC bounty on an X post"],
            ["get_receipt", "Get a payment receipt and timeline"],
          ]} />
          <ToolCategory title="Distribution" tools={[
            ["create_airdrop", "Create a USDC distribution for X handles or a social recipient pool"],
            ["award_airdrop", "Complete a social distribution for selected X handles"],
            ["list_airdrops", "List campaign status, recipients, and budget"],
            ["get_airdrop_receipt", "Read the public receipt, approval state, payments, and timeline"],
          ]} />
          <ToolCategory title="DeFi" tools={[
            ["bridge_usdc", "Create a policy-checked USDC bridge quote"],
            ["quote_swap", "Quote a token swap"],
            ["quote_defi_route", "Create a policy-checked DeFi quote"],
            ["confirm_defi_action", "Confirm a quoted action and queue the user-wallet execution handoff"],
            ["demo_bridge_arc_to_base", "Demo bridge quote: Arc to Base Sepolia"],
          ]} />
          <ToolCategory title="Circle AppKit" tools={[
            ["appkit_readiness", "Check AppKit and Circle wallet execution readiness"],
            ["appkit_estimate_bridge", "Estimate a user-wallet USDC bridge"],
            ["appkit_bridge_usdc", "Execute a user-approved bridge when enabled"],
            ["appkit_estimate_swap", "Estimate a same-chain AppKit swap"],
            ["appkit_swap", "Execute a user-approved swap when enabled"],
          ]} />
          <ToolCategory title="Perps & Trading" tools={[
            ["propose_perp_trade", "Create a perp trade proposal"],
            ["assess_liquidation_risk", "Assess position liquidation risk"],
            ["quote_arc_perp_position", "Quote an Arc-settled perp position"],
            ["list_perp_intelligence", "Market intelligence with risk data"],
          ]} />
          <ToolCategory title="Approvals" tools={[
            ["list_approvals", "List pending or completed approvals"],
            ["confirm_action", "Confirm a pending approval"],
          ]} />
        </Section>

        <hr />

        {/* Step 6 - Example prompts */}
        <Section num="6" title="Example prompts for your AI">
          <p>Once connected, try asking your AI agent:</p>
          <CodeBlock label="Example prompts">{`"Create a wallet for @alice and check her balance"\n\n"Send $10 USDC from @sara to @alice"\n\n"Bridge $5 USDC from Arc testnet to Base Sepolia for @sara"\n\n"Quote a swap of $20 USDC to ETH on arc-testnet"\n\n"Drop $1 USDC to @alice and @bob from @sara"\n\n"Drop $0.50 USDC to first 10 replies for @sara"\n\n"List Arc trading primitives"\n\n"Show me all pending approvals for @sara"\n\n"Sync @sara balances every 10 minutes"\n\n"Automate swap $1 EURC to USDC every hour for @sara"\n\n"Propose a 2x long BTC perp trade with $20 collateral"\n\n"Check if ArcPerps contracts are deployed"`}</CodeBlock>
        </Section>

        <hr />

        {/* Step 7 - Security */}
        <Section num="7" title="Security & signing policy">
          <p>bunOS uses a <strong>zero-backend-signer</strong> architecture. The MCP server can plan, quote, and create approvals, but money-moving transactions are always gated:</p>
          <div className="info-card note">
            <span className="info-icon">i</span>
            <p><strong>No backend private keys.</strong> The server never uses a shared settlement private key for user funds. Execution flows through per-user Circle wallets and AppKit/Circle APIs with approval gates.</p>
          </div>
          <div className="info-card warn">
            <span className="info-icon">i</span>
            <p><strong>Confirmation required.</strong> High-risk actions (large payments, bridges, swaps, perp trades) create pending approvals that must be explicitly confirmed before execution.</p>
          </div>
          <div className="info-card tip">
            <span className="info-icon">i</span>
            <p><strong>Testnet by default.</strong> bunOS runs on Arc Testnet and Base Sepolia. No real funds are at risk during development.</p>
          </div>
        </Section>
      </div>
    </main>
  );
}

/* ─── Sub-components ───────────────────────────── */

function Section({ num, title, children }) {
  return (
    <div className="mcp-section">
      <div className="section-head">
        <div className="step-number">{num}</div>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function CodeBlock({ label, children }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-label">{label}</span>
        <button className={`code-copy${copied ? " copied" : ""}`} onClick={handleCopy}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="code-body">{children}</pre>
    </div>
  );
}

function EndpointRow({ method, path, desc }) {
  const cls = method === "GET" ? "get" : "post";
  return (
    <tr>
      <td><span className={`method-badge ${cls}`}>{method}</span></td>
      <td><code>{path}</code></td>
      <td>{desc}</td>
    </tr>
  );
}

function ToolCategory({ title, tools }) {
  return (
    <>
      <h3 className="tool-category-title">{title}</h3>
      <div className="tool-grid">
        {tools.map(([name, desc]) => (
          <div className="tool-chip" key={name}>
            <strong>{name}</strong>
            <span>{desc}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ─── Helpers ──────────────────────────────────── */

function mcpConfig(url) {
  return JSON.stringify({
    mcpServers: {
      bunos: {
        url,
        headers: { Authorization: "Bearer bunos_mcp_..." },
      },
    },
  }, null, 2);
}

function mcpSseConfig() {
  return JSON.stringify({
    mcpServers: {
      bunos: {
        transport: "sse",
        url: "https://bunos.xyz/mcp/sse",
        headers: { Authorization: "Bearer bunos_mcp_..." },
      },
    },
  }, null, 2);
}
