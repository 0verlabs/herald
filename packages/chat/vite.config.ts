import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import svgr from "vite-plugin-svgr";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    build: {
      rolldownOptions: {
        checks: {
          invalidAnnotation: false,
        },
      },
    },
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
        "/api": {
          target: env.VITE_AGENT_URL,
          changeOrigin: true,
          // `@hrld/agent` serves the chat stream at its root.
          rewrite: (path) => path.replace(/^\/api/, "") || "/",
        },
      },
    },
  };
});
