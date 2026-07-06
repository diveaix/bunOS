import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../hooks/useSession";
import { fetchJson, post, compactAddress, compactHash, formatTokenAmount, isLiveWallet } from "../api";
import BrandLogo from "../components/BrandLogo";
import "./Terminal.css";

const SUGGESTIONS = [
  "send $10 to @alice",
  "bridge $1 USDC from arc to base",
  "swap $1 USDC to EURC on arc",
  "show live swap routes",
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
  const automationPollersRef = useRef(new Map());
  const latestAutomationIdRef = useRef(localStorage.getItem("bunos:lastAutomationId") || "");

  useEffect(() => {
    if (currentHandle) handleRef.current = currentHandle;
  }, [currentHandle]);

  useEffect(() => {
    hydrateWallet();
  }, []);

  useEffect(() => () => {
    for (const timer of defiPollersRef.current.values()) clearTimeout(timer);
    defiPollersRef.current.clear();
    for (const timer of automationPollersRef.current.values()) clearTimeout(timer);
    automationPollersRef.current.clear();
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

      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: handleRef.current,
          text: value,
          defaultSettlementRail: localStorage.getItem("bunos:rail") || "arc-testnet",
          source: "terminal",
          fast: true,
          conversation: conversationContext(messages),
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
        followAutomation(data, messageId);
        trackApproval(data);
        trackAutomation(data);
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

  const trackAutomation = (data) => {
    const automation = data?.result?.automation || data?.automation || data?.result?.ran?.[0]?.automation || data?.ran?.[0]?.automation;
    if (!automation?.id) return;
    latestAutomationIdRef.current = automation.id;
    localStorage.setItem("bunos:lastAutomationId", automation.id);
  };

  const followAutomation = useCallback((data, messageId) => {
    const automation = data?.result?.automation || data?.automation || data?.result?.ran?.[0]?.automation || data?.ran?.[0]?.automation;
    if (!automation?.id || automation.status === "completed" || automation.status === "paused") return;
    const key = automation.id;
    if (automationPollersRef.current.has(key)) clearTimeout(automationPollersRef.current.get(key));

    let attempt = 0;
    const poll = async () => {
      attempt += 1;
      try {
        await post("/api/automations/run-due", { limit: 3 });
        const listed = await fetchJson(`/api/automations?handle=${encodeURIComponent(handleRef.current)}&limit=20`);
        const fresh = (listed.automations || []).find((item) => item.id === key) || automation;
        updateMessageHtml(messageId, formatAutomationLiveResult(fresh));
        if (fresh.status === "completed" || fresh.status === "paused" || attempt >= 40) {
          automationPollersRef.current.delete(key);
          return;
        }
      } catch (error) {
        if (attempt >= 40) {
          updateMessageHtml(messageId, `I created the automation, but I could not refresh its live status. ${esc(error.message || "")}`);
          automationPollersRef.current.delete(key);
          return;
        }
      }
      const timer = window.setTimeout(poll, attempt < 4 ? 2500 : 5000);
      automationPollersRef.current.set(key, timer);
    };

    const timer = window.setTimeout(poll, 1200);
    automationPollersRef.current.set(key, timer);
  }, [updateMessageHtml]);

  const hasMessages = messages.length > 0;

  return (
    <div className="terminal-shell">
      <aside className="terminal-rail" aria-label="bunOS terminal navigation">
        <Link to="/" className="rail-logo" aria-label="bunOS home"><BrandLogo size={28} /></Link>
        <span className="rail-icon active" title="Agent">_&gt;</span>
        <Link to="/wallet" className="rail-icon" title="Wallet">W</Link>
        <Link to="/mcp" className="rail-icon" title="MCP">M</Link>
      </aside>

      <main className="terminal-app">
        <header className="terminal-header">
          <div>
            <span className="context-kicker">bunOS workspace</span>
            <h1>Agent terminal</h1>
          </div>
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
              <div className="welcome-mark"><BrandLogo size={42} /></div>
              <h2>Ask bunOS to move, trade, or explain your Arc wallet.</h2>
              <p>Use natural language. I will check the live tools, tell you what I found, and only show the parts you actually need.</p>
              <div className="suggestions">
                {SUGGESTIONS.slice(0, 10).map((cmd) => (
                  <button className="suggestion-chip" key={cmd} onClick={() => handleSubmit(cmd)}>
                    {cmd}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <article className={`msg ${msg.role}`} key={msg.id}>
              {msg.role === "agent" && <div className="tool-trace">Used bunOS tools &gt;</div>}
              <div className="msg-body">
                {msg.html ? (
                  <div className="msg-content" dangerouslySetInnerHTML={{ __html: msg.html }} />
                ) : (
                  <div className="msg-content">{msg.content}</div>
                )}
              </div>
            </article>
          ))}

          {busy && (
            <div className="msg agent working">
              <div className="tool-trace">Checking wallet and live routes &gt;</div>
              <div className="thinking-orbit" aria-label="bunOS is thinking"><span /><span /><span /><span /></div>
            </div>
          )}
        </div>

        <div className="input-area">
          <form className="input-wrap" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <button type="button" className="plus-btn" onClick={() => inputRef.current?.focus()} aria-label="Focus input">+</button>
            <input
              ref={inputRef}
              type="text"
              placeholder="Write a message..."
              autoComplete="off"
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <span className="model-pill">Arc agent</span>
            <button type="submit" className="send-btn" disabled={busy} aria-label="Send message">
              <svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4z" /><path d="m22 2-11 11" /></svg>
            </button>
          </form>
        </div>
      </main>
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
  const hiddenLabels = new Set([
    "tool",
    "action",
    "job",
    "target",
    "route check",
    "required",
    "available",
    "est. fee",
    "output",
    "blocks",
    "checked",
  ]);
  const publicRows = rows
    .filter(([k, v]) => !hiddenLabels.has(String(k || "").toLowerCase()) && String(v ?? "").trim() !== "")
    .map(([k, v]) => {
      const label = String(k || "");
      const value = label.toLowerCase() === "next" && !String(v).includes("<")
        ? esc(humanNextAction(v))
        : v;
      return `<dt>${esc(label)}</dt><dd>${value}</dd>`;
    });
  if (!publicRows.length) return "";
  const inner = publicRows.join("");
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

  const proposalId = data?.execution?.ids?.proposalId
    || data?.result?.executionSummary?.proposalId
    || data?.result?.proposal?.id
    || data?.result?.worker?.result?.proposal?.id
    || data?.result?.worker?.job?.payload?.proposalId
    || (data?.approval?.kind === "perp_trade" ? data.approval.targetId : null)
    || data?.approval?.result?.executionSummary?.proposalId
    || data?.approval?.result?.proposal?.id
    || data?.proposal?.id;
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
    const summary = data?.result?.executionSummary || data?.approval?.result?.executionSummary || {};
    const status = String(monitor.lifecycle || summary.status || data?.result?.proposal?.status || data?.approval?.result?.proposal?.status || data?.proposal?.status || "").toLowerCase();
    return !summary.txHash && ["approved", "queued", "submitted", "confirmed", "succeeded", "running"].includes(status);
  }
  return false;
}

function formatExecutionMonitorFollowup(refreshed, originalData = {}) {
  const monitor = refreshed.monitor || {};
  const continuation = renderWorkflowContinuation(refreshed.workflowContinuation);
  let body = "";
  if (monitor.kind === "defi_action" && refreshed.receipt) {
    body = formatDefiReceiptFollowup({ receipt: refreshed.receipt }, originalData);
  } else {
    body = formatSimpleMonitor(monitor);
  }
  return continuation ? `${body}${continuation}` : body;
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
  if (monitor.truth) return renderTruth(monitor.truth);
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

function renderContextConflict(data = {}) {
  const integrity = data.planned?.contextMeta?.contextIntegrity || data.contextIntegrity || {};
  const items = Array.isArray(integrity.items) ? integrity.items : [];
  const readableItems = items.slice(0, 3).map((item) => contextConflictLine(item)).filter(Boolean);
  const reason = friendlyReason(
    data.execution?.reason || data.reason || readableItems[0] || "I found conflicting context before execution."
  );
  const lines = readableItems.length
    ? readableItems.map((line) => `<div class="conflict-line">${esc(line)}</div>`).join("")
    : `<div class="conflict-line">I found conflicting live information.</div>`;

  return `I paused before moving funds. ${esc(reason)} Nothing moved.
${`<div class="msg-result conflict-card">
  <div class="label">Why I paused</div>
  <div class="conflict-copy">The latest wallet or route data disagreed with earlier context, so I stopped instead of guessing.</div>
  ${lines}
  <div class="workflow-next">Ask me to check the route again, show live routes, or choose another pair.</div>
</div>`}`;
}

function contextConflictLine(item = {}) {
  const type = String(item.type || item.key || "").replaceAll("_", " ");
  const claims = Array.isArray(item.claims) ? item.claims : [];
  const values = claims
    .map((claim) => claim.value ?? claim.status ?? claim.lifecycle)
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value));
  if (!type && !values.length) return "";
  if (!values.length) return `Conflicting ${type || "context"} data.`;
  return `Conflicting ${type || "context"} data: ${values.slice(0, 3).join(" vs ")}.`;
}

function renderWorkflowContinuation(continuation) {
  if (!continuation || continuation.resumed === false) return "";
  const workflow = continuation.workflow || continuation.result?.workflow;
  if (workflow) return renderWorkflowTimeline(workflow, { compact: true });
  return "";
}

function renderWorkflowTimeline(workflow = {}, data = {}) {
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  const status = String(workflow.status || data.status || "running").toLowerCase();
  const title = workflowTitle(status);
  const visibleSteps = steps.length ? steps.slice(0, 6) : [{
    status,
    tool: data.planned?.plan?.tool,
    intent: data.planned?.intent || data.result?.intent || {},
  }];
  const stepHtml = visibleSteps.map((step, index) => {
    const state = workflowStepState(step, status);
    const evidence = step.evidence || step.result?.evidence || step.result || {};
    const txHash = evidence.txHash || evidence.transactionHash || step.txHash;
    const explorerUrl = evidence.explorerUrl || step.explorerUrl;
    const note = workflowStepNote(step, txHash, explorerUrl);
    return `<li class="${state}">
      <span class="workflow-dot"></span>
      <span>
        <strong>${esc(workflowStepLabel(step, index))}</strong>
        ${note ? `<small>${note}</small>` : ""}
      </span>
    </li>`;
  }).join("");
  const next = workflowNextCopy(workflow, status, data);
  return `${esc(title)}
<div class="msg-result workflow-card">
  <div class="label">Agent workflow</div>
  <ol class="workflow-timeline">${stepHtml}</ol>
  ${next ? `<div class="workflow-next">${esc(next)}</div>` : ""}
</div>`;
}

function workflowTitle(status) {
  if (["completed", "settled", "succeeded"].includes(status)) return "Workflow finished.";
  if (["failed", "rejected", "stopped"].includes(status)) return "Workflow stopped.";
  if (["waiting", "paused", "needs_user_signature", "requires_confirmation"].includes(status)) {
    return "I started the workflow and I am waiting on the next safe step.";
  }
  return "I am working through this request.";
}

function workflowStepState(step = {}, workflowStatus = "") {
  const status = String(step.status || step.lifecycle || "").toLowerCase();
  if (["completed", "settled", "succeeded", "done"].includes(status)) return "done";
  if (["failed", "rejected", "blocked"].includes(status)) return "failed";
  if (["running", "waiting", "queued", "submitted", "requires_confirmation", "needs_user_signature"].includes(status)) return "active";
  if (["completed", "settled", "succeeded"].includes(workflowStatus)) return "done";
  return "active";
}

function workflowStepLabel(step = {}, index = 0) {
  const intent = step.intent || step.input?.intent || step.params || {};
  const tool = String(step.tool || step.name || intent.action || "").toLowerCase();
  const amount = intent.amountUsd || intent.amount || intent.collateral || "the requested amount";
  const fromToken = intent.fromToken || intent.asset || "USDC";
  const toToken = intent.toToken || intent.market || "";
  if (/swap/.test(tool)) return `Swap ${amount} ${fromToken}${toToken ? ` to ${toToken}` : ""}`;
  if (/bridge/.test(tool)) return `Bridge ${amount} ${fromToken}`;
  if (/send|payment|transfer/.test(tool)) return `Send ${amount} ${fromToken}${intent.recipientHandle ? ` to ${intent.recipientHandle}` : ""}`;
  if (/perp|position|trade/.test(tool)) return `${intent.side || "Open"} ${toToken || intent.symbol || "perp"} position`;
  if (/balance/.test(tool)) return "Check wallet balance";
  if (/portfolio/.test(tool)) return "Review portfolio";
  if (/quote/.test(tool)) return "Check live route";
  const label = humanNextAction(tool);
  return label && label !== "unknown" ? label : `Step ${index + 1}`;
}

function workflowStepNote(step = {}, txHash, explorerUrl) {
  if (txHash) return `Transaction ${renderTxLink(txHash, explorerUrl)}`;
  const status = String(step.status || step.lifecycle || "").toLowerCase();
  if (status === "requires_confirmation" || status === "needs_user_signature") return "Waiting for your approval.";
  if (status === "queued") return "Queued for execution.";
  if (status === "submitted") return "Submitted, waiting for final receipt.";
  if (status === "failed" || status === "rejected") return esc(friendlyReason(step.reason || step.error || "This step did not finish."));
  return "";
}

function workflowNextCopy(workflow = {}, status = "", data = {}) {
  const next = workflow.nextAction || data.nextAction || data.execution?.nextAction || "";
  if (["completed", "settled", "succeeded"].includes(status)) return "All requested steps are finished.";
  if (["failed", "rejected", "stopped"].includes(status)) return friendlyReason(workflow.reason || data.reason || "Review the stopped step before retrying.");
  if (/approval|signature|confirm/.test(String(next).toLowerCase())) return "Approve the current step when you are ready.";
  if (/receipt|monitor|reconcile|execution/.test(String(next).toLowerCase())) return "I will continue when the receipt is available.";
  if (/budget|resume/.test(String(next).toLowerCase())) return "Say continue when you want me to run the next step.";
  return next ? humanNextAction(next) : "I will keep the context ready for the next step.";
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
    return `Try a currently live pair, like USDC to EURC on Arc, or ask "show live routes".`;
  }
  return `Try a slightly larger amount, check your balance, or try again later.`;
}

