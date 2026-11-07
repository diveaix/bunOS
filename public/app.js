/* ============================================================
   bunOS Launchpad Page — Standalone page at /launchpad
   Inspired by bankr.bot's premium dark UI.
   Does NOT interfere with any other pages/routes.
   ============================================================ */

// ── SVG Icons ────────────────────────────────────────────────
const icons = {
  logo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>.a{fill:#FB3315}</style><path class="a" d="m52.5 37.4-11.9-27.5c-0.2-0.5-0.7-1-1.3-1.3l-21.7-7.4c-2.4-0.8-4.6 1.2-4 3.4l13.1 28.9c0.3 0.7 0.8 1.3 1.6 1.7l12.1 4.4c0.1 0.1 0.4 0.1 0.5 0 2.2-0.8 5.9-2.2 11.6-2.1v-0.1z"/><path class="a" d="m62.1 7.4v32.8c0 0.7 0.4 1.5 0.9 2l16.1 15.7c1.6 1.5 5 1 5-1.9v-32.4c0-0.7-0.4-1.5-0.8-1.9l-16.5-16.2c-1.5-1.5-4.7-0.6-4.7 1.9z"/><path class="a" d="m86.2 58.9c0-0.4-0.2-1.5-0.1-1.2v-1.1h-0.1c-0.4 1.8-1.7 3.9-5 3.9-1 0-2.1-0.4-3.1-1.2l-16.4-15.7c-0.6-0.6-1.2-1.4-1.5-2.4-2.4-0.8-5.2-1.6-9-1.6-3.3 0-7.3 0.7-11.2 2.6l-20.6 11.6c-1.7 1.1-3 2.9-3 5.5v5.7c2.8 1.5 5.5 5.5 5.7 10.1 0 0.3-0.2 0.6-0.4 0.5l-1.8-1c-0.5-2.2-2-5.2-3.5-6.7v12.1c0.2 2 1.1 3.9 3 5.1l19.2 10.6c3.3 1.9 7.5 3.4 13 3.5 4.4 0 8.8-0.8 12.8-2.8l19.4-11c1.8-1 3.1-3 3.1-5.8v-20.7zm-51.7 26.9-4.4-2.4-0.5 0.2v4l-0.2 0.2-2-1.1v-3.8c0-0.8-0.5-1.5-1.2-1.9l-3.5-1.9-0.1-0.2v-1.5l0.3-0.2 4.1 2.2 0.4-0.2v-3.6l0.3-0.2 1.9 1v3.8c0 0.5 0.3 0.9 0.8 1.2l4 2.2 0.1 0.2v1.8 0.2zm22.1-1-2 1.2c-4.2-4.1-7-5.1-9-5.1-2.7 0-4.9 1.3-7 4.4l-2-1-0.1-0.2c0-0.5 3.4-5.6 9.1-5.6 5.8-0.1 11 5.6 11.1 5.9l-0.1 0.4z"/></svg>`,
  chevron: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 4 10 8 6 12"/></svg>`,
  chat: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H6l-4 4V5z"/></svg>`,
  wallet: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z"/><path fill-rule="evenodd" d="M2 9v5a2 2 0 002 2h12a2 2 0 002-2V9H2zm12 2a1 1 0 100 2 1 1 0 000-2z" clip-rule="evenodd"/></svg>`,
  automation: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>`,
  search: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/></svg>`,
  dashboard: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zm10 0a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"/></svg>`,
  chart: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/></svg>`,
  terminal: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>`,
  key: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clip-rule="evenodd"/></svg>`,
  book: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"/></svg>`,
  rocket: `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  menu: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/></svg>`,
  arrowRight: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="8" x2="13" y2="8"/><polyline points="9 4 13 8 9 12"/></svg>`,
};

// ── Nav Structure (all links are real <a> hrefs, no SPA routing) ──
const navSections = [
  {
    title: 'Agent',
    items: [
      { label: 'Chat', href: '/terminal', icon: 'chat' },
      { label: 'Wallet', href: '/wallet', icon: 'wallet' },
      { label: 'Automations', href: '/dashboard', icon: 'automation' },
    ]
  },
  {
    title: 'Explore',
    items: [
      { label: 'Launchpad', href: '/launchpad', icon: 'rocket', active: true },
      { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
      { label: 'Metrics', href: '/dashboard', icon: 'chart' },
    ]
  },
  {
    title: 'Tools',
    items: [
      { label: 'Terminal', href: '/terminal', icon: 'terminal' },
      { label: 'MCP Guide', href: '/mcp-guide', icon: 'book' },
      { label: 'API Keys', href: '/api-keys', icon: 'key' },
    ]
  },
];

// ── State ────────────────────────────────────────────────────
let appData = null;
let healthData = null;
let sidebarOpen = false;

// ── Data Fetching ────────────────────────────────────────────
async function fetchAppData() {
  try {
    const [stateRes, healthRes] = await Promise.all([
      fetch('/api/state').then(r => r.json()).catch(() => null),
      fetch('/api/health').then(r => r.json()).catch(() => null),
    ]);
    appData = stateRes;
    healthData = healthRes;
  } catch (e) {
    console.warn('Failed to fetch app data:', e);
  }
}

// ── Utilities ────────────────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatUSD(val) {
  const num = Number(val) || 0;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Sidebar (uses real <a> links, never overrides navigation) ──
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  document.querySelector('.sidebar')?.classList.toggle('open', sidebarOpen);
  document.querySelector('.mobile-overlay')?.classList.toggle('open', sidebarOpen);
}

function closeSidebar() {
  sidebarOpen = false;
  document.querySelector('.sidebar')?.classList.remove('open');
  document.querySelector('.mobile-overlay')?.classList.remove('open');
}

function toggleNavSection(title) {
  const el = document.querySelector(`.nav-section[data-section="${title}"]`);
  if (el) el.classList.toggle('collapsed');
}

// Expose to onclick handlers
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.toggleNavSection = toggleNavSection;

function renderSidebar() {
  const sectionsHtml = navSections.map(section => `
    <div class="nav-section" data-section="${section.title}">
      <div class="nav-section-title" onclick="toggleNavSection('${section.title}')">
        ${section.title}
        <span class="chevron">${icons.chevron}</span>
      </div>
      <ul class="nav-items">
        ${section.items.map(item => `
          <li>
            <a class="nav-item${item.active ? ' active' : ''}"
               href="${item.href}"
               id="nav-${item.label.toLowerCase().replace(/\s+/g, '-')}">
              <span class="nav-icon">${icons[item.icon]}</span>
              ${item.label}
            </a>
          </li>
        `).join('')}
      </ul>
    </div>
  `).join('');

  return `
    <aside class="sidebar" id="sidebar">
      <a class="sidebar-logo" href="/">
        ${icons.logo}
        <span>bunOS</span>
      </a>
      <nav class="sidebar-nav">
        ${sectionsHtml}
      </nav>
      <div class="sidebar-footer">
        <a class="btn-connect" href="/api/auth/x/start" id="btn-connect-x">
          <span style="width:16px;height:16px;">${icons.x}</span>
          Connect X
        </a>
      </div>
    </aside>
  `;
}

// ── Top Header Bar ───────────────────────────────────────────
function renderTopHeader() {
  return `
    <header class="top-header">
      <div style="display:flex;align-items:center;gap:12px;">
        <button class="mobile-menu-btn" onclick="toggleSidebar()" id="mobile-menu-toggle">
          ${icons.menu}
        </button>
        <div class="breadcrumb">
          <a href="/" style="color:var(--ink-secondary);">bunOS</a>
          <span class="sep">›</span>
          <span class="current">Launchpad</span>
        </div>
      </div>
      <a class="btn-launch" href="/terminal" id="btn-launch-agent">
        <span class="icon">${icons.rocket}</span>
        Launch Agent
      </a>
    </header>
  `;
}

// ── Hero Section ─────────────────────────────────────────────
function renderHero() {
  return `
    <section class="hero fade-in" id="hero-section">
      <div class="hero-bg"></div>
      <div class="hero-mesh"></div>
      <div class="hero-content">
        <div class="hero-badge">
          <span class="dot"></span>
          Arc Testnet Live
          <span style="opacity:0.5;font-size:10px;">→</span>
        </div>
        <h1>The AI-native wallet for the agent economy</h1>
        <p>
          Connect your X account, provision wallets, and let AI agents handle your USDC payments.
          Settle on Arc Testnet with bridging to Base Sepolia.
        </p>
        <div class="hero-actions">
          <a class="btn-hero-primary" href="/api/auth/x/start" id="hero-cta-connect">
            <span style="width:16px;height:16px;">${icons.x}</span>
            Connect X to start
          </a>
          <a class="btn-hero-secondary" href="/terminal" id="hero-cta-terminal">
            <span style="width:16px;height:16px;">${icons.terminal}</span>
            Open Terminal
          </a>
        </div>
      </div>
    </section>
  `;
}

// ── Stats Bar ────────────────────────────────────────────────
function renderStatsBar() {
  const payments = appData?.payments || [];
  const wallets = appData?.wallets || [];
  const automations = appData?.automations || [];

  const totalPayments = payments.length;
  const totalVolume = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const activeWallets = wallets.length;
  const activeAutomations = automations.filter(a => a.status === 'active').length;

  return `
    <div class="stats-bar fade-in stagger-1" id="stats-bar">
      <div class="stat-card">
        <div class="stat-label">
          <span class="stat-icon">💸</span>
          Total Payments
        </div>
        <div class="stat-value">${totalPayments}</div>
        <div class="stat-change up"><span>↗</span> Protocol-wide</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">
          <span class="stat-icon">📊</span>
          Total Volume
        </div>
        <div class="stat-value">${formatUSD(totalVolume)}</div>
        <div class="stat-change up"><span>↗</span> USDC settled</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">
          <span class="stat-icon">👛</span>
          Active Wallets
        </div>
        <div class="stat-value">${activeWallets}</div>
        <div class="stat-change up"><span>↗</span> Connected</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">
          <span class="stat-icon">🤖</span>
          Automations
        </div>
        <div class="stat-value">${activeAutomations}</div>
        <div class="stat-change up"><span>↗</span> Active</div>
      </div>
    </div>
  `;
}

// ── Wallet Profiles Table ────────────────────────────────────
function renderWalletsTable() {
  const wallets = appData?.wallets || [];

  if (!wallets.length) {
    return `
      <div class="data-table-wrap">
        <div class="empty-state">
          <div class="empty-icon">👛</div>
          <h3>No wallets yet</h3>
          <p>Connect your X account to provision your first wallet on Arc Testnet.</p>
        </div>
      </div>
    `;
  }

  const rows = wallets.slice(0, 10).map((w, i) => {
    const handle = w.handle || w.xHandle || 'Unknown';
    const rail = w.rail || w.chain || 'arc-testnet';
    const balance = w.balance || w.usdcBalance || '0';
    const addr = w.address || w.walletAddress || '';
    const shortAddr = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';
    const initial = handle.charAt(0).toUpperCase();

    return `
      <tr>
        <td class="rank">#${i + 1}</td>
        <td>
          <div class="project-cell">
            <div class="project-avatar">${initial}</div>
            <div class="project-info">
              <span class="project-name">@${escapeHtml(handle)}</span>
              <span class="project-handle">${shortAddr}</span>
            </div>
          </div>
        </td>
        <td class="mono right">${formatUSD(balance)}</td>
        <td class="right">
          <span class="status-badge live"><span class="status-dot"></span>${escapeHtml(rail)}</span>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="data-table-wrap">
      <table class="data-table" id="wallets-table">
        <thead>
          <tr>
            <th style="width:50px">#</th>
            <th>Wallet</th>
            <th class="right">Balance</th>
            <th class="right">Rail</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ── Activity Feed ────────────────────────────────────────────
function renderActivityFeed() {
  const commands = appData?.commands || [];
  const payments = appData?.payments || [];

  const activities = [
    ...commands.map(c => ({
      type: 'command',
      title: c.text || c.intent?.action || 'Agent command',
      subtitle: `@${c.actorHandle || 'unknown'}`,
      time: c.receivedAt || c.createdAt,
      amount: null,
    })),
    ...payments.map(p => ({
      type: 'payment',
      title: `${p.senderHandle || 'Unknown'} → ${p.recipientHandle || 'Unknown'}`,
      subtitle: `${p.asset || 'USDC'} on ${p.settlementRail || 'arc-testnet'}`,
      time: p.createdAt,
      amount: Number(p.amount) || 0,
    })),
  ]
    .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))
    .slice(0, 8);

  if (!activities.length) {
    return `
      <div class="activity-feed">
        <div class="empty-state">
          <div class="empty-icon">⚡</div>
          <h3>No activity yet</h3>
          <p>Activity will appear here once you start sending commands or making payments.</p>
        </div>
      </div>
    `;
  }

  const feedItems = activities.map(a => {
    const iconClass = a.type === 'payment' ? 'payment' : 'command';
    const emoji = a.type === 'payment' ? '💸' : '⚡';
    const amountHtml = a.amount
      ? `<span class="feed-amount positive">+${formatUSD(a.amount)}</span>`
      : '';

    return `
      <div class="feed-item">
        <div class="feed-icon ${iconClass}">${emoji}</div>
        <div class="feed-body">
          <div class="feed-title">${escapeHtml(a.title)}</div>
          <div class="feed-subtitle">${escapeHtml(a.subtitle)}</div>
        </div>
        ${amountHtml}
        <span class="feed-time">${timeAgo(a.time)}</span>
      </div>
    `;
  }).join('');

  return `<div class="activity-feed" id="activity-feed">${feedItems}</div>`;
}

