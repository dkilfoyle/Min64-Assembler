import { MonacoEditorReactComp } from "@typefox/monaco-editor-react";
import * as vscode from "vscode";
import { configure, configurePostStart } from "./monaco/workbenchConfig";
import { initLanguageClients } from "./monaco/languageConfig";
import { EmulatorWebviewPanel } from "./emulator/EmulatorWebviewPanel";
import { runtime } from "./emulator/runtime";
import { useDocStore } from "./store/myStore";
import { AsmCompileRequest, type AsmCompileResult } from "./minasm/worker/api";
import "./debugger/debugger";
import { MinCompileRequest, type MinCompileResult } from "./minmin/worker/api";

const config = await configure(document.getElementById("root")!);

let outputChannel: vscode.OutputChannel;
export const printOutputChannel = (content: string, reveal = false) => {
  outputChannel.appendLine(content);
  if (reveal) outputChannel.show(true);
};

export default function App() {
  const addCompiledAsm = useDocStore((state) => state.addCompiledAsm);
  const compiledAsm = useDocStore((state) => state.compiledAsm);
  return (
    <MonacoEditorReactComp
      vscodeApiConfig={config.vscodeApiConfig}
      onVscodeApiInitDone={async (apiWrapper) => {
        debugger;
        const lcsManager = await initLanguageClients();
        const minmin = lcsManager.getLanguageClient("minmin");
        const minasm = lcsManager.getLanguageClient("minasm");
        if (!minmin) throw Error("No minmin");
        if (!minasm) throw Error("No minasm");

        // minmin.onNotification(
        //   "minminlsp/docChange",
        //   async (data: MinDocChangeNotification) => {
        //     const uri = vscode.Uri.file(
        //       data.uri.replace("file:///", "").replace(".min", ".asm"),
        //     );
        //     const content = new TextEncoder().encode(data.asm);
        //     try {
        //       await vscode.workspace.fs.writeFile(uri, content);
        //     } catch (e) {
        //       console.error("write file error", e);
        //     }
        //     await vscode.window.showTextDocument(uri, {
        //       viewColumn: vscode.ViewColumn.Beside,
        //       preserveFocus: true,
        //     });
        //   },
        // );

        vscode.commands.registerCommand("minmin-compile", async () => {
          console.log("minmin-compile command called");
          const result = await minmin.sendRequest<MinCompileResult>(
            MinCompileRequest.method,
            {
              uri: vscode.window.activeTextEditor?.document.uri.toString(),
            },
          );
          if (result.status == "ok") {
            const content = new TextEncoder().encode(result.asm);
            const resulturi = vscode.Uri.parse(
              result.uri.toString().replace(".min", ".asm"),
            );
            try {
              await vscode.workspace.fs.writeFile(resulturi, content);
            } catch (e) {
              console.error("write file error", e);
            }
            printOutputChannel(
              `Compiled ${result.uri.toString()} OK: ${result.asm.split("\n").length} lines (${resulturi})`,
              true,
            );
          } else {
            printOutputChannel(
              `Compile ${result.uri.toString()} ERROR: ${result.errors.join(
                "\n",
              )}`,
              true,
            );
          }
        });

        vscode.commands.registerCommand("minasm-compile", async () => {
          const result = await minasm.sendRequest<AsmCompileResult>(
            AsmCompileRequest.method,
            {
              uri: vscode.window.activeTextEditor?.document.uri.toString(),
            },
          );
          const content = new TextEncoder().encode(result.hex);
          const hexuri = vscode.Uri.parse(
            result.uri.toString().replace(".asm", ".hex"),
          );
          try {
            await vscode.workspace.fs.writeFile(hexuri, content);
          } catch (e) {
            console.error("write file error", e);
          }
          printOutputChannel(
            `Compiled ${result.uri.toString()} OK: hex output = ${result.hex.length} bytes (${hexuri})`,
            true,
          );
          addCompiledAsm(result);
        });

        vscode.commands.registerCommand("minasm-run", async () => {
          const uri = vscode.window.activeTextEditor?.document.uri.toString();
          if (!uri) return;
          if (!compiledAsm[uri]) {
            const result = await minasm.sendRequest<AsmCompileResult>(
              AsmCompileRequest.method,
              {
                uri: vscode.window.activeTextEditor?.document.uri.toString(),
              },
            );
            addCompiledAsm(result);

            runtime.run({ runType: "run", pc: 0x100, hex: result.hex });
          }
        });

        vscode.commands.registerCommand("show-emulator", () => {
          EmulatorWebviewPanel.render();
        });

        outputChannel = vscode.window.createOutputChannel("Minimal Emulator");

        await vscode.commands.executeCommand("show-emulator");

        await configurePostStart(apiWrapper, config);
      }}
      onError={(e) => {
        console.error(e);
      }}
    />
  );
}
