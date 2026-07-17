import { useEffect, useMemo, useState } from "react";
import { fetchJson, post } from "../api";
import "./Launchpad.css";

const DEFAULT_GRANTS = ["deploy_token", "seed_liquidity", "open_trading"];

const DEMO_LAUNCHES = [
  {
    id: "launch_demo_01",
    status: "live",
    creatorHandle: "@bankr",
    token: { name: "Bankr Agent Token", symbol: "BANKR", totalSupply: 1000000 },
    chain: { name: "Arc Testnet" },
    liquidity: {
      seedUsd: 12500,
      lockDays: 180,
      poolAddress: "0x7bA000000000000000000000000000000000B001"
    },
    market: { pair: "BANKR/USDC" },
    fees: {
      totalVolumeUsd: 187500,
      claimableUsd: 420,
      computeCreditsUsd: 1280,
      runwayDays: 34.2
    },
    receipts: [
      { id: "demo_1", type: "open_trading", status: "live", at: new Date().toISOString() },
      { id: "demo_2", type: "liquidity_seeded", status: "liquidity_seeded", at: new Date().toISOString() }
    ]
  },
  {
    id: "launch_demo_02",
    status: "liquidity_seeded",
    creatorHandle: "@arcforge",
    token: { name: "Forge Market", symbol: "FORGE", totalSupply: 5000000 },
    chain: { name: "Arc Testnet" },
    liquidity: {
      seedUsd: 8400,
      lockDays: 120,
      poolAddress: "0x7bA000000000000000000000000000000000F002"
    },
    market: { pair: "FORGE/USDC" },
    fees: {
      totalVolumeUsd: 48200,
      claimableUsd: 92,
      computeCreditsUsd: 300,
      runwayDays: 8.6
    },
    receipts: [
      { id: "demo_3", type: "liquidity_seeded", status: "liquidity_seeded", at: new Date().toISOString() }
    ]
  },
  {
    id: "launch_demo_03",
    status: "draft",
    creatorHandle: "@sara",
    token: { name: "Arc Creator Token", symbol: "ARCC", totalSupply: 1000000 },
    chain: { name: "Arc Testnet" },
    liquidity: { seedUsd: 25, lockDays: 90 },
    market: { pair: "ARCC/USDC" },
    fees: {
      totalVolumeUsd: 0,
      claimableUsd: 0,
      computeCreditsUsd: 0,
      runwayDays: 0
    },
    receipts: []
  }
];

const STAGE_LABELS = [
  ["draft", "Draft"],
  ["token_deployed", "Token"],
  ["liquidity_seeded", "Liquidity"],
  ["live", "Live"]
];

const PUBLIC_ACTIVITY_TYPES = new Set([
  "token_deployed",
  "liquidity_seeded",
  "trading_opened"
]);

