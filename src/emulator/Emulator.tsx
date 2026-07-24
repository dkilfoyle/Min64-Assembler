import React, { useEffect, useRef } from "react";
import { useDocStore } from "../myStore";

// Define the shape of messages sent to the worker
export type CanvasWorkerMessage =
  | { type: "INIT"; canvas: OffscreenCanvas }
  | { type: "KEY_DOWN"; key: string }
  | { type: "KEY_UP"; key: string };

export const Emulator: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const divRef = useRef<HTMLDivElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const hex = useDocStore((state) => state.docs["demo"].hex);

  useEffect(() => {
    if (!canvasRef.current) return;

    // 1. Initialize Worker using standard Vite / Webpack 5 URL syntax
    const worker = new Worker(new URL("./emulator.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    // 2. Transfer canvas control to the worker
    const offscreen = canvasRef.current.transferControlToOffscreen();
    worker.postMessage({ type: "INIT", canvas: offscreen }, [offscreen]);

    // 3. Forward keyboard events
    const handleKeyDown = (e: KeyboardEvent) => {
      worker.postMessage({ type: "KEY_DOWN", key: e.keyCode });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      worker.postMessage({ type: "KEY_UP", key: e.keyCode });
    };

    divRef.current!.addEventListener("keydown", handleKeyDown);
    divRef.current!.addEventListener("keyup", handleKeyUp);

    // Cleanup on unmount
    return () => {
      divRef.current?.removeEventListener("keydown", handleKeyDown);
      divRef.current?.removeEventListener("keyup", handleKeyUp);
      worker.terminate();
    };
  }, []);

  return (
    <div ref={divRef} style={{ width: "500px" }} tabIndex={-1}>
      <canvas ref={canvasRef} width={400} height={240} style={{ display: "block" }} onClick={() => divRef.current?.focus()} />
      <button onClick={() => workerRef.current?.postMessage({ type: "HEX", hex: hex })}>Send</button>
      {hex}
    </div>
  );
};
