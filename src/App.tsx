import { useCallback, useState } from "react";
import { MonacoEditorReactComp } from "@typefox/monaco-editor-react";
import { BrowserMessageReader, BrowserMessageWriter } from "vscode-languageclient/browser";
import { LogLevel } from "@codingame/monaco-vscode-api";
import { ConsoleLogger } from "@codingame/monaco-vscode-log-service-override";
import { createMinasmMonacoConfig, loadMinasmWorkerRegular } from "./minasm/config/minasmConfig";
import { createMinminMonacoConfig, loadMinminWorkerRegular } from "./minmin/config/minminConfig";
import "./App.css";
import type { EditorApp } from "monaco-languageclient/editorApp";
import type { LanguageClientManager } from "monaco-languageclient/lcwrapper";
import { createMonacoApiConfig } from "./MonacoApiConfig";

// import masmCode from "../minimal/asm/os.asm?raw";
const masmCode = `
; hello
MIW 10, 0xff
`;

import minCode from "./minmin/examples/compileme.min?raw";

// const reader = new BrowserMessageReader(minAsmWorker);
// const writer = new BrowserMessageWriter(minAsmWorker);
// reader.listen((message) => {
//   logger.info("Received message from worker:", message);
// });

const logger = new ConsoleLogger(LogLevel.Off);

// ── Component ─────────────────────────────────────────────────────────────────
type Status = "loading" | "ready" | "error";

const minAsmMonacoConfig = createMinasmMonacoConfig({
  languageServerId: "react-masm",
  codeContent: {
    text: masmCode.replaceAll(`"\\"`, `"\\\\"`),
    uri: "/workspace/example.masm",
  },
  worker: loadMinasmWorkerRegular(),
  // messageTransports: { reader, writer },
});

const minMinMonacoConfig = createMinminMonacoConfig({
  languageServerId: "react-min",
  codeContent: {
    text: minCode,
    uri: "/workspace/example.min",
  },
  worker: loadMinminWorkerRegular(),
  // messageTransports: { reader, writer },
});

const vscodeApiConfig = createMonacoApiConfig([minAsmMonacoConfig.extensionConfig, minMinMonacoConfig.extensionConfig]);

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const handleEditorStartDone = useCallback((editorApp?: EditorApp) => {
    setStatus("ready");
  }, []);

  const handleLCStartDone = useCallback((lcsManager: LanguageClientManager) => {
    setStatus("ready");
  }, []);

  const handleError = useCallback((err: Error) => {
    console.error("[6502 IDE]", err);
    setStatus("error");
    setErrorMsg(err.message);
  }, []);

  return (
    <div className="ide-root">
      <header className="ide-header">
        <span className="ide-chip">Min64x4</span>
        <h1>Assembly IDE</h1>
        <span className={`ide-status ${status}`}>
          {status === "loading" && "⏳ Starting language server…"}
          {status === "ready" && "✓ LSP ready"}
          {status === "error" && `✗ ${errorMsg}`}
        </span>
        <span className="ide-sub">Langium · Monaco · LSP</span>
      </header>

      <main className="ide-main">
        <div style={{ display: "flex", height: "100%" }}>
          <MonacoEditorReactComp
            style={{ height: "100%", width: "100%" }}
            vscodeApiConfig={vscodeApiConfig}
            editorAppConfig={minMinMonacoConfig.editorAppConfig}
            languageClientConfig={minMinMonacoConfig.languageClientConfig}
            onEditorStartDone={handleEditorStartDone}
            onLanguageClientsStartDone={handleLCStartDone}
            onError={handleError}
          />
          <MonacoEditorReactComp
            style={{ height: "100%", width: "100%" }}
            vscodeApiConfig={vscodeApiConfig}
            editorAppConfig={minAsmMonacoConfig.editorAppConfig}
            languageClientConfig={minAsmMonacoConfig.languageClientConfig}
            onEditorStartDone={handleEditorStartDone}
            onLanguageClientsStartDone={handleLCStartDone}
            onError={handleError}
          />
        </div>
      </main>
    </div>
  );
}
