import * as Comlink from "comlink";
import { keycodes } from "./emulator11/io";
import type { IRunParams, RunTypes } from "./api";
import { machine } from "./emulator14/machine";
import { disassembleRange } from "./emulator14/disassembler";

// Define worker self context for TypeScript
// const ctxWorker: Worker = self as any;

let ctx: OffscreenCanvasRenderingContext2D | null = null;

// Track active key states
const keyPressedState: Record<string, boolean> = {};
const keyPressedTime: Record<string, number> = {};

// Delta time tracking variables
let lastTime = 0;
let runType: RunTypes = "run";
let frameCount = 0;
let deltaAverage = 0;

// if 60 fps = 16.67ms per frame = 133369 min clocks / frame

const api = {
  init: async (canvas: OffscreenCanvas) => {
    console.log("Emulator worker init...");
    ctx = canvas.getContext("2d");
    await machine.reset();
    console.log(" - machine initialised");
    lastTime = performance.now();
    requestAnimationFrame(renderLoop);
  },
  keyDown: (key: string) => {
    const tnow = performance.now();
    if (keyPressedState[key]) {
      // already pushed
      if (tnow - keyPressedTime[key] > 260) {
        keyPressedTime[key] = tnow;
        if (key in keycodes) machine.io.pushKeyByte(keycodes[key]);
      }
    } else {
      // initial key down
      keyPressedState[key] = true;
      keyPressedTime[key] = tnow;
      if (key in keycodes) machine.io.pushKeyByte(keycodes[key]);
    }
  },
  keyUp: (key: string) => {
    keyPressedState[key] = false; // reset key press
  },
  run: (params: IRunParams) => {
    if (params.hex) {
      const totalBytes = machine.loadHexIntoRam(params.hex);
      console.info(`EMULATOR received ${totalBytes} bytes`);
    }
    if (params.pc != undefined) machine.cpu.pc = params.pc;
    runType = params.runType;
  },
  getEmulationState: () => {
    return machine.getEmulationState();
  },
};

Comlink.expose(api);

function renderLoop(currentTime: number): void {
  if (!ctx) return;

  // 1. Calculate delta time (ms elapsed since last frame)
  const deltaTime = currentTime - lastTime;
  lastTime = currentTime;
  frameCount++;
  deltaAverage += (deltaTime - deltaAverage) / frameCount;

  // Prevent giant jumps if the user leaves the tab and comes back
  const dt = Math.min(deltaTime, 100);
  machine.run(runType, dt);

  const pixelData = machine.vga.getScreenPixelData();
  const imageData = new ImageData(pixelData, 400, 240); // 512, 256);
  ctx.putImageData(imageData, 0, 0);
  ctx.font = "bold 10px Arial"; // Configures size and family (Default: 10px sans-serif)
  ctx.fillStyle = "#ff4500";
  ctx.textAlign = "right";
  ctx.fillText((1000 / deltaAverage).toFixed(2), 395, 10);

  // Request next frame
  requestAnimationFrame(renderLoop);
}
