import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputDir = join(root, ".vercel-legacy-redirect");
const destination = normalizeDestination(process.argv[2] || process.env.CANONICAL_FRONTEND_URL || "https://bunos.xyz");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await writeFile(join(outputDir, "package.json"), `${JSON.stringify({
  private: true,
  name: "bunos-legacy-redirect",
  version: "0.1.0"
}, null, 2)}\n`);

await writeFile(join(outputDir, "vercel.json"), `${JSON.stringify({
  version: 2,
  cleanUrls: true,
  trailingSlash: false,
  routes: [
    { src: "/", headers: { Location: destination }, status: 308 },
    { src: "/(.*)", headers: { Location: `${destination}/$1` }, status: 308 }
  ]
}, null, 2)}\n`);

console.log(`Prepared legacy redirect deployment in ${outputDir}`);
console.log(`Destination: ${destination}`);

function normalizeDestination(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text || !/^https?:\/\//i.test(text)) {
    throw new Error("Destination must be an absolute http(s) URL.");
  }
  return text;
}
