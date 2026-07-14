import "./App.css";
import AsmEditor from "./minasm/editor";
import MinEditor from "./minmin/editor";

export default function App() {
  return (
    <div className="ide-root">
      <header className="ide-header">
        <span className="ide-chip">Min64x4</span>
        <h1>Assembly IDE</h1>
        <span className="ide-sub">Langium · Monaco · LSP</span>
      </header>

      <main className="ide-main">
        <div style={{ display: "flex", height: "100%", width: "100%" }}>
          <MinEditor />
          <AsmEditor />
        </div>
      </main>
    </div>
  );
}
