import type { ExtensionConfig } from "monaco-languageclient/vscodeApiWrapper";
import minminLanguageConfig from "./language-config.json?raw";
import minminTextmate from "../syntaxes/minmin.tmLanguage.json?raw";

const extensionFilesOrContents = new Map<string, string | URL>();
extensionFilesOrContents.set(
  `/minmin-configuration.json`,
  minminLanguageConfig,
);
extensionFilesOrContents.set(`/minmin-grammar.json`, minminTextmate);

// this will be injected into shared vscodeApiConfig
export const minminExtensionConfig: ExtensionConfig = {
  config: {
    name: "minmin-lang",
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
      commands: [
        {
          command: "minmin-compile",
          title: "Compile",
          icon: "$(gear)",
        },
        // {
        //   command: "minmin-autocompile",
        //   title: "Toggle auto compile",
        //   icon: "$(sync)",
        // },
      ],
      menus: {
        "editor/title": [
          {
            when: "editorLangId == minmin",
            command: "minmin-compile",
            group: "navigation",
          },
          //   {
          //     when: "editorLangId == minmin",
          //     command: "minmin-autocompile",
          //   },
        ],
      },
    },
  },
  filesOrContents: extensionFilesOrContents,
};
