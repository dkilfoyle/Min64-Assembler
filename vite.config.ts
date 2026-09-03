import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import importMetaUrlPlugin from "@codingame/esbuild-import-meta-url-plugin";
import vsixPlugin from "@codingame/monaco-vscode-rollup-vsix-plugin";

export default defineConfig({
  plugins: [react(), vsixPlugin()],
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
    rolldownOptions: {
      plugins: [importMetaUrlPlugin],
    },
  },
});
