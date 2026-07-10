import { LogLevel } from "@codingame/monaco-vscode-api";
import type { ExtensionConfig, MonacoVscodeApiConfig } from "monaco-languageclient/vscodeApiWrapper";
import { configureDefaultWorkerFactory } from "monaco-languageclient/workerFactory";

export const createMonacoApiConfig = (extensions: ExtensionConfig[]): MonacoVscodeApiConfig => ({
  $type: "extended",
  viewsConfig: {
    $type: "EditorService",
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
  extensions,
});
