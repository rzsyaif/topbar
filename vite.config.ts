import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and doesn't want Vite clearing its logs.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Don't watch the Rust side: cargo locks files in src-tauri/target while
    // building, which crashes Vite's watcher on Windows (EBUSY).
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "es2021" },
});
