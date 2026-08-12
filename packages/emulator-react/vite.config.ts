import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  logLevel: "error",
  plugins: [react()],
  server: {
    host: "127.0.0.1", // Forces explicit IPv4 local address
    port: 8080, // Sets your desired port
  },
  build: {
    outDir: "../../public",
    rollupOptions: {
      output: {
        entryFileNames: `emulator.js`,
        chunkFileNames: `emulator.js`,
        assetFileNames: `emulator.[ext]`,
      },
    },
  },
});
