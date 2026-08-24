import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Comlink from "comlink";
import { transfer } from "comlink";
import { Messenger } from "vscode-messenger-webview";
import { type IRunParams, type IStepParams, EmulationStateRequest, RunNotification, StepRequest, MemoryViewerNotification } from "./api";
import { type IEmulationState } from "./emulator14/machine";
import "baukasten-ui/dist/baukasten-base.css";
// import "baukasten-ui/dist/baukasten-vscode.css";
import "baukasten-ui/dist/baukasten-web.css";
import { Badge, Button, Divider, Heading, Icon, Input, Select, Slider } from "baukasten-ui/core";
import clsx from "clsx";
import { getScrollbarSize, List, type RowComponentProps } from "react-window";
import "./App.css";

import { osShortLabels } from "./emulator14/oslabels";

const vscode =
  typeof acquireVsCodeApi == "function"
    ? acquireVsCodeApi()
    : {
        postMessage: (msg: any) => console.log("vscode.postMessage", msg),
        getState: () => null,
        setState: (state: any) => console.log("vscode.setState", state),
      };
const webview_messenger = new Messenger(vscode);

let worker_api: Comlink.Remote<{
  init(canvas: OffscreenCanvas): Promise<void>;
  keyDown(key: string): Promise<void>;
  keyUp(key: string): Promise<void>;
  getEmulationState(): Promise<IEmulationState>;
  run(params: IRunParams): Promise<void>;
  step(params: IStepParams): Promise<IEmulationState>;
}>;

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const divRef = useRef<HTMLDivElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const [emulationState, setEmulationState] = React.useState<IEmulationState | null>({
    memory: new Uint8Array(0xffff + 1),
    pc: 0,
    sp: 0,
    c: false,
    z: false,
    n: false,
    a: 0,
  });

  const [addrTarget, setAddrTarget] = useState<number>(0);
  const [addrTargetEnd, setAddrTargetEnd] = useState<number>(1);
  const [addrHover, setAddrHover] = useState<number | null>(null);
  const [labels, setLabels] = useState<Record<number, string>>(osShortLabels);

  const addrStart = useMemo(() => addrTarget & 0xfff0, [addrTarget]);
  const addrPage = useMemo(() => (addrStart >> 8) & 0xff, [addrStart]);
  const addrOffset = useMemo(() => addrStart & 0xff, [addrStart]);
  const hoverByte = useMemo(() => (addrHover !== null ? emulationState?.memory[addrHover] : null), [addrHover, emulationState]);
  const hoverWord = useMemo(
    () => (addrHover !== null && emulationState ? (emulationState.memory[addrHover + 1] << 8) | emulationState.memory[addrHover] : null),
    [addrHover, emulationState],
  );

  useEffect(() => {
    if (!canvasRef.current) return;

    // 1. Initialize Worker using standard Vite / Webpack 5 URL syntax
    const worker = new Worker(new URL("./emulator.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker_api = Comlink.wrap<{
      init(canvas: OffscreenCanvas): Promise<void>;
      keyDown(key: string): Promise<void>;
      keyUp(key: string): Promise<void>;
      getEmulationState(): Promise<IEmulationState>;
      run(params: IRunParams): Promise<void>;
      step(params: IStepParams): Promise<IEmulationState>;
    }>(worker);

    // worker communication

    const offscreen = canvasRef.current.transferControlToOffscreen();
    worker_api.init(transfer(offscreen, [offscreen]));

    const handleKeyDown = (e: KeyboardEvent) => {
      worker_api.keyDown(e.code);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      worker_api.keyUp(e.code);
    };

    // webview communcation

    webview_messenger.onRequest(EmulationStateRequest, async () => {
      const state = await worker_api.getEmulationState();
      setEmulationState(state);
      return state;
    });

    webview_messenger.onNotification(RunNotification, (params) => {
      if (params.labels) setLabels({ ...osShortLabels, ...params.labels });
      return worker_api.run(params);
    });

    webview_messenger.onNotification(MemoryViewerNotification, (params) => {
      setAddrTarget(params.addrTarget);
      setAddrTargetEnd(params.addrTargetEnd);
    });

    webview_messenger.onRequest(StepRequest, async (params) => {
      const state = await worker_api.step(params);
      setEmulationState(state);
      return state;
    });

    webview_messenger.start();

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    // window.addEventListener("message", handleMessage);

    // Cleanup on unmount
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      // window.removeEventListener("message", handleMessage);
      worker.terminate();
    };
  }, []);

  const memoryRow = ({ index, style }: RowComponentProps) => {
    const rowAddress = addrStart + index * 16;
    return (
      <div key={"row-" + rowAddress} className="memory-row" style={style}>
        <div className="memory-row-address">{rowAddress.toString(16).padStart(4, "0").toUpperCase()}</div>
        <div className="memory-row-bytes">
          {Array.from(emulationState!.memory.slice(rowAddress, rowAddress + 16)).map((byte, index) => (
            <div
              key={index}
              onMouseEnter={() => {
                setAddrHover(rowAddress + index);
              }}
              className={clsx("memory-cell", {
                "memory-cell-target": rowAddress + index >= addrTarget && rowAddress + index <= addrTargetEnd,
                "memory-cell-hover": addrHover !== null && rowAddress + index === addrHover,
              })}>
              {byte.toString(16).padStart(2, "0").toUpperCase()}
            </div>
          ))}
        </div>
        <div className="memory-row-chars">
          {Array.from(emulationState!.memory.slice(rowAddress, rowAddress + 16)).map((byte, index) => (
            <div key={index} className="memory-cell">
              {String.fromCharCode(byte || 46)}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="app-container">
      <div ref={divRef} className="canvas-container">
        <canvas ref={canvasRef} width={400} height={240} className="screen" />
      </div>
      {emulationState && (
        <>
          <div className="emulation-state-container">
            <div className="emulation-state">
              <span>PC</span>
              <Button
                variant="secondary"
                style={{ width: "40px", textAlign: "center" }}
                onClick={() => {
                  const newStartAddress = emulationState.pc & 0xfff0;
                  setAddrTarget(newStartAddress);
                  setAddrTargetEnd(newStartAddress + 15); // Assuming a 16-byte range
                }}>
                {emulationState.pc.toString(16).padStart(4, "0").toUpperCase()}
              </Button>
              <div className="info-label" style={{ width: "100px" }}>
                {labels[emulationState.pc] || "-"}
              </div>
              <span>A</span>
              <div className="info-value-byte">{emulationState.a.toString(16).padStart(2, "0").toUpperCase()}</div>
              <Badge variant={emulationState.n ? "error" : "default"}>N</Badge>
              <Badge variant={emulationState.z ? "error" : "default"}>Z</Badge>
              <Badge variant={emulationState.c ? "error" : "default"}>C</Badge>
              <span>SP</span>
              <Button
                variant="secondary"
                style={{ width: "40px", textAlign: "center" }}
                onClick={() => {
                  const newStartAddress = emulationState.sp & 0xfff0;
                  setAddrTarget(newStartAddress);
                  setAddrTargetEnd(newStartAddress + 15); // Assuming a 16-byte range
                }}>
                {emulationState.sp.toString(16).padStart(4, "0").toUpperCase()}
              </Button>
              <Button size="sm">
                <Icon name="refresh" />
              </Button>
            </div>
            <div
              className="memory-view-table"
              onMouseLeave={() => {
                setAddrHover(null);
              }}>
              <List rowComponent={memoryRow} rowCount={256} rowHeight={20} rowProps={{}}></List>
            </div>

            <div className="line">
              <span className="line-label">Page</span>
              <div className="spread">
                <Input
                  value={addrPage.toString(16).padStart(2, "0").toUpperCase()}
                  style={{
                    width: "40px",
                    textAlign: "center",
                    marginRight: "10px",
                  }}></Input>
                <div style={{ marginTop: "-6px", width: "100%", display: "inline-block" }}>
                  <Slider
                    min={0}
                    max={255}
                    step={1}
                    fullWidth
                    // }}
                    value={addrPage}
                    onChange={(page) => {
                      const newStartAddress = ((Number(page) & 0xff) << 8) | (addrOffset & 0xff);
                      setAddrTarget(newStartAddress);
                      setAddrTargetEnd(newStartAddress + 1); // Assuming a 16-byte range
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="line">
              <span className="line-label">Goto</span>
              <div className="spread">
                <Select
                  placeholder=""
                  options={Object.entries(labels).map(([address, label]) => ({
                    value: address,
                    label,
                  }))}
                  onChange={(value) => {
                    const newTargetAddress = parseInt(value, 10);
                    setAddrTarget(newTargetAddress);
                    setAddrTargetEnd(newTargetAddress + 1);
                  }}></Select>
                <div className="info-field">
                  <span style={{ marginLeft: "10px" }}>Address:</span>
                  <Input
                    value={addrTarget.toString(16).padStart(4, "0").toUpperCase()}
                    onChange={(e) => setAddrTarget(parseInt(e.target.value, 16))}
                    style={{
                      width: "60px",
                      textAlign: "center",
                      marginLeft: "5px",
                    }}></Input>
                </div>
              </div>
            </div>

            <div className="line">
              <span className="line-label">Hover</span>
              <div className="spread">
                <div className="collect">
                  <span className="info-value-word">{addrHover !== null ? addrHover.toString(16).padStart(4, "0").toUpperCase() : "-"}</span>
                  <span className="info-label" style={{ width: "100px" }}>
                    {addrHover !== null ? labels[addrHover] || "-" : "-"}
                  </span>
                </div>
                <div className="collect">
                  <span className="info-value-word">{addrHover !== null ? hoverByte : 0}</span>
                  <span className="info-value-word">{(hoverWord !== null ? hoverWord : 0).toString(10)}</span>
                  <span className="info-value-word">{(hoverWord !== null ? hoverWord : 0).toString(16).padStart(4, "0").toUpperCase()}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
