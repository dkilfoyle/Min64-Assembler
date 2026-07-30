import type { ExtensionConfig } from "monaco-languageclient/vscodeApiWrapper";
import minasmLanguageConfig from "./language-config.json?raw";
import minasmTextmate from "../syntaxes/minasm.tmLanguage.json?raw";

const extensionFilesOrContents = new Map<string, string | URL>();
extensionFilesOrContents.set(`/minasm-configuration.json`, minasmLanguageConfig);
extensionFilesOrContents.set(`/minasm-grammar.json`, minasmTextmate);

export const minasmExtensionConfig: ExtensionConfig = {
  config: {
    name: "minasm-lang",
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
      commands: [
        {
          command: "minasm-compile",
          title: "Compile",
          icon: "$(gear)",
        },
        {
          command: "minasm-run",
          title: "Run",
          icon: "$(vm-running)",
        },
      ],
      menus: {
        "editor/title": [
          {
            when: "editorLangId == minasm",
            command: "minasm-compile",
            group: "navigation",
          },
          {
            when: "editorLangId == minasm",
            command: "minasm-run",
            group: "navigation",
          },
        ],
      },
    },
  },
  filesOrContents: extensionFilesOrContents,
};
