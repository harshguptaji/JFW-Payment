import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";

export default defineConfig({
  plugins: [
    react(),

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

  build: {
    target: "es2015",
  },
});