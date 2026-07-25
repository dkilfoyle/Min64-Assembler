import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import importMetaUrlPlugin from "@codingame/esbuild-import-meta-url-plugin";

export default defineConfig({
  plugins: [react()],
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
  },
  resolve: {
    alias: [],
    dedupe: ["vscode"],
  },
  optimizeDeps: {
    include: ["vscode-textmate"],
    esbuildOptions: {
      plugins: [importMetaUrlPlugin],
    },
  },
});
