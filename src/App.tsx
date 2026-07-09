import { useCallback, useState } from "react";
import { MonacoEditorReactComp } from "@typefox/monaco-editor-react";
import { BrowserMessageReader, BrowserMessageWriter } from "vscode-languageclient/browser";
import { LogLevel } from "@codingame/monaco-vscode-api";
import { ConsoleLogger } from "@codingame/monaco-vscode-log-service-override";
import { createMinasmMonacoConfig, loadMinasmWorkerRegular } from "./minasm/config/minasmConfig";
import "./App.css";

// import sourceCode from "../minimal/asm/os.asm?raw";
const sourceCode = `
; hello
MIW 10, 0xff
`;

const worker = loadMinasmWorkerRegular();
const reader = new BrowserMessageReader(worker);
const writer = new BrowserMessageWriter(worker);
const logger = new ConsoleLogger(LogLevel.Off);
reader.listen((message) => {
  logger.info("Received message from worker:", message);
});

// ── Component ─────────────────────────────────────────────────────────────────
type Status = "loading" | "ready" | "error";

const monacoConfig = createMinasmMonacoConfig({
  languageServerId: "react",
  codeContent: {
    text: sourceCode.replaceAll(`"\\"`, `"\\\\"`),
    uri: "/workspace/example.minasm",
  },
  worker,
  messageTransports: { reader, writer },
});

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const handleEditorStartDone = useCallback(() => {
    setStatus("ready");
  }, []);

  const handleLCStartDone = useCallback(() => {
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
        <MonacoEditorReactComp
          style={{ height: "100%", width: "100%" }}
          vscodeApiConfig={monacoConfig.vscodeApiConfig}
          editorAppConfig={monacoConfig.editorAppConfig}
          languageClientConfig={monacoConfig.languageClientConfig}
          onEditorStartDone={handleEditorStartDone}
          onLanguageClientsStartDone={handleLCStartDone}
          onError={handleError}
        />
      </main>
    </div>
  );
}
