import { useCallback, useEffect, useState } from "react";
import { useSession } from "../hooks/useSession";
import { useToast } from "../hooks/useToast";
import { fetchJson, post, requestJson, money, formatNumber, formatTokenAmount, compactAddress, shortRail, normalizeToken, statusLabel, formatDate } from "../api";
import Modal from "../components/Modal";
import "./Wallet.css";

export default function Wallet() {
  const { session, config, currentHandle, wallets, refresh, upsertWallet, login } = useSession();
  const notify = useToast();
  const [selectedRail, setSelectedRail] = useState(() => localStorage.getItem("bunos:rail") || "arc-testnet");
  const [activeView, setActiveView] = useState("agent");
  const [payments, setPayments] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [defiActions, setDefiActions] = useState([]);
  const [airdrops, setAirdrops] = useState([]);
  const [primitives, setPrimitives] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [market, setMarket] = useState(null);
  const [mandates, setMandates] = useState([]);
  const [agentHealth, setAgentHealth] = useState(null);
  const [agentEvents, setAgentEvents] = useState([]);
  const [automations, setAutomations] = useState([]);
  const [cockpitLoading, setCockpitLoading] = useState(false);
  const [cockpitError, setCockpitError] = useState("");
  const [modal, setModal] = useState(null);

  const wallet = wallets.find((w) => w.handle === currentHandle);
  const hasWallet = Boolean(wallet?.onboarded);
  const rails = config.settlementRails || [];

  /* ─── Load activity data ─────────────────── */
  const loadActivity = useCallback(async () => {
    if (!currentHandle) return;
    try {
      const [ledger, approvalData, defiData, airdropData, primitiveData] = await Promise.all([
        fetchJson("/api/state"),
        fetchJson(`/api/approvals?handle=${encodeURIComponent(currentHandle)}&limit=25`),
        fetchJson(`/api/defi/actions?handle=${encodeURIComponent(currentHandle)}&limit=25`),
        fetchJson(`/api/airdrops?handle=${encodeURIComponent(currentHandle)}&limit=25`),
        fetchJson("/api/arc/trading-primitives"),
      ]);
      setPayments(ledger.payments || []);
      setApprovals(approvalData.approvals || []);
      setDefiActions(defiData.actions || []);
      setAirdrops(airdropData.airdrops || []);
      setPrimitives(primitiveData.primitives || []);
    } catch {}
  }, [currentHandle]);

  const loadCockpit = useCallback(async () => {
    if (!currentHandle) return;
    setCockpitLoading(true);
    setCockpitError("");
    try {
      const [portfolioData, marketData, mandateData, automationData] = await Promise.all([
        fetchJson(`/api/portfolio/analyze?handle=${encodeURIComponent(currentHandle)}&settlementRail=${encodeURIComponent(selectedRail)}`),
        fetchJson(`/api/market/feeds?settlementRail=${encodeURIComponent(selectedRail)}&assets=USDC,EURC,cirBTC,WETH,NATIVE`),
        fetchJson(`/api/mandates?handle=${encodeURIComponent(currentHandle)}&limit=20`),
        fetchJson(`/api/automations?handle=${encodeURIComponent(currentHandle)}`),
      ]);
      setPortfolio(portfolioData);
      setMarket(marketData);
      setMandates(mandateData.mandates || []);
      setAutomations(automationData.automations || []);

      const [healthData, eventData] = await Promise.all([
        fetchJson("/api/admin/agent-health").catch((err) => ({ unavailable: true, reason: err.message })),
        fetchJson("/api/admin/agent-events?limit=20").catch(() => ({ events: [] })),
      ]);
      setAgentHealth(healthData);
      setAgentEvents(eventData.events || []);
    } catch (err) {
      setCockpitError(err.message);
    } finally {
      setCockpitLoading(false);
    }
  }, [currentHandle, selectedRail]);

  useEffect(() => { loadActivity(); }, [loadActivity]);
  useEffect(() => { loadCockpit(); }, [loadCockpit]);

  useEffect(() => {
    if (!rails.some((r) => r.id === selectedRail) && rails.length) {
      setSelectedRail(rails[0].id);
    }
  }, [rails, selectedRail]);

  /* ─── Wallet helpers ─────────────────── */
  const syncWallet = async (opts = {}) => {
    if (!currentHandle || !wallet?.onboarded) return;
    try {
      const synced = await post("/api/wallets/sync-balances", { handle: currentHandle });
      if (synced.wallet) upsertWallet(synced.wallet);
    } catch (err) {
      if (!opts.silent) notify(err.message);
    }
  };

  const runWorkerOnce = async () => {
    try { await post("/api/jobs/run-due", { limit: 10 }); } catch {}
  };

  const handleRefresh = async () => {
    await syncWallet();
    await refresh();
    await loadActivity();
    await loadCockpit();
    notify("Wallet refreshed");
  };

  const handleLogin = async () => {
    await login(currentHandle || "@demo");
    notify("X connected and Circle wallets created");
    await loadActivity();
    await loadCockpit();
  };

  /* ─── Form handlers ─────────────────── */
  const handleFund = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await post("/api/wallets/fund", {
      handle: currentHandle,
      amount: Number(form.get("amount")),
      source: form.get("source"),
      settlementRail: form.get("settlementRail") || selectedRail,
    });
    setModal(null);
    notify(form.get("source") === "circle_faucet" ? "Circle faucet requested" : "Funding instruction created");
    await refresh();
    await loadActivity();
    await loadCockpit();
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const result = await post("/api/wallets/send", {
      senderHandle: currentHandle,
      recipientHandle: form.get("recipientHandle"),
      amount: Number(form.get("amount")),
      settlementRail: form.get("settlementRail") || selectedRail,
      memo: form.get("memo"),
    });
    setModal(null);
    await runWorkerOnce();
    notify(result.payment?.status === "claimable" ? "Payment ready for claim" : "Payment processing");
    await refresh();
    await loadActivity();
    await loadCockpit();
  };

  const handleBridge = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const result = await post("/api/defi/quote", {
      handle: currentHandle,
      type: "bridge",
      amount: Number(form.get("amount")),
      slippage: 0.005,
      fromRail: form.get("fromRail"),
      toRail: form.get("toRail"),
      fromToken: normalizeToken(form.get("fromToken")) || "USDC",
      toToken: normalizeToken(form.get("fromToken")) || "USDC",
    });
    setModal(null);
    notify(result.action?.status === "submitted" ? "Bridge submitted" : "Bridge route created");
    await syncWallet();
    await refresh();
    await loadActivity();
    await loadCockpit();
  };

  const handleSwap = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const result = await post("/api/defi/quote", {
      handle: currentHandle,
      type: "swap",
      amount: Number(form.get("amount")),
      slippage: Number(form.get("slippage")),
      fromRail: form.get("fromRail") || selectedRail,
      toRail: form.get("fromRail") || selectedRail,
      fromToken: normalizeToken(form.get("fromToken")) || "USDC",
      toToken: normalizeToken(form.get("toToken")) || "EURC",
    });
    setModal(null);
    notify(result.action?.status === "submitted" ? "Swap submitted" : "Swap route created");
    await syncWallet();
    await refresh();
    await loadActivity();
    await loadCockpit();
  };

  const handleAirdrop = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const recipients = String(form.get("recipients") || "")
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const maxRecipients = Number(form.get("maxRecipients") || 0);
    const result = await post("/api/airdrops", {
      senderHandle: currentHandle,
      recipients,
      amountPerRecipient: Number(form.get("amountPerRecipient")),
      maxRecipients: recipients.length ? undefined : maxRecipients,
      postId: form.get("postId") || undefined,
      rule: recipients.length ? "fixed_recipients" : "first_commenters",
      settlementRail: form.get("settlementRail") || selectedRail,
      memo: form.get("memo") || "",
    });
    setModal(null);
    notify(result.airdrop?.status === "watching_replies" ? "Distribution is watching for recipients" : "Distribution created");
    await runWorkerOnce();
    await refresh();
    await loadActivity();
    await loadCockpit();
  };

  const handleCopyAddress = async () => {
    const chainWallet = wallet?.wallets?.find((w) => w.rail === selectedRail);
    const addr = chainWallet?.address || wallet?.walletAddress;
    if (addr) {
      await navigator.clipboard.writeText(addr);
      notify("Wallet address copied");
    }
  };

  const confirmApproval = async (approvalId) => {
    await post("/api/actions/confirm", { approvalId, handle: currentHandle });
    await runWorkerOnce();
    notify("Action approved");
    await refresh();
    await loadActivity();
    await loadCockpit();
  };

  const awardAirdrop = async (airdropId) => {
    const raw = window.prompt("Winner X handles separated by spaces or commas");
    if (!raw) return;
    const winnerHandles = raw
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!winnerHandles.length) return;
    await post(`/api/airdrops/${encodeURIComponent(airdropId)}/award`, { winnerHandles });
    await runWorkerOnce();
    notify("Recipients awarded");
    await refresh();
    await loadActivity();
    await loadCockpit();
  };

  const handleCreateMandate = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const text = String(form.get("text") || "").trim();
    if (!text) return;
    const result = await post("/api/mandates", { handle: currentHandle, text, source: "dashboard" });
    setModal(null);
    notify(result.status === "saved_with_conflicts" ? "Rule saved with conflicts" : "Rule saved");
    await loadCockpit();
  };

  const handleDeleteMandate = async (mandateId) => {
    await requestJson(`/api/mandates/${encodeURIComponent(mandateId)}`, {
      method: "DELETE",
      body: { handle: currentHandle },
    });
    notify("Rule removed");
    await loadCockpit();
  };

  /* ─── Derived data ─────────────────── */
  const chainWallet = wallet?.wallets?.find((w) => w.rail === selectedRail);
  const address = chainWallet?.address || wallet?.walletAddress || "Connect X";
  const totalBalance = Number(wallet?.balance ?? railTokenTotal(wallet, selectedRail));
  const currentRail = rails.find((r) => r.id === selectedRail);
  const pendingExecutions = buildPendingExecutions({ portfolio, defiActions, payments, approvals, automations });
  const timeline = buildTimeline({ agentEvents, defiActions, payments, airdrops, mandates, automations, currentHandle });
  const riskWarnings = buildRiskWarnings({ portfolio, market, agentHealth });
  const activeMandates = mandates.filter((mandate) => mandate.status === "active");

  const railOptions = rails.map((r) => (
    <option key={r.id} value={r.id}>{r.label}</option>
  ));

  const connectCopy = config.x?.authMode === "real"
    ? "Connect with real X OAuth. Circle wallets are provisioned after authorization."
    : "Local X auth is simulated until the app is on HTTPS, but Circle/AppKit execution can still use real configured wallets.";

  return (
    <>
      <main className="wallet-main">
        <section className="summary-section" aria-label="Wallet summary">
          <div className="balance-panel">
            <div className="balance-panel-inner">
              <div className="balance-top">
                <div className="panel-kicker">Available balance</div>
                <h1 className="balance-amount">{money(totalBalance)}</h1>
              </div>
              <div className="quick-actions" aria-label="Wallet actions">
                <button type="button" className="primary-action" onClick={() => setModal("fund")}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                  Fund
                </button>
                <button type="button" className="secondary-action" onClick={() => setModal("send")}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
                  Send
                </button>
                <button type="button" className="secondary-action" onClick={() => setModal("receive")}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg>
                  Receive
                </button>
                <button type="button" className="secondary-action" onClick={() => setModal("bridge")}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
                  Bridge
                </button>
                <button type="button" className="secondary-action" onClick={() => setModal("swap")}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3l4 4-4 4" /><path d="M20 7H4" /><path d="M8 21l-4-4 4-4" /><path d="M4 17h16" /></svg>
                  Swap
                </button>
                <button type="button" className="secondary-action" onClick={() => setModal("airdrop")}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" /></svg>
                  Distribute
                </button>
              </div>
            </div>
            <div className="balance-orb" aria-hidden="true" />
          </div>

          {!hasWallet && (
            <div className="connect-card">
              <div className="connect-provider">
                <span className="x-logo-mark" aria-hidden="true">X</span>
                <span className="panel-kicker">X account</span>
              </div>
              <strong>Connect X to create Circle wallets.</strong>
              <p>{connectCopy}</p>
              <form className="connect-signin-form" onSubmit={(e) => { e.preventDefault(); handleLogin(); }}>
                <button type="submit" className="x-signin-button">
                  <span className="x-signin-mark" aria-hidden="true">X</span>
                  Sign in with X
                </button>
              </form>
            </div>
          )}
        </section>

        <section className="page-section">
          <div className="wallet-view-tabs">
            <button className={`view-tab${activeView === "agent" ? " active" : ""}`} onClick={() => setActiveView("agent")}>Agent</button>
            <button className={`view-tab${activeView === "assets" ? " active" : ""}`} onClick={() => setActiveView("assets")}>Assets</button>
            <button className={`view-tab${activeView === "activity" ? " active" : ""}`} onClick={() => setActiveView("activity")}>Activity</button>
            <button className={`view-tab${activeView === "primitives" ? " active" : ""}`} onClick={() => setActiveView("primitives")}>Primitives</button>
            <div style={{ flex: 1 }} />
            <button type="button" className="ghost-button" onClick={handleRefresh} style={{ marginLeft: "auto" }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></svg>
              Refresh
            </button>
          </div>

          {activeView === "agent" && (
            <AgentCockpit
              wallet={wallet}
              hasWallet={hasWallet}
              portfolio={portfolio}
              market={market}
              agentHealth={agentHealth}
              activeMandates={activeMandates}
              pendingExecutions={pendingExecutions}
              timeline={timeline}
              riskWarnings={riskWarnings}
              cockpitLoading={cockpitLoading}
              cockpitError={cockpitError}
              onAddMandate={() => setModal("mandate")}
              onDeleteMandate={handleDeleteMandate}
              onRefresh={handleRefresh}
            />
          )}

          {activeView === "assets" && (
            <div className="asset-list">
              {!hasWallet ? (
                <div className="empty-state"><strong>No wallet yet</strong><span>Connect an X handle to provision Circle wallets.</span></div>
              ) : (
                rails.map((rail) => {
                  const tokens = tokensForRail(wallet, rail.id);
                  const total = railTokenTotal(wallet, rail.id);
                  const tokenSummary = tokens
                    .filter((t) => Number(t.amount || 0) > 0)
                    .map((t) => `${formatTokenAmount(t.amount)} ${t.symbol}`)
                    .join(" · ") || "No tokens";
                  return (
                    <div className="asset-item" key={rail.id}>
                      <div className="asset-icon">{shortRail(rail.id)}</div>
                      <div className="asset-info">
                        <div className="asset-name">{rail.label}</div>
                        <div className="asset-sub">{tokenSummary}</div>
                      </div>
                      <div className="asset-value">
                        <strong className="asset-usd">{money(total)}</strong>
                        {tokens.filter((t) => Number(t.amount || 0) > 0).map((t) => (
                          <small key={t.symbol}>{formatTokenAmount(t.amount)} {t.symbol}</small>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeView === "activity" && (
            <div className="activity-list">
              {defiActions.length === 0 && payments.length === 0 && airdrops.length === 0 ? (
                <div className="empty-state"><strong>No activity yet</strong><span>Bridge, swap, or send USDC to see live activity here.</span></div>
              ) : (
                <>
                  {airdrops.map((airdrop) => (
                    <div className="activity-item" key={airdrop.id}>
                      <div className="act-icon">A</div>
                      <div className="act-info">
                        <div className="act-title">Distribution · {statusLabel(airdrop.status)}</div>
                        <div className="act-sub">
                          {formatNumber(airdrop.amountPerRecipient)} {airdrop.asset} each · {airdrop.winnerHandles?.length || 0}/{airdrop.maxRecipients} recipients · {formatDate(airdrop.createdAt)}
                        </div>
                      </div>
                      <div className="act-amount">
                        <strong>{money(airdrop.totalBudget)}</strong>
                        <div className="activity-actions">
                          {airdrop.status === "watching_replies" && (
                            <button type="button" className="inline-action" onClick={() => awardAirdrop(airdrop.id)}>
                              Choose recipients
                            </button>
                          )}
                          {airdrop.approvalId && (
                            <button type="button" className="inline-action" onClick={() => confirmApproval(airdrop.approvalId)}>
                              Approve
                            </button>
                          )}
                          <a className="inline-action link-action" href={`/airdrops/${airdrop.id}`} target="_blank" rel="noreferrer">
                            Receipt
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                  {defiActions.map((action) => {
                    const approval = approvals.find((a) => a.id === action.approvalId);
                    const needsApproval = approval?.status === "pending";
                    const provider = action.quote?.provider || action.protocol || "policy";
                    const amount = action.request?.amount || action.request?.amountUsd || 0;
                    const railsStr = [action.request?.fromRail, action.request?.toRail].filter(Boolean).map(shortRail).join(" -> ");
                    const tokenRoute = action.type === "swap"
                      ? `${action.request?.fromToken || "USDC"} -> ${action.request?.toToken || ""}`
                      : `${action.request?.fromToken || "USDC"}`;
                    return (
                      <div className="activity-item" key={action.id}>
                        <div className="act-icon">{action.type?.charAt(0).toUpperCase()}</div>
                        <div className="act-info">
                          <div className="act-title">{actionLabel(action)} · {provider} · {statusLabel(action.status)}</div>
                          <div className="act-sub">{formatNumber(amount)} {tokenRoute} {railsStr}</div>
                        </div>
                        <div className="act-amount">
                          {needsApproval && (
                            <button type="button" className="inline-action" onClick={() => confirmApproval(approval.id)}>
                              Approve
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {payments.filter((p) => p.senderHandle === currentHandle || p.recipientHandle === currentHandle).reverse().map((p) => (
                    <div className="activity-item" key={p.id}>
                      <div className={`act-icon ${p.senderHandle === currentHandle ? "" : "in"}`}>
                        {p.senderHandle === currentHandle ? "S" : "R"}
                      </div>
                      <div className="act-info">
                        <div className="act-title">{p.senderHandle === currentHandle ? "Sent" : "Received"}</div>
                      </div>
                      <div className="act-amount">
                        <strong>{formatNumber(p.amount)}</strong>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {activeView === "primitives" && (
            <div className="primitive-grid">
              {primitives.length === 0 ? (
                <div className="empty-state"><strong>Primitive readiness unavailable</strong><span>Refresh to load Arc trading primitive status.</span></div>
              ) : primitives.map((primitive) => (
                <div className="primitive-card" key={primitive.name}>
                  <div className="primitive-head">
                    <span>{primitive.name}</span>
                    <strong>{statusLabel(primitive.status)}</strong>
                  </div>
                  <p>{primitive.provider}</p>
                  <div className="primitive-tools">
                    {(primitive.tools || []).slice(0, 4).map((tool) => <code key={tool}>{tool}</code>)}
                  </div>
                  {primitive.blockers?.length > 0 && <small>{primitive.blockers.join(" · ")}</small>}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ─── Modals ──────────────────────── */}
      <Modal id="modalFund" open={modal === "fund"} onClose={() => setModal(null)} title="Fund wallet">
        <form onSubmit={handleFund} className="modal-form" style={{ padding: 0 }}>
          <label><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" defaultValue="25" /></label>
          <label><span>Source</span>
            <select name="source">
              <option value="circle_faucet">Circle testnet faucet</option>
              <option value="external_wallet">External wallet</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="card">Card</option>
            </select>
          </label>
          <label><span>Network</span><select name="settlementRail">{railOptions}</select></label>
          <button type="submit" className="primary-action full-width">Fund wallet</button>
        </form>
      </Modal>

      <Modal id="modalSend" open={modal === "send"} onClose={() => setModal(null)} title="Send USDC">
        <form onSubmit={handleSend} className="modal-form" style={{ padding: 0 }}>
          <label><span>Recipient</span><input name="recipientHandle" defaultValue="@alice" autoComplete="off" /></label>
          <label><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" defaultValue="10" /></label>
          <label><span>Network</span><select name="settlementRail">{railOptions}</select></label>
          <label><span>Memo</span><input name="memo" placeholder="Optional note" autoComplete="off" /></label>
          <button type="submit" className="primary-action full-width">Send USDC</button>
        </form>
      </Modal>

      <Modal id="modalReceive" open={modal === "receive"} onClose={() => setModal(null)} title="Receive">
        <div className="receive-field"><span>X handle</span><strong>{wallet?.handle || currentHandle || "Connect X"}</strong></div>
        <div className="receive-field"><span>Address</span><code>{address}</code></div>
        <div className="receive-field"><span>Network</span><strong>{currentRail?.label || selectedRail}</strong></div>
        <button type="button" className="primary-action full-width" onClick={handleCopyAddress}>Copy address</button>
      </Modal>

      <Modal id="modalBridge" open={modal === "bridge"} onClose={() => setModal(null)} title="Bridge token">
        <form onSubmit={handleBridge} className="modal-form" style={{ padding: 0 }}>
          <label><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" defaultValue="1" /></label>
          <label><span>Token</span><input name="fromToken" type="text" defaultValue="USDC" placeholder="USDC, EURC, cirBTC, WETH, or 0x..." /></label>
          <label><span>From</span><select name="fromRail">{railOptions}</select></label>
          <label><span>To</span><select name="toRail" defaultValue={rails.length > 1 ? rails.find((r) => r.id !== selectedRail)?.id : selectedRail}>{railOptions}</select></label>
          <button type="submit" className="primary-action full-width">Get bridge quote</button>
        </form>
      </Modal>

      <Modal id="modalSwap" open={modal === "swap"} onClose={() => setModal(null)} title="Swap tokens">
        <form onSubmit={handleSwap} className="modal-form" style={{ padding: 0 }}>
          <label><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" defaultValue="1" /></label>
          <label><span>Pay token</span><input name="fromToken" type="text" defaultValue="USDC" placeholder="USDC, EURC, cirBTC, WETH, or 0x..." /></label>
          <label><span>Receive token</span><input name="toToken" type="text" defaultValue="EURC" placeholder="USDC, EURC, cirBTC, WETH, or 0x..." /></label>
          <label><span>Max slippage</span><input name="slippage" type="number" min="0" max="0.05" step="0.001" defaultValue="0.005" /></label>
          <label><span>Network</span><select name="fromRail">{railOptions}</select></label>
          <button type="submit" className="primary-action full-width">Get swap quote</button>
        </form>
      </Modal>

      <Modal id="modalAirdrop" open={modal === "airdrop"} onClose={() => setModal(null)} title="Create distribution">
        <form onSubmit={handleAirdrop} className="modal-form" style={{ padding: 0 }}>
          <label><span>Amount each</span><input name="amountPerRecipient" type="number" min="0.01" step="0.01" defaultValue="1" /></label>
          <label><span>Recipients</span><input name="recipients" type="text" placeholder="@alice @bob, or leave blank for social rewards" autoComplete="off" /></label>
          <label><span>Max recipients</span><input name="maxRecipients" type="number" min="1" step="1" defaultValue="10" /></label>
          <label><span>X post id</span><input name="postId" type="text" placeholder="Optional for reply-based rewards" autoComplete="off" /></label>
          <label><span>Network</span><select name="settlementRail">{railOptions}</select></label>
          <label><span>Memo</span><input name="memo" type="text" placeholder="Optional note" autoComplete="off" /></label>
          <button type="submit" className="primary-action full-width">Create distribution</button>
        </form>
      </Modal>

      <Modal id="modalMandate" open={modal === "mandate"} onClose={() => setModal(null)} title="Add agent rule">
        <form onSubmit={handleCreateMandate} className="modal-form" style={{ padding: 0 }}>
          <label>
            <span>Standing instruction</span>
            <input name="text" type="text" placeholder="Example: never bridge if fee is over 3%" autoComplete="off" />
          </label>
          <button type="submit" className="primary-action full-width">Save rule</button>
        </form>
      </Modal>
    </>
  );
}

/* ─── Helpers ────────────────────────── */

function AgentCockpit({
  wallet,
  hasWallet,
  portfolio,
  market,
  agentHealth,
  activeMandates,
  pendingExecutions,
  timeline,
  riskWarnings,
  cockpitLoading,
  cockpitError,
  onAddMandate,
  onDeleteMandate,
  onRefresh,
}) {
  const snapshot = portfolio?.portfolio;
  const recommendation = portfolio?.recommendation;
  const exposure = snapshot?.exposure || {};
  const regime = market?.regime || {};
  const healthStatus = agentHealth?.status || (agentHealth?.unavailable ? "private" : "unknown");

  if (!hasWallet) {
    return (
      <div className="agent-cockpit">
        <div className="cockpit-hero">
          <div>
            <span className="panel-kicker">Agent cockpit</span>
            <h2>Connect X before the agent can judge trades.</h2>
            <p>The cockpit uses your wallet, market feeds, execution receipts, and standing rules. Without a wallet, there is no real portfolio state to analyze.</p>
          </div>
          <div className="cockpit-status-tile">
            <span>Signer policy</span>
            <strong>User wallet only</strong>
            <small>No backend signer can spend user funds.</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-cockpit">
      <div className="cockpit-hero">
        <div>
          <span className="panel-kicker">Agent cockpit</span>
          <h2>{recommendation?.reason || "The agent is reading wallet, risk, routes, and receipts."}</h2>
          <p>{snapshot?.risk?.level ? `Current risk is ${snapshot.risk.level}. ${pendingExecutions.length} action(s) need follow-through.` : "Refresh to load portfolio intelligence and agent health."}</p>
        </div>
        <div className={`cockpit-status-tile status-${String(healthStatus).toLowerCase()}`}>
          <span>Agent health</span>
          <strong>{statusLabel(healthStatus)}</strong>
          <small>{agentHealth?.summaries?.[1] || agentHealth?.reason || "Private health data loads after sign-in."}</small>
        </div>
      </div>

      {cockpitError && <div className="cockpit-warning">{cockpitError}</div>}
      {cockpitLoading && <div className="cockpit-loading">Refreshing agent state...</div>}

      <div className="cockpit-grid">
        <section className="cockpit-panel portfolio-panel">
          <PanelHeader kicker="Portfolio intelligence" title={money(snapshot?.totalValueUsd || wallet?.balance || 0)} actionLabel="Refresh" onAction={onRefresh} />
          <div className="exposure-bars" aria-label="Portfolio exposure">
            <ExposureBar label="Stable" value={exposure.stableWeight} amount={exposure.stableUsd} />
            <ExposureBar label="Volatile" value={exposure.volatileWeight} amount={exposure.volatileUsd} />
            <ExposureBar label="Other" value={exposure.otherWeight} amount={exposure.otherUsd} />
          </div>
          <div className="asset-chip-row">
            {Object.values(snapshot?.assetsByToken || {}).slice(0, 5).map((asset) => (
              <span className="asset-chip" key={asset.symbol}>
                {asset.symbol}<strong>{Math.round((asset.weight || 0) * 100)}%</strong>
              </span>
            ))}
            {!Object.keys(snapshot?.assetsByToken || {}).length && <span className="muted-copy">No funded assets found yet.</span>}
          </div>
          <div className="agent-note">
            <span>Next action</span>
            <strong>{humanizeAction(recommendation?.nextAction || "monitor_portfolio")}</strong>
          </div>
        </section>

        <section className="cockpit-panel">
          <PanelHeader kicker="Market regime" title={humanizeAction(regime.status || market?.freshness?.status || "unavailable")} />
          <p className="panel-copy">{regime.reason || market?.freshness?.reason || "Market feed has not returned a regime yet."}</p>
          <div className="market-token-grid">
            {Object.values(market?.prices || {}).slice(0, 5).map((price) => (
              <div className="market-token" key={price.symbol}>
                <span>{price.symbol}</span>
                <strong>{price.priceUsd === null ? "n/a" : money(price.priceUsd)}</strong>
                <small>{price.freshness || price.source}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="cockpit-panel wide-panel">
          <PanelHeader kicker="Execution monitor" title={`${pendingExecutions.length} active`} />
          <div className="execution-list">
            {pendingExecutions.length ? pendingExecutions.slice(0, 6).map((item) => (
              <div className="execution-row" key={`${item.kind}-${item.id}`}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.kind} · {item.id}</span>
                </div>
                <code>{statusLabel(item.status)}</code>
              </div>
            )) : (
              <div className="empty-state compact-empty"><strong>No active executions</strong><span>New swaps, bridges, sends, and agent approvals will appear here.</span></div>
            )}
          </div>
        </section>

        <section className="cockpit-panel">
          <PanelHeader kicker="Risk warnings" title={riskWarnings.length ? `${riskWarnings.length} item(s)` : "Clear"} />
          <div className="risk-list">
            {riskWarnings.length ? riskWarnings.slice(0, 5).map((warning) => (
              <div className="risk-row" key={warning}>{warning}</div>
            )) : (
              <div className="empty-state compact-empty"><strong>No urgent warnings</strong><span>The agent will still check policy before every action.</span></div>
            )}
          </div>
        </section>

        <section className="cockpit-panel">
          <PanelHeader kicker="Strategy rules" title={`${activeMandates.length} active`} actionLabel="Add rule" onAction={onAddMandate} />
          <div className="mandate-list">
            {activeMandates.length ? activeMandates.slice(0, 5).map((mandate) => (
              <div className="mandate-row" key={mandate.id}>
                <div>
                  <strong>{humanizeAction(mandate.kind)}</strong>
                  <span>{mandate.sourceText}</span>
                </div>
                <button type="button" className="mini-danger" onClick={() => onDeleteMandate(mandate.id)}>Remove</button>
              </div>
            )) : (
              <div className="empty-state compact-empty"><strong>No standing rules</strong><span>Add limits like max trade size, fee caps, or allowed assets.</span></div>
            )}
          </div>
        </section>

        <section className="cockpit-panel wide-panel">
          <PanelHeader kicker="Receipts and reasoning" title="Timeline" />
          <div className="timeline-list">
            {timeline.length ? timeline.slice(0, 10).map((item) => (
              <div className="timeline-row" key={`${item.kind}-${item.id}`}>
                <div className="timeline-dot" />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.subtitle}</span>
                </div>
                {item.href ? <a className="inline-action link-action" href={item.href} target="_blank" rel="noreferrer">Receipt</a> : <code>{statusLabel(item.status)}</code>}
              </div>
            )) : (
              <div className="empty-state compact-empty"><strong>No agent timeline yet</strong><span>Terminal, MCP, X, and wallet actions will write receipts here.</span></div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function PanelHeader({ kicker, title, actionLabel, onAction }) {
  return (
    <div className="panel-header">
      <div>
        <span className="panel-kicker">{kicker}</span>
        <h3>{title}</h3>
      </div>
      {actionLabel && <button type="button" className="inline-action" onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}

function ExposureBar({ label, value = 0, amount = 0 }) {
  const pct = Math.max(0, Math.min(100, Number(value || 0) * 100));
  return (
    <div className="exposure-row">
      <div className="exposure-label"><span>{label}</span><strong>{money(amount)}</strong></div>
      <div className="exposure-track"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function tokensForRail(wallet, railId) {
  const tokens = wallet?.tokenBalances?.[railId];
  if (Array.isArray(tokens) && tokens.length) return tokens;
  return [{ symbol: "USDC", amount: Number(wallet?.balances?.[railId] || 0), valueUsd: Number(wallet?.balances?.[railId] || 0) }];
}

function railTokenTotal(wallet, railId) {
  return tokensForRail(wallet, railId).reduce((sum, t) => sum + Number(t.valueUsd ?? t.amount ?? 0), 0);
}

function actionLabel(action) {
  const labels = { bridge: "Bridge quote", swap: "Swap quote", polymarket_search: "Market search", hyperliquid_markets: "Perp discovery" };
  return labels[action.type] || action.type;
}

function buildPendingExecutions({ portfolio, defiActions, payments, approvals, automations }) {
  const pendingStatuses = new Set(["queued", "confirmed", "submitted", "pending", "requires_confirmation", "quoted", "execution_not_enabled", "running", "active"]);
  const fromPortfolio = (portfolio?.portfolio?.pending?.items || []).map((item) => ({
    kind: item.kind,
    id: item.id,
    status: item.status,
    label: item.label || humanizeAction(item.kind),
  }));
  const fromDefi = (defiActions || [])
    .filter((item) => pendingStatuses.has(String(item.status || "").toLowerCase()))
    .map((item) => ({
      kind: "defi",
      id: item.id,
      status: item.status,
      label: `${humanizeAction(item.type)} ${item.request?.fromToken || "asset"}${item.request?.toToken ? ` to ${item.request.toToken}` : ""}`,
    }));
  const fromPayments = (payments || [])
    .filter((item) => pendingStatuses.has(String(item.status || "").toLowerCase()))
    .map((item) => ({
      kind: "payment",
      id: item.id,
      status: item.status,
      label: `${formatTokenAmount(item.amount)} ${item.asset || "USDC"} to ${item.recipientHandle || "recipient"}`,
    }));
  const fromApprovals = (approvals || [])
    .filter((item) => item.status === "pending")
    .map((item) => ({
      kind: "approval",
      id: item.id,
      status: item.status,
      label: item.title || humanizeAction(item.kind),
    }));
  const fromAutomations = (automations || [])
    .filter((item) => item.status === "active")
    .slice(0, 3)
    .map((item) => ({
      kind: "automation",
      id: item.id,
      status: item.status,
      label: item.name || humanizeAction(item.kind),
    }));

  const seen = new Set();
  return [...fromPortfolio, ...fromDefi, ...fromPayments, ...fromApprovals, ...fromAutomations]
    .filter((item) => {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function buildTimeline({ agentEvents, defiActions, payments, airdrops, mandates, automations, currentHandle }) {
  const rows = [
    ...(agentEvents || []).map((event) => ({
      id: event.id,
      kind: "agent",
      at: event.at,
      status: event.status,
      title: `${event.ok ? "Agent decided" : "Agent refused"} ${humanizeAction(event.tool)}`,
      subtitle: event.reason || event.decision?.nextAction || "Decision recorded",
    })),
    ...(defiActions || []).map((action) => ({
      id: action.id,
      kind: "defi",
      at: action.updatedAt || action.completedAt || action.createdAt,
      status: action.status,
      title: `${humanizeAction(action.type)} ${statusLabel(action.status)}`,
      subtitle: `${formatTokenAmount(action.request?.amount || action.request?.amountUsd || 0)} ${action.request?.fromToken || "USDC"}${action.request?.toToken ? ` to ${action.request.toToken}` : ""}`,
      href: `/defi/actions/${action.id}`,
    })),
    ...(payments || [])
      .filter((payment) => !currentHandle || payment.senderHandle === currentHandle || payment.recipientHandle === currentHandle)
      .map((payment) => ({
        id: payment.id,
        kind: "payment",
        at: payment.updatedAt || payment.createdAt,
        status: payment.status,
        title: payment.senderHandle === currentHandle ? "Payment sent" : "Payment received",
        subtitle: `${formatTokenAmount(payment.amount)} ${payment.asset || "USDC"} ${payment.senderHandle === currentHandle ? `to ${payment.recipientHandle}` : `from ${payment.senderHandle}`}`,
      })),
    ...(airdrops || []).map((airdrop) => ({
      id: airdrop.id,
      kind: "distribution",
      at: airdrop.updatedAt || airdrop.createdAt,
      status: airdrop.status,
      title: `Distribution ${statusLabel(airdrop.status)}`,
      subtitle: `${formatTokenAmount(airdrop.amountPerRecipient)} ${airdrop.asset || "USDC"} each`,
      href: `/airdrops/${airdrop.id}`,
    })),
    ...(mandates || []).map((mandate) => ({
      id: mandate.id,
      kind: "mandate",
      at: mandate.updatedAt || mandate.createdAt,
      status: mandate.status,
      title: `Rule ${statusLabel(mandate.status)}`,
      subtitle: mandate.sourceText || humanizeAction(mandate.kind),
    })),
    ...(automations || []).map((automation) => ({
      id: automation.id,
      kind: "automation",
      at: automation.updatedAt || automation.createdAt,
      status: automation.status,
      title: `Automation ${statusLabel(automation.status)}`,
      subtitle: automation.name || automation.text || humanizeAction(automation.kind),
    })),
  ];

  return rows
    .filter((row) => row.id)
    .sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());
}

function buildRiskWarnings({ portfolio, market, agentHealth }) {
  return Array.from(new Set([
    ...(portfolio?.portfolio?.risk?.warnings || []),
    ...(market?.warnings || []),
    ...((agentHealth?.alerts || []).map((alert) => alert.message)),
  ].filter(Boolean)));
}

function humanizeAction(value) {
  return String(value || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
