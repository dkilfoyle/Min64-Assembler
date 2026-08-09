import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact()],
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