export default function Launchpad() {
  const [architecture, setArchitecture] = useState(null);
  const [launches, setLaunches] = useState([]);
  const [feedLaunches, setFeedLaunches] = useState([]);
  const [selectedLaunchId, setSelectedLaunchId] = useState("");
  const [plan, setPlan] = useState(null);
  const [form, setForm] = useState({
    creatorHandle: "@sara",
    name: "Arc Creator Token",
    symbol: "ARCC",
    totalSupply: 1000000,
    liquiditySeedUsd: 25,
    liquidityLockDays: 90,
    maxSlippage: 0.01
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchJson("/api/launchpad/architecture")
      .then((data) => setArchitecture(data.architecture))
      .catch((err) => setError(err.message));
    refreshLaunches();
  }, []);

  const visibleLaunches = launches.length ? launches : DEMO_LAUNCHES;
  const marketLaunches = feedLaunches.length ? mergeLaunches(feedLaunches, visibleLaunches) : visibleLaunches;

  const selectedLaunch = useMemo(() => {
    if (!visibleLaunches.length) return null;
    return visibleLaunches.find((launch) => launch.id === selectedLaunchId) || visibleLaunches[0];
  }, [visibleLaunches, selectedLaunchId]);

  const featuredLaunch = useMemo(() => (
    marketLaunches.find((launch) => launch.status === "live") || marketLaunches[0] || selectedLaunch
  ), [marketLaunches, selectedLaunch]);

  const launchStats = useMemo(() => {
    const totalLiquidity = visibleLaunches.reduce((sum, launch) => sum + Number(launch.liquidity?.seedUsd || 0), 0);
    const totalVolume = visibleLaunches.reduce((sum, launch) => sum + Number(launch.fees?.totalVolumeUsd || 0), 0);
    const liveCount = visibleLaunches.filter((launch) => launch.status === "live").length;
    const totalRunway = visibleLaunches.reduce((sum, launch) => sum + Number(launch.fees?.runwayDays || 0), 0);
    return [
      ["Live", liveCount],
      ["Liquidity", formatUsd(totalLiquidity)],
      ["Volume", formatUsd(totalVolume)],
      ["Runway", `${formatCompact(totalRunway)} days`]
    ];
  }, [visibleLaunches]);

  const previewLaunch = useMemo(() => (
    plan ? planToLaunch(plan, form.creatorHandle) : formToLaunchPreview(form, architecture)
  ), [plan, form, architecture]);

  const recentEvents = useMemo(() => {
    const events = visibleLaunches.flatMap((launch) => (
      (launch.receipts || [])
        .filter((item) => PUBLIC_ACTIVITY_TYPES.has(item.type))
        .map((item) => ({
          ...item,
          launchId: launch.id,
          symbol: launch.token?.symbol || "TOKEN"
        }))
    ));
    return events
      .sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())
      .slice(0, 5);
  }, [visibleLaunches]);

  const update = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  async function refreshLaunches(nextSelectedId) {
    try {
      const [launchData, feedData] = await Promise.all([
        fetchJson("/api/launchpad/launches?limit=24"),
        fetchJson("/api/launchpad/feed?status=live&limit=12")
      ]);
      const nextLaunches = launchData.launches || [];
      setLaunches(nextLaunches);
      setFeedLaunches(feedData.launches || []);
      if (nextSelectedId) setSelectedLaunchId(nextSelectedId);
      else if (!selectedLaunchId && nextLaunches[0]) setSelectedLaunchId(nextLaunches[0].id);
      return nextLaunches;
    } catch (err) {
      setError(err.message);
      return [];
    }
  }

  async function runAction(name, action) {
    setBusy(name);
    setError("");
    try {
      return await action();
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy("");
    }
  }

  const submitPlan = async (event) => {
    event.preventDefault();
    const result = await runAction("plan", () => post("/api/launchpad/plan", form));
    if (result) setPlan(result);
  };

  const createLaunch = async () => {
    const result = await runAction("create", () => post("/api/launchpad/launches", {
      ...form,
      grants: DEFAULT_GRANTS,
      idempotencyKey: `ui-launch-${form.symbol}-${Date.now()}`
    }));
    if (!result?.launch) return;
    setPlan(null);
    await refreshLaunches(result.launch.id);
  };

  return (
    <main className="launchpad-page">
      <section className="launchpad-hero">
        <div className="launchpad-hero-copy">
          <span className="launchpad-kicker">Arc Launchpad</span>
          <h1>Launch agent tokens with live markets.</h1>
          <p>
            Token pages, locked USDC liquidity, market stats, and agent treasury runway in one launch surface.
          </p>
          <div className="launchpad-hero-actions">
            <a className="primary-action" href="#create-launch">Create Launch</a>
            <a className="secondary-action" href="#live-launches">View Launches</a>
          </div>
        </div>
        <FeaturedLaunch launch={featuredLaunch} />
      </section>

      <section className="launchpad-stats" aria-label="Launchpad market summary">
        {launchStats.map(([label, value]) => (
          <div className="launchpad-stat" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section className="launchpad-main-grid">
        <div className="launchpad-panel" id="create-launch">
          <SectionTitle index="01" title="Create Launch" />
          <form className="launchpad-form" onSubmit={submitPlan}>
            <label>
              Creator
              <input value={form.creatorHandle} onChange={update("creatorHandle")} />
            </label>
            <label>
              Token name
              <input value={form.name} onChange={update("name")} />
            </label>
            <label>
              Symbol
              <input value={form.symbol} onChange={update("symbol")} />
            </label>
            <label>
              Supply
              <input type="number" min="1" value={form.totalSupply} onChange={update("totalSupply")} />
            </label>
            <label>
              USDC seed
              <input type="number" min="25" value={form.liquiditySeedUsd} onChange={update("liquiditySeedUsd")} />
            </label>
            <label>
              Lock days
              <input type="number" min="1" value={form.liquidityLockDays} onChange={update("liquidityLockDays")} />
            </label>
            <div className="launchpad-form-actions">
              <button type="submit" className="secondary-action" disabled={Boolean(busy)}>
                {busy === "plan" ? "Previewing..." : "Preview"}
              </button>
              <button type="button" className="primary-action" onClick={createLaunch} disabled={Boolean(busy)}>
                {busy === "create" ? "Creating..." : "Create"}
              </button>
            </div>
            {error && <div className="launchpad-error">{error}</div>}
          </form>
        </div>

        <div className="launchpad-panel">
          <SectionTitle index="02" title="Launch Preview" />
          <PreviewCard launch={previewLaunch} />
        </div>
      </section>

      <section className="launchpad-market-section" id="live-launches">
        <div className="launchpad-market-head">
          <SectionTitle index="03" title="Live Launches" />
          <div className="launchpad-tabs" aria-label="Launch filters">
            <span className="is-active">All</span>
            <span>Live</span>
            <span>New</span>
          </div>
        </div>
        <div className="launchpad-market-grid">
          {marketLaunches.map((launch) => (
            <LaunchCard
              key={launch.id}
              launch={launch}
              selected={selectedLaunch?.id === launch.id}
              onSelect={() => setSelectedLaunchId(launch.id)}
            />
          ))}
        </div>
      </section>

      {selectedLaunch && (
        <section className="launchpad-detail-grid">
          <div className="launchpad-panel launchpad-token-page">
            <SectionTitle index="04" title="Token Page" />
            <TokenPage launch={selectedLaunch} />
          </div>
          <div className="launchpad-panel">
            <SectionTitle index="05" title="Market Activity" />
            <ActivityList events={recentEvents} />
          </div>
        </section>
      )}
    </main>
  );
}

function FeaturedLaunch({ launch }) {
  if (!launch) return null;
  return (
    <article className="launchpad-featured">
      <div className="launchpad-featured-top">
        <TokenMark symbol={launch.token?.symbol} />
        <div>
          <span className="launchpad-card-label">Featured</span>
          <strong>{launch.token?.name}</strong>
          <small>{launch.creatorHandle}</small>
        </div>
        <StatusBadge status={launch.status} />
      </div>
      <div className="launchpad-featured-symbol">{launch.token?.symbol}</div>
      <div className="launchpad-featured-metrics">
        <Metric label="Pair" value={launch.market?.pair || `${launch.token?.symbol}/USDC`} />
        <Metric label="Liquidity" value={formatUsd(launch.liquidity?.seedUsd)} />
        <Metric label="Volume" value={formatUsd(launch.fees?.totalVolumeUsd)} />
        <Metric label="Runway" value={`${formatCompact(launch.fees?.runwayDays)} days`} />
      </div>
    </article>
  );
}

function PreviewCard({ launch }) {
  return (
    <article className="launchpad-preview-card">
      <div className="launchpad-preview-visual">
        <TokenMark symbol={launch.token?.symbol} large />
        <div>
          <strong>{launch.token?.symbol}</strong>
          <span>{launch.market?.pair}</span>
        </div>
      </div>
      <h3>{launch.token?.name}</h3>
      <div className="launchpad-preview-metrics">
        <Metric label="Supply" value={formatCompact(launch.token?.totalSupply)} />
        <Metric label="Seed" value={formatUsd(launch.liquidity?.seedUsd)} />
        <Metric label="Lock" value={`${launch.liquidity?.lockDays || 0} days`} />
      </div>
      <LaunchProgress status={launch.status} />
    </article>
  );
}

function LaunchCard({ launch, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`launchpad-card ${selected ? "is-selected" : ""}`}
      onClick={onSelect}
    >
      <div className="launchpad-card-top">
        <TokenMark symbol={launch.token?.symbol} />
        <div>
          <strong>{launch.token?.symbol}</strong>
          <span>{launch.token?.name}</span>
        </div>
        <StatusBadge status={launch.status} />
      </div>
      <div className="launchpad-card-chart" aria-hidden="true">
        {chartBars(launch).map((height, index) => (
          <i key={`${launch.id}-${index}`} style={{ height: `${height}%` }} />
        ))}
      </div>
      <div className="launchpad-card-metrics">
        <Metric label="Liquidity" value={formatUsd(launch.liquidity?.seedUsd)} />
        <Metric label="Volume" value={formatUsd(launch.fees?.totalVolumeUsd)} />
        <Metric label="Runway" value={`${formatCompact(launch.fees?.runwayDays)}d`} />
      </div>
    </button>
  );
}

function TokenPage({ launch }) {
  return (
    <div className="launchpad-token-layout">
      <div className="launchpad-token-hero">
        <TokenMark symbol={launch.token?.symbol} large />
        <div>
          <StatusBadge status={launch.status} />
          <h2>{launch.token?.name}</h2>
          <p>{launch.market?.pair || `${launch.token?.symbol}/USDC`} on {launch.chain?.name || "Arc"}</p>
        </div>
      </div>
      <div className="launchpad-token-metrics">
        <Metric label="Supply" value={formatCompact(launch.token?.totalSupply)} />
        <Metric label="USDC liquidity" value={formatUsd(launch.liquidity?.seedUsd)} />
        <Metric label="Lock" value={`${launch.liquidity?.lockDays || 0} days`} />
        <Metric label="Claimable fees" value={formatUsd(launch.fees?.claimableUsd)} />
      </div>
      <LaunchProgress status={launch.status} />
      <div className="launchpad-trade-panel">
        <div>
          <span>Market</span>
          <strong>{launch.market?.pair || `${launch.token?.symbol}/USDC`}</strong>
        </div>
        <div className="launchpad-trade-actions">
          <button type="button" className="primary-action">Buy</button>
          <button type="button" className="secondary-action">Sell</button>
        </div>
      </div>
    </div>
  );
}

function ActivityList({ events }) {
  if (!events.length) {
    return (
      <div className="launchpad-activity-empty">
        <strong>Fresh launch</strong>
        <span>Market activity appears as the token moves through launch stages.</span>
      </div>
    );
  }
  return (
    <div className="launchpad-activity-list">
      {events.map((event) => (
        <div className="launchpad-activity" key={`${event.launchId}-${event.id}`}>
          <TokenMark symbol={event.symbol} small />
          <div>
            <strong>{formatEvent(event.type)}</strong>
            <span>{event.symbol} · {event.launchId}</span>
          </div>
          <time>{formatTime(event.at)}</time>
        </div>
      ))}
    </div>
  );
}

function LaunchProgress({ status }) {
  const currentIndex = statusIndex(status);
  return (
    <div className="launchpad-progress">
      {STAGE_LABELS.map(([stage, label], index) => (
        <div
          className={`launchpad-progress-step ${index <= currentIndex ? "is-complete" : ""}`}
          key={stage}
        >
          <i />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="launchpad-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SectionTitle({ index, title }) {
  return (
    <div className="launchpad-section-head">
      <span>{index}</span>
      <h2>{title}</h2>
    </div>
  );
}

function StatusBadge({ status }) {
  return <span className={`launchpad-status ${String(status || "").replaceAll("_", "-")}`}>{formatStatus(status)}</span>;
}

function TokenMark({ symbol = "ARC", large = false, small = false }) {
  return (
    <div className={`launchpad-token-mark ${large ? "is-large" : ""} ${small ? "is-small" : ""}`}>
      {String(symbol || "ARC").slice(0, 2).toUpperCase()}
    </div>
  );
}

function mergeLaunches(feed, launches) {
  const byId = new Map(launches.map((launch) => [launch.id, launch]));
  for (const launch of feed) byId.set(launch.id, launch);
  return Array.from(byId.values());
}

function formToLaunchPreview(form, architecture) {
  return {
    id: "preview",
    status: "draft",
    creatorHandle: form.creatorHandle,
    token: {
      name: form.name,
      symbol: String(form.symbol || "TOKEN").toUpperCase(),
      totalSupply: Number(form.totalSupply || 0)
    },
    chain: { name: architecture?.chain?.name || "Arc Testnet" },
    liquidity: {
      seedUsd: Number(form.liquiditySeedUsd || 0),
      lockDays: Number(form.liquidityLockDays || 0)
    },
    market: { pair: `${String(form.symbol || "TOKEN").toUpperCase()}/USDC` },
    fees: { totalVolumeUsd: 0, claimableUsd: 0, computeCreditsUsd: 0, runwayDays: 0 },
    receipts: []
  };
}

function planToLaunch(plan, creatorHandle) {
  return {
    id: "preview",
    status: "draft",
    creatorHandle,
    token: plan.token,
    chain: plan.chain,
    liquidity: plan.liquidity,
    market: { pair: `${plan.token?.symbol || "TOKEN"}/USDC` },
    fees: { totalVolumeUsd: 0, claimableUsd: 0, computeCreditsUsd: 0, runwayDays: 0 },
    receipts: []
  };
}

function statusIndex(status) {
  const normalized = String(status || "draft");
  if (normalized === "live") return 3;
  if (normalized === "liquidity_seeded") return 2;
  if (normalized === "token_deployed") return 1;
  return 0;
}

function chartBars(launch) {
  const seed = String(launch.id || launch.token?.symbol || "launch")
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Array.from({ length: 18 }, (_, index) => 28 + ((seed + index * 17) % 58));
}

function formatStatus(status) {
  return String(status || "draft").replaceAll("_", " ");
}

function formatEvent(type) {
  return {
    token_deployed: "Token deployed",
    liquidity_seeded: "Liquidity locked",
    trading_opened: "Trading opened"
  }[type] || String(type || "Launch event").replaceAll("_", " ");
}

function formatTime(value) {
  if (!value) return "Now";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatUsd(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatCompact(value) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(Number(value || 0));
}
