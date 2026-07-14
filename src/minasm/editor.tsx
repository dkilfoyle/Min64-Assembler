import { useCallback, useEffect, useState } from "react";
import { MonacoEditorReactComp } from "@typefox/monaco-editor-react";
import type { EditorApp } from "monaco-languageclient/editorApp";
import type { LanguageClientManager } from "monaco-languageclient/lcwrapper";

import { monacoApiConfig } from "../monaco/MonacoApiConfig";
import { languageClientConfig } from "./config/languageClientConfig";

type Status = "loading" | "ready" | "error";

export default function AsmEditor(props: { sourceCode: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [trigger, setTrigger] = useState(0);

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
        text: props.sourceCode,
        uri: `/workspace/example.masm`,
      },
    },
  };

  useEffect(() => {
    setTrigger((last) => last + 1);
  }, [props.sourceCode]);

  return (
    <div style={{ display: "flex", height: "100%", width: "100%" }}>
      <MonacoEditorReactComp
        style={{ height: "100%", width: "100%" }}
        vscodeApiConfig={monacoApiConfig}
        languageClientConfig={languageClientConfig}
        editorAppConfig={editorAppConfig}
        triggerReprocessConfig={trigger}
        onEditorStartDone={handleEditorStartDone}
        onLanguageClientsStartDone={handleLCStartDone}
        onError={handleError}
      />
    </div>
  );
}
