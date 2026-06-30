// import getKeybindingsServiceOverride from "@codingame/monaco-vscode-keybindings-service-override";
// import getLifecycleServiceOverride from "@codingame/monaco-vscode-lifecycle-service-override";
// import getLocalizationServiceOverride from "@codingame/monaco-vscode-localization-service-override";
import { createDefaultLocaleConfiguration } from "monaco-languageclient/vscodeApiLocales";
import { LogLevel } from "@codingame/monaco-vscode-api";
import { MessageTransports } from "vscode-languageclient";
import type { MonacoVscodeApiConfig } from "monaco-languageclient/vscodeApiWrapper";
import type { LanguageClientConfig } from "monaco-languageclient/lcwrapper";
import { configureDefaultWorkerFactory } from "monaco-languageclient/workerFactory";
import type { CodeContent, EditorAppConfig } from "monaco-languageclient/editorApp";

// cannot be imported with assert as json contains comments
import minasmLanguageConfig from "./language-config.json?raw";
import minasmTextmate from "../syntaxes/minasm.tmLanguage.json?raw";

export const loadMinasmWorkerRegular = () => {
  return new Worker(new URL("../worker/minasm-server.ts", import.meta.url), {
    type: "module",
    name: "Minasm Server Regular",
  });
};

export const createMinasmMonacoConfig = (params: {
  languageServerId: string;
  codeContent: CodeContent;
  worker: Worker;
  messagePort?: MessagePort;
  messageTransports?: MessageTransports;
  htmlContainer?: HTMLElement;
}): { vscodeApiConfig: MonacoVscodeApiConfig; languageClientConfig: LanguageClientConfig; editorAppConfig: EditorAppConfig } => {
  const extensionFilesOrContents = new Map<string, string | URL>();
  extensionFilesOrContents.set(`/${params.languageServerId}-minasm-configuration.json`, minasmLanguageConfig);
  extensionFilesOrContents.set(`/${params.languageServerId}-minasm-grammar.json`, minasmTextmate);

  const languageClientConfig: LanguageClientConfig = {
    languageId: "minasm",
    clientOptions: {
      documentSelector: ["minasm"],
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

  const vscodeApiConfig: MonacoVscodeApiConfig = {
    $type: "extended",
    viewsConfig: {
      $type: "EditorService",
      htmlContainer: params.htmlContainer,
    },
    logLevel: LogLevel.Off,
    // serviceOverrides: {
    //   ...getKeybindingsServiceOverride(),
    //   ...getLifecycleServiceOverride(),
    //   ...getLocalizationServiceOverride(createDefaultLocaleConfiguration()),
    // },
    monacoWorkerFactory: configureDefaultWorkerFactory,
    userConfiguration: {
      json: JSON.stringify({
        "workbench.colorTheme": "Default Dark Modern",
        "editor.guides.bracketPairsHorizontal": "active",
        "editor.wordBasedSuggestions": "off",
        "editor.experimental.asyncTokenization": true,
      }),
    },
    extensions: [
      {
        config: {
          name: "minasm-example",
          publisher: "DK",
          version: "1.0.0",
          engines: {
            vscode: "*",
          },
          contributes: {
            languages: [
              {
                id: "minasm",
                extensions: [".minasm"],
                aliases: ["minasm", "Minasm"],
                configuration: `./${params.languageServerId}-minasm-configuration.json`,
              },
            ],
            grammars: [
              {
                language: "minasm",
                scopeName: "source.minasm",
                path: `./${params.languageServerId}-minasm-grammar.json`,
              },
            ],
          },
        },
        filesOrContents: extensionFilesOrContents,
      },
    ],
  };

  const editorAppConfig: EditorAppConfig = {
    codeResources: {
      modified: params.codeContent,
    },
    logLevel: LogLevel.Debug,
  };

  return {
    editorAppConfig,
    vscodeApiConfig,
    languageClientConfig,
  };
};
