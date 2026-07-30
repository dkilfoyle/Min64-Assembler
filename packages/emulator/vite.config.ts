import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  logLevel: "error",
  plugins: [react()],
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
