import React, { useEffect, useRef } from "react";
import { useDocStore } from "./store/myStore";
import * as Comlink from "comlink";
import "./App.css";
import { transfer } from "comlink";
import type { IEmulationState } from "./emulator/cpu";

import { Messenger } from "vscode-messenger-webview";
import { HOST_EXTENSION, type RequestType } from "vscode-messenger-common";
import { hexNotificationType } from "./messageTypes";
// import { Messenger } from "./messenger";

const vscode = acquireVsCodeApi();
const webview_messenger = new Messenger(vscode);

const emulationStateRequestType: RequestType<string, IEmulationState> = { method: "getEmulationState" };

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

    const worker_api = Comlink.wrap<{
      init(canvas: OffscreenCanvas): Promise<void>;
      keyDown(key: string): Promise<void>;
      keyUp(key: string): Promise<void>;
      runHex(hex: string): Promise<void>;
      getState(): Promise<IEmulationState>;
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

    webview_messenger.onRequest(emulationStateRequestType, async () => {
      const state = await worker_api.getState();
      return state;
    });

    webview_messenger.onNotification(hexNotificationType, (hex: string) => {
      console.log("webview received hex notification", hex.slice(0, 20));
      worker_api.runHex(hex);
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
