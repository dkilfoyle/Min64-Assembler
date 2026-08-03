import type { LanguageClientConfig } from "monaco-languageclient/lcwrapper";

const lspWorker = new Worker(new URL("../worker/minmin-server.ts", import.meta.url), {
  type: "module",
  name: "Minmin Server Regular",
});

export const minLanguageClientConfig: LanguageClientConfig = {
  languageId: "minmin",
  clientOptions: {
    documentSelector: [
      { scheme: "file", language: "minmin" },
      { scheme: "builtin", language: "minmin" },
    ],
  },
  connection: {
    options: {
      $type: "WorkerDirect",
      worker: lspWorker,
    },
  },
};
