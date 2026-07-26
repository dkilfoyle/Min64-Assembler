import { MonacoEditorReactComp } from "@typefox/monaco-editor-react";
import * as vscode from "vscode";
import { configure, configurePostStart } from "./monaco/workbenchConfig";
import { initLanguageClients } from "./monaco/languageConfig";
import type { MinDocChangeNotification } from "./minmin/worker/minmin-server-start";
import { getWebviewContent } from "./emulator/webviewContent";
import { EmulatorWebviewPanel } from "./emulator/EmulatorWebviewPanel";
import type { AsmHexNotification } from "./minasm/worker/minasm-server-start";

const config = await configure(document.getElementById("root")!);

export default function App() {
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
          await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside });
        });

        minasm.onNotification("minasmlsp/hex", async (data: AsmHexNotification) => {
          EmulatorWebviewPanel.sendRunHex(data.hex);
        });

        vscode.commands.registerCommand("minasm-run", () => {
          minasm.sendNotification("app/minasm-compile", { uri: vscode.window.activeTextEditor?.document.uri.toString() });
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

        await vscode.commands.executeCommand("show-emulator");

        await configurePostStart(apiWrapper, config);
      }}
      onError={(e) => {
        console.error(e);
      }}
    />
  );
}
