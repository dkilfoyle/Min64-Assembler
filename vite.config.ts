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
    // vscode is aliased to the codingame shim by monaco-languageclient
    // but Vite needs a hint for the bare specifier
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
