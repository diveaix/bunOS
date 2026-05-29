import { getArcPerpsReadiness } from "./arcPerpsEngine.js";
import { getDefiExecutionReadiness } from "./defiExecution.js";
import { getCircleReadiness } from "./circleProvider.js";
import { config } from "./config.js";
import { ledger } from "./fixtures.js";

export function listArcTradingPrimitives() {
  const defi = getDefiExecutionReadiness();
  const perps = getArcPerpsReadiness();
  const circle = getCircleReadiness();

  return {
    ok: true,
    backendSignerAllowed: false,
    settlement: {
      primary: "arc-testnet",
      rails: config.settlement.supportedRails
    },
    primitives: [
      primitive("swap", {
        tools: ["quote_defi_route", "quote_swap", "confirm_defi_action", "reconcile_defi_action", "appkit_swap"],
        status: defi.ready ? "live_user_wallet_execution_ready" : "quote_or_execution_gated",
        provider: defi.appKit.executionReady ? "circle-app-kit" : "lifi_or_appkit_quote",
        blockers: defi.blockers
      }),
      primitive("bridge", {
        tools: ["bridge_usdc", "demo_bridge_arc_to_base", "appkit_bridge_usdc", "confirm_defi_action", "reconcile_defi_action"],
        status: defi.ready ? "live_user_wallet_execution_ready" : "quote_or_execution_gated",
        provider: defi.appKit.executionReady ? "circle-app-kit-cctp" : "circle_appkit_quote",
        blockers: defi.blockers
      }),
      primitive("perps", {
        tools: ["propose_perp_trade", "quote_arc_perp_position", "open_arc_perp_user_position", "close_arc_perp_user_position"],
        status: perps.userWalletExecutionReady ? "live_user_wallet_execution_ready" : "user_wallet_signing_required",
        provider: "arc-perps-lite",
        blockers: perps.missing || []
      }),
      primitive("airdrop", {
        tools: ["create_airdrop", "award_airdrop", "list_airdrops", "get_airdrop_receipt"],
        status: circle.ready ? "live_user_wallet_payment_path_ready" : "circle_provider_gated",
        provider: "circle-user-wallet-payments",
        blockers: circle.ready ? [] : ["Configure Circle provider for real transfers"]
      }),
      primitive("bounty", {
        tools: ["create_social_bounty", "award_bounty", "get_receipt"],
        status: circle.ready ? "live_user_wallet_payment_path_ready" : "circle_provider_gated",
        provider: "circle-user-wallet-payments",
        blockers: circle.ready ? [] : ["Configure Circle provider for real transfers"]
      }),
      primitive("automation", {
        tools: ["create_automation", "run_automation", "run_due_automations"],
        status: config.automations.workerEnabled ? "worker_enabled" : "manual_run_only",
        provider: "bunOS-agent-worker",
        blockers: config.automations.workerEnabled ? [] : ["Set AUTOMATION_WORKER_ENABLED=1 for background execution"]
      })
    ],
    counts: {
      defiActions: ledger.defiActions.length,
      perpProposals: ledger.perpProposals.length,
      airdrops: ledger.airdrops.length,
      bounties: ledger.payments.filter((payment) => payment.kind === "social_bounty").length,
      automations: ledger.automations.length
    }
  };
}

function primitive(name, details) {
  return {
    name,
    backendSignerAllowed: false,
    ...details
  };
}
