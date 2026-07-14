import "./App.css";
import AsmEditor from "./minasm/editor";
import MinEditor from "./minmin/editor";

import minCode from "./minmin/examples/compileme.min?raw";
import { useState } from "react";

export default function App() {
  const [asmCode, setAsmCode] = useState("");
  return (
    <div className="ide-root">
      <header className="ide-header">
        <span className="ide-chip">Min64x4</span>
        <h1>Min Compiler IDE</h1>
        <span className="ide-sub">Langium · Monaco · LSP</span>
      </header>

      <main className="ide-main">
        <div style={{ display: "flex", height: "100%", width: "100%" }}>
          <MinEditor onCompiled={(asm: string) => setAsmCode(asm)} sourceCode={minCode} />
          <AsmEditor sourceCode={asmCode} />
        </div>
      </main>
    </div>
  );
}