function humanNextAction(nextAction) {
  const value = String(nextAction || "");
  if (value === "send_natural_language_request") return "Tell me what you want to do next.";
  if (value === "ask_for_swap_amount") return "Tell me the amount you want to swap.";
  if (value === "ask_for_bridge_amount") return "Tell me the amount you want to bridge.";
  if (value === "check_route_registry_later") return "Ask me to check live routes again later.";
  if (value === "give_automation_schedule") return "Give me the action, interval, and when to stop.";
  if (value === "ready_for_next_instruction") return "Tell me what you want to do next.";
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
  if (execution.tool === "close_arc_perp_user_position" || execution.tool === "close_all_arc_perp_user_positions") {
    if (execution.ok === false) return "Perp close was not submitted.";
    return execution.txHash ? "Perp close submitted on Arc." : "Perp close accepted.";
  }
  if (execution.ok === false) return "I could not complete that action.";
  if (execution.txHash) return "Action submitted on-chain.";
  return "Done. I finished checking that.";
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
  if (data.status === "context_conflict" || execution?.status === "context_conflict") {
    return renderContextConflict(data);
  }
  if (result.workflow || data.workflow) {
    return renderWorkflowTimeline(result.workflow || data.workflow, data);
  }
  if (data.truth && shouldRenderTruth(data, tool)) return renderTruth(data.truth);
  if (tool === "answer_agent_question" || result.answer) {
    return renderAgentAnswer(result, data);
  }
  if (tool === "list_route_capabilities" || Array.isArray(result.routes)) {
    return renderRouteCapabilities(result);
  }
  if (tool === "get_balance" || tool === "sync_circle_balances") {
    return renderWalletBalance(result, tool);
  }
  if (tool === "analyze_portfolio" || result.portfolio?.exposure) {
    return renderPortfolioAnalysis(result);
  }
  if (result.strategyPlan || result.strategy || tool.includes("strategy")) {
    return renderStrategyPlan(result);
  }
  if (tool?.includes("mandate") || result.mandate || Array.isArray(result.mandates)) {
    return renderMandates(result);
  }
  const simple = renderSimplePrimaryResult(data, { result, intent, tool, execution });
  if (simple) return simple;
  if (tool === "propose_perp_trade" || result.proposal) {
    return renderPerpProposalResult({ result, intent, data });
  }
  if (tool?.includes("automation") || result.automation || Array.isArray(result.automations)) {
    return formatAutomationResult(result.automation || result.automations ? result : data);
  }
  if (tool === "get_agent_memory" || result.memoryReport || result.memory?.lastTrade || result.recent?.trades) {
    return renderAgentMemory(result.memoryReport || result);
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
  } else if (tool === "close_arc_perp_user_position" || tool === "close_all_arc_perp_user_positions") {
    summary = formatExecutionResult(data);
  } else {
    summary = renderHumanFallback(data, { result, tool, execution });
  }

  return summary;
}

