import { useCallback, useEffect, useState } from "react";
import { useSession } from "../hooks/useSession";
import { useToast } from "../hooks/useToast";
import { fetchJson, post, del, esc, formatDate } from "../api";
import "./ApiKeys.css";

export default function ApiKeys() {
  const { session, config, login } = useSession();
  const notify = useToast();
  const [apiKeys, setApiKeys] = useState([]);
  const [lastCreatedKey, setLastCreatedKey] = useState(null);
  const signedIn = Boolean(session?.handle);

  const loadKeys = useCallback(async () => {
    if (!signedIn) { setApiKeys([]); return; }
    try {
      const data = await fetchJson("/api/api-keys");
      setApiKeys(data.apiKeys || []);
    } catch { setApiKeys([]); }
  }, [signedIn]);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const handleSignin = async () => {
    await login(session?.handle || "@demo");
  };

  const createKey = async () => {
    try {
      const result = await post("/api/api-keys", {
        name: `MCP key ${new Date().toLocaleDateString()}`,
      });
      setLastCreatedKey(result.secret);
      setApiKeys((prev) => [result.apiKey, ...prev.filter((k) => k.id !== result.apiKey.id)]);
      notify("MCP API key created");
    } catch (err) {
      notify(err.message);
    }
  };

  const revokeKey = async (keyId) => {
    try {
      await del(`/api/api-keys/${encodeURIComponent(keyId)}`);
      setApiKeys((prev) => prev.filter((k) => k.id !== keyId));
      notify("API key revoked");
    } catch (err) {
      notify(err.message);
    }
  };

  const copySecret = async () => {
    if (lastCreatedKey) {
      await navigator.clipboard.writeText(lastCreatedKey);
      notify("API key copied");
    }
  };

  const mcpUrl = `${location.origin}/mcp`;
  const configSnippet = JSON.stringify({
    mcpServers: {
      bunos: {
        url: mcpUrl,
        headers: { Authorization: "Bearer bunos_mcp_..." },
      },
    },
  }, null, 2);

  const urlPrompt = [
    "Use this MCP URL in any MCP client:",
    mcpUrl,
    "",
    "Authorization header:",
    "Bearer bunos_mcp_...",
  ].join("\n");

  return (
    <main className="wallet-main single-column">
      <section className="page-section">
        <div className="view-head">
          <div>
            <span className="panel-kicker">Developer access</span>
            <h1 className="settings-title">API keys</h1>
          </div>
          <button id="createApiKey" type="button" className="primary-action" onClick={createKey} disabled={!signedIn}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
            New key
          </button>
        </div>

        {!signedIn && (
          <div className="connect-card">
            <div className="connect-provider">
              <span className="x-logo-mark" aria-hidden="true">X</span>
              <span className="panel-kicker">X account</span>
            </div>
            <strong>Sign in to create MCP API keys.</strong>
            <p>API keys connect your MCP clients to the same Circle wallet created from your X account.</p>
            <button type="button" className="x-signin-button" onClick={handleSignin}>
              <span className="x-signin-mark" aria-hidden="true">X</span>
              Sign in with X
            </button>
          </div>
        )}

        {lastCreatedKey && (
          <div className="api-key-secret">
            <span className="panel-kicker">Copy once</span>
            <strong>Your new MCP API key</strong>
            <code>{lastCreatedKey}</code>
            <button type="button" className="secondary-action compact-button" onClick={copySecret}>
              Copy key
            </button>
          </div>
        )}

        <div className="api-key-config glass-card">
          <span className="panel-kicker">MCP config</span>
          <pre>{configSnippet}</pre>
        </div>

        <div className="api-key-config glass-card">
          <span className="panel-kicker">MCP URL prompt</span>
          <pre>{urlPrompt}</pre>
        </div>

        <div className="api-key-list">
          {!signedIn ? (
            <div className="empty-state">
              <strong>Sign in first</strong>
              <span>Connect X to create an MCP API key for your wallet.</span>
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="empty-state">
              <strong>No keys yet</strong>
              <span>Create a key to connect this wallet to Claude, Cursor, or any MCP client.</span>
            </div>
          ) : (
            apiKeys.map((key) => (
              <div className="api-key-item" key={key.id}>
                <div>
                  <strong>{key.name}</strong>
                  <span>{key.prefix}...{key.last4} · created {formatDate(key.createdAt)}</span>
                  <small>{key.lastUsedAt ? `Last used ${formatDate(key.lastUsedAt)}` : "Not used yet"}</small>
                </div>
                <button type="button" className="secondary-action compact-button" onClick={() => revokeKey(key.id)}>
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
