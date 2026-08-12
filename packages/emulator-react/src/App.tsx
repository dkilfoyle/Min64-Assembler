import React, { useEffect, useMemo, useRef, useState } from "react";
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
// import "baukasten-ui/dist/baukasten-vscode.css";
import "baukasten-ui/dist/baukasten-web.css";
import {
  Badge,
  Button,
  Heading,
  Input,
  Select,
  Slider,
} from "baukasten-ui/core";
import clsx from "clsx";
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

  const [addrTarget, setAddrTarget] = useState<number>(0);
  const [addrTargetEnd, setAddrTargetEnd] = useState<number>(1);
  const [addrHover, setAddrHover] = useState<number | null>(null);
  const [labels, setLabels] = useState<Record<number, string>>(osShortLabels);

  const addrStart = useMemo(() => addrTarget & 0xfff0, [addrTarget]);
  const addrPage = useMemo(() => (addrStart >> 8) & 0xff, [addrStart]);
  const addrOffset = useMemo(() => addrStart & 0xff, [addrStart]);
  const hoverByte = useMemo(
    () => (addrHover !== null ? emulationState?.memory[addrHover] : null),
    [addrHover, emulationState],
  );
  const hoverWord = useMemo(
    () =>
      addrHover !== null && emulationState
        ? (emulationState.memory[addrHover + 1] << 8) |
          emulationState.memory[addrHover]
        : null,
    [addrHover, emulationState],
  );

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
                }}
              >
                {emulationState.pc.toString(16).padStart(4, "0").toUpperCase()}
              </Button>
              <Button
                variant="secondary"
                style={{ width: "80px", textAlign: "center" }}
              >
                {labels[emulationState.pc] || "-"}
              </Button>
              <span>A</span>
              <Button
                variant="secondary"
                style={{ width: "30px", textAlign: "center" }}
              >
                {emulationState.a.toString(16).padStart(2, "0").toUpperCase()}
              </Button>
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
                }}
              >
                {emulationState.sp.toString(16).padStart(4, "0").toUpperCase()}
              </Button>
            </div>
            <div className="memory-view-table">
              {Array.from({ length: 16 }, (_, i) => addrStart + i * 16).map(
                (rowAddress) => (
                  <div key={"row-" + rowAddress} className="memory-row">
                    <div className="memory-row-address">
                      {rowAddress.toString(16).padStart(4, "0").toUpperCase()}
                    </div>
                    <div className="memory-row-bytes">
                      {Array.from(
                        emulationState.memory.slice(
                          rowAddress,
                          rowAddress + 16,
                        ),
                      ).map((byte, index) => (
                        <div
                          key={index}
                          onMouseEnter={() => {
                            setAddrHover(rowAddress + index);
                          }}
                          onMouseLeave={() => {
                            setAddrHover(null);
                          }}
                          className={clsx("memory-cell", {
                            "memory-cell-target":
                              rowAddress + index >= addrTarget &&
                              rowAddress + index <= addrTargetEnd,
                            "memory-cell-hover":
                              addrHover !== null &&
                              rowAddress + index === addrHover,
                          })}
                        >
                          {byte.toString(16).padStart(2, "0").toUpperCase()}
                        </div>
                      ))}
                    </div>
                    <div className="memory-row-chars">
                      {Array.from(
                        emulationState.memory.slice(
                          rowAddress,
                          rowAddress + 16,
                        ),
                      ).map((byte, index) => (
                        <div key={index} className="memory-cell">
                          {String.fromCharCode(byte || 46)}
                        </div>
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
            <div className="memory-slider-container">
              <span
                style={{
                  textAlign: "right",
                  width: "60px",
                  display: "inline-block",
                }}
              >
                Page
              </span>
              <Input
                value={addrPage.toString(16).padStart(2, "0").toUpperCase()}
                style={{
                  width: "40px",
                  textAlign: "center",
                  marginRight: "10px",
                }}
              ></Input>
              <Slider
                min={0}
                max={255}
                step={1}
                fullWidth
                // }}
                value={addrPage}
                onChange={(page) => {
                  const newStartAddress =
                    ((Number(page) & 0xff) << 8) | (addrOffset & 0xff);
                  setAddrTarget(newStartAddress);
                  setAddrTargetEnd(newStartAddress + 1); // Assuming a 16-byte range
                }}
                style={{ display: "inline-block" }}
              />
            </div>
            <div className="memory-slider-container">
              <span
                style={{
                  textAlign: "right",
                  width: "60px",
                  display: "inline-block",
                }}
              >
                Offset
              </span>
              <Input
                value={addrOffset.toString(16).padStart(2, "0").toUpperCase()}
                style={{
                  width: "40px",
                  textAlign: "center",
                  marginRight: "10px",
                }}
              ></Input>
              <Slider
                min={0}
                max={0xf0}
                step={16}
                fullWidth
                value={addrOffset}
                onChange={(offset) => {
                  const newTargetAddress =
                    ((addrPage & 0xff) << 8) | (Number(offset) & 0xff);
                  setAddrTarget(newTargetAddress);
                  setAddrTargetEnd(newTargetAddress + 1); // Assuming a 16-byte range
                }}
                style={{
                  marginBottom: "0px !important",
                  display: "inline-block",
                }}
              />
            </div>
            <div className="emulation-state">
              <span>Labels</span>
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
                }}
              ></Select>
              <span style={{ marginLeft: "10px" }}>Address:</span>
              <Input
                value={addrTarget.toString(16).padStart(4, "0").toUpperCase()}
                onChange={(e) => setAddrTarget(parseInt(e.target.value, 16))}
                style={{
                  width: "60px",
                  textAlign: "center",
                  marginLeft: "5px",
                }}
              ></Input>
            </div>
          </div>

          <div className="hover-info-container">
            <div className="hover-info-line">
              <div className="info-field">
                <span>Hover address:</span>
                <span className="info-value">
                  {addrHover !== null
                    ? addrHover.toString(16).padStart(4, "0").toUpperCase()
                    : "-"}
                </span>
              </div>
              <div className="info-field">
                <span>Label:</span>
                <span className="info-value" style={{ width: "100px" }}>
                  {addrHover !== null ? labels[addrHover] || "-" : "-"}
                </span>
              </div>
            </div>
            <div className="hover-info-line">
              <div className="info-field">
                <span>Decimal:</span>
                <span className="info-value">
                  {addrHover !== null ? hoverByte : 0}
                </span>
              </div>
              <div className="info-field">
                <span>DecimalWord:</span>
                <span className="info-value">
                  {(hoverWord !== null ? hoverWord : 0).toString(10)}
                </span>
              </div>
              <div className="info-field">
                <span>HexWord:</span>
                <span className="info-value">
                  {(hoverWord !== null ? hoverWord : 0)
                    .toString(16)
                    .padStart(4, "0")
                    .toUpperCase()}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
