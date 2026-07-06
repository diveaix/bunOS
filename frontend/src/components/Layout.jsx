import { NavLink, Outlet, Link } from "react-router-dom";
import BrandLogo from "./BrandLogo";
import { useSession } from "../hooks/useSession";
import { useToast } from "../hooks/useToast";

export default function Layout() {
  const { logout, currentHandle } = useSession();
  const notify = useToast();

  const handleLogout = async () => {
    await logout();
    notify("Logged out");
  };

  return (
    <div className="page-shell">
      <header className="top-bar" aria-label="bunOS navigation">
        <Link to="/" className="brand-lockup" style={{ padding: "4px 6px" }}>
          <BrandLogo size={36} />
          <div>
            <strong>bunOS</strong>
          </div>
        </Link>

        <nav className="top-nav" aria-label="Main navigation">
          <NavLink to="/wallet" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
            Assets
          </NavLink>
          <NavLink to="/terminal" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            <span className="terminal-nav-glyph" aria-hidden="true">&gt;_</span>
            Terminal
          </NavLink>
          <NavLink to="/mcp-guide" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            </svg>
            MCP Guide
          </NavLink>
          <NavLink to="/api-keys" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 2l-2 2" /><path d="M15 8l-7 7" />
              <circle cx="7.5" cy="16.5" r="5.5" />
              <path d="M17 6l1 1" /><path d="M19 4l1 1" />
            </svg>
            API Keys
          </NavLink>
        </nav>

        {currentHandle && (
          <button type="button" className="ghost-button danger-button" onClick={handleLogout}>
            Logout
          </button>
        )}
      </header>

      <Outlet />
    </div>
  );
}
