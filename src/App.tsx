import { MonacoEditorReactComp } from "@typefox/monaco-editor-react";
import * as vscode from "vscode";
import { configure, configurePostStart } from "./monaco/workbenchConfig";
import { initLanguageClients } from "./monaco/languageConfig";
import type { MinDocChangeNotification } from "./minmin/worker/minmin-server-start";
import { getWebviewContent } from "./emulator/webviewContent";
import { EmulatorWebviewPanel } from "./emulator/EmulatorWebviewPanel";
import { runtime } from "./emulator/runtime";
import { useDocStore } from "./store/myStore";
import { AsmCompileRequest, type AsmCompileResult } from "./minasm/worker/api";
import "./debugger/debugger";

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
        const lcsManager = await initLanguageClients();
        const minlsp = lcsManager.getLanguageClient("minmin");
        const minasm = lcsManager.getLanguageClient("minasm");
        if (!minlsp) throw Error("No minlsp");
        if (!minasm) throw Error("No minasm");

        minlsp.onNotification("minminlsp/docChange", async (data: MinDocChangeNotification) => {
          const uri = vscode.Uri.file(data.uri.replace(".min", ".masm").replace("file:///", ""));
          const content = new TextEncoder().encode(data.asm);
          try {
            await vscode.workspace.fs.writeFile(uri, content);
          } catch (e) {
            console.error("write file error", e);
          }
          await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Active, preserveFocus: true });
        });

        vscode.commands.registerCommand("minasm-compile", async () => {
          const result = await minasm.sendRequest<AsmCompileResult>(AsmCompileRequest.method, {
            uri: vscode.window.activeTextEditor?.document.uri.toString(),
          });
          printOutputChannel(`Compiled ${result.uri} OK: machine code = ${result.hex.length} bytes`, true);
          addCompiledAsm(result);
        });

        vscode.commands.registerCommand("minasm-run", async () => {
          const uri = vscode.window.activeTextEditor?.document.uri.toString();
          if (!uri) return;
          if (!compiledAsm[uri]) {
            const result = await minasm.sendRequest<AsmCompileResult>(AsmCompileRequest.method, {
              uri: vscode.window.activeTextEditor?.document.uri.toString(),
            });
            addCompiledAsm(result);
            runtime.run({ runType: "run", pc: 0x100, hex: result.hex });
          }
        });

        vscode.commands.registerCommand("minmin-compile", () => {
          minlsp.sendNotification("app/minmin-compile", { uri: vscode.window.activeTextEditor?.document.uri.toString() });
        });
        vscode.commands.registerCommand("minmin-autocompile", () => {
          // TODO toggle autocompile by sending notification to minlsp
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
