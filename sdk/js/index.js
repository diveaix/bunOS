const DEFAULT_BASE_URL = "https://bunos.xyz";

export class BunosClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, apiKey = "", fetch: fetchImpl = globalThis.fetch } = {}) {
    if (!fetchImpl) {
      throw new Error("BunosClient requires a fetch implementation.");
    }
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async config() {
    return this.request("GET", "/api/config", { auth: false });
  }

  async health() {
    return this.request("GET", "/api/health", { auth: false });
  }

  async agentTools() {
    return this.request("GET", "/api/agent/tools", { auth: false });
  }

  async mcpTools() {
    return this.request("GET", "/api/mcp/tools", { auth: false });
  }

  async launchpadArchitecture() {
    return this.request("GET", "/api/launchpad/architecture", { auth: false });
  }

  async planTokenLaunch(args = {}) {
    return this.request("POST", "/api/launchpad/plan", {
      body: args
    });
  }

  async createTokenLaunch(args = {}) {
    return this.request("POST", "/api/launchpad/launches", {
      idempotencyKey: args.idempotencyKey,
      body: args
    });
  }

  async listLaunches(filter = {}) {
    const query = toQuery(filter);
    return this.request("GET", `/api/launchpad/launches${query}`, { auth: false });
  }

  async getLaunch(launchId) {
    return this.request("GET", `/api/launchpad/launches/${encodeURIComponent(launchId)}`, { auth: false });
  }

  async deployLaunchToken(launchId, args = {}) {
    return this.request("POST", `/api/launchpad/launches/${encodeURIComponent(launchId)}/deploy-token`, {
      idempotencyKey: args.idempotencyKey,
      body: args
    });
  }

  async seedLaunchLiquidity(launchId, args = {}) {
    return this.request("POST", `/api/launchpad/launches/${encodeURIComponent(launchId)}/seed-liquidity`, {
      idempotencyKey: args.idempotencyKey,
      body: args
    });
  }

  async openLaunchTrading(launchId, args = {}) {
    return this.request("POST", `/api/launchpad/launches/${encodeURIComponent(launchId)}/go-live`, {
      idempotencyKey: args.idempotencyKey,
      body: args
    });
  }

  async updateLaunchAgentPolicy(launchId, args = {}) {
    return this.request("POST", `/api/launchpad/launches/${encodeURIComponent(launchId)}/agent-policy`, {
      body: args
    });
  }

  async getLaunchReceipt(launchId) {
    return this.request("GET", `/api/launchpad/launches/${encodeURIComponent(launchId)}/receipt`, { auth: false });
  }

  async monitorLaunch(launchId) {
    return this.request("GET", `/api/launchpad/launches/${encodeURIComponent(launchId)}/monitor`, { auth: false });
  }

  async getLaunchFees(launchId) {
    return this.request("GET", `/api/launchpad/launches/${encodeURIComponent(launchId)}/fees`, { auth: false });
  }

  async accrueLaunchFees(launchId, args = {}) {
    return this.request("POST", `/api/launchpad/launches/${encodeURIComponent(launchId)}/fees/accrue`, {
      idempotencyKey: args.idempotencyKey,
      body: args
    });
  }

  async claimLaunchFees(launchId, args = {}) {
    return this.request("POST", `/api/launchpad/launches/${encodeURIComponent(launchId)}/fees/claim`, {
      idempotencyKey: args.idempotencyKey,
      body: args
    });
  }

  async getAgentTreasury(filter = {}) {
    const query = toQuery(filter);
    return this.request("GET", `/api/launchpad/treasury${query}`, { auth: false });
  }

  async spendAgentCompute(args = {}) {
    return this.request("POST", "/api/launchpad/treasury/spend", {
      idempotencyKey: args.idempotencyKey,
      body: args
    });
  }

  async listLaunchFeed(filter = {}) {
    const query = toQuery(filter);
    return this.request("GET", `/api/launchpad/feed${query}`, { auth: false });
  }

  async plan({ handle, input, text, ...rest } = {}) {
    return this.request("POST", "/api/agent/plan", {
      body: {
        ...rest,
        handle,
        text: input || text
      }
    });
  }

  async run({ handle, input, text, idempotencyKey, ...rest } = {}) {
    return this.request("POST", "/api/agent/run", {
      idempotencyKey,
      body: {
        ...rest,
        handle,
        text: input || text,
        idempotencyKey
      }
    });
  }

  async callTool(tool, args = {}, { idempotencyKey } = {}) {
    return this.request("POST", "/api/mcp/call", {
      idempotencyKey,
      body: {
        tool,
        arguments: args
      }
    });
  }

  async mcpJsonRpc(payload) {
    return this.request("POST", "/mcp", {
      body: payload
    });
  }

  async getBalance({ handle, settlementRail = "arc-testnet" } = {}) {
    return this.callTool("get_balance", { handle, settlementRail });
  }

  async listApprovals({ handle, status, limit } = {}) {
    return this.callTool("list_approvals", { handle, status, limit });
  }

  async confirmAction({ handle, approvalId } = {}) {
    return this.callTool("confirm_action", { handle, approvalId });
  }

  async quoteDefiRoute(args = {}) {
    return this.callTool("quote_defi_route", args);
  }

  async createAutomation(args = {}) {
    return this.callTool("create_automation", args);
  }

  async request(method, path, { body, auth = true, idempotencyKey } = {}) {
    const headers = {
      accept: "application/json"
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth && this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    const data = text ? parseJson(text, path) : null;

    if (!response.ok) {
      throw new BunosApiError({
        status: response.status,
        statusText: response.statusText,
        path,
        data
      });
    }

    return data;
  }
}

export class BunosApiError extends Error {
  constructor({ status, statusText, path, data }) {
    super(data?.error || data?.message || `bunOS request failed: ${status} ${statusText}`);
    this.name = "BunosApiError";
    this.status = status;
    this.statusText = statusText;
    this.path = path;
    this.data = data;
  }
}

export function createBunosClient(options = {}) {
  return new BunosClient(options);
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`bunOS returned non-JSON response for ${path}: ${error.message}`);
  }
}

function toQuery(params = {}) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) return "";
  return `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}`;
}
