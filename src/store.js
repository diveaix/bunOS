import "./env.js";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ledger, users } from "./fixtures.js";
import { syncIdCounters } from "./ids.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const dbFile = process.env.SQLITE_FILE || (process.env.VERCEL
  ? "/tmp/bunos.sqlite"
  : join(root, ".data", "bunos.sqlite"));

let db;

export async function loadStore() {
  await openDb();
  migrateDb();

  const userRows = db.prepare("SELECT data FROM users ORDER BY handle").all();
  if (userRows.length) {
    users.clear();
    for (const row of userRows) {
      const user = JSON.parse(row.data);
      users.set(user.handle, user);
    }
  }

  ledger.payments = loadJsonRows("payments");
  ledger.claims = loadJsonRows("claims");
  ledger.funding = loadJsonRows("funding");
  ledger.bridges = loadJsonRows("bridges");
  ledger.events = loadJsonRows("events");
  ledger.xWebhooks = loadJsonRows("x_webhooks");
  ledger.xCommands = loadJsonRows("x_commands");
  ledger.circleWebhooks = loadJsonRows("circle_webhooks");
  ledger.jobs = loadJsonRows("jobs");
  ledger.automations = loadJsonRows("automations");
  ledger.defiActions = loadJsonRows("defi_actions");
  ledger.approvals = loadJsonRows("approvals");
  ledger.routeCapabilities = loadJsonRows("route_capabilities");
  ledger.securityLocks = loadJsonRows("security_locks");
  ledger.rateLimits = loadJsonRows("rate_limits");
  ledger.agentObservability = loadJsonRows("agent_observability");
  ledger.copyTradeProposals = loadJsonRows("copy_trade_proposals");
  ledger.perpProposals = loadJsonRows("perp_proposals");
  ledger.airdrops = loadJsonRows("airdrops");
  ledger.idempotency = new Map(
    db.prepare("SELECT key, data FROM idempotency").all()
      .map((row) => [row.key, JSON.parse(row.data)])
  );
  ledger.oauthStates = new Map();
  syncIdCounters({
    payments: ledger.payments,
    events: ledger.events,
    defiActions: ledger.defiActions,
    approvals: ledger.approvals,
    copyTradeProposals: ledger.copyTradeProposals,
    perpProposals: ledger.perpProposals,
    xCommands: ledger.xCommands,
    automations: ledger.automations,
    airdrops: ledger.airdrops
  });

  return { ok: true, loaded: true, dbFile };
}

export async function persistStore() {
  await openDb();
  migrateDb();

  let inTransaction = false;
  try {
    db.exec("BEGIN");
    inTransaction = true;
    replaceUsers();
    replaceJsonRows("payments", ledger.payments, "id");
    replaceJsonRows("claims", ledger.claims, "paymentId");
    replaceJsonRows("funding", ledger.funding, "id");
    replaceJsonRows("bridges", ledger.bridges, "id");
    replaceJsonRows("events", ledger.events, "id");
    replaceJsonRows("x_webhooks", ledger.xWebhooks, "eventId", "receivedAt");
    replaceJsonRows("x_commands", ledger.xCommands, "id");
    replaceJsonRows("circle_webhooks", ledger.circleWebhooks, "eventId", "receivedAt");
    replaceJsonRows("jobs", ledger.jobs, "id");
    replaceJsonRows("automations", ledger.automations, "id");
    replaceJsonRows("defi_actions", ledger.defiActions, "id");
    replaceJsonRows("approvals", ledger.approvals, "id");
    replaceJsonRows("route_capabilities", ledger.routeCapabilities, "id");
    replaceJsonRows("security_locks", ledger.securityLocks, "id");
    replaceJsonRows("rate_limits", ledger.rateLimits, "id");
    replaceJsonRows("agent_observability", ledger.agentObservability, "id");
    replaceJsonRows("copy_trade_proposals", ledger.copyTradeProposals, "id");
    replaceJsonRows("perp_proposals", ledger.perpProposals, "id");
    replaceJsonRows("airdrops", ledger.airdrops, "id");
    replaceIdempotency();
    db.exec("COMMIT");
    inTransaction = false;
  } catch (error) {
    if (inTransaction) {
      db.exec("ROLLBACK");
    }
    throw error;
  }

  return { ok: true, dbFile };
}

export function readIdempotentResult(key) {
  if (!key) {
    return null;
  }

  return ledger.idempotency?.get(key)?.result || null;
}

export function rememberIdempotentResult(key, result) {
  if (!key) {
    return result;
  }

  ledger.idempotency ||= new Map();
  ledger.idempotency.set(key, {
    result,
    createdAt: new Date().toISOString()
  });

  return result;
}

async function openDb() {
  if (db) {
    return db;
  }

  await mkdir(dirname(dbFile), { recursive: true });
  const sqlite = await import("node:sqlite");
  db = new sqlite.DatabaseSync(dbFile);
  return db;
}

function migrateDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      handle TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claims (
      payment_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS funding (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bridges (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS x_webhooks (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS x_commands (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS circle_webhooks (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS defi_actions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS route_capabilities (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS security_locks (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_observability (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS copy_trade_proposals (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS perp_proposals (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS airdrops (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function loadJsonRows(table) {
  return db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all()
    .map((row) => JSON.parse(row.data));
}

function replaceUsers() {
  db.exec("DELETE FROM users");
  const stmt = db.prepare("INSERT INTO users (handle, data, updated_at) VALUES (?, ?, ?)");
  for (const user of users.values()) {
    stmt.run(user.handle, JSON.stringify(user), new Date().toISOString());
  }
}

function replaceJsonRows(table, rows, primaryKey, fallbackKey) {
  db.exec(`DELETE FROM ${table}`);
  const idColumn = table === "claims" ? "payment_id" : "id";
  const stmt = db.prepare(`INSERT INTO ${table} (${idColumn}, data, updated_at) VALUES (?, ?, ?)`);

  rows.forEach((row, index) => {
    const key = row[primaryKey] || row[fallbackKey] || `${table}_${index}`;
    stmt.run(String(key), JSON.stringify(row), new Date().toISOString());
  });
}

function replaceIdempotency() {
  db.exec("DELETE FROM idempotency");
  const stmt = db.prepare("INSERT INTO idempotency (key, data, updated_at) VALUES (?, ?, ?)");

  for (const [key, value] of ledger.idempotency || new Map()) {
    stmt.run(key, JSON.stringify(value), new Date().toISOString());
  }
}
