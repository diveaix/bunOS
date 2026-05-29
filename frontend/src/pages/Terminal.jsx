import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../hooks/useSession";
import { fetchJson, post, compactAddress, compactHash, formatTokenAmount, requestJson, isLiveWallet } from "../api";
import BrandLogo from "../components/BrandLogo";
import "./Terminal.css";

const SUGGESTIONS = [
  "send $10 to @alice",
  "bridge $1 USDC from arc to base",
  "swap $1 EURC to USDC on arc",
  "swap $1 USDC to cirBTC on arc",
  "drop $1 to @alice @bob",
  "drop $0.50 to first 10 replies",
  "long BTC 2x with $1",
  "close my last perp",
  "list arc trading primitives",
  "show my balance",
  "sync balances every 10 minutes",
  "list automations",
  "appkit readiness",
  "what can you do?",
];

export default function Terminal() {
  const { currentHandle, logout } = useSession();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [walletLabel, setWalletLabel] = useState("Connecting wallet...");
  const [latestApprovalId, setLatestApprovalId] = useState(null);
  const chatRef = useRef(null);
  const inputRef = useRef(null);
  const handleRef = useRef(currentHandle || localStorage.getItem("arcpay:handle") || "");

  useEffect(() => {
    if (currentHandle) handleRef.current = currentHandle;
  }, [currentHandle]);

  useEffect(() => {
    hydrateWallet();
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const addMessage = useCallback((role, content, html) => {
    setMessages((prev) => [...prev, { id: Date.now() + Math.random(), role, content, html }]);
  }, []);

  const hydrateWallet = async () => {
    try {
      const [sessionData, walletData] = await Promise.all([
        fetchJson("/api/session"),
        fetchJson("/api/wallets"),
      ]);
      const wallets = walletData.wallets || [];
      const sessionHandle = sessionData.session?.handle;
      const liveWallet = wallets.find(isLiveWallet);
      let handle = handleRef.current;

      if (!handle || !wallets.find((w) => w.handle === handle)) {
        handle = sessionHandle || liveWallet?.handle || wallets.find((w) => w.onboarded)?.handle || "@sara";
      }

      handleRef.current = handle;
      localStorage.setItem("arcpay:handle", handle);

      const wallet = wallets.find((w) => w.handle === handle);
      setWalletLabel(
        wallet?.walletAddress
          ? `${handle} - ${compactAddress(wallet.walletAddress)}`
          : `${handle} - connect wallet`
      );
    } catch {
      setWalletLabel(handleRef.current || "wallet unavailable");
    }
  };

  const handleLogout = async () => {
    await logout();
    handleRef.current = "";
    setLatestApprovalId(null);
    setWalletLabel("Not connected");
    addMessage("agent", null, "Logged out. Connect X from the wallet page to use wallet actions again.");
  };

  const handleSubmit = async (text) => {
    const value = (text || input).trim();
    if (!value || busy) return;
    setInput("");

    setMessages((prev) => prev.filter((m) => m.role !== "welcome"));
    addMessage("user", value);
    setBusy(true);

    try {
      if (isHelpIntent(value)) {
        addMessage("agent", null, formatHelp());
        return;
      }

      if (!handleRef.current) {
        addMessage("agent", null, `<span style="color:var(--red)">!</span> Connect X from the wallet page before asking the agent to trade.`);
        return;
      }

      if (isApprovalIntent(value) && latestApprovalId) {
        const data = await confirmApproval(latestApprovalId);
        addMessage("agent", null, formatApprovalResult(data));
        return;
      }

      if (isAutomationIntent(value)) {
        const data = await runAutomationCommand(value, handleRef.current);
        addMessage("agent", null, formatAutomationResult(data));
        return;
      }

      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: handleRef.current,
          text: value,
          defaultSettlementRail: localStorage.getItem("arcpay:rail") || "arc-testnet",
          source: "terminal",
          fast: true,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.ok === false) {
        if (data.execution) {
          addMessage("agent", null, formatResult(data));
          trackApproval(data);
        } else if (data.planned?.plan?.reason) {
          addMessage("agent", null, formatClarification(data));
        } else {
          addMessage("agent", null, formatError(data));
        }
      } else {
        addMessage("agent", null, formatResult(data));
        trackApproval(data);
      }
    } catch (err) {
      addMessage("agent", null, formatError({ error: err.message }));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const handleApprovalClick = async (approvalId) => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await confirmApproval(approvalId);
      addMessage("agent", null, formatApprovalResult(data));
    } catch (err) {
      addMessage("agent", null, formatError({ error: err.message }));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const confirmApproval = async (approvalId) => {
    const res = await fetch("/api/actions/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalId, handle: handleRef.current }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || "Approval failed");
    try {
      data.worker = await post("/api/jobs/run-due", { limit: 10 });
    } catch {}
    setLatestApprovalId(null);
    return data;
  };

  const trackApproval = (data) => {
    const payment = data.result?.payment;
    const action = data.result?.action;
    const proposal = data.result?.proposal;
    const airdrop = data.result?.airdrop;
    const id = payment?.approvalId || action?.approvalId || proposal?.approvalId || airdrop?.approvalId;
    if (id) setLatestApprovalId(id);
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="terminal-app">
      <header className="terminal-header">
        <Link to="/" className="header-brand">
          <BrandLogo size={32} />
          <span className="header-title">bunOS</span>
        </Link>
        <span className="header-tag">Terminal</span>
        <div className="header-spacer" />
        <span className="wallet-pill">{walletLabel}</span>
        <Link to="/wallet" className="header-link">&larr; Wallet</Link>
        <button type="button" className="logout-button" onClick={handleLogout}>Logout</button>
      </header>

      <div className="terminal-chat" id="chat" ref={chatRef} onClick={(e) => {
        const btn = e.target.closest("[data-approval-id]");
        if (btn) handleApprovalClick(btn.dataset.approvalId);
      }}>
        {!hasMessages && (
          <div className="welcome">
            <div className="welcome-icon"><BrandLogo size={48} /></div>
            <h2>bunOS Agent Terminal</h2>
            <p>Talk to the bunOS agent in natural language. Send USDC, bridge tokens, swap assets, and manage your wallet through chat.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((cmd) => (
                <button className="suggestion-chip" key={cmd} onClick={() => handleSubmit(cmd)}>
                  {cmd}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div className={`msg ${msg.role}`} key={msg.id}>
            <div className="msg-avatar">{msg.role === "user" ? "Y" : "A"}</div>
            <div className="msg-body">
              <div className="msg-role">{msg.role === "user" ? "You" : "bunOS Agent"}</div>
              {msg.html ? (
                <div className="msg-content" dangerouslySetInnerHTML={{ __html: msg.html }} />
              ) : (
                <div className="msg-content">{msg.content}</div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="msg agent">
            <div className="msg-avatar">A</div>
            <div className="msg-body">
              <div className="msg-role">bunOS Agent</div>
              <div className="typing"><span /><span /><span /></div>
            </div>
          </div>
        )}
      </div>

      <div className="input-area">
        <form className="input-wrap" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command..."
            autoComplete="off"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="send-btn" disabled={busy}>
            <svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4z" /><path d="m22 2-11 11" /></svg>
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Format helpers ───────────────────── */

function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusBadge(text, type) {
  const cls = type === "ok" ? "status-ok" : type === "fail" ? "status-fail" : "status-warn";
  return `<span class="${cls}">${esc(text)}</span>`;
}

function renderResultCard(rows) {
  const inner = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("");
  return `<div class="msg-result"><dl class="result-grid">${inner}</dl></div>`;
}

function renderApprovalButton(approvalId, label) {
  if (!approvalId) return "";
  return `<div class="action-row"><button class="action-button" type="button" data-approval-id="${esc(approvalId)}">${esc(label)}</button></div>`;
}

function renderTxLink(txHash, explorerUrl) {
  if (!txHash) return `<span style="color:var(--ink-muted)">pending</span>`;
  const compact = compactHash(txHash);
  if (!explorerUrl) return `<code>${esc(compact)}</code>`;
  return `<a href="${esc(explorerUrl)}" target="_blank" rel="noreferrer" style="color:var(--green);font-weight:800">${esc(compact)}</a>`;
}

function renderAirdrop(airdrop, data = {}) {
  const approval = data.result?.approval || data.approval;
  const receiptUrl = data.receiptUrl || (airdrop?.id ? `/airdrops/${airdrop.id}` : "");
  const winners = Array.isArray(airdrop?.winnerHandles) ? airdrop.winnerHandles.length : 0;
  const recipients = Array.isArray(airdrop?.recipients) ? airdrop.recipients.length : 0;
  const winnerText = `${winners || recipients}/${airdrop?.maxRecipients || recipients || "n/a"}`;
  let html = `Distribution ${airdrop?.status === "distributed" ? "sent" : "created"}.`;
  html += renderResultCard([
    ["Campaign", `<code>${esc(airdrop?.id || "n/a")}</code>`],
    ["Status", statusBadge(airdrop?.status || "created", airdrop?.status === "distributed" ? "ok" : "warn")],
    ["Amount each", `${esc(airdrop?.amountPerRecipient ?? "n/a")} ${esc(airdrop?.asset || "USDC")}`],
    ["Budget", `${esc(airdrop?.totalBudget ?? "n/a")} ${esc(airdrop?.asset || "USDC")}`],
    ["Recipients", esc(winnerText)],
    ["Rail", esc(airdrop?.settlementRail || "arc-testnet")],
    ["Receipt", receiptUrl ? `<a href="${esc(receiptUrl)}" target="_blank" rel="noreferrer" style="color:var(--accent)">open</a>` : "n/a"],
    ["Next", esc(data.nextAction || airdrop?.nextAction || "track_receipt")],
  ]);
  html += renderApprovalButton(approval?.id || airdrop?.approvalId, "Approve distribution");
  return html;
}

function renderPrimitiveList(primitives = []) {
  if (!primitives.length) return `No Arc trading primitives were returned.`;
  const rows = primitives.slice(0, 8).map((primitive) => [
    esc(primitive.name || "primitive"),
    `${statusBadge(primitive.status || "unknown", primitive.status === "ready" ? "ok" : "warn")} <span style="color:var(--ink-muted)">${esc(primitive.provider || "")}</span>`,
  ]);
  return `Arc trading primitives loaded.${renderResultCard(rows)}`;
}

function formatExecutionResult(data) {
  const execution = data.execution || {};
  const ids = execution.ids || {};
  const ok = execution.ok !== false;
  const rows = [
    ["Tool", `<code>${esc(execution.tool || data.planned?.plan?.tool || "agent")}</code>`],
    ["Status", statusBadge(execution.status || (ok ? "completed" : "failed"), executionStatusType(execution))],
    ["Reason", esc(execution.reason || data.reason || data.error || "n/a")],
    ["Tx", renderTxLink(execution.txHash || data.txHash, execution.explorerUrl || data.explorerUrl)],
    ["Receipt", execution.receiptUrl ? `<a href="${esc(execution.receiptUrl)}" target="_blank" rel="noreferrer" style="color:var(--accent)">open</a>` : "n/a"],
    ["Next", esc(execution.nextAction || data.nextAction || "n/a")],
  ];

  if (ids.positionId) rows.splice(3, 0, ["Position", `<code>${esc(ids.positionId)}</code>`]);
  if (ids.actionId) rows.splice(3, 0, ["Action", `<code>${esc(ids.actionId)}</code>`]);
  if (ids.paymentId) rows.splice(3, 0, ["Payment", `<code>${esc(ids.paymentId)}</code>`]);

  return `${esc(executionTitle(execution))}${renderResultCard(rows)}`;
}

function executionTitle(execution) {
  if (execution.tool === "close_arc_perp_user_position") {
    if (execution.ok === false) return "Perp close was not submitted.";
    return execution.txHash ? "Perp close submitted on Arc." : "Perp close accepted.";
  }
  if (execution.ok === false) return "I could not complete that action.";
  if (execution.txHash) return "Action submitted on-chain.";
  return "Agent action completed.";
}

function executionStatusType(execution) {
  const status = String(execution.status || "").toLowerCase();
  if (execution.ok === false || ["failed", "rejected", "position_not_found", "wallet_not_found", "position_lookup_failed"].includes(status)) return "fail";
  if (["submitted", "requires_confirmation", "execution_not_enabled"].includes(status)) return "warn";
  return "ok";
}

function formatResult(data) {
  const plan = data.planned;
  const result = data.result || {};
  const intent = plan?.intent || {};
  const tool = plan?.plan?.tool || "unknown";
  const execution = data.execution || null;
  let summary = "";

  if (execution && execution.ok === false) {
    summary = formatExecutionResult(data);
  } else if (tool === "list_arc_trading_primitives" || Array.isArray(result.primitives)) {
    summary = renderPrimitiveList(result.primitives || []);
  } else if (tool === "create_airdrop") {
    summary = renderAirdrop(result.airdrop, data);
  } else if (tool === "award_airdrop") {
    const airdrop = result.airdrop || {};
    const payments = Array.isArray(result.payments) ? result.payments.length : 0;
    summary = `Recipients awarded.${renderResultCard([
      ["Campaign", `<code>${esc(airdrop.id || "n/a")}</code>`],
      ["Status", statusBadge(airdrop.status || "distributed", airdrop.status === "distributed" ? "ok" : "warn")],
      ["Payments", esc(payments)],
      ["Recipients", `${esc(airdrop.winnerHandles?.length || 0)}/${esc(airdrop.maxRecipients || "n/a")}`],
      ["Receipt", airdrop.id ? `<a href="/airdrops/${esc(airdrop.id)}" target="_blank" rel="noreferrer" style="color:var(--accent)">open</a>` : "n/a"],
    ])}`;
  } else if (tool === "list_airdrops" || Array.isArray(result.airdrops)) {
    const airdrops = result.airdrops || [];
    if (!airdrops.length) {
      summary = "No distributions found.";
    } else {
      summary = `Distributions loaded.${renderResultCard(airdrops.slice(0, 8).map((airdrop) => [
        `<code>${esc(airdrop.id)}</code>`,
        `${statusBadge(airdrop.status, airdrop.status === "distributed" ? "ok" : "warn")} ${esc(airdrop.amountPerRecipient)} ${esc(airdrop.asset || "USDC")} each`,
      ]))}`;
    }
  } else if (tool === "get_airdrop_receipt" || result.receipt?.airdrop) {
    const receipt = result.receipt || {};
    const airdrop = receipt.airdrop || {};
    summary = `Distribution receipt.${renderResultCard([
      ["Campaign", `<code>${esc(airdrop.id || "n/a")}</code>`],
      ["Status", statusBadge(airdrop.status || "unknown", airdrop.status === "distributed" ? "ok" : "warn")],
      ["Payments", esc(receipt.payments?.length || 0)],
      ["Public URL", receipt.publicUrl ? `<a href="${esc(receipt.publicUrl)}" target="_blank" rel="noreferrer" style="color:var(--accent)">open</a>` : "n/a"],
      ["Next", esc(receipt.nextAction || "n/a")],
    ])}`;
  } else if (result.airdrop) {
    summary = renderAirdrop(result.airdrop, data);
  } else if (intent.action === "send_payment") {
    const payment = result.payment || {};
    summary = `Payment of <code>${payment.amount || intent.amount} USDC</code> to <code>${esc(intent.recipientHandle)}</code> has been created.`;
    summary += renderResultCard([
      ["Status", statusBadge(payment.status || "queued", "ok")],
      ["Amount", `${payment.amount || intent.amount} USDC`],
      ["To", esc(intent.recipientHandle || "—")],
      ["Rail", esc(payment.settlementRail || "arc-testnet")],
      ["Next", esc(data.nextAction || "—")],
    ]);
    summary += renderApprovalButton(payment.approvalId, "Approve payment");
  } else if (intent.action === "quote_bridge") {
    const action = result.action || {};
    const bridgeToken = intent.fromToken || intent.asset || "USDC";
    summary = `Bridge quote for <code>${intent.amount} ${esc(bridgeToken)}</code> from <code>${esc(intent.fromRail)}</code> to <code>${esc(intent.toRail)}</code>.`;
    summary += renderResultCard([
      ["Status", statusBadge(action.status || "quoted", "warn")],
      ["Amount", `${intent.amount} ${esc(bridgeToken)}`],
      ["Route", `${esc(intent.fromRail)} → ${esc(intent.toRail)}`],
      ["Protocol", esc(action.protocol || "lifi")],
      ["Tx", renderTxLink(action.txHash || action.execution?.txHash, action.explorerUrl)],
      ["Next", esc(data.nextAction || "—")],
    ]);
    summary += renderApprovalButton(action.approvalId, "Approve bridge");
  } else if (intent.action === "quote_swap") {
    const action = result.action || {};
    summary = `Swap quote for <code>${intent.amount} ${esc(intent.fromToken || "USDC")}</code> → <code>${esc(intent.toToken)}</code>.`;
    summary += renderResultCard([
      ["Status", statusBadge(action.status || "quoted", "warn")],
      ["Amount", `${intent.amount} ${esc(intent.fromToken || "USDC")}`],
      ["To token", esc(intent.toToken || "—")],
      ["Protocol", esc(action.protocol || "lifi")],
      ["Tx", renderTxLink(action.txHash || action.execution?.txHash, action.explorerUrl)],
      ["Next", esc(data.nextAction || "—")],
    ]);
    summary += renderApprovalButton(action.approvalId, "Approve swap");
  } else if (intent.action === "propose_perp_trade") {
    const proposal = result.proposal || {};
    summary = `Perp proposal prepared for <code>${esc(intent.side)} ${esc(intent.symbol)}</code>.`;
    summary += renderResultCard([
      ["Status", statusBadge(proposal.status || "requires_confirmation", "warn")],
      ["Collateral", `${proposal.collateralUsd || intent.collateralUsd} USDC`],
      ["Leverage", `${proposal.leverage || intent.leverage}x`],
      ["Notional", `${proposal.notionalUsd || "n/a"} USDC`],
      ["Next", esc(data.nextAction || "approval_required")],
    ]);
    summary += renderApprovalButton(proposal.approvalId, "Approve perp proposal");
  } else if (tool === "get_balance" || tool === "sync_circle_balances") {
    const wallet = result.wallet || {};
    const formatLine = (railId) => {
      const tokens = Array.isArray(wallet.tokenBalances?.[railId]) ? wallet.tokenBalances[railId] : [{ symbol: "USDC", amount: wallet.balances?.[railId] || 0 }];
      return tokens.filter((t) => Number(t.amount || 0) > 0).map((t) => `${formatTokenAmount(t.amount)} ${t.symbol}`).join(" + ") || "0 USDC";
    };
    summary = `${tool === "sync_circle_balances" ? "Balances synced." : "Wallet balance."}`;
    summary += renderResultCard([
      ["Tool", `<code>${esc(tool)}</code>`],
      ["Handle", esc(wallet.handle || "n/a")],
      ["Total", `${esc(wallet.balance ?? "0")} USDC`],
      ["Arc", esc(formatLine("arc-testnet"))],
      ["Base", esc(formatLine("base-sepolia"))],
    ]);
  } else if (tool === "close_arc_perp_user_position") {
    summary = formatExecutionResult(data);
  } else {
    summary = `Agent action completed.${renderResultCard([
      ["Tool", `<code>${esc(tool)}</code>`],
      ["Status", statusBadge(data.ok ? "ok" : "failed", data.ok ? "ok" : "fail")],
      ["Next", esc(data.nextAction || "n/a")],
    ])}`;
  }

  if (data.timing) {
    summary += `<div style="margin-top:6px;font-size:11px;color:var(--ink-muted)">Timing: ${Number(data.timing.totalMs || 0)}ms total · planning ${Number(data.timing.planningMs || 0)}ms · execution ${Number(data.timing.executionMs || 0)}ms</div>`;
  }

  return summary;
}

function formatApprovalResult(data) {
  const result = data.result || {};
  const job = result.job || result.result?.job || {};
  return `Approved <code>${esc(data.approval?.kind || "action")}</code>. I kicked the worker once for execution.
${renderResultCard([
  ["Approval", statusBadge(data.approval?.status || "approved", "ok")],
  ["Job", esc(job.id || "queued")],
  ["Status", statusBadge("queued", "ok")],
  ["Next", esc(result.nextAction || "check activity/receipt")],
])}`;
}

function formatClarification(data) {
  const reason = data.planned?.plan?.reason || data.clarification || data.error || "I didn't understand that.";
  return `${esc(reason)}<div style="margin-top:12px;font-size:12px;color:var(--ink-muted)">Try commands like:</div><div style="margin-top:4px;font-size:12px;color:var(--accent)">• <code>send $10 to @alice</code><br>• <code>bridge $5 USDC from arc to base</code><br>• <code>swap $20 EURC to USDC</code></div>`;
}

function formatHelp() {
  return `I'm the bunOS agent. Here's what I can do:
<div class="msg-result"><div class="label">Available commands</div><div style="display:grid;gap:8px;margin-top:6px">
<div><code>send $10 to @alice</code> - Send USDC to another user</div>
<div><code>bridge $1 USDC from arc to base</code> - Bridge between chains</div>
<div><code>swap $1 EURC to USDC on arc</code> - Swap tokens</div>
<div><code>drop $1 to @alice @bob</code> - Send rewards to a recipient list</div>
<div><code>drop $0.50 to first 10 replies</code> - Create a social reward flow that can be completed later</div>
<div><code>list arc trading primitives</code> - Show live primitive readiness</div>
<div><code>show my balance</code> - Read wallet balances</div>
<div><code>sync balances every 10 minutes</code> - Create automation</div>
<div><code>list automations</code> - Show automations</div>
<div><code>long BTC 2x with $1</code> - Prepare perp proposal</div>
<div><code>close my last perp</code> - Close the latest open ArcPerps position when one exists</div>
</div></div>`;
}

function formatError(data) {
  if (data.execution) return formatExecutionResult(data);
  return `<span style="color:var(--red)">!</span> ${esc(data.error || data.reason || data.clarification || "Something went wrong.")}`;
}

function formatAutomationResult(data) {
  if (Array.isArray(data.automations)) {
    if (!data.automations.length) return `No automations found.`;
    const rows = data.automations.slice(0, 8).map((a) => [
      `<code>${esc(a.id)}</code>`,
      `${esc(a.name || a.kind)} · ${esc(a.status)} · every ${esc(a.intervalMinutes)}m`,
    ]);
    return `Automations loaded.${renderResultCard(rows)}`;
  }
  const automation = data.automation || data.result?.automation;
  if (automation) {
    return `Automation saved.${renderResultCard([
      ["ID", `<code>${esc(automation.id)}</code>`],
      ["Name", esc(automation.name || automation.kind)],
      ["Status", statusBadge(automation.status || "active", "ok")],
      ["Interval", `${esc(automation.intervalMinutes || "n/a")} minutes`],
    ])}`;
  }
  return `Automation command completed.`;
}

function isHelpIntent(text) {
  return /^(help|what can you do|commands|examples|what can you do\?)$/i.test(String(text || "").trim());
}

function isApprovalIntent(text) {
  return /^(approve|confirm|execute|yes|go|do it)$/i.test(String(text || "").trim());
}

function isAutomationIntent(text) {
  const v = String(text || "").trim().toLowerCase();
  return /\b(auto(?:mate|mation|mations)|schedule|repeat)\b/.test(v)
    || /^(list|show)\s+automations?$/.test(v)
    || /^run\s+(due\s+)?automations?$/.test(v)
    || /\bevery\s+\d+(?:\.\d+)?\s*(?:minute|minutes|min|hour|hours|hr|hrs|day|days)\b/.test(v);
}

async function runAutomationCommand(text, handle) {
  const lower = text.toLowerCase().trim();
  if (/^(list|show)\s+automations?$/.test(lower) || lower === "automations") {
    return fetchJson(`/api/automations?handle=${encodeURIComponent(handle)}`);
  }
  if (/^run\s+(due\s+)?automations?$/.test(lower)) {
    return requestJson("/api/automations/run-due", { method: "POST", body: { limit: 20 } });
  }
  const match = text.match(/\bevery\s+(\d+(?:\.\d+)?)\s*(minute|minutes|min|hour|hours|hr|hrs|day|days)\b/i);
  let intervalMinutes;
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit.startsWith("day")) intervalMinutes = amount * 24 * 60;
    else if (unit.startsWith("hour") || unit.startsWith("hr")) intervalMinutes = amount * 60;
    else intervalMinutes = amount;
  }
  return requestJson("/api/automations", {
    method: "POST",
    body: { handle, text, intervalMinutes, defaultSettlementRail: localStorage.getItem("arcpay:rail") || "arc-testnet" },
  });
}
