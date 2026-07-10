// import getKeybindingsServiceOverride from "@codingame/monaco-vscode-keybindings-service-override";
// import getLifecycleServiceOverride from "@codingame/monaco-vscode-lifecycle-service-override";
// import getLocalizationServiceOverride from "@codingame/monaco-vscode-localization-service-override";
import { createDefaultLocaleConfiguration } from "monaco-languageclient/vscodeApiLocales";
import { LogLevel } from "@codingame/monaco-vscode-api";
import { MessageTransports } from "vscode-languageclient";
import type { ExtensionConfig, MonacoVscodeApiConfig } from "monaco-languageclient/vscodeApiWrapper";
import type { LanguageClientConfig } from "monaco-languageclient/lcwrapper";
import { configureDefaultWorkerFactory } from "monaco-languageclient/workerFactory";
import type { CodeContent, EditorAppConfig } from "monaco-languageclient/editorApp";

// cannot be imported with assert as json contains comments
import minminLanguageConfig from "./language-config.json?raw";
import minminTextmate from "../syntaxes/minmin.tmLanguage.json?raw";

export const loadMinminWorkerRegular = () => {
  return new Worker(new URL("../worker/minmin-server.ts", import.meta.url), {
    type: "module",
    name: "Minmin Server Regular",
  });
};

export const createMinminMonacoConfig = (params: {
  languageServerId: string;
  codeContent: CodeContent;
  worker: Worker;
  messagePort?: MessagePort;
  messageTransports?: MessageTransports;
}): { extensionConfig: ExtensionConfig; languageClientConfig: LanguageClientConfig; editorAppConfig: EditorAppConfig } => {
  const extensionFilesOrContents = new Map<string, string | URL>();
  extensionFilesOrContents.set(`/${params.languageServerId}-minmin-configuration.json`, minminLanguageConfig);
  extensionFilesOrContents.set(`/${params.languageServerId}-minmin-grammar.json`, minminTextmate);

  const languageClientConfig: LanguageClientConfig = {
    languageId: "minmin",
    clientOptions: {
      documentSelector: ["minmin"],
    },
    connection: {
      options: {
        $type: "WorkerDirect",
        worker: params.worker,
        messagePort: params.messagePort,
      },
      messageTransports: params.messageTransports,
    },
    logLevel: LogLevel.Off,
  };

  // this will be injected into shared vscodeApiConfig
  const extensionConfig: ExtensionConfig = {
    config: {
      name: "minmin-example",
      publisher: "DK",
      version: "1.0.0",
      engines: {
        vscode: "*",
      },
      contributes: {
        languages: [
          {
            id: "minmin",
            extensions: [".min"],
            aliases: ["minmin", "Minmin"],
            configuration: `./${params.languageServerId}-minmin-configuration.json`,
          },
        ],
        grammars: [
          {
            language: "minmin",
            scopeName: "source.minmin",
            path: `./${params.languageServerId}-minmin-grammar.json`,
          },
        ],
      },
    },
    filesOrContents: extensionFilesOrContents,
  };

  const editorAppConfig: EditorAppConfig = {
    codeResources: {
      modified: params.codeContent,
    },
    logLevel: LogLevel.Debug,
  };

  return {
    editorAppConfig,
    extensionConfig,
    languageClientConfig,
  };
};
