import { config } from "./config.js";

export function publicUrl(path, { host, protocol = "http" } = {}) {
  const cleanPath = String(path || "/").startsWith("/") ? String(path || "/") : `/${path}`;
  const base = canonicalBaseUrl() || fallbackBaseUrlForHost(host);
  if (base) {
    return `${base}${cleanPath}`;
  }
  return host ? `${protocol}://${host}${cleanPath}` : null;
}

export function canonicalBaseUrl() {
  return String(
    process.env.PUBLIC_APP_BASE_URL
      || process.env.CANONICAL_FRONTEND_URL
      || process.env.FRONTEND_PUBLIC_URL
      || (process.env.APP_BASE_URL ? config.appBaseUrl : "")
      || ""
  ).trim().replace(/\/+$/, "");
}

function fallbackBaseUrlForHost(host) {
  const normalized = String(host || "").toLowerCase();
  if (
    normalized.endsWith(".up.railway.app")
    || normalized === "vercel-frontend-rho-woad.vercel.app"
    || normalized === "www.bunos.xyz"
  ) {
    return "https://bunos.xyz";
  }
  return "";
}
