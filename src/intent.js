import { normalizeHandle } from "./identity.js";

const SEND_PATTERN = /(?:send|pay|tip)\s+\$?(\d+(?:\.\d+)?)\s*(?:usdc)?\s+(?:to\s+)?(@[a-zA-Z0-9_]+)/i;
const BOUNTY_PATTERN = /(?:send|pay|tip)\s+\$?(\d+(?:\.\d+)?)\s*(?:usdc)?\s+(?:to\s+)?(?:whoever|the one who|anyone who)\s+(comments|replies)\s+first/i;
const PERP_SIDE_SYMBOL_PATTERN = /(?:open\s+)?(?:(long|short)\s+([a-zA-Z][a-zA-Z0-9]{1,9})|([a-zA-Z][a-zA-Z0-9]{1,9})\s+(long|short))/i;
const PERP_LEVERAGE_PATTERN = /(\d+(?:\.\d+)?)\s*x/i;
const PERP_AMOUNT_PATTERN = /(?:with|using|margin|collateral|for)\s+\$?(\d+(?:\.\d+)?)\s*(?:usdc|usd)?/i;

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

  const perp = parsePerpCommand(text);
  if (perp) {
    return perp;
  }

  throw new Error("Could not parse a supported X command");
}

function parsePerpCommand(text) {
  const command = text.replace(/@[a-zA-Z0-9_]+/g, " ");
  const sideSymbol = command.match(PERP_SIDE_SYMBOL_PATTERN);
  const leverage = command.match(PERP_LEVERAGE_PATTERN);
  const amount = command.match(PERP_AMOUNT_PATTERN);
  if (!sideSymbol || !leverage || !amount) {
    return null;
  }

  const side = sideSymbol[1] || sideSymbol[4];
  const symbol = sideSymbol[2] || sideSymbol[3];
  return {
    action: "propose_perp_trade",
    symbol: symbol.toUpperCase(),
    side: side.toLowerCase(),
    collateralUsd: Number(amount[1]),
    leverage: Number(leverage[1])
  };
}
