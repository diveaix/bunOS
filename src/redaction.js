const SECRET_KEY_PATTERN = /(secret|privatekey|private_key|apikey|api_key|authorization|accesstoken|access_token|refreshtoken|refresh_token|tokenencryptionkey|entitysecret|entity_secret|secrethash|secret_hash)/i;
const PUBLIC_HASH_KEY_PATTERN = /^(txHash|transactionHash|blockHash)$/i;

export function redactSensitive(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, seen));
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = PUBLIC_HASH_KEY_PATTERN.test(key) && isHexHash(item)
      ? item
      : SECRET_KEY_PATTERN.test(key)
      ? redactSecretValue(item)
      : redactSensitive(item, seen);
  }
  return output;
}

function redactSecretValue(value) {
  if (!value) return value;
  const text = String(value);
  if (text.length <= 8) return "<redacted>";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function redactString(value) {
  return String(value)
    .replace(/KIT_KEY:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+/g, "KIT_KEY:<redacted>")
    .replace(/bunos_mcp_[A-Za-z0-9_-]+/g, "bunos_mcp_<redacted>")
    .replace(/0x[a-fA-F0-9]{64}/g, "0x<redacted_private_key>");
}

function isHexHash(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}
