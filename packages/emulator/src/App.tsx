import React, { useEffect, useRef } from "react";
import * as Comlink from "comlink";
import { transfer } from "comlink";
import { Messenger } from "vscode-messenger-webview";
import { type IRunParams, RunNotification, EmulationStateRequest } from "./api";
import type { IEmulationState } from "./emulator11/machine";
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

  useEffect(() => {
    if (!canvasRef.current) return;

    // 1. Initialize Worker using standard Vite / Webpack 5 URL syntax
    const worker = new Worker(new URL("./emulator.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    const worker_api = Comlink.wrap<{
      init(canvas: OffscreenCanvas): Promise<void>;
      keyDown(key: string): Promise<void>;
      keyUp(key: string): Promise<void>;
      getEmulationState(): Promise<IEmulationState>;
      run(params: IRunParams): Promise<void>;
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
      return state;
    });

    webview_messenger.onNotification(RunNotification, (params) => {
      return worker_api.run(params);
    });

    webview_messenger.start();

    // const handleMessage = (e: MessageEvent) => {
    //   const message = e.data;
    //   switch (message.command) {
    //     case "RUN_HEX":
    //       api.runHex(message.hex);
    //       break;
    //     case "GET_STATE":
    //       const minimalState = api.getState();
    //       vscode?.postMessage({ command: "GOT_STATE", state: minimalState });
    //       break;
    //     default:
    //       console.warn("Unknown message from worker:", message);
    //   }
    //   // console.log("emulator webview app received message from vscode app", e.data);
    // };

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
    <div ref={divRef} className="canvas-container">
      <canvas ref={canvasRef} width={400} height={240} className="screen" />
    </div>
  );
};
