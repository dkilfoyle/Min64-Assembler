import type { ExtensionConfig } from "monaco-languageclient/vscodeApiWrapper";
import minminLanguageConfig from "./language-config.json?raw";
import minminTextmate from "../syntaxes/minmin.tmLanguage.json?raw";

const extensionFilesOrContents = new Map<string, string | URL>();
extensionFilesOrContents.set(`/minmin-configuration.json`, minminLanguageConfig);
extensionFilesOrContents.set(`/minmin-grammar.json`, minminTextmate);

// this will be injected into shared vscodeApiConfig
export const extensionConfig: ExtensionConfig = {
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
          configuration: `./minmin-configuration.json`,
        },
      ],
      grammars: [
        {
          language: "minmin",
          scopeName: "source.minmin",
          path: `./minmin-grammar.json`,
        },
      ],
    },
  },
  filesOrContents: extensionFilesOrContents,
};
