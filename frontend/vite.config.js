import { defineConfig } from "vite";
import legacy from "@vitejs/plugin-legacy";

export default defineConfig({
  plugins: [
    legacy({
      targets: [
        "Chrome >= 49",
        "Safari >= 10",
        "Firefox >= 52",
      ],
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
  ],
});