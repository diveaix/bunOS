import { ledger } from "./fixtures.js";
import { createApproval } from "./approvals.js";
import { nextEventId, nextPaymentId } from "./ids.js";
import { enqueueJob } from "./jobs.js";
import { resolveXHandle } from "./identity.js";
import { evaluatePolicy } from "./policy.js";
import { selectSettlementRail, simulateSettlement } from "./settlement.js";
import { circleUserSigner, userWalletSigningRequired } from "./signerPolicy.js";
import { readIdempotentResult, rememberIdempotentResult } from "./store.js";
import { normalizeAmount, roundUsd } from "./walletAccounts.js";
import { prepareCircleEscrow, prepareCircleTransfer } from "./wallets.js";

export async function createPaymentIntent({
  senderHandle,
  recipientHandle,
  amount,
  asset = "USDC",
  source = "api",
  memo = "",
  settlementRail,
  idempotencyKey
}) {
  const replay = readIdempotentResult(idempotencyKey);
  if (replay) {
    return { ...replay, idempotentReplay: true };
  }

  const sender = resolveXHandle(senderHandle);
  const recipient = resolveXHandle(recipientHandle);
  const normalizedAmount = normalizeAmount(amount);
  const rail = selectSettlementRail({ preferred: settlementRail });
  const policy = evaluatePolicy({ sender, amount: normalizedAmount, asset, settlementRail: rail.id });

  if (!policy.approved) {
    return rememberIdempotentResult(idempotencyKey, recordEvent({
      type: "payment_rejected",
      source,
      reason: policy.reason,
      senderHandle: sender.handle,
      recipientHandle: recipient.handle,
      amount: normalizedAmount,
      asset
    }));
  }

  if (!policy.requiresConfirmation && !hasSpendableBalance(sender, normalizedAmount, rail.id)) {
    return rememberIdempotentResult(idempotencyKey, recordEvent({
      type: "payment_rejected",
      source,
      reason: "Insufficient wallet balance",
      senderHandle: sender.handle,
      recipientHandle: recipient.handle,
      amount: normalizedAmount,
      asset
    }));
  }

  const paymentId = nextPaymentId();
  const onboardedRecipient = recipient.onboarded && recipient.walletAddress;
  const walletInstruction = onboardedRecipient
    ? prepareCircleTransfer({ sender, recipient, amount: normalizedAmount, asset, settlementRail: rail.id })
    : prepareCircleEscrow({ sender, recipient, amount: normalizedAmount, asset, paymentId, settlementRail: rail.id });
  const settlement = simulateSettlement({ rail, paymentId });
  const status = policy.requiresConfirmation
    ? "requires_confirmation"
    : onboardedRecipient
      ? "queued"
      : "claimable";

  const payment = {
    id: paymentId,
    source,
    senderHandle: sender.handle,
    senderXUserId: sender.xUserId,
    recipientHandle: recipient.handle,
    recipientXUserId: recipient.xUserId,
    amount: normalizedAmount,
    asset,
    memo,
    status,
    settlement,
    walletInstruction,
    createdAt: new Date().toISOString(),
    requiresConfirmation: policy.requiresConfirmation,
    settlementRail: rail.id,
    signer: circleUserSigner({
      operation: onboardedRecipient ? "send_usdc" : "claimable_escrow",
      settlementRail: rail.id,
      requiresUserApproval: policy.requiresConfirmation,
      executionStatus: status
    }),
    debited: false,
    credited: false
  };

  ledger.payments.push(payment);

  if (policy.requiresConfirmation) {
    const approval = createApproval({
      handle: sender.handle,
      kind: "payment",
      targetId: payment.id,
      title: `Send ${normalizedAmount} ${asset} to ${recipient.handle}`,
      summary: `Payment requires confirmation before settlement on ${rail.label}.`,
      risk: "medium",
      metadata: {
        amount: normalizedAmount,
        asset,
        settlementRail: rail.id,
        recipientHandle: recipient.handle
      }
    });
    payment.approvalId = approval.id;
  }

  if (!policy.requiresConfirmation) {
    if (status === "queued") {
      enqueueTransferJob(payment);
    } else if (status === "claimable") {
      settleWalletMovement({ payment, sender, recipient });
    }
  }

  if (status === "claimable") {
    ledger.claims.push({
      paymentId,
      recipientHandle: recipient.handle,
      recipientXUserId: recipient.xUserId,
      status: "unclaimed",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
  }

  recordEvent({
    type: "payment_created",
    source,
    paymentId,
    status,
    senderHandle: sender.handle,
    recipientHandle: recipient.handle
  });

  return rememberIdempotentResult(idempotencyKey, {
    ok: true,
    payment,
    nextAction: getNextAction(payment)
  });
}

export async function createSocialBounty({
  senderHandle,
  amount,
  asset = "USDC",
  postId = "demo-post",
  rule = "first_valid_commenter",
  source = "x-command",
  settlementRail,
  idempotencyKey
}) {
  const replay = readIdempotentResult(idempotencyKey);
  if (replay) {
    return { ...replay, idempotentReplay: true };
  }

  const sender = resolveXHandle(senderHandle);
  const normalizedAmount = normalizeAmount(amount);
  const rail = selectSettlementRail({ preferred: settlementRail || "arc-testnet" });
  const policy = evaluatePolicy({ sender, amount: normalizedAmount, asset, settlementRail: rail.id });

  if (!policy.approved) {
    return rememberIdempotentResult(idempotencyKey, recordEvent({
      type: "bounty_rejected",
      source,
      reason: policy.reason,
      senderHandle: sender.handle,
      amount: normalizedAmount,
      asset
    }));
  }

  if (!policy.requiresConfirmation && !hasSpendableBalance(sender, normalizedAmount, rail.id)) {
    return rememberIdempotentResult(idempotencyKey, recordEvent({
      type: "bounty_rejected",
      source,
      reason: "Insufficient wallet balance",
      senderHandle: sender.handle,
      amount: normalizedAmount,
      asset
    }));
  }

  const paymentId = nextPaymentId();
  const settlement = simulateSettlement({ rail, paymentId });
  const bounty = {
    id: paymentId,
    source,
    kind: "social_bounty",
    postId,
    rule,
    senderHandle: sender.handle,
    senderXUserId: sender.xUserId,
    amount: normalizedAmount,
    asset,
    status: "watching_replies",
    settlement,
    createdAt: new Date().toISOString(),
    requiresConfirmation: policy.requiresConfirmation,
    settlementRail: rail.id,
    signer: circleUserSigner({
      operation: "social_bounty_escrow",
      settlementRail: rail.id,
      requiresUserApproval: policy.requiresConfirmation,
      executionStatus: policy.requiresConfirmation ? "requires_confirmation" : "watching_replies"
    }),
    debited: false,
    credited: false
  };

  ledger.payments.push(bounty);

  if (policy.requiresConfirmation) {
    const approval = createApproval({
      handle: sender.handle,
      kind: "payment",
      targetId: bounty.id,
      title: `Create ${normalizedAmount} ${asset} X bounty`,
      summary: `Bounty escrow requires confirmation before watching replies.`,
      risk: "medium",
      metadata: {
        postId,
        rule,
        amount: normalizedAmount,
        asset,
        settlementRail: rail.id
      }
    });
    bounty.approvalId = approval.id;
  }

  if (!policy.requiresConfirmation) {
    debitWallet(sender, bounty);
  }

  recordEvent({
    type: "bounty_created",
    source,
    paymentId,
    postId,
    rule,
    senderHandle: sender.handle
  });

  return rememberIdempotentResult(idempotencyKey, {
    ok: true,
    payment: bounty,
    nextAction: policy.requiresConfirmation
      ? "Ask sender to confirm before watching replies"
      : "Watch X replies and assign to first valid commenter"
  });
}

export async function claimPayment({ paymentId, claimantHandle, walletAddress }) {
  const payment = ledger.payments.find((item) => item.id === paymentId);
  if (!payment) {
    throw new Error("Payment not found");
  }

  const claimant = resolveXHandle(claimantHandle);
  if (claimant.xUserId !== payment.recipientXUserId) {
    throw new Error("Claimant does not match intended X account");
  }

  claimant.onboarded = true;
  claimant.walletAddress = walletAddress || walletAddressForRail(claimant, payment.settlementRail);
  claimant.balance = Number(claimant.balance || 0);
  payment.status = "claimed";
  payment.claimedAt = new Date().toISOString();
  payment.recipientWalletAddress = claimant.walletAddress;
  payment.signer = circleUserSigner({
    operation: "claim_escrow",
    settlementRail: payment.settlementRail,
    requiresUserApproval: true,
    executionStatus: "queued"
  });

  payment.status = "queued";
  enqueueTransferJob(payment);

  const claim = ledger.claims.find((item) => item.paymentId === paymentId);
  if (claim) {
    claim.status = "claimed";
    claim.walletAddress = claimant.walletAddress;
    claim.claimedAt = payment.claimedAt;
  }

  recordEvent({
    type: "payment_claimed",
    source: "claim",
    paymentId,
    claimantHandle: claimant.handle
  });

  return { ok: true, payment };
}

export async function claimPendingPaymentsForUser({ claimantHandle }) {
  const claimant = resolveXHandle(claimantHandle);
  const pendingClaims = ledger.claims.filter((claim) => (
    claim.status === "unclaimed"
    && claim.recipientXUserId === claimant.xUserId
  ));

  const claimed = [];
  for (const claim of pendingClaims) {
    const payment = ledger.payments.find((payment) => payment.id === claim.paymentId);
    const result = await claimPayment({
      paymentId: claim.paymentId,
      claimantHandle: claimant.handle,
      walletAddress: walletAddressForRail(claimant, payment?.settlementRail)
    });
    claimed.push(result.payment);
  }

  return {
    ok: true,
    claimed
  };
}

export async function confirmPayment({ paymentId }) {
  const payment = ledger.payments.find((item) => item.id === paymentId);
  if (!payment) {
    throw new Error("Payment not found");
  }

  if (!payment.requiresConfirmation) {
    return { ok: true, payment, message: "Payment did not require confirmation" };
  }

  if (payment.status !== "requires_confirmation") {
    return { ok: true, payment, message: "Payment was already confirmed" };
  }

  const sender = resolveXHandle(payment.senderHandle);
  const recipient = resolveXHandle(payment.recipientHandle);

  if (!hasSpendableBalance(sender, payment.amount, payment.settlementRail)) {
    payment.status = "rejected";
    payment.rejectedAt = new Date().toISOString();
    payment.rejectionReason = "Insufficient wallet balance";

    recordEvent({
      type: "payment_rejected",
      source: "confirmation",
      paymentId,
      reason: payment.rejectionReason,
      senderHandle: sender.handle,
      recipientHandle: recipient.handle
    });

    return { ok: false, payment, nextAction: "Ask sender to fund wallet" };
  }

  payment.status = payment.walletInstruction?.escrowAccount ? "claimable" : "queued";
  payment.confirmedAt = new Date().toISOString();
  if (payment.status === "queued") {
    enqueueTransferJob(payment);
  } else {
    settleWalletMovement({ payment, sender, recipient });
  }

  if (payment.status === "claimable") {
    ensureClaim(payment);
  }

  recordEvent({
    type: "payment_confirmed",
    source: "confirmation",
    paymentId,
    status: payment.status
  });

  return { ok: true, payment, nextAction: getNextAction(payment) };
}

export async function awardBounty({ paymentId, winnerHandle }) {
  const bounty = ledger.payments.find((item) => item.id === paymentId);
  if (!bounty) {
    throw new Error("Bounty not found");
  }

  if (bounty.kind !== "social_bounty") {
    throw new Error("Payment is not a social bounty");
  }

  const winner = resolveXHandle(winnerHandle);
  const sender = resolveXHandle(bounty.senderHandle);

  if (!bounty.debited) {
    if (!hasSpendableBalance(sender, bounty.amount, bounty.settlementRail)) {
      bounty.status = "rejected";
      bounty.rejectionReason = "Insufficient wallet balance";
      recordEvent({
        type: "bounty_rejected",
        source: "x-reply-listener",
        paymentId,
        reason: bounty.rejectionReason,
        senderHandle: sender.handle
      });
      return { ok: false, payment: bounty, nextAction: "Ask sender to fund wallet" };
    }

    debitWallet(sender, bounty);
  }

  bounty.recipientHandle = winner.handle;
  bounty.recipientXUserId = winner.xUserId;
  bounty.awardedAt = new Date().toISOString();

  if (winner.onboarded && winner.walletAddress) {
    bounty.status = "queued";
    bounty.recipientWalletAddress = walletAddressForRail(winner, bounty.settlementRail);
    bounty.walletInstruction = {
      provider: "circle-wallets",
      from: "bounty-escrow",
      to: bounty.recipientWalletAddress,
      amount: bounty.amount,
      asset: bounty.asset,
      settlementRail: bounty.settlementRail,
      signingMode: "arc-escrow-release"
    };
    bounty.signer = circleUserSigner({
      operation: "social_bounty_award",
      settlementRail: bounty.settlementRail,
      requiresUserApproval: false,
      executionStatus: "queued"
    });
    enqueueTransferJob(bounty);
  } else {
    bounty.status = "claimable";
    bounty.walletInstruction = {
      provider: "circle-wallets",
      from: "bounty-escrow",
      escrowAccount: `escrow:${bounty.id}`,
      claimantXUserId: winner.xUserId,
      amount: bounty.amount,
      asset: bounty.asset,
      settlementRail: bounty.settlementRail,
      signingMode: "arc-escrow-release"
    };
    bounty.signer = userWalletSigningRequired({
      operation: "social_bounty_claim",
      settlementRail: bounty.settlementRail,
      reason: "Winner must create or connect a user wallet before the bounty can be released."
    });
    ensureClaim(bounty);
  }

  recordEvent({
    type: "bounty_awarded",
    source: "x-reply-listener",
    paymentId,
    winnerHandle: winner.handle,
    status: bounty.status
  });

  return { ok: true, payment: bounty, nextAction: getNextAction(bounty) };
}

export function getState() {
  return ledger;
}

function getNextAction(payment) {
  if (payment.status === "requires_confirmation") {
    return "Ask sender to confirm with passkey/Circle challenge";
  }

  if (payment.status === "claimable") {
    return "Notify recipient to verify X and claim escrow";
  }

  if (payment.status === "queued") {
    return "Submit transfer through the payment worker";
  }

  if (payment.status === "submitted") {
    return "Await Circle settlement webhook";
  }

  if (payment.status === "failed") {
    return "Retry transfer submission or resolve provider failure";
  }

  return "Notify both users with receipt";
}

function enqueueTransferJob(payment) {
  payment.queuedAt ||= new Date().toISOString();
  payment.providerStatus = "queued";
  if (payment.signer) {
    payment.signer = {
      ...payment.signer,
      executionStatus: "queued"
    };
  }
  const job = enqueueJob({
    type: "submit_transfer",
    payload: { paymentId: payment.id },
    idempotencyKey: `submit_transfer:${payment.id}`
  });
  payment.transferJobId = job.id;
  return job;
}

function ensureClaim(payment) {
  const existing = ledger.claims.find((item) => item.paymentId === payment.id);
  if (existing) {
    return existing;
  }

  const claim = {
    paymentId: payment.id,
    recipientHandle: payment.recipientHandle,
    recipientXUserId: payment.recipientXUserId,
    status: "unclaimed",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  };
  ledger.claims.push(claim);
  return claim;
}

function settleWalletMovement({ payment, sender, recipient }) {
  if (!payment.debited) {
    debitWallet(sender, payment);
  }

  if (payment.status === "settled" && recipient.onboarded && recipient.walletAddress && !payment.credited) {
    creditWallet(recipient, payment);
  }
}

function hasSpendableBalance(user, amount, settlementRail = "arc-testnet") {
  return Number(user.balances?.[settlementRail] || 0) >= Number(amount);
}

function debitWallet(user, payment) {
  const rail = payment.settlementRail || payment.settlement?.rail || "arc-testnet";
  user.balances ||= {};
  user.balances[rail] = roundUsd(Number(user.balances[rail] || 0) - Number(payment.amount || 0));
  user.balance = totalBalance(user);
  payment.debited = true;
  payment.senderBalanceAfter = user.balances[rail];
}

function creditWallet(user, payment) {
  const rail = payment.settlementRail || payment.settlement?.rail || "arc-testnet";
  user.balances ||= {};
  user.balances[rail] = roundUsd(Number(user.balances[rail] || 0) + Number(payment.amount || 0));
  user.balance = totalBalance(user);
  payment.credited = true;
  payment.recipientBalanceAfter = user.balances[rail];
}

function totalBalance(user) {
  return roundUsd(Object.values(user.balances || {}).reduce((sum, value) => sum + Number(value || 0), 0));
}

function walletAddressForRail(user, settlementRail) {
  return user.chainWallets?.find((wallet) => wallet.rail === settlementRail)?.address
    || user.walletAddress;
}

function recordEvent(event) {
  const enriched = {
    id: nextEventId(),
    at: new Date().toISOString(),
    ...event
  };
  ledger.events.push(enriched);
  return { ok: event.type.endsWith("rejected") ? false : true, event: enriched };
}
