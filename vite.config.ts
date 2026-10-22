import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: "autoUpdate",
    includeAssets: ["library-icon.svg"],
    manifest: {
      name: "Libra Library Management",
      short_name: "Libra",
      description: "Library collection and circulation management.",
      theme_color: "#f7f8fa",
      background_color: "#f7f8fa",
      display: "standalone",
      start_url: "/",
      icons: [
        { src: "/library-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      ],
    },
    workbox: {
      navigateFallback: "/index.html",
      globPatterns: ["**/*.{js,css,html,svg,png,jpg,jpeg,gif,webp,ico,woff2}"],
      runtimeCaching: [
        {
          urlPattern: ({ url }) => url.pathname.endsWith("/api/public/settings"),
          handler: "NetworkFirst",
          options: {
            cacheName: "public-library-settings",
            networkTimeoutSeconds: 3,
            expiration: { maxEntries: 1, maxAgeSeconds: 86_400 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          urlPattern: ({ request }) => request.destination === "image",
          handler: "CacheFirst",
          options: {
            cacheName: "library-images",
            expiration: { maxEntries: 60, maxAgeSeconds: 30 * 86_400 },
          },
        },
      ],
    },
  })],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/recharts")) return "charts";
          if (id.includes("node_modules/docx") || id.includes("node_modules/pdf-lib")) return "document-tools";
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) return "react-vendor";
        },
      },
    },
  },
});
