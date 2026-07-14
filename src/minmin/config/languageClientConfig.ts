import { LogLevel } from "@codingame/monaco-vscode-api";
import type { LanguageClientConfig } from "monaco-languageclient/lcwrapper";

const lspWorker = new Worker(new URL("../worker/minmin-server.ts", import.meta.url), {
  type: "module",
  name: "Minmin Server Regular",
});

export const languageClientConfig: LanguageClientConfig = {
  languageId: "minmin",
  clientOptions: {
    documentSelector: ["minmin"],
  },
  connection: {
    options: {
      $type: "WorkerDirect",
      worker: lspWorker,
    },
  },
  logLevel: LogLevel.Off,
};
