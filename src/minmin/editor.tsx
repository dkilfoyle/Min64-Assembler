import { useCallback, useState } from "react";
import { MonacoEditorReactComp } from "@typefox/monaco-editor-react";
import type { EditorApp } from "monaco-languageclient/editorApp";
import type { LanguageClientManager } from "monaco-languageclient/lcwrapper";

import { monacoApiConfig } from "../monaco/MonacoApiConfig";
import { languageClientConfig } from "./config/languageClientConfig";

import minCode from "./examples/compileme.min?raw";

type Status = "loading" | "ready" | "error";

export default function MinEditor() {
  const [source, setSource] = useState(minCode);
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

  const editorAppConfig = {
    codeResources: {
      modified: {
        text: source,
        uri: `/workspace/example.min`,
      },
    },
  };

  return (
    <div style={{ display: "flex", height: "100%", width: "100%" }}>
      <MonacoEditorReactComp
        style={{ height: "100%", width: "100%" }}
        vscodeApiConfig={monacoApiConfig}
        languageClientConfig={languageClientConfig}
        editorAppConfig={editorAppConfig}
        onEditorStartDone={handleEditorStartDone}
        onLanguageClientsStartDone={handleLCStartDone}
        onError={handleError}
      />
    </div>
  );
}
