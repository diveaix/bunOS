import { users } from "./fixtures.js";

export function normalizeHandle(handle) {
  if (!handle || typeof handle !== "string") {
    throw new Error("Handle is required");
  }

  const trimmed = handle.trim();
  return trimmed.startsWith("@") ? trimmed.toLowerCase() : `@${trimmed.toLowerCase()}`;
}

export function resolveXHandle(handle) {
  const normalized = normalizeHandle(handle);
  const existing = users.get(normalized);

  if (existing) {
    return existing;
  }

  const user = {
    handle: normalized,
    xUserId: `x_pending_${normalized.slice(1)}`,
    onboarded: false,
    walletAddress: null,
    balance: 0,
    balances: {},
    walletSetId: null,
    chainWallets: [],
    xOAuth: null,
    policy: null
  };

  users.set(normalized, user);
  return user;
}

export function onboardUser(handle, walletAddress) {
  const user = resolveXHandle(handle);
  user.onboarded = true;
  user.walletAddress = walletAddress;
  return user;
}
