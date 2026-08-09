import * as Comlink from "comlink";
import { keycodes } from "./emulator11/io";
import type { IRunParams, IStepParams } from "./api";
import { machine } from "./emulator14/machine";

// Define worker self context for TypeScript
// const ctxWorker: Worker = self as any;

let ctx: OffscreenCanvasRenderingContext2D | null = null;
let animationFrameId: number | null = null;
const nextFrame = () =>
  new Promise((resolve) => (animationFrameId = requestAnimationFrame(resolve)));

// Track active key states
const keyPressedState: Record<string, boolean> = {};
const keyPressedTime: Record<string, number> = {};

// Delta time tracking variables
let lastTime = 0;
let frameCount = 0;
let deltaAverage = 0;

// if 60 fps = 16.67ms per frame = 133369 min clocks / frame

const api = {
  init: async (canvas: OffscreenCanvas) => {
    console.log("Emulator worker init...");
    ctx = canvas.getContext("2d");
    await machine.reset();
    lastTime = performance.now();
    runLoop();
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
  run: async (params: IRunParams) => {
    // if (params.reset) {
    //   await machine.reset();
    //   lastTime = performance.now();
    //   runLoop();
    // }
    if (params.hex) {
      const totalBytes = machine.loadHexIntoRam(params.hex);
      const pc = parseInt(params.hex.slice(3, 7), 16);
      console.info(
        `EMULATOR received ${totalBytes} bytes, starting at PC=${pc.toString(16).padStart(4, "0")}`,
      );
      machine.cpu.pc = pc;
    } else {
      if (params.pc != undefined) machine.cpu.pc = params.pc;
    }
    if (machine.runType === "stop") {
      machine.runType = params.runType;
      lastTime = performance.now();
      runLoop();
    } else {
      machine.runType = params.runType;
    }
  },
  step: async (params: IStepParams) => {
    cancelAnimationFrame(animationFrameId!);
    animationFrameId = null;
    machine.runType = params.stepType;
    if (params.nextPC != undefined) machine.stopStepOverPC = params.nextPC;
    lastTime = performance.now();
    return await runLoop();
  },
  getEmulationState: () => {
    return machine.getEmulationState();
  },
};

Comlink.expose(api);

async function runLoop() {
  if (!ctx) return;

  while (machine.runType !== "stop") {
    // 1. Calculate delta time (ms elapsed since last frame)
    const currentTime = performance.now();
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;
    frameCount++;
    deltaAverage += (deltaTime - deltaAverage) / frameCount;

    // Prevent giant jumps if the user leaves the tab and comes back
    const dt = Math.min(deltaTime, 100);

    machine.frame(dt);

    const pixelData = machine.vga.getScreenPixelData();
    const imageData = new ImageData(pixelData, 400, 240); // 512, 256);
    ctx.putImageData(imageData, 0, 0);
    ctx.font = "bold 10px Arial"; // Configures size and family (Default: 10px sans-serif)
    ctx.fillStyle = "#ff4500";
    ctx.textAlign = "right";
    ctx.fillText((1000 / deltaAverage).toFixed(2), 395, 10);
    ctx.fillText(machine.runType, 395, 30);

    // const screenImage = ctx.getImageData(0, 0, 400, 240);
    // const maxNibbleWrite = Math.max(...machine.mem.nibbleWrite);
    // const maxNibbleRead = Math.max(...machine.mem.nibbleRead);
    // const maxNibble = Math.max(maxNibbleWrite, maxNibbleRead, 1);
    // for (let i = 0; i < 0x1000; i++) {
    //   const y = (i % 10) + 230;
    //   const x = Math.floor(i / 10);
    //   const index = (y * 400 + x) * 4;
    //   screenImage.data[index] = machine.mem.nibbleWrite[i] & 0xff;
    //   screenImage.data[index + 1] = 0;
    //   screenImage.data[index + 2] = machine.mem.nibbleRead[i] & 0xff;
    //   screenImage.data[index + 3] = 200;
    // }
    // ctx.putImageData(screenImage, 0, 0);

    await nextFrame();
  }

  return machine.getEmulationState();
}

// function renderLoop(currentTime: number): void {
//   if (!ctx) return;

//   // 1. Calculate delta time (ms elapsed since last frame)
//   const deltaTime = currentTime - lastTime;
//   lastTime = currentTime;
//   frameCount++;
//   deltaAverage += (deltaTime - deltaAverage) / frameCount;

//   // Prevent giant jumps if the user leaves the tab and comes back
//   const dt = Math.min(deltaTime, 100);
//   machine.run(dt);

//   const pixelData = machine.vga.getScreenPixelData();
//   const imageData = new ImageData(pixelData, 400, 240); // 512, 256);
//   ctx.putImageData(imageData, 0, 0);
//   ctx.font = "bold 10px Arial"; // Configures size and family (Default: 10px sans-serif)
//   ctx.fillStyle = "#ff4500";
//   ctx.textAlign = "right";
//   ctx.fillText((1000 / deltaAverage).toFixed(2), 395, 10);

//   if (machine.runType === "stop") {
//     if (animationFrameId !== null) {
//       cancelAnimationFrame(animationFrameId);
//       animationFrameId = null;
//     }
//   } else {
//     // Request next frame
//     animationFrameId = requestAnimationFrame(renderLoop);
//   }
// }
