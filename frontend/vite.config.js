import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";

export default defineConfig({
  plugins: [
    react(),

    legacy({
      targets: ["defaults", "Chrome >= 38", "Safari >= 9"],
      modernPolyfills: true,
      polyfills: true,
      renderLegacyChunks: true,
      additionalLegacyPolyfills: [
        "regenerator-runtime/runtime",
      ],
    }),
  ],

  build: {
    minify: "terser",
    cssTarget: "chrome38",
    sourcemap: false,
  },
});