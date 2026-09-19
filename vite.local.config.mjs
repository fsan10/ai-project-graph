import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nativeGraphPlugin } from "./server/native-graph-plugin.mjs";
export default defineConfig({
  plugins: [react(), nativeGraphPlugin()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: { outDir: "dist-local", rollupOptions: { input: "index.html" } },
});
