import React, { useEffect, useRef, useState } from "react";
import * as Comlink from "comlink";
import { transfer } from "comlink";
import { Messenger } from "vscode-messenger-webview";
import {
  type IRunParams,
  type IStepParams,
  EmulationStateRequest,
  RunNotification,
  StepRequest,
  MemoryViewerNotification,
} from "./api";
import { type IEmulationState } from "./emulator14/machine";
import "baukasten-ui/dist/baukasten-base.css";
import "baukasten-ui/dist/baukasten-vscode.css";
import { Input, Label, Slider } from "baukasten-ui/core";

import "./App.css";

const vscode =
  typeof acquireVsCodeApi == "function"
    ? acquireVsCodeApi()
    : {
        postMessage: (msg: any) => console.log("vscode.postMessage", msg),
        getState: () => null,
        setState: (state: any) => console.log("vscode.setState", state),
      };
const webview_messenger = new Messenger(vscode);

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const divRef = useRef<HTMLDivElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const [emulationState, setEmulationState] =
    React.useState<IEmulationState | null>({
      memory: new Uint8Array(0xffff + 1),
      pc: 0,
      sp: 0,
      c: false,
      z: false,
      n: false,
      a: 0,
    });
  const [memoryViewerStartAddress, setMemoryViewerStartAddress] = useState(0);
  const [memoryViewerPage, setMemoryViewerPage] = useState(0);
  const [memoryViewerOffset, setMemoryViewerOffset] = useState(0);

  useEffect(() => {
    if (!canvasRef.current) return;

    // 1. Initialize Worker using standard Vite / Webpack 5 URL syntax
    const worker = new Worker(
      new URL("./emulator.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    const worker_api = Comlink.wrap<{
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
      return worker_api.run(params);
    });

    webview_messenger.onNotification(MemoryViewerNotification, (params) => {
      setMemoryViewerStartAddress(params.startAddress);
      setMemoryViewerPage((params.startAddress >> 8) & 0xff);
      setMemoryViewerOffset(params.startAddress & 0xff);
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

  return (
    <div className="app-container">
      <div ref={divRef} className="canvas-container">
        <canvas ref={canvasRef} width={400} height={240} className="screen" />
      </div>
      {emulationState && (
        <div className="memory-viewer-container">
          <div className="memory-view-table">
            {Array.from(
              { length: 16 },
              (_, i) => memoryViewerStartAddress + i * 16,
            ).map((rowAddress) => (
              <div key={"row-" + rowAddress} className="memory-row">
                <div className="memory-row-address">
                  {rowAddress.toString(16).padStart(4, "0").toUpperCase()}
                </div>
                <div className="memory-row-bytes">
                  {Array.from(
                    emulationState.memory.slice(rowAddress, rowAddress + 16),
                  ).map((byte, index) => (
                    <div key={index} className="memory-cell">
                      {byte.toString(16).padStart(2, "0").toUpperCase()}
                    </div>
                  ))}
                </div>
                <div className="memory-row-chars">
                  {Array.from(
                    emulationState.memory.slice(rowAddress, rowAddress + 16),
                  ).map((byte, index) => (
                    <div key={index} className="memory-cell">
                      {String.fromCharCode(byte || 46)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="memory-slider-container">
            <Label style={{ width: "100px" }}>
              <span className="label">Page</span>
              <Input
                value={memoryViewerPage
                  .toString(16)
                  .padStart(2, "0")
                  .toUpperCase()}
                // onChange={(e) =>
                //   setMemoryViewerPage(parseInt(e.target.value, 16))
                // }
              ></Input>
            </Label>
            <Slider
              min={0}
              max={255}
              step={1}
              fullWidth
              value={memoryViewerPage}
              onChange={(value) => setMemoryViewerPage(Number(value))}
              onChangeCommitted={(value) => {
                const newStartAddress =
                  ((Number(value) & 0xff) << 8) | (memoryViewerOffset & 0xff);
                setMemoryViewerStartAddress(newStartAddress);
              }}
            />
          </div>
          <div className="memory-slider-container">
            <Label style={{ width: "100px" }}>
              <span className="label">Offset</span>
              <Input
                value={memoryViewerOffset
                  .toString(16)
                  .padStart(2, "0")
                  .toUpperCase()}
                // onChange={(e) =>
                //   setMemoryViewerOffset(parseInt(e.target.value, 16))
                // }
              ></Input>
            </Label>
            <Slider
              min={0}
              max={255}
              step={1}
              fullWidth
              value={memoryViewerOffset}
              onChange={(value) => setMemoryViewerOffset(Number(value))}
              onChangeCommitted={(value) => {
                const newStartAddress =
                  (memoryViewerPage << 8) | (Number(value) & 0xff);
                setMemoryViewerStartAddress(newStartAddress);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
