import { getXCommandReceipt, processXPaymentEvent, processXWebhookDelivery } from "./xPayments.js";
import { postXCommandReply } from "./xReplyPoster.js";

export async function runXBotWebhookDelivery({
  headers = {},
  rawBody = "",
  host,
  protocol = "http",
  postReply = true
} = {}) {
  const result = await processXWebhookDelivery({ headers, rawBody });
  return attachReceiptAndReplyDelivery({
    result,
    host,
    protocol,
    postReply
  });
}

export async function runXBotCommand({
  actorHandle,
  text,
  postId = "demo-post",
  eventId,
  idempotencyKey,
  settlementRail,
  source = "x-command",
  host,
  protocol = "http",
  postReply = true
} = {}) {
  const result = await processXPaymentEvent({
    actorHandle,
    text,
    postId,
    eventId,
    idempotencyKey,
    settlementRail,
    source
  });

  return attachReceiptAndReplyDelivery({
    result,
    host,
    protocol,
    postReply
  });
}

async function attachReceiptAndReplyDelivery({
  result,
  host,
  protocol,
  postReply
} = {}) {
  const commandId = result.command?.id || result.originalCommandId;
  if (!commandId) {
    return {
      ...result,
      loop: {
        status: result.duplicate ? "duplicate_rejected" : "no_command",
        replyPostStatus: "not_attempted",
        reason: result.duplicate ? "Webhook replay was rejected before execution." : "No X command was created."
      }
    };
  }

  const receiptResult = getXCommandReceipt({ commandId, host, protocol });
  const receipt = receiptResult.receipt;
  let replyDelivery = null;

  if (postReply && !result.duplicate) {
    replyDelivery = await postXCommandReply({
      commandId,
      publicUrl: receipt.publicUrl
    });
  }

  return {
    ...result,
    receipt,
    reply: receipt.reply,
    replyDelivery,
    loop: {
      status: result.duplicate ? "duplicate_rejected" : "processed",
      replyPostStatus: replyDelivery?.status || "not_attempted",
      reason: result.duplicate
        ? "Duplicate X event detected. The original command receipt is returned without running the action again."
        : "X command processed, command receipt created, and reply delivery was attempted when enabled.",
      commandId,
      receiptUrl: receipt.publicUrl,
      approvalUrl: receipt.approvalUrl,
      txHash: receipt.command.resultRefs?.txHash || null
    }
  };
}
