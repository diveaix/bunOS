import { BrowserRouter, Routes, Route } from "react-router-dom";
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
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route element={<Layout />}>
              <Route path="/wallet" element={<Wallet />} />
              <Route path="/dashboard" element={<Wallet />} />
              <Route path="/terminal" element={<Terminal />} />
              <Route path="/mcp-guide" element={<McpGuide />} />
              <Route path="/api-keys" element={<ApiKeys />} />
            </Route>
          </Routes>
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  );
}
