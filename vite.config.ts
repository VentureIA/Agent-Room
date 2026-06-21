import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src/ui",
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true
  },
  server: {
    port: 4318,
    proxy: {
      "/api": "http://localhost:4317",
      "/ws": {
        target: "ws://localhost:4317",
        ws: true
      }
    }
  }
});
