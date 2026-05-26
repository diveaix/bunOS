let paymentCounter = 1;
let eventCounter = 1;
let defiActionCounter = 1;
let approvalCounter = 1;
let copyTradeCounter = 1;
let perpProposalCounter = 1;
let xCommandCounter = 1;
let automationCounter = 1;

export function nextPaymentId() {
  return `pay_${String(paymentCounter++).padStart(3, "0")}`;
}

export function nextEventId() {
  return `evt_${String(eventCounter++).padStart(3, "0")}`;
}

export function nextDefiActionId() {
  return `defi_${String(defiActionCounter++).padStart(4, "0")}`;
}

export function nextApprovalId() {
  return `appr_${String(approvalCounter++).padStart(4, "0")}`;
}

export function nextCopyTradeProposalId() {
  return `copy_${String(copyTradeCounter++).padStart(4, "0")}`;
}

export function nextPerpProposalId() {
  return `perp_${String(perpProposalCounter++).padStart(4, "0")}`;
}

export function nextXCommandId() {
  return `xcmd_${String(xCommandCounter++).padStart(4, "0")}`;
}

export function nextAutomationId() {
  return `auto_${String(automationCounter++).padStart(4, "0")}`;
}

export function syncIdCounters({
  payments = [],
  events = [],
  defiActions = [],
  approvals = [],
  copyTradeProposals = [],
  perpProposals = [],
  xCommands = [],
  automations = []
} = {}) {
  paymentCounter = Math.max(paymentCounter, maxNumericSuffix(payments.map((payment) => payment.id), "pay_") + 1);
  eventCounter = Math.max(eventCounter, maxNumericSuffix(events.map((event) => event.id), "evt_") + 1);
  defiActionCounter = Math.max(defiActionCounter, maxNumericSuffix(defiActions.map((action) => action.id), "defi_") + 1);
  approvalCounter = Math.max(approvalCounter, maxNumericSuffix(approvals.map((approval) => approval.id), "appr_") + 1);
  copyTradeCounter = Math.max(copyTradeCounter, maxNumericSuffix(copyTradeProposals.map((proposal) => proposal.id), "copy_") + 1);
  perpProposalCounter = Math.max(perpProposalCounter, maxNumericSuffix(perpProposals.map((proposal) => proposal.id), "perp_") + 1);
  xCommandCounter = Math.max(xCommandCounter, maxNumericSuffix(xCommands.map((command) => command.id), "xcmd_") + 1);
  automationCounter = Math.max(automationCounter, maxNumericSuffix(automations.map((automation) => automation.id), "auto_") + 1);
}

function maxNumericSuffix(values, prefix) {
  return values.reduce((max, value) => {
    const text = String(value || "");
    if (!text.startsWith(prefix)) {
      return max;
    }

    const numeric = Number.parseInt(text.slice(prefix.length), 10);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);
}
