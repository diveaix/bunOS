import { normalizeHandle } from "./identity.js";

const SEND_PATTERN = /(?:send|pay|tip)\s+\$?(\d+(?:\.\d+)?)\s*(?:usdc)?\s+(?:to\s+)?(@[a-zA-Z0-9_]+)/i;
const BOUNTY_PATTERN = /(?:send|pay|tip)\s+\$?(\d+(?:\.\d+)?)\s*(?:usdc)?\s+(?:to\s+)?(?:whoever|the one who|anyone who)\s+(comments|replies)\s+first/i;

export function parseSocialCommand(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Command text is required");
  }

  const bounty = text.match(BOUNTY_PATTERN);
  if (bounty) {
    return {
      action: "create_social_bounty",
      amount: Number(bounty[1]),
      asset: "USDC",
      rule: "first_valid_commenter"
    };
  }

  const send = text.match(SEND_PATTERN);
  if (send) {
    return {
      action: "send_payment",
      amount: Number(send[1]),
      asset: "USDC",
      recipientHandle: normalizeHandle(send[2])
    };
  }

  throw new Error("Could not parse a supported X command");
}
