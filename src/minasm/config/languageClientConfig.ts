import type { LanguageClientConfig } from "monaco-languageclient/lcwrapper";

const lspWorker = new Worker(new URL("../worker/minasm-server.ts", import.meta.url), {
  type: "module",
  name: "Minasm Server Regular",
});

export const asmLanguageClientConfig: LanguageClientConfig = {
  languageId: "minasm",
  clientOptions: {
    documentSelector: [
      { scheme: "file", language: "minasm" },
      { scheme: "builtin", language: "minasm" },
    ],
  },
  connection: {
    options: {
      $type: "WorkerDirect",
      worker: lspWorker,
    },
  },
};
