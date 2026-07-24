import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    svgr(),
  ],
  server: {
    proxy: {
      // The agent worker (`wrangler dev` in packages/agent, default port).
      "/api": {
        target: "http://localhost:8787",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
