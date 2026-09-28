import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the staff app forwards API calls to the backend, so the browser only
// talks to one address (this also makes GitHub Codespaces work with a single port).
const API = process.env.API_PROXY_TARGET || "http://localhost:8000";
const apiPaths = ["/auth", "/admin", "/kitchen", "/orders", "/me", "/restaurant", "/menu",
  "/delivery", "/driver", "/bookings", "/tables", "/payments", "/health"];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    allowedHosts: [".app.github.dev", "localhost"],
    proxy: {
      ...Object.fromEntries(apiPaths.map((p) => [p, { target: API, changeOrigin: true }])),
      "/ws": { target: API.replace(/^http/, "ws"), ws: true },
    },
  },
});