function renderAgentMemory(report = {}) {
  const recent = report.recent || {};
  const memory = report.memory || {};
  const lastTrade = memory.lastTrade || recent.trades?.[0] || null;
  const activeAutomations = (recent.automations || []).filter((item) => item.status === "active");
  const pending = recent.pendingActions || [];
  const failures = recent.failures || memory.recentFailures || [];
  const title = report.summary || (lastTrade ? "Here is what I remember about the last trade." : "Here is the current wallet memory.");
  const rows = [];
  if (lastTrade) {
    rows.push(["Last trade", esc(lastTrade.truth?.message || memoryTradeLine(lastTrade))]);
    rows.push(["Trade status", statusBadge(lastTrade.status || "unknown", memoryStatusType(lastTrade.status))]);
    rows.push(["Trade tx", renderTxLink(lastTrade.txHash, lastTrade.explorerUrl)]);
  }
  rows.push(["Pending", esc(pending.length ? `${pending.length} action(s)` : "none")]);
  rows.push(["Automations", esc(activeAutomations.length ? `${activeAutomations.length} active` : "none active")]);
  if (activeAutomations[0]) {
    const a = activeAutomations[0];
    rows.push(["Top automation", esc(`${a.name || a.kind || a.id} - ${a.maxRuns ? `${a.runCount || 0}/${a.maxRuns}` : `${a.runCount || 0} runs`}`)]);
  }
  if (failures[0]) rows.push(["Last issue", esc(failures[0].truth?.message || friendlyReason(failures[0].reason || failures[0].status || "unknown"))]);
  rows.push(["Next", esc(report.nextAction || "ready")]);
  return `${esc(title)}${renderResultCard(rows)}`;
}

