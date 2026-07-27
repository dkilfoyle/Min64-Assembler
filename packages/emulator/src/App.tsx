import React, { useEffect, useRef } from "react";
import { useDocStore } from "./store/myStore";
import * as Comlink from "comlink";
import "./App.css";
import { transfer } from "comlink";
import type { ICpuState } from "./emulator/cpu";

const vscode = typeof acquireVsCodeApi !== "undefined" ? acquireVsCodeApi() : null;

// Define the shape of messages sent to the worker
export type CanvasWorkerMessage =
  | { type: "INIT"; canvas: OffscreenCanvas }
  | { type: "KEY_DOWN"; key: string }
  | { type: "KEY_UP"; key: string };

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const divRef = useRef<HTMLDivElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const hex = useDocStore((state) => state.docs["demo"].hex);

  useEffect(() => {
    if (!canvasRef.current) return;

    // 1. Initialize Worker using standard Vite / Webpack 5 URL syntax
    const worker = new Worker(new URL("./emulator.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    const api = Comlink.wrap<{
      init(canvas: OffscreenCanvas): Promise<void>;
      keyDown(key: string): Promise<void>;
      keyUp(key: string): Promise<void>;
      runHex(hex: string): Promise<void>;
      getState(): Promise<ICpuState>;
    }>(worker);

    // 2. Transfer canvas control to the worker
    const offscreen = canvasRef.current.transferControlToOffscreen();
    api.init(transfer(offscreen, [offscreen]));

    // 3. Forward keyboard events
    const handleKeyDown = (e: KeyboardEvent) => {
      api.keyDown(e.code);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      api.keyUp(e.code);
    };

    const handleMessage = (e: MessageEvent) => {
      const message = e.data;
      switch (message.command) {
        case "RUN_HEX":
          api.runHex(message.hex);
          break;
        case "GET_STATE":
          const minimalState = api.getState();
          vscode?.postMessage({ command: "GOT_STATE", state: minimalState });
          break;
        default:
          console.warn("Unknown message from worker:", message);
      }
      // console.log("emulator webview app received message from vscode app", e.data);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("message", handleMessage);

    // Cleanup on unmount
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("message", handleMessage);
      worker.terminate();
    };
  }, []);

  return (
    <div ref={divRef} className="canvas-container">
      <canvas ref={canvasRef} width={400} height={240} className="screen" />
    </div>
  );
};
