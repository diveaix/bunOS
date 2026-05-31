import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4318,
    proxy: {
      "/api": "http://localhost:4317",
      "/auth": "http://localhost:4317",
      "/mcp": "http://localhost:4317",
      "/sse": "http://localhost:4317",
      "/messages": "http://localhost:4317",
      "/x": "http://localhost:4317",
      "/defi": "http://localhost:4317",
      "/airdrops": "http://localhost:4317"
    }
  },
  build: {
    outDir: "../public",
    emptyOutDir: true
  }
});