function memoryTradeLine(trade = {}) {
  if (trade.type === "perp") {
    return `${trade.side || "perp"} ${trade.symbol || ""}${trade.leverage ? ` ${trade.leverage}x` : ""}${trade.positionId ? `, position #${trade.positionId}` : ""}`;
  }
  if (trade.type === "swap") {
    return `swap ${trade.amount || "some"} ${trade.fromToken || "USDC"} to ${trade.toToken || "token"}`;
  }
  if (trade.type === "bridge") {
    return `bridge ${trade.amount || "some"} ${trade.fromToken || "USDC"}`;
  }
  return trade.tool || trade.intent || trade.type || "action";
}

function memoryStatusType(status) {
  const value = String(status || "").toLowerCase();
  if (["settled", "submitted", "succeeded", "completed"].includes(value)) return "ok";
  if (["failed", "rejected", "quote_unavailable", "execution_failed"].includes(value)) return "fail";
  return "warn";
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
    const modelSummary = data.narrative?.model?.role === "execution_narrator" ? data.narrative.summary : "";
    if (modelSummary) {
      const txHash = action.txHash || action.execution?.txHash || execution?.txHash || data.txHash;
      const explorerUrl = action.explorerUrl || action.execution?.explorerUrl || execution?.explorerUrl || data.explorerUrl;
      const receiptUrl = result.receipt?.publicUrl || action.publicUrl || execution?.receiptUrl;
      const nextAction = result.nextAction || action.nextAction || execution?.nextAction || data.nextAction || data.narrative?.nextAction || "";
      return `${esc(modelSummary)}${renderSimpleReceiptRows({ txHash, explorerUrl, receiptUrl, nextAction })}`;
    }
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

  if ((tool === "close_arc_perp_user_position" || tool === "close_all_arc_perp_user_positions") && execution) {
    return `${esc(userFriendlyExecutionTitle(execution))}${renderSimpleReceiptRows({
      txHash: execution.txHash || data.txHash,
      explorerUrl: execution.explorerUrl || data.explorerUrl,
      receiptUrl: execution.receiptUrl,
      nextAction: friendlyReason(execution.reason || execution.nextAction || data.nextAction || "monitor_receipt")
    })}`;
  }

  return "";
}

