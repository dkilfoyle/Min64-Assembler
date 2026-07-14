import { LogLevel } from "@codingame/monaco-vscode-api";
import type { LanguageClientConfig } from "monaco-languageclient/lcwrapper";

const lspWorker = new Worker(new URL("../worker/minasm-server.ts", import.meta.url), {
  type: "module",
  name: "Minasm Server Regular",
});

export const languageClientConfig: LanguageClientConfig = {
  languageId: "minasm",
  clientOptions: {
    documentSelector: ["minasm"],
  },
  connection: {
    options: {
      $type: "WorkerDirect",
      worker: lspWorker,
    },
  },
  logLevel: LogLevel.Off,
};
