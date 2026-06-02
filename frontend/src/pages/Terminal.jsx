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
  "analyze my portfolio",
  "what should I do with my wallet",
  "never bridge if fee is over 3%",
  "max trade $10",
  "list mandates",
  "keep 70% USDC, 20% EURC, 10% cirBTC",
  "rebalance my Arc wallet",
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
  const handleRef = useRef(currentHandle || localStorage.getItem("bunos:handle") || "");
  const defiPollersRef = useRef(new Map());

  useEffect(() => {
    if (currentHandle) handleRef.current = currentHandle;
  }, [currentHandle]);

  useEffect(() => {
    hydrateWallet();
  }, []);

  useEffect(() => () => {
    for (const timer of defiPollersRef.current.values()) clearTimeout(timer);
    defiPollersRef.current.clear();
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const addMessage = useCallback((role, content, html) => {
    const id = Date.now() + Math.random();
    setMessages((prev) => [...prev, { id, role, content, html }]);
    return id;
  }, []);

  const updateMessageHtml = useCallback((messageId, html) => {
    setMessages((prev) => prev.map((msg) => (
      msg.id === messageId ? { ...msg, html } : msg
    )));
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
      localStorage.setItem("bunos:handle", handle);

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
        const messageId = addMessage("agent", null, formatApprovalResult(data));
        followDefiExecution(data, messageId);
        return;
      }

      if (isAutomationUtilityIntent(value)) {
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
          defaultSettlementRail: localStorage.getItem("bunos:rail") || "arc-testnet",
          source: "terminal",
          fast: true,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.ok === false) {
        if (data.execution) {
          const messageId = addMessage("agent", null, formatResult(data));
          followDefiExecution(data, messageId);
          trackApproval(data);
        } else if (data.planned?.plan?.reason) {
          addMessage("agent", null, formatClarification(data));
        } else {
          addMessage("agent", null, formatError(data));
        }
      } else {
        const messageId = addMessage("agent", null, formatResult(data));
        followDefiExecution(data, messageId);
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
      const messageId = addMessage("agent", null, formatApprovalResult(data));
      followDefiExecution(data, messageId);
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

  const followDefiExecution = useCallback((data, messageId) => {
    const target = extractExecutionMonitorTarget(data);
    if (!target || !shouldPollExecution(data, target)) return;
    const targetKey = `${target.kind}:${target.id}`;
    if (defiPollersRef.current.has(targetKey)) clearTimeout(defiPollersRef.current.get(targetKey));

    let attempt = 0;
    const poll = async () => {
      attempt += 1;
      try {
        const refreshed = await post(`/api/execution-monitor/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.id)}`, { runWorker: true, source: "terminal" });
        updateMessageHtml(messageId, formatExecutionMonitorFollowup(refreshed, data));
        const monitor = refreshed.monitor || {};
        const done = Boolean(monitor.terminal);
        if (done || attempt >= 30) {
          defiPollersRef.current.delete(targetKey);
          return;
        }
      } catch (error) {
        if (attempt >= 30) {
          updateMessageHtml(messageId, formatDefiPollingFailure(target.id, error));
          defiPollersRef.current.delete(targetKey);
          return;
        }
      }

      const timer = window.setTimeout(poll, attempt < 3 ? 1200 : 2500);
      defiPollersRef.current.set(targetKey, timer);
    };

    const timer = window.setTimeout(poll, 900);
    defiPollersRef.current.set(targetKey, timer);
  }, [updateMessageHtml]);

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

function renderMarketIntelligence(market) {
  if (!market) return "";
  const regime = market.regime || {};
  const routes = Array.isArray(market.routeStats) ? market.routeStats : [];
  const warnings = Array.isArray(market.warnings) ? market.warnings : [];
  const routeText = routes.length
    ? routes.slice(0, 4).map((route) => {
      const failure = Number(route.failureRate || 0) * 100;
      const fee = Number(route.averageFeeRatio || 0) * 100;
      return `${esc(route.label || route.key)} - ${esc(route.attempts || 0)} attempts, ${esc(failure.toFixed(0))}% fail, ${esc(fee.toFixed(1))}% fee`;
    }).join("<br>")
    : "no route history yet";

  return `Market intelligence.${renderResultCard([
    ["Regime", `<code>${esc(regime.status || market.status || "neutral")}</code>`],
    ["Reason", esc(regime.reason || market.reason || "n/a")],
    ["Feed", market.feeds?.freshness ? `${statusBadge(market.feeds.freshness.status, market.feeds.freshness.status === "fresh" ? "ok" : "warn")} ${esc(market.feeds.freshness.reason || "")}` : "not loaded"],
    ["Recommendation", esc(market.recommendation || "review")],
    ["Routes", routeText],
    ["Warnings", warnings.length ? warnings.slice(0, 4).map(esc).join("<br>") : "none"],
  ])}${market.feeds ? renderMarketFeedSnapshot(market.feeds) : ""}`;
}

function renderMarketFeedSnapshot(feed) {
  if (!feed) return "";
  const prices = Object.values(feed.prices || {});
  const priceText = prices.length
    ? prices.slice(0, 6).map((price) => `${esc(price.symbol)} ${price.priceUsd === null ? "unavailable" : `US$${esc(price.priceUsd)}`} - ${esc(price.freshness || "unknown")}`).join("<br>")
    : "no price feed rows";
  const perps = Array.isArray(feed.perps?.markets) ? feed.perps.markets : [];
  const perpsText = perps.length
    ? perps.slice(0, 4).map((market) => `${esc(market.symbol)} mark ${esc(market.markPrice ?? "n/a")} funding ${esc(market.funding ?? "n/a")} OI ${esc(market.openInterest ?? "n/a")}`).join("<br>")
    : feed.perps?.reason || "perps feed unavailable";
  const warnings = Array.isArray(feed.warnings) ? feed.warnings : [];
  return `Market feeds.${renderResultCard([
    ["Regime", `<code>${esc(feed.regime?.status || "unknown")}</code>`],
    ["Freshness", `${statusBadge(feed.freshness?.status || "unknown", feed.freshness?.status === "fresh" ? "ok" : "warn")} ${esc(feed.freshness?.reason || "")}`],
    ["Prices", priceText],
    ["Perps", perpsText],
    ["Liquidity", `${statusBadge(feed.liquidity?.status || "unknown", feed.liquidity?.status === "healthy" ? "ok" : "warn")} ${esc(feed.liquidity?.reason || "")}`],
    ["Warnings", warnings.length ? warnings.slice(0, 5).map(esc).join("<br>") : "none"],
  ])}`;
}

function renderStrategyPlan(result = {}) {
  const strategy = result.strategy || {};
  const plan = result.strategyPlan || {};
  const portfolio = result.portfolio || {};
  const targets = Object.entries(strategy.targetAllocations || {})
    .map(([symbol, weight]) => `${esc(symbol)} ${esc(Math.round(Number(weight) * 100))}%`)
    .join(" · ") || "n/a";
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const stepText = steps.length
    ? steps.slice(0, 5).map((step) => `${esc(step.fromToken)} -> ${esc(step.toToken)} · US$${esc(step.amountUsd)}`).join("<br>")
    : "none";
  const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];

  return `Strategy plan.${renderResultCard([
    ["Strategy", `<code>${esc(strategy.id || "adhoc")}</code> ${esc(strategy.name || "")}`],
    ["Status", statusBadge(result.status || plan.status || "planned", steps.length ? "warn" : "ok")],
    ["Targets", targets],
    ["Rail", esc(strategy.settlementRail || portfolio.settlementRail || "arc-testnet")],
    ["Portfolio", `US$${esc(portfolio.totalValueUsd ?? plan.totalValueUsd ?? 0)}`],
    ["Steps", stepText],
    ["Warnings", warnings.length ? warnings.slice(0, 3).map(esc).join("<br>") : "none"],
    ["Market", result.marketGuard?.reason ? esc(result.marketGuard.reason) : "checked"],
    ["Next", esc(result.nextAction || plan.nextAction || "review")],
  ])}`;
}

function renderPortfolioAnalysis(result = {}) {
  const portfolio = result.portfolio || {};
  const exposure = portfolio.exposure || {};
  const perps = portfolio.perps || {};
  const pending = portfolio.pending || {};
  const strategy = portfolio.strategy || {};
  const rec = result.recommendation || {};
  const assets = Object.values(portfolio.assetsByToken || {});
  const assetText = assets.length
    ? assets.slice(0, 6).map((asset) => `${esc(asset.symbol)} US$${esc(asset.valueUsd)} (${esc(Math.round(Number(asset.weight || 0) * 100))}%)`).join("<br>")
    : "no funded assets found";
  const pendingText = pending.items?.length
    ? pending.items.slice(0, 4).map((item) => `${esc(item.kind)} ${esc(item.id)} - ${esc(item.status)}`).join("<br>")
    : "none";

  return `Portfolio analysis.${renderResultCard([
    ["Total", `US$${esc(portfolio.totalValueUsd ?? 0)}`],
    ["Exposure", `stables ${esc(Math.round(Number(exposure.stableWeight || 0) * 100))}% / volatile ${esc(Math.round(Number(exposure.volatileWeight || 0) * 100))}%`],
    ["Assets", assetText],
    ["Perps", `${esc(perps.activeCount || 0)} active / US$${esc(perps.activeNotionalUsd || 0)} notional`],
    ["Pending", pendingText],
    ["Strategy", strategy.status ? `${statusBadge(strategy.status, strategy.status === "drifted" ? "warn" : "ok")} ${esc(strategy.strategyName || strategy.reason || "")}` : "none"],
    ["Recommendation", esc(rec.reason || "Hold and monitor.")],
    ["Next", esc(rec.nextAction || result.nextAction || "monitor_portfolio")],
  ])}`;
}

function renderMandates(result = {}) {
  const mandate = result.mandate || null;
  const mandates = mandate ? [mandate] : (Array.isArray(result.mandates) ? result.mandates : []);
  const conflicts = mandate?.conflicts || result.conflicts || [];
  if (mandate) {
    return `Mandate saved.${renderResultCard([
      ["Mandate", `<code>${esc(mandate.id)}</code>`],
      ["Status", statusBadge(result.status || mandate.status || "saved", conflicts.length ? "warn" : "ok")],
      ["Kind", esc(mandate.kind)],
      ["Rule", esc(mandate.sourceText || "n/a")],
      ["Conflicts", conflicts.length ? conflicts.map((item) => esc(item.reason)).join("<br>") : "none"],
      ["Next", esc(result.nextAction || "enforce_on_next_trade")],
    ])}`;
  }
  if (!mandates.length) return `No standing trading mandates found.`;
  const rows = mandates.slice(0, 8).map((item) => [
    `<code>${esc(item.id)}</code>`,
    `${statusBadge(item.status || "active", item.status === "active" ? "ok" : "warn")} ${esc(item.kind)} - ${esc(item.sourceText || "")}`,
  ]);
  return `Standing mandates loaded.${renderResultCard(rows)}`;
}

function extractDefiActionId(data) {
  return data?.execution?.ids?.actionId
    || data?.result?.action?.id
    || data?.result?.receipt?.action?.id
    || data?.receipt?.action?.id
    || data?.action?.id
    || null;
}

function extractExecutionMonitorTarget(data) {
  const monitor = data?.executionMonitor || data?.monitor;
  if (monitor?.kind && monitor?.id) return { kind: monitor.kind, id: monitor.id };

  const paymentId = data?.execution?.ids?.paymentId || data?.result?.payment?.id || data?.payment?.id;
  if (paymentId) return { kind: "payment", id: paymentId };

  const actionId = extractDefiActionId(data);
  if (actionId) return { kind: "defi_action", id: actionId };

  const proposalId = data?.execution?.ids?.proposalId || data?.result?.proposal?.id || data?.proposal?.id;
  if (proposalId) return { kind: "perp_proposal", id: proposalId };

  return null;
}

function shouldPollDefiAction(data) {
  const action = data?.result?.action || data?.action || data?.receipt?.action || {};
  const status = String(action.status || data?.execution?.status || "").toLowerCase();
  const next = [
    data?.nextAction,
    data?.execution?.nextAction,
    data?.result?.nextAction,
    data?.result?.execution?.nextAction,
    action.nextAction
  ].filter(Boolean).join(" ").toLowerCase();

  if (["settled", "failed", "rejected", "quote_unavailable"].includes(status)) return false;
  return ["confirmed", "submitted", "queued"].includes(status)
    || /execution_queued|run_execution_worker|execute_defi_action|execution_provider_pending|reconcile_defi_action|monitor_receipt/.test(next);
}

function shouldPollExecution(data, target) {
  const monitor = data?.executionMonitor || data?.monitor || {};
  if (monitor.terminal) return false;
  if (target.kind === "defi_action") return shouldPollDefiAction(data) || ["queued", "submitted"].includes(String(monitor.lifecycle || "").toLowerCase());
  if (target.kind === "payment") {
    const status = String(monitor.lifecycle || data?.result?.payment?.status || data?.payment?.status || "").toLowerCase();
    return ["queued", "submitted", "pending"].includes(status);
  }
  if (target.kind === "perp_proposal") {
    const status = String(monitor.lifecycle || data?.result?.proposal?.status || data?.proposal?.status || "").toLowerCase();
    return ["queued", "submitted", "confirmed"].includes(status);
  }
  return false;
}

function formatExecutionMonitorFollowup(refreshed, originalData = {}) {
  const monitor = refreshed.monitor || {};
  if (monitor.kind === "defi_action" && refreshed.receipt) {
    return formatDefiReceiptFollowup({ receipt: refreshed.receipt }, originalData);
  }
  return formatSimpleMonitor(monitor);
}

function executionMonitorTitle(monitor = {}) {
  const kind = monitor.kind === "payment" ? "Payment" : monitor.kind === "perp_proposal" ? "Perp execution" : "Execution";
  if (monitor.lifecycle === "settled") return `${kind} settled.`;
  if (monitor.lifecycle === "failed") return `${kind} failed.`;
  if (monitor.lifecycle === "needs_user_signature") return `${kind} needs user wallet approval.`;
  if (monitor.terminal) return `${kind} reached ${monitor.lifecycle || "final"} state.`;
  return `${kind} is still being monitored.`;
}

function formatSimpleMonitor(monitor = {}) {
  const status = String(monitor.lifecycle || monitor.status || "").toLowerCase();
  if (status === "settled") {
    return `Done. The transaction finished on-chain.${renderSimpleReceiptRows({
      txHash: monitor.txHash,
      explorerUrl: monitor.explorerUrl,
      receiptUrl: monitor.receiptUrl
    })}`;
  }
  if (status === "failed") {
    return `I could not finish that action. ${friendlyReason(monitor.reason)}${renderSimpleNext("No funds moved unless a transaction hash is shown.")}`;
  }
  if (status === "submitted" || status === "queued") {
    return `I sent it off and I am still waiting for the final result.${renderSimpleReceiptRows({
      txHash: monitor.txHash,
      explorerUrl: monitor.explorerUrl,
      receiptUrl: monitor.receiptUrl,
      nextAction: "I will keep checking for the receipt."
    })}`;
  }
  return `${executionMonitorTitle(monitor)}${renderSimpleReceiptRows({
    txHash: monitor.txHash,
    explorerUrl: monitor.explorerUrl,
    receiptUrl: monitor.receiptUrl
  })}`;
}

function formatDefiReceiptFollowup(receiptData, originalData = {}) {
  const receipt = receiptData.receipt || {};
  const action = receipt.action || originalData.result?.action || {};
  const request = action.request || originalData.planned?.intent || {};
  const execution = receipt.execution || action.execution || {};
  const executionJob = receipt.executionJob || null;
  const type = action.type || request.action || "action";
  const status = action.status || execution.status || executionJob?.status || "pending";
  const amount = request.amountUsd || request.amount || originalData.planned?.intent?.amount || "n/a";
  const fromToken = request.fromToken || request.asset || "USDC";
  const toToken = request.toToken || (type === "bridge" ? request.fromToken || "USDC" : "n/a");
  const fromRail = request.fromRail || request.settlementRail || "arc-testnet";
  const toRail = request.toRail || fromRail;
  const txHash = receipt.txHash || execution.txHash || action.txHash;
  const reason = action.reason || execution.reason || execution.error || executionJob?.lastError || action.lastExecutionError || "";
  return renderSimpleTradeResponse({
    type,
    status,
    amount,
    fromToken,
    toToken,
    fromRail,
    toRail,
    reason,
    txHash,
    explorerUrl: receipt.explorerUrl || execution.explorerUrl,
    receiptUrl: receipt.publicUrl,
    nextAction: receipt.nextAction || action.nextAction || "none"
  });
}

function renderSimpleTradeResponse({
  type = "swap",
  status = "pending",
  amount = "n/a",
  fromToken = "USDC",
  toToken = "n/a",
  fromRail = "arc-testnet",
  toRail = fromRail,
  reason = "",
  txHash = null,
  explorerUrl = null,
  receiptUrl = null,
  nextAction = ""
} = {}) {
  const normalized = String(status || "").toLowerCase();
  const action = type === "bridge" ? "bridge" : "swap";
  const route = action === "bridge"
    ? `${amount} ${fromToken} from ${humanRail(fromRail)} to ${humanRail(toRail)}`
    : `${amount} ${fromToken} to ${toToken} on ${humanRail(fromRail)}`;

  if (["settled", "completed"].includes(normalized)) {
    return `Done. I completed the ${action} for ${esc(route)}.${renderSimpleReceiptRows({ txHash, explorerUrl, receiptUrl })}`;
  }

  if (normalized === "submitted") {
    return `I submitted the ${action} for ${esc(route)}. It may take a moment to show as final.${renderSimpleReceiptRows({
      txHash,
      explorerUrl,
      receiptUrl,
      nextAction: "I am watching for the final receipt."
    })}`;
  }

  if (["failed", "rejected", "quote_unavailable", "execution_not_enabled"].includes(normalized)) {
    const reasonText = friendlyReason(reason, { action, fromToken, toToken, fromRail, toRail });
    return `I could not do this ${action} right now. ${reasonText} No funds moved.${renderSimpleNext(nextUserAction({ action, fromToken, toToken }))}`;
  }

  if (normalized === "requires_confirmation" || normalized === "quoted") {
    return `I found a possible ${action} for ${esc(route)}. Review it before moving funds.${renderSimpleReceiptRows({ txHash, explorerUrl, receiptUrl, nextAction })}`;
  }

  return `I am checking this ${action} for ${esc(route)}.${renderSimpleReceiptRows({ txHash, explorerUrl, receiptUrl, nextAction })}`;
}

function renderSimpleReceiptRows({ txHash, explorerUrl, receiptUrl, nextAction } = {}) {
  const rows = [];
  if (txHash) rows.push(["Transaction", renderTxLink(txHash, explorerUrl)]);
  if (receiptUrl) rows.push(["Receipt", `<a href="${esc(receiptUrl)}" target="_blank" rel="noreferrer" style="color:var(--accent)">open</a>`]);
  if (nextAction && nextAction !== "none") rows.push(["Next", esc(humanNextAction(nextAction))]);
  return rows.length ? renderResultCard(rows) : "";
}

function renderSimpleNext(text) {
  return text ? renderResultCard([["Next", esc(text)]]) : "";
}

function friendlyReason(reason, context = {}) {
  const text = String(reason || "").toLowerCase();
  if (/no live .*route|no available quotes|quote_unavailable|provider could not return|server error|fallback/.test(text)) {
    const pair = context.toToken ? `${context.fromToken || "this token"} to ${context.toToken}` : "that pair";
    return `I could not find a working route for ${pair}. That usually means there is not enough liquidity yet, or the route provider is having a bad moment.`;
  }
  if (/insufficient|not enough|balance/.test(text)) {
    return "The wallet does not have enough spendable balance for this action.";
  }
  if (/execution_not_enabled|not enabled|signing|required/.test(text)) {
    return "The wallet or provider is not ready to sign this action yet.";
  }
  if (!reason) return "I could not get a safe route from the provider.";
  return stripBackendReason(reason);
}

function stripBackendReason(reason) {
  return String(reason || "")
    .replace(/Provider details:.*/i, "")
    .replace(/AppKit:.*/i, "")
    .replace(/LI\.FI fallback:.*/i, "")
    .replace(/\s+/g, " ")
    .trim() || "The route is not available right now.";
}

function nextUserAction({ action, fromToken, toToken }) {
  if (action === "swap") {
    return `Try a more liquid pair, like USDC to EURC, or try again later.`;
  }
  return `Try a slightly larger amount, check your balance, or try again later.`;
}

function humanNextAction(nextAction) {
  const value = String(nextAction || "");
  if (value === "choose_supported_route") return "Try a different token pair or route.";
  if (value === "adjust_trade_or_fund_wallet") return "Add funds or lower the amount.";
  if (value === "reconcile_defi_action" || value === "monitor_receipt") return "Wait for the final receipt.";
  if (value === "none") return "";
  return value.replaceAll("_", " ");
}

function humanRail(rail) {
  const value = String(rail || "");
  if (value === "arc-testnet") return "Arc";
  if (value === "base-sepolia") return "Base";
  return value || "this rail";
}


function defiReceiptTitle(type, status) {
  const normalizedStatus = String(status || "").toLowerCase();
  const label = type === "swap" ? "Swap" : type === "bridge" ? "Bridge" : "Action";
  if (normalizedStatus === "settled") return `${label} executed on-chain.`;
  if (normalizedStatus === "submitted") return `${label} submitted on-chain.`;
  if (["failed", "rejected", "quote_unavailable", "execution_not_enabled"].includes(normalizedStatus)) return `${label} did not execute.`;
  return `${label} is still executing.`;
}

function formatDefiPollingFailure(actionId, error) {
  return `I sent the action, but I could not refresh the final receipt yet.${renderSimpleNext("Check Activity, or ask me to check the receipt again.")}`;
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
  const ok = execution.ok !== false;
  const rows = [
    ["Status", statusBadge(execution.status || (ok ? "completed" : "failed"), executionStatusType(execution))],
    ["Reason", esc(friendlyReason(execution.reason || data.reason || data.error || "n/a"))],
    ["Tx", renderTxLink(execution.txHash || data.txHash, execution.explorerUrl || data.explorerUrl)],
    ["Receipt", execution.receiptUrl ? `<a href="${esc(execution.receiptUrl)}" target="_blank" rel="noreferrer" style="color:var(--accent)">open</a>` : "n/a"],
  ];

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
  const simple = renderSimplePrimaryResult(data, { result, intent, tool, execution });
  if (simple) return simple;
  if (tool === "propose_perp_trade" || result.proposal) {
    return renderPerpProposalResult({ result, intent, data });
  }
  if (tool?.includes("automation") || result.automation || Array.isArray(result.automations)) {
    return formatAutomationResult(result.automation || result.automations ? result : data);
  }
  const readable = data.narrative?.summary || data.execution?.reason || data.reason || data.clarification;
  if (readable) return esc(friendlyReason(readable));
  let summary = "";

  if (execution && execution.ok === false) {
    summary = formatExecutionResult(data);
  } else if (tool === "list_arc_trading_primitives" || Array.isArray(result.primitives)) {
    summary = renderPrimitiveList(result.primitives || []);
  } else if (tool === "get_market_feed_snapshot" || result.prices || result.freshness) {
    summary = renderMarketFeedSnapshot(result);
  } else if (tool === "get_market_intelligence" || result.routeStats || result.regime) {
    summary = renderMarketIntelligence(result);
  } else if (tool === "analyze_portfolio" || result.portfolio?.exposure) {
    summary = renderPortfolioAnalysis(result);
  } else if (tool?.includes("mandate") || result.mandate || Array.isArray(result.mandates)) {
    summary = renderMandates(result);
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
  } else if (result.strategyPlan || result.strategy || tool.includes("strategy")) {
    summary = renderStrategyPlan(result);
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

  return summary;
}

function renderPerpProposalResult({ result = {}, intent = {}, data = {} } = {}) {
  const proposal = result.proposal || {};
  let summary = `I prepared the perp trade. Review it before anything moves.`;
  summary += renderResultCard([
    ["Status", statusBadge(proposal.status || "requires_confirmation", "warn")],
    ["Market", `${esc(proposal.side || intent.side || "long")} ${esc(proposal.symbol || intent.symbol || "BTC")}`],
    ["Collateral", `${esc(proposal.collateralUsd || intent.collateralUsd || "n/a")} USDC`],
    ["Leverage", `${esc(proposal.leverage || intent.leverage || "n/a")}x`],
    ["Risk", esc(proposal.risk?.recommendation || result.mandateCheck?.reason || "checked")],
    ["Next", esc(data.nextAction || "approval_required")],
  ]);
  summary += renderApprovalButton(result.approval?.id || proposal.approvalId, "Approve perp trade");
  return summary;
}

function renderSimplePrimaryResult(data, { result, intent, tool, execution }) {
  const looksLikeTrade = tool === "quote_defi_route"
    || result.action?.type === "swap"
    || result.action?.type === "bridge"
    || intent.action === "quote_bridge"
    || intent.action === "quote_swap"
    || data.narrative?.context?.action === "quote_bridge"
    || data.narrative?.context?.action === "quote_swap";

  if (looksLikeTrade) {
    const action = result.action || {};
    const request = action.request || intent || {};
    const type = action.type || (intent.action === "quote_bridge" || data.narrative?.context?.action === "quote_bridge" ? "bridge" : "swap");
    const status = action.status || result.status || execution?.status || "pending";
    return renderSimpleTradeResponse({
      type,
      status,
      amount: request.amountUsd || request.amount || intent.amount || "n/a",
      fromToken: request.fromToken || intent.fromToken || intent.asset || "USDC",
      toToken: request.toToken || intent.toToken || (type === "bridge" ? request.fromToken || "USDC" : "n/a"),
      fromRail: request.fromRail || intent.fromRail || intent.settlementRail || "arc-testnet",
      toRail: request.toRail || intent.toRail || request.fromRail || "arc-testnet",
      reason: action.reason || result.reason || execution?.reason || data.reason || data.error || "",
      txHash: action.txHash || action.execution?.txHash || execution?.txHash || data.txHash,
      explorerUrl: action.explorerUrl || action.execution?.explorerUrl || execution?.explorerUrl || data.explorerUrl,
      receiptUrl: result.receipt?.publicUrl || action.publicUrl || execution?.receiptUrl,
      nextAction: result.nextAction || action.nextAction || execution?.nextAction || data.nextAction || ""
    });
  }

  if (execution && execution.ok === false) {
    return `${esc(userFriendlyExecutionTitle(execution))}${renderSimpleReceiptRows({
      txHash: execution.txHash || data.txHash,
      explorerUrl: execution.explorerUrl || data.explorerUrl,
      receiptUrl: execution.receiptUrl,
      nextAction: friendlyReason(execution.reason || data.reason || data.error)
    })}`;
  }

  return "";
}

function userFriendlyExecutionTitle(execution = {}) {
  if (execution.tool === "close_arc_perp_user_position") {
    return execution.ok === false
      ? "I could not close that perp position. Nothing changed."
      : "I sent the close request.";
  }
  if (execution.ok === false) return "I could not complete that action.";
  return "Done.";
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
<div><code>never bridge if fee is over 3%</code> - Save a standing trading mandate</div>
<div><code>list mandates</code> - Review rules the agent enforces before trades</div>
<div><code>sync balances every 10 minutes</code> - Create automation</div>
<div><code>list automations</code> - Show automations</div>
<div><code>long BTC 2x with $1</code> - Prepare perp proposal</div>
<div><code>close my last perp</code> - Close the latest open ArcPerps position when one exists</div>
<div><code>keep 70% USDC, 20% EURC, 10% cirBTC</code> - Save a planning-only target allocation strategy</div>
<div><code>rebalance my Arc wallet</code> - Build a rebalance plan without executing trades</div>
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
      `${esc(a.name || a.kind)} - ${esc(a.status)} - every ${esc(formatAutomationInterval(a))}${a.maxRuns ? ` - ${esc(a.runCount || 0)}/${esc(a.maxRuns)} runs` : ""}`,
    ]);
    return `Automations loaded.${renderResultCard(rows)}`;
  }
  const automation = data.automation || data.result?.automation;
  if (automation) {
    return `Automation saved.${renderResultCard([
      ["ID", `<code>${esc(automation.id)}</code>`],
      ["Name", esc(automation.name || automation.kind)],
      ["Status", statusBadge(automation.status || "active", "ok")],
      ["Interval", esc(formatAutomationInterval(automation))],
      ["Runs", automation.maxRuns ? `${esc(automation.runCount || 0)}/${esc(automation.maxRuns)}` : "until stopped"],
    ])}`;
  }
  return `Automation command completed.`;
}

function formatAutomationInterval(automation = {}) {
  const ms = Number(automation.intervalMs || Number(automation.intervalMinutes || 0) * 60_000);
  if (!Number.isFinite(ms) || ms <= 0) return "n/a";
  if (ms < 60_000) return `${Math.round(ms / 1000)} seconds`;
  if (ms < 60 * 60_000) return `${Math.round((ms / 60_000) * 100) / 100} minutes`;
  return `${Math.round((ms / (60 * 60_000)) * 100) / 100} hours`;
}

function isHelpIntent(text) {
  return /^(help|what can you do|commands|examples|what can you do\?)$/i.test(String(text || "").trim());
}

function isApprovalIntent(text) {
  return /^(approve|approved|confirm|confirmed|execute|yes|yeah|yep|go|go ahead|do it|run it)$/i.test(String(text || "").trim());
}

function isAutomationUtilityIntent(text) {
  const v = String(text || "").trim().toLowerCase();
  return /^(list|show)\s+automations?$/.test(v)
    || /^run\s+(due\s+)?automations?$/.test(v)
    || v === "automations";
}

async function runAutomationCommand(text, handle) {
  const lower = text.toLowerCase().trim();
  if (/^(list|show)\s+automations?$/.test(lower) || lower === "automations") {
    return fetchJson(`/api/automations?handle=${encodeURIComponent(handle)}`);
  }
  if (/^run\s+(due\s+)?automations?$/.test(lower)) {
    return requestJson("/api/automations/run-due", { method: "POST", body: { limit: 20 } });
  }
  const match = text.match(/\bevery\s+(\d+(?:\.\d+)?)\s*(second|seconds|sec|secs|s|minute|minutes|min|mins|m|hour|hours|hr|hrs|h|day|days|d)\b/i);
  const maxRunsMatch = text.match(/\b(?:for|until|stop\s+after)\s+(\d{1,4})\s*(?:times?|runs?|executions?)\b/i);
  let intervalMs;
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === "d" || unit.startsWith("day")) intervalMs = amount * 24 * 60 * 60_000;
    else if (unit === "h" || unit.startsWith("hour") || unit.startsWith("hr")) intervalMs = amount * 60 * 60_000;
    else if (unit === "m" || unit.startsWith("minute") || unit.startsWith("min")) intervalMs = amount * 60_000;
    else intervalMs = amount * 1000;
  }
  return requestJson("/api/automations", {
    method: "POST",
    body: {
      handle,
      text,
      intervalMs,
      maxRuns: maxRunsMatch ? Number(maxRunsMatch[1]) : undefined,
      defaultSettlementRail: localStorage.getItem("bunos:rail") || "arc-testnet"
    },
  });
}