function renderHumanFallback(data = {}, { result = {}, tool = "", execution = null } = {}) {
  const ok = data.ok !== false && result.ok !== false && execution?.ok !== false;
  const summary = data.narrative?.summary
    || result.answer
    || result.reason
    || execution?.reason
    || data.reason
    || (ok ? "I finished checking that." : "I could not complete that.");
  const next = result.nextAction || data.nextAction || execution?.nextAction;
  const rows = [];
  if (data.txHash || execution?.txHash) {
    rows.push(["Transaction", renderTxLink(data.txHash || execution.txHash, data.explorerUrl || execution.explorerUrl)]);
  }
  if (data.receiptUrl || execution?.receiptUrl) {
    rows.push(["Receipt", `<a href="${esc(data.receiptUrl || execution.receiptUrl)}" target="_blank" rel="noreferrer" style="color:var(--accent)">open</a>`]);
  }
  if (next && next !== "none") {
    rows.push(["Next", esc(humanNextAction(next))]);
  }
  if (!rows.length && /portfolio|balance|wallet/i.test(`${tool} ${summary}`)) {
    rows.push(["Next", "Ask me to refresh balances, review risk, or plan a rebalance."]);
  }
  return `${esc(friendlyReason(summary))}${rows.length ? renderResultCard(rows) : ""}`;
}

