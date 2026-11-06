import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// In dev, proxy API/WebSocket/OAuth to a locally running backend (uvicorn on :8000).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/auth": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
