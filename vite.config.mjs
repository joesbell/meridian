import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
    // 前后端分离：/api/* 请求代理到独立的后端服务（npm run server，端口 4173）
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.PORT || 4173}`,
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ["**/.venv/**", "**/work/**", "**/data/**"],
    },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [
    react(),
  ],
});