function renderWalletBalance(result = {}, tool = "get_balance") {
  const wallet = result.wallet || result.profile || {};
  const railRows = [];
  const tokenBalances = wallet.tokenBalances || {};
  const railIds = Array.from(new Set([
    ...Object.keys(wallet.balances || {}),
    ...Object.keys(tokenBalances),
    "arc-testnet",
    "base-sepolia"
  ]));

  for (const railId of railIds) {
    const tokens = Array.isArray(tokenBalances[railId])
      ? tokenBalances[railId]
      : [{ symbol: "USDC", amount: wallet.balances?.[railId] || 0 }];
    const nonZero = tokens.filter((token) => Number(token.amount || 0) > 0);
    railRows.push([
      humanRail(railId),
      nonZero.length
        ? nonZero.map((token) => `${formatTokenAmount(token.amount)} ${esc(token.symbol || token.asset || "USDC")}`).join("<br>")
        : `<span style="color:var(--ink-muted)">0</span>`
    ]);
  }

  return `${tool === "sync_circle_balances" ? "I refreshed your wallet balances." : "Here is your wallet balance right now."}${renderResultCard([
    ["Handle", esc(wallet.handle || "your wallet")],
    ["Total", `${esc(wallet.balance ?? wallet.totalBalanceUsd ?? "0")} USDC`],
    ...railRows
  ])}`;
}

function renderRouteCapabilities(result = {}) {
  const routes = Array.isArray(result.routes) ? result.routes : [];
  const live = routes.filter((route) => String(route.status || "").toLowerCase() === "live");
  const blocked = routes.filter((route) => String(route.status || "").toLowerCase() !== "live");
  const title = live.length
    ? "I checked the live route registry. These routes are available right now."
    : "I checked the live route registry, and I do not see a route I should execute right now.";
  const rows = [];
  if (live.length) {
    rows.push(["Live", live.slice(0, 8).map(renderRouteLine).join("<br>")]);
  }
  if (blocked.length) {
    rows.push(["Not live", blocked.slice(0, 5).map((route) => `${renderRouteLine(route)} - ${esc(friendlyReason(route.reason || route.lastError || "not routable"))}`).join("<br>")]);
  }
  rows.push(["Next", live.length ? "Tell me the amount and route, like: swap 1 USDC to EURC on Arc." : "Ask me to check again later, or use a live pair when one appears."]);
  return `${title}${renderResultCard(rows)}`;
}

function renderRouteLine(route = {}) {
  const type = route.type === "bridge" ? "Bridge" : "Swap";
  if (route.type === "bridge") {
    return `${type}: ${esc(route.fromToken || "USDC")} ${esc(humanRail(route.fromRail))} -> ${esc(humanRail(route.toRail))}`;
  }
  return `${type}: ${esc(route.fromToken || "?")} -> ${esc(route.toToken || "?")} on ${esc(humanRail(route.fromRail || route.settlementRail))}`;
}

function renderAgentAnswer(result = {}, data = {}) {
  const answer = cleanAgentAnswer(result.answer || data.summary || "I checked that for you.", result);
  const rows = [];
  if (Array.isArray(result.capabilities) && result.capabilities.length) {
    rows.push(["I can help with", result.capabilities.slice(0, 6).map(cleanCapability).map(esc).join("<br>")]);
  }
  if (Array.isArray(result.routes) && result.routes.length) {
    rows.push(["Available routes", result.routes.slice(0, 6).map((route) => {
      if (route.type === "bridge") return `${esc(route.fromToken || "USDC")} ${esc(humanRail(route.fromRail))} -> ${esc(humanRail(route.toRail))}`;
      return `${esc(route.fromToken)} -> ${esc(route.toToken)} on ${esc(humanRail(route.fromRail))}`;
    }).join("<br>")]);
  }
  if (Array.isArray(result.automations) && result.automations.length) {
    rows.push(["Automations", result.automations.slice(0, 6).map((automation) => {
      const status = statusBadge(automation.status || "unknown", automation.status === "active" ? "ok" : "warn");
      return `<code>${esc(automation.id || "automation")}</code> ${status} ${esc(automation.name || automation.prompt || "automation")}`;
    }).join("<br>")]);
  }
  if (result.nextAction || data.nextAction) rows.push(["Next", esc(humanNextAction(result.nextAction || data.nextAction))]);
  return `${esc(answer)}${rows.length ? renderResultCard(rows) : ""}`;
}

function cleanAgentAnswer(answer, result = {}) {
  const raw = String(answer || "").trim();
  if (/^action is answered/i.test(raw)) {
    if (Array.isArray(result.routes) && result.routes.length) {
      return "I checked the live routes for you.";
    }
    if (Array.isArray(result.automations) && result.automations.length) {
      return "Here are the automations I found.";
    }
    if (Array.isArray(result.capabilities) && result.capabilities.length) {
      return "Here is what I can do with your wallet.";
    }
    return "I checked that for you.";
  }
  if (/^the agent will read/i.test(raw)) {
    return "I can check that live. Here is what is available right now.";
  }
  return raw;
}

