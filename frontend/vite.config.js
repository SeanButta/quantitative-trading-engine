import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: process.env.PORT ? parseInt(process.env.PORT) : undefined,
    proxy: {
      "/api": {
        target: "http://localhost:8001",
        rewrite: (path) => path.replace(/^\/api/, ""),
        changeOrigin: true,
      },
    },
  },
});