// ── Quick Start Cards ────────────────────────────────────────
function renderQuickStart() {
  return `
    <div class="card-grid">
      <a class="info-card" href="/terminal">
        <div class="info-card-icon" style="background:var(--accent-muted);color:var(--accent);">⚡</div>
        <h3>Agent Terminal</h3>
        <p>Chat with the AI agent to send payments, manage wallets, and execute DeFi actions via natural language.</p>
      </a>
      <a class="info-card" href="/wallet">
        <div class="info-card-icon" style="background:var(--green-muted);color:var(--green);">👛</div>
        <h3>Wallet Management</h3>
        <p>View balances, fund wallets, bridge between Arc Testnet and Base Sepolia, and track transaction history.</p>
      </a>
      <a class="info-card" href="/mcp-guide">
        <div class="info-card-icon" style="background:var(--blue-muted);color:var(--blue);">📖</div>
        <h3>MCP Integration</h3>
        <p>Connect bunOS to Claude, Cursor, or any MCP-compatible client for programmatic wallet access.</p>
      </a>
      <a class="info-card" href="/api-keys">
        <div class="info-card-icon" style="background:var(--yellow-muted);color:var(--yellow);">🔑</div>
        <h3>API Keys</h3>
        <p>Generate and manage API keys for headless MCP access. Scope keys to specific tools and operations.</p>
      </a>
    </div>
  `;
}

