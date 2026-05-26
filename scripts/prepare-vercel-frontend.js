import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputDir = join(root, ".vercel-frontend");
const backendUrl = normalizeBackendUrl(process.argv[2] || process.env.BACKEND_URL || process.env.RAILWAY_PUBLIC_URL);

if (!backendUrl) {
  throw new Error("Backend URL is required. Usage: npm run deploy:frontend:prepare -- https://your-backend.up.railway.app");
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(join(root, "public"), outputDir, { recursive: true });

const mcpGuidePath = join(outputDir, "mcp.html");
if (existsSync(mcpGuidePath)) {
  await copyFile(mcpGuidePath, join(outputDir, "mcp-guide.html"));
  await rm(mcpGuidePath);
}

if (existsSync(join(root, "bunOS.svg"))) {
  await cp(join(root, "bunOS.svg"), join(outputDir, "bunOS.svg"));
}

await writeFile(join(outputDir, "package.json"), `${JSON.stringify({
  private: true,
  name: "bunos-frontend",
  version: "0.1.0"
}, null, 2)}\n`);

await writeFile(join(outputDir, "vercel.json"), `${JSON.stringify({
  version: 2,
  cleanUrls: true,
  trailingSlash: false,
  routes: [
    { src: "/api/(.*)", dest: `${backendUrl}/api/$1` },
    { src: "/auth/(.*)", dest: `${backendUrl}/auth/$1` },
    { src: "/mcp", dest: `${backendUrl}/mcp` },
    { src: "/mcp/sse", dest: `${backendUrl}/mcp/sse` },
    { src: "/mcp/messages", dest: `${backendUrl}/mcp/messages` },
    { src: "/sse", dest: `${backendUrl}/sse` },
    { src: "/messages", dest: `${backendUrl}/messages` },
    { src: "/x/(.*)", dest: `${backendUrl}/x/$1` },
    { src: "/defi/(.*)", dest: `${backendUrl}/defi/$1` },
    { src: "/terminal", dest: "/terminal.html" },
    { handle: "filesystem" }
  ]
}, null, 2)}\n`);

const indexPath = join(outputDir, "index.html");
const index = await readFile(indexPath, "utf8");
await writeFile(indexPath, index.replace(
  "</head>",
  `  <meta name="backend-origin" content="${escapeHtml(backendUrl)}" />\n  </head>`
));

console.log(`Prepared Vercel frontend in ${outputDir}`);
console.log(`Backend origin: ${backendUrl}`);

function normalizeBackendUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) {
    throw new Error("Backend URL must start with http:// or https://");
  }
  return text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
