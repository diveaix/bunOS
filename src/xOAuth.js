import { createHash, randomBytes, randomUUID } from "node:crypto";
import { config, isRealXAuthMode } from "./config.js";
import { sealSecret } from "./cryptoBox.js";
import { ledger, sessions } from "./fixtures.js";
import { normalizeHandle, resolveXHandle } from "./identity.js";
import { claimPendingPaymentsForUser } from "./orchestrator.js";
import { createWallet } from "./walletAccounts.js";

const OAUTH_TTL_MS = 10 * 60 * 1000;

export function startXOAuth({ returnTo = "/" } = {}) {
  const state = randomUUID();
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const createdAt = Date.now();

  ledger.oauthStates.set(state, {
    state,
    codeVerifier,
    codeChallenge,
    returnTo,
    createdAt,
    expiresAt: createdAt + OAUTH_TTL_MS
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.x.clientId || "mock-x-client",
    redirect_uri: config.x.redirectUri,
    scope: config.x.scopes.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });

  return {
    ok: true,
    mode: config.x.authMode,
    state,
    authUrl: `https://x.com/i/oauth2/authorize?${params.toString()}`,
    expiresAt: new Date(createdAt + OAUTH_TTL_MS).toISOString()
  };
}

export async function completeXOAuth({ state, code }) {
  const oauthState = takeOAuthState(state);
  const token = isRealXAuthMode()
    ? await exchangeAuthorizationCode({ code, codeVerifier: oauthState.codeVerifier })
    : mockToken();
  const xProfile = isRealXAuthMode()
    ? await fetchXProfile(token.accessToken)
    : mockXProfile(state);

  const handle = normalizeHandle(xProfile.username);
  const user = resolveXHandle(handle);
  user.xUserId = xProfile.id;
  user.xOAuth = {
    provider: "x",
    connected: true,
    accessToken: sealSecret(token.accessToken),
    refreshToken: sealSecret(token.refreshToken),
    tokenStorage: "sealed",
    scope: token.scope,
    connectedAt: new Date().toISOString()
  };

  const walletResult = await createWallet({ handle: user.handle });
  const claims = await claimPendingPaymentsForUser({ claimantHandle: user.handle });
  const session = createSession(user.handle);

  return {
    ok: true,
    session,
    user: {
      handle: user.handle,
      xUserId: user.xUserId
    },
    wallet: walletResult.wallet,
    claims: claims.claimed,
    returnTo: oauthState.returnTo
  };
}

export async function completeMockXOAuth({ handle }) {
  const user = resolveXHandle(handle);
  user.xOAuth = {
    provider: "x",
    connected: true,
    accessToken: sealSecret("mock_x_access_token"),
    refreshToken: sealSecret("mock_x_refresh_token"),
    tokenStorage: "sealed",
    scope: config.x.scopes.join(" "),
    connectedAt: new Date().toISOString()
  };

  const walletResult = await createWallet({ handle: user.handle });
  const claims = await claimPendingPaymentsForUser({ claimantHandle: user.handle });
  const session = createSession(user.handle);

  return {
    ok: true,
    mode: "mock",
    session,
    user: {
      handle: user.handle,
      xUserId: user.xUserId
    },
    wallet: walletResult.wallet,
    claims: claims.claimed
  };
}

export function getSession(sessionId) {
  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

export function destroySession(sessionId) {
  if (!sessionId) {
    return { ok: true, cleared: false };
  }

  const cleared = sessions.delete(sessionId);
  return { ok: true, cleared };
}

function createSession(handle) {
  const id = randomUUID();
  const session = {
    id,
    handle,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
  };

  sessions.set(id, session);
  return session;
}

function takeOAuthState(state) {
  const oauthState = ledger.oauthStates.get(state);
  ledger.oauthStates.delete(state);

  if (!oauthState) {
    throw new Error("Invalid OAuth state");
  }

  if (oauthState.expiresAt < Date.now()) {
    throw new Error("OAuth state expired");
  }

  return oauthState;
}

async function exchangeAuthorizationCode({ code, codeVerifier }) {
  if (!config.x.clientId) {
    throw new Error("X real mode requires X_CLIENT_ID");
  }

  const params = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: config.x.redirectUri,
    code_verifier: codeVerifier
  });

  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (config.x.clientSecret) {
    headers.authorization = basicAuthHeader(config.x.clientId, config.x.clientSecret);
  } else {
    params.set("client_id", config.x.clientId);
  }

  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body: params
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(formatTokenExchangeError(data));
  }

  if (!data.access_token) {
    throw new Error("X OAuth token exchange succeeded but did not return an access token. Check the app type, client credentials, and OAuth 2.0 settings.");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    scope: data.scope
  };
}

function basicAuthHeader(clientId, clientSecret) {
  const encoded = `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`;
  return `Basic ${Buffer.from(encoded).toString("base64")}`;
}

function formatTokenExchangeError(data) {
  const message = data.error_description || data.detail || data.error || "X OAuth token exchange failed";
  if (/missing valid authorization header/i.test(message)) {
    return config.x.clientSecret
      ? "X rejected the OAuth token exchange authorization header. Check that X_CLIENT_SECRET belongs to the same X app as X_CLIENT_ID."
      : "X OAuth token exchange needs the app client secret. Add X_CLIENT_SECRET from the same X Developer App, then retry login.";
  }
  return message;
}

async function fetchXProfile(accessToken) {
  const response = await fetch("https://api.x.com/2/users/me?user.fields=username", {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  const data = await response.json();

  if (!response.ok) {
    const message = data.detail || data.title || "X profile lookup failed";
    if (/attached to a Project/i.test(message)) {
      throw new Error("X OAuth is configured, but this X Developer App is not attached to a Project. Attach the app to a Project in the X Developer Portal, then retry login.");
    }
    throw new Error(message);
  }

  return data.data;
}

function mockToken() {
  return {
    accessToken: "mock_x_access_token",
    refreshToken: "mock_x_refresh_token",
    scope: config.x.scopes.join(" ")
  };
}

function mockXProfile(state) {
  return {
    id: `x_mock_${state.slice(0, 8)}`,
    username: "sara"
  };
}

function base64Url(buffer) {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
