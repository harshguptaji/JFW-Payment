import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";

export default defineConfig({
  plugins: [
    react(),

    legacy({
      targets: [
        "Chrome >= 38",
        "Safari >= 9",
        "Firefox >= 45",
        "Samsung >= 4",
      ],

      modernPolyfills: true,
      polyfills: true,
      renderLegacyChunks: true,
      renderModernChunks: true,

      additionalLegacyPolyfills: [
        "regenerator-runtime/runtime",
        "abortcontroller-polyfill/dist/abortcontroller-polyfill-only",
      ],
    }),
  ],

  build: {
    minify: "terser",
    cssTarget: "chrome38",
    sourcemap: false,
  },
});