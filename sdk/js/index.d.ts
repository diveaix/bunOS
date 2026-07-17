export interface BunosClientOptions {
  baseUrl?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

export interface AgentActionInput {
  handle?: string;
  input?: string;
  text?: string;
  idempotencyKey?: string;
  [key: string]: unknown;
}

export interface ToolCallOptions {
  idempotencyKey?: string;
}

export interface TokenLaunchPlanInput {
  handle?: string;
  creatorHandle?: string;
  name?: string;
  tokenName?: string;
  symbol?: string;
  totalSupply?: number;
  liquiditySeedUsd?: number;
  seedUsd?: number;
  liquidityLockDays?: number;
  lockDays?: number;
  maxSlippage?: number;
  maxBudgetUsd?: number;
  poolType?: string;
  agentMode?: string;
  [key: string]: unknown;
}

export class BunosApiError extends Error {
  status: number;
  statusText: string;
  path: string;
  data: unknown;
}

export class BunosClient {
  constructor(options?: BunosClientOptions);
  baseUrl: string;
  apiKey: string;
  config(): Promise<unknown>;
  health(): Promise<unknown>;
  agentTools(): Promise<unknown>;
  mcpTools(): Promise<unknown>;
  launchpadArchitecture(): Promise<unknown>;
  planTokenLaunch(args?: TokenLaunchPlanInput): Promise<unknown>;
  createTokenLaunch(args?: TokenLaunchPlanInput & { grants?: string[]; idempotencyKey?: string }): Promise<unknown>;
  listLaunches(filter?: { creatorHandle?: string; handle?: string; status?: string; limit?: number }): Promise<unknown>;
  getLaunch(launchId: string): Promise<unknown>;
  deployLaunchToken(launchId: string, args?: { handle?: string; idempotencyKey?: string }): Promise<unknown>;
  seedLaunchLiquidity(launchId: string, args?: { handle?: string; amountUsd?: number; idempotencyKey?: string }): Promise<unknown>;
  openLaunchTrading(launchId: string, args?: { handle?: string; idempotencyKey?: string }): Promise<unknown>;
  updateLaunchAgentPolicy(launchId: string, args?: { handle?: string; grants?: string[]; maxBudgetUsd?: number; maxSlippage?: number; liquidityLockDays?: number }): Promise<unknown>;
  getLaunchReceipt(launchId: string): Promise<unknown>;
  monitorLaunch(launchId: string): Promise<unknown>;
  getLaunchFees(launchId: string): Promise<unknown>;
  accrueLaunchFees(launchId: string, args?: { handle?: string; volumeUsd?: number; feeUsd?: number; source?: string; idempotencyKey?: string }): Promise<unknown>;
  claimLaunchFees(launchId: string, args?: { handle?: string; amountUsd?: number; destination?: "compute_credits" | "wallet"; idempotencyKey?: string }): Promise<unknown>;
  getAgentTreasury(filter?: { handle?: string; limit?: number }): Promise<unknown>;
  spendAgentCompute(args?: { handle?: string; launchId?: string; amountUsd?: number; purpose?: string; idempotencyKey?: string }): Promise<unknown>;
  listLaunchFeed(filter?: { creatorHandle?: string; handle?: string; status?: string; limit?: number }): Promise<unknown>;
  plan(input?: AgentActionInput): Promise<unknown>;
  run(input?: AgentActionInput): Promise<unknown>;
  callTool(tool: string, args?: Record<string, unknown>, options?: ToolCallOptions): Promise<unknown>;
  mcpJsonRpc(payload: unknown): Promise<unknown>;
  getBalance(args?: { handle?: string; settlementRail?: string }): Promise<unknown>;
  listApprovals(args?: { handle?: string; status?: string; limit?: number }): Promise<unknown>;
  confirmAction(args?: { handle?: string; approvalId?: string }): Promise<unknown>;
  quoteDefiRoute(args?: Record<string, unknown>): Promise<unknown>;
  createAutomation(args?: Record<string, unknown>): Promise<unknown>;
  request(method: string, path: string, options?: { body?: unknown; auth?: boolean; idempotencyKey?: string }): Promise<unknown>;
}

export function createBunosClient(options?: BunosClientOptions): BunosClient;
