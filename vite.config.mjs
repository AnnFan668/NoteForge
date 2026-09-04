import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { codexGenerateMiddleware } from "./server/codex/api.mjs";

function localGenerationApiPlugin() {
  return {
    name: "local-generation-api",
    configureServer(server) {
      server.middlewares.use(codexGenerateMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(codexGenerateMiddleware());
    },
  };
}

export default defineConfig({
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [localGenerationApiPlugin(), react()],
});
