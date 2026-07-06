import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";

const algorithm = "aes-256-gcm";

export function sealSecret(value) {
  if (!value) {
    return null;
  }

  const iv = randomBytes(12);
  const key = deriveKey();
  const cipher = createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

export function openSecret(sealed) {
  if (!sealed) {
    return null;
  }

  const [version, ivRaw, tagRaw, ciphertextRaw] = sealed.split(".");
  if (version !== "v1") {
    throw new Error("Unsupported sealed secret version");
  }

  const decipher = createDecipheriv(algorithm, deriveKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function deriveKey() {
  return createHash("sha256").update(config.tokenEncryptionKey).digest();
}
