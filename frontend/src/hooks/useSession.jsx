import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchJson, post, normalizeHandle, isLiveWallet } from "../api";

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [config, setConfig] = useState({
    providerMode: "mock",
    settlementRails: [],
    circle: {},
    defi: {},
    x: {},
  });
  const [currentHandle, setCurrentHandle] = useState(
    () => new URLSearchParams(location.search).get("handle") || localStorage.getItem("arcpay:handle") || ""
  );
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [appConfig, sessionData, walletData] = await Promise.all([
        fetchJson("/api/config"),
        fetchJson("/api/session"),
        fetchJson("/api/wallets"),
      ]);

      setConfig(appConfig);
      setSession(sessionData.session);
      setWallets(walletData.wallets || []);

      const queryParams = new URLSearchParams(location.search);
      const explicitHandle = queryParams.has("handle");
      const loggedOut = localStorage.getItem("arcpay:loggedOut") === "1" && !explicitHandle && !sessionData.session?.handle;
      const realMode = appConfig.providerMode === "real";
      const sessionHandle = normalizeHandle(sessionData.session?.handle || "");
      const allWallets = walletData.wallets || [];

      let handle = currentHandle;

      if (loggedOut) {
        handle = "";
      } else if (realMode && !sessionHandle && !explicitHandle) {
        handle = "";
      } else if (!handle || !allWallets.some((w) => w.handle === handle)) {
        if (sessionHandle && sessionHandle !== "@") {
          handle = sessionHandle;
        } else if (!realMode) {
          const live = allWallets.find(isLiveWallet);
          handle = live?.handle || allWallets.find((w) => w.onboarded)?.handle || allWallets[0]?.handle || "@sara";
        }
      }

      if (handle) {
        localStorage.setItem("arcpay:handle", handle);
        localStorage.removeItem("arcpay:loggedOut");
      } else if (realMode) {
        localStorage.removeItem("arcpay:handle");
      }

      setCurrentHandle(handle);
    } catch (err) {
      console.error("Session refresh failed:", err);
    } finally {
      setLoading(false);
    }
  }, [currentHandle]);

  useEffect(() => {
    refresh();
  }, []);

  const login = useCallback(async (handle) => {
    if (config.x?.authMode === "real") {
      const started = await post("/api/auth/x/start", { returnTo: location.pathname });
      window.location.href = started.authUrl;
      return;
    }
    const h = normalizeHandle(handle || "@demo");
    await post("/api/auth/x/mock", { handle: h });
    setCurrentHandle(h);
    localStorage.setItem("arcpay:handle", h);
    localStorage.removeItem("arcpay:loggedOut");
    await refresh();
  }, [config, refresh]);

  const logout = useCallback(async () => {
    await post("/api/auth/logout", {}).catch(() => null);
    localStorage.removeItem("arcpay:handle");
    localStorage.setItem("arcpay:loggedOut", "1");
    setSession(null);
    setCurrentHandle("");
  }, []);

  const switchHandle = useCallback((handle) => {
    setCurrentHandle(handle);
    localStorage.setItem("arcpay:handle", handle);
  }, []);

  const upsertWallet = useCallback((wallet) => {
    setWallets((prev) => {
      const idx = prev.findIndex((w) => w.handle === wallet.handle);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = wallet;
        return next;
      }
      return [...prev, wallet];
    });
  }, []);

  return (
    <SessionContext.Provider
      value={{
        session,
        config,
        currentHandle,
        wallets,
        loading,
        login,
        logout,
        refresh,
        switchHandle,
        upsertWallet,
        setWallets,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
