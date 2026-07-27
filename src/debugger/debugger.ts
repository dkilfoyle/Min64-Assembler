import { ExtensionHostKind, registerExtension } from "@codingame/monaco-vscode-api/extensions";
import * as vscode from "vscode";
import { MinAsmDebugSession } from "./MinAsmDebugSession.ts";
import type { DebugConfiguration, WorkspaceFolder } from "vscode";
import { compiledDocs } from "./MinAsmRuntime.ts";

let outputChannel: vscode.OutputChannel;

export const printOutputChannel = (content: string, reveal = false) => {
  outputChannel.appendLine(content);
  if (reveal) outputChannel.show(true);
};

const { getApi, registerFileUrl } = registerExtension(
  {
    name: "debugger",
    publisher: "codingame",
    version: "1.0.0",
    engines: {
      vscode: "*",
    },
    // A browser field is mandatory for the extension to be flagged as `web`
    browser: "extension.js",
    contributes: {
      debuggers: [
        {
          type: "minasm",
          label: "Minimal-64x4",
          languages: ["minasm"],
          configurationAttributes: {
            launch: {
              required: ["program"],
              properties: {
                program: { type: "string", description: "Path to asm source file", default: "${workspaceFolder}/ummmm" },
                stopOnEntry: { type: "boolean", description: "Stop after launch", default: true },
                trace: { type: "boolean", description: "Enable logging of debug adapter protocol", default: true },
              },
            },
          },
        },
      ],
      breakpoints: [
        {
          language: "minasm",
        },
      ],
      menus: {
        "editor/title/run": [
          {
            command: "extension.minasm-debug.runEditorContents",
            when: "resourceLangId == minasm",
            group: "navigation@1",
          },
        ],
        commandPalette: [
          {
            command: "extension.minasm-debug.runEditorContents",
            when: "resourceLangId == minasm",
          },
        ],
        "debug/variables/context": [
          {
            command: "extension.mock-debug.toggleFormatting",
            when: "debugType == 'mock' && debugProtocolVariableMenuContext == 'simple'",
          },
        ],
      },
      commands: [
        {
          command: "extension.minasm-debug.runEditorContents",
          title: "Run File",
          category: "Asm Debug",
          enablement: "!inDebugMode",
          icon: "$(play)",
        },
      ],
    },
  },
  ExtensionHostKind.LocalProcess,
);

registerFileUrl("./extension.js", "data:text/javascript;base64," + window.btoa("// nothing"));

void getApi().then(async (debuggerVscodeApi) => {
  outputChannel = vscode.window.createOutputChannel("Minimal Emulator");

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  debuggerVscodeApi.commands.registerCommand("extension.minasm-debug.runEditorContents", (_resource: vscode.Uri) => {
    let targetResource; // = resource;
    let fn: string | undefined;
    if (!targetResource && debuggerVscodeApi.window.activeTextEditor) {
      targetResource = debuggerVscodeApi.window.activeTextEditor.document.uri;
      fn = debuggerVscodeApi.window.activeTextEditor.document.uri.toString();
    }
    if (targetResource && fn) {
      debuggerVscodeApi.debug.startDebugging(
        undefined,
        {
          type: "minasm",
          name: "Run File",
          request: "launch",
          program: targetResource.toString(),
          // linkerInfo: compiledDocs[fn].linkerInfo,
          stopOnEntry: false,
        },
        { noDebug: true },
      );
    }
  });

  debuggerVscodeApi.debug.registerDebugConfigurationProvider("minasm", {
    resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration) {
      const editor = debuggerVscodeApi.window.activeTextEditor;
      if (!(editor && editor.document.languageId == "asm")) return undefined;
      return {
        type: "minasm",
        name: "Launch",
        request: "launch",
        program: config.program || editor?.document.uri.toString(),
        stopOnEntry: config.stopOnEntry || false,
        // linkerInfo: compiledDocs[editor?.document.uri.toString()].linkerInfo,
      };
    },
  });

  debuggerVscodeApi.debug.registerDebugAdapterDescriptorFactory("minasm", {
    async createDebugAdapterDescriptor() {
      return new debuggerVscodeApi.DebugAdapterInlineImplementation(new MinAsmDebugSession());
    },
  });
});
