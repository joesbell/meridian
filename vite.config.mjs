import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createFeedMiddleware } from "./server/feedApi.mjs";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    watch: {
      ignored: ["**/.venv/**", "**/work/**"],
    },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [
    react(),
    {
      name: "radius-live-feed-api",
      configureServer(server) {
        server.middlewares.use(createFeedMiddleware());
      },
    },
  ],
});