// ── System Status ────────────────────────────────────────────
function renderSystemStatus() {
  if (!healthData) return '';

  const items = [
    { label: 'Provider', value: healthData.providerMode || '—', color: 'var(--green)' },
    { label: 'Rails', value: (healthData.rails || []).join(', ') || '—', color: 'var(--blue)' },
    { label: 'Jobs Queued', value: healthData.jobs?.queued ?? '—', color: 'var(--yellow)' },
    { label: 'AI Model', value: healthData.ai?.ready ? 'Ready' : 'Offline', color: healthData.ai?.ready ? 'var(--green)' : 'var(--red)' },
  ];

  return `
    <div style="margin-top:28px;" class="fade-in stagger-5">
      <div class="section-header">
        <h2 class="section-title">System Status</h2>
      </div>
      <div class="card-grid" style="grid-template-columns:repeat(auto-fill, minmax(180px, 1fr));">
        ${items.map(item => `
          <div class="info-card" style="padding:16px;cursor:default;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-tertiary);font-weight:700;margin-bottom:4px;">${item.label}</div>
            <div style="font-size:16px;font-weight:700;font-family:var(--font-mono);color:${item.color};">${item.value}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ── Full Launchpad Page ──────────────────────────────────────
function renderLaunchpad() {
  return `
    ${renderHero()}
    ${renderStatsBar()}
    <div class="content-sections">
      <div class="fade-in stagger-2">
        <div class="section-header">
          <h2 class="section-title">Wallet Profiles</h2>
          <a class="view-all-link" href="/wallet">
            View all <span style="width:14px;height:14px;display:inline-flex;">${icons.arrowRight}</span>
          </a>
        </div>
        ${renderWalletsTable()}
      </div>

      <div class="fade-in stagger-3">
        <div class="section-header">
          <h2 class="section-title">Recent Activity</h2>
        </div>
        ${renderActivityFeed()}
      </div>

      <div class="fade-in stagger-4">
        <div class="section-header">
          <h2 class="section-title">Quick Start</h2>
        </div>
        ${renderQuickStart()}
      </div>

      ${renderSystemStatus()}
    </div>
  `;
}

// ── Main Render ──────────────────────────────────────────────
function render() {
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="app-layout">
      ${renderSidebar()}
      <div class="mobile-overlay" onclick="closeSidebar()"></div>
      <main class="main-content" id="main-content">
        ${renderTopHeader()}
        <div class="page-content">
          ${renderLaunchpad()}
        </div>
      </main>
    </div>
  `;
}

// ── Init ─────────────────────────────────────────────────────
async function init() {
  render();
  await fetchAppData();
  render();

  // Refresh data every 30s
  setInterval(async () => {
    await fetchAppData();
    render();
  }, 30_000);
}

init();
