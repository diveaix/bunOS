import { useCallback, useEffect, useState } from "react";
import { useSession } from "../hooks/useSession";
import { useToast } from "../hooks/useToast";
import { fetchJson, post, money, formatNumber, formatTokenAmount, compactAddress, shortRail, normalizeToken, statusLabel, formatDate } from "../api";
import Modal from "../components/Modal";
import "./Wallet.css";

export default function Wallet() {
  const { session, config, currentHandle, wallets, refresh, upsertWallet, login } = useSession();
  const notify = useToast();
  const [selectedRail, setSelectedRail] = useState(() => localStorage.getItem("bunos:rail") || "arc-testnet");
  const [activeView, setActiveView] = useState("assets");
  const [payments, setPayments] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [defiActions, setDefiActions] = useState([]);
  const [airdrops, setAirdrops] = useState([]);
  const [primitives, setPrimitives] = useState([]);
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

  useEffect(() => { loadActivity(); }, [loadActivity]);

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
    notify("Wallet refreshed");
  };

  const handleLogin = async () => {
    await login(currentHandle || "@demo");
    notify("X connected and Circle wallets created");
    await loadActivity();
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
  };

  /* ─── Derived data ─────────────────── */
  const chainWallet = wallet?.wallets?.find((w) => w.rail === selectedRail);
  const address = chainWallet?.address || wallet?.walletAddress || "Connect X";
  const totalBalance = Number(wallet?.balance ?? railTokenTotal(wallet, selectedRail));
  const currentRail = rails.find((r) => r.id === selectedRail);

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
            <button className={`view-tab${activeView === "assets" ? " active" : ""}`} onClick={() => setActiveView("assets")}>Assets</button>
            <button className={`view-tab${activeView === "activity" ? " active" : ""}`} onClick={() => setActiveView("activity")}>Activity</button>
            <button className={`view-tab${activeView === "primitives" ? " active" : ""}`} onClick={() => setActiveView("primitives")}>Primitives</button>
            <div style={{ flex: 1 }} />
            <button type="button" className="ghost-button" onClick={handleRefresh} style={{ marginLeft: "auto" }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></svg>
              Refresh
            </button>
          </div>

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
    </>
  );
}

/* ─── Helpers ────────────────────────── */

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
