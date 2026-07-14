import { useCallback, useRef, useState } from "react";
import { MonacoEditorReactComp } from "@typefox/monaco-editor-react";
import type { EditorApp, EditorAppConfig } from "monaco-languageclient/editorApp";
import type { LanguageClientManager } from "monaco-languageclient/lcwrapper";

import { monacoApiConfig } from "../monaco/MonacoApiConfig";
import { languageClientConfig } from "./config/languageClientConfig";
import { MonacoLanguageClient } from "monaco-languageclient";

type Status = "loading" | "ready" | "error";

export default function MinEditor(props: { onCompiled: (asm: string) => void; sourceCode: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const lcRef = useRef<MonacoLanguageClient | null>(null);

  const handleEditorStartDone = useCallback((editorApp?: EditorApp) => {
    setStatus("ready");
  }, []);

  const handleLCStartDone = useCallback((lcsManager: LanguageClientManager) => {
    setStatus("ready");
    lcRef.current = lcsManager.getLanguageClient("minmin") || null;
    lcsManager.getLanguageClient("minmin")?.onNotification("server/onCompiled", ({ asm }) => {
      props.onCompiled(asm);
    });
  }, []);

  const handleError = useCallback((err: Error) => {
    console.error("[6502 IDE]", err);
    setStatus("error");
    setErrorMsg(err.message);
  }, []);

  const editorAppConfig: EditorAppConfig = {
    codeResources: {
      modified: {
        text: props.sourceCode,
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
