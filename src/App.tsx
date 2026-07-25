import { MonacoEditorReactComp } from "@typefox/monaco-editor-react";
import * as vscode from "vscode";
import { configure, configurePostStart } from "./monaco/workbenchConfig";
import { initLanguageClients } from "./monaco/languageConfig";
import type { MinDocChangeNotification } from "./minmin/worker/minmin-server-start";

const config = await configure(document.getElementById("root")!);

export default function App() {
  return (
    <MonacoEditorReactComp
      vscodeApiConfig={config.vscodeApiConfig}
      onVscodeApiInitDone={async (apiWrapper) => {
        const lcsManager = await initLanguageClients();
        const minlsp = lcsManager.getLanguageClient("minmin");
        if (!minlsp) throw Error("No minlsp");
        minlsp.onNotification("minlsp/docChange", async (data: MinDocChangeNotification) => {
          const uri = vscode.Uri.file(data.uri.replace(".min", ".masm").replace("file:///", ""));
          const content = new TextEncoder().encode(data.asm);
          try {
            await vscode.workspace.fs.writeFile(uri, content);
          } catch (e) {
            console.error("write file error", e);
          }
        });

        vscode.commands.registerCommand("minmin-compile", () => {
          minlsp.sendNotification("app/minmin-compile", { uri: vscode.window.activeTextEditor?.document.uri.toString() });
        });
        vscode.commands.registerCommand("minmin-autocompile", () => {
          // TODO toggle autocompile by sending notification to minlsp
        });

        await configurePostStart(apiWrapper, config);
      }}
      onError={(e) => {
        console.error(e);
      }}
    />
  );
}