function cleanCapability(capability) {
  return String(capability || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shouldRenderTruth(data, tool) {
  const status = String(data.status || data.result?.status || data.execution?.status || data.truth?.phase || "").toLowerCase().replaceAll(" ", "_");
  if (status === "clarification_required" || status === "needs_more_detail") return false;
  if (tool === "answer_agent_question" || data.result?.answer) return false;
  if (tool === "get_balance" || tool === "sync_circle_balances" || tool === "get_agent_memory") return false;
  if (tool === "list_route_capabilities" || tool === "list_arc_trading_primitives") return false;
  if (tool === "analyze_portfolio" || tool === "get_market_intelligence" || tool === "get_market_feed_snapshot") return false;
  if (tool?.includes("strategy") || tool?.includes("mandate")) return false;
  if (data.result?.automation || Array.isArray(data.result?.automations)) return false;
  const phase = String(data.truth?.phase || "").toLowerCase();
  return Boolean(data.truth?.message && phase && phase !== "planned");
}

function renderTruth(truth = {}) {
  const rows = [];
  if (truth.phase) rows.push(["Status", statusBadge(truth.phase, truthStatusType(truth.phase))]);
  if (truth.target) rows.push(["Target", esc(truth.target)]);
  if (truth.txHash) rows.push(["Transaction", renderTxLink(truth.txHash, truth.explorerUrl)]);
  if (truth.receiptUrl) rows.push(["Receipt", `<a href="${esc(truth.receiptUrl)}" target="_blank" rel="noreferrer" style="color:var(--accent)">open</a>`]);
  if (truth.nextAction) rows.push(["Next", esc(humanNextAction(truth.nextAction))]);
  return `${esc(friendlyTruthMessage(truth))}${rows.length ? renderResultCard(rows) : ""}`;
}

function friendlyTruthMessage(truth = {}) {
  const message = String(truth.message || "");
  if (/^Action is answered/i.test(message)) return "I answered that.";
  return message || "I checked the action.";
}

function truthStatusType(phase) {
  const value = String(phase || "").toLowerCase();
  if (["settled", "completed", "submitted"].includes(value)) return "ok";
  if (["failed", "expired"].includes(value)) return "fail";
  return "warn";
}

function userFriendlyExecutionTitle(execution = {}) {
  if (execution.tool === "close_arc_perp_user_position" || execution.tool === "close_all_arc_perp_user_positions") {
    return execution.ok === false
      ? "I could not close the perp position. Nothing changed."
      : "I sent the close request.";
  }
  if (execution.ok === false) return "I could not complete that action.";
  return "Done.";
}

function formatApprovalResult(data) {
  const payload = approvalExecutionPayload(data);
  const status = payload.status || "approved";
  const txHash = payload.txHash;
  const reason = payload.reason || "";
  const kind = payload.kind || data.approval?.kind || "action";
  const lowerStatus = String(status).toLowerCase();
  const failed = ["failed", "rejected", "execution_failed", "user_wallet_signing_required", "execution_not_enabled"].includes(lowerStatus)
    || (!txHash && reason && /failed|not enough|missing|disabled|could not|not configured/i.test(reason));
  const title = txHash
    ? (kind === "perp_trade" ? "Perp trade submitted on Arc." : "Approved. I submitted it on-chain.")
    : failed
      ? "Approved, but execution did not finish."
      : kind === "perp_trade"
        ? "Approved. I am checking the perp execution now."
        : "Approved. I am checking the execution now.";
  return `${esc(title)}
${renderResultCard([
  ["Status", statusBadge(status, txHash ? "ok" : failed ? "fail" : "warn")],
  ["Transaction", renderTxLink(txHash, payload.explorerUrl)],
  ["Next", esc(friendlyReason(reason || payload.nextAction || "I will keep checking the receipt."))],
])}`;
}

function approvalExecutionPayload(data = {}) {
  const result = data.result || data.approval?.result || {};
  const summary = result.executionSummary || data.approval?.result?.executionSummary || {};
  const worker = result.worker
    || data.worker?.ran?.find?.((item) => item?.job?.id === result.job?.id)
    || data.worker?.ran?.[0]
    || {};
  const workerResult = worker.result || {};
  const job = worker.job || result.job || workerResult.job || {};
  const proposal = workerResult.proposal || result.proposal || {};
  const action = workerResult.action || result.action || {};
  const payment = workerResult.payment || result.payment || {};
  const execution = workerResult.execution
    || result.execution
    || action.execution
    || proposal.execution
    || payment.transfer
    || {};
  return {
    kind: summary.kind || data.approval?.kind,
    status: summary.status || execution.status || proposal.status || action.status || payment.status || workerResult.status || job.status || data.approval?.status || "approved",
    txHash: summary.txHash || execution.txHash || proposal.txHash || action.txHash || payment.transfer?.txHash || workerResult.txHash || null,
    explorerUrl: summary.explorerUrl || execution.explorerUrl || action.explorerUrl || payment.transfer?.explorerUrl || workerResult.explorerUrl || null,
    reason: summary.reason || worker.error || workerResult.error || workerResult.reason || execution.reason || proposal.execution?.reason || action.failureReason || job.lastError || result.reason || "",
    nextAction: summary.nextAction || result.nextAction || action.nextAction || execution.nextAction || data.nextAction || ""
  };
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
<div><code>swap $1 USDC to EURC on arc</code> - Swap tokens</div>
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
  if (Array.isArray(data.ran)) {
    if (!data.ran.length) return `No automations were due right now.`;
    return `I checked the active automations.${renderResultCard(data.ran.slice(0, 6).map((run) => [
      `<code>${esc(run.automation?.id || "automation")}</code>`,
      `${statusBadge(run.automation?.status || (run.ok ? "ran" : "failed"), run.ok ? "ok" : "fail")} ${esc(automationRunLine(run))}`,
    ]))}`;
  }
  if (Array.isArray(data.automations)) {
    if (!data.automations.length) return `No automations found.`;
  const rows = data.automations.slice(0, 8).map((a) => [
      `<code>${esc(a.id)}</code>`,
      `${esc(a.name || a.kind)} - ${statusBadge(a.status || "active", a.status === "completed" ? "ok" : "warn")} - every ${esc(formatAutomationInterval(a))}${a.maxRuns ? ` - ${esc(a.runCount || 0)}/${esc(a.maxRuns)} runs` : ""}${a.lastResult ? ` - last ${esc(automationLastLine(a.lastResult))}` : ""}`,
    ]);
    return `Automations loaded.${renderResultCard(rows)}`;
  }
  const automation = data.automation || data.result?.automation;
  if (automation) {
    return `Automation saved. I will watch it here as it runs.${renderResultCard([
      ["ID", `<code>${esc(automation.id)}</code>`],
      ["Name", esc(automation.name || automation.kind)],
      ["Status", statusBadge(automation.status || "active", "ok")],
      ["Interval", esc(formatAutomationInterval(automation))],
      ["Runs", automation.maxRuns ? `${esc(automation.runCount || 0)}/${esc(automation.maxRuns)}` : "until stopped"],
      ["Next run", esc(formatNextRun(automation.nextRunAt))],
    ])}`;
  }
  return `Automation command completed.`;
}

function formatAutomationLiveResult(automation = {}) {
  const last = automation.lastResult || {};
  const done = automation.status === "completed";
  const title = automation.status === "paused"
    ? "Automation is paused."
    : done
      ? "Automation finished."
      : "Automation is running.";
  return `${title}${renderResultCard([
    ["ID", `<code>${esc(automation.id || "n/a")}</code>`],
    ["Status", statusBadge(automation.status || "active", done ? "ok" : "warn")],
    ["Runs", automation.maxRuns ? `${esc(automation.runCount || 0)}/${esc(automation.maxRuns)}` : `${esc(automation.runCount || 0)} runs`],
    ["Last run", automation.lastRunAt ? esc(new Date(automation.lastRunAt).toLocaleTimeString()) : "not yet"],
    ["Last result", esc(last.status || automation.lastError || "waiting")],
    ["Last note", esc(last.truth?.message || last.reason || last.error || "")],
    ["Next run", esc(formatNextRun(automation.nextRunAt))],
  ])}`;
}

function automationRunLine(run = {}) {
  const automation = run.automation || {};
  const result = run.result || {};
  if (run.error) return run.error;
  return `${automation.name || automation.kind || "automation"} ran ${automation.runCount || 0}${automation.maxRuns ? `/${automation.maxRuns}` : ""}; ${automationLastLine(result.truth ? result : automation.lastResult || result)}`;
}

function automationLastLine(last = {}) {
  if (last.truth?.message) return last.truth.message;
  if (last.txHash) return "submitted on-chain";
  if (last.reason || last.error) return friendlyReason(last.reason || last.error);
  return last.status || (last.ok ? "ok" : "failed");
}

function formatNextRun(value) {
  if (!value) return "none";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "n/a";
  const delta = ts - Date.now();
  if (delta <= 0) return "now";
  if (delta < 60_000) return `in ${Math.ceil(delta / 1000)} sec`;
  return `in ${Math.ceil(delta / 60_000)} min`;
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

function conversationContext(messages = []) {
  return messages
    .filter((message) => message.role === "user" || message.role === "agent")
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: plainText(message.content || message.html || "")
    }));
}

function plainText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

