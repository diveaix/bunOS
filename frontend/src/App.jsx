import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Component, useEffect } from "react";
import { SessionProvider } from "./hooks/useSession";
import { ToastProvider } from "./hooks/useToast";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import Wallet from "./pages/Wallet";
import Terminal from "./pages/Terminal";
import McpGuide from "./pages/McpGuide";
import ApiKeys from "./pages/ApiKeys";

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <SessionProvider>
          <ToastProvider>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/wallet/auth/x/callback" element={<XCallbackRescue />} />
              <Route path="/terminal" element={<Terminal />} />
              <Route element={<Layout />}>
                <Route path="/wallet" element={<Wallet />} />
                <Route path="/dashboard" element={<Wallet />} />
                <Route path="/mcp-guide" element={<McpGuide />} />
                <Route path="/api-keys" element={<ApiKeys />} />
              </Route>
              <Route path="*" element={<Landing />} />
            </Routes>
          </ToastProvider>
        </SessionProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}

function XCallbackRescue() {
  useEffect(() => {
    window.location.replace(`/auth/x/callback${window.location.search || ""}`);
  }, []);

  return (
    <main className="wallet-main single-column">
      <section className="page-section">
        <div className="empty-state">
          <strong>Finishing X sign in</strong>
          <span>Sending the OAuth callback to the bunOS backend...</span>
        </div>
      </section>
    </main>
  );
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("bunOS frontend crashed:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="wallet-main single-column">
        <section className="page-section">
          <div className="empty-state">
            <strong>Something went wrong loading this page.</strong>
            <span>Refresh once. If you just signed in with X, start the sign-in again.</span>
            <button type="button" className="primary-action" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </section>
      </main>
    );
  }
}
