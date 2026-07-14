import type { ExtensionConfig } from "monaco-languageclient/vscodeApiWrapper";
import minasmLanguageConfig from "./language-config.json?raw";
import minasmTextmate from "../syntaxes/minasm.tmLanguage.json?raw";

const extensionFilesOrContents = new Map<string, string | URL>();
extensionFilesOrContents.set(`/minasm-configuration.json`, minasmLanguageConfig);
extensionFilesOrContents.set(`/minasm-grammar.json`, minasmTextmate);

export const extensionConfig: ExtensionConfig = {
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
          extensions: [".masm"],
          aliases: ["minasm", "Minasm"],
          configuration: `./minasm-configuration.json`,
        },
      ],
      grammars: [
        {
          language: "minasm",
          scopeName: "source.minasm",
          path: `./minasm-grammar.json`,
        },
      ],
    },
  },
  filesOrContents: extensionFilesOrContents,
};
